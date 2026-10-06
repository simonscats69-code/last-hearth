/**
 * Дополнительные API роутеры
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, transaction } = require('../db/database');
const { logger, safeJsonParse, safeJsonParse: parseAchievementCondition, validateTelegramInitData, getPlayerByTelegramId } = require('../utils/serverApi');
const { getAchievementCurrentValue, getAchievementTargetValue, getAchievementRuntimeContext, grantCurrencyReward } = require('../utils/game-helpers');

/**
 * Типы ежедневных заданий: цель + награда.
 *
 * Ключи task_type использует utils/game-helpers.js → progressDailyTask(),
 * поэтому новый тип задания нужно сюда же, а не только в обработчик выдачи.
 */
const DAILY_TASK_TYPES = [
    { type: 'search', target: 10, reward: { coins: 50, stars: 1 } },
    { type: 'boss_damage', target: 100, reward: { coins: 100, stars: 2 } },
    { type: 'collect_items', target: 5, reward: { coins: 75, stars: 1 } }
];

/**
 * Определить Telegram ID из запроса.
 *
 * БЕЗОПАСНОСТЬ: доверяем ТОЛЬКО подписанному initData.
 * Заголовок x-telegram-id и query-параметры игнорируются —
 * иначе любой клиент мог бы выдавать себя за другого игрока
 * (например, забирать чужие награды за достижения).
 */
function resolveTelegramId(req) {
    const initData =
        req.headers['x-telegram-init-data'] ||
        req.headers['x-init-data'] ||
        req.body?.initData ||
        req.body?.init_data ||
        '';

    if (!initData) return null;

    const botToken = process.env.TG_BOT_TOKEN;

    if (botToken) {
        const validated = validateTelegramInitData(initData, botToken);
        return validated?.user?.id ? Number(validated.user.id) : null;
    }

    // Fallback только для разработки (без bot token подпись проверить невозможно)
    if (process.env.NODE_ENV === 'production') {
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
 * Ограничение выборки для рейтингов.
 *
 * Раньше здесь стояло `parseInt(req.query.limit) || 10` без верхней границы:
 * запрос вида /rating/players?limit=100000 уходил в базу без LIMIT-клампа и
 * выгружал всю таблицу игроков. В clans/pvp/world тот же параметр уже
 * ограничен 100 — здесь дыра была только в этих двух маршрутах.
 */
function readLimit(raw, fallback = 10, max = 100) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

/**
 * Получение рейтинга игроков
 */
router.get('/rating/players', async (req, res) => {
    try {
        const limit = readLimit(req.query.limit, 10, 100);
        
        // Вычисляем bosses_killed из boss_mastery для точности рейтинга
        const players = await queryAll(`
            SELECT p.telegram_id, p.first_name, p.username, p.level, 
                   p.experience, p.coins,
                   COALESCE((SELECT SUM(kills) FROM boss_mastery WHERE player_id = p.id), 0) as bosses_killed,
                   p.total_actions
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
        const limit = readLimit(req.query.limit, 10, 100);

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

        // Задания на день создаются всегда: уникальный ключ (player_id, task_type,
// expires_at) делает вставку идемпотентной. Раньше условие было
// «если не нашлось НИ ОДНОГО задания», поэтому после получения награды за
// одно задание (строка удаляется) остальные два не восстанавливались,
// а список выглядел неполным весь день.
const tasks = await transaction(async (client) => {
            // Срок — полночь следующих суток. Порядок важен: сначала дата,
            // потом часы. Наоборот (setHours до setDate) при входе после
            // полуночи дал бы срок в ПРОШЛОМ (00:00 «сегодня»), и новое
            // задание не попало бы в выборку `expires_at > NOW()`.
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 1);
            expiresAt.setHours(0, 0, 0, 0);

            for (const taskType of DAILY_TASK_TYPES) {
                await client.query(
                    `INSERT INTO daily_tasks (player_id, task_type, target_value, reward, expires_at)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (player_id, task_type, expires_at) DO NOTHING`,
                    [player.id, taskType.type, taskType.target, JSON.stringify(taskType.reward), expiresAt]
                );
            }

            const result = await client.query(
                `SELECT * FROM daily_tasks
                  WHERE player_id = $1 AND expires_at > NOW()
                  ORDER BY task_type`,
                [player.id]
            );
            return result.rows;
        });

        res.json({
            tasks: tasks.map((task) => ({
                ...task,
                reward: safeJsonParse(task.reward, {}),
                current_value: Number(task.current_value || 0),
                target_value: Number(task.target_value || 0),
                completed: Boolean(task.completed)
            }))
        });
    } catch (error) {
        logger.error({ type: 'daily_tasks_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения заданий' });
    }
});

/**
 * Получить награду за ежедневное задание.
 * POST /api/daily-tasks/:id/claim
 *
 * Раньше задания нельзя было даже выполнить: current_value/completed никто не
 * обновлял, а метода получения награды не существовало вовсе — задание
 * можно было увидеть и забыть навсегда.
 */
router.post('/daily-tasks/:id/claim', async (req, res) => {
    const telegramId = resolveTelegramId(req);
    if (!telegramId) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }

    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
        return res.status(400).json({ success: false, error: 'Некорректный id задания', code: 'INVALID_TASK_ID' });
    }

    try {
        const result = await transaction(async (client) => {
            const playerResult = await client.query(
                'SELECT id, coins, stars FROM players WHERE telegram_id = $1 FOR UPDATE',
                [telegramId]
            );
            const player = playerResult.rows[0];
            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const taskResult = await client.query(
                `SELECT * FROM daily_tasks
                  WHERE id = $1 AND player_id = $2 AND expires_at > NOW()
                  FOR UPDATE`,
                [taskId, player.id]
            );
            const task = taskResult.rows[0];
            if (!task) {
                throw { message: 'Задание не найдено или истекло', code: 'TASK_NOT_FOUND', statusCode: 404 };
            }
            if (!task.completed) {
                throw {
                    message: 'Задание ещё не выполнено',
                    code: 'TASK_NOT_COMPLETED',
                    statusCode: 400,
                    current_value: Number(task.current_value || 0),
                    target_value: Number(task.target_value || 0)
                };
            }

            // Награда выдаётся один раз: удаляем задание в той же транзакции.
            await client.query('DELETE FROM daily_tasks WHERE id = $1', [taskId]);

            const reward = safeJsonParse(task.reward, {});
            const coins = Number(reward.coins || 0);
            const stars = Number(reward.stars || 0);

            if (coins > 0 || stars > 0) {
                await client.query(
                    `UPDATE players
                        SET coins = coins + $1,
                            stars = stars + $2,
                            daily_tasks_completed = COALESCE(daily_tasks_completed, 0) + 1
                      WHERE id = $3`,
                    [coins, stars, player.id]
                );
            }

            return {
                success: true,
                message: `Награда получена: +${coins} 🪙, +${stars} ⭐`,
                reward: { coins, stars },
                coins_total: Number(player.coins || 0) + coins,
                stars_total: Number(player.stars || 0) + stars
            };
        });

        return res.json(result);
    } catch (error) {
        if (['TASK_NOT_FOUND', 'TASK_NOT_COMPLETED', 'PLAYER_NOT_FOUND'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        logger.error({ type: 'daily_task_claim_error', message: error.message });
        return res.status(500).json({ success: false, error: 'Ошибка получения награды' });
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

        const player = await getPlayerByTelegramId(telegramId);

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

        const [allAchievements, playerAchievements] = await Promise.all([
            queryAll(achievementsQuery, queryParams),
            queryAll('SELECT * FROM player_achievements WHERE player_id = $1', [player.id])
        ]);

        const progressMap = Object.fromEntries(playerAchievements.map(pa => [pa.achievement_id, pa]));

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

        const player = await getPlayerByTelegramId(telegramId);

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }

        const achievementRuntimeContext = await getAchievementRuntimeContext(null, player.id);

        // Получаем все достижения и прогресс игрока
        const [allAchievements, playerAchievements] = await Promise.all([
            queryAll('SELECT * FROM achievements'),
            queryAll('SELECT * FROM player_achievements WHERE player_id = $1', [player.id])
        ]);

        const progressMap = Object.fromEntries(playerAchievements.map(pa => [pa.achievement_id, pa]));

        // Вычисляем прогресс для каждого достижения
        const progress = allAchievements.map(ach => {
            const condition = safeJsonParse(ach.condition, {});
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
        const condition = parseAchievementCondition(achievement.condition);
        const reward = safeJsonParse(achievement.reward, {});

        // Используем транзакцию с блокировкой для предотвращения race condition
        
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
            
            const achievementRuntimeContext = await getAchievementRuntimeContext(client, player.id);
            const currentValue = getAchievementCurrentValue(condition, lockedPlayer.rows[0], achievementRuntimeContext);
            const targetValue = getAchievementTargetValue(condition, achievementRuntimeContext);

            if (currentValue < targetValue) {
                throw { statusCode: 400, message: 'Достижение ещё не выполнено' };
            }

            if (achievementData.reward_claimed) {
                throw { statusCode: 400, message: 'Награда уже получена' };
            }

            // Обновляем баланс игрока (общая начислялка валюты).
            // touchUpdatedAt=true — здесь это историческое поведение:
            // профиль игрока должен отражать момент получения награды.
            await grantCurrencyReward(client, player.id, reward, true);

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
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Init-Data');
    res.sendStatus(200);
});

router.post('/verify-telegram', async (req, res) => {
    try {
        // БЕЗОПАСНОСТЬ: telegram_id НЕ берётся из тела запроса как есть.
        // Тело рассматривается как «просьба проверить», а источник истины —
        // user.id из криптографически проверенных initData.
        const requestedTelegramId = req.body.telegram_id;

        // БЕЗОПАСНОСТЬ: при наличии bot token подпись initData ОБЯЗАТЕЛЬНА,
        // а telegram_id должен совпадать с подписанным пользователем.
        const botToken = process.env.TG_BOT_TOKEN;
        const isDevelopment = process.env.NODE_ENV !== 'production';
        const initDataStr = req.body.initData || req.body.init_data || req.headers['x-init-data'] || '';

        let telegramId = requestedTelegramId;

        if (botToken) {
            if (!initDataStr) {
                return res.status(401).json({ error: 'Требуется initData' });
            }
            const validated = validateTelegramInitData(initDataStr, botToken);
            if (!validated) {
                logger.warn({ type: 'telegram_hash_mismatch', telegram_id: requestedTelegramId });
                return res.status(401).json({ error: 'Неверная подпись Telegram' });
            }

            // Канонический ID — из подписи. Тело запроса только сверяется с ним.
            const signedId = Number(validated.user.id);
            if (requestedTelegramId !== undefined && Number(requestedTelegramId) !== signedId) {
                logger.warn({ type: 'telegram_id_mismatch', telegram_id: requestedTelegramId, signedId });
                return res.status(403).json({ error: 'telegram_id не соответствует подписанным данным' });
            }
            telegramId = signedId;
        } else if (!isDevelopment) {
            logger.error('TG_BOT_TOKEN не настроен в production!');
            return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
        }

        if (!telegramId) {
            return res.status(400).json({ error: 'Отсутствует telegram_id' });
        }

        // Проверяем, существует ли игрок
        const player = await queryOne(
            'SELECT id, telegram_id FROM players WHERE telegram_id = $1',
            [telegramId]
        );

        if (!player) {
            // Создаём нового игрока (результат не нужен — дальше возвращаем флаг)
            await queryOne(`
                INSERT INTO players (telegram_id)
                VALUES ($1)
                RETURNING id
            `, [telegramId]);

            logger.info('[verify-telegram] Создан новый игрок', { telegram_id: telegramId });
            return res.json({
                valid: true,
                new_player: true,
                telegram_id: telegramId
            });
        }

        logger.info('[verify-telegram] Найден существующий игрок', { telegram_id: telegramId });
        res.json({
            valid: true,
            new_player: false,
            telegram_id: telegramId
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
