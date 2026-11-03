// routes/game/daily-tasks.js
// Ежедневные задания: генерация, прогресс, выдача наград, claim.
const express = require('express');
const { transaction, query, queryOne } = require('../../db/database');
const { validateId, requireAuth } = require('../../utils/validate');
const { getGameHelpers } = require('../../utils/game-helpers');
const { logPlayerAction } = require('../../utils/log');

const router = express.Router();

// --- Каталог типов задач ---
const DAILY_TASK_TYPES = [
    { type: 'search', target: (level) => Math.max(3, Math.floor(level / 5) + 3), reward: { coins: 50, xp: 20 }, difficulty: 'easy' },
    { type: 'boss_damage', target: (level) => 100 * level, reward: { coins: 100, xp: 50 }, difficulty: 'medium' },
    { type: 'collect_items', target: (level) => Math.max(5, Math.floor(level / 3) + 5), reward: { coins: 75, xp: 30 }, difficulty: 'easy' },
    { type: 'pvp_wins', target: () => 1, reward: { coins: 150, xp: 75 }, difficulty: 'hard' },
    { type: 'locations_visited', target: (level) => Math.max(2, Math.floor(level / 10) + 2), reward: { coins: 60, xp: 25 }, difficulty: 'easy' },
    { type: 'boss_kill', target: () => 1, reward: { coins: 200, xp: 100 }, difficulty: 'hard' },
];

function pickRandomTypes(count, available) {
    const pool = [...available];
    const picked = [];
    while (picked.length < count && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
    }
    return picked;
}

function getNextMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight;
}

async function generateDailyTasks(client, playerId, level) {
    const expiresAt = getNextMidnight();
    const picked = pickRandomTypes(3, DAILY_TASK_TYPES);

    for (const taskType of picked) {
        const target = taskType.target(level);
        const reward = { ...taskType.reward };
        await client.query(`
            INSERT INTO daily_tasks (player_id, task_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status, created_at)
            VALUES ($1, $2, $3, 0, $4::jsonb, $5, false, false, $6, 'active', NOW())
            ON CONFLICT (player_id, task_type, expires_at) DO NOTHING
        `, [playerId, taskType.type, target, JSON.stringify(reward), expiresAt, taskType.difficulty]);
    }
}

// GET /daily-tasks — получить список заданий на день
router.get('/', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const player = await client.query('SELECT id, level FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            if (!player.rows[0]) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }
            const level = Number(player.rows[0].level) || 1;

            // Проверяем, есть ли задания на сегодня
            const existing = await client.query(
                `SELECT id, task_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status
                 FROM daily_tasks WHERE player_id = $1 AND expires_at > NOW() ORDER BY id`,
                [playerId]
            );

            if (existing.rows.length === 0) {
                await generateDailyTasks(client, playerId, level);
            }

            const tasks = await client.query(
                `SELECT id, task_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status
                 FROM daily_tasks WHERE player_id = $1 AND expires_at > NOW() ORDER BY id`,
                [playerId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        tasks: tasks.rows.map((t) => ({
                            id: t.id,
                            task_type: t.task_type,
                            target_value: t.target_value,
                            current_value: t.current_value,
                            completed: t.completed,
                            claimed: t.claimed,
                            reward: t.reward,
                            expires_at: t.expires_at,
                            difficulty: t.difficulty,
                            status: t.status
                        })),
                        expires_at: tasks.rows[0]?.expires_at || null
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'daily_tasks_list');
    }
});

// POST /daily-tasks/claim — забрать награду за выполненное задание
router.post('/claim', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const idCheck = (require('../../utils/validate').validateId)(req.body?.task_id, 'ID задания');
        if (!idCheck.ok) return res.status(400).json({ success: false, error: idCheck.error, code: idCheck.code });

        const taskId = idCheck.value;

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await client.query('SELECT id, coins, stars, experience FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            if (!lockedPlayer.rows[0]) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const task = await client.query(
                `SELECT id, task_type, target_value, current_value, reward, completed, claimed
                 FROM daily_tasks WHERE id = $1 AND player_id = $2 FOR UPDATE`,
                [taskId, playerId]
            );

            if (!task.rows[0]) {
                return { status: 404, body: { success: false, error: 'Задание не найдено', code: 'TASK_NOT_FOUND' } };
            }

            const t = task.rows[0];
            if (!t.completed) {
                return { status: 400, body: { success: false, error: 'Задание не выполнено', code: 'TASK_NOT_COMPLETED' } };
            }
            if (t.claimed) {
                return { status: 400, body: { success: false, error: 'Награда уже получена', code: 'TASK_ALREADY_CLAIMED' } };
            }

            const reward = (typeof t.reward === 'string') ? JSON.parse(t.reward) : (t.reward || {});

            // Начисляем награды
            if (reward.coins) {
                await client.query('UPDATE players SET coins = COALESCE(coins, 0) + $1 WHERE id = $2', [reward.coins, playerId]);
            }
            if (reward.stars) {
                await client.query('UPDATE players SET stars = COALESCE(stars, 0) + $1 WHERE id = $2', [reward.stars, playerId]);
            }
            if (reward.xp) {
                const { PlayerHelper } = require('../../utils/serverApi');
                await PlayerHelper.addExperience(playerId, reward.xp, client);
            }
            if (reward.items && Array.isArray(reward.items)) {
                const { addItemToInventory } = require('../../utils/game-helpers');
                const player = await client.query('SELECT inventory FROM players WHERE id = $1', [playerId]);
                const inventory = (typeof player.rows[0]?.inventory === 'string') ? JSON.parse(player.rows[0].inventory) : (player.rows[0]?.inventory || []);
                for (const item of reward.items) {
                    addItemToInventory(inventory, item, null);
                }
                await client.query('UPDATE players SET inventory = $1::jsonb WHERE id = $2', [JSON.stringify(inventory), playerId]);
            }

            // Помечаем задание как выданное
            await client.query(
                'UPDATE daily_tasks SET claimed = true, claimed_at = NOW(), status = $1 WHERE id = $2',
                ['claimed', taskId]
            );

            // Инкрементируем счётчик
            await client.query('UPDATE players SET daily_tasks_completed = COALESCE(daily_tasks_completed, 0) + 1 WHERE id = $1', [playerId]);

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        task_id: taskId,
                        reward,
                        message: 'Награда получена'
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);

        // Логирование после коммита
        if (outcome.status === 200) {
            try {
                await logPlayerAction(playerId, 'daily_task_claim', { task_id: taskId });
            } catch (_) { /* ignore */ }
        }
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'daily_task_claim');
    }
});

// POST /daily-tasks/claim-all — забрать все выполненные задания
router.post('/claim-all', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await client.query('SELECT id FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            if (!lockedPlayer.rows[0]) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const pending = await client.query(
                `SELECT id, reward FROM daily_tasks WHERE player_id = $1 AND completed = true AND claimed = false FOR UPDATE`,
                [playerId]
            );

            if (pending.rows.length === 0) {
                return { status: 200, body: { success: true, data: { claimed: [], total_reward: {} } } };
            }

            let totalCoins = 0, totalStars = 0, totalXp = 0;
            const claimedIds = [];

            for (const t of pending.rows) {
                const reward = (typeof t.reward === 'string') ? JSON.parse(t.reward) : (t.reward || {});
                if (reward.coins) totalCoins += reward.coins;
                if (reward.stars) totalStars += reward.stars;
                if (reward.xp) totalXp += reward.xp;

                await client.query(
                    'UPDATE daily_tasks SET claimed = true, claimed_at = NOW(), status = $1 WHERE id = $2',
                    ['claimed', t.id]
                );
                claimedIds.push(t.id);
            }

            if (totalCoins > 0) await client.query('UPDATE players SET coins = COALESCE(coins, 0) + $1 WHERE id = $2', [totalCoins, playerId]);
            if (totalStars > 0) await client.query('UPDATE players SET stars = COALESCE(stars, 0) + $1 WHERE id = $2', [totalStars, playerId]);
            if (totalXp > 0) {
                const { PlayerHelper } = require('../../utils/serverApi');
                await PlayerHelper.addExperience(playerId, totalXp, client);
            }

            await client.query('UPDATE players SET daily_tasks_completed = COALESCE(daily_tasks_completed, 0) + $1 WHERE id = $2', [pending.rows.length, playerId]);

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        claimed: claimedIds,
                        total_reward: { coins: totalCoins, stars: totalStars, xp: totalXp }
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);

        if (outcome.status === 200 && outcome.body.data.claimed.length > 0) {
            try {
                await logPlayerAction(playerId, 'daily_task_claim_all', { count: outcome.body.data.claimed.length });
            } catch (_) { /* ignore */ }
        }
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'daily_task_claim_all');
    }
});

// POST /daily-tasks/reroll — заменить задание
router.post('/reroll', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const idCheck = (require('../../utils/validate').validateId)(req.body?.task_id, 'ID задания');
        if (!idCheck.ok) return res.status(400).json({ success: false, error: idCheck.error, code: idCheck.code });

        const taskId = idCheck.value;

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await client.query('SELECT id, level, daily_task_rerolls, daily_task_reroll_reset_at FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            if (!lockedPlayer.rows[0]) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const player = lockedPlayer.rows[0];
            const level = Number(player.level) || 1;

            // Сброс счётчика reroll раз в день
            const now = new Date();
            const resetAt = player.daily_task_reroll_reset_at ? new Date(player.daily_task_reroll_reset_at) : null;
            let rerollsLeft = Number(player.daily_task_rerolls || 0);
            if (!resetAt || (now - resetAt) > 24 * 60 * 60 * 1000) {
                rerollsLeft = 3;
                await client.query('UPDATE players SET daily_task_rerolls = 3, daily_task_reroll_reset_at = NOW() WHERE id = $1', [playerId]);
            }

            if (rerollsLeft <= 0) {
                return { status: 400, body: { success: false, error: 'Лимит reroll исчерпан', code: 'REROLL_LIMIT' } };
            }

            const task = await client.query(
                `SELECT id, task_type, completed, claimed, expires_at FROM daily_tasks WHERE id = $1 AND player_id = $2 FOR UPDATE`,
                [taskId, playerId]
            );

            if (!task.rows[0]) {
                return { status: 404, body: { success: false, error: 'Задание не найдено', code: 'TASK_NOT_FOUND' } };
            }

            const t = task.rows[0];
            if (t.completed || t.claimed) {
                return { status: 400, body: { success: false, error: 'Нельзя заменить выполненное/полученное задание', code: 'TASK_LOCKED' } };
            }

            // Выбираем новый тип (не совпадающий с текущим)
            const available = DAILY_TASK_TYPES.filter((dt) => dt.type !== t.task_type);
            if (available.length === 0) {
                return { status: 400, body: { success: false, error: 'Нет доступных типов для замены', code: 'NO_AVAILABLE_TYPES' } };
            }
            const newType = available[Math.floor(Math.random() * available.length)];
            const target = newType.target(level);
            const reward = { ...newType.reward };
            const expiresAt = t.expires_at;

            // Удаляем старое задание и создаём новое
            await client.query('DELETE FROM daily_tasks WHERE id = $1', [taskId]);
            const inserted = await client.query(`
                INSERT INTO daily_tasks (player_id, task_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status, created_at)
                VALUES ($1, $2, $3, 0, $4::jsonb, $5, false, false, $6, 'active', NOW())
                RETURNING id
            `, [playerId, newType.type, target, JSON.stringify(reward), expiresAt, newType.difficulty]);

            await client.query('UPDATE players SET daily_task_rerolls = daily_task_rerolls - 1 WHERE id = $1', [playerId]);

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        old_task_id: taskId,
                        new_task_id: inserted.rows[0]?.id,
                        task_type: newType.type,
                        target_value: target,
                        reward,
                        rerolls_left: rerollsLeft - 1
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);

        if (outcome.status === 200) {
            try {
                await logPlayerAction(playerId, 'daily_task_reroll', { task_id: taskId });
            } catch (_) { /* ignore */ }
        }
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'daily_task_reroll');
    }
});

module.exports = router;
