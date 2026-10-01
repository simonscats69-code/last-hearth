/**
 * Объединённый модуль игровых хелперов
 * Объединяет функции работы с состоянием игрока и систему достижений
 * 
 * Объединённые модули:
 * - playerState.js (нормализация состояния игрока)
 * - achievements.js (система достижений)
 */

const { query, transaction: tx } = require('../db/database');
const { logger } = require('./serverApi');

// ==========================================
// ФУНКЦИИ СОСТОЯНИЯ ИГРОКА (из playerState.js)
// ==========================================

/**
 * Безопасный парсинг JSON с fallback значением
 * Импортируется из serverApi для единообразия
 */
const safeParseJson = require('./serverApi').safeJsonParse;

/**
 * Нормализация инвентаря
 */
function normalizeInventory(value) {
    const parsed = safeParseJson(value, []);

    if (Array.isArray(parsed)) {
        return parsed;
    }

    if (parsed && typeof parsed === 'object') {
        return Object.values(parsed).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    }

    return [];
}

/**
 * Общая нормализация: любой JSON в чистый объект (не массив, не null).
 * Раньше эта же строка была продублирована в normalizeItemStats и
 * normalizePlayerBuffs — аудит находил «точный дубль».
 */
function normalizePlainObject(value) {
    const parsed = safeParseJson(value, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

/**
 * Нормализация stats предмета
 */
function normalizeItemStats(value) {
    return normalizePlainObject(value);
}

/**
 * Построить унифицированный предмет инвентаря
 */
function createInventoryItem(item, options = {}) {
    const source = item && typeof item === 'object' ? item : {};
    const stats = normalizeItemStats(options.stats !== undefined ? options.stats : source.stats);
    const durability = Number(options.durability ?? source.durability ?? 100);
    const rawModifications = options.modifications ?? source.modifications ?? {};
    const modifications = rawModifications && typeof rawModifications === 'object' && !Array.isArray(rawModifications)
        ? { ...rawModifications }
        : {};

    return {
        ...source,
        id: source.id ?? options.id ?? null,
        name: source.name || options.name || 'Предмет',
        type: source.type || options.type || 'misc',
        category: source.category || options.category || source.type || options.type || 'misc',
        rarity: options.rarity || source.rarity || 'common',
        icon: source.icon || options.icon || '📦',
        slot: source.slot || options.slot || null,
        stats,
        damage: Number(options.damage ?? source.damage ?? stats.damage ?? 0),
        defense: Number(options.defense ?? source.defense ?? stats.defense ?? 0),
        heal: Number(options.heal ?? source.heal ?? stats.health ?? stats.health_restore ?? 0),
        rad_removal: Number(options.rad_removal ?? source.rad_removal ?? stats.radiation_cure ?? 0),
        radiation_resist: Number(options.radiation_resist ?? source.radiation_resist ?? stats.radiation_resist ?? 0),
        infection_resist: Number(options.infection_resist ?? source.infection_resist ?? stats.infection_resist ?? 0),
        durability,
        max_durability: Number(options.max_durability ?? source.max_durability ?? 100),
        quantity: Math.max(1, Number(options.quantity ?? source.quantity ?? 1) || 1),
        upgrade_level: Number(options.upgrade_level ?? source.upgrade_level ?? 0),
        modifications
    };
}

/**
 * Получить категорию предмета инвентаря без жёсткой привязки к диапазонам ID
 */
function getInventoryItemCategory(item) {
    if (!item || typeof item !== 'object') {
        return 'misc';
    }

    return String(item.category || item.type || 'misc').toLowerCase();
}

/**
 * Нормализация радиации
 */
function normalizeRadiation(value) {
    const parsed = safeParseJson(value, { level: 0 });

    if (typeof parsed === 'number') {
        return {
            level: parsed,
            expires_at: null,
            applied_at: null
        };
    }

    if (parsed && typeof parsed === 'object') {
        return {
            level: Number(parsed.level || 0),
            expires_at: parsed.expires_at || null,
            applied_at: parsed.applied_at || null
        };
    }

    return {
        level: 0,
        expires_at: null,
        applied_at: null
    };
}

/**
 * Нормализация инфекций
 */
function normalizeInfections(value) {
    const parsed = safeParseJson(value, []);
    return Array.isArray(parsed) ? parsed : [];
}

/**
 * Нормализация активных баффов игрока
 */
function normalizePlayerBuffs(value) {
    return normalizePlainObject(value);
}

/**
 * Предметы, которые нельзя продать.
 * Ключи боссов — валюта прогрессии: их нельзя обратить в монеты,
 * иначе можно было бы бесконечно фармить монеты, покупая ключи по кругу.
 */
const NON_SELLABLE_TYPES = new Set(['key']);

/** Доля от цены в магазине, которую игрок получает при продаже */
const SELL_RATE = 0.35;

/** Минимальная цена продажи по редкости (для добычи, у price = 0) */
const SELL_FLOOR_BY_RARITY = {
    common: 3,
    uncommon: 8,
    rare: 20,
    epic: 45,
    legendary: 100
};

/**
 * Посчитать цену продажи одного предмета.
 * Цена берётся из таблицы items по id (не из JSON инвентаря), поэтому
 * подделать стоимость на клиенте невозможно.
 * @param {object|null} dbItem - строка из таблицы items
 * @param {object} inventoryItem - предмет из инвентаря
 * @returns {number} цена за одну штуку
 */
function calculateSellPrice(dbItem, inventoryItem) {
    if (!dbItem) return 0;
    if (NON_SELLABLE_TYPES.has(String(dbItem.type || inventoryItem?.type || ''))) return 0;

    const shopPrice = Number(dbItem.price || 0);
    if (shopPrice > 0) {
        return Math.max(1, Math.floor(shopPrice * SELL_RATE));
    }

    const rarity = String(dbItem.rarity || inventoryItem?.rarity || 'common');
    return SELL_FLOOR_BY_RARITY[rarity] || SELL_FLOOR_BY_RARITY.common;
}

/**
 * Добавить предмет в инвентарь с учётом стакования.
 *
 * Без этого покупка 10 яблок создавала 10 слотов (и упиралась в
 * лимит в 100), хотя в таблице items есть stackable/max_stack.
 * Стакуются только предметы с одинаковыми id, rarity и нулевым
 * upgrade_level — чтобы не смешивать апгрейженные экземпляры.
 * @param {Array} inventory - текущий инвентарь (мутируется)
 * @param {object} newItem - новый предмет из createInventoryItem()
 * @param {object|null} dbItem - строка из таблицы items (для stackable/max_stack)
 * @returns {number} сколько предметов реально добавлено новыми слотами
 */
/**
 * Типы предметов, которые нельзя складывать в стек.
 * Проверяются вместе со слотом: колонка items.slot nullable,
 * и у части оружия она пустая — без проверки типа два одинаковых
 * меча слились бы в один слот.
 */
const EQUIPMENT_TYPES = new Set([
    'weapon', 'armor', 'helmet', 'body', 'head',
    'hands', 'legs', 'boots', 'accessory', 'equipment'
]);

function addItemToInventory(inventory, newItem, dbItem) {
    if (!Array.isArray(inventory) || !newItem) return 0;

    const type = String(newItem.type || dbItem?.type || '').toLowerCase();
    const category = String(newItem.category || dbItem?.category || type).toLowerCase();
    // Снаряжение (у него есть slot) и ключи НИКОГДА не стакаются:
    // два меча в одном слоте — это поломанный предмет, а не стопка.
    const isEquipment = Boolean(newItem.slot || dbItem?.slot)
        || EQUIPMENT_TYPES.has(type)
        || EQUIPMENT_TYPES.has(category);
    const stackable = dbItem ? dbItem.stackable !== false : true;

    const maxStack = Math.max(1, Number(dbItem?.max_stack || 99));
    const quantity = Math.max(1, Number(newItem.quantity || 1));

    let remaining = quantity;

    if (stackable && !isEquipment && type !== 'key' && !newItem.upgrade_level) {
        for (let i = 0; i < inventory.length && remaining > 0; i++) {
            const existing = inventory[i];
            if (!existing || existing.id !== newItem.id) continue;
            if (existing.rarity !== newItem.rarity) continue;
            if (Number(existing.upgrade_level || 0) !== 0) continue;

            const currentQty = Math.max(0, Number(existing.quantity || 1));
            if (currentQty >= maxStack) continue;

            const toAdd = Math.min(maxStack - currentQty, remaining);
            inventory[i] = { ...existing, quantity: currentQty + toAdd };
            remaining -= toAdd;
        }
    }

    // Что не влезло в стеки — отдельным слотом.
    // Раньше здесь был безусловный push(newItem) с ПОЛНЫМ quantity:
    // при max_stack=5 и добавлении 4 в стек из 4 получалось 5 + 4 = 9,
    // а не 5 + 3 — лишние предметы «терялись» в арифметике.
    if (remaining > 0) {
        inventory.push({ ...newItem, quantity: remaining });
        return 1; // создан новый слот
    }

    return 0; // всё ушло в существующие стеки
}

/**
 * Получить только активные баффы игрока
 */
function getActiveBuffs(value, now = Date.now()) {
    const buffs = normalizePlayerBuffs(value);
    const active = {};

    for (const [effect, buffData] of Object.entries(buffs)) {
        if (!buffData || typeof buffData !== 'object') continue;

        const expiresAtRaw = buffData.expires_at || buffData.expiresAt || buffData.expires;
        if (!expiresAtRaw) continue;

        const expiresAt = typeof expiresAtRaw === 'number'
            ? expiresAtRaw
            : new Date(expiresAtRaw).getTime();

        if (Number.isFinite(expiresAt) && expiresAt > now) {
            active[effect] = {
                ...buffData,
                expires_at: expiresAt
            };
        }
    }

    return active;
}

/**
 * Проверка активности конкретного баффа
 */
function isBuffActive(value, effect, now = Date.now()) {
    return Boolean(getActiveBuffs(value, now)[effect]);
}

/**
 * Получить общий уровень инфекций
 */
function getInfectionLevel(value) {
    return normalizeInfections(value).reduce((sum, infection) => sum + (infection.level || 0), 0);
}

/**
 * Построение объекта статуса игрока
 */
function buildPlayerStatus(player) {
    const radiation = normalizeRadiation(player.radiation);
    const infectionsList = normalizeInfections(player.infections);

    return {
        health: Number(player.health || 0),
        max_health: Number(player.max_health || 0),
        radiation: radiation.level,
        fatigue: 0,
        energy: Number(player.energy || 0),
        max_energy: Number(player.max_energy || 0),
        infections: infectionsList.reduce((sum, infection) => sum + (infection.level || 0), 0),
        infections_list: infectionsList,
        last_energy_update: player.last_energy_update || null
    };
}

/**
 * Пересчёт энергии на основе реально прошедшего времени.
 * НЕ сбрасывает таймер при трате — реген идёт непрерывно.
 * @param {object} client - клиент БД (транзакция)
 * @param {object} player - объект игрока (мутирует energy/last_energy_update)
 * @returns {object} тот же player с обновлённой энергией
 */
async function recalcEnergy(client, player) {
    const now = Date.now();
    const last = new Date(player.last_energy_update).getTime();
    if (!Number.isFinite(last)) return player;

    const elapsedSec = Math.max(0, Math.floor((now - last) / 1000));
    const regen = Math.floor(elapsedSec / 60); // 1 энергия в минуту
    if (regen <= 0) return player;

    const currentEnergy = Number(player.energy || 0);
    const maxEnergy = Number(player.max_energy || 50);
    const newEnergy = Math.min(maxEnergy, currentEnergy + regen);

    if (newEnergy === currentEnergy) {
        // Игрок уже на максимуме: регенировать нечего, но ОБЯЗАНЫ двигать
        // last_energy_update. Иначе метка «застывает» на момент заполнения,
        // а потом любой расход (поиск/атака) мгновенно возвращается на клиенте:
        // getEffectivePlayerStatus() дочитывает реген с прошедшего времени.
        await client.query(
            'UPDATE players SET last_energy_update = $1 WHERE id = $2',
            [new Date(now).toISOString(), player.id]
        );
        player.last_energy_update = new Date(now).toISOString();
        return player;
    }

    // Сдвигаем метку на фактически восстановленное время
    const newLast = new Date(last + regen * 60000).toISOString();
    await client.query(
        `UPDATE players SET energy = $1, last_energy_update = $2 WHERE id = $3`,
        [newEnergy, newLast, player.id]
    );
    player.energy = newEnergy;
    player.last_energy_update = newLast;
    return player;
}

/**
 * Нормализация экипировки с валидацией слотов
 */
function normalizeEquipment(raw) {
    const eq = safeParseJson(raw, {});
    if (!eq || typeof eq !== 'object') return {};

    const VALID_SLOTS = ['weapon', 'armor', 'helmet', 'body', 'head', 'hands', 'legs', 'boots', 'accessory'];
    const out = {};
    for (const slot of VALID_SLOTS) {
        if (eq[slot] && typeof eq[slot] === 'object' && !Array.isArray(eq[slot])) {
            out[slot] = eq[slot];
        }
    }
    return out;
}

// ==========================================
// СИСТЕМА ДОСТИЖЕНИЙ (из achievements.js)
// ==========================================

/**
 * Получить текущее значение для проверки достижения
 */
function getAchievementCurrentValue(condition, player, runtimeContext) {
    switch (condition.type) {
        case 'level':
            return player.level || 1;
        case 'days_played':
            return player.days_played || 1;
        case 'bosses_killed':
        case 'boss_kills':
        case 'first_boss_kill':
            return runtimeContext?.totalBossesKilled || player.bosses_killed || 0;
        case 'single_boss_kills':
            return runtimeContext?.maxSingleBossKills || 0;
        case 'all_bosses_killed':
            return runtimeContext?.defeatedBosses || 0;
        case 'pvp_wins':
            return player.pvp_wins || 0;
        case 'unique_items':
            return Array.isArray(player.unique_items) ? player.unique_items.length : 0;
        case 'locations_visited':
            return Array.isArray(player.locations_visited) ? player.locations_visited.length : 0;
        case 'in_clan':
            return player.clan_id ? 1 : 0;
        case 'clan_leader':
            return player.clan_role === 'leader' ? 1 : 0;
        case 'clans_joined':
            return player.clans_joined || 0;
        case 'loot':
        case 'items_collected':
            return player.items_collected || 0;
        case 'streak':
            return player.daily_streak || 0;
        case 'referral':
        case 'referrals':
            return player.referrals || 0;
        default:
            return 0;
    }
}

/**
 * Получить целевое значение для достижения
 */
function getAchievementTargetValue(condition, runtimeContext) {
    if (condition.type === 'all_bosses_killed') {
        return Math.max(1, runtimeContext?.totalBosses || 0);
    }
    if (condition.type === 'first_boss_kill') {
        return 1;
    }
    if (condition.type === 'in_clan' || condition.type === 'clan_leader') {
        return 1;
    }
    return Number(condition.count || condition.value || 0);
}

/**
 * Получить контекст для достижений (данные из БД)
 */
async function getAchievementRuntimeContext(client, playerId) {
    const fn = client
        ? (sql, params) => client.query(sql, params).then(r => r.rows[0])
        : (sql, params) => query(sql, params).then(r => r.rows[0]);

    const row = await fn(`
        SELECT
            (SELECT COUNT(*) FROM bosses) AS total_bosses,
            (SELECT COUNT(DISTINCT boss_id) FROM boss_mastery WHERE player_id = $1 AND kills > 0) AS defeated_bosses,
            (SELECT COALESCE(MAX(kills), 0) FROM boss_mastery WHERE player_id = $1) AS max_single_boss_kills,
            (SELECT COALESCE(SUM(kills), 0) FROM boss_mastery WHERE player_id = $1) AS total_bosses_killed
    `, [playerId]);

    return {
        totalBosses: Number(row?.total_bosses || 0),
        defeatedBosses: Number(row?.defeated_bosses || 0),
        maxSingleBossKills: Number(row?.max_single_boss_kills || 0),
        totalBossesKilled: Number(row?.total_bosses_killed || 0)
    };
}

/**
 * Проверить и выдать достижения игроку (на основе таблицы achievements)
 * @param {number} playerId - ID игрока
 * @param {object} client - опциональный клиент БД для транзакций
 */
async function checkAchievements(playerId, client = null) {
    try {
        const fn = client
            ? (sql, params) => client.query(sql, params)
            : (sql, params) => query(sql, params);

        // Получаем все достижения из таблицы
        const achResult = await fn('SELECT * FROM achievements ORDER BY id', []);
        const achievements = achResult.rows || [];

        if (!achievements.length) return [];

        // Получаем уже выданные достижения
        const ownedResult = await fn(
            'SELECT achievement_id FROM player_achievements WHERE player_id = $1 AND completed = true',
            [playerId]
        );
        const owned = new Set(ownedResult.rows?.map(r => r.achievement_id) || []);

        // Получаем данные игрока
        const playerResult = await fn(
            `SELECT level, bosses_killed, pvp_wins, items_collected,
                    daily_streak, referrals, unique_items, locations_visited,
                    clan_id, clan_role, clans_joined
             FROM players WHERE id = $1`,
            [playerId]
        );
        const player = playerResult.rows?.[0];
        if (!player) return [];

        // Получаем контекст для достижений
        const runtimeContext = await getAchievementRuntimeContext(client, playerId);

        const newAchievements = [];

        for (const ach of achievements) {
            if (owned.has(ach.id)) continue;

            const condition = safeParseJson(ach.condition, {});
            if (!condition.type) continue;

            const currentValue = getAchievementCurrentValue(condition, player, runtimeContext);
            const targetValue = getAchievementTargetValue(condition, runtimeContext);

            if (currentValue >= targetValue) {
                // Выдаём достижение — используем переданный client или tx()
                const wasInserted = client
                    ? await insertAchievement(client, playerId, ach, currentValue)
                    : await tx(async (txClient) => {
                        return await insertAchievement(txClient, playerId, ach, currentValue);
                    });

                if (wasInserted) {
                    const reward = safeParseJson(ach.reward, {});
                    newAchievements.push({
                        id: ach.id,
                        name: ach.name,
                        description: ach.description,
                        reward: reward
                    });
                }
            }
        }

        return newAchievements;
    } catch (err) {
        logger.error({ type: 'check_achievements_error', message: err.message, stack: err.stack });
        return [];
    }
}

/**
 * Вставить достижение и выдать награду (в транзакции)
 */
async function insertAchievement(client, playerId, ach, progressValue) {
    const reward = safeParseJson(ach.reward, {});

    // Вставляем или обновляем достижение
    const insertResult = await client.query(
        `INSERT INTO player_achievements (player_id, achievement_id, progress_value, completed, completed_at, reward_claimed)
         VALUES ($1, $2, $3, true, NOW(), false)
         ON CONFLICT (player_id, achievement_id)
         DO UPDATE SET completed = true, completed_at = NOW(), progress_value = $3
         RETURNING id`,
        [playerId, ach.id, progressValue]
    );

    if (insertResult.rowCount === 0) return false;

    // Выдаём награду
    const updates = [];
    const params = [playerId];
    let paramIndex = 2;

    if (reward.coins && reward.coins > 0) {
        updates.push(`coins = coins + $${paramIndex}`);
        params.push(reward.coins);
        paramIndex++;
    }

    if (reward.stars && reward.stars > 0) {
        updates.push(`stars = stars + $${paramIndex}`);
        params.push(reward.stars);
        paramIndex++;
    }

    if (updates.length > 0) {
        await client.query(
            `UPDATE players SET ${updates.join(', ')} WHERE id = $1`,
            params
        );
    }

    logger.info({
        type: 'achievement_unlocked',
        playerId,
        achievement: ach.name,
        reward
    });

    return true;
}

/**
 * Получить все достижения игрока
 */
async function getPlayerAchievements(playerId) {
    try {
        const result = await query(`
            SELECT a.id, a.name, a.description, a.category, a.icon, a.rarity,
                   a.condition, a.reward,
                   pa.completed, pa.completed_at, pa.reward_claimed, pa.progress_value
            FROM achievements a
            LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
            ORDER BY a.category, a.id
        `, [playerId]);

        return (result.rows || []).map(row => ({
            id: row.id,
            key: String(row.id),
            name: row.name,
            desc: row.description,
            type: row.category,
            category: row.category,
            icon: row.icon,
            rarity: row.rarity,
            req: safeParseJson(row.condition, {}).count || 0,
            reward: safeParseJson(row.reward, {}).stars || 0,
            obtained: row.completed || false,
            rewarded_at: row.completed_at,
            reward_claimed: row.reward_claimed || false,
            progress_value: row.progress_value || 0
        }));
    } catch (err) {
        logger.error({ type: 'get_achievements_error', message: err.message });
        return [];
    }
}

/**
 * Получить прогресс игрока по всем типам достижений
 */
async function getPlayerProgress(playerId) {
    try {
        const playerResult = await query(
            `SELECT level, bosses_killed, pvp_wins, items_collected,
                    daily_streak, referrals
             FROM players WHERE id = $1`,
            [playerId]
        );

        if (!playerResult.rows.length) return null;

        const p = playerResult.rows[0];
        const runtimeContext = await getAchievementRuntimeContext(null, playerId);

        const progress = {
            level: { current: p.level, achievements: [] },
            boss: { current: runtimeContext.totalBossesKilled || p.bosses_killed || 0, achievements: [] },
            pvp: { current: p.pvp_wins || 0, achievements: [] },
            loot: { current: p.items_collected || 0, achievements: [] },
            streak: { current: p.daily_streak || 0, achievements: [] },
            referral: { current: p.referrals || 0, achievements: [] }
        };

        // Заполняем прогресс по каждому типу
        const achievementsResult = await query('SELECT * FROM achievements ORDER BY id');
        const achievements = achievementsResult.rows || [];

        for (const ach of achievements) {
            const condition = safeParseJson(ach.condition, {});
            const type = condition.type || '';
            const category = ach.category || '';

            // Определяем тип прогресса
            let progressType = null;
            if (type === 'level') progressType = 'level';
            else if (type.includes('boss')) progressType = 'boss';
            else if (type === 'pvp_wins') progressType = 'pvp';
            else if (type === 'loot' || type === 'items_collected') progressType = 'loot';
            else if (type === 'streak') progressType = 'streak';
            else if (type === 'referral' || type === 'referrals') progressType = 'referral';
            else if (category && progress[category]) progressType = category;

            if (progressType && progress[progressType]) {
                const targetValue = getAchievementTargetValue(condition, runtimeContext);
                progress[progressType].achievements.push({
                    id: ach.id,
                    name: ach.name,
                    req: targetValue,
                    current: progress[progressType].current,
                    completed: progress[progressType].current >= targetValue
                });
            }
        }

        return progress;
    } catch (err) {
        logger.error({ type: 'get_progress_error', message: err.message });
        return null;
    }
}

/**
 * Инициализировать таблицу достижений.
 * P2-12: единый источник теперь schema.js (4 базовых ачивки).
 * Старый набор из 19 записей больше не вставляется, чтобы не дублировать
 * и не путать UI. Функция оставлена для обратной совместимости вызовов.
 */
async function initAchievementsTable() {
    const countResult = await query('SELECT COUNT(*) as cnt FROM achievements');
    const count = Number(countResult.rows[0]?.cnt || 0);

    if (count === 0) {
        logger.warn('[achievements] таблица achievements пуста — ожидается наполнение через db/schema.js (миграции). Старый набор не вставляется во избежание дублей.');
    }
    return count;
}

// ==========================================
// ЭКСПОРТ
// ==========================================

module.exports = {
    // Функции состояния игрока
    safeParseJson,
    normalizeInventory,
    normalizeItemStats,
    createInventoryItem,
    getInventoryItemCategory,
    normalizeRadiation,
    normalizeInfections,
    normalizePlayerBuffs,
    getActiveBuffs,
    isBuffActive,
    getInfectionLevel,
    buildPlayerStatus,
    recalcEnergy,
    normalizeEquipment,
calculateSellPrice,
addItemToInventory,
SELL_RATE,
SELL_FLOOR_BY_RARITY,
    
    // Функции достижений (achievements.js)
    getAchievementCurrentValue,
    getAchievementTargetValue,
    getAchievementRuntimeContext,
    checkAchievements,
    getPlayerAchievements,
    getPlayerProgress,
    initAchievementsTable
};
