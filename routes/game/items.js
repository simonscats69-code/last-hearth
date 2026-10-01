/**
 * Маршруты для работы с инвентарём и предметами
 * GET /api/game/items — список предметов в магазине
 * GET /api/game/inventory — инвентарь игрока
 * POST /api/game/items/buy — покупка предмета
 */

const express = require('express');
const router = express.Router();
const { queryOne, queryAll, transaction: tx } = require('../../db/database');
const { safeJsonParse, handleError, logPlayerAction } = require('../../utils/serverApi');
const { normalizeInventory, createInventoryItem, normalizeRadiation, normalizeInfections, calculateSellPrice, addItemToInventory } = require('../../utils/game-helpers');

/**
 * Лимит слотов инвентаря. Должен совпадать с MAX_INVENTORY_SLOTS
 * в routes/game/world.js (там та же проверка при добыче) и с
 * INVENTORY_MAX_SLOTS в public/game.js.
 */
const MAX_INVENTORY_SLOTS = 100;

/**
 * Получить список предметов в магазине
 * GET /items/shop (основной), GET /items (обратная совместимость)
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
 * Получить инвентарь игрока
 * GET /api/game/inventory (через алиас /inventory), GET /inventory (обратная совместимость)
 */
router.get(['/', '/inventory'], async (req, res) => {
    try {
        const playerId = req.player.id;

        const player = await queryOne(
            'SELECT inventory, equipment FROM players WHERE id = $1',
            [playerId]
        );

        if (!player) {
            return res.status(404).json({ success: false, error: 'Игрок не найден' });
        }

        const inventory = normalizeInventory(player.inventory);
        const equipment = safeJsonParse(player.equipment, {});

        // Цены продажи считаем по таблице items, а не берём из JSON инвентаря.
        // Одним запросом на все id, чтобы не делать N+1.
        const ids = [...new Set(inventory.map(i => i.id).filter(id => id != null))];
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
 * Купить предмет за монеты
 * POST /items/buy
 */
router.post('/buy', async (req, res) => {
    try {
        const playerId = req.player.id;
        const itemId = Number(req.body?.item_id);
        const quantity = Math.max(1, Math.min(99, Number(req.body?.quantity || 1)));

        if (!itemId || itemId <= 0) {
            return res.status(400).json({ success: false, error: 'Укажите ID предмета', code: 'INVALID_ITEM_ID' });
        }

        const result = await tx(async (client) => {
            const item = await client.query(
                'SELECT * FROM items WHERE id = $1 AND price > 0',
                [itemId]
            );

            if (!item.rows[0]) {
                throw { message: 'Предмет не найден или не продаётся', code: 'ITEM_NOT_FOUND', statusCode: 404 };
            }

            const shopItem = item.rows[0];
            const totalPrice = shopItem.price * quantity;

            const playerResult = await client.query(
                'SELECT coins, inventory FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );

            if (!playerResult.rows[0]) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const player = playerResult.rows[0];

            if (player.coins < totalPrice) {
                throw {
                    message: `Недостаточно монет. Требуется: ${totalPrice}, у вас: ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const inventory = normalizeInventory(player.inventory);

            const newItem = createInventoryItem(shopItem, { quantity });
            const addedAsNewSlots = addItemToInventory(inventory, newItem, shopItem);

            // Лимит слотов. Проверяем ПОСЛЕ стакования: если предмет влез
            // в существующий стек, новый слот не создаётся и лимит не трогаем.
            if (addedAsNewSlots > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                throw {
                    message: `Инвентарь переполнен (макс. ${MAX_INVENTORY_SLOTS} слотов).`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            await client.query(
                'UPDATE players SET coins = coins - $1, inventory = $2 WHERE id = $3',
                [totalPrice, JSON.stringify(inventory), playerId]
            );

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
                    icon: shopItem.icon || '📦',
                    quantity
                },
                coins_spent: totalPrice,
                coins_remaining: player.coins - totalPrice
            };
        });

        res.json(result);
    } catch (error) {
        if (error.code === 'INSUFFICIENT_COINS') {
            return res.status(400).json({ success: false, error: error.message, code: 'INSUFFICIENT_COINS' });
        }
        handleError(res, error, 'item_buy');
    }
});

/**
 * POST /items/use — использовать/экипировать предмет
 */
router.post(['/use', '/use-item'], async (req, res) => {
    try {
        const playerId = req.player.id;
        const itemIndex = Number(req.body?.item_index);
        const equip = Boolean(req.body?.equip);

        if (isNaN(itemIndex) || itemIndex < 0) {
            return res.status(400).json({ success: false, error: 'Укажите корректный индекс предмета', code: 'INVALID_INDEX' });
        }

        const result = await tx(async (client) => {
            const player = await client.query(
                'SELECT inventory, equipment, health, max_health, radiation, infections FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );

            if (!player.rows[0]) throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };

            const inventory = normalizeInventory(player.rows[0].inventory);

            if (itemIndex >= inventory.length) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            if (equip) {
                const equipment = safeJsonParse(player.rows[0].equipment, {});
                const slot = item.slot || item.type || 'accessory';

                const oldItem = equipment[slot] || null;
                equipment[slot] = item;

                inventory.splice(itemIndex, 1);
                if (oldItem) inventory.push(oldItem);

                await client.query(
                    'UPDATE players SET equipment = $1, inventory = $2 WHERE id = $3',
                    [JSON.stringify(equipment), JSON.stringify(inventory), playerId]
                );

                await logPlayerAction(playerId, 'item_equip', { slot, item_id: item.id }, client);

                return { success: true, message: 'Предмет экипирован', item: { id: item.id, name: item.name } };
            }

            // Расходный предмет
            const stats = item.stats || {};
            const updates = [];
            const params = [playerId];
            const playerRadiation = normalizeRadiation(player.rows[0].radiation);
            const playerInfections = normalizeInfections(player.rows[0].infections);

            if (stats.healing || stats.health) {
                const healAmount = Number(stats.healing || stats.health || 0);
                const curHealth = Number(player.rows[0].health || 0);
                const maxHealth = Number(player.rows[0].max_health || 100);
                const newHealth = Math.min(maxHealth, curHealth + healAmount);
                updates.push(`health = $${params.length + 1}`);
                params.push(newHealth);
            }

            // Еда/вода восстанавливают энергию (стартовый инвентарь содержит stats.energy)
            if (stats.energy) {
                const energyAmount = Number(stats.energy);
                if (energyAmount > 0) {
                    updates.push(`energy = LEAST(max_energy, energy + $${params.length + 1})`);
                    params.push(energyAmount);
                }
            }

            if (stats.radiation_cure) {
                const cureAmount = Number(stats.radiation_cure);
                const curRad = playerRadiation.level;
                const newRad = Math.max(0, curRad - cureAmount);
                // radiation — JSONB-колонка ({ level, expires_at, applied_at }).
                // Раньше сюда писалось голое число → Postgres отвечал
                // "column radiation is of type jsonb but expression is of type
                // integer" и любое использование антирада падало с 500.
                const radPayload = JSON.stringify({
                    level: newRad,
                    expires_at: newRad > 0 ? playerRadiation.expires_at : null,
                    applied_at: newRad > 0 ? playerRadiation.applied_at : null
                });
                updates.push(`radiation = $${params.length + 1}::jsonb`);
                params.push(radPayload);
            }

            if (stats.infection_cure) {
                // infections — JSONB-массив объектов {type, level, expires_at};
                // снижаем уровень каждой инфекции, полностью вылеченные удаляем
                const cureAmount = Number(stats.infection_cure);
                const remaining = [];
                for (const inf of playerInfections) {
                    const newLevel = Math.max(0, Number(inf?.level || 0) - cureAmount);
                    if (newLevel > 0) {
                        remaining.push({ ...inf, level: newLevel });
                    }
                }
                updates.push(`infections = $${params.length + 1}`);
                params.push(JSON.stringify(remaining));
            }

            if (updates.length > 0) {
                // Расходник может лежать стопкой (quantity > 1). Раньше здесь стоял
                // inventory.splice(itemIndex, 1) — эффект применялся один раз,
                // а удалялся ВЕСЬ стек: купил 10 яблок, использовал одно — потерял 9.
                const currentQty = Number(item.quantity || 1);
                const remainingQty = currentQty - 1;

                if (remainingQty > 0) {
                    inventory[itemIndex] = { ...item, quantity: remainingQty };
                } else {
                    inventory.splice(itemIndex, 1);
                }

                await client.query(
                    `UPDATE players SET ${updates.join(', ')}, inventory = $${params.length + 1} WHERE id = $1`,
                    [...params, JSON.stringify(inventory)]
                );

                await logPlayerAction(playerId, 'item_use', { item_id: item.id, item_name: item.name }, client);

                return {
                    success: true,
                    message: 'Предмет использован',
                    item: { id: item.id, name: item.name },
                    quantity_left: remainingQty
                };
            }

            return { success: false, message: 'Этот предмет нельзя использовать' };
        });

        res.json(result);
    } catch (error) {
        if (error.code === 'ITEM_NOT_IN_INVENTORY' || error.code === 'PLAYER_NOT_FOUND') {
            // statusCode может отсутствовать — res.status(undefined) дал бы
            // невалидный HTTP-код. Фоллбэк 404 соответствует смыслу ошибки.
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
 * POST /items/sell — продать предмет за монеты
 *
 * Закрывает петлю экономики: раньше предметы можно было только тратить,
 * а при заполнении 100 слотов игра предлагала «продать лишнее» —
 * функции продажи не существовало.
 */
router.post('/sell', async (req, res) => {
    try {
        const playerId = req.player.id;
        const itemIndex = Number(req.body?.item_index);

        if (!Number.isInteger(itemIndex) || itemIndex < 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректный индекс предмета',
                code: 'INVALID_INDEX'
            });
        }

        const result = await tx(async (client) => {
            const playerResult = await client.query(
                'SELECT inventory, coins FROM players WHERE id = $1 FOR UPDATE',
                [playerId]
            );

            if (!playerResult.rows[0]) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const inventory = normalizeInventory(playerResult.rows[0].inventory);

            if (itemIndex >= inventory.length) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            // Цену берём из таблицы items, а не из JSON инвентаря —
            // иначе цену можно было бы подделать на клиенте.
            const dbItemResult = await client.query(
                'SELECT id, name, type, rarity, price, stackable FROM items WHERE id = $1',
                [item.id]
            );
            const dbItem = dbItemResult.rows[0] || null;

            const unitPrice = calculateSellPrice(dbItem, item);
            if (unitPrice <= 0) {
                throw {
                    message: 'Этот предмет нельзя продать',
                    code: 'ITEM_NOT_SELLABLE',
                    statusCode: 400
                };
            }

            // За одну операцию продаём весь стек — это осознанно:
            // слот занимает место, а монеты компактнее.
            const soldQuantity = Math.max(1, Number(item.quantity || 1));
            const earned = unitPrice * soldQuantity;

            inventory.splice(itemIndex, 1);

            const newCoins = Number(playerResult.rows[0].coins || 0) + earned;

            await client.query(
                'UPDATE players SET coins = $1, inventory = $2 WHERE id = $3',
                [newCoins, JSON.stringify(inventory), playerId]
            );

            await logPlayerAction(playerId, 'item_sell', {
                item_id: item.id,
                item_name: item.name,
                quantity: soldQuantity,
                price_earned: earned
            }, client);

            return {
                success: true,
                message: `Продано: ${item.name} ×${soldQuantity}`,
                item: { id: item.id, name: item.name, icon: item.icon || '📦', rarity: item.rarity },
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

module.exports = router;
