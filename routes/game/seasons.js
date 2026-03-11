/**
 * Ежедневные задания
 * @module game/seasons
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const { utils } = require('../../db/queries/players');
const { logPlayerAction, handleError } = utils;

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
        await client.query('BEGIN');
        
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
        
        // Логируем действие
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
