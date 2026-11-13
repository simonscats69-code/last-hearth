/**
 * Блокировка строк для обновления инвентаря и предметов.
 * GET /api/game/items — список предметов в магазине.
 * GET /api/game/inventory — инвентарь игрока.
 * POST /api/game/items/buy — покупка предмета.
 */

const express = require('express');
const router = express.Router();
const { queryOne, queryAll, transaction } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { safeJsonParse, handleError, logPlayerAction, notFound, fail, requireItemId } = require('../../utils/serverApi');
const { playerIdGuard } = require('../../utils/routeHelpers');
const { parseEquipment } = require('../../utils/normalizePlayerJson');
const { setPlayerInventory } = require('../../db/playerRepository');
// validateQuantity: валидация количества для /buy и /buy-stars.
// validateItemIndex: валидация индекса предмета в инвентаре.
const { validateQuantity, validateItemIndex } = require('../../utils/validate');

// Загрузка игровых хелперов из utils/game-helpers.js.
// Работа с БД — через db/database, исключаем циклы зависимостей.
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../../utils/game-helpers');
    }
    return gameHelpers;
}

// Экземпляр хелперов (создаётся один раз при загрузке модуля).
const helpers = getGameHelpers();
const { normalizeInventory, normalizeEquipment, createInventoryItem, normalizeRadiation, calculateSellPrice, addItemToInventory, equipmentRules, getSetBonuses, trackCollectedItems, consumeInventoryItem } = helpers;

/**
 * Максимальное количество слотов инвентаря.
 * Берется из public/shared/equipment.js (единственный источник истины).
 */
const MAX_INVENTORY_SLOTS = require('../../public/shared/equipment.js').MAX_INVENTORY_SLOTS;

/**
 * GET /items/shop — список предметов в магазине.
 * GET /items — полный каталог предметов.
 */
router.get(['/shop', '/items'], async (req, res) => {
    try {
        const items = await queryAll(`
            SELECT id, name, description, type, category, rarity,
                   price, stars_price, icon, slot, stats, stackable
            FROM items
            WHERE price > 0 OR stars_price > 0
            ORDER BY rarity, type, name
        `);

        res.json({
            success: true,
            items: items.map(item => ({
                ...item,
                stats: safeJsonParse(item.stats, {})
            }))
        });
    } catch (error) {
        handleError(res, error, 'items_list');
    }
});

/**
 * GET /inventory — инвентарь игрока.
 * GET /api/game/inventory (через /inventory), GET /inventory (через /inventory).
 */
router.get(['/', '/inventory'], async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

        const player = await queryOne(
            'SELECT inventory, equipment FROM players WHERE id = $1',
            [playerId]
        );

        if (!player) {
            return notFound(res, 'Игрок не найден', 'PLAYER_NOT_FOUND');
        }

        const inventory = normalizeInventory(player.inventory);
        const equipment = normalizeEquipment(player.equipment);

        // Собираем уникальные ID предметов для обогащения каталогом (цена, тип, редкость).
        const ids = [...new Set(inventory.map(i => Number(i.id)).filter(id => Number.isInteger(id) && id > 0))];
        const catalog = new Map();
        if (ids.length > 0) {
            const rows = await queryAll(
                'SELECT id, type, rarity, price FROM items WHERE id = ANY($1::int[])',
                [ids]
            );
            for (const row of rows) catalog.set(row.id, row);
        }

        const items = inventory.map(item => ({
            ...item,
            sell_price: calculateSellPrice(catalog.get(item.id) || null, item)
        }));

        res.json({
            success: true,
            inventory: items,
            equipment
        });
    } catch (error) {
        handleError(res, error, 'inventory_view');
    }
});

/**
 * POST /items/buy — покупка предмета за монеты.
 */
router.post('/buy', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

        // Валидация quantity (минимум 1, максимум 99, защита от NaN).
        const qtyCheck = validateQuantity(req.body?.quantity);
        if (!qtyCheck.ok) {
            return res.status(400).json({ success: false, error: qtyCheck.error, code: qtyCheck.code });
        }
        const quantity = qtyCheck.value;

        const itemId = Number(req.body?.item_id);
        if (!requireItemId(res, itemId)) return;

        const result = await transaction(async (client) => {
            const item = await client.query(
                'SELECT * FROM items WHERE id = $1 AND price > 0',
                [itemId]
            );

            if (!item.rows[0]) {
                throw { message: 'Предмет не найден или не продается', code: 'ITEM_NOT_FOUND', statusCode: 404 };
            }

            const shopItem = item.rows[0];
            const totalPrice = shopItem.price * quantity;

            const player = await lockPlayer(playerId, client, 'coins, inventory');
            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            if (Number(player.coins || 0) < totalPrice) {
                throw {
                    message: `Недостаточно монет. Требуется: ${totalPrice}, есть: ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);

            const newItem = createInventoryItem(shopItem, { quantity });
            const addedAsNewSlots = addItemToInventory(inventory, newItem, shopItem);

            // Проверка лимита слотов инвентаря.
            if (addedAsNewSlots > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                throw {
                    message: `Лимит слотов инвентаря (макс. ${MAX_INVENTORY_SLOTS} предметов).`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            await client.query(
                'UPDATE players SET coins = COALESCE(coins,0) - $1, inventory = $2, items_collected = COALESCE(items_collected, 0) + $4 WHERE id = $3',
                [totalPrice, JSON.stringify(inventory), playerId, quantity]
            );

            // Синхронизация инвентаря в таблицу player_inventory.
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

            // Отслеживание собранных предметов (колекшен-трэкер).
            await trackCollectedItems(client, playerId, [shopItem.id]);

            await logPlayerAction(playerId, 'item_bought', {
                item_id: itemId,
                item_name: shopItem.name,
                quantity,
                price: totalPrice
            }, client);

            return {
                success: true,
                item: {
                    id: shopItem.id,
                    name: shopItem.name,
                    icon: shopItem.icon || '=ж',
                    quantity
                },
                coins_spent: totalPrice,
                coins_remaining: Number(player.coins || 0) - totalPrice
            };
        });

        res.json(result);
    } catch (error) {
        if (['INSUFFICIENT_COINS', 'ITEM_NOT_FOUND', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_buy');
    }
});

/**
 * POST /items/use и /items/use-item — использование/экипировка предмета.
 */
router.post(['/use', '/use-item'], async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;
        const itemIndex = Number(req.body?.item_index);
        const equip = Boolean(req.body?.equip);

        const itemIndexCheck = validateItemIndex(itemIndex);
        if (!itemIndexCheck.ok) {
            return fail(res, itemIndexCheck.error, itemIndexCheck.code);
        }

        const result = await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'inventory, equipment, health, max_health, radiation');

            if (!playerRow) throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(playerRow.inventory);

            if (itemIndex >= inventory.length) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            if (!item || typeof item !== 'object') {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            if (equip) {
                // Определение слота экипировки по типу предмета (food — не экипируется).
                const slot = equipmentRules.resolveEquipmentSlot(item);
                if (!slot) {
                    throw {
                        message: `«${item.name || 'Предмет'}» нельзя экипировать в этот слот`,
                        code: 'NOT_EQUIPMENT',
                        statusCode: 400
                    };
                }

                const equipment = normalizeEquipment(playerRow.equipment);
                const oldItem = equipment[slot] || null;

                // Снятие старого предмета: он возвращается в инвентарь.
                inventory.splice(itemIndex, 1);
                equipment[slot] = item;
                if (oldItem) {
                    if (inventory.length >= MAX_INVENTORY_SLOTS) {
                        throw { message: `Лимит слотов инвентаря (макс. ${MAX_INVENTORY_SLOTS} предметов).`, code: 'INVENTORY_FULL', statusCode: 400 };
                    }
                    inventory.push(oldItem);
                }

                await client.query(
                    'UPDATE players SET equipment = $1, inventory = $2 WHERE id = $3',
                    [JSON.stringify(equipment), JSON.stringify(inventory), playerId]
                );

                try {
                    const { syncInventoryToTable } = require('../../utils/game-helpers');
                    if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
                } catch (_) { /* ignore */ }

                return {
                    success: true,
                    message: 'Предмет использован',
                    item: { id: item.id, name: item.name },
                    log: { action: 'item_equip', playerId, data: { slot, item_id: item.id } }
                };
            }

            // Использование расходника (лечение, энергия, излечение радиации).
            const stats = item.stats || {};
            const updates = [];
            const params = [playerId];
            const playerRadiation = normalizeRadiation(playerRow.radiation);
            const setBonuses = await getSetBonuses(parseEquipment(playerRow.equipment), client);

            if (stats.healing || stats.health) {
                const baseHeal = Number(stats.healing || stats.health || 0);
                const healPercent = Number(stats.heal_bonus || 0) + Number(setBonuses.heal_bonus || 0);
                const healAmount = Math.max(1, Math.round(baseHeal * (1 + healPercent / 100)));
                const curHealth = Number(playerRow.health || 0);
                const maxHealth = Number(playerRow.max_health || 100);
                const newHealth = Math.min(maxHealth, curHealth + healAmount);
                updates.push(`health = $${params.length + 1}`);
                params.push(newHealth);
            }

            if (stats.energy) {
                const energyAmount = Number(stats.energy) + Number(setBonuses.energy_bonus || 0);
                if (energyAmount > 0) {
                    updates.push(`energy = LEAST(COALESCE(max_energy,0), COALESCE(energy,0) + $${params.length + 1})`);
                    params.push(energyAmount);
                }
            }

            if (stats.radiation_cure || stats.infection_cure) {
                // Излечение радиации/инфекции: уменьшение уровня.
                const cureAmount = Number(stats.radiation_cure || stats.infection_cure || 0);
                const curRad = playerRadiation.level;
                const newRad = Math.max(0, curRad - cureAmount);
                const radPayload = JSON.stringify({
                    level: newRad,
                    expires_at: newRad > 0 ? playerRadiation.expires_at : null,
                    applied_at: newRad > 0 ? playerRadiation.applied_at : null
                });
                updates.push(`radiation = $${params.length + 1}::jsonb`);
                params.push(radPayload);
            }

            if (updates.length > 0) {
                const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, itemIndex);

                await client.query(
                    `UPDATE players SET ${updates.join(', ')}, inventory = $${params.length + 1} WHERE id = $1`,
                    [...params, JSON.stringify(updatedInventory)]
                );

                // Синхронизация инвентаря в таблицу player_inventory.
                try {
                    const { syncInventoryToTable } = require('../../utils/game-helpers');
                    if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, updatedInventory);
                } catch (_) { /* ignore */ }

                return {
                    success: true,
                    message: 'Предмет использован',
                    item: { id: item.id, name: item.name },
                    quantity_left: quantityLeft,
                    log: { action: 'item_use', playerId, data: { item_id: item.id, item_name: item.name } }
                };
            }

            // Расходники без статов (консервы и т.п.) всё равно расходуются.
            if (item.type === 'food' || item.type === 'consumable') {
                const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, itemIndex);
                await client.query(
                    'UPDATE players SET inventory = $1 WHERE id = $2',
                    [JSON.stringify(updatedInventory), playerId]
                );
                try {
                    const { syncInventoryToTable } = require('../../utils/game-helpers');
                    if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, updatedInventory);
                } catch (_) { /* ignore */ }
                return {
                    success: true,
                    message: 'Предмет использован',
                    item: { id: item.id, name: item.name },
                    quantity_left: quantityLeft,
                    log: { action: 'item_use', playerId, data: { item_id: item.id, item_name: item.name } }
                };
            }

            return { success: false, message: 'Этот предмет нельзя использовать' };
        });

        if (result.log) {
            await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
        }

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'NOT_EQUIPMENT', 'INVENTORY_FULL'].includes(error.code)) {
            const status = Number(error.statusCode) || 404;
            return res.status(status).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_use');
    }
});

/**
     * POST /items/sell — продажа предмета за монеты.
     * Цена = 35% от цены магазина (SELL_RATE), минимум — по редкости
     * (SELL_FLOOR_BY_RARITY). Предметы без цены продаются по фоллбэку редкости.
     */
router.post('/sell', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;
        const itemIndex = Number(req.body?.item_index);

        const itemIndexCheck = validateItemIndex(itemIndex);
        if (!itemIndexCheck.ok) {
            return fail(res, itemIndexCheck.error, itemIndexCheck.code);
        }

        const result = await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'inventory, coins');

            if (!playerRow) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(playerRow.inventory);

            if (itemIndex >= inventory.length) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            if (!item || typeof item !== 'object') {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const dbItemResult = await client.query(
                'SELECT id, name, type, rarity, price, stackable FROM items WHERE id = $1',
                [item.id]
            );
            let dbItem = dbItemResult.rows[0] || null;

            // Фоллбэк: если id не найден в каталоге (устевший/phantom id),
            // пытаемся резолвить по имени. Иначе продаваемый предмет
            // пропадал из экономики из-за отсутствия строки в items.
            if (!dbItem && item.name) {
                const byName = await client.query(
                    'SELECT id, name, type, rarity, price, stackable FROM items WHERE name = $1 LIMIT 1',
                    [item.name]
                );
                dbItem = byName.rows[0] || null;
            }

            const unitPrice = calculateSellPrice(dbItem, item);
            if (unitPrice <= 0) {
                throw {
                    message: 'Предмет не подлежит продаже',
                    code: 'ITEM_NOT_SELLABLE',
                    statusCode: 400
                };
            }

            const stackQuantity = Math.max(1, Number(item.quantity || 1));
            const requestedQuantity = Number(req.body?.quantity);
            const soldQuantity = (Number.isInteger(requestedQuantity) && requestedQuantity > 0)
                ? Math.min(stackQuantity, requestedQuantity)
                : stackQuantity;
            const earned = unitPrice * soldQuantity;

            if (soldQuantity >= stackQuantity) {
                inventory.splice(itemIndex, 1);
            } else {
                inventory[itemIndex] = { ...item, quantity: stackQuantity - soldQuantity };
            }

            const newCoins = Number(playerRow.coins || 0) + earned;

            await client.query(
                'UPDATE players SET coins = $1, inventory = $2 WHERE id = $3',
                [newCoins, JSON.stringify(inventory), playerId]
            );

            // Синхронизация инвентаря в таблицу player_inventory:
            // без этого следующий запрос, читающий таблицу, увидит старые данные.
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

            await logPlayerAction(playerId, 'item_sell', {
                item_id: item.id,
                item_name: item.name,
                quantity: soldQuantity,
                price_earned: earned
            }, client);

            return {
                success: true,
                message: `Продано: ${item.name} Ч${soldQuantity}`,
                item: { id: item.id, name: item.name, icon: item.icon || '=ж', rarity: item.rarity },
                quantity_sold: soldQuantity,
                unit_price: unitPrice,
                coins_earned: earned,
                coins_total: newCoins
            };
        });

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'ITEM_NOT_SELLABLE'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_sell');
    }
});

/**
 * POST /items/drop — выброс предмета (разбор на материалы).
 * Выброс предмета дает материалы (например, лом), с шансом 35%.
 */
router.post('/drop', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;
        const itemIndex = Number(req.body?.item_index);

        const itemIndexCheck = validateItemIndex(itemIndex);
        if (!itemIndexCheck.ok) {
            return fail(res, itemIndexCheck.error, itemIndexCheck.code);
        }

        const result = await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'inventory');

            if (!playerRow) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(playerRow.inventory);
            if (itemIndex >= inventory.length) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            if (!item || typeof item !== 'object') {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const stackQuantity = Math.max(1, Number(item.quantity || 1));
            const requested = Number(req.body?.quantity);
            const dropQuantity = (Number.isInteger(requested) && requested > 0)
                ? Math.min(stackQuantity, requested)
                : stackQuantity;

            // Разбор предмета на материалы.
            const scrapYield = equipmentRules.calculateScrapYield(item, dropQuantity);
            const materialNames = Object.keys(scrapYield);
            let materials = [];
            if (materialNames.length > 0) {
                const materialResult = await client.query(
                    'SELECT id, name, type, category, rarity, icon, stats, stackable, max_stack FROM items WHERE name = ANY($1::text[])',
                    [materialNames]
                );
                materials = materialResult.rows;
                if (materials.length === 0 || materials.length < materialNames.length) {
                    throw {
                        message: 'Материал для разбора не найден',
                        code: 'MATERIAL_MISSING',
                        statusCode: 400
                    };
                }
            }

            // Проверка мест в инвентаре для новых материалов.
            if (materials.length > 0) {
                const projected = inventory.slice();
                for (const material of materials) {
                    const quantity = Number(scrapYield[material.name] || 0);
                    if (quantity <= 0) continue;
                    addItemToInventory(
                        projected,
                        createInventoryItem({ ...material, stats: safeJsonParse(material.stats, {}) }, { quantity }),
                        material
                    );
                }

                const slotsNeeded = Math.max(0, projected.length - inventory.length);
                const freesSlot = dropQuantity >= stackQuantity;
                const freeSlots = MAX_INVENTORY_SLOTS - inventory.length + (freesSlot ? 1 : 0);
                if (slotsNeeded > freeSlots) {
                    throw {
                        message: `Не хватает мест: нужно ${slotsNeeded}, свободно ${freeSlots}. Выбросьте что-нибудь или купите слоты.`,
                        code: 'INVENTORY_FULL',
                        statusCode: 400
                    };
                }
            }

            if (dropQuantity >= stackQuantity) {
                inventory.splice(itemIndex, 1);
            } else {
                inventory[itemIndex] = { ...item, quantity: stackQuantity - dropQuantity };
            }

            const granted = [];
            for (const material of materials) {
                const quantity = Number(scrapYield[material.name] || 0);
                if (quantity <= 0) continue;

                addItemToInventory(
                    inventory,
                    createInventoryItem({ ...material, stats: safeJsonParse(material.stats, {}) }, { quantity }),
                    material
                );
                granted.push({ id: material.id, name: material.name, quantity, icon: material.icon || '=ж' });
            }

            await setPlayerInventory(playerId, inventory, client, { jsonb: true });

            // Синхронизация инвентаря в таблицу player_inventory.
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

            await logPlayerAction(playerId, 'item_drop', {
                item_id: item.id,
                item_name: item.name,
                quantity: dropQuantity,
                materials: granted
            }, client);

            return {
                success: true,
                message: `Выброшено: ${item.name}`,
                item: { id: item.id, name: item.name, icon: item.icon || '=ж' },
                quantity_dropped: dropQuantity,
                materials: granted
            };
        });

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL', 'MATERIAL_MISSING'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_drop');
    }
});

/**
 * POST /items/unequip — снятие предмета с экипировки.
 * body: { slot }
 */
router.post('/unequip', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;
        const slot = String(req.body?.slot || '');

        const result = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'equipment, inventory');

            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: 'Слот пуст', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);
            if (inventory.length >= MAX_INVENTORY_SLOTS) {
                throw {
                    message: `Лимит слотов инвентаря (макс. ${MAX_INVENTORY_SLOTS}).`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            inventory.push(item);
            delete equipment[slot];

            await client.query(
                'UPDATE players SET equipment = $1::jsonb, inventory = $2 WHERE id = $3',
                [JSON.stringify(equipment), JSON.stringify(inventory), playerId]
            );

            // Синхронизация инвентаря в таблицу player_inventory.
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

            await logPlayerAction(playerId, 'item_unequip', {
                slot,
                item_id: item.id ?? null,
                item_name: item.name || null
            }, client);

            return {
                success: true,
                message: `${item.name || 'Предмет'} снят`,
                slot,
                item: { id: item.id ?? null, name: item.name || 'Предмет', icon: item.icon || '=ж' },
                inventory_slots: inventory.length
            };
        });

        res.json(result);
    } catch (error) {
        if (['SLOT_EMPTY', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_unequip');
    }
});

/**
 * POST /items/buy-stars — покупка предмета за звёзды.
 * Звёзды зарабатываются за достижения и daily-bonus.
 */
router.post('/buy-stars', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

        const qtyCheck = validateQuantity(req.body?.quantity);
        if (!qtyCheck.ok) {
            return res.status(400).json({ success: false, error: qtyCheck.error, code: qtyCheck.code });
        }
        const quantity = qtyCheck.value;

        const itemId = Number(req.body?.item_id);
        if (!requireItemId(res, itemId)) return;

        const result = await transaction(async (client) => {
            const shopItem = await client.query(
                'SELECT * FROM items WHERE id = $1 AND stars_price > 0',
                [itemId]
            );
            if (!shopItem.rows[0]) {
                throw { message: 'Предмет не найден или не продается за звёзды', code: 'ITEM_NOT_FOUND', statusCode: 404 };
            }

            const shopItemRow = shopItem.rows[0];
            const totalStars = Number(shopItemRow.stars_price) * quantity;

            const player = await lockPlayer(playerId, client, 'stars, inventory');

            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            if (Number(player.stars || 0) < totalStars) {
                throw {
                    message: `Недостаточно звёзд. Требуется: ${totalStars}, есть: ${player.stars}`,
                    code: 'INSUFFICIENT_STARS',
                    statusCode: 400
                };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);
            const newItem = createInventoryItem(shopItemRow, { quantity });
            const addedAsNewSlots = addItemToInventory(inventory, newItem, shopItemRow);

            if (addedAsNewSlots > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                throw {
                    message: `Лимит слотов инвентаря (макс. ${MAX_INVENTORY_SLOTS} предметов).`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            await client.query(
                'UPDATE players SET stars = GREATEST(0, COALESCE(stars,0) - $1), inventory = $2, items_collected = COALESCE(items_collected, 0) + $4 WHERE id = $3',
                [totalStars, JSON.stringify(inventory), playerId, quantity]
            );

            // Синхронизация инвентаря в таблицу player_inventory.
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

            await trackCollectedItems(client, playerId, [shopItemRow.id]);
            await logPlayerAction(playerId, 'item_bought_stars', {
                item_id: itemId,
                item_name: shopItemRow.name,
                quantity,
                stars_spent: totalStars
            }, client);

            return {
                success: true,
                message: `Куплено за звёзды: ${shopItemRow.name} Ч${quantity}`,
                item: { id: shopItemRow.id, name: shopItemRow.name, icon: shopItemRow.icon || '=ж', quantity },
                stars_spent: totalStars,
                stars_total: Number(player.stars || 0) - totalStars
            };
        });

        res.json(result);
    } catch (error) {
        if (['INSUFFICIENT_STARS', 'ITEM_NOT_FOUND', 'INVENTORY_FULL', 'PLAYER_NOT_FOUND'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_buy_stars');
    }
});

module.exports = router;
