// routes/game/crafting.js
// Крафт предметов из материалов.
const express = require('express');
const { transaction, query, queryOne } = require('../../db/database');
const { validateId, requireAuth } = require('../../utils/validate');
const { getGameHelpers, normalizeInventory } = require('../../utils/game-helpers');
const { safeJsonParse } = require('../../utils/serverApi');
const { lockPlayer } = require('../../db/players');
const { logPlayerAction } = require('../../utils/log');

const router = express.Router();

// GET /crafting/recipes — список рецептов
router.get('/recipes', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const player = await queryOne('SELECT level FROM players WHERE id = $1', [playerId]);
        const level = Number(player?.level) || 1;

        const recipes = await query(
            `SELECT cr.id, cr.name, cr.result_item_id, cr.result_quantity, cr.required_materials,
                    cr.coins_cost, cr.stars_cost, cr.min_level, cr.category, cr.enabled, cr.unlock_condition,
                    i.name AS result_name, i.description AS result_description, i.type AS result_type,
                    i.rarity AS result_rarity, i.icon AS result_icon, i.stats AS result_stats
             FROM crafting_recipes cr
             LEFT JOIN items i ON i.id = cr.result_item_id
             WHERE cr.enabled = true AND cr.min_level <= $1
             ORDER BY cr.min_level, cr.id`,
            [level]
        );

        res.json({ success: true, data: { recipes: recipes.rows } });
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'crafting_recipes');
    }
});

// GET /crafting/materials — список материалов игрока
router.get('/materials', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const player = await queryOne('SELECT inventory FROM players WHERE id = $1', [playerId]);
        const inventory = (typeof player?.inventory === 'string') ? JSON.parse(player.inventory) : (player?.inventory || []);

        const materials = inventory.filter((item) => {
            const type = String(item?.type || '').toLowerCase();
            const category = String(item?.category || '').toLowerCase();
            return type === 'resource' || category === 'material' || category === 'ammo';
        });

        res.json({ success: true, data: { materials } });
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'crafting_materials');
    }
});

// POST /crafting/craft — крафт предмета
router.post('/craft', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const recipeId = Number(req.body?.recipe_id);
        const rawQty = Number(req.body?.quantity);
        if (!Number.isFinite(rawQty) || !Number.isInteger(rawQty) || rawQty < 1) {
            return res.status(400).json({ success: false, error: 'Количество должно быть целым числом >= 1', code: 'INVALID_QUANTITY' });
        }
        const quantity = Math.min(10, rawQty);

        if (!Number.isInteger(recipeId) || recipeId <= 0) {
            return res.status(400).json({ success: false, error: 'Неверный ID рецепта', code: 'INVALID_RECIPE_ID' });
        }

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await lockPlayer(playerId, client, 'id, level, coins, stars, inventory');
            if (!lockedPlayer) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const player = lockedPlayer;
            const level = Number(player.level) || 1;

            const recipe = await client.query('SELECT * FROM crafting_recipes WHERE id = $1 AND enabled = true', [recipeId]);
            if (!recipe.rows[0]) {
                return { status: 404, body: { success: false, error: 'Рецепт не найден', code: 'RECIPE_NOT_FOUND' } };
            }

            const r = recipe.rows[0];
            if (level < Number(r.min_level || 1)) {
                return { status: 400, body: { success: false, error: 'Недостаточный уровень', code: 'LEVEL_TOO_LOW' } };
            }

            let materials = {};
            try {
                materials = safeJsonParse(r.required_materials, {});
            } catch (_) {
                return { status: 400, body: { success: false, error: 'Неверный формат материалов', code: 'INVALID_MATERIALS' } };
            }
            const inventory = normalizeInventory(player.inventory);

            // Проверка материалов
            for (const [matName, matQty] of Object.entries(materials)) {
                const needed = matQty * quantity;
                const owned = inventory.filter((i) => i.name === matName && i.type === 'resource').reduce((s, i) => s + (Number(i.quantity) || 0), 0);
                if (owned < needed) {
                    return { status: 400, body: { success: false, error: `Недостаточно ${matName}: нужно ${needed}, есть ${owned}`, code: 'NOT_ENOUGH_MATERIALS' } };
                }
            }

            // Проверка монет
            const totalCoins = (r.coins_cost || 0) * quantity;
            if (Number(player.coins || 0) < totalCoins) {
                return { status: 400, body: { success: false, error: 'Недостаточно монет', code: 'NOT_ENOUGH_COINS' } };
            }

            // Проверка звёзд
            const totalStars = (r.stars_cost || 0) * quantity;
            if (Number(player.stars || 0) < totalStars) {
                return { status: 400, body: { success: false, error: 'Недостаточно звёзд', code: 'NOT_ENOUGH_STARS' } };
            }

            // Проверка слотов (результат занимает слоты)
            const MAX_SLOTS = 100;
            const resultItem = await client.query('SELECT * FROM items WHERE id = $1', [r.result_item_id]);
            if (!resultItem.rows[0]) {
                return { status: 404, body: { success: false, error: 'Результат крафта не найден', code: 'RESULT_NOT_FOUND' } };
            }
            const dbItem = resultItem.rows[0];

            // Списываем материалы
            for (const [matName, matQty] of Object.entries(materials)) {
                const needed = matQty * quantity;
                let remaining = needed;
                for (let i = 0; i < inventory.length && remaining > 0; i++) {
                    const item = inventory[i];
                    if (!item || item.name !== matName || item.type !== 'resource') continue;
                    const currentQty = Number(item.quantity || 0);
                    if (currentQty <= 0) continue;
                    const toRemove = Math.min(currentQty, remaining);
                    inventory[i] = { ...item, quantity: currentQty - toRemove };
                    remaining -= toRemove;
                    if (inventory[i].quantity <= 0) {
                        inventory.splice(i, 1);
                        i--;
                    }
                }
            }

            // Создаём результат
            const { createInventoryItem, addItemToInventory } = require('../../utils/game-helpers');
            const resultItemObj = createInventoryItem(dbItem, { quantity: r.result_quantity * quantity });

            // Проверяем вместимость ДО списания монет
            const slotsBefore = inventory.length;
            const slotsAdded = addItemToInventory(inventory, resultItemObj, dbItem);
            if (inventory.length > MAX_SLOTS) {
                // Откатываем добавление
                inventory.length = slotsBefore;
                return { status: 400, body: { success: false, error: 'Инвентарь переполнен', code: 'INVENTORY_FULL' } };
            }

            // Списываем монеты и звёзды ТОЛЬКО после успешного добавления
            if (totalCoins > 0) await client.query('UPDATE players SET coins = COALESCE(coins, 0) - $1 WHERE id = $2', [totalCoins, playerId]);
            if (totalStars > 0) await client.query('UPDATE players SET stars = COALESCE(stars, 0) - $1 WHERE id = $2', [totalStars, playerId]);

            await client.query('UPDATE players SET inventory = $1::jsonb WHERE id = $2', [JSON.stringify(inventory), playerId]);

            // Трекинг для достижений
            const { trackCollectedItems } = require('../../utils/game-helpers');
            if (dbItem.id) await trackCollectedItems(client, playerId, [dbItem.id]);

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        recipe_id: recipeId,
                        result_item: dbItem.name,
                        quantity: r.result_quantity * quantity,
                        coins_spent: totalCoins,
                        stars_spent: totalStars,
                        message: `Скрафчено ${r.result_quantity * quantity} × ${dbItem.name}`
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);

        if (outcome.status === 200) {
            try {
                await logPlayerAction(playerId, 'craft_item', { recipe_id: recipeId, quantity });
            } catch (_) { /* ignore */ }
        }
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'crafting_craft');
    }
});

// POST /crafting/craft-all — крафт максимального количества
router.post('/craft-all', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const recipeId = Number(req.body?.recipe_id);
        if (!Number.isInteger(recipeId) || recipeId <= 0) {
            return res.status(400).json({ success: false, error: 'Неверный ID рецепта', code: 'INVALID_RECIPE_ID' });
        }

        // Сначала получаем рецепт и проверяем материалы
        const recipe = await queryOne('SELECT * FROM crafting_recipes WHERE id = $1 AND enabled = true', [recipeId]);
        if (!recipe) {
            return res.status(404).json({ success: false, error: 'Рецепт не найден', code: 'RECIPE_NOT_FOUND' });
        }

        const player = await queryOne('SELECT level, coins, stars, inventory FROM players WHERE id = $1', [playerId]);
        if (!player) {
            return res.status(404).json({ success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' });
        }

        const level = Number(player.level) || 1;
        if (level < Number(recipe.min_level || 1)) {
            return res.status(400).json({ success: false, error: 'Недостаточный уровень', code: 'LEVEL_TOO_LOW' });
        }

        const materials = safeJsonParse(recipe.required_materials, {});
        const inventory = normalizeInventory(player.inventory);

        // Считаем максимальное количество
        let maxQty = 100; // кап
        for (const [matName, matQty] of Object.entries(materials)) {
            const owned = inventory.filter((i) => i.name === matName && i.type === 'resource').reduce((s, i) => s + (Number(i.quantity) || 0), 0);
            const possible = Math.floor(owned / matQty);
            if (possible < maxQty) maxQty = possible;
        }

        if (maxQty <= 0) {
            return res.status(400).json({ success: false, error: 'Недостаточно материалов', code: 'NOT_ENOUGH_MATERIALS' });
        }

        // Проверяем монеты
        const totalCoins = (recipe.coins_cost || 0) * maxQty;
        if (Number(player.coins || 0) < totalCoins) {
            maxQty = Math.floor(Number(player.coins || 0) / (recipe.coins_cost || 1));
            if (maxQty <= 0) {
                return res.status(400).json({ success: false, error: 'Недостаточно монет', code: 'NOT_ENOUGH_COINS' });
            }
        }

        // Проверяем звёзды
        const totalStars = (recipe.stars_cost || 0) * maxQty;
        if (Number(player.stars || 0) < totalStars) {
            maxQty = Math.floor(Number(player.stars || 0) / (recipe.stars_cost || 1));
            if (maxQty <= 0) {
                return res.status(400).json({ success: false, error: 'Недостаточно звёзд', code: 'NOT_ENOUGH_STARS' });
            }
        }

        // Проверяем слоты
        const MAX_SLOTS = 100;
        const freeSlots = MAX_SLOTS - inventory.length;
        const resultQty = recipe.result_quantity * maxQty;
        const slotsNeeded = Math.ceil(resultQty / (recipe.result_item?.max_stack || 99));
        if (slotsNeeded > freeSlots) {
            maxQty = Math.floor(freeSlots * 99 / recipe.result_quantity);
            if (maxQty <= 0) {
                return res.status(400).json({ success: false, error: 'Инвентарь переполнен', code: 'INVENTORY_FULL' });
            }
        }

        // Делегируем в /craft с quantity=maxQty
        req.body = { recipe_id: recipeId, quantity: maxQty };
        // Перенаправляем на /craft
        res.redirect(307, '/api/game/crafting/craft');
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'crafting_craft_all');
    }
});



// POST /crafting/discover - experimental machine: discover a random recipe
router.post('/discover', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const materials = Array.isArray(req.body?.materials) ? req.body.materials : [];
        if (materials.length === 0) {
            return res.status(400).json({ success: false, error: 'Укажите материалы', code: 'NO_MATERIALS' });
        }

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await lockPlayer(playerId, client, 'id, level, inventory');
            if (!lockedPlayer) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const player = lockedPlayer;
            const level = Number(player.level) || 1;

            const inventory = normalizeInventory(player.inventory);
            for (const matName of materials) {
                const idx = inventory.findIndex((i) => i.name === matName && i.type === 'resource' && Number(i.quantity) > 0);
                if (idx === -1) {
                    return { status: 400, body: { success: false, error: 'Материал не найден: ' + matName, code: 'MATERIAL_NOT_FOUND' } };
                }
                inventory[idx].quantity = Number(inventory[idx].quantity) - 1;
                if (inventory[idx].quantity <= 0) inventory.splice(idx, 1);
            }

            const recipes = await client.query(
                'SELECT id, name FROM crafting_recipes WHERE enabled = true AND min_level <= $1 ORDER BY RANDOM() LIMIT 1',
                [level]
            );
            if (recipes.rows.length === 0) {
                return { status: 404, body: { success: false, error: 'Нет доступных рецептов', code: 'NO_RECIPES' } };
            }

            const recipe = recipes.rows[0];

            await client.query(
                'INSERT INTO player_recipes (player_id, recipe_id, unlocked_at, unlock_source) VALUES ($1, $2, NOW(), $3) ON CONFLICT DO NOTHING',
                [playerId, recipe.id, 'discovery']
            );

            await client.query('UPDATE players SET inventory = $1::jsonb WHERE id = $2', [JSON.stringify(inventory), playerId]);

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        recipe_id: recipe.id,
                        recipe_name: recipe.name,
                        message: 'Открыт новый рецепт: ' + recipe.name
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'crafting_discover');
    }
});

// POST /crafting/refine - конверсия материалов
router.post('/refine', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return (require('../../utils/serverApi').unauthorized)(res);

        const fromMat = String(req.body?.from_material || '').trim();
        const toMat = String(req.body?.to_material || '').trim();
        const quantity = Math.max(1, Math.min(50, Number(req.body?.quantity) || 1));

        if (!fromMat || !toMat) {
            return res.status(400).json({ success: false, error: 'Укажите материалы', code: 'INVALID_MATERIALS' });
        }

        const outcome = await (require('../../db/database').transaction)(async (client) => {
            const lockedPlayer = await lockPlayer(playerId, client, 'id, level, inventory, coins');
            if (!lockedPlayer) {
                return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };
            }

            const player = lockedPlayer;
            const level = Number(player.level) || 1;

            const refinement = await client.query(
                'SELECT * FROM material_refinements WHERE from_material = $1 AND to_material = $2 AND enabled = true AND min_level <= $3',
                [fromMat, toMat, level]
            );
            if (!refinement.rows[0]) {
                return { status: 404, body: { success: false, error: 'Рафинирование недоступно', code: 'REFINEMENT_NOT_FOUND' } };
            }

            const r = refinement.rows[0];
            const ratio = Number(r.ratio) || 3;
            const lossPercent = Number(r.loss_percent) || 0;
            const coinsCost = (r.coins_cost || 0) * quantity;

            const inventory = normalizeInventory(player.inventory);

            const owned = inventory.filter((i) => i.name === fromMat && i.type === 'resource').reduce((s, i) => s + (Number(i.quantity) || 0), 0);
            const needed = ratio * quantity;
            if (owned < needed) {
                return { status: 400, body: { success: false, error: 'Недостаточно ' + fromMat + ': нужно ' + needed + ', есть ' + owned, code: 'NOT_ENOUGH_MATERIALS' } };
            }

            if (coinsCost > 0 && Number(player.coins || 0) < coinsCost) {
                return { status: 400, body: { success: false, error: 'Недостаточно монет', code: 'NOT_ENOUGH_COINS' } };
            }

            let remaining = needed;
            for (let i = 0; i < inventory.length && remaining > 0; i++) {
                const item = inventory[i];
                if (!item || item.name !== fromMat || item.type !== 'resource') continue;
                const currentQty = Number(item.quantity || 0);
                if (currentQty <= 0) continue;
                const toRemove = Math.min(currentQty, remaining);
                inventory[i] = { ...item, quantity: currentQty - toRemove };
                remaining -= toRemove;
                if (inventory[i].quantity <= 0) {
                    inventory.splice(i, 1);
                    i--;
                }
            }

            const resultQty = Math.floor(quantity * (1 - lossPercent / 100));
            if (resultQty > 0) {
                const { addItemToInventory } = require('../../utils/game-helpers');
                addItemToInventory(inventory, { name: toMat, type: 'resource', category: 'material', rarity: 'common', icon: '📦', quantity: resultQty }, null);
            }

            if (coinsCost > 0) {
                await client.query('UPDATE players SET coins = COALESCE(coins, 0) - $1 WHERE id = $2', [coinsCost, playerId]);
            }
            await client.query('UPDATE players SET inventory = $1::jsonb WHERE id = $2', [JSON.stringify(inventory), playerId]);

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        from: fromMat,
                        to: toMat,
                        quantity,
                        result_qty: resultQty,
                        loss_percent: lossPercent,
                        coins_spent: coinsCost,
                        message: 'Рафинировано ' + quantity + ' ' + fromMat + ' → ' + resultQty + ' ' + toMat
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);
    } catch (error) {
        const { handleConnectionError, handleError } = require('../../utils/serverApi');
        if (handleConnectionError(res, error)) return;
        handleError(res, error, 'crafting_refine');
    }
});

module.exports = router;
