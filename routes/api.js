/**
 * Дополнительные API роутеры
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll } = require('../db/database');
const { logger, safeJsonParse, validateTelegramInitData } = require('../utils/serverApi');

/**
 * Безопасный парсинг JSON условия достижения
 */
function parseAchievementCondition(condition) {
    return safeJsonParse(condition, {});
}

function extractTelegramIdFromInitData(initData) {
    if (!initData) return null;

    const botToken = process.env.TG_BOT_TOKEN;
    const isDevelopment = process.env.NODE_ENV !== 'production';

    if (botToken) {
        const validated = validateTelegramInitData(initData, botToken);
        return validated?.user?.id ? Number(validated.user.id) : null;
    }

    if (!isDevelopment) {
        return null;
    }

    try {
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user') || '{}');
        return user?.id ? Number(user.id) : null;
    } catch {
        return null;
    }
}

function resolveTelegramId(req) {
    const headerTelegramId = req.headers['x-telegram-id'];
    if (headerTelegramId) {
        return Number(headerTelegramId);
    }

    const queryTelegramId = req.query.telegram_id;
    if (queryTelegramId) {
        return Number(queryTelegramId);
    }

    return extractTelegramIdFromInitData(req.headers['x-init-data']);
}

async function getAchievementRuntimeContext(playerId, client = null) {
    const queryOneFn = client
        ? (sql, params = []) => client.query(sql, params).then(result => result.rows[0] || null)
        : queryOne;

    const bossCount = await queryOneFn('SELECT COUNT(*) as total FROM bosses');
    const defeatedBosses = await queryOneFn(
        'SELECT COUNT(DISTINCT boss_id) as total FROM boss_mastery WHERE player_id = $1 AND kills > 0',
        [playerId]
    );

    return {
        totalBosses: Number(bossCount?.total || 0),
        defeatedBosses: Number(defeatedBosses?.total || 0)
    };
}

function getAchievementCurrentValue(condition, player, runtimeContext) {
    switch (condition.type) {
        case 'level':
            return player.level || 1;
        case 'days_played':
            return player.days_played || 1;
        case 'bosses_killed':
        case 'boss_kills':
        case 'first_boss_kill':
        case 'single_boss_kills':
            return player.bosses_killed || 0;
        case 'all_bosses_killed':
            return runtimeContext.defeatedBosses;
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
        default:
            return 0;
    }
}

function getAchievementTargetValue(condition, runtimeContext) {
    if (condition.type === 'all_bosses_killed') {
        return Math.max(1, runtimeContext.totalBosses);
    }

    if (condition.type === 'first_boss_kill') {
        return 1;
    }

    if (condition.type === 'in_clan' || condition.type === 'clan_leader') {
        return 1;
    }

    const rawTarget = condition.value ?? condition.count ?? 0;
    return Number(rawTarget || 0);
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
        const telegramId = resolveTelegramId(req);
        
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

        // Получаем или создаём задания на день (с транзакцией для предотвращения race condition)
        const { transaction } = require('../db/database');
        
        const tasks = await transaction(async (client) => {
            // Проверяем существующие задания с блокировкой
            let existingTasks = await client.query(`
                SELECT * FROM daily_tasks 
                WHERE player_id = $1 AND expires_at > NOW()
                FOR UPDATE
            `, [player.id]);

            // Если нет заданий - создаём
            if (existingTasks.rows.length === 0) {
                const taskTypes = [
                    { type: 'search', target: 10, reward: { coins: 50, stars: 1 } },
                    { type: 'boss_damage', target: 100, reward: { coins: 100, stars: 2 } },
                    { type: 'collect_items', target: 5, reward: { coins: 75, stars: 1 } }
                ];

                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 1);
                expiresAt.setHours(0, 0, 0, 0);

                for (const taskType of taskTypes) {
                    await client.query(`
                        INSERT INTO daily_tasks (player_id, task_type, target_value, reward, expires_at)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (player_id, task_type, expires_at) DO NOTHING
                    `, [player.id, taskType.type, taskType.target, JSON.stringify(taskType.reward), expiresAt]);
                }

                // Получаем созданные задания
                existingTasks = await client.query(`
                    SELECT * FROM daily_tasks 
                    WHERE player_id = $1 AND expires_at > NOW()
                `, [player.id]);
            }

            return existingTasks.rows;
        });

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
        const telegramId = resolveTelegramId(req);
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
            reward: safeJsonParse(ach.reward, {}),
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
        const telegramId = resolveTelegramId(req);
        
        if (!telegramId) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        const player = await queryOne(
            'SELECT id, level, days_played, bosses_killed, pvp_wins, unique_items, locations_visited, clan_id, clan_role, clans_joined FROM players WHERE telegram_id = $1',
            [telegramId]
        );

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }

        const achievementRuntimeContext = await getAchievementRuntimeContext(player.id);

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
            let isCompleted = progressMap[ach.id]?.completed || false;
            const currentValue = getAchievementCurrentValue(condition, player, achievementRuntimeContext);

            // Проверяем, выполнено ли достижение
            const targetValue = getAchievementTargetValue(condition, achievementRuntimeContext);
            if (!isCompleted && currentValue >= targetValue) {
                isCompleted = true;
            }

            const percent = targetValue > 0 ? Math.min(100, Math.round((currentValue / targetValue) * 100)) : 0;

            return {
                id: ach.id,
                name: ach.name,
                description: ach.description,
                category: ach.category,
                icon: ach.icon,
                rarity: ach.rarity,
                reward: safeJsonParse(ach.reward, {}),
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
        const telegramId = resolveTelegramId(req);
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

        // Парсим условие и награду
        let condition;
        let reward;
        try {
            condition = typeof achievement.condition === 'string' 
                ? JSON.parse(achievement.condition) 
                : achievement.condition;
            reward = typeof achievement.reward === 'string' 
                ? JSON.parse(achievement.reward) 
                : achievement.reward;
        } catch(e) {
            logger.error('[api] JSON.parse failed:', e.message);
            return res.status(500).json({ error: 'Ошибка обработки достижения' });
        }

        // Используем транзакцию с блокировкой для предотвращения race condition
        const { transaction } = require('../db/database');
        
        const result = await transaction(async (client) => {
            // Блокируем запись игрока
            const lockedPlayer = await client.query(
                'SELECT * FROM players WHERE id = $1 FOR UPDATE',
                [player.id]
            );
            
            if (!lockedPlayer.rows[0]) {
                throw new Error('Игрок не найден');
            }
            
            // Проверяем прогресс игрока с блокировкой
            let playerAchievement = await client.query(`
                SELECT * FROM player_achievements 
                WHERE player_id = $1 AND achievement_id = $2
                FOR UPDATE
            `, [player.id, achievement_id]);

            // Если записи нет, создаём
            if (playerAchievement.rows.length === 0) {
                await client.query(`
                    INSERT INTO player_achievements (player_id, achievement_id, progress_value, completed, reward_claimed)
                    VALUES ($1, $2, 0, false, false)
                `, [player.id, achievement_id]);
                
                playerAchievement = { rows: [{ completed: false, reward_claimed: false }] };
            }

            const achievementData = playerAchievement.rows[0];
            
            const achievementRuntimeContext = await getAchievementRuntimeContext(player.id, client);
            const currentValue = getAchievementCurrentValue(condition, lockedPlayer.rows[0], achievementRuntimeContext);
            const targetValue = getAchievementTargetValue(condition, achievementRuntimeContext);

            if (currentValue < targetValue) {
                throw { statusCode: 400, message: 'Достижение ещё не выполнено' };
            }

            if (achievementData.reward_claimed) {
                throw { statusCode: 400, message: 'Награда уже получена' };
            }

            // Обновляем баланс игрока
            const updates = [];
            const params = [player.id];
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
                await client.query(`
                    UPDATE players SET ${updates.join(', ')}, updated_at = NOW()
                    WHERE id = $1
                `, params);
            }

            // Отмечаем награду как полученную
            await client.query(`
                UPDATE player_achievements 
                SET completed = true, completed_at = NOW(), reward_claimed = true, claimed_at = NOW()
                WHERE player_id = $1 AND achievement_id = $2
            `, [player.id, achievement_id]);

            // Получаем актуальный баланс после обновления
            const updatedPlayer = await client.query(`
                SELECT coins, stars FROM players WHERE id = $1
            `, [player.id]);

            return {
                reward,
                new_balance: {
                    coins: updatedPlayer.rows[0].coins || 0,
                    stars: updatedPlayer.rows[0].stars || 0
                }
            };
        });

        res.json({
            success: true,
            message: `Вы получили награду: ${result.reward.coins || 0} монет, ${result.reward.stars || 0} звёзд`,
            reward: {
                coins: result.reward.coins || 0,
                stars: result.reward.stars || 0
            },
            new_balance: result.new_balance
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
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
        const { telegram_id, hash, auth_date } = req.body;

        if (!telegram_id) {
            return res.status(400).json({ error: 'Отсутствует telegram_id' });
        }

        // Проверка подписи Telegram (если есть hash и bot token)
        const botToken = process.env.TG_BOT_TOKEN;
        if (hash && botToken) {
            const crypto = require('crypto');
            
            // Формируем строку для проверки
            const dataCheckString = Object.keys(req.body)
                .filter(key => key !== 'hash')
                .sort()
                .map(key => `${key}=${req.body[key]}`)
                .join('\n');
            
            const secretKey = crypto.createHash('sha256').update(botToken).digest();
            const calculatedHash = crypto
                .createHmac('sha256', secretKey)
                .update(dataCheckString)
                .digest('hex');
            
            if (calculatedHash !== hash) {
                logger.warn({ type: 'telegram_hash_mismatch', telegram_id });
                return res.status(401).json({ error: 'Неверная подпись Telegram' });
            }
            
            // Проверяем время (не старше 24 часов)
            if (auth_date) {
                const authTime = parseInt(auth_date, 10);
                const now = Math.floor(Date.now() / 1000);
                if (now - authTime > 86400) {
                    logger.warn({ type: 'telegram_auth_expired', telegram_id, age: now - authTime });
                    return res.status(401).json({ error: 'Данные авторизации устарели' });
                }
            }
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

            logger.info('[verify-telegram] Создан новый игрок', { telegram_id });
            return res.json({
                valid: true,
                new_player: true,
                telegram_id: telegram_id
            });
        }

        logger.info('[verify-telegram] Найден существующий игрок', { telegram_id });
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
