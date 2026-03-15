/**
 * Система достижений
 * Достижения и прогрессия игроков
 */

const { query, transaction: tx } = require('../db/database');
const { logger } = require('../utils/logger');

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
    
    // Лoot
    loot_100: { name: 'Собиратель', desc: 'Собери 100 предметов', type: 'loot', req: 100, reward: 20 },
    loot_500: { name: 'Кладовщик', desc: 'Собери 500 предметов', type: 'loot', req: 500, reward: 50 },
    loot_1000: { name: 'Король добычи', desc: 'Собери 1000 предметов', type: 'loot', req: 1000, reward: 100 },
    
    // Крафт
    craft_10: { name: 'Новичок крафтер', desc: 'Скрафти 10 предметов', type: 'craft', req: 10, reward: 15 },
    craft_50: { name: 'Мастер крафта', desc: 'Скрафти 50 предметов', type: 'craft', req: 50, reward: 40 },
    
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
                case 'craft': value = stats.items_crafted || 0; break;
                case 'streak': value = stats.daily_streak || 0; break;
                case 'referral': value = stats.referrals || 0; break;
            }
            
            if (value >= ach.req) {
                // Выдаём достижение и награду в транзакции
                await tx(async () => {
                    // Проверяем ещё раз, чтобы избежать дубликатов
                    const existing = await query(
                        'SELECT id FROM player_achievements WHERE player_id = $1 AND achievement_key = $2',
                        [playerId, key]
                    );
                    
                    if (existing.rows.length > 0) {
                        return; // Уже получено другим процессом
                    }
                    
                    // Выдаём достижение
                    await query(
                        `INSERT INTO player_achievements (player_id, achievement_key, rewarded_at) 
                         VALUES ($1, $2, NOW())`,
                        [playerId, key]
                    );
                    
                    // Начисляем награду
                    if (ach.reward > 0) {
                        await query(
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
            'SELECT achievement_key, rewarded_at FROM player_achievements WHERE player_id = $1',
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
                    items_crafted, daily_streak, referrals
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
            craft: { current: p.items_crafted || 0, achievements: [] },
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
}

module.exports = {
    ACHIEVEMENTS,
    checkAchievements,
    getPlayerAchievements,
    getPlayerProgress,
    initAchievementsTable
};
