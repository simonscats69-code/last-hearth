/**
 * Сезоны и события
 * @module game/seasons
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const { utils } = require('../../db/queries/players');
const { logPlayerAction, serializeJSONField, handleError } = utils;

/**
 * Универсальный формат успешного ответа
 * @param {object} res 
 * @param {object} data 
 */
function successResponse(res, data) {
    res.json({ success: true, ...data });
}

/**
 * Универсальный формат ответа с ошибкой
 * @param {object} res 
 * @param {string} error 
 * @param {number} code 
 * @param {number} statusCode 
 */
function errorResponse(res, error, code = 'INTERNAL_ERROR', statusCode = 400, extraData = {}) {
    res.status(statusCode).json({ success: false, error, code, ...extraData });
}

/**
 * Валидация ID
 * @param {any} value 
 * @returns {boolean}
 */
function isValidId(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Пагинация
 */
function parsePagination(queryParams, defaultLimit = 50, maxLimit = 100) {
    let limit = parseInt(queryParams.limit) || defaultLimit;
    let offset = parseInt(queryParams.offset) || 0;
    
    // Ограничиваем максимальный limit
    limit = Math.min(Math.max(1, limit), maxLimit);
    // Ограничиваем минимальный offset
    offset = Math.max(0, offset);
    
    return { limit, offset };
}

/**
 * Текущий сезон
 */
router.get('/seasons/current', async (req, res) => {
    try {
        // Используем функцию из database.js
        const { getCurrentSeason } = require('../../db/database');
        const season = await getCurrentSeason();
        
        if (!season) {
            return successResponse(res, {
                active: false,
                message: 'Нет активного сезона'
            });
        }
        
        // Получаем позицию игрока в сезоне
        let playerRank = null;
        if (req.player && isValidId(req.player.id)) {
            const { getSeasonRating } = require('../../db/database');
            const rating = await getSeasonRating(season.id, req.player.id);
            playerRank = rating;
        }
        
        successResponse(res, {
            active: true,
            season: season,
            player_rank: playerRank
        });
        
    } catch (error) {
        handleError(error, '/seasons/current');
        errorResponse(res, 'Ошибка получения сезона', 'SEASON_ERROR', 500);
    }
});

/**
 * События сезона
 */
router.get('/seasons/events', async (req, res) => {
    try {
        const { getCurrentSeason, getSeasonEvents } = require('../../db/database');
        const season = await getCurrentSeason();
        
        if (!season) {
            return successResponse(res, {
                events: []
            });
        }
        
        const events = await getSeasonEvents(season.id);
        
        successResponse(res, {
            events: events
        });
        
    } catch (error) {
        handleError(error, '/seasons/events');
        errorResponse(res, 'Ошибка получения событий', 'EVENTS_ERROR', 500);
    }
});

/**
 * Рейтинг сезона (v2 с пагинацией)
 */
router.get('/seasons/rating', async (req, res) => {
    try {
        const { getCurrentSeason, getSeasonRating, getSeasonRankRewards } = require('../../db/database');
        const season = await getCurrentSeason();
        
        if (!season) {
            return successResponse(res, {
                rating: []
            });
        }
        
        const { limit, offset } = parsePagination(req.query, 50, 100);
        
        const rating = await queryAll(`
            SELECT p.telegram_id, p.username, p.first_name, 
                   sp.points, sp.rank
            FROM season_participants sp
            JOIN players p ON sp.player_id = p.id
            WHERE sp.season_id = $1
            ORDER BY sp.points DESC
            LIMIT $2 OFFSET $3
        `, [season.id, limit, offset]);
        
        // Получаем общее количество участников
        const countResult = await queryOne(`
            SELECT COUNT(*) as total FROM season_participants WHERE season_id = $1
        `, [season.id]);
        
        const total = parseInt(countResult?.total) || 0;
        
        // Награды за топ
        const rewards = await getSeasonRankRewards();
        
        successResponse(res, {
            season_id: season.id,
            rating: rating,
            rewards: rewards,
            pagination: {
                limit,
                offset,
                total,
                hasMore: offset + rating.length < total
            }
        });
        
    } catch (error) {
        handleError(error, '/seasons/rating');
        errorResponse(res, 'Ошибка получения рейтинга', 'RATING_ERROR', 500);
    }
});

/**
 * Присоединение к сезону
 */
router.post('/seasons/join', async (req, res) => {
    try {
        const { joinSeason } = require('../../db/database');
        const player = req.player;
        
        if (!player || !isValidId(player.id)) {
            return errorResponse(res, 'Игрок не найден', 'INVALID_PLAYER', 401);
        }
        
        const season = await require('../../db/database').getCurrentSeason();
        
        if (!season) {
            return errorResponse(res, 'Нет активного сезона', 'NO_ACTIVE_SEASON');
        }
        
        await joinSeason(season.id, player.id);
        
        // Логируем действие
        try {
            await logPlayerAction(player.id, 'season_joined', {
                season_id: season.id,
                season_name: season.name
            });
        } catch (logErr) {
            handleError(logErr, 'logPlayerAction - season_join');
        }
        
        successResponse(res, {
            message: 'Вы присоединились к сезону!',
            season: season
        });
        
    } catch (error) {
        handleError(error, '/seasons/join');
        errorResponse(res, 'Ошибка присоединения к сезону', 'JOIN_ERROR', 500);
    }
});

/**
 * Получение награды сезона
 */
router.post('/seasons/claim', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Начинаем транзакцию
        
        const { reward_id } = req.body;
        const player = req.player;
        
        // Валидация ID награды
        if (!isValidId(reward_id)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректный ID награды', 'INVALID_REWARD_ID');
        }
        
        // Проверяем награду
        const rewardResult = await client.query(`
            SELECT * FROM season_rewards WHERE id = $1
        `, [reward_id]);
        
        if (rewardResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Награда не найдена', 'REWARD_NOT_FOUND', 404);
        }
        
        const reward = rewardResult.rows[0];
        
        // Проверяем позицию игрока
        const { getCurrentSeason, getSeasonRating } = require('../../db/database');
        const season = await getCurrentSeason();
        
        if (!season) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Нет активного сезона', 'NO_ACTIVE_SEASON');
        }
        
        const rating = await getSeasonRating(season.id, player.id);
        
        if (!rating || rating.rank > reward.max_rank) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Вы не достигли нужного места', 'INSUFFICIENT_RANK');
        }
        
        // Проверяем, не получена ли награда
        const claimedResult = await client.query(`
            SELECT id FROM season_rewards_claimed 
            WHERE player_id = $1 AND reward_id = $2
        `, [player.id, reward_id]);
        
        if (claimedResult.rows.length > 0) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Награда уже получена', 'REWARD_ALREADY_CLAIMED');
        }
        
        // Блокируем игрока для обновления
        const playerResult = await client.query(`
            SELECT id, coins, stars, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [player.id]);
        
        const playerData = playerResult.rows[0];
        
        // Выдаём награду
        if (reward.reward_type === 'coins') {
            await client.query(`
                UPDATE players SET coins = coins + $1 WHERE id = $2
            `, [reward.reward_value, player.id]);
        } else if (reward.reward_type === 'stars') {
            await client.query(`
                UPDATE players SET stars = stars + $1 WHERE id = $2
            `, [reward.reward_value, player.id]);
        } else if (reward.reward_type === 'item') {
            const item = serializeJSONField(reward.reward_data);
            const inventory = serializeJSONField(playerData.inventory) || [];
            inventory.push(item);
            
            await client.query(`
                UPDATE players SET inventory = $1 WHERE id = $2
            `, [inventory, player.id]);
        }
        
        // Записываем получение
        await client.query(`
            INSERT INTO season_rewards_claimed (player_id, reward_id, claimed_at)
            VALUES ($1, $2, NOW())
        `, [player.id, reward_id]);
        
        await client.query('COMMIT');
        
        // Логируем действие (вне транзакции)
        try {
            await logPlayerAction(player.id, 'season_reward_claimed', {
                reward_id: reward_id,
                reward_type: reward.reward_type,
                reward_value: reward.reward_value
            });
        } catch (logErr) {
            handleError(logErr, 'logPlayerAction - season_claim');
        }
        
        successResponse(res, {
            message: 'Награда получена!',
            reward: reward
        });
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        handleError(error, '/seasons/claim');
        errorResponse(res, 'Ошибка получения награды', 'CLAIM_ERROR', 500);
    } finally {
        client.release();
    }
});

/**
 * Все сезоны
 */
router.get('/seasons/all', async (req, res) => {
    try {
        const { getAllSeasons } = require('../../db/database');
        const seasons = await getAllSeasons();
        
        successResponse(res, {
            seasons: seasons
        });
        
    } catch (error) {
        handleError(error, '/seasons/all');
        errorResponse(res, 'Ошибка получения сезонов', 'SEASONS_ERROR', 500);
    }
});

/**
 * Ежедневные задания
 */
router.get('/daily-tasks', async (req, res) => {
    try {
        const player = req.player;
        
        if (!player || !isValidId(player.id)) {
            return errorResponse(res, 'Игрок не найден', 'INVALID_PLAYER', 401);
        }
        
        // Получаем задания на сегодня
        const tasks = await queryAll(`
            SELECT * FROM daily_tasks 
            WHERE DATE(created_at) = CURRENT_DATE
        `);
        
        // Получаем прогресс игрока
        const progress = await queryAll(`
            SELECT task_id, progress, claimed FROM daily_task_progress
            WHERE player_id = $1 AND DATE(updated_at) = CURRENT_DATE
        `, [player.id]);
        
        const progressMap = {};
        progress.forEach(p => { progressMap[p.task_id] = p; });
        
        const tasksWithProgress = tasks.map(task => ({
            ...task,
            progress: progressMap[task.id]?.progress || 0,
            claimed: progressMap[task.id]?.claimed || false
        }));
        
        successResponse(res, {
            tasks: tasksWithProgress
        });
        
    } catch (error) {
        handleError(error, '/daily-tasks');
        errorResponse(res, 'Ошибка получения заданий', 'TASKS_ERROR', 500);
    }
});

/**
 * Получение награды за задание
 */
router.post('/daily-tasks/claim', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Начинаем транзакцию
        
        const { task_id } = req.body;
        const player = req.player;
        
        // Валидация ID задания
        if (!isValidId(task_id)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректный ID задания', 'INVALID_TASK_ID');
        }
        
        // Проверяем прогресс
        const progressResult = await client.query(`
            SELECT * FROM daily_task_progress
            WHERE player_id = $1 AND task_id = $2 AND claimed = false
        `, [player.id, task_id]);
        
        if (progressResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Нет прогресса или награда уже получена', 'NO_PROGRESS');
        }
        
        const progress = progressResult.rows[0];
        
        // Проверяем выполнение
        const taskResult = await client.query(`
            SELECT * FROM daily_tasks WHERE id = $1
        `, [task_id]);
        
        if (taskResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Задание не найдено', 'TASK_NOT_FOUND', 404);
        }
        
        const task = taskResult.rows[0];
        
        if (progress.progress < task.target) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Задание не выполнено', 'TASK_NOT_COMPLETED');
        }
        
        // Блокируем игрока для обновления
        const playerResult = await client.query(`
            SELECT id, coins, energy, max_energy FROM players WHERE id = $1 FOR UPDATE
        `, [player.id]);
        
        const playerData = playerResult.rows[0];
        
        // Выдаём награду
        if (task.reward_type === 'coins') {
            await client.query(`
                UPDATE players SET coins = coins + $1 WHERE id = $2
            `, [task.reward_value, player.id]);
        } else if (task.reward_type === 'energy') {
            const newEnergy = Math.min(
                parseInt(playerData.max_energy) || 100,
                (parseInt(playerData.energy) || 0) + task.reward_value
            );
            await client.query(`
                UPDATE players SET energy = $1 WHERE id = $2
            `, [newEnergy, player.id]);
        }
        
        // Помечаем как полученное
        await client.query(`
            UPDATE daily_task_progress SET claimed = true WHERE player_id = $1 AND task_id = $2
        `, [player.id, task_id]);
        
        await client.query('COMMIT');
        
        // Логируем действие (вне транзакции)
        try {
            await logPlayerAction(player.id, 'daily_task_completed', {
                task_id: task_id,
                reward_type: task.reward_type,
                reward_value: task.reward_value
            });
        } catch (logErr) {
            handleError(logErr, 'logPlayerAction - daily_task_claim');
        }
        
        successResponse(res, {
            message: 'Награда получена!',
            reward: {
                type: task.reward_type,
                value: task.reward_value
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        handleError(error, '/daily-tasks/claim');
        errorResponse(res, 'Ошибка получения награды', 'CLAIM_ERROR', 500);
    } finally {
        client.release();
    }
});

module.exports = router;
