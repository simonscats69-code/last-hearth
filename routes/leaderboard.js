/**
 * Leaderboard API маршруты
 * Рейтинги игроков и кланов
 * Требуется авторизация через Telegram (валидация initData)
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { telegramAuthMiddleware, isAdmin, logger } = require('../utils/serverApi');

// Middleware для проверки авторизации игрока
// ВАЖНО: требуем telegramUser от telegramAuthMiddleware
function requireAuth(req, res, next) {
    // Проверяем наличие telegramUser от telegramAuthMiddleware
    if (!req.telegramUser) {
        return res.status(401).json({ error: 'Требуется валидная авторизация Telegram' });
    }
    next();
}

// Применяем middleware авторизации ко всем маршрутам
router.use(telegramAuthMiddleware);
router.use(requireAuth);

/**
 * Получить топ игроков с гибкой сортировкой
 * GET /players?sort=level|strength|bosses|pvp&limit=10
 * 
 * Примеры:
 * GET /players?sort=level - по уровню
 * GET /players?sort=strength - по силе
 * GET /players?sort=bosses - по убитым боссам
 * GET /players?sort=pvp - по победам в PvP
 */
router.get('/players', async (req, res) => {
    try {
        const sort = req.query.sort || 'level';
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        // Определяем поле сортировки и дополнительные поля
        let orderBy, whereClause, selectFields;
        
        switch (sort) {
            case 'strength':
                orderBy = 'strength DESC';
                whereClause = 'WHERE banned = false';
                selectFields = 'telegram_id, username, level, strength';
                break;
            case 'bosses':
                orderBy = 'bosses_killed DESC';
                whereClause = 'WHERE banned = false AND bosses_killed > 0';
                selectFields = 'telegram_id, username, level, bosses_killed';
                break;
            case 'pvp':
                orderBy = 'pvp_wins DESC';
                whereClause = 'WHERE banned = false AND (pvp_wins > 0 OR pvp_losses > 0)';
                selectFields = 'telegram_id, username, level, pvp_wins, pvp_losses';
                break;
            case 'level':
            default:
                orderBy = 'level DESC, experience DESC';
                whereClause = 'WHERE banned = false';
                selectFields = 'telegram_id, username, level, strength, experience';
                break;
        }
        
        // Оптимизировано: COUNT(*) OVER() вместо подзапроса
        const result = await query(
            `SELECT ${selectFields}, COUNT(*) OVER() as total_players
             FROM players 
             ${orderBy} 
             LIMIT $1`,
            [limit]
        );
        
        const leaderboard = result.rows.map((player, index) => {
            const entry = {
                rank: index + 1,
                telegram_id: player.telegram_id,
                username: player.username,
                level: player.level,
                total_players: parseInt(player.total_players, 10)
            };
            
            // Добавляем специфичные поля в зависимости от сортировки
            switch (sort) {
                case 'strength':
                case 'level':
                    entry.strength = player.strength;
                    break;
                case 'level':
                    entry.experience = player.experience;
                    break;
                case 'bosses':
                    entry.bosses_killed = player.bosses_killed;
                    break;
                case 'pvp':
                    entry.pvp_wins = player.pvp_wins;
                    entry.pvp_losses = player.pvp_losses;
                    entry.win_rate = player.pvp_losses > 0 
                        ? Math.round((player.pvp_wins / (player.pvp_wins + player.pvp_losses)) * 100)
                        : 100;
                    break;
            }
            
            return entry;
        });
        
        res.json({ success: true, leaderboard, sort });
    } catch (err) {
        logger.error('[leaderboard] Ошибка получения рейтинга игроков', { error: err.message });
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Получить топ кланов
router.get('/clans', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        const result = await query(
            `SELECT c.id,
                    c.name,
                    c.leader_id,
                    c.level,
                    (SELECT COUNT(*) FROM players p2 WHERE p2.clan_id = c.id) AS members_count,
                     COALESCE(SUM(p.level), 0) as total_levels,
                     COUNT(*) OVER() as total_clans
              FROM clans c
             LEFT JOIN players p ON p.clan_id = c.id
             GROUP BY c.id
             ORDER BY c.level DESC, total_levels DESC
             LIMIT $1`,
            [limit]
        );
        
        const leaderboard = result.rows.map((clan, index) => ({
            rank: index + 1,
            id: clan.id,
            name: clan.name,
            leader_id: clan.leader_id,
            level: clan.level,
            members_count: clan.members_count,
            total_levels: parseInt(clan.total_levels, 10),
            total_clans: parseInt(clan.total_clans, 10)
        }));
        
        res.json({ success: true, leaderboard });
    } catch (err) {
        logger.error('[leaderboard] Ошибка получения рейтинга кланов', { error: err.message });
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Получить позицию игрока в рейтингах
router.get('/my-position/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // Уровень
        const levelRank = await query(
            `SELECT COUNT(*) + 1 as rank 
             FROM players 
             WHERE banned = false AND (level > (SELECT level FROM players WHERE telegram_id = $1) 
                OR (level = (SELECT level FROM players WHERE telegram_id = $1) 
                    AND experience > (SELECT experience FROM players WHERE telegram_id = $1)))`,
            [telegramId]
        );
        
        // Сила
        const strengthRank = await query(
            `SELECT COUNT(*) + 1 as rank 
             FROM players 
             WHERE banned = false AND strength > (SELECT strength FROM players WHERE telegram_id = $1)`,
            [telegramId]
        );
        
        // Боссы
        const bossRank = await query(
            `SELECT COUNT(*) + 1 as rank 
             FROM players 
             WHERE banned = false AND bosses_killed > (SELECT bosses_killed FROM players WHERE telegram_id = $1)`,
            [telegramId]
        );
        
        res.json({
            success: true,
            position: {
                level_rank: parseInt(levelRank.rows[0].rank, 10),
                strength_rank: parseInt(strengthRank.rows[0].rank, 10),
                boss_rank: parseInt(bossRank.rows[0].rank, 10)
            }
        });
    } catch (err) {
        logger.error('[leaderboard] Ошибка получения позиции', { error: err.message });
        res.status(500).json({ error: 'Ошибка получения позиции' });
    }
});

module.exports = router;
