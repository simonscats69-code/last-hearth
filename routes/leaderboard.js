/**
 * Leaderboard API маршруты
 * Рейтинги игроков и кланов
 * Требуется авторизация через Telegram (валидация initData)
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { telegramAuthMiddleware, isAdmin } = require('../utils/telegramAuth');
const { logger } = require('../utils/logger');

// Middleware для проверки авторизации игрока
function requireAuth(req, res, next) {
    // Проверяем наличие telegramUser от telegramAuthMiddleware
    if (!req.telegramUser && !req.headers['x-telegram-id']) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    next();
}

// Применяем middleware авторизации ко всем маршрутам
router.use(telegramAuthMiddleware);
router.use(requireAuth);

// Получить топ игроков по уровню
router.get('/players/level', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        const result = await query(
            `SELECT telegram_id, username, level, strength, experience, 
                    (SELECT COUNT(*) FROM players) as total_players
             FROM players 
             WHERE banned = false
             ORDER BY level DESC, experience DESC 
             LIMIT $1`,
            [limit]
        );
        
        const leaderboard = result.rows.map((player, index) => ({
            rank: index + 1,
            telegram_id: player.telegram_id,
            username: player.username,
            level: player.level,
            strength: player.strength,
            experience: player.experience,
            total_players: parseInt(player.total_players, 10)
        }));
        
        res.json({ success: true, leaderboard });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Получить топ игроков по силе
router.get('/players/strength', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        const result = await query(
            `SELECT telegram_id, username, level, strength,
                    (SELECT COUNT(*) FROM players) as total_players
             FROM players 
             WHERE banned = false
             ORDER BY strength DESC 
             LIMIT $1`,
            [limit]
        );
        
        const leaderboard = result.rows.map((player, index) => ({
            rank: index + 1,
            telegram_id: player.telegram_id,
            username: player.username,
            level: player.level,
            strength: player.strength,
            total_players: parseInt(player.total_players, 10)
        }));
        
        res.json({ success: true, leaderboard });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Получить топ игроков по убитым боссам
router.get('/players/bosses', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        const result = await query(
            `SELECT telegram_id, username, level, bosses_killed,
                    (SELECT COUNT(*) FROM players) as total_players
             FROM players 
             WHERE banned = false AND bosses_killed > 0
             ORDER BY bosses_killed DESC 
             LIMIT $1`,
            [limit]
        );
        
        const leaderboard = result.rows.map((player, index) => ({
            rank: index + 1,
            telegram_id: player.telegram_id,
            username: player.username,
            level: player.level,
            bosses_killed: player.bosses_killed,
            total_players: parseInt(player.total_players, 10)
        }));
        
        res.json({ success: true, leaderboard });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Получить топ игроков в PvP
router.get('/players/pvp', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        const result = await query(
            `SELECT telegram_id, username, level, pvp_wins, pvp_losses,
                    (SELECT COUNT(*) FROM players) as total_players
             FROM players 
             WHERE banned = false AND (pvp_wins > 0 OR pvp_losses > 0)
             ORDER BY pvp_wins DESC 
             LIMIT $1`,
            [limit]
        );
        
        const leaderboard = result.rows.map((player, index) => ({
            rank: index + 1,
            telegram_id: player.telegram_id,
            username: player.username,
            level: player.level,
            pvp_wins: player.pvp_wins,
            pvp_losses: player.pvp_losses,
            win_rate: player.pvp_losses > 0 
                ? Math.round((player.pvp_wins / (player.pvp_wins + player.pvp_losses)) * 100)
                : 100,
            total_players: parseInt(player.total_players, 10)
        }));
        
        res.json({ success: true, leaderboard });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

// Получить топ кланов
router.get('/clans', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        
        const result = await query(
            `SELECT c.id, c.name, c.leader_id, c.level, c.members_count,
                    COALESCE(SUM(p.level), 0) as total_levels,
                    (SELECT COUNT(*) FROM clans) as total_clans
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
        res.status(500).json({ error: 'Ошибка получения позиции' });
    }
});

module.exports = router;
