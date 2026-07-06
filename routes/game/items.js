/**
 * Маршруты для работы с инвентарём и предметами
 * GET /api/game/items — список предметов в магазине
 * GET /api/game/inventory — инвентарь игрока
 * POST /api/game/items/buy — покупка предмета
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll, transaction: tx } = require('../../db/database');
const { logger, safeJsonParse, handleError, logPlayerAction } = require('../../utils/serverApi');
const { normalizeInventory, createInventoryItem, normalizeRadiation, normalizeInfections } = require('../../utils/game-helpers');

/**
 * Получить список предметов в магазине
 * GET /items
 */
router.get('/', async (req, res) => {
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
 * GET /inventory (алиас)
 */
router.get('/inventory', async (req, res) => {
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

        res.json({
            success: true,
            inventory,
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
            inventory.push(newItem);

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
router.post('/use', async (req, res) => {
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

            if (stats.radiation_cure) {
                const cureAmount = Number(stats.radiation_cure);
                const curRad = playerRadiation.level;
                const newRad = Math.max(0, curRad - cureAmount);
                updates.push(`radiation = $${params.length + 1}`);
                params.push(newRad);
            }

            if (stats.infection_cure) {
                const cureAmount = Number(stats.infection_cure);
                const curInf = playerInfections.reduce((sum, inf) => sum + (inf.level || 0), 0);
                const newInf = Math.max(0, curInf - cureAmount);
                updates.push(`infections = $${params.length + 1}`);
                params.push(newInf);
            }

            if (updates.length > 0) {
                inventory.splice(itemIndex, 1);
                await client.query(
                    `UPDATE players SET ${updates.join(', ')}, inventory = $${params.length + 1} WHERE id = $1`,
                    [...params, JSON.stringify(inventory)]
                );
            } else {
                return { success: false, message: 'Этот предмет нельзя использовать' };
            }

            await logPlayerAction(playerId, 'item_use', { item_id: item.id, item_name: item.name }, client);

            return { success: true, message: 'Предмет использован', item: { id: item.id, name: item.name } };
        });

        res.json(result);
    } catch (error) {
        if (error.code === 'ITEM_NOT_IN_INVENTORY' || error.code === 'PLAYER_NOT_FOUND') {
            return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
        }
        handleError(res, error, 'item_use');
    }
});

module.exports = router;
