// routes/game/pois.js
// POI (точки интереса) по локациям: игроки, NPC, квесты.
const express = require('express');
const { query, queryOne } = require('../../db/database');
const { normalizeInventory } = require('../../utils/game-helpers');
const { lockPlayer } = require('../../db/players');

const router = express.Router();

// GET /locations/:locationId/pois — список POI локации.
router.get('/:locationId', async (req, res) => {
    try {
        const playerId = req.playerId;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const locationId = Number(req.params.locationId);
        if (!Number.isInteger(locationId) || locationId <= 0) {
            return res.status(400).json({ success: false, error: 'Неверный ID локации', code: 'INVALID_LOCATION_ID' });
        }

        const pois = await query(
            `SELECT id, name, description, energy_cost, risk_level, required_item_id, loot_table, cooldown_minutes, max_uses_per_day, enabled
             FROM location_pois WHERE location_id = $1 AND enabled = true ORDER BY risk_level, id`,
            [locationId]
        );

        // Получение таймеров перезарядки игрока по POI.
        const cooldowns = await query(
            `SELECT poi_id, last_used_at FROM player_poi_cooldowns WHERE player_id = $1 AND poi_id = ANY($2::int[])`,
            [playerId, pois.rows.map((p) => p.id)]
        );
        const cooldownMap = {};
        for (const c of cooldowns.rows) {
            cooldownMap[c.poi_id] = c.last_used_at;
        }

        res.json({
            success: true,
            data: {
                pois: pois.rows.map((p) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    energy_cost: p.energy_cost,
                    risk_level: p.risk_level,
                    required_item_id: p.required_item_id,
                    loot_table: p.loot_table,
                    cooldown_minutes: p.cooldown_minutes,
                    max_uses_per_day: p.max_uses_per_day,
                    last_used_at: cooldownMap[p.id] || null
                }))
            }
        });
    } catch (error) {
        const { handleError } = require('../../utils/serverApi');
        handleError(res, error, 'pois_list');
    }
});

// POST /locations/poi/:poiId/search — исследование POI.
router.post('/:poiId/search', async (req, res) => {
    try {
        const playerId = req.playerId;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const poiId = Number(req.params.poiId);
        if (!Number.isInteger(poiId) || poiId <= 0) {
            return res.status(400).json({ success: false, error: 'Неверный ID POI', code: 'INVALID_POI_ID' });
        }

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await lockPlayer(playerId, client, 'id, energy, last_energy_update, level, current_location_id, radiation');
            if (!lockedPlayer) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const player = lockedPlayer;
            const poi = await client.query('SELECT * FROM location_pois WHERE id = $1 AND enabled = true', [poiId]);
            if (!poi.rows[0]) {
                return { status: 404, body: { success: false, error: 'POI не найден', code: 'POI_NOT_FOUND' } };
            }

            const poiData = poi.rows[0];

            // Проверка: игрок в той же локации.
            if (player.current_location_id !== poiData.location_id) {
                return { status: 400, body: { success: false, error: 'Вы не в этом месте', code: 'WRONG_LOCATION' } };
            }

            // Проверка энергии.
            const energy = Number(player.energy || 0);
            if (energy < poiData.energy_cost) {
                return { status: 400, body: { success: false, error: 'Недостаточно энергии', code: 'NOT_ENOUGH_ENERGY' } };
            }

            // Проверка необходимого предмета.
            if (poiData.required_item_id) {
                const inventory = normalizeInventory(player.inventory);
                const hasItem = inventory.some((i) => Number(i.id) === Number(poiData.required_item_id) && Number(i.quantity) > 0);
                if (!hasItem) {
                    return { status: 400, body: { success: false, error: 'Необходимый предмет не найден', code: 'MISSING_REQUIRED_ITEM' } };
                }
            }

            // Проверка перезарядки.
            if (poiData.cooldown_minutes > 0) {
                const cooldown = await client.query(
                    'SELECT last_used_at FROM player_poi_cooldowns WHERE player_id = $1 AND poi_id = $2',
                    [playerId, poiId]
                );
                if (cooldown.rows[0]) {
                    const lastUsed = new Date(cooldown.rows[0].last_used_at);
                    const cooldownEnd = new Date(lastUsed.getTime() + poiData.cooldown_minutes * 60 * 1000);
                    if (new Date() < cooldownEnd) {
                        return { status: 400, body: { success: false, error: 'POI на перезарядке', code: 'POI_COOLDOWN' } };
                    }
                }
            }

            // Проверка лимита использований в день.
            if (poiData.max_uses_per_day > 0) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const uses = await client.query(
                    `SELECT COUNT(*) as cnt FROM player_poi_cooldowns WHERE player_id = $1 AND poi_id = $2 AND last_used_at >= $3`,
                    [playerId, poiId, today]
                );
                if (Number(uses.rows[0]?.cnt || 0) >= poiData.max_uses_per_day) {
                    return { status: 400, body: { success: false, error: 'Лимит использований на сегодня исчерпан', code: 'POI_DAILY_LIMIT' } };
                }
            }

            // Списывание энергии.
            await client.query('UPDATE players SET energy = GREATEST(0, energy - $1) WHERE id = $2', [poiData.energy_cost, playerId]);

            // Запись перезарядки.
            await client.query(`
                INSERT INTO player_poi_cooldowns (player_id, poi_id, last_used_at) VALUES ($1, $2, NOW())
                ON CONFLICT (player_id, poi_id) DO UPDATE SET last_used_at = NOW()
            `, [playerId, poiId]);

            // Получение лута из loot_table (случайный).
            const foundItem = null; // TODO: реализовать выпадение лута из loot_table

            // Обновление прогресса.
            try {
                const { progressContract } = require('../../utils/game-helpers');
                if (typeof progressContract === 'function') await progressContract(client, playerId, 'scout', 1);
            } catch (_) { /* ignore */ }

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        poi_id: poiId,
                        name: poiData.name,
                        energy_spent: poiData.energy_cost,
                        found_item: foundItem,
                        message: `Вы исследовали ${poiData.name}`
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        const { handleError } = require('../../utils/serverApi');
        handleError(res, error, 'poi_search');
    }
});

// GET /locations/:locationId/mastery — мастерство локации.
router.get('/:locationId/mastery', async (req, res) => {
    try {
        const playerId = req.playerId;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const locationId = Number(req.params.locationId);
        if (!Number.isInteger(locationId) || locationId <= 0) {
            return res.status(400).json({ success: false, error: 'Неверный ID локации', code: 'INVALID_LOCATION_ID' });
        }

        const mastery = await queryOne(
            'SELECT mastery_level, visits_count, last_visit_at FROM location_mastery WHERE player_id = $1 AND location_id = $2',
            [playerId, locationId]
        );

        res.json({
            success: true,
            data: {
                location_id: locationId,
                mastery_level: mastery?.mastery_level || 0,
                visits_count: mastery?.visits_count || 0,
                last_visit_at: mastery?.last_visit_at || null
            }
        });

    } catch (error) {
        const { handleError } = require('../../utils/serverApi');
        handleError(res, error, 'location_mastery');
    }
});

module.exports = router;
