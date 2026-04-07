/**
 * Admin API маршруты
 * Управление игроками, боссами, статистикой
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { isAdmin, telegramAuthMiddleware, logger } = require('../utils/serverApi');

// Применяем telegramAuthMiddleware ко всем admin роутам
// Это устанавливает req.telegramUser после валидации подписи Telegram
router.use(telegramAuthMiddleware);

// Middleware для проверки админа
// ВАЖНО: используем req.telegramUser установленный telegramAuthMiddleware
function requireAdmin(req, res, next) {
    // Сначала проверяем что пользователь прошёл валидацию Telegram
    if (!req.telegramUser) {
        return res.status(401).json({ error: 'Требуется валидная авторизация Telegram' });
    }
    
    const adminIds = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);
    const telegramId = String(req.telegramUser.id);
    
    if (!adminIds.includes(telegramId)) {
        logger.warn({ type: 'admin_access_denied', telegramId });
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    next();
}

// Получить статистику сервера
router.get('/stats', requireAdmin, async (req, res) => {
    try {
        const stats = {};
        
        // Количество игроков
        const playersResult = await query('SELECT COUNT(*) as count FROM players');
        stats.totalPlayers = parseInt(playersResult.rows[0].count, 10);
        
        // Количество кланов
        const clansResult = await query('SELECT COUNT(*) as count FROM clans');
        stats.totalClans = parseInt(clansResult.rows[0].count, 10);
        
        // Активные игроки за последние 24 часа
        const activeResult = await query(
            "SELECT COUNT(*) as count FROM players WHERE last_action_time > NOW() - INTERVAL '24 hours'"
        );
        stats.activePlayers24h = parseInt(activeResult.rows[0].count, 10);
        
        // Топ игроки по уровню
        const topResult = await query(
            'SELECT telegram_id, username, level, strength FROM players ORDER BY level DESC LIMIT 10'
        );
        stats.topPlayers = topResult.rows;
        
        res.json({ success: true, stats });
    } catch (err) {
        logger.error({ type: 'admin_stats_error', message: err.message });
        res.status(500).json({ error: 'Ошибка получения статистики' });
    }
});

// Получить информацию о игроке
router.get('/player/:telegramId', requireAdmin, async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // Валидация telegramId
        if (!telegramId || isNaN(Number(telegramId))) {
            return res.status(400).json({ error: 'Некорректный Telegram ID' });
        }
        
        const result = await query(
            `SELECT telegram_id, username, level, strength, endurance, agility, 
                    intelligence, luck, health, radiation,
                    energy, max_energy, experience, created_at, last_action_time
             FROM players WHERE telegram_id = $1`,
            [telegramId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }
        
        res.json({ success: true, player: result.rows[0] });
    } catch (err) {
        logger.error({ type: 'admin_player_error', message: err.message });
        res.status(500).json({ error: 'Ошибка получения игрока' });
    }
});

// Изменить ресурсы игрока
router.post('/player/:telegramId/resources', requireAdmin, async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // Валидация telegramId
        if (!telegramId || isNaN(Number(telegramId))) {
            return res.status(400).json({ error: 'Некорректный Telegram ID' });
        }
        
        const { energy, health, experience, items } = req.body;
        
        // Whitelist допустимых полей для обновления
        const ALLOWED_FIELDS = ['energy', 'health', 'experience'];
        
        // Валидация входных данных
        if (energy !== undefined) {
            if (!Number.isInteger(energy) || energy < 0 || energy > 10000) {
                return res.status(400).json({ error: 'energy должен быть целым числом от 0 до 10000' });
            }
        }
        
        if (health !== undefined) {
            if (!Number.isInteger(health) || health < 0 || health > 10000) {
                return res.status(400).json({ error: 'health должен быть целым числом от 0 до 10000' });
            }
        }
        
        if (experience !== undefined) {
            if (!Number.isInteger(experience) || experience < 0 || experience > 1000000) {
                return res.status(400).json({ error: 'experience должен быть целым числом от 0 до 1000000' });
            }
        }
        
        let updates = [];
        let values = [];
        let paramIndex = 1;
        
        // Проверяем каждое поле по whitelist
        if (energy !== undefined) {
            if (!ALLOWED_FIELDS.includes('energy')) {
                return res.status(400).json({ error: 'Недопустимое поле: energy' });
            }
            updates.push(`energy = $${paramIndex++}`);
            values.push(energy);
        }
        
        if (health !== undefined) {
            if (!ALLOWED_FIELDS.includes('health')) {
                return res.status(400).json({ error: 'Недопустимое поле: health' });
            }
            updates.push(`health = $${paramIndex++}`);
            values.push(health);
        }
        
        if (experience !== undefined) {
            if (!ALLOWED_FIELDS.includes('experience')) {
                return res.status(400).json({ error: 'Недопустимое поле: experience' });
            }
            updates.push(`experience = $${paramIndex++}`);
            values.push(experience);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'Не указаны ресурсы для изменения' });
        }
        
        values.push(telegramId);
        
        const result = await query(
            `UPDATE players SET ${updates.join(', ')} WHERE telegram_id = $${paramIndex} RETURNING *`,
            values
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }
        
        logger.info({ 
            type: 'admin_resource_change', 
            telegramId, 
            changes: { energy, health, experience },
            admin: req.headers['x-telegram-id']
        });
        
        res.json({ success: true, player: result.rows[0] });
    } catch (err) {
        logger.error({ type: 'admin_resource_error', message: err.message });
        res.status(500).json({ error: 'Ошибка изменения ресурсов' });
    }
});

// Забанить игрока
router.post('/player/:telegramId/ban', requireAdmin, async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // Валидация telegramId
        if (!telegramId || isNaN(Number(telegramId))) {
            return res.status(400).json({ error: 'Некорректный Telegram ID' });
        }
        
        const { reason } = req.body;
        
        const result = await query(
            "UPDATE players SET banned = true, ban_reason = $1 WHERE telegram_id = $2 RETURNING *",
            [reason || 'Нарушение правил', telegramId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }
        
        logger.info({ 
            type: 'player_banned', 
            telegramId, 
            reason,
            admin: req.headers['x-telegram-id']
        });
        
        res.json({ success: true, message: 'Игрок заблокирован' });
    } catch (err) {
        logger.error({ type: 'admin_ban_error', message: err.message });
        res.status(500).json({ error: 'Ошибка бана' });
    }
});

// Разбанить игрока
router.post('/player/:telegramId/unban', requireAdmin, async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // Валидация telegramId
        if (!telegramId || isNaN(Number(telegramId))) {
            return res.status(400).json({ error: 'Некорректный Telegram ID' });
        }
        
        const result = await query(
            "UPDATE players SET banned = false, ban_reason = NULL WHERE telegram_id = $1 RETURNING *",
            [telegramId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }
        
        logger.info({ 
            type: 'player_unbanned', 
            telegramId,
            admin: req.headers['x-telegram-id']
        });
        
        res.json({ success: true, message: 'Игрок разблокирован' });
    } catch (err) {
        logger.error({ type: 'admin_unban_error', message: err.message });
        res.status(500).json({ error: 'Ошибка разбана' });
    }
});

// Получить список заблокированных игроков
router.get('/banned', requireAdmin, async (req, res) => {
    try {
        const result = await query(
            "SELECT telegram_id, username, ban_reason, last_action_time FROM players WHERE banned = true"
        );
        
        res.json({ success: true, players: result.rows });
    } catch (err) {
        logger.error({ type: 'admin_banned_list_error', message: err.message });
        res.status(500).json({ error: 'Ошибка получения списка' });
    }
});

// Управление боссами - получить всех боссов
router.get('/bosses', requireAdmin, async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM bosses ORDER BY level'
        );
        
        res.json({ success: true, bosses: result.rows });
    } catch (err) {
        logger.error({ type: 'admin_bosses_error', message: err.message });
        res.status(500).json({ error: 'Ошибка получения боссов' });
    }
});

// Изменить босса
router.put('/bosses/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, health, damage, reward_exp, reward_items } = req.body;
        
        // Whitelist допустимых полей для обновления босса
        const ALLOWED_FIELDS = ['name', 'health', 'damage', 'reward_exp', 'reward_items'];
        
        let updates = [];
        let values = [];
        let paramIndex = 1;
        
        if (name !== undefined) {
            if (typeof name !== 'string' || name.length > 100) {
                return res.status(400).json({ error: 'name должен быть строкой до 100 символов' });
            }
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (health !== undefined) {
            if (!Number.isInteger(health) || health < 1 || health > 1000000) {
                return res.status(400).json({ error: 'health должен быть целым числом от 1 до 1000000' });
            }
            updates.push(`health = $${paramIndex++}`);
            values.push(health);
        }
        if (damage !== undefined) {
            if (!Number.isInteger(damage) || damage < 0 || damage > 100000) {
                return res.status(400).json({ error: 'damage должен быть целым числом от 0 до 100000' });
            }
            updates.push(`damage = $${paramIndex++}`);
            values.push(damage);
        }
        if (reward_exp !== undefined) {
            if (!Number.isInteger(reward_exp) || reward_exp < 0 || reward_exp > 1000000) {
                return res.status(400).json({ error: 'reward_exp должен быть целым числом от 0 до 1000000' });
            }
            updates.push(`reward_exp = $${paramIndex++}`);
            values.push(reward_exp);
        }
        if (reward_items !== undefined) {
            if (!Array.isArray(reward_items)) {
                return res.status(400).json({ error: 'reward_items должен быть массивом' });
            }
            updates.push(`reward_items = $${paramIndex++}`);
            values.push(JSON.stringify(reward_items));
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'Не указаны данные для изменения' });
        }
        
        values.push(id);
        
        const result = await query(
            `UPDATE bosses SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Босс не найден' });
        }
        
        logger.info({ 
            type: 'boss_updated', 
            bossId: id, 
            changes: req.body,
            admin: req.headers['x-telegram-id']
        });
        
        res.json({ success: true, boss: result.rows[0] });
    } catch (err) {
        logger.error({ type: 'admin_boss_update_error', message: err.message });
        res.status(500).json({ error: 'Ошибка изменения босса' });
    }
});

module.exports = router;
