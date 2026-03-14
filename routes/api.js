/**
 * Дополнительные API роутеры
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, safeJsonParse } = require('../db/database');
const { logger } = require('../utils/logger');

/**
 * Безопасный парсинг JSON условия достижения
 */
function parseAchievementCondition(condition) {
    return safeJsonParse(condition, {});
}
router.get('/shop/items', async (req, res) => {
    try {
        const items = await queryAll(`
            SELECT id, name, description, type, category, rarity, 
                   price, stars_price, icon, image_url
            FROM items 
            WHERE price > 0 OR stars_price > 0
            ORDER BY rarity, type, name
        `);

        res.json({ items });
    } catch (error) {
        logger.error({ type: 'shop_items_error', message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Ошибка получения товаров' });
    }
});

/**
 * Получение рейтинга игроков
 */
router.get('/rating/players', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const players = await queryAll(`
            SELECT p.telegram_id, p.first_name, p.username, p.level, 
                   p.experience, p.bosses_killed, p.total_actions,
                   p.coins
            FROM players p
            ORDER BY p.level DESC, p.experience DESC
            LIMIT $1
        `, [limit]);

        res.json({ rating: players });
    } catch (error) {
        logger.error({ type: 'rating_players_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

/**
 * Получение рейтинга кланов
 */
router.get('/rating/clans', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const clans = await queryAll(`
            SELECT c.id, c.name, c.level, c.experience, 
                   c.total_members, c.bosses_killed
            FROM clans c
            ORDER BY c.level DESC, c.experience DESC
            LIMIT $1
        `, [limit]);

        res.json({ rating: clans });
    } catch (error) {
        logger.error({ type: 'rating_clans_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения рейтинга' });
    }
});

/**
 * Получение ежедневных заданий игрока
 */
router.get('/daily-tasks', async (req, res) => {
    try {
        const telegramId = req.headers['x-telegram-id'] || req.query.telegram_id;
        
        if (!telegramId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const player = await queryOne(
            'SELECT id FROM players WHERE telegram_id = $1',
            [telegramId]
        );

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }

        const today = new Date();
        today.setHours(23, 59, 59, 999);

        // Получаем или создаём задания на день
        let tasks = await queryAll(`
            SELECT * FROM daily_tasks 
            WHERE player_id = $1 AND expires_at > NOW()
        `, [player.id]);

        // Если нет заданий - создаём
        if (tasks.length === 0) {
            const taskTypes = [
                { type: 'search', target: 10, reward: { coins: 50, stars: 1 } },
                { type: 'boss_damage', target: 100, reward: { coins: 100, stars: 2 } },
                { type: 'collect_items', target: 5, reward: { coins: 75, stars: 1 } }
            ];

            for (const taskType of taskTypes) {
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 1);
                expiresAt.setHours(0, 0, 0, 0);

                await query(`
                    INSERT INTO daily_tasks (player_id, task_type, target_value, reward, expires_at)
                    VALUES ($1, $2, $3, $4, $5)
                `, [player.id, taskType.type, taskType.target, JSON.stringify(taskType.reward), expiresAt]);
            }

            tasks = await queryAll(`
                SELECT * FROM daily_tasks 
                WHERE player_id = $1 AND expires_at > NOW()
            `, [player.id]);
        }

        res.json({ tasks });
    } catch (error) {
        logger.error({ type: 'daily_tasks_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения заданий' });
    }
});

/**
 * Получение достижений
 */
router.get('/achievements', async (req, res) => {
    try {
        const telegramId = req.headers['x-telegram-id'] || req.query.telegram_id;
        const category = req.query.category; // Опциональная фильтрация по категории
        
        if (!telegramId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const player = await queryOne(
            'SELECT id FROM players WHERE telegram_id = $1',
            [telegramId]
        );

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }

        // Все достижения (с фильтрацией по категории)
        let achievementsQuery = 'SELECT * FROM achievements';
        const queryParams = [];
        
        if (category) {
            achievementsQuery += ' WHERE category = $1';
            queryParams.push(category);
        }
        achievementsQuery += ' ORDER BY category, id';

        const allAchievements = await queryAll(achievementsQuery, queryParams);

        // Прогресс игрока
        const playerAchievements = await queryAll(`
            SELECT * FROM player_achievements WHERE player_id = $1
        `, [player.id]);

        const progressMap = {};
        playerAchievements.forEach(pa => {
            progressMap[pa.achievement_id] = pa;
        });

        const achievements = allAchievements.map(ach => ({
            ...ach,
            progress: progressMap[ach.id]?.progress || {},
            progress_value: progressMap[ach.id]?.progress_value || 0,
            completed: progressMap[ach.id]?.completed || false,
            completed_at: progressMap[ach.id]?.completed_at,
            reward_claimed: progressMap[ach.id]?.reward_claimed || false
        }));

        res.json({ achievements });
    } catch (error) {
        logger.error({ type: 'achievements_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения достижений' });
    }
});

/**
 * Получение прогресса игрока по достижениям
 */
router.get('/achievements/progress', async (req, res) => {
    try {
        const telegramId = req.headers['x-telegram-id'] || req.query.telegram_id;
        
        if (!telegramId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const player = await queryOne(
            'SELECT id, level, days_played, bosses_killed, pvp_wins, items_crafted, unique_items, locations_visited, clan_id FROM players WHERE telegram_id = $1',
            [telegramId]
        );

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }

        // Получаем все достижения
        const allAchievements = await queryAll('SELECT * FROM achievements');
        
        // Получаем прогресс игрока
        const playerAchievements = await queryAll(`
            SELECT * FROM player_achievements WHERE player_id = $1
        `, [player.id]);

        const progressMap = {};
        playerAchievements.forEach(pa => {
            progressMap[pa.achievement_id] = pa;
        });

        // Вычисляем прогресс для каждого достижения
        const progress = allAchievements.map(ach => {
            const condition = parseAchievementCondition(ach.condition);
            let currentValue = 0;
            let isCompleted = progressMap[ach.id]?.completed || false;

            // Вычисляем текущее значение на основе типа условия
            switch (condition.type) {
                case 'days_played':
                    currentValue = player.days_played || 1;
                    break;
                case 'bosses_killed':
                    currentValue = player.bosses_killed || 0;
                    break;
                case 'pvp_wins':
                    currentValue = player.pvp_wins || 0;
                    break;
                case 'items_crafted':
                    currentValue = player.items_crafted || 0;
                    break;
                case 'unique_items':
                    const uniqueItems = player.unique_items || [];
                    currentValue = Array.isArray(uniqueItems) ? uniqueItems.length : 0;
                    break;
                case 'locations_visited':
                    const locations = player.locations_visited || [];
                    currentValue = Array.isArray(locations) ? locations.length : 0;
                    break;
                case 'in_clan':
                    currentValue = player.clan_id ? 1 : 0;
                    break;
                case 'clan_leader':
                    currentValue = player.clan_role === 'leader' ? 1 : 0;
                    break;
                case 'clans_joined':
                    currentValue = player.clans_joined || 0;
                    break;
            }

            // Проверяем, выполнено ли достижение
            if (!isCompleted && currentValue >= condition.value) {
                isCompleted = true;
            }

            const targetValue = condition.value;
            const percent = Math.min(100, Math.round((currentValue / targetValue) * 100));

            return {
                id: ach.id,
                name: ach.name,
                description: ach.description,
                category: ach.category,
                icon: ach.icon,
                rarity: ach.rarity,
                current: currentValue,
                target: targetValue,
                percent: percent,
                completed: isCompleted,
                reward_claimed: progressMap[ach.id]?.reward_claimed || false
            };
        });

        // Группируем по категориям
        const categories = {};
        progress.forEach(p => {
            if (!categories[p.category]) {
                categories[p.category] = {
                    name: getCategoryName(p.category),
                    achievements: [],
                    completed: 0,
                    total: 0
                };
            }
            categories[p.category].achievements.push(p);
            categories[p.category].total++;
            if (p.completed) categories[p.category].completed++;
        });

        // Статистика
        const stats = {
            total_achievements: progress.length,
            completed: progress.filter(p => p.completed).length,
            claimed: progress.filter(p => p.reward_claimed).length
        };

        res.json({ progress, categories, stats });
    } catch (error) {
        logger.error({ type: 'achievements_progress_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения прогресса' });
    }
});

/**
 * Получение награды за достижение
 */
router.post('/achievements/claim', async (req, res) => {
    try {
        const telegramId = req.headers['x-telegram-id'] || req.query.telegram_id;
        const { achievement_id } = req.body;
        
        if (!telegramId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        if (!achievement_id) {
            return res.status(400).json({ error: 'Требуется ID достижения' });
        }

        const player = await queryOne(
            'SELECT * FROM players WHERE telegram_id = $1',
            [telegramId]
        );

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }

        // Получаем информацию о достижении
        const achievement = await queryOne(
            'SELECT * FROM achievements WHERE id = $1',
            [achievement_id]
        );

        if (!achievement) {
            return res.status(404).json({ error: 'Достижение не найдено' });
        }

        // Проверяем прогресс игрока
        let playerAchievement = await queryOne(`
            SELECT * FROM player_achievements 
            WHERE player_id = $1 AND achievement_id = $2
        `, [player.id, achievement_id]);

        // Если записи нет, создаём
        if (!playerAchievement) {
            let condition;
            try {
                condition = typeof achievement.condition === 'string' 
                    ? JSON.parse(achievement.condition) 
                    : achievement.condition;
            } catch(e) {
                logger.error('[api] JSON.parse condition failed:', achievement.condition);
                throw e;
            }
            
            await query(`
                INSERT INTO player_achievements (player_id, achievement_id, progress_value, completed)
                VALUES ($1, $2, 0, false)
            `, [player.id, achievement_id]);
            
            playerAchievement = { completed: false, reward_claimed: false };
        }

        // Проверяем, выполнено ли достижение
        let condition;
        try {
            condition = typeof achievement.condition === 'string' 
                ? JSON.parse(achievement.condition) 
                : achievement.condition;
        } catch(e) {
            logger.error('[api] JSON.parse condition failed:', achievement.condition);
            throw e;
        }
        
        let currentValue = 0;
        switch (condition.type) {
            case 'days_played': currentValue = player.days_played || 1; break;
            case 'bosses_killed': currentValue = player.bosses_killed || 0; break;
            case 'pvp_wins': currentValue = player.pvp_wins || 0; break;
            case 'items_crafted': currentValue = player.items_crafted || 0; break;
            case 'unique_items': currentValue = (player.unique_items || []).length; break;
            case 'locations_visited': currentValue = (player.locations_visited || []).length; break;
            case 'in_clan': currentValue = player.clan_id ? 1 : 0; break;
            case 'clan_leader': currentValue = player.clan_role === 'leader' ? 1 : 0; break;
            case 'clans_joined': currentValue = player.clans_joined || 0; break;
        }

        if (currentValue < condition.value) {
            return res.status(400).json({ error: 'Достижение ещё не выполнено' });
        }

        if (playerAchievement.reward_claimed) {
            return res.status(400).json({ error: 'Награда уже получена' });
        }

        // Получаем награду
        let reward;
        try {
            reward = typeof achievement.reward === 'string' 
                ? JSON.parse(achievement.reward) 
                : achievement.reward;
        } catch(e) {
            logger.error('[api] JSON.parse reward failed:', achievement.reward);
            throw e;
        }

        // Обновляем баланс игрока
        const updates = [];
        const params = [player.id];
        let paramIndex = 2;

        if (reward.coins && reward.coins > 0) {
            updates.push(`coins = coins + ${paramIndex}`);
            params.push(reward.coins);
            paramIndex++;
        }

        if (reward.stars && reward.stars > 0) {
            updates.push(`stars = stars + ${paramIndex}`);
            params.push(reward.stars);
            paramIndex++;
        }

        if (updates.length > 0) {
            await query(`
                UPDATE players SET ${updates.join(', ')}, updated_at = NOW()
                WHERE id = $1
            `, params);
        }

        // Отмечаем награду как полученную
        await query(`
            UPDATE player_achievements 
            SET completed = true, completed_at = NOW(), reward_claimed = true, claimed_at = NOW()
            WHERE player_id = $1 AND achievement_id = $2
        `, [player.id, achievement_id]);

        // Получаем актуальный баланс после обновления
        const updatedPlayer = await queryOne(`
            SELECT coins, stars FROM players WHERE id = $1
        `, [player.id]);

        res.json({
            success: true,
            message: `Вы получили награду: ${reward.coins || 0} монет, ${reward.stars || 0} звёзд`,
            reward: {
                coins: reward.coins || 0,
                stars: reward.stars || 0
            },
            new_balance: {
                coins: (updatedPlayer.coins || 0),
                stars: (updatedPlayer.stars || 0)
            }
        });
    } catch (error) {
        logger.error({ type: 'achievements_claim_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения награды' });
    }
});

// Вспомогательная функция для получения названия категории
function getCategoryName(category) {
    const names = {
        survival: 'Выживание',
        bosses: 'Боссы',
        pvp: 'PvP',
        craft: 'Крафт',
        collection: 'Коллекция',
        exploration: 'Исследование',
        social: 'Социальное'
    };
    return names[category] || category;
}

/**
 * Информация об игре (для главного экрана)
 */
router.get('/game-info', async (req, res) => {
    try {
        const locations = await queryAll('SELECT id, name, icon, radiation, danger_level FROM locations ORDER BY radiation');
        const bosses = await queryAll('SELECT id, name, icon, level FROM bosses ORDER BY level');
        const playersCount = await queryOne('SELECT COUNT(*) as count FROM players');

        res.json({
            game_name: 'Последний Очаг',
            version: '1.0.0',
            locations: locations,
            bosses: bosses,
            players_count: parseInt(playersCount?.count || 0)
        });
    } catch (error) {
        logger.error({ type: 'game_info_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения информации' });
    }
});

/**
 * Проверка валидности Telegram данных (для Mini App)
 */
// Обрабатываем OPTIONS для CORS
router.options('/verify-telegram', (req, res) => {
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Telegram-ID');
    res.sendStatus(200);
});

router.post('/verify-telegram', async (req, res) => {
    try {
        logger.debug('[verify-telegram] req.body:', JSON.stringify(req.body).substring(0, 200));
        const { telegram_id, hash } = req.body;

        if (!telegram_id) {
            return res.status(400).json({ error: 'Отсутствует telegram_id' });
        }

        // Проверяем, существует ли игрок
        const player = await queryOne(
            'SELECT id, telegram_id FROM players WHERE telegram_id = $1',
            [telegram_id]
        );

        if (!player) {
            // Создаём нового игрока
            const newPlayer = await queryOne(`
                INSERT INTO players (telegram_id)
                VALUES ($1)
                RETURNING id
            `, [telegram_id]);

            return res.json({
                valid: true,
                new_player: true,
                telegram_id: telegram_id
            });
        }

        res.json({
            valid: true,
            new_player: false,
            telegram_id: telegram_id
        });
    } catch (error) {
        logger.error({ type: 'verify_telegram_error', message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Ошибка верификации' });
    }
});

/**
 * Health check для мониторинга
 */
router.get('/health', async (req, res) => {
    try {
        // Проверка базы данных
        const dbStart = Date.now();
        await query('SELECT 1');
        const dbTime = Date.now() - dbStart;
        
        res.json({
            status: 'ok',
            timestamp: Date.now(),
            uptime: process.uptime(),
            database: {
                status: 'connected',
                response_time_ms: dbTime
            },
            memory: process.memoryUsage(),
            version: '1.0.0'
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            error: error.message 
        });
    }
});

module.exports = router;
