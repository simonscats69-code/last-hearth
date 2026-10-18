/**
 * Боссы: соло-боёвка и массовые бои.
 *
 * Согласованная модель:
 * - Обычные боссы доступны соло и в массовом режиме
 * - Ключи тратятся только при старте боя
 * - Игрок может находиться только в одном активном бою одновременно
 * - Соло и массовый бой — разные режимы
 */

const express = require('express');
const router = express.Router();
// transaction() вместо ручного pool.connect()/BEGIN/COMMIT/ROLLBACK в
// маршрутах с записью: см. пояснение в POST /bosses/start. withClient()
// для чтений, которым транзакция не нужна — удобнее ручного pool.connect().
const { transaction, withClient, isConnectionError } = require('../../db/database');
const { safeJsonParse, PlayerHelper: playerHelper, handleError, logger, unauthorized, logPlayerAction } = require('../../utils/serverApi');

// Ленивая загрузка helpers: utils/game-helpers.js — единственный источник
// функций состояния игрока. Он тянет db/database, поэтому импорт ленивый
// (иначе цикл загрузки модулей).
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../../utils/game-helpers');
    }
    return gameHelpers;
}

// Экспортируемые функции через getGameHelpers()
const helpers = getGameHelpers();
const { normalizeInventory, getActiveBuffs, createInventoryItem, addItemToInventory, equipmentRules, getSetBonuses, wearEquipmentSlots, trackCollectedItems, progressDailyTask, recalcEnergy } = helpers;
// Единый источник правды: тот же, что в world.js и items.js. Без проверки
// лимита награда за босса довела бы инвентарь больше 100 слотов.
const MAX_INVENTORY_SLOTS = require('../../public/shared/equipment.js').MAX_INVENTORY_SLOTS;
const crypto = require('crypto');

// Сколько ключей нужно, чтобы открыть бой со СЛЕДУЮЩИМ боссом.
// Владелец ключа — текущий босс: чтобы начать бой с N, нужны keys_required
// ключей от босса N-1 (этим же пользуется spendBossKeys).
// Fallback = 1: за убийство выдаётся ровно один ключ, поэтому любое большее
// значение делает боссов со второго недостижимыми навсегда.
//
// P1-6: ошибку БД здесь намеренно НЕ глушим.
//
// Было `catch { return 1; }` — и любой сбой запроса (обрыв соединения,
// таймаут, падение пула) молча превращался в «нужен 1 ключ». Последствия:
//   * spendBossKeys недосписывал ключи, если босс требует 3;
//   * raid/:id/join пускал игрока в рейд с меньшим числом ключей, чем
//     требуется для входной цепочки.
// Отсутствие строки — это НЕ ошибка (босс удалён или id = 0), fallback 1
// сохраняется. Ошибка запроса пробрасывается: роут покажет 500/503, а не
// тихо проведёт операцию по неверным данным.
async function getKeysRequiredForBoss(client, bossId) {
    const result = await client.query(
        'SELECT keys_required FROM bosses WHERE id = $1',
        [bossId]
    );
    return Math.max(1, Number(result.rows[0]?.keys_required) || 1);
}
const SOLO_FIGHT_DURATION_MS = 8 * 60 * 60 * 1000;
const MASS_FIGHT_DURATION_MS = 8 * 60 * 60 * 1000;
const DAMAGE_PER_KILL = 0.1;
const KILL_DECAY_FACTOR = 0.1;

const BOSS_BASE_DAMAGE = 3;
const BOSS_DAMAGE_PER_LEVEL = 2;

/** Сколько событий боя рейда храним в raid_progress.raid_log */
const RAID_LOG_MAX_EVENTS = 20;

/** Бонус к доле награды за первый удар по рейдовому боссу (+5%) */
const RAID_FIRST_HIT_BONUS = 0.05;

/** Бонус к доле награды за смертельный удар в рейде (+5%) */
const RAID_LAST_HIT_BONUS = 0.05;

/**
 * Длительность вроде «8 ч» или «8 ч 30 мин» для подсказок в info.
 * Без форматтера часы приходилось вписывать в текст руками, и подсказка
 * расходилась с SOLO_FIGHT_DURATION_MS при смене баланса.
 */
function formatDuration(ms) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 0 && minutes > 0) return `${hours} ч ${minutes} мин`;
    if (hours > 0) return `${hours} ч`;
    return `${minutes} мин`;
}


function validateBossId(bossId) {
    return Number.isInteger(bossId) && bossId > 0;
}

function calculateDamageBonus(bossId, masteries) {
    const masteryMap = {};
    for (const mastery of masteries) {
        masteryMap[mastery.boss_id] = mastery.kills;
    }

    let killBonus = 0;

    for (let i = 1; i < bossId; i++) {
        const kills = masteryMap[i] || 0;
        const distance = bossId - i;
        const multiplier = Math.pow(KILL_DECAY_FACTOR, distance);
        killBonus += kills * DAMAGE_PER_KILL * multiplier;
    }

    const currentKills = masteryMap[bossId] || 0;
    killBonus += currentKills * DAMAGE_PER_KILL;

    return Math.floor(killBonus);
}

/**
 * Урон бойца по боссу.
 *
 * Единственный путь атаки — кнопка «Атаковать» -> POST /attack-boss,
 * урон считается только здесь. Бонус оружия за ближний бой и разброс
 * (stats.variance) берутся из equipmentRules — того же модуля, что
 * использует PvP, иначе дробовик давал бы случайный урон в PvP и
 * детерминированный против боссов.
 *
 * @param {number} bossId босс, по которому бьём (нужен для мастерства)
 * @param {object} player строка players (equipment, level)
 * @param {Array} masteries boss_mastery игрока
 * @param {object} setBonuses бонусы надетых сетов
 * @returns {number} итоговый урон
 */
function calculateDamage(bossId, player, masteries = [], setBonuses = {}) {
    const equipment = safeJsonParse(player.equipment, {});

    // Урон оружия с учётом прочности и улучшений: сломанный нож даёт 0,
    // улучшенный снайпер — на +80% к базовому урону.
    const weaponDamage = equipmentRules.getWeaponDamageForContext(
        equipment.weapon,
        equipmentRules.WEAPON_CONTEXTS.BOSS
    );
    const setDamage = Number(setBonuses.damage || 0);
    const killBonus = calculateDamageBonus(bossId, masteries);
    // Усиливаем базовую прогрессию, чтобы ранние боссы не были чрезмерно затянутыми.
    const levelDamage = Math.max(1, Number(player.level || 1));
    const baseDamage = BOSS_BASE_DAMAGE + (levelDamage * BOSS_DAMAGE_PER_LEVEL);
    return Math.floor(baseDamage + killBonus + setDamage + weaponDamage);
}

/**
 * Урон, который босс наносит игроку в ответ на удар.
 *
 * Было: процент от max_health игрока. Из-за этого качать здоровье было
 * бессмысленно — урон рос ровно настолько же, на сколько рос запас HP,
 * и число survivable-ударов не менялось. Плюс весь урон боссов укладывался
 * в 2–10 единиц, где 20% брони неотличимы от нуля.
 *
 * Стало: две независимые величины.
 *
 *   peak  = BOSS_COUNTER_BASE + bosses.level * BOSS_COUNTER_PER_LEVEL
 *           пиковая сила удара босса — поздние боссы бьют больнее;
 *   ratio = current_health / max_health
 *           доля ОСТАВШЕГОСЯ здоровья. Чем сильнее босс побит, тем слабее
 *           бьёт он: добивание безопаснее начала боя.
 *
 *   raw   = round(peak * ratio)   ->  у почти мёртвого босса выходит 0
 *
 * Защита = экипировка + 3 за каждый новый уровень игрока.
 *
 * @param {object} boss строка bosses (нужны level, max_health)
 * @param {number} maxHealth максимальное здоровье игрока (не используется,
 *        оставлено для совместимости вызовов)
 * @param {object} equipment экипировка игрока
 * @param {Object} [options]
 * @param {number} [options.currentHealth] текущее HP босса; без него берётся
 *        полное (нужно для карточки боя до первого удара)
 * @param {number} [options.playerLevel] уровень игрока — даёт защиту
 * @returns {number} урон (может быть 0)
 */
function calculateBossCounterDamage(boss, maxHealth, equipment, options = {}) {
    const { currentHealth, playerLevel } = options;

    const bossLevel = Math.max(1, Math.floor(Number(boss && boss.level) || 1));
    const bossMaxHealth = Math.max(1, Number(boss && boss.max_health) || 1);

    // Пиковая сила удара: поздние боссы сильнее.
    const peak = BOSS_COUNTER_BASE + bossLevel * BOSS_COUNTER_PER_LEVEL;

    // Доля оставшегося здоровья. Без указания текущего HP считаем босс целым
    // (карточка боя показывает худший случай).
    const hasCurrent = Number.isFinite(Number(currentHealth));
    const ratio = hasCurrent
        ? Math.max(0, Math.min(1, Number(currentHealth) / bossMaxHealth))
        : 1;

    const raw = Math.round(peak * ratio);
    // Почти мёртвый босс не бьёт ВООБЩЕ. Проверка до applyDefenseReduction,
    // потому что броня здесь бессильна — бить уже нечем.
    if (raw <= 0) return 0;

    const equipmentDefense = equipmentRules.calculateDefenseTotal(equipment || {});
    const levelDefense = equipmentRules.calculateLevelDefense(playerLevel);
    const defense = equipmentDefense + levelDefense;

    return equipmentRules.applyDefenseReduction(raw, defense);
}

/** Базовая сила ответного удара босса */
const BOSS_COUNTER_BASE = 3;

/** Прибавка силы удара за каждый уровень босса */
const BOSS_COUNTER_PER_LEVEL = 3;

function getNextBossId(bossId) {
    return bossId + 1;
}

function normalizeRewardItems(rawRewardItems) {
    const parsed = safeJsonParse(rawRewardItems, []);
    return Array.isArray(parsed) ? parsed : [];
}

function calculateGrantedQuantity(totalQuantity, multiplier = 1) {
    const expectedQuantity = Math.max(0, Number(totalQuantity || 0) * Number(multiplier || 0));
    const guaranteedQuantity = Math.floor(expectedQuantity);
    const fractionalPart = expectedQuantity - guaranteedQuantity;

    return guaranteedQuantity + (crypto.randomInt(10000) / 10000 < fractionalPart ? 1 : 0);
}

/**
 * Слоты экипировки, которые получают износ от ответного удара босса.
 *
 * Босс бьёт в ответ на ЛЮБУЮ атаку игрока, поэтому изнашивается всё
 * надетое снаряжение, включая оружие в руках.
 *
 * Список берём из канона COMBAT_SLOTS, а не пишем руками: ручная копия
 * отстала от канона ровно один раз (в ней оставался удалённый слот 'head'
 * и не было 'face'), и износ по маскам/противогазам просто не начислялся.
 */
const COUNTER_HIT_WEAR_SLOTS = equipmentRules.COMBAT_SLOTS;

/**
 * Ответный удар босса: урон игроку + износ экипировки.
 *
 * Внутри транзакции. Возвращает фактический урон, остаток здоровья и слоты,
 * где снаряжение сломалось (клиенту нужно показать предупреждение).
 *
 * @param {object} client клиент БД (транзакция)
 * @param {number} playerId
 * @param {object} boss строка bosses
 * @param {object} player текущее состояние игрока
 * @param {number} [bossCurrentHp] текущее HP босса. Без него босс считается
 *        целым и бьёт на полную силу.
 */
async function applyBossCounterHit(client, playerId, boss, player, bossCurrentHp) {
    const equipment = safeJsonParse(player.equipment, {});
    const damage = calculateBossCounterDamage(boss, player.max_health, equipment, {
        currentHealth: bossCurrentHp,
        playerLevel: player.level
    });
    if (damage <= 0) {
        // Почти добитый босс не бьёт — но износ СНАРЯЖЕНИЯ всё равно идёт:
        // игрок продолжал махать оружием, работа шла. Иначе добивание
        // становилось бы бесконечным и бесплатным по прочности.
        const brokenSlots = wearEquipmentSlots(
            client,
            playerId,
            equipment,
            COUNTER_HIT_WEAR_SLOTS
        );
        await client.query(
            'UPDATE players SET equipment = $1::jsonb WHERE id = $2',
            [JSON.stringify(equipment), playerId]
        );
        return { damage: 0, health: Number(player.health || 0), broken_slots: brokenSlots };
    }

    const health = Math.max(0, Number(player.health || 0) - damage);
    const brokenSlots = wearEquipmentSlots(
        client,
        playerId,
        equipment,
        COUNTER_HIT_WEAR_SLOTS
    );

    // Урон и износ фиксируем одним UPDATE: здоровье после ответного удара
    // и снаряжение должны соблюдаться вместе, иначе в БД остаётся урон
    // без износа (или наоборот).
    await client.query(
        `UPDATE players
            SET health = $1,
                equipment = $2::jsonb
          WHERE id = $3`,
        [health, JSON.stringify(equipment), playerId]
    );

    // Автолечение убрано: лекарства расходуются ТОЛЬКО вручную, с панели
    // лечения на главном экране. Раньше здесь вызывался applyAutoHeal,
    // который сам списывал аптечку — пришлось убирать, чтобы расход
    // лекарства зависел только от решения игрока.
    return {
        damage,
        health,
        broken_slots: brokenSlots,
    };
}

async function getBossById(client, bossId) {
    const result = await client.query('SELECT * FROM bosses WHERE id = $1', [bossId]);
    return result.rows[0] || null;
}

async function getPlayerBaseState(client, playerId) {
    // Настройки автолечения убраны из SELECT: колонки players.*auto_heal*
    // больше не читаются ни одним роутом после удаления автоиспользования
    // лекарств. Лекарства расходуются только вручную.
    const result = await client.query(
        `SELECT id, first_name, level, health, max_health, energy, max_energy, equipment,
                inventory, active_boss_id, active_boss_started_at, active_boss_mode,
                active_raid_id, buffs
         FROM players
         WHERE id = $1
         FOR UPDATE`,
        [playerId]
    );

    return result.rows[0] || null;
}

async function clearPlayerActiveBattle(client, playerId) {
    await client.query(
        `UPDATE players
         SET active_boss_id = NULL,
             active_boss_started_at = NULL,
             active_boss_mode = NULL,
             active_raid_id = NULL
         WHERE id = $1`,
        [playerId]
    );
}

async function clearActiveBattleForPlayers(client, playerIds) {
    if (!playerIds.length) return;

    await client.query(
        `UPDATE players
         SET active_boss_id = NULL,
             active_boss_started_at = NULL,
             active_boss_mode = NULL,
             active_raid_id = NULL
         WHERE id = ANY($1::bigint[])`,
        [playerIds]
    );
}

async function resolveActiveBattle(client, playerId) {
    const player = await getPlayerBaseState(client, playerId);
    if (!player || !player.active_boss_mode) {
        return null;
    }

    if (player.active_boss_mode === 'solo') {
        if (!player.active_boss_started_at || !player.active_boss_id) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const startedAt = new Date(player.active_boss_started_at).getTime();
        const timePassed = Date.now() - startedAt;
        if (timePassed >= SOLO_FIGHT_DURATION_MS) {
            await client.query('DELETE FROM player_boss_progress WHERE player_id = $1', [playerId]);
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const result = await client.query(
            `SELECT b.id, b.name, b.icon, b.max_health, b.reward_coins, b.reward_experience,
                    pbp.current_hp, pbp.max_hp, pbp.started_at
             FROM bosses b
             JOIN player_boss_progress pbp ON pbp.boss_id = b.id AND pbp.player_id = $1
             WHERE b.id = $2`,
            [playerId, player.active_boss_id]
        );

        const boss = result.rows[0];
        if (!boss) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        return {
            type: 'solo',
            boss_id: boss.id,
            started_at: player.active_boss_started_at,
            time_remaining_ms: SOLO_FIGHT_DURATION_MS - timePassed,
            boss: {
                id: boss.id,
                name: boss.name,
                icon: boss.icon,
                hp: boss.current_hp,
                max_hp: boss.max_hp,
                reward_coins: boss.reward_coins,
                reward_experience: boss.reward_experience
            }
        };
    }

    if (player.active_boss_mode === 'mass') {
        if (!player.active_raid_id) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const raidResult = await client.query(
            `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                    b.name, b.icon, b.reward_coins, b.reward_experience
             FROM raid_progress rp
             JOIN bosses b ON b.id = rp.boss_id
             WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()`,
            [player.active_raid_id]
        );

        const raid = raidResult.rows[0];
        if (!raid) {
            await client.query('DELETE FROM boss_sessions WHERE player_id = $1 AND raid_id = $2', [playerId, player.active_raid_id]);
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        return {
            type: 'mass',
            raid_id: raid.id,
            boss_id: raid.boss_id,
            started_at: player.active_boss_started_at,
            time_remaining_ms: new Date(raid.expires_at).getTime() - Date.now(),
            boss: {
                id: raid.boss_id,
                name: raid.name,
                icon: raid.icon,
                hp: raid.current_health,
                max_hp: raid.max_health,
                reward_coins: raid.reward_coins,
                reward_experience: raid.reward_experience
            }
        };
    }

    await clearPlayerActiveBattle(client, playerId);
    return null;
}

async function getBossMasteries(client, playerId) {
    const result = await client.query('SELECT boss_id, kills FROM boss_mastery WHERE player_id = $1', [playerId]);
    return result.rows;
}

async function getPlayerKeyCount(client, playerId, previousBossId, forUpdate = false) {
    if (previousBossId <= 0) return 0;

    const lock = forUpdate ? ' FOR UPDATE' : '';
    const result = await client.query(
        `SELECT quantity FROM boss_keys WHERE player_id = $1 AND boss_id = $2${lock}`,
        [playerId, previousBossId]
    );

    return result.rows[0]?.quantity || 0;
}

/**
 * Списать ключи за открытие боя с боссом.
 *
 * Возвращает ФАКТИЧЕСКИ списанное число. Раньше вызывающий код узнавал его
 * повторным запросом к bosses.keys_required уже после COMMIT: значение могло
 * разойтись со списанным, а сбой этого запроса приводил к ошибке уже после
 * того, как бой начался и ключи списаны.
 *
 * @returns {Promise<number>} сколько ключей списано (0 — первый босс)
 */
async function spendBossKeys(client, playerId, previousBossId) {
    if (previousBossId <= 0) return 0;

    const keysRequired = await getKeysRequiredForBoss(client, previousBossId);
    // Блокируем строку ключей для предотвращения race condition
    const nowOwned = await getPlayerKeyCount(client, playerId, previousBossId, true);
    if (nowOwned < keysRequired) {
        throw {
            message: `Нужно ${keysRequired} ключей от босса ${previousBossId}`,
            code: 'INSUFFICIENT_KEYS',
            statusCode: 400,
            keys_owned: nowOwned,
            keys_required: keysRequired
        };
    }

    const updateResult = await client.query(
        `UPDATE boss_keys
         SET quantity = quantity - $1
         WHERE player_id = $2 AND boss_id = $3 AND quantity >= $1`,
        [keysRequired, playerId, previousBossId]
    );
    if (updateResult.rowCount === 0) {
        throw {
            message: `Недостаточно ключей от босса ${previousBossId}`,
            code: 'INSUFFICIENT_KEYS',
            statusCode: 400,
            keys_owned: await getPlayerKeyCount(client, playerId, previousBossId),
            keys_required: keysRequired
        };
    }

    return keysRequired;
}

/**
 * Ключи, выдаваемые за убийство босса.
 *
 * Смысл колонки boss_keys.boss_id: это id босса, ЧЕЙ ключ у игрока (ключ
 * выпадает с этого босса и открывает бой со следующим). Такая трактовка
 * согласована со spendBossKeys(): чтобы начать бой с N, нужны keys_required
 * ключей от босса N-1.
 *
 * @returns {Promise<object|null>} описание выданного ключа или null
 */
async function grantNextBossKey(client, playerId, bossId) {
    const nextBossId = getNextBossId(bossId);
    const nextBoss = await getBossById(client, nextBossId);
    if (!nextBoss) return null; // последний босс: ключ вести некуда

    // Сколько ключей нужно на следующий бой — столько и выдаём, чтобы одна
    // победа гарантированно открывала следующую ступень.
    const quantity = await getKeysRequiredForBoss(client, bossId);

    await client.query(
        `INSERT INTO boss_keys (player_id, boss_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (player_id, boss_id)
         DO UPDATE SET quantity = boss_keys.quantity + EXCLUDED.quantity`,
        [playerId, bossId, quantity]
    );

    return {
        boss_id: bossId,
        quantity,
        unlocks_boss_id: nextBossId,
        boss_name: nextBoss.name
    };
}

async function loadItemTemplates(client, rewardItems) {
    const ids = rewardItems.map(r => r.item_id || r.id).filter(Boolean);
    const templates = [];
    let itemMap = {};

    if (ids.length) {
        const result = await client.query(
            `SELECT id, name, type, category, rarity, icon, slot, durability, stats,
                    COALESCE((stats->>'damage')::integer, 0) AS damage,
                    COALESCE((stats->>'defense')::integer, 0) AS defense
             FROM items WHERE id = ANY($1::int[])`,
            [ids]
        );
        itemMap = {};
        for (const r of result.rows) {
            itemMap[r.id] = r; // числовые ключи для точного поиска
        }
    }

    for (const reward of rewardItems) {
        if (reward.item_id || reward.id) {
            const itemId = reward.item_id || reward.id;
            const item = itemMap[itemId];
            if (item) {
                templates.push(createInventoryItem(item, {
                    quantity: Number(reward.quantity || 1)
                }));
            }
        } else if (reward.name && reward.type) {
            templates.push(createInventoryItem(reward, {
                quantity: Number(reward.quantity || 1)
            }));
        }
    }

    return templates;
}

/**
 * Выдать предметы-награды игроку.
 *
 * @param {object} client - клиент транзакции
 * @param {number} playerId - кому
 * @param {Array} rewardItems - наградные предметы ({item_id|name} + quantity)
 * @param {number} multiplier - множитель количества
 * @param {Array|null} preloadedTemplates - заранее загруженные шаблоны.
 *   Нужны при пакетной выдаче (рейд): reward_items у рейда одни на всех,
 *   а loadItemTemplates делает запрос к items — на каждого участника
 *   это был N+1. Вызывающая сторона грузит шаблоны один раз и передаёт.
 */
async function grantRewardItems(client, playerId, rewardItems, multiplier = 1, preloadedTemplates = null) {
    const normalizedItems = normalizeRewardItems(rewardItems);
    if (!normalizedItems.length || multiplier <= 0) return [];

    const templates = preloadedTemplates || await loadItemTemplates(client, normalizedItems);
    if (!templates.length) return [];

    const playerResult = await client.query('SELECT inventory FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    const inventory = normalizeInventory(playerResult.rows[0]?.inventory);
    const granted = [];
    let totalGrantedCount = 0;

    for (const template of templates) {
        const totalQuantity = Math.max(1, template.quantity || 1);
        const grantedQuantity = calculateGrantedQuantity(totalQuantity, multiplier);

        if (grantedQuantity <= 0) continue;

        // Реально выданное количество: бафф loot_x2 мог дать больше, чем
        // помещается в инвентарь, и разница просто не выдаётся.
        let actuallyGranted = 0;

        // Итерация нужна ради стакования и проверки лимита: без них награда за
        // босса довела бы инвентарь до 200+ слотов в обход лимита 100.
        for (let i = 0; i < grantedQuantity; i++) {
            if (inventory.length >= MAX_INVENTORY_SLOTS) break;

            const item = createInventoryItem(template, {
                quantity: 1,
                upgrade_level: 0,
                modifications: {}
            });

            // Стакуем, если предмет для этого пригоден: стопка аптечек
            // не должна занимать по отдельному слоту каждую.
            const slotsAdded = addItemToInventory(inventory, item, template);
            if (slotsAdded > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                // Новый слот уже создан сверх лимита — откатываем его.
                inventory.pop();
                break;
            }
            actuallyGranted++;
        }

        if (actuallyGranted === 0) {
            logger.warn('Награда за босса не выдана: инвентарь заполнен', {
                playerId,
                slots: inventory.length,
                maxSlots: MAX_INVENTORY_SLOTS
            });
            continue;
        }
        if (actuallyGranted < grantedQuantity) {
            logger.warn('Награда за босса обрезана по лимиту инвентаря', {
                playerId,
                wanted: grantedQuantity,
                granted: actuallyGranted,
                maxSlots: MAX_INVENTORY_SLOTS
            });
        }

        granted.push({
            id: template.id,
            name: template.name,
            icon: template.icon || '📦',
            quantity: actuallyGranted
        });
        totalGrantedCount += actuallyGranted;
    }

    if (granted.length) {
        await client.query(
            `UPDATE players
             SET inventory = $1,
                 items_collected = COALESCE(items_collected, 0) + $2
             WHERE id = $3`,
            [JSON.stringify(inventory), totalGrantedCount, playerId]
        );
    }

    return granted;
}

async function handleSoloBossKill(client, playerId, bossId, activeBuffs, masteries) {
    const boss = await getBossById(client, bossId);
    const experienceReward = activeBuffs.exp_x2
        ? (boss.reward_experience || 0) * 2
        : (boss.reward_experience || 0);
    const lootMultiplier = activeBuffs.loot_x2 ? 2 : 1;

    const rewards = { coins: boss.reward_coins || 0, experience: experienceReward };

    if (rewards.coins > 0)
        await client.query('UPDATE players SET coins = coins + $1 WHERE id = $2', [rewards.coins, playerId]);
    if (experienceReward > 0)
        await playerHelper.addExperience(playerId, experienceReward, client);

    const grantedKey = await grantNextBossKey(client, playerId, bossId);
    if (grantedKey) rewards.key = grantedKey;

    // Множитель 1, а не 0.5: каждый предмет из reward_items выдавался с шансом
    // 50% (calculateGrantedQuantity), из-за чего обещанная награда за босса
    // терялась половину раз. Бафф loot_x2 удваивает количество.
    const grantedItems = await grantRewardItems(client, playerId, boss.reward_items, lootMultiplier);
    if (grantedItems.length) rewards.items = grantedItems;

    await client.query(
        `INSERT INTO boss_mastery (player_id, boss_id, kills, last_killed_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (player_id, boss_id)
         DO UPDATE SET kills = boss_mastery.kills + 1, last_killed_at = NOW()`,
        [playerId, bossId]
    );

    await client.query('UPDATE players SET bosses_killed = COALESCE(bosses_killed, 0) + 1 WHERE id = $1', [playerId]);
    await client.query('DELETE FROM player_boss_progress WHERE player_id = $1 AND boss_id = $2', [playerId, bossId]);
    await clearPlayerActiveBattle(client, playerId);

    // Достижения «Коллекционер»/«Хранитель» считают уникальные предметы:
    // регистрируем выданные награды, иначе прогресс не учитывал лут с боссов.
    const grantedIds = grantedItems.map((entry) => entry.id).filter(Boolean);
    if (grantedIds.length > 0) {
        await trackCollectedItems(client, playerId, grantedIds);
    }

    const kills = (masteries.find(m => m.boss_id === bossId)?.kills || 0) + 1;
    return { rewards, mastery: kills };
}

/**
 * Записать событие в лог боя рейда.
 *
 * Вызывается ВНУТРИ транзакции атаки: строку raid_progress она уже
 * заперла SELECT ... FOR UPDATE, поэтому read-modify-write без повторной
 * блокировки безопасен — параллельные атаки выстроятся в очередь.
 *
 * Лог заведён ради информации: участник должен видеть, кто и сколько
 * снял, а не только собственные удары. Старые события обрезаются, чтобы
 * JSONB не рос бесконечно.
 *
 * @param {object} client клиент БД (транзакция)
 * @param {number} raidId
 * @param {object} event произвольный JSON-объект события
 */
async function appendRaidLog(client, raidId, event) {
    // Без колонки (старая БД, где ALTER не применялся) рейд продолжает
    // работать — лог просто не пишется.
    let rows = [];
    try {
        const result = await client.query(
            'SELECT raid_log FROM raid_progress WHERE id = $1',
            [raidId]
        );
        rows = result.rows || [];
    } catch (error) {
        if (error && error.code === '42703') return; // колонки raid_log нет
        throw error;
    }

    const raw = rows[0]?.raid_log;
    const current = Array.isArray(raw)
        ? raw
        : safeJsonParse(raw, []);
    const next = [...current.slice(-(RAID_LOG_MAX_EVENTS - 1)), event];

    try {
        await client.query(
            'UPDATE raid_progress SET raid_log = $1::jsonb WHERE id = $2',
            [JSON.stringify(next), raidId]
        );
    } catch (error) {
        if (error && error.code === '42703') return; // колонки raid_log нет
        throw error;
    }
}

/**
 * Активные рейды с полной картиной боя.
 *
 * Раньше список отдавал только «сколько участников»: игрок не видел ни
 * свой вклад, ни урон других, ни примерные награды. Все доп. поля
 * считаются из тех же boss_sessions (источник урона) одним запросом,
 * без N+1.
 */
async function getActiveRaids(client, playerId) {
    const raidsResult = await client.query(
        `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                rp.leader_id, rp.leader_name,
                b.name AS boss_name, b.icon, b.description AS boss_description,
                b.reward_coins, b.reward_experience,
                COALESCE(rp.raid_log, '[]'::jsonb) AS raid_log,
                (SELECT COUNT(*) FROM boss_sessions WHERE raid_id = rp.id) AS participants_count
         FROM raid_progress rp
         JOIN bosses b ON b.id = rp.boss_id
         WHERE rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()
         ORDER BY rp.started_at DESC`,
        []
    );

    const participatingResult = await client.query(
        `SELECT bs.raid_id, bs.boss_id
          FROM boss_sessions bs
          JOIN raid_progress rp ON rp.id = bs.raid_id
          WHERE bs.player_id = $1
            AND bs.raid_id IS NOT NULL
            AND rp.is_active = true
            AND rp.is_raid = true
            AND rp.expires_at > NOW()`,
        [playerId]
    );

    const participatingIds = [...new Set(participatingResult.rows.map((row) => Number(row.raid_id)).filter(Boolean))];
    const participatingBossIds = [...new Set(participatingResult.rows.map((row) => Number(row.boss_id)).filter(Boolean))];

    // Урон всех участников активных рейдов одним запросом: по нему строим
    // вклад каждого, топ-5 и примерные награды. Имена берём тем же
    // запросом (LEFT JOIN), иначе на каждого участника уходил бы свой SELECT.
    const activeRaidIds = raidsResult.rows.map((row) => Number(row.id));
    const sessionsByRaid = new Map();
    if (activeRaidIds.length > 0) {
        const sessionsResult = await client.query(
            `SELECT bs.raid_id, bs.player_id, bs.damage_dealt, p.first_name AS player_name
               FROM boss_sessions bs
               LEFT JOIN players p ON p.id = bs.player_id
              WHERE bs.raid_id = ANY($1::int[])`,
            [activeRaidIds]
        );

        for (const row of sessionsResult.rows) {
            const raidId = Number(row.raid_id);
            if (!sessionsByRaid.has(raidId)) sessionsByRaid.set(raidId, []);
            sessionsByRaid.get(raidId).push({
                player_id: Number(row.player_id),
                player_name: row.player_name || 'Игрок',
                damage_dealt: Math.max(0, Number(row.damage_dealt || 0))
            });
        }
    }

    return {
        raids: raidsResult.rows.map((raid) => {
            const raidId = Number(raid.id);
            const participants = [...(sessionsByRaid.get(raidId) || [])]
                .sort((a, b) => b.damage_dealt - a.damage_dealt);

            const coinsPool = Number(raid.reward_coins || 0);
            const expPool = Number(raid.reward_experience || 0);
            const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);
            // Участник с нулевым уроном долю не получает: без деления на
            // ноль его «вклад» дал бы NaN в проценты.
            const myEntry = participants.find((p) => p.player_id === Number(playerId)) || null;
            const myDamage = myEntry ? myEntry.damage_dealt : 0;
            const myShare = (myDamage > 0 && totalDamage > 0) ? myDamage / totalDamage : 0;

            // Бонусы первого/последнего удара (+5% каждый) и остаток
            // округления в интерфейсе не показываем: «примерно» — честнее
            // точной цифры, которая после kill слегка изменится.
            const topDamagers = participants
                .filter((p) => p.damage_dealt > 0)
                .slice(0, 5)
                .map((p) => ({
                    player_id: p.player_id,
                    player_name: p.player_name,
                    damage_dealt: p.damage_dealt,
                    damage_pct: totalDamage > 0 ? Math.round((p.damage_dealt / totalDamage) * 100) : 0
                }));

            const raidLog = Array.isArray(raid.raid_log) ? raid.raid_log : safeJsonParse(raid.raid_log, []);

            return {
                id: raid.id,
                boss: {
                    id: raid.boss_id,
                    name: raid.boss_name,
                    icon: raid.icon,
                    description: raid.boss_description
                },
                hp: raid.current_health,
                max_hp: raid.max_health,
                hp_percent: raid.max_health > 0 ? Math.round((raid.current_health / raid.max_health) * 100) : 0,
                // Сколько урона нанесено ВСЕГО (по факту ударов, а не по
                // формуле max-current): прогресс боя должен совпадать с
                // тем, что видно в логе.
                total_damage: totalDamage,
                damage_remaining: Math.max(0, Number(raid.current_health || 0)),
                leader: {
                    id: raid.leader_id,
                    name: raid.leader_name
                },
                participants_count: Number(raid.participants_count || 0),
                // Из общего числа участников реально бьющих — остальные
                // «висят» без урона и долю не получают.
                attackers_count: participants.filter((p) => p.damage_dealt > 0).length,
                // Личный вклад. До первого удара — нули, всё ещё лучше,
                // чем молчание.
                your_damage: myDamage,
                your_damage_pct: myShare > 0 ? Math.round(myShare * 100) : 0,
                top_damagers: topDamagers,
                expected_coins: myShare > 0 ? Math.floor(coinsPool * myShare) : 0,
                expected_experience: myShare > 0 ? Math.floor(expPool * myShare) : 0,
                raid_log: Array.isArray(raidLog) ? raidLog : [],
                expires_at: raid.expires_at,
                time_remaining_ms: new Date(raid.expires_at).getTime() - Date.now()
            };
        }),
        participatingIds,
        participatingBossIds
    };
}

async function validateSoloAttack(client, playerId, bossId) {
    const activeBattle = await resolveActiveBattle(client, playerId);
    if (!activeBattle || activeBattle.type !== 'solo' || activeBattle.boss_id !== bossId) {
        return { error: { success: false, error: 'Сначала начните соло-бой с этим боссом', code: 'BOSS_NOT_STARTED' }, status: 400 };
    }

    const player = await getPlayerBaseState(client, playerId);
    if (!player) {
        return { error: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' }, status: 404 };
    }

    // Регенерация энергии от реально прошедшего времени — тем же вызовом,
    // что в world.js:299 и pvp.js:338/481.
    //
    // ЗДЕСЬ БЫЛ БАГ: без recalcEnergy энергия в боссовом контуре только
    // тратилась (GREATEST(0, energy - 1)) и никогда не начислялась. Игрок,
    // воющий ТОЛЬКО с боссами, не восстановит энергию никогда — после
    // исчерпания залипает на «Недостаточно энергии» до поиска в мире.
    // recalcEnergy двигает last_energy_update ровно на восстановленное
    // время, так что проверка ниже видит уже реальное значение.
    await recalcEnergy(client, player);

    const activeBuffs = getActiveBuffs(player.buffs);

    if (!activeBuffs.free_energy && player.energy < 1) {
        return { error: { success: false, error: 'Недостаточно энергии', code: 'INSUFFICIENT_ENERGY' }, status: 400 };
    }
    if (player.health <= 0) {
        return { error: { success: false, error: 'Вы мертвы', code: 'PLAYER_DEAD' }, status: 400 };
    }

    const masteries = await getBossMasteries(client, playerId);
    return { activeBattle, player, activeBuffs, masteries };
}

function buildAlreadyInFightResponse(activeBattle) {
    return {
        success: false,
        error: 'У вас уже есть активный бой',
        code: 'ALREADY_IN_FIGHT',
        active_battle: activeBattle
    };
}

/**
 * Ответ на ошибку ПОДКЛЮЧЕНИЯ к базе (502), а не сбой запроса (500).
 *
 * Раньше каждый маршрут брал соединение из пула отдельным try и сам
 * отдавал 502 «Ошибка подключения к базе данных». После перевода на
 * transaction() этих try не осталось, и недоступность базы стала
 * выглядеть как обычная внутренняя ошибка.
 *
 * @param {object} res ответ express
 * @param {*} error ошибка
 * @returns {boolean} true, если ответ отправлен (ошибка — про соединение)
 */
function handleConnectionError(res, error) {
    if (!isConnectionError(error)) return false;

    logger.error('[bosses] Ошибка подключения к БД', error);
    res.status(502).json({ success: false, error: 'Ошибка подключения к базе данных' });
    return true;
}

router.post('/start', async (req, res) => {
    logger.info('[bosses/start] Начало запроса', { playerId: req.player?.id, body: req.body });

    // Валидация вынесена ДО открытия транзакции. Раньше соединение бралось
    // из пула первым делом, и при отказе на проверках оно всё равно
    // освобождалось в finally — но занималось на время проверок впустую.
    if (!req.player || !req.player.id) {
        return unauthorized(res, 'Не авторизован');
    }
    const bossId = Number(req.body?.boss_id);
    const playerId = req.player.id;
    logger.info('[bosses/start] Валидация данных', { bossId, playerId });

    if (!validateBossId(bossId)) {
        return res.status(400).json({ success: false, error: 'Укажите корректный ID босса', code: 'INVALID_BOSS_ID' });
    }

    try {
        // Раньше здесь был вложенный try с собственным ROLLBACK. Из-за него
        // ошибка spendBossKeys доходила до внешнего catch и превращалась в
        // 500 вместо 400 с кодом INSUFFICIENT_KEYS. Теперь тело транзакции
        // просто бросает исходную ошибку, а разбор кодов один — в catch.
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                if (activeBattle.type === 'solo' && activeBattle.boss_id === bossId) {
                    // Прежний код делал здесь COMMIT, а не ROLLBACK: в ветке
                    // ничего не записывалось, но выход с COMMIT сохраняем,
                    // чтобы поведение не изменилось незаметно.
                    return {
                        status: 200,
                        body: {
                            success: true,
                            data: {
                                mode: 'solo',
                                resumed: true,
                                boss: activeBattle.boss,
                                time_remaining_ms: activeBattle.time_remaining_ms
                            }
                        }
                    };
                }

                return {
                    status: 400,
                    body: buildAlreadyInFightResponse(activeBattle)
                };
            }

            const boss = await getBossById(client, bossId);
            if (!boss) {
                return {
                    status: 404,
                    body: { success: false, error: 'Босс не найден', code: 'BOSS_NOT_FOUND' }
                };
            }

            const player = await getPlayerBaseState(client, playerId);
            if (!player || player.health <= 0) {
                return {
                    status: 400,
                    body: { success: false, error: 'Вы мертвы. Нельзя начать бой с боссом.', code: 'PLAYER_DEAD' }
                };
            }

            // Урон игрока по этому боссу — та же calculateDamage, что в
            // /attack-boss и в списке боссов. Считаем на старте, чтобы клиент
            // показал «Ваш урон» в бою ДО первого удара: раньше число
            // появлялось только после него.
            //
            // client передаём в getSetBonuses: без него функция берёт второе
            // соединение из пула, и на время расчёта ходим с двумя
            // соединениями при FOR UPDATE на строке players.
            const masteries = await getBossMasteries(client, playerId);
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}), client);
            const currentDamage = calculateDamage(bossId, player, masteries, setBonuses);

            // Списанное число запоминаем ВНУТРИ транзакции: повторный
            // запрос к БД после COMMIT мог вернуть другое значение, а его
            // сбой приводил бы к ошибке уже начатого боя со списанными
            // ключами. transaction() возвращает это число наружу вместе с
            // остальным результатом — перечитывать базу не нужно.
            const keysSpent = bossId > 1
                ? await spendBossKeys(client, playerId, bossId - 1)
                : 0;

            await client.query(
                `INSERT INTO player_boss_progress (player_id, boss_id, current_hp, max_hp, started_at, last_attack)
                 VALUES ($1, $2, $3, $4, NOW(), NOW())
                 ON CONFLICT (player_id, boss_id)
                 DO UPDATE SET current_hp = $3, max_hp = $4, started_at = NOW(), last_attack = NOW()`,
                [playerId, bossId, boss.max_health, boss.max_health]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'solo',
                     active_raid_id = NULL
                 WHERE id = $2`,
                [bossId, playerId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        mode: 'solo',
                        keys_spent: keysSpent,
                        boss: {
                            id: boss.id,
                            name: boss.name,
                            icon: boss.icon,
                            hp: boss.max_health,
                            max_hp: boss.max_health,
                            // Текущий урон игрока по этому боссу — та же
                            // calculateDamage, что в списке боссов и в
                            // /attack-boss. Нужен, чтобы клиент показал
                            // «Ваш урон» ДО первого удара.
                            current_damage: currentDamage,
                            // Ответный удар в ЕДИНИЦАХ урона при полном HP
                            // босса — худший случай, с которым игрок
                            // столкнётся на первом ударе. Раньше тут была
                            // доля (boss.damage_percent), а сам расчёт был
                            // процентом от max_health игрока: качать HP было
                            // бессмысленно, урон рос вместе с запасом.
                            counter_damage: calculateBossCounterDamage(
                                boss,
                                player.max_health,
                                safeJsonParse(player.equipment, {}),
                                { playerLevel: player.level }
                            )
                        },
                        time_remaining_ms: SOLO_FIGHT_DURATION_MS,
                        // Длительность целиком: клиент показывает её в логе
                        // боя. Раньше поле было только в GET /bosses, и после
                        // прямого старта лог оставался без срока.
                        fight_duration_ms: SOLO_FIGHT_DURATION_MS
                    }
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        // spendBossKeys сообщает о нехватке ключей самой фикцией кода:
        // раньше её перехватывал вложенный catch и отдавал 400 с полями
        // keys_owned/keys_required. Без той проверки игрок получил бы 500
        // вместо понятного «не хватает ключей».
        if (error.code === 'INSUFFICIENT_KEYS') {
            return res.status(400).json(error);
        }
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'solo_start');
    }
});

router.get('/', async (req, res) => {
    logger.info('[bosses/get] Начало запроса', { playerId: req.player?.id });
    try {
        // transaction(), а НЕ withClient(): resolveActiveBattle чистит
        // просроченное состояние (DELETE player_boss_progress -> DELETE
        // boss_sessions -> UPDATE players ... active_boss_* = NULL), и в
        // withClient эти три шага были ТРЕМЯ авто-коммитами на read-запросе.
        // ЗДЕСЬ БЫЛ БАГ: падение на любом шаге после первого оставляло
        // players.active_boss_id указывающим на удалённые строки — игрок
        // получал «бой есть», который не resolve-ится, до следующего
        // успешного прохода.
        const outcome = await transaction(async (client) => {
            const playerId = req.player.id;
            logger.info('[bosses/get] Получение данных игрока', { playerId });
            const player = await getPlayerBaseState(client, playerId);

            // Игрок не найден в базе — отдаём 404 вместо падения на player.equipment
            // (TypeError: Cannot read properties of null -> 500).
            if (!player) {
                return {
                    status: 404,
                    body: {
                        success: false,
                        error: 'Игрок не найден',
                        code: 'PLAYER_NOT_FOUND'
                    }
                };
            }

            const activeBattle = await resolveActiveBattle(client, playerId);
            const masteries = await getBossMasteries(client, playerId);
            const masteryMap = {};
            for (const m of masteries) masteryMap[m.boss_id] = m.kills;

            const bossesResult = await client.query('SELECT * FROM bosses ORDER BY id');
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}), client);

            // Ключ выдаёт ПРЕДЫДУЩИЙ босс, поэтому требование к боссу N — это
            // keys_required босса N-1, а не самого N: иначе цифры в UI не
            // совпадут с серверной проверкой ключей при старте боя.
            const keysRequiredByBoss = new Map(
                bossesResult.rows.map((boss) => [Number(boss.id), Math.max(1, Number(boss.keys_required) || 1)])
            );

            // Получаем все ключи боссов одним запросом для устранения N+1
            const keysResult = await client.query(
                'SELECT boss_id, quantity FROM boss_keys WHERE player_id = $1',
                [playerId]
            );
            const keysMap = {};
            for (const r of keysResult.rows) keysMap[String(r.boss_id)] = r.quantity;

            const bossList = [];
            for (const boss of bossesResult.rows) {
                const keysRequired = boss.id === 1 ? 0 : (keysRequiredByBoss.get(Number(boss.id) - 1) || 1);
                const ownedKeys = boss.id === 1 ? 0 : (keysMap[String(boss.id - 1)] || 0);
                const isUnlocked = boss.id === 1 || ownedKeys >= keysRequired;
                const soloProgress = activeBattle?.type === 'solo' && activeBattle.boss_id === boss.id
                    ? activeBattle.boss.hp
                    : boss.max_health;

                bossList.push({
                    id: boss.id,
                    name: boss.name,
                    description: boss.description,
                    icon: boss.icon,
                    hp: soloProgress,
                    max_hp: boss.max_health,
                    reward_coins: boss.reward_coins,
                    reward_experience: boss.reward_experience,
                    // Ответный урон босса в ЕДИНИЦАХ при его текущем HP —
                    // UI показывает его в карточке боя. Считаем тем же
                    // calculateBossCounterDamage, что и сам ответный удар,
                    // поэтому цифра в карточке совпадает с той, что получит
                    // игрок. Вне активного боя HP = полное (худший случай).
                    counter_damage: calculateBossCounterDamage(
                        boss,
                        player.max_health,
                        safeJsonParse(player.equipment, {}),
                        { currentHealth: soloProgress, playerLevel: player.level }
                    ),
                    required_keys: keysRequired,
                    owned_keys: ownedKeys,
                    is_unlocked: isUnlocked,
                    defeated_count: masteryMap[boss.id] || 0,
                    mastery: masteryMap[boss.id] || 0,
                    current_damage: calculateDamage(boss.id, player, masteries, setBonuses),
                    can_start_solo: isUnlocked && !activeBattle,
                    can_start_mass: isUnlocked && !activeBattle
                });
            }

            const raids = await getActiveRaids(client, playerId);
            // Отложенные награды за рейды: начисляются всем участникам, но
            // увидеть их должен каждый. Без этого поля участник, бивший не
            // последним ударом, не узнавал о своей доле.
            const pendingRaidRewards = await getPendingRaidRewards(client, playerId);

            return {
                success: true,
                data: {
                    bosses: bossList,
                    raids: raids.raids,
                    participating_raid_ids: raids.participatingIds,
                    participating_boss_ids: raids.participatingBossIds,
                    pending_raid_rewards: pendingRaidRewards,
                    player_energy: player.energy,
                    player_max_energy: player.max_energy,
                    player_level: player.level,
                    active_battle: activeBattle,
                    fight_duration_ms: SOLO_FIGHT_DURATION_MS,
                    raid_duration_ms: MASS_FIGHT_DURATION_MS,
                    info: {
                        // Длительность боя подставляем из константы: раньше
                        // «8 часов» было вписано текстом, и при смене баланса
                        // подсказка врала.
                        solo: `Соло-бой: старт через кнопку, 1 удар = 1 энергия, бой длится ${formatDuration(SOLO_FIGHT_DURATION_MS)}.`,
                        mastery: 'Каждая победа над боссом увеличивает урон по нему и частично усиливает урон по следующим боссам.',
                        raids: `Массовый бой — отдельный режим на ${formatDuration(MASS_FIGHT_DURATION_MS)}. Награды и предметы делятся пропорционально урону, ключ получает только лидер.`
                    }
                }
            };
        });
        res.json(outcome);
    } catch (error) {
        if (handleConnectionError(res, error)) return;
        return handleError(res, error, 'boss_list');
    }
});

async function getPendingRaidRewards(client, playerId) {
    // FOR UPDATE:claim читает claimed=false и помечает их в той же
    // транзакции. Без блокировки два параллельных запроса читают один
    // набор pending и начисляют награду дважды (двойной тап/ретрай).
    const result = await client.query(
        `SELECT id, raid_id, boss_id, coins, experience, items, key_item_name, created_at
           FROM raid_rewards
          WHERE player_id = $1 AND claimed = false
          ORDER BY created_at ASC
          FOR UPDATE`,
        [playerId]
    );
    return result.rows.map((row) => ({
        id: row.id,
        raid_id: row.raid_id,
        boss_id: row.boss_id,
        coins: Number(row.coins || 0),
        experience: Number(row.experience || 0),
        items: Array.isArray(row.items) ? row.items : safeJsonParse(row.items, []),
        key_item_name: row.key_item_name || null
    }));
}

/**
 * Пометить награды за рейды полученными и вернуть их содержимое.
 *
 * Отдельный вызов, а не «прочитал и сам погас»: /bosses дёргается на каждое
 * открытие экрана, и если клиент упадёт между показом и погашением, игрок
 * второй раз увидит попап — это лучше, чем не увидеть вовсе.
 */
router.post('/raid/rewards/claim', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ success: false, error: 'Не авторизован', code: 'UNAUTHORIZED' });
        }

        const result = await transaction(async (client) => {
            const pending = await getPendingRaidRewards(client, playerId);
            if (pending.length === 0) return { claimed: [], rewards: [] };

            const ids = pending.map((r) => r.id);
            await client.query(
                'UPDATE raid_rewards SET claimed = true WHERE id = ANY($1::int[])',
                [ids]
            );

            return {
                claimed: ids,
                rewards: pending.map((r) => ({
                    raid_id: r.raid_id,
                    boss_id: r.boss_id,
                    coins: r.coins,
                    experience: r.experience,
                    items: r.items,
                    key_item_name: r.key_item_name
                }))
            };
        });

        await logPlayerAction(playerId, 'raid_rewards_claimed', {
            count: result.claimed.length
        });

        return res.json({ success: true, data: result });
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'raid_rewards_claim');
    }
});

router.post('/attack-boss', async (req, res) => {
    // Валидация до открытия транзакции — как в остальных маршрутах боссов.
    const bossId = Number(req.body?.boss_id);
    // P2: guard на req.player. Обычно гарантирован validatePlayer, но
    // при прямом вызове роутера req.player может отсутствовать, и роутер
    // отвечал 500 вместо 401.
    const playerId = req.player?.id;

    if (!playerId) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация', code: 'UNAUTHORIZED' });
    }

    if (!validateBossId(bossId)) {
        return res.status(400).json({ success: false, error: 'Укажите корректный ID босса', code: 'INVALID_BOSS_ID' });
    }

    try {
        const outcome = await transaction(async (client) => {
            const validation = await validateSoloAttack(client, playerId, bossId);
            if (validation.error) {
                // Статус и тело приходят из validateSoloAttack: там разные
                // отказы (нет боя, мёртв, мало энергии), и их коды нельзя
                // сваливать в одну ошибку.
                return {
                    status: validation.status,
                    body: validation.error
                };
            }

            const { activeBattle, player, activeBuffs, masteries } = validation;
            const boss = await getBossById(client, bossId);
            // client передан: внутри transaction() с FOR UPDATE на players
            // второй вызов через глобальный query() брал бы второе соединение
            // пула (max 20) — при >10 боях пул исчерпывался и писал 500.
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}), client);
            const damage = calculateDamage(bossId, player, masteries, setBonuses);
            const newHp = Math.max(0, activeBattle.boss.hp - damage);
            const energyCost = activeBuffs.free_energy ? 0 : 1;

            // Ответный удар босса и износ снаряжения.
            // activeBattle.boss.hp — текущее HP до этого удара: от него
            // зависит, насколько сильно босс бьёт в ответ.
            const counterHit = boss
                ? await applyBossCounterHit(client, playerId, boss, player, activeBattle.boss.hp)
                : { damage: 0, health: Number(player.health || 0), broken_slots: [] };

            // Ежедневное задание «Нанеси 100 урона боссам».
            await progressDailyTask(client, playerId, 'boss_damage', damage);

            // Трата энергии НЕ двигает last_energy_update: реген идёт от
            // реально прошедшего времени (то же правило, что в world.js и в
            // recalcEnergy). Иначе каждый удар обнулял бы накопленный
            // реген энергии.
            const energyResult = await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - $1)
                 WHERE id = $2
                 RETURNING energy, max_energy, last_energy_update`,
                [energyCost, playerId]
            );

            await client.query(
                `UPDATE player_boss_progress
                 SET current_hp = $1, last_attack = NOW()
                 WHERE player_id = $2 AND boss_id = $3`,
                [newHp, playerId, bossId]
            );

            let killed = false;
            let rewards = null;
            let mastery = masteries.find((m) => m.boss_id === bossId)?.kills || 0;

            if (newHp <= 0) {
                killed = true;
                const killResult = await handleSoloBossKill(client, playerId, bossId, activeBuffs, masteries);
                rewards = killResult.rewards;
                mastery = killResult.mastery;
            }

            // ОДИН плоский ответ, без вложенного data: {} — в нём раньше
            // дублировались boss/damage/rewards/mastery/energy/health.
            // После удаления второго пути атаки клиент читает только
            // верхний уровень, поэтому дупль был мёртвым весом в каждом
            // ответе удара.
            return {
                status: 200,
                body: {
                    success: true,
                    boss_hp: newHp,
                    boss_max_hp: activeBattle.boss.max_hp,
                    damage_dealt: damage,
                    boss_defeated: killed,
                    player_energy: energyResult.rows[0].energy,
                    player_max_energy: energyResult.rows[0].max_energy,
                    // Клиент строит регенерацию энергии от этой метки. Без неё
                    // он продолжит считать от устаревшей метки и покажет лишнюю.
                    last_energy_update: energyResult.rows[0].last_energy_update,
                    mastery,
                    rewards,
                    // Ответный удар босса.
                    player_damage_taken: counterHit.damage,
                    player_health: counterHit.health,
                    broken_equipment: counterHit.broken_slots,
                    // Ответный удар СЛЕДУЮЩЕГО удара — по уже уменьшенному
                    // HP босса. Без этого подпись в бою показывала бы урон от
                    // полного HP и не менялась весь бой, хотя смысл новой
                    // формулы в том, что побитый босс бьёт слабее.
                    counter_damage: calculateBossCounterDamage(
                        boss,
                        player.max_health,
                        safeJsonParse(player.equipment, {}),
                        { currentHealth: newHp, playerLevel: player.level }
                    ),
                    // Итоговая защита игрока: экипировка + 3 за уровень.
                    // Без этого рост защиты с уровнем был бы не виден —
                    // а именно на него жалуются («броня не защищает»).
                    player_defense: equipmentRules.calculateDefenseTotal(safeJsonParse(player.equipment, {}))
                        + equipmentRules.calculateLevelDefense(player.level)
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'solo_attack');
    }
});

router.get('/raids', async (req, res) => {
    try {
        const playerId = req.player?.id;
        const outcome = await withClient(async (client) => {
            const raids = await getActiveRaids(client, playerId);
            // Сюда же отдаём неполученные награды: /raids зовёт клиент после
            // каждого удара по рейду, и это единственная точка, где участник
            // узнаёт о своей доле, если добил босса не он.
            const pendingRaidRewards = playerId ? await getPendingRaidRewards(client, playerId) : [];
            return {
                success: true,
                data: {
                    raids: raids.raids,
                    participating_raid_ids: raids.participatingIds,
                    participating_boss_ids: raids.participatingBossIds,
                    pending_raid_rewards: pendingRaidRewards
                }
            };
        });
        res.json(outcome);
    } catch (error) {
        return handleError(res, error, 'raids');
    }
});

router.post('/raid/start', async (req, res) => {
    // Валидация до открытия транзакции — как в POST /bosses/start.
    const bossId = Number(req.body?.boss_id);
    const playerId = req.player.id;
    const playerName = req.player.first_name || 'Игрок';

    if (!validateBossId(bossId)) {
        return res.status(400).json({ success: false, error: 'Укажите корректный ID босса', code: 'INVALID_BOSS_ID' });
    }

    try {
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                return {
                    status: 400,
                    body: buildAlreadyInFightResponse(activeBattle)
                };
            }

            const boss = await getBossById(client, bossId);
            if (!boss) {
                return {
                    status: 404,
                    body: { success: false, error: 'Босс не найден', code: 'BOSS_NOT_FOUND' }
                };
            }

            // P1-4: сериализуем создание рейда по строке босса.
            //
            // Порядок блокировок — player (getPlayerBaseState выше) → bosses,
            // и он такой же во всех остальных роутах: ни одна транзакция не
            // берёт босса раньше игрока, поэтому взаимоблокировки не будет.
            //
            // Зачем: проверка «рейд уже идёт» (SELECT ниже) и INSERT шли без
            // блокировки, поэтому два лидера, запустившие рейд одновременно,
            // оба проходили проверку и упирались в UNIQUE(boss_id, is_active):
            // победитель получал рейд, а проигравший — 500 INTERNAL_ERROR
            // вместо внятной бизнес-ошибки RAID_ALREADY_ACTIVE.
            const player = await getPlayerBaseState(client, playerId);

            await client.query(
                'SELECT id FROM bosses WHERE id = $1 FOR UPDATE',
                [bossId]
            );
            if (!player || player.health <= 0) {
                return {
                    status: 400,
                    body: { success: false, error: 'Вы мертвы. Нельзя начать массовый бой.', code: 'PLAYER_DEAD' }
                };
            }

            await client.query(
                `DELETE FROM raid_progress
                 WHERE boss_id = $1
                   AND is_raid = true
                   AND (expires_at <= NOW() OR is_active = false)`,
                [bossId]
            );

            const existingRaid = await client.query(
                `SELECT id FROM raid_progress
                 WHERE boss_id = $1 AND is_active = true AND is_raid = true AND expires_at > NOW()`,
                [bossId]
            );

            if (existingRaid.rows.length > 0) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Массовый бой на этого босса уже идёт',
                        code: 'RAID_ALREADY_ACTIVE',
                        raid_id: existingRaid.rows[0].id
                    }
                };
            }

            // См. пояснение в POST /bosses/start: число списанных ключей
            // получается внутри транзакции и уходит в ответе вместе с ним,
            // перечитывать базу после COMMIT не нужно.
            const keysSpent = bossId > 1
                ? await spendBossKeys(client, playerId, bossId - 1)
                : 0;

            const expiresAt = new Date(Date.now() + MASS_FIGHT_DURATION_MS);

            const raidResult = await client.query(
                `INSERT INTO raid_progress
                 (boss_id, current_health, max_health, started_at, expires_at, is_active, is_raid, leader_id, leader_name)
                 VALUES ($1, $2, $3, NOW(), $4, true, true, $5, $6)
                 RETURNING id`,
                [bossId, boss.max_health, boss.max_health, expiresAt, playerId, playerName]
            );

            const raidId = raidResult.rows[0].id;

            await client.query(
                `INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                 VALUES ($1, $2, $3, 0, NOW(), NOW())
                 ON CONFLICT (boss_id, player_id)
                 DO UPDATE SET raid_id = EXCLUDED.raid_id,
                               damage_dealt = 0,
                               rewards_earned = false,
                               joined_at = NOW(),
                               last_hit_at = NOW()`,
                [bossId, playerId, raidId]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'mass',
                     active_raid_id = $2
                 WHERE id = $3`,
                [bossId, raidId, playerId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        raid_id: raidId,
                        mode: 'mass',
                        boss: {
                            id: boss.id,
                            name: boss.name,
                            icon: boss.icon,
                            hp: boss.max_health,
                            max_hp: boss.max_health
                        },
                        keys_spent: keysSpent,
                        expires_at: expiresAt,
                        time_remaining_ms: MASS_FIGHT_DURATION_MS
                    }
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        // Как в POST /bosses/start: нехватка ключей — бизнес-ошибка с 400
        // и полями keys_owned/keys_required, а не 500.
        if (error.code === 'INSUFFICIENT_KEYS') {
            return res.status(400).json(error);
        }
        // P1-4 (страховка): если UNIQUE(boss_id, is_active) сработал раньше,
        // чем блокировка босса (например, рейд создан другим путём) — отдаём
        // ту же бизнес-ошибку, а не непонятный 500 INTERNAL_ERROR.
        if (error.code === '23505' || /unique|duplicate/i.test(error.constraint || error.message || '')) {
            logger.warn('[bosses] Гонка при создании рейда, рейд уже существует', {
                playerId, bossId, constraint: error.constraint
            });
            return res.status(400).json({
                success: false,
                error: 'Массовый бой на этого босса уже идёт',
                code: 'RAID_ALREADY_ACTIVE'
            });
        }
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_start');
    }
});

router.post('/raid/:id/join', async (req, res) => {
    // Валидация до открытия транзакции — как в остальных маршрутах боссов.
    const raidId = Number(req.params.id);
    const playerId = req.player.id;

    if (!raidId || raidId <= 0) {
        return res.status(400).json({ success: false, error: 'Укажите корректный ID рейда', code: 'INVALID_RAID_ID' });
    }

    try {
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                if (activeBattle.type === 'mass' && activeBattle.raid_id === raidId) {
                    return {
                        status: 400,
                        body: { success: false, error: 'Вы уже участвуете в этом массовом бою', code: 'ALREADY_PARTICIPATING' }
                    };
                }

                return {
                    status: 400,
                    body: buildAlreadyInFightResponse(activeBattle)
                };
            }

            const raidResult = await client.query(
                `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                        b.name AS boss_name, b.icon
                 FROM raid_progress rp
                 JOIN bosses b ON b.id = rp.boss_id
                 WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()`,
                [raidId]
            );

            const raid = raidResult.rows[0];
            if (!raid) {
                return {
                    status: 404,
                    body: { success: false, error: 'Массовый бой не найден', code: 'RAID_NOT_FOUND' }
                };
            }

            const player = await getPlayerBaseState(client, playerId);
            if (!player || player.health <= 0) {
                return {
                    status: 400,
                    body: { success: false, error: 'Вы мертвы. Нельзя присоединиться к массовому бою.', code: 'PLAYER_DEAD' }
                };
            }

            // Ключевая цепочка не должна обходиться через чужой рейд: игрок без
            // единого ключа не должен попасть в рейд на 10-го босса и бить
            // его за долю наград. Ключи при входе НЕ тратятся (их платит
            // лидер, который их и запустил) — требуется только наличие.
            if (raid.boss_id > 1) {
                const required = await getKeysRequiredForBoss(client, raid.boss_id - 1);
                const owned = await getPlayerKeyCount(client, playerId, raid.boss_id - 1);
                if (owned < required) {
                    return {
                        status: 400,
                        body: {
                            success: false,
                            error: `Нужно ${required} ключей от босса ${raid.boss_id - 1}, у вас ${owned}`,
                            code: 'INSUFFICIENT_KEYS',
                            keys_owned: owned,
                            keys_required: required
                        }
                    };
                }
            }

            await client.query(
                `INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                 VALUES ($1, $2, $3, 0, NOW(), NOW())
                 ON CONFLICT (boss_id, player_id)
                 DO UPDATE SET raid_id = EXCLUDED.raid_id,
                               damage_dealt = 0,
                               rewards_earned = false,
                               joined_at = NOW(),
                               last_hit_at = NOW()`,
                [raid.boss_id, playerId, raidId]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'mass',
                     active_raid_id = $2
                 WHERE id = $3`,
                [raid.boss_id, raidId, playerId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        raid_id: raidId,
                        mode: 'mass',
                        boss: {
                            id: raid.boss_id,
                            name: raid.boss_name,
                            icon: raid.icon,
                            hp: raid.current_health,
                            max_hp: raid.max_health
                        },
                        expires_at: raid.expires_at
                    }
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_join');
    }
});

/**
 * Выйти из массового боя (остаться без активного боя, но с накопленным вкладом).
 *
 * Раньше выхода не было вообще: active_boss_* снимались только при
 * убийстве босса или истечении рейда.
 *
 * Сессию с накопленным уроном НЕ удаляем: награда при убийстве босса
 * считается по boss_sessions, и вышедший участник должен получить свою
 * долю (строки raid_rewards пишутся всем участникам рейда).
 */
router.post('/raid/:id/leave', async (req, res) => {
    // Валидация до открытия транзакции — как в остальных маршрутах боссов.
    const raidId = Number(req.params.id);
    const playerId = req.player.id;

    if (!raidId || raidId <= 0) {
        return res.status(400).json({ success: false, error: 'Укажите корректный ID рейда', code: 'INVALID_RAID_ID' });
    }

    try {
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (!activeBattle || activeBattle.type !== 'mass' || activeBattle.raid_id !== raidId) {
                return {
                    status: 400,
                    body: { success: false, error: 'Вы не участвуете в этом массовом бою', code: 'NOT_PARTICIPATING' }
                };
            }

            await clearPlayerActiveBattle(client, playerId);

            return {
                status: 200,
                body: {
                    success: true,
                    data: { raid_id: raidId, left: true }
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_leave');
    }
});

router.post('/raid/:id/attack', async (req, res) => {
    // Валидация до открытия транзакции — как в остальных маршрутах боссов.
    const raidId = Number(req.params.id);
    const playerId = req.player.id;

    if (!raidId || raidId <= 0) {
        return res.status(400).json({ success: false, error: 'Укажите корректный ID рейда', code: 'INVALID_RAID_ID' });
    }

    try {
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (!activeBattle || activeBattle.type !== 'mass' || activeBattle.raid_id !== raidId) {
                // Рейд кончился, и его строка уже удалена — resolveActiveBattle
                // сбросил active_raid_id. Раньше здесь всегда было «Вы не
                // участвуете», хотя игрок участвовал и награду получил.
                const raidExists = await client.query(
                    `SELECT 1 FROM raid_progress
                      WHERE id = $1 AND is_raid = true AND is_active = true AND expires_at > NOW()`,
                    [raidId]
                );
                if (raidExists.rows.length === 0) {
                    return {
                        status: 400,
                        body: {
                            success: false,
                            error: 'Этот массовый бой уже завершён. Награды за него смотрите в разделе боссов.',
                            code: 'RAID_FINISHED'
                        }
                    };
                }
                return {
                    status: 400,
                    body: { success: false, error: 'Вы не участвуете в этом массовом бою', code: 'NOT_PARTICIPATING' }
                };
            }

            const raidResult = await client.query(
                `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at, rp.leader_id,
                        b.name AS boss_name, b.reward_coins, b.reward_experience, b.reward_items
                 FROM raid_progress rp
                 JOIN bosses b ON b.id = rp.boss_id
                 WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()
                 FOR UPDATE`,
                [raidId]
            );

            const raid = raidResult.rows[0];
            if (!raid) {
                return {
                    status: 404,
                    body: { success: false, error: 'Массовый бой не найден', code: 'RAID_NOT_FOUND' }
                };
            }

            const sessionResult = await client.query(
                'SELECT * FROM boss_sessions WHERE player_id = $1 AND raid_id = $2 FOR UPDATE',
                [playerId, raidId]
            );

            const session = sessionResult.rows[0];
            if (!session) {
                return {
                    status: 400,
                    body: { success: false, error: 'Вы не участвуете в этом массовом бою', code: 'NOT_PARTICIPATING' }
                };
            }

            const player = await getPlayerBaseState(client, playerId);
            // Регенерация энергии — та же, что в соло-бою и в world/pvp:
            // без неё после исчерпания энергии рейд тоже требовал поиска в мире.
            await recalcEnergy(client, player);
            const activeBuffs = getActiveBuffs(player.buffs);
            if (!activeBuffs.free_energy && player.energy < 1) {
                return {
                    status: 400,
                    body: { success: false, error: 'Недостаточно энергии', code: 'INSUFFICIENT_ENERGY' }
                };
            }

            if (player.health <= 0) {
                return {
                    status: 400,
                    body: { success: false, error: 'Вы мертвы. Нельзя атаковать рейдового босса.', code: 'PLAYER_DEAD' }
                };
            }

            const masteries = await getBossMasteries(client, playerId);
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}), client);
            const damage = calculateDamage(raid.boss_id, player, masteries, setBonuses);
            const newHp = Math.max(0, raid.current_health - damage);
            const newTotalDamage = session.damage_dealt + damage;
            const energyCost = activeBuffs.free_energy ? 0 : 1;

            // Ответный удар рейдового босса и износ снаряжения — то же,
            // что и в соло-бою: иначе рейд был бы полностью безопасным.
            // raid.current_health — HP ДО этого удара, от него зависит сила
            // ответного удара.
            const raidBoss = await getBossById(client, raid.boss_id);
            const counterHit = raidBoss
                ? await applyBossCounterHit(client, playerId, raidBoss, player, raid.current_health)
                : { damage: 0, health: Number(player.health || 0), broken_slots: [] };
            await progressDailyTask(client, playerId, 'boss_damage', damage);

            // См. комментарий выше: реген не сбрасывается при трате.
            const energyResult = await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - $1)
                 WHERE id = $2
                 RETURNING energy, max_energy, last_energy_update`,
                [energyCost, playerId]
            );

            await client.query('UPDATE raid_progress SET current_health = $1 WHERE id = $2', [newHp, raidId]);
            // first_hit отмечается здесь, а не в момент входа: участник,
            // вошедший первым, но никем не тронутый босса, бонуса не стоит.
            // damage_dealt в CASE — СТАРОЕ значение (до этого UPDATE).
            // first_hitter = TRUE только тому, кто первым нанёс урон боссу
            // в этом рейде (урон игрока = 0 и никто другой ещё не бился).
            await client.query(
                `UPDATE boss_sessions
                    SET damage_dealt = $1,
                        last_hit_at = NOW(),
                        first_hitter = CASE
                            WHEN damage_dealt = 0
                                 AND NOT EXISTS (
                                     SELECT 1 FROM boss_sessions bs2
                                     WHERE bs2.raid_id = boss_sessions.raid_id
                                       AND bs2.player_id != boss_sessions.player_id
                                       AND bs2.damage_dealt > 0
                                 )
                            THEN TRUE
                            ELSE first_hitter
                        END
                  WHERE player_id = $2 AND raid_id = $3`,
                [newTotalDamage, playerId, raidId]
            );

            // Лог боя: чей удар, сколько снял и чем ответил босс. Пишем
            // после мутаций, чтобы цифры события были итоговыми.
            await appendRaidLog(client, raidId, {
                type: 'attack',
                player_id: playerId,
                player_name: player.first_name || 'Игрок',
                damage,
                counter_damage: counterHit.damage,
                boss_hp_after: newHp,
                final: newHp <= 0,
                at: new Date().toISOString()
            });

            let killed = false;
            let rewards = null;

            if (newHp <= 0) {
                killed = true;
                await client.query('UPDATE raid_progress SET is_active = false, ended_at = NOW(), current_health = 0 WHERE id = $1', [raidId]);

                const participantsResult = await client.query(
                    `SELECT bs.player_id, bs.damage_dealt, bs.first_hitter, p.buffs
                      FROM boss_sessions bs
                      JOIN players p ON p.id = bs.player_id
                      WHERE bs.raid_id = $1`,
                    [raidId]
                );

                const allParticipants = participantsResult.rows;
                // КРИТИЧНО: boss_sessions.player_id — BIGINT, pg отдаёт его
                // строкой ('42'), а playerId — число. Без Number() условие
                // participant.player_id === playerId всегда false, и добившему
                // босса рейда ответ возвращался без наград (rewards = null),
                // хотя монеты/опыт/предметы ему начислялись.
                const rewardParticipants = allParticipants.filter((row) => Number(row.damage_dealt || 0) > 0);
                const totalDamage = rewardParticipants.reduce((sum, row) => sum + Number(row.damage_dealt || 0), 0) || 1;
                const participantIds = allParticipants.map((row) => row.player_id);

                // Считаем доли ДО цикла: они нужны и для начисления, и для
                // строчек в raid_rewards, чтобы обе стороны считали одно и то
                // же. Участник без урона получает нулевую долю — его строчка
                // всё равно пишется, иначе он не узнает, что рейд кончился.
                // leader_id — INTEGER, но pg может отдать строкой; Number()
                // страхует сравнение с participantId.
                const leaderIdRaw = Number(raid.leader_id);
                // Последний удар — тот, чья атака убила босса (этот запрос).
                const lastHitId = playerId;
                const shares = allParticipants.map((row) => {
                    const dealt = Number(row.damage_dealt || 0);
                    // Бонусы: +5% доле первого удара и +5% доле добившего.
                    // Смелость на входе и добивание — два стратегических
                    // момента рейда, ради которых стоит рисковать.
                    let bonusMultiplier = 1;
                    if (dealt > 0 && row.first_hitter) bonusMultiplier += RAID_FIRST_HIT_BONUS;
                    if (Number(row.player_id) === lastHitId) bonusMultiplier += RAID_LAST_HIT_BONUS;
                    return {
                        participantId: Number(row.player_id),
                        dealt,
                        share: dealt > 0 ? dealt / totalDamage : 0,
                        bonusMultiplier,
                        buffs: row.buffs
                    };
                });
                // Остаток от округления вниз достаётся самому результативному:
                // Math.floor по долям суммарно даёт меньше награды босса, и
                // разница из ниоткуда не взялась бы (на боссе с 50 опыта и
                // тремя участниками терялось 1-2 единицы).
                // Считаем от БАЗОВЫХ значений, без бафов: иначе exp_x2 у
                // лидера сломал бы арифметику остатка. Бонус первого и
                // последнего удара в арифметику остатка входят: иначе он
                // отъедал бы часть пула у остальных.
                const coinsPool = Number(raid.reward_coins || 0);
                const expPool = Number(raid.reward_experience || 0);
                const topDamager = shares.reduce((best, row) => (row.dealt > (best ? best.dealt : -1) ? row : best), null);
                // Остаток уходит только если у кого-то реально есть урон.
                // Иначе «топовым» оказался бы первый по списку участник с
                // нулевым уроном и забрал бы весь пул: никто не бил, а награда
                // всё равно кому-то досталась.
                const hasRealDamage = Boolean(topDamager) && topDamager.dealt > 0;
                const coinsRemainder = hasRealDamage
                    ? Math.max(0, coinsPool - shares.reduce((s, r) => s + Math.floor(coinsPool * r.share * r.bonusMultiplier), 0))
                    : 0;
                const expRemainder = hasRealDamage
                    ? Math.max(0, expPool - shares.reduce((s, r) => s + Math.floor(expPool * r.share * r.bonusMultiplier), 0))
                    : 0;

                let leaderKey = null;

                const expLogs = [];

                // Батч-загрузка шаблонов наград ДО цикла по участникам:
                // раньше grantRewardItems() делал SELECT ... FROM items для
                // каждого участника (N+1). Набор reward_items у рейда один,
                // multiplier применяется к количеству позже.
                const raidRewardTemplates = await loadItemTemplates(
                    client,
                    normalizeRewardItems(raid.reward_items)
                );

                for (const entry of shares) {
                    const participantId = entry.participantId;
                    const participantBuffs = getActiveBuffs(entry.buffs);
                    const lootMultiplier = participantBuffs.loot_x2 ? 2 : 1;

                    const baseCoins = Math.floor(coinsPool * entry.share * entry.bonusMultiplier);
                    const baseExp = Math.floor(expPool * entry.share * entry.bonusMultiplier);
                    const isTopDamager = Boolean(topDamager) && topDamager.participantId === participantId;

                    const coinsReward = baseCoins + (isTopDamager ? coinsRemainder : 0);
                    let experienceReward = participantBuffs.exp_x2 ? baseExp * 2 : baseExp;
                    if (isTopDamager && expRemainder > 0) experienceReward += expRemainder;

                    if (coinsReward > 0) {
                        await client.query('UPDATE players SET coins = coins + $1 WHERE id = $2', [coinsReward, participantId]);
                    }

                    if (experienceReward > 0) {
                        const expResult = await playerHelper.addExperience(participantId, experienceReward, client);
                        expLogs.push({ playerId: participantId, logData: expResult.logData });
                    }

                    const grantedItems = await grantRewardItems(client, participantId, raid.reward_items, entry.share * lootMultiplier, raidRewardTemplates);
                    const isLeader = participantId === leaderIdRaw;

                    if (isLeader) {
                        leaderKey = await grantNextBossKey(client, participantId, raid.boss_id);
                    }

                    if (participantId === playerId) {
                        rewards = {
                            coins: coinsReward,
                            experience: experienceReward,
                            items: grantedItems
                        };
                        if (isLeader && leaderKey) rewards.key = leaderKey;
                    }

                    // Мастерство и счётчик убийств — только тем, кто реально
                    // бил. Раньше +1 получал каждый участник с нулевым
                    // уроном: пока рейд бьют другие, можно качать убийства
                    // (и через killBonus — урон по боссам) без участия.
                    if (entry.dealt > 0) {
                        await client.query(
                            `INSERT INTO boss_mastery (player_id, boss_id, kills, last_killed_at)
                              VALUES ($1, $2, 1, NOW())
                              ON CONFLICT (player_id, boss_id)
                              DO UPDATE SET kills = boss_mastery.kills + 1, last_killed_at = NOW()`,
                            [participantId, raid.boss_id]
                        );

                        await client.query(
                            'UPDATE players SET bosses_killed = COALESCE(bosses_killed, 0) + 1 WHERE id = $1',
                            [participantId]
                        );
                    }

                    // Отложенная награда. Убийца свою долю уже видит в ответе
                    // этого же запроса, поэтому его строчка сразу claimed=true
                    // и второй раз не всплывёт. Остальные забирают при входе на
                    // экран боссов — без этой записи участник, бивший в офлайне,
                    // не узнавал о награде вообще.
                    const keyName = (isLeader && leaderKey) ? (leaderKey.boss_name || null) : null;
                    await client.query(
                        `INSERT INTO raid_rewards
                         (raid_id, boss_id, player_id, coins, experience, items, key_item_name, claimed)
                         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
                        [
                            raidId,
                            raid.boss_id,
                            participantId,
                            coinsReward,
                            experienceReward,
                            JSON.stringify(Array.isArray(grantedItems) ? grantedItems : []),
                            keyName,
                            participantId === playerId
                        ]
                    );
                }

                if (rewards && Array.isArray(rewards.items) && rewards.items.length === 0) {
                    delete rewards.items;
                }

                await clearActiveBattleForPlayers(client, participantIds);
                await client.query('DELETE FROM boss_sessions WHERE raid_id = $1', [raidId]);
                await client.query('DELETE FROM raid_progress WHERE id = $1', [raidId]);
            }

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        raid: {
                            id: raidId,
                            hp: newHp,
                            max_hp: raid.max_health,
                            hp_percent: raid.max_health > 0 ? Math.round((newHp / raid.max_health) * 100) : 0
                        },
                        // Плоские псевдонимы — те же имена, что у соло-удара
                        // (см. ответ /attack-boss). Нужны общему обработчику
                        // результата: клиент больше не должен различать две
                        // формы ответа. Старые вложенные поля остаются.
                        boss_hp: newHp,
                        boss_max_hp: raid.max_health,
                        damage_dealt: damage,
                        boss_defeated: killed,
                        damage,
                        damage_taken: counterHit.damage,
                        health: counterHit.health,
                        broken_equipment: counterHit.broken_slots,
                        // Ответный удар следующего удара — по уже уменьшенному
                        // HP босса, чтобы подпись в бою жила вместе с бойом.
                        counter_damage: calculateBossCounterDamage(
                            raidBoss,
                            player.max_health,
                            safeJsonParse(player.equipment, {}),
                                { currentHealth: newHp, playerLevel: player.level }
                            ),
                            // Итоговая защита: экипировка + 3 за уровень.
                            player_defense: equipmentRules.calculateDefenseTotal(safeJsonParse(player.equipment, {}))
                                + equipmentRules.calculateLevelDefense(player.level),
                            player_energy: energyResult.rows[0]?.energy ?? player.energy,
                        last_energy_update: energyResult.rows[0]?.last_energy_update || null,
                        your_total_damage: newTotalDamage,
                        killed,
                        rewards
                    },
                }
            };

            // Логи опыта уходят после начисления, но ещё внутри транзакции,
            // чтобы expLogs (объявленная через const) была доступна.
            for (const { playerId: pid, logData } of expLogs) {
                await logPlayerAction(pid, logData.action, logData.data);
            }

            return res.status(outcome.status).json(outcome.body);
        });
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_attack');
    }
});

module.exports = router;
