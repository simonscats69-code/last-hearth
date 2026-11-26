// routes/game/crafting.js
// Крафт предметов из материалов.
const express = require('express');
const { query, queryOne } = require('../../db/database');
const { normalizeInventory } = require('../../utils/game-helpers');
const { getGameHelpers } = require('../../utils/getGameHelpers');
const helpers = getGameHelpers();
const { safeJsonParse } = require('../../utils/serverApi');
const { lockPlayer } = require('../../db/players');
const { logPlayerAction } = require('../../utils/log');
const { playerIdGuard, handleRouteError } = require('../../utils/routeHelpers');
const { setPlayerInventory } = require('../../db/playerRepository');

const router = express.Router();

// GET /crafting/recipes — список рецептов
router.get('/recipes', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

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
        handleRouteError(res, error, 'crafting_recipes', req.playerId);
    }
});

// GET /crafting/materials — список материалов игрока
router.get('/materials', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

        const player = await queryOne('SELECT inventory FROM players WHERE id = $1', [playerId]);
        const inventory = await (helpers.loadInventoryFromTable || (async () => null))(null, playerId) || normalizeInventory(player?.inventory);

        const materials = inventory.filter((item) => {
            const type = String(item?.type || '').toLowerCase();
            const category = String(item?.category || '').toLowerCase();
            return type === 'resource' || category === 'material' || category === 'ammo';
        });

        res.json({ success: true, data: { materials } });
    } catch (error) {
        handleRouteError(res, error, 'crafting_materials', req.playerId);
    }
});

// POST /crafting/craft — крафт предмета
router.post('/craft', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

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
                return { status: 404, body: { success: false, error: 'Р ецепт не найден', code: 'RECIPE_NOT_FOUND' } };
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
            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);

            // Загрузка данных материалов из каталога для проверки по id+type.
            const materialNames = Object.keys(materials);
            const materialRows = materialNames.length > 0
                ? await client.query('SELECT id, name, type FROM items WHERE name = ANY($1::text[])', [materialNames])
                : { rows: [] };
            const materialById = new Map(materialRows.rows.map((row) => [row.name, row]));

            const normalizeId = (v) => {
                const n = Number(v);
                return Number.isSafeInteger(n) ? n : null;
            };
            const materialMatches = (entry, matName) => {
                const matItem = materialById.get(matName);
                const entryId = normalizeId(entry?.id);
                const matId = matItem ? normalizeId(matItem.id) : null;
                const nameMatches = String(entry?.name || '').toLowerCase() === String(matName || '').toLowerCase();
                const typeMatches = matItem
                    ? (entryId !== null && matId !== null
                        ? entryId === matId && String(entry?.type || '').toLowerCase() === String(matItem.type || '').toLowerCase()
                        : (entryId === null && nameMatches && String(entry?.type || '').toLowerCase() === String(matItem.type || '').toLowerCase()))
                    : (nameMatches && String(entry?.type || '').toLowerCase() === 'resource');
                return typeMatches;
            };

            // Проверка материалов
            for (const [matName, matQty] of Object.entries(materials)) {
                const needed = matQty * quantity;
                const owned = inventory
                    .filter((i) => materialMatches(i, matName))
                    .reduce((s, i) => s + (Number(i.quantity) || 0), 0);
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
                return { status: 404, body: { success: false, error: 'Р езультат крафта не найден', code: 'RESULT_NOT_FOUND' } };
            }
            const dbItem = resultItem.rows[0];

            // Снимок инвентаря для корректного отката.
            const inventorySnapshot = JSON.parse(JSON.stringify(inventory));

            // Списываем материалы
            for (const [matName, matQty] of Object.entries(materials)) {
                const needed = matQty * quantity;
                let remaining = needed;
                for (let i = 0; i < inventory.length && remaining > 0; i++) {
                    const item = inventory[i];
                    if (!item || !materialMatches(item, matName)) continue;
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

            addItemToInventory(inventory, resultItemObj, dbItem);
            if (inventory.length > MAX_SLOTS) {
                // Откатываем добавление и списание материалов.
                inventory.splice(0, inventory.length, ...inventorySnapshot.map((x) => ({ ...x })));
                return { status: 400, body: { success: false, error: 'Инвентарь переполнен', code: 'INVENTORY_FULL' } };
            }

            // Списываем монеты и звёзды ТОЛЬКО после успешного добавления
            if (totalCoins > 0) await client.query('UPDATE players SET coins = COALESCE(coins, 0) - $1 WHERE id = $2', [totalCoins, playerId]);
            if (totalStars > 0) await client.query('UPDATE players SET stars = COALESCE(stars, 0) - $1 WHERE id = $2', [totalStars, playerId]);

            await setPlayerInventory(playerId, inventory, client);

            // Синхронизация инвентаря в нормализованную таблицу
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

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
        handleRouteError(res, error, 'crafting_craft', req.playerId);
    }
});

// POST /crafting/craft-all — крафт максимального количества
router.post('/craft-all', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

        const recipeId = Number(req.body?.recipe_id);
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

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);

            const materialNames = Object.keys(materials);
            const materialRows = materialNames.length > 0
                ? await client.query('SELECT id, name, type FROM items WHERE name = ANY($1::text[])', [materialNames])
                : { rows: [] };
            const materialById = new Map(materialRows.rows.map((row) => [row.name, row]));
            const normalizeId = (v) => {
                const n = Number(v);
                return Number.isSafeInteger(n) ? n : null;
            };
            const materialMatches = (entry, matName) => {
                const matItem = materialById.get(matName);
                const entryId = normalizeId(entry?.id);
                const matId = matItem ? normalizeId(matItem.id) : null;
                const nameMatches = String(entry?.name || '').toLowerCase() === String(matName || '').toLowerCase();
                if (matItem) {
                    if (entryId !== null && matId !== null) {
                        return entryId === matId && String(entry?.type || '').toLowerCase() === String(matItem.type || '').toLowerCase();
                    }
                    return entryId === null && nameMatches && String(entry?.type || '').toLowerCase() === String(matItem.type || '').toLowerCase();
                }
                return nameMatches && String(entry?.type || '').toLowerCase() === 'resource';
            };

            // Считаем максимальное количество
            let maxQty = 100;
            for (const [matName, matQty] of Object.entries(materials)) {
                const owned = inventory.filter((i) => materialMatches(i, matName)).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
                const possible = Math.floor(owned / (Number(matQty) || 1));
                if (possible < maxQty) maxQty = possible;
            }

            if (maxQty <= 0) {
                return { status: 400, body: { success: false, error: 'Недостаточно материалов', code: 'NOT_ENOUGH_MATERIALS' } };
            }

            const totalCoins = (r.coins_cost || 0) * maxQty;
            if (Number(player.coins || 0) < totalCoins) {
                maxQty = (r.coins_cost || 0) > 0 ? Math.floor(Number(player.coins || 0) / (r.coins_cost || 1)) : maxQty;
                if (maxQty <= 0) {
                    return { status: 400, body: { success: false, error: 'Недостаточно монет', code: 'NOT_ENOUGH_COINS' } };
                }
            }

            const totalStars = (r.stars_cost || 0) * maxQty;
            if (Number(player.stars || 0) < totalStars) {
                maxQty = (r.stars_cost || 0) > 0 ? Math.floor(Number(player.stars || 0) / (r.stars_cost || 1)) : maxQty;
                if (maxQty <= 0) {
                    return { status: 400, body: { success: false, error: 'Недостаточно звёзд', code: 'NOT_ENOUGH_STARS' } };
                }
            }

            if (maxQty <= 0) {
                return { status: 400, body: { success: false, error: 'Недостаточно ресурсов', code: 'NOT_ENOUGH_RESOURCES' } };
            }

            // Делегируем логику крафта
            const resultItem = await client.query('SELECT * FROM items WHERE id = $1', [r.result_item_id]);
            if (!resultItem.rows[0]) {
                return { status: 404, body: { success: false, error: 'Результат крафта не найден', code: 'RESULT_NOT_FOUND' } };
            }
            const dbItem = resultItem.rows[0];
            const { createInventoryItem, addItemToInventory } = require('../../utils/game-helpers');
            const resultItemObj = createInventoryItem(dbItem, { quantity: r.result_quantity * maxQty });

            const inventorySnapshot = JSON.parse(JSON.stringify(inventory));

            // Списываем материалы
            for (const [matName, matQty] of Object.entries(materials)) {
                const needed = matQty * maxQty;
                let remaining = needed;
                for (let i = 0; i < inventory.length && remaining > 0; i++) {
                    const item = inventory[i];
                    if (!item || !materialMatches(item, matName)) continue;
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

            const MAX_SLOTS = 100;
            addItemToInventory(inventory, resultItemObj, dbItem);
            if (inventory.length > MAX_SLOTS) {
                inventory.splice(0, inventory.length, ...inventorySnapshot.map((x) => ({ ...x })));
                return { status: 400, body: { success: false, error: 'Инвентарь переполнен', code: 'INVENTORY_FULL' } };
            }

            const finalCoins = (r.coins_cost || 0) * maxQty;
            const finalStars = (r.stars_cost || 0) * maxQty;
            if (finalCoins > 0) await client.query('UPDATE players SET coins = COALESCE(coins, 0) - $1 WHERE id = $2', [finalCoins, playerId]);
            if (finalStars > 0) await client.query('UPDATE players SET stars = COALESCE(stars, 0) - $1 WHERE id = $2', [finalStars, playerId]);

            await setPlayerInventory(playerId, inventory, client);
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

            const { trackCollectedItems } = require('../../utils/game-helpers');
            if (dbItem.id) await trackCollectedItems(client, playerId, [dbItem.id]);

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        recipe_id: recipeId,
                        result_item: dbItem.name,
                        quantity: r.result_quantity * maxQty,
                        coins_spent: finalCoins,
                        stars_spent: finalStars,
                        message: `Скрафчено ${r.result_quantity * maxQty} × ${dbItem.name}`
                    }
                }
            };
        });

        res.status(outcome.status).json(outcome.body);

        if (outcome.status === 200) {
            try {
                await logPlayerAction(playerId, 'craft_item', { recipe_id: recipeId, quantity: outcome.body.data.quantity });
            } catch (_) { /* ignore */ }
        }
    } catch (error) {
        handleRouteError(res, error, 'crafting_craft_all', req.playerId);
    }
});



// POST /crafting/discover - experimental machine: discover a random recipe
router.post('/discover', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

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

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);

            const recipes = await client.query(
                'SELECT id, name FROM crafting_recipes WHERE enabled = true AND min_level <= $1 ORDER BY RANDOM() LIMIT 1',
                [level]
            );
            if (recipes.rows.length === 0) {
                return { status: 404, body: { success: false, error: 'Нет доступных рецептов', code: 'NO_RECIPES' } };
            }

            const recipe = recipes.rows[0];

            for (const matName of materials) {
                const idx = inventory.findIndex((i) => String(i?.name) === String(matName) && String(i?.type || '').toLowerCase() === 'resource' && Number(i?.quantity) > 0);
                if (idx === -1) {
                    return { status: 400, body: { success: false, error: 'Материал не найден: ' + matName, code: 'MATERIAL_NOT_FOUND' } };
                }
                inventory[idx].quantity = Number(inventory[idx].quantity) - 1;
                if (inventory[idx].quantity <= 0) inventory.splice(idx, 1);
            }

            await client.query(
                'INSERT INTO player_recipes (player_id, recipe_id, unlocked_at, unlock_source) VALUES ($1, $2, NOW(), $3) ON CONFLICT DO NOTHING',
                [playerId, recipe.id, 'discovery']
            );

            await setPlayerInventory(playerId, inventory, client);

            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

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
        handleRouteError(res, error, 'crafting_discover', req.playerId);
    }
});

// POST /crafting/refine - конверсия материалов
router.post('/refine', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

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

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);

            const owned = inventory.filter((i) => String(i?.name) === fromMat && String(i?.type || '').toLowerCase() === 'resource').reduce((s, i) => s + (Number(i.quantity) || 0), 0);
            const needed = ratio * quantity;
            if (owned < needed) {
                return { status: 400, body: { success: false, error: 'Недостаточно ' + fromMat + ': нужно ' + needed + ', есть ' + owned, code: 'NOT_ENOUGH_MATERIALS' } };
            }

            if (coinsCost > 0 && Number(player.coins || 0) < coinsCost) {
                return { status: 400, body: { success: false, error: 'Недостаточно монет', code: 'NOT_ENOUGH_COINS' } };
            }

            const inventorySnapshot = JSON.parse(JSON.stringify(inventory));

            let remaining = needed;
            for (let i = 0; i < inventory.length && remaining > 0; i++) {
                const item = inventory[i];
                if (!item || String(item.name) !== fromMat || String(item.type || '').toLowerCase() !== 'resource') continue;
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
            if (resultQty <= 0) {
                return { status: 400, body: { success: false, error: 'Рафинирование даёт 0 результата при таком количестве/потерях', code: 'ZERO_RESULT' } };
            }
            if (resultQty > 0) {
                const { addItemToInventory } = require('../../utils/game-helpers');
                const MAX_SLOTS = 100;
                addItemToInventory(inventory, { name: toMat, type: 'resource', category: 'material', rarity: 'common', icon: '📦', quantity: resultQty, durability: 100, max_durability: 100 }, null);
                if (inventory.length > MAX_SLOTS) {
                    inventory.splice(0, inventory.length, ...inventorySnapshot.map((x) => ({ ...x })));
                    return { status: 400, body: { success: false, error: 'Инвентарь переполнен', code: 'INVENTORY_FULL' } };
                }
            }

            if (coinsCost > 0) {
                await client.query('UPDATE players SET coins = COALESCE(coins, 0) - $1 WHERE id = $2', [coinsCost, playerId]);
            }
            await setPlayerInventory(playerId, inventory, client);

                // Синхронизация инвонтаря в таблицу player_inventory.
                try {
                    const { syncInventoryToTable } = require('../../utils/game-helpers');
                    if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
                } catch (_) { /* ignore */ }

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
        handleRouteError(res, error, 'crafting_refine', req.playerId);
    }
});

module.exports = router;

