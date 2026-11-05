// routes/game/contracts.js
// Контракты выживших: генерация, прогресс, выдача наград, claim, abandon, reroll.
const express = require('express');
const { transaction, query, queryOne } = require('../../db/database');
const { validateId, requireAuth } = require('../../utils/validate');
const { getGameHelpers } = require('../../utils/game-helpers');
const { logPlayerAction } = require('../../utils/log');

const router = express.Router();

// --- Каталог типов контрактов ---
const CONTRACT_TYPES = [
    { type: 'hunt', target: (level) => Math.max(1, Math.floor(level / 10) + 1), reward: { coins: 200, xp: 100, items: [] }, difficulty: 'hard', reputation: 10, targetType: 'boss_kill' },
    { type: 'rescue', target: (level) => Math.max(1, Math.floor(level / 5) + 1), reward: { coins: 150, xp: 75, items: [] }, difficulty: 'medium', reputation: 8, targetType: 'boss_damage' },
    { type: 'rat_hunt', target: () => 10, reward: { coins: 50, xp: 20, materials: { 'Крысиный хвост': 5 } }, difficulty: 'easy', reputation: 5, targetType: 'rat_kill' },
    { type: 'scout', target: (level) => Math.max(2, Math.floor(level / 10) + 2), reward: { coins: 60, xp: 25 }, difficulty: 'easy', reputation: 3, targetType: 'locations_visited' },
    { type: 'gather', target: (level) => Math.max(5, Math.floor(level / 3) + 5), reward: { coins: 75, xp: 30 }, difficulty: 'easy', reputation: 4, targetType: 'collect_items' },
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

async function generateContracts(client, playerId, level, count = 1) {
    const expiresAt = getNextMidnight();
    const picked = pickRandomTypes(count, CONTRACT_TYPES);

    for (const ct of picked) {
        const target = ct.target(level);
        const reward = { ...ct.reward };
        await client.query(`
            INSERT INTO survivor_contracts (player_id, contract_type, target_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status, reputation_reward, created_at)
            VALUES ($1, $2, $3, $4, 0, $5::jsonb, $6, false, false, $7, 'active', $8, NOW())
            ON CONFLICT (player_id, contract_type, expires_at) DO NOTHING
        `, [playerId, ct.type, ct.targetType, target, JSON.stringify(reward), expiresAt, ct.difficulty, ct.reputation]);
    }
}

// GET /contracts — список доступных контрактов
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

            // Проверяем, есть ли активные контракты
            const existing = await client.query(
                `SELECT id, contract_type, target_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status, reputation_reward
                 FROM survivor_contracts WHERE player_id = $1 AND expires_at > NOW() AND status = 'active' ORDER BY id`,
                [playerId]
            );

            if (existing.rows.length === 0) {
                await generateContracts(client, playerId, level, 1);
            }

            const contracts = await client.query(
                `SELECT id, contract_type, target_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status, reputation_reward
                 FROM survivor_contracts WHERE player_id = $1 AND expires_at > NOW() AND status = 'active' ORDER BY id`,
                [playerId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        contracts: contracts.rows.map((c) => ({
                            id: c.id,
                            contract_type: c.contract_type,
                            target_type: c.target_type,
                            target_value: c.target_value,
                            current_value: c.current_value,
                            completed: c.completed,
                            claimed: c.claimed,
                            reward: c.reward,
                            expires_at: c.expires_at,
                            difficulty: c.difficulty,
                            status: c.status,
                            reputation_reward: c.reputation_reward
                        })),
                        expires_at: contracts.rows[0]?.expires_at || null
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'contracts_list');
    }
});

// POST /contracts/accept — принять контракт
router.post('/accept', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const idCheck = (require('../../utils/validate').validateId)(req.body?.contract_id, 'ID контракта');
        if (!idCheck.ok) return res.status(400).json({ success: false, error: idCheck.error, code: idCheck.code });

        const contractId = idCheck.value;

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await client.query('SELECT id FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            if (!lockedPlayer.rows[0]) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const contract = await client.query(
                `SELECT id, status, expires_at FROM survivor_contracts WHERE id = $1 AND player_id = $2 FOR UPDATE`,
                [contractId, playerId]
            );

            if (!contract.rows[0]) {
                return { status: 404, body: { success: false, error: 'Контракт не найден', code: 'CONTRACT_NOT_FOUND' } };
            }

            const c = contract.rows[0];
            if (c.status !== 'active') {
                return { status: 400, body: { success: false, error: 'Контракт уже принят или завершён', code: 'CONTRACT_LOCKED' } };
            }
            if (new Date(c.expires_at) <= new Date()) {
                return { status: 400, body: { success: false, error: 'Контракт просрочен', code: 'CONTRACT_EXPIRED' } };
            }

            await client.query(
                `UPDATE survivor_contracts SET status = 'accepted', started_at = NOW() WHERE id = $1`,
                [contractId]
            );

            return {
                status: 200,
                body: { success: true, data: { contract_id: contractId, message: 'Контракт принят' } }
            };
        });

        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'contract_accept');
    }
});

// POST /contracts/progress — обновить прогресс контракта
router.post('/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const idCheck = (require('../../utils/validate').validateId)(req.body?.contract_id, 'ID контракта');
        if (!idCheck.ok) return res.status(400).json({ success: false, error: idCheck.error, code: idCheck.code });

        const contractId = idCheck.value;
        const amount = Math.max(0, Math.round(Number(req.body?.amount) || 0));
        if (amount === 0) return res.status(400).json({ success: false, error: 'Неверное количество', code: 'INVALID_AMOUNT' });

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await client.query('SELECT id FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            if (!lockedPlayer.rows[0]) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const contract = await client.query(
                `SELECT id, target_value, current_value, completed, claimed, expires_at, status FROM survivor_contracts WHERE id = $1 AND player_id = $2 FOR UPDATE`,
                [contractId, playerId]
            );

            if (!contract.rows[0]) {
                return { status: 404, body: { success: false, error: 'Контракт не найден', code: 'CONTRACT_NOT_FOUND' } };
            }

            const c = contract.rows[0];
            if (c.claimed) {
                return { status: 400, body: { success: false, error: 'Контракт уже выполнен и награда получена', code: 'CONTRACT_CLAIMED' } };
            }
            if (new Date(c.expires_at) <= new Date()) {
                await client.query(`UPDATE survivor_contracts SET status = 'expired' WHERE id = $1`, [contractId]);
                return { status: 400, body: { success: false, error: 'Контракт просрочен', code: 'CONTRACT_EXPIRED' } };
            }

            const newValue = Math.min(c.target_value, c.current_value + amount);
            const completed = newValue >= c.target_value;

            await client.query(
                `UPDATE survivor_contracts SET current_value = $1, completed = $2, status = $3 WHERE id = $4`,
                [newValue, completed, completed ? 'completed' : 'active', contractId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        contract_id: contractId,
                        current_value: newValue,
                        target_value: c.target_value,
                        completed
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'contract_progress');
    }
});

// POST /contracts/claim — забрать награду
router.post('/claim', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const idCheck = (require('../../utils/validate').validateId)(req.body?.contract_id, 'ID контракта');
        if (!idCheck.ok) return res.status(400).json({ success: false, error: idCheck.error, code: idCheck.code });

        const contractId = idCheck.value;

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await client.query('SELECT id, coins, stars, experience FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            if (!lockedPlayer.rows[0]) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const contract = await client.query(
                `SELECT id, reward, completed, claimed, reputation_reward, contract_type FROM survivor_contracts WHERE id = $1 AND player_id = $2 FOR UPDATE`,
                [contractId, playerId]
            );

            if (!contract.rows[0]) {
                return { status: 404, body: { success: false, error: 'Контракт не найден', code: 'CONTRACT_NOT_FOUND' } };
            }

            const c = contract.rows[0];
            if (!c.completed) {
                return { status: 400, body: { success: false, error: 'Контракт не выполнен', code: 'CONTRACT_NOT_COMPLETED' } };
            }
            if (c.claimed) {
                return { status: 400, body: { success: false, error: 'Награда уже получена', code: 'CONTRACT_ALREADY_CLAIMED' } };
            }

            const reward = (typeof c.reward === 'string') ? JSON.parse(c.reward) : (c.reward || {});

            // Начисляем награды
            if (reward.coins) await client.query('UPDATE players SET coins = COALESCE(coins, 0) + $1 WHERE id = $2', [reward.coins, playerId]);
            if (reward.stars) await client.query('UPDATE players SET stars = COALESCE(stars, 0) + $1 WHERE id = $2', [reward.stars, playerId]);
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
            if (reward.materials && typeof reward.materials === 'object') {
                // Материалы добавляются как предметы типа 'material'
                const { addItemToInventory } = require('../../utils/game-helpers');
                const player = await client.query('SELECT inventory FROM players WHERE id = $1', [playerId]);
                const inventory = (typeof player.rows[0]?.inventory === 'string') ? JSON.parse(player.rows[0].inventory) : (player.rows[0]?.inventory || []);
                for (const [matName, qty] of Object.entries(reward.materials)) {
                    addItemToInventory(inventory, { name: matName, type: 'material', category: 'material', rarity: 'common', icon: '📦', quantity: qty }, null);
                }
                await client.query('UPDATE players SET inventory = $1::jsonb WHERE id = $2', [JSON.stringify(inventory), playerId]);
            }

            // Репутация
            if (c.reputation_reward) {
                await client.query(
                    `INSERT INTO player_reputation (player_id, reputation, tier, updated_at) VALUES ($1, $2, 'novice', NOW())
                     ON CONFLICT (player_id) DO UPDATE SET reputation = player_reputation.reputation + $2, updated_at = NOW()`,
                    [playerId, c.reputation_reward]
                );
                // Обновить тир
                await client.query(`
                    UPDATE player_reputation SET tier = CASE
                        WHEN reputation >= 100 THEN 'legend'
                        WHEN reputation >= 50 THEN 'veteran'
                        WHEN reputation >= 20 THEN 'hunter'
                        ELSE 'novice'
                    END WHERE player_id = $1
                `, [playerId]);
            }

            // Помечаем контракт как выданный
            await client.query(
                'UPDATE survivor_contracts SET claimed = true, claimed_at = NOW(), status = $1 WHERE id = $2',
                ['claimed', contractId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        contract_id: contractId,
                        reward,
                        reputation_reward: c.reputation_reward,
                        message: 'Награда получена'
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);

        if (outcome.status === 200) {
            try {
                await logPlayerAction(playerId, 'contract_claim', { contract_id: contractId });
            } catch (_) { /* ignore */ }
        }
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'contract_claim');
    }
});

// POST /contracts/abandon — отказаться от контракта
router.post('/abandon', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const idCheck = (require('../../utils/validate').validateId)(req.body?.contract_id, 'ID контракта');
        if (!idCheck.ok) return res.status(400).json({ success: false, error: idCheck.error, code: idCheck.code });

        const contractId = idCheck.value;

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await client.query('SELECT id FROM players WHERE id = $1 FOR UPDATE', [playerId]);
            if (!lockedPlayer.rows[0]) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const contract = await client.query(
                `SELECT id, status, completed, claimed, reputation_reward FROM survivor_contracts WHERE id = $1 AND player_id = $2 FOR UPDATE`,
                [contractId, playerId]
            );

            if (!contract.rows[0]) {
                return { status: 404, body: { success: false, error: 'Контракт не найден', code: 'CONTRACT_NOT_FOUND' } };
            }

            const c = contract.rows[0];
            if (c.claimed) {
                return { status: 400, body: { success: false, error: 'Нельзя отказаться от полученного контракта', code: 'CONTRACT_CLAIMED' } };
            }
            if (c.completed) {
                return { status: 400, body: { success: false, error: 'Нельзя отказаться от выполненного контракта', code: 'CONTRACT_COMPLETED' } };
            }

            // Штраф к репутации
            await client.query(
                `INSERT INTO player_reputation (player_id, reputation, tier, updated_at) VALUES ($1, -10, 'novice', NOW())
                 ON CONFLICT (player_id) DO UPDATE SET reputation = GREATEST(0, player_reputation.reputation - 10), updated_at = NOW()`,
                [playerId]
            );

            await client.query(
                'UPDATE survivor_contracts SET status = $1 WHERE id = $2',
                ['abandoned', contractId]
            );

            return {
                status: 200,
                body: { success: true, data: { contract_id: contractId, message: 'Контракт отменён', reputation_penalty: 10 } }
            };
        });

        res.status(outcome.status).json(outcome.body);

        if (outcome.status === 200) {
            try {
                await logPlayerAction(playerId, 'contract_abandon', { contract_id: contractId });
            } catch (_) { /* ignore */ }
        }
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'contract_abandon');
    }
});

module.exports = router;
