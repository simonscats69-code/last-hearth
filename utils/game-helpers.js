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

const ENERGY_REGEN_INTERVAL_MS = 60 * 1000;

/**
 * Безопасный парсинг JSON с fallback значением
 */
function safeParseJson(value, fallback) {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    if (typeof value === 'object') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

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
 * Нормализация stats предмета
 */
function normalizeItemStats(value) {
    const parsed = safeParseJson(value, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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
        max_durability: Number(options.max_durability ?? source.max_durability ?? source.durability ?? durability),
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
    const parsed = safeParseJson(value, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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
                expires_at: new Date(expiresAt).toISOString()
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

// ==========================================
// СИСТЕМА ДОСТИЖЕНИЙ (из achievements.js)
// ==========================================

// Список достижений
const ACHIEVEMENTS = {
    // Уровень
    level_5: { name: 'Выживший', desc: 'Достигни 5 уровня', type: 'level', req: 5, reward: 10 },
    level_10: { name: 'Опытный выживший', desc: 'Достигни 10 уровня', type: 'level', req: 10, reward: 25 },
    level_25: { name: 'Ветеран', desc: 'Достигни 25 уровня', type: 'level', req: 25, reward: 50 },
    level_50: { name: 'Мастер выживания', desc: 'Достигни 50 уровня', type: 'level', req: 50, reward: 100 },
    
    // Боссы
    boss_1: { name: 'Первый враг', desc: 'Убей 1 босса', type: 'boss', req: 1, reward: 15 },
    boss_5: { name: 'Охотник на монстров', desc: 'Убей 5 боссов', type: 'boss', req: 5, reward: 30 },
    boss_10: { name: 'Убийца гигантов', desc: 'Убей 10 боссов', type: 'boss', req: 10, reward: 50 },
    boss_25: { name: 'Герой', desc: 'Убей 25 боссов', type: 'boss', req: 25, reward: 100 },
    
    // PvP
    pvp_1: { name: 'Первая кровь', desc: 'Выиграй 1 PvP бой', type: 'pvp', req: 1, reward: 10 },
    pvp_10: { name: 'Боец', desc: 'Выиграй 10 PvP боёв', type: 'pvp', req: 10, reward: 40 },
    pvp_50: { name: 'Воин', desc: 'Выиграй 50 PvP боёв', type: 'pvp', req: 50, reward: 100 },
    
    // Loot
    loot_100: { name: 'Собиратель', desc: 'Собери 100 предметов', type: 'loot', req: 100, reward: 20 },
    loot_500: { name: 'Кладовщик', desc: 'Собери 500 предметов', type: 'loot', req: 500, reward: 50 },
    loot_1000: { name: 'Король добычи', desc: 'Собери 1000 предметов', type: 'loot', req: 1000, reward: 100 },
    
    // Играть каждый день
    streak_3: { name: 'Начинающий', desc: 'Играй 3 дня подряд', type: 'streak', req: 3, reward: 20 },
    streak_7: { name: 'Постоянный', desc: 'Играй 7 дней подряд', type: 'streak', req: 7, reward: 50 },
    streak_30: { name: 'Преданный', desc: 'Играй 30 дней подряд', type: 'streak', req: 30, reward: 200 },
    
    // Рефералы
    referral_1: { name: 'Командор', desc: 'Пригласи 1 друга', type: 'referral', req: 1, reward: 30 },
    referral_5: { name: 'Лидер отряда', desc: 'Пригласи 5 друзей', type: 'referral', req: 5, reward: 100 },
};

/**
 * Проверить и выдать достижения игроку
 * @param {number} playerId - ID игрока
 * @param {object} stats - Статистика игрока
 */
async function checkAchievements(playerId, stats) {
    try {
        const newAchievements = [];
        
        // Получаем текущие достижения игрока
        const ownedResult = await query(
            'SELECT achievement_key FROM player_achievements WHERE player_id = $1',
            [playerId]
        );
        const owned = new Set(ownedResult.rows.map(r => r.achievement_key));
        
        // Проверяем каждое достижение
        for (const [key, ach] of Object.entries(ACHIEVEMENTS)) {
            if (owned.has(key)) continue; // Уже получено
            
            let value = 0;
            switch (ach.type) {
                case 'level': value = stats.level || 0; break;
                case 'boss': value = stats.bosses_killed || 0; break;
                case 'pvp': value = stats.pvp_wins || 0; break;
                case 'loot': value = stats.items_collected || 0; break;
                case 'streak': value = stats.daily_streak || 0; break;
                case 'referral': value = stats.referrals || 0; break;
            }
            
            if (value >= ach.req) {
                // Выдаём достижение и награду в транзакции
                await tx(async (client) => {
                    // Проверяем ещё раз, чтобы избежать дубликатов
                    const existing = await client.query(
                        'SELECT id FROM player_achievements WHERE player_id = $1 AND achievement_key = $2',
                        [playerId, key]
                    );
                    
                    if (existing.rows.length > 0) {
                        return; // Уже получено другим процессом
                    }
                    
                    // Выдаём достижение
                    await client.query(
                        `INSERT INTO player_achievements (player_id, achievement_key, rewarded_at) 
                         VALUES ($1, $2, NOW())`,
                        [playerId, key]
                    );
                    
                    // Начисляем награду
                    if (ach.reward > 0) {
                        await client.query(
                            'UPDATE players SET stars = stars + $1 WHERE id = $2',
                            [ach.reward, playerId]
                        );
                    }
                });
                
                newAchievements.push({
                    key,
                    name: ach.name,
                    desc: ach.desc,
                    reward: ach.reward
                });
                
                logger.info({ 
                    type: 'achievement_unlocked', 
                    playerId, 
                    achievement: key,
                    reward: ach.reward 
                });
            }
        }
        
        return newAchievements;
    } catch (err) {
        logger.error({ type: 'check_achievements_error', message: err.message });
        return [];
    }
}

/**
 * Получить все достижения игрока
 */
async function getPlayerAchievements(playerId) {
    try {
        const ownedResult = await query(
            'SELECT achievement_key, rewarded_at FROM player_achievements WHERE player_id = $1 AND achievement_key IS NOT NULL',
            [playerId]
        );
        const owned = new Map(ownedResult.rows.map(r => [r.achievement_key, r.rewarded_at]));
        
        const result = [];
        for (const [key, ach] of Object.entries(ACHIEVEMENTS)) {
            result.push({
                key,
                name: ach.name,
                desc: ach.desc,
                type: ach.type,
                req: ach.req,
                reward: ach.reward,
                obtained: owned.has(key),
                rewarded_at: owned.get(key) || null
            });
        }
        
        return result;
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
        
        const progress = {
            level: { current: p.level, achievements: [] },
            boss: { current: p.bosses_killed || 0, achievements: [] },
            pvp: { current: p.pvp_wins || 0, achievements: [] },
            loot: { current: p.items_collected || 0, achievements: [] },
            streak: { current: p.daily_streak || 0, achievements: [] },
            referral: { current: p.referrals || 0, achievements: [] }
        };
        
        // Заполняем прогресс по каждому типу
        for (const [key, ach] of Object.entries(ACHIEVEMENTS)) {
            if (progress[ach.type]) {
                progress[ach.type].achievements.push({
                    key,
                    name: ach.name,
                    req: ach.req,
                    current: progress[ach.type].current,
                    completed: progress[ach.type].current >= ach.req
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
 * Инициализировать таблицу достижений
 */
async function initAchievementsTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS player_achievements (
            id SERIAL PRIMARY KEY,
            player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
            achievement_key VARCHAR(50) NOT NULL,
            rewarded_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(player_id, achievement_key)
        );
        
        CREATE INDEX IF NOT EXISTS idx_achievements_player ON player_achievements(player_id);
    `);

    // Совмещаем старую key-based систему достижений с новой таблицей из схемы БД.
    await query(`ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS achievement_key VARCHAR(50)`);
    await query(`ALTER TABLE player_achievements ADD COLUMN IF NOT EXISTS rewarded_at TIMESTAMP DEFAULT NOW()`);
    await query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_player_achievements_player_key
        ON player_achievements(player_id, achievement_key)
        WHERE achievement_key IS NOT NULL
    `);
}

// ==========================================
// ЭКСПОРТ
// ==========================================

module.exports = {
    // Функции состояния игрока (playerState.js)
    ENERGY_REGEN_INTERVAL_MS,
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
    
    // Функции достижений (achievements.js)
    ACHIEVEMENTS,
    checkAchievements,
    getPlayerAchievements,
    getPlayerProgress,
    initAchievementsTable
};
