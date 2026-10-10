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
const { safeJsonParse, PlayerHelper: playerHelper, handleError, logger, unauthorized } = require('../../utils/serverApi');

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
const { normalizeInventory, getActiveBuffs, createInventoryItem, addItemToInventory, equipmentRules, getSetBonuses, wearEquipmentSlots, trackCollectedItems, progressDailyTask, applyAutoHeal } = helpers;
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
 * Спецбонус оружия по ситуации (stats.boss_bonus / stats.pvp_bonus).
 * 
 * Ближний бой (нож, бита, топор) даёт +40% урона по боссам.
 * Дальний бой даёт +25% урона в PvP.
 * 
 * @param {object} item оружие из инвентаря
 * @param {'boss'|'pvp'} context где применяется
 * @returns {number} множитель, например 1.4 или 1 (без бонуса)
 */
function getWeaponContextMultiplier(item, context) {
    if (!item || typeof item !== 'object') return 1;

    const stats = (item.stats && typeof item.stats === 'object') ? item.stats : {};
    const percent = Number(context === 'boss' ? stats.boss_bonus : stats.pvp_bonus) || 0;
    if (percent <= 0) return 1;

    return 1 + Math.min(100, percent) / 100;
}

/**
 * Разброс урона оружия (stats.variance, например ±25% у дробовика).
 * Применяется к урону ОРУЖИЯ, а не к базовому урону игрока: иначе разброс
 * ±25% от 200 урона босса ломал бы весь расчёт.
 */
function applyWeaponVariance(item, damage) {
    const stats = (item && item.stats && typeof item.stats === 'object') ? item.stats : {};
    return equipmentRules.rollVarianceDamage(damage, Number(stats.variance) || 0);
}

function calculateDamage(bossId, player, masteries = [], setBonuses = {}) {
    const equipment = safeJsonParse(player.equipment, {});

    // Урон оружия с учётом прочности и улучшений: сломанный нож даёт 0,
    // улучшенный снайпер — на +80% к базовому урону.
    const weapon = equipment.weapon;
    const weaponDamage = equipmentRules.getEffectiveStatValue(weapon, ['damage']);
    const weaponMultiplier = getWeaponContextMultiplier(weapon, 'boss');
    const setDamage = Number(setBonuses.damage || 0);
    const killBonus = calculateDamageBonus(bossId, masteries);
    // Усиливаем базовую прогрессию, чтобы ранние боссы не были чрезмерно затянутыми.
    const levelDamage = Math.max(1, Number(player.level || 1));
    const baseDamage = 3 + (levelDamage * 2);
    return Math.floor(baseDamage + killBonus + setDamage + weaponDamage * weaponMultiplier);
}

/**
 * Урон, который босс наносит игроку в ответ на удар.
 * 
 * bosses.damage — процент от max_health игрока за удар (3% у первого босса,
 * 15% у финального). Снижается защитой брони (мягкий предел 60%).
 * 
 * @param {object} boss строка bosses
 * @param {number} maxHealth максимум здоровья игрока
 * @param {object} equipment экипировка игрока
 * @returns {number} урон (не меньше 1)
 */
function calculateBossCounterDamage(boss, maxHealth, equipment) {
    const percent = Math.max(0, Number(boss && boss.damage) || 0);
    if (percent <= 0) return 0;

    const raw = Math.ceil((Math.max(1, Number(maxHealth) || 1) * percent) / 100);
    const defense = equipmentRules.calculateDefenseTotal(equipment || {});
    return equipmentRules.applyDefenseReduction(raw, defense);
}

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
 * Слоты экипировки, которые получают урон от босса.
 * Броня получает износ всегда, оружие — только если удар пришёл с оружием
 * (мощная атака) или когда босс отбил удар.
 */
function equipmentSlotsToWear({ counterAttack, usedWeapon }) {
    const slots = [];
    if (usedWeapon || counterAttack) slots.push('weapon');
    if (counterAttack) {
        slots.push('body', 'head', 'hands', 'legs', 'boots', 'armor', 'helmet', 'accessory');
    }
    return slots;
}

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
 * @param {object} [options] { usedWeapon: boolean }
 */
async function applyBossCounterHit(client, playerId, boss, player, options = {}) {
    const equipment = safeJsonParse(player.equipment, {});
    const damage = calculateBossCounterDamage(boss, player.max_health, equipment);
    if (damage <= 0) {
        return { damage: 0, health: Number(player.health || 0), broken_slots: [], auto_heal: null };
    }

    const health = Math.max(0, Number(player.health || 0) - damage);
    const brokenSlots = wearEquipmentSlots(
        client,
        playerId,
        equipment,
        equipmentSlotsToWear({ counterAttack: true, usedWeapon: options.usedWeapon })
    );

    // Порядок записи критичен: сначала ФИКСИРУЕМ урон и износ, и только
    // ПОТОМ автолечение. Иначе UPDATE урона перезапишет восстановленный
    // health значением ДО лечения: в БД останется урон, а инвентарь уже
    // списан — игрок теряет аптечку без восстановления HP.
    await client.query(
        `UPDATE players
            SET health = $1,
                equipment = $2::jsonb
          WHERE id = $3`,
        [health, JSON.stringify(equipment), playerId]
    );

    // Автолечение срабатывает сразу после урона: игрок не должен в панике
    // искать аптечку в инвентаре посреди боя. Функция сама выбирает самый
    // экономный лечащий предмет. Её UPDATE — последний, поэтому
    // восстановленное здоровье остаётся в базе.
    const autoHealed = await applyAutoHeal(client, playerId, { ...player, health, inventory: player.inventory });

    const finalHealth = autoHealed ? autoHealed.health : health;
    return {
        damage,
        health: finalHealth,
        broken_slots: brokenSlots,
        auto_heal: autoHealed ? { used: autoHealed.used, heal: autoHealed.heal } : null
    };
}

async function getBossById(client, bossId) {
    const result = await client.query('SELECT * FROM bosses WHERE id = $1', [bossId]);
    return result.rows[0] || null;
}

async function getPlayerBaseState(client, playerId) {
    // Настройки автолечения входят в SELECT намеренно: без них
    // player.auto_heal_enabled приходил как undefined, проверка
    // `=== false` его не ловила, и автолечение в бою с боссом
    // срабатывало ВСЕГДА — даже когда игрок его выключил.
    // Порог при этом молча откатывался к дефолтному 35%.
    const result = await client.query(
        `SELECT id, first_name, level, health, max_health, energy, max_energy, equipment,
                inventory, active_boss_id, active_boss_started_at, active_boss_mode,
                active_raid_id, buffs, auto_heal_enabled, auto_heal_threshold
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

async function grantRewardItems(client, playerId, rewardItems, multiplier = 1) {
    const normalizedItems = normalizeRewardItems(rewardItems);
    if (!normalizedItems.length || multiplier <= 0) return [];

    const templates = await loadItemTemplates(client, normalizedItems);
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

async function getActiveRaids(client, playerId) {
    const raidsResult = await client.query(
        `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                rp.leader_id, rp.leader_name,
                b.name AS boss_name, b.icon, b.description AS boss_description,
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

    return {
        raids: raidsResult.rows.map((raid) => ({
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
            leader: {
                id: raid.leader_id,
                name: raid.leader_name
            },
            participants_count: Number(raid.participants_count || 0),
            expires_at: raid.expires_at,
            time_remaining_ms: new Date(raid.expires_at).getTime() - Date.now()
        })),
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
                            max_hp: boss.max_health
                        },
                        time_remaining_ms: SOLO_FIGHT_DURATION_MS
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

router.get('/bonuses', async (req, res) => {
    try {
        const outcome = await withClient(async (client) => {
            const playerId = req.player.id;
            const player = await getPlayerBaseState(client, playerId);
            const masteries = await getBossMasteries(client, playerId);
            const masteryMap = {};
            for (const m of masteries) masteryMap[m.boss_id] = m.kills;
            const bossesResult = await client.query('SELECT id, name FROM bosses ORDER BY id');
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}));

            return {
                success: true,
                data: {
                    player_level: player.level,
                    set_bonuses: setBonuses,
                    bonuses: bossesResult.rows.map((boss) => ({
                        boss_id: boss.id,
                        boss_name: boss.name,
                        defeated_count: masteryMap[boss.id] || 0,
                        current_damage: calculateDamage(boss.id, player, masteries, setBonuses),
                        mastery_bonus: calculateDamageBonus(boss.id, masteries)
                    }))
                }
            };
        });
        res.json(outcome);
    } catch (error) {
        return handleError(res, error, 'bonuses');
    }
});

router.get('/', async (req, res) => {
    logger.info('[bosses/get] Начало запроса', { playerId: req.player?.id });
    try {
        const outcome = await withClient(async (client) => {
            const playerId = req.player.id;
            logger.info('[bosses/get] Получение данных игрока', { playerId });
            const player = await getPlayerBaseState(client, playerId);
            const activeBattle = await resolveActiveBattle(client, playerId);
            const masteries = await getBossMasteries(client, playerId);
            const masteryMap = {};
            for (const m of masteries) masteryMap[m.boss_id] = m.kills;

            const bossesResult = await client.query('SELECT * FROM bosses ORDER BY id');
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}));

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
                    // Ответный урон босса в процентах от здоровья игрока —
                    // UI показывает его в карточке боя.
                    damage_percent: boss.damage,
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

            return {
                success: true,
                data: {
                    bosses: bossList,
                    raids: raids.raids,
                    participating_raid_ids: raids.participatingIds,
                    participating_boss_ids: raids.participatingBossIds,
                    player_energy: player.energy,
                    player_max_energy: player.max_energy,
                    player_level: player.level,
                    active_battle: activeBattle,
                    fight_duration_ms: SOLO_FIGHT_DURATION_MS,
                    raid_duration_ms: MASS_FIGHT_DURATION_MS,
                    info: {
                        solo: 'Соло-бой: старт через кнопку, 1 удар = 1 энергия, бой длится 8 часов.',
                        mastery: 'Каждая победа над боссом увеличивает урон по нему и частично усиливает урон по следующим боссам.',
                        raids: 'Массовый бой — отдельный режим на 8 часов. Награды и предметы делятся пропорционально урону, ключ получает только лидер.'
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

router.post('/attack-boss', async (req, res) => {
    // Валидация до открытия транзакции — как в остальных маршрутах боссов.
    const bossId = Number(req.body?.boss_id);
    // P2: guard на req.player (см. коммент. в /attack-with-weapon).
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
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}));
            const damage = calculateDamage(bossId, player, masteries, setBonuses);
            const newHp = Math.max(0, activeBattle.boss.hp - damage);
            const energyCost = activeBuffs.free_energy ? 0 : 1;

            // Ответный удар босса и износ снаряжения.
            const counterHit = boss
                ? await applyBossCounterHit(client, playerId, boss, player)
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
                    // auto_heal обязателен и на верхнем уровне, и в data: клиент
                    // читает payload.auto_heal ?? payload.data.auto_heal, и без
                    // обоих полей строка «❤️ Автолечение» не выводится.
                    auto_heal: counterHit.auto_heal,
                    data: {
                        boss: {
                            id: bossId,
                            hp: newHp,
                            max_hp: activeBattle.boss.max_hp
                        },
                        damage,
                        killed,
                        rewards,
                        mastery,
                        energy_left: energyResult.rows[0].energy,
                        last_energy_update: energyResult.rows[0].last_energy_update,
                        damage_taken: counterHit.damage,
                        health: counterHit.health,
                        broken_equipment: counterHit.broken_slots,
                        auto_heal: counterHit.auto_heal
                    }
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'solo_attack');
    }
});

/**
 * Атака босса с использованием оружия из инвентаря
 * Оружие тратится после использования
 * POST /bosses/attack-with-weapon
 */
router.post('/attack-with-weapon', async (req, res) => {
    // Валидация до открытия транзакции — как в остальных маршрутах боссов.
    const bossId = Number(req.body?.boss_id);
    const itemIndex = Number(req.body?.item_index);
    // P2: req.player.id без guard. Обычно гарантирован validatePlayer, но
    // при прямом вызове роутера (как у /api/leaderboard) req.player может
    // отсутствовать, и роутер отвечал 500 вместо 401.
    const playerId = req.player?.id;

    if (!playerId) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация', code: 'UNAUTHORIZED' });
    }

    if (!validateBossId(bossId)) {
        return res.status(400).json({ success: false, error: 'Укажите корректный ID босса', code: 'INVALID_BOSS_ID' });
    }

    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
        return res.status(400).json({ success: false, error: 'Укажите корректный индекс предмета', code: 'INVALID_ITEM_INDEX' });
    }

    try {
        const outcome = await transaction(async (client) => {
            const validation = await validateSoloAttack(client, playerId, bossId);
            if (validation.error) {
                // Статус и тело приходят из validateSoloAttack: там разные
                // отказы (нет боя, мёртв, мало энергии).
                return { status: validation.status, body: validation.error };
            }

            const { activeBattle, player, activeBuffs, masteries } = validation;

            const inventory = normalizeInventory(player.inventory);

            if (itemIndex >= inventory.length) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Предмет не найден в инвентаре',
                        code: 'ITEM_NOT_FOUND'
                    }
                };
            }

            const weapon = inventory[itemIndex];

            if (weapon.type !== 'weapon') {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Это не оружие',
                        code: 'NOT_WEAPON'
                    }
                };
            }

            const weaponDamage = applyWeaponVariance(weapon,
                equipmentRules.getEffectiveStatValue(weapon, ['damage']) * getWeaponContextMultiplier(weapon, 'boss'));
            const weaponName = weapon.name;

            // Сломанное оружие не бьёт. Проверка обязательна: бит за один удар 9
            // урона при цене 45 строго хуже продажи — бой с оружием должен
            // становиться выгодным по мере его использования.
            const durabilityInfo = equipmentRules.getDurabilityInfo(weapon);
            if (durabilityInfo.isBroken) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Оружие сломано — отремонтируйте его',
                        code: 'WEAPON_BROKEN',
                        durability: durabilityInfo.current,
                        max_durability: durabilityInfo.max
                    }
                };
            }

            // Износ: −1 прочности вместо удаления предмета.
            const wornWeapon = equipmentRules.wearEquipment(weapon, 1);
            inventory[itemIndex] = wornWeapon;

            // P0-1: изношенное оружие должно стать ЕДИНСТВЕННОЙ версией инвентаря
            // для всех последующих писателей в этой транзакции.
            //
            // Раньше `player.inventory` оставался исходным JSON: внутри
            // applyBossCounterHit -> applyAutoHeal списывал аптечку уже из
            // устаревшей копии, а финальный UPDATE энергии записывал инвентарь
            // своей stale-копией (строка 1218). Итог: здоровье
            // восстанавливалось, аптечка оставалась в инвентаре.
            //
            // Теперь порядок такой:
            //   1) фиксируем износ оружия в объекте и в БД;
            //   2) applyAutoHeal читает ЭТУ версию и пишет inventory последним
            //      (изношенное оружие + списанная аптечка);
            //   3) UPDATE энергии больше не трогает inventory вообще.
            player.inventory = inventory;
            await client.query(
                'UPDATE players SET inventory = $1 WHERE id = $2',
                [JSON.stringify(inventory), playerId]
            );

            const boss = await getBossById(client, bossId);
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}));
            const baseDamage = calculateDamage(bossId, player, masteries, setBonuses);
            const damage = baseDamage + weaponDamage;
            const energyCost = activeBuffs.free_energy ? 0 : 1;

            const newHp = Math.max(0, activeBattle.boss.hp - damage);

            const counterHit = boss
                ? await applyBossCounterHit(client, playerId, boss, player, { usedWeapon: true })
                : { damage: 0, health: Number(player.health || 0), broken_slots: [] };

            await progressDailyTask(client, playerId, 'boss_damage', damage);

            // См. комментарий выше про last_energy_update при атаке с оружием.
            // Инвентарь здесь НЕ пишется: финальную версию (изношенное оружие +
            // списанная аптечка автохила) уже записал applyAutoHeal внутри
            // applyBossCounterHit. Повторная запись затирала бы расходники.
            const energyResult = await client.query(`
                UPDATE players
                SET energy = GREATEST(0, energy - $1)
                WHERE id = $2
                RETURNING energy, max_energy, last_energy_update
            `, [energyCost, playerId]);

            await client.query(`
                UPDATE player_boss_progress
                SET current_hp = $1, last_attack = NOW()
                WHERE player_id = $2 AND boss_id = $3
            `, [newHp, playerId, bossId]);

            let killed = false;
            let rewards = null;
            let mastery = masteries.find((m) => m.boss_id === bossId)?.kills || 0;

            if (newHp <= 0) {
                killed = true;
                const killResult = await handleSoloBossKill(client, playerId, bossId, activeBuffs, masteries);
                rewards = killResult.rewards;
                mastery = killResult.mastery;
            }

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        boss_hp: newHp,
                        boss_max_hp: activeBattle.boss.max_hp,
                        damage: damage,
                        weapon_used: weaponName,
                        weapon_damage: weaponDamage,
                        weapon_durability: wornWeapon.durability,
                        weapon_max_durability: wornWeapon.max_durability,
                        // Сломан ли ствол после удара: клиент выводит предупреждение
                        // в лог боя, иначе прочность просто исчезала из ответа.
                        weapon_broken: Number(wornWeapon.durability) <= 0,
                        damage_taken: counterHit.damage,
                        health: counterHit.health,
                        broken_equipment: counterHit.broken_slots,
                        // Автолечение — см. комментарий в /attack-boss: без этих
                        // полей клиент не показывал, какое лекарство было выпито.
                        auto_heal: counterHit.auto_heal,
                        energy: energyResult.rows[0]?.energy || 0,
                        last_energy_update: energyResult.rows[0]?.last_energy_update || null,
                        killed,
                        rewards,
                        mastery
                    },
                    auto_heal: counterHit.auto_heal
                },
                // Логирование вынесено наружу транзакции: раньше оно стояло
                // между COMMIT и res.json, и его сбой приводил к откату уже
                // закрытой транзакции.
                log: { bossId, weaponName, weaponDamage, damage, newHp, killed }
            };
        });

        if (outcome.log) {
            logger.info(`[bosses] Атака с оружием`, {
                playerId,
                ...outcome.log
            });
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'attack_with_weapon');
    }
});

/**
 * Получение списка оружия игрока для атаки на босса
 * GET /bosses/weapons
 */
router.get('/weapons', async (req, res) => {
    try {
        const outcome = await withClient(async (client) => {
            const playerId = req.player.id;

            const playerResult = await client.query(
                'SELECT inventory FROM players WHERE id = $1',
                [playerId]
            );

            const inventory = normalizeInventory(playerResult.rows[0]?.inventory);

            // Мощная атака доступна только с целым оружием: сломанное не бьёт,
            // а стоило бы ровно столько же, сколько сейчас отображается.
            const weapons = inventory
                .map((item, index) => {
                    if (item.type !== 'weapon') return null;

                    const durability = equipmentRules.getDurabilityInfo(item);
                    const weaponDamage = equipmentRules.getEffectiveStatValue(item, ['damage']);
                    return {
                        index,
                        id: item.id,
                        name: item.name,
                        category: item.category || item.type || null,
                        damage: weaponDamage,
                        rarity: item.rarity || 'common',
                        icon: item.icon || '🔪',
                        durability: durability.current,
                        max_durability: durability.max,
                        is_broken: durability.isBroken
                    };
                })
                .filter(Boolean);

            return {
                success: true,
                weapons,
                count: weapons.filter((weapon) => !weapon.is_broken).length
            };
        });
        res.json(outcome);
    } catch (error) {
        return handleError(res, error, 'list_weapons');
    }
});

router.get('/raids', async (req, res) => {
    try {
        const outcome = await withClient(async (client) => {
            const raids = await getActiveRaids(client, req.player.id);
            return {
                success: true,
                data: {
                    raids: raids.raids,
                    participating_raid_ids: raids.participatingIds,
                    participating_boss_ids: raids.participatingBossIds
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
            await client.query(
                'SELECT id FROM bosses WHERE id = $1 FOR UPDATE',
                [bossId]
            );

            const player = await getPlayerBaseState(client, playerId);
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
            const setBonuses = await getSetBonuses(safeJsonParse(player.equipment, {}));
            const damage = calculateDamage(raid.boss_id, player, masteries, setBonuses);
            const newHp = Math.max(0, raid.current_health - damage);
            const newTotalDamage = session.damage_dealt + damage;
            const energyCost = activeBuffs.free_energy ? 0 : 1;

            // Ответный урон рейдового босса и износ снаряжения — то же,
            // что и в соло-бою: иначе рейд был бы полностью безопасным.
            const raidBoss = await getBossById(client, raid.boss_id);
            const counterHit = raidBoss
                ? await applyBossCounterHit(client, playerId, raidBoss, player)
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
            await client.query('UPDATE boss_sessions SET damage_dealt = $1, last_hit_at = NOW() WHERE player_id = $2 AND raid_id = $3', [newTotalDamage, playerId, raidId]);

            let killed = false;
            let rewards = null;

            if (newHp <= 0) {
                killed = true;
                await client.query('UPDATE raid_progress SET is_active = false, ended_at = NOW(), current_health = 0 WHERE id = $1', [raidId]);

                const participantsResult = await client.query(
                    `SELECT bs.player_id, bs.damage_dealt, p.buffs
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

                for (const participant of rewardParticipants) {
                    const participantId = Number(participant.player_id);
                    const share = Number(participant.damage_dealt || 0) / totalDamage;
                    const coinsReward = Math.floor((raid.reward_coins || 0) * share);
                    const participantBuffs = getActiveBuffs(participant.buffs);
                    const baseExperienceReward = Math.floor((raid.reward_experience || 0) * share);
                    const experienceReward = participantBuffs.exp_x2 ? baseExperienceReward * 2 : baseExperienceReward;
                    const lootMultiplier = participantBuffs.loot_x2 ? 2 : 1;

                    if (coinsReward > 0) {
                        await client.query('UPDATE players SET coins = coins + $1 WHERE id = $2', [coinsReward, participantId]);
                    }

                    if (experienceReward > 0) {
                        await playerHelper.addExperience(participantId, experienceReward, client);
                    }

                    const grantedItems = await grantRewardItems(client, participantId, raid.reward_items, share * lootMultiplier);

                    if (participantId === playerId) {
                        rewards = {
                            coins: coinsReward,
                            experience: experienceReward,
                            items: grantedItems
                        };
                    }

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

                // leader_id — INTEGER, pg отдаёт его числом, но raid_progress
                // читается в разных местах; Number() здесь страхует от строки.
                const leaderKey = await grantNextBossKey(client, Number(raid.leader_id), raid.boss_id);
                if (playerId === Number(raid.leader_id) && leaderKey) {
                    rewards = rewards || { coins: 0, experience: 0, items: [] };
                    rewards.key = leaderKey;
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
                        damage,
                        damage_taken: counterHit.damage,
                        health: counterHit.health,
                        broken_equipment: counterHit.broken_slots,
                        // Автолечение — см. комментарий в /attack-boss.
                        auto_heal: counterHit.auto_heal,
                        player_energy: energyResult.rows[0]?.energy ?? player.energy,
                        last_energy_update: energyResult.rows[0]?.last_energy_update || null,
                        your_total_damage: newTotalDamage,
                        killed,
                        rewards
                    },
                    auto_heal: counterHit.auto_heal
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_attack');
    }
});

router.get('/active', async (req, res) => {
    try {
        const outcome = await withClient(async (client) => {
            const activeBattle = await resolveActiveBattle(client, req.player.id);

            return {
                success: true,
                data: {
                    has_active_boss: Boolean(activeBattle),
                    active_boss: activeBattle
                }
            };
        });
        res.json(outcome);
    } catch (error) {
        return handleError(res, error, 'active');
    }
});

module.exports = router;
