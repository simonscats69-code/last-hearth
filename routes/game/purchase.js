/**
 * Покупки в магазине (за монеты и Stars)
 * @module game/purchase
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne } = require('../../db/database');
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
 * Валидация ID предмета
 * @param {any} value 
 * @returns {boolean}
 */
function isValidItemId(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Валидация валюты
 * @param {any} value 
 * @returns {boolean}
 */
function isValidCurrency(value) {
    return value === 'coins' || value === 'stars';
}

/**
 * Покупка предмета
 */
router.post('/purchase', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Начинаем транзакцию
        
        const { item_id, currency = 'coins' } = req.body;
        const player = req.player;
        
        // Валидация входных данных
        if (!isValidItemId(item_id)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректный ID предмета', 'INVALID_ITEM_ID');
        }
        
        if (!isValidCurrency(currency)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректную валюту (coins или stars)', 'INVALID_CURRENCY');
        }
        
        // Получаем товар из магазина с блокировкой
        const itemResult = await client.query(`
            SELECT * FROM shop_items WHERE id = $1
        `, [item_id]);
        
        if (itemResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Предмет не найден', 'ITEM_NOT_FOUND', 404);
        }
        
        const item = itemResult.rows[0];
        
        // Проверяем валюту и цену
        let price = item.price_coins;
        let actualCurrency = 'coins';
        
        if (currency === 'stars') {
            price = item.price_stars;
            actualCurrency = 'stars';
        }
        
        if (currency === 'coins' && !item.price_coins) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Этот предмет нельзя купить за монеты', 'INVALID_CURRENCY');
        }
        
        if (currency === 'stars' && !item.price_stars) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Этот предмет нельзя купить за Stars', 'INVALID_CURRENCY');
        }
        
        // Блокируем игрока для проверки баланса
        const playerResult = await client.query(`
            SELECT id, coins, stars, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [player.id]);
        
        const playerData = playerResult.rows[0];
        
        // Проверяем баланс
        if (actualCurrency === 'coins') {
            const coins = parseInt(playerData.coins) || 0;
            if (coins < price) {
                await client.query('ROLLBACK');
                return errorResponse(res, 'Недостаточно монет', 'INSUFFICIENT_COINS', 400, {
                    required: price,
                    have: coins
                });
            }
        }
        
        if (actualCurrency === 'stars') {
            const stars = parseInt(playerData.stars) || 0;
            if (stars < price) {
                await client.query('ROLLBACK');
                return errorResponse(res, 'Недостаточно Stars', 'INSUFFICIENT_STARS', 400, {
                    required: price,
                    have: stars
                });
            }
        }
        
        // Создаём предмет
        const newItem = {
            id: item.item_id,
            name: item.item_name,
            type: item.item_type,
            damage: item.item_damage,
            defense: item.item_defense,
            rarity: item.item_rarity || 'common',
            upgrade_level: 0,
            modifications: {}
        };
        
        // Добавляем в инвентарь
        const inventory = serializeJSONField(playerData.inventory) || [];
        inventory.push(newItem);
        
        // Списываем валюту
        if (actualCurrency === 'coins') {
            await client.query(`
                UPDATE players SET coins = coins - $1, inventory = $2 WHERE id = $3
            `, [price, inventory, player.id]);
        } else {
            await client.query(`
                UPDATE players SET stars = stars - $1, inventory = $2 WHERE id = $3
            `, [price, inventory, player.id]);
        }
        
        await client.query('COMMIT');
        
        // Логируем действие (вне транзакции)
        try {
            await logPlayerAction(player.id, 'shop_purchase', {
                item_id: item_id,
                item_type: item.item_type,
                price: price,
                currency: actualCurrency
            });
        } catch (logErr) {
            handleError(logErr, 'logPlayerAction - purchase');
        }
        
        successResponse(res, {
            message: 'Покупка совершена!',
            item: newItem,
            price: price,
            currency: actualCurrency
        });
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        handleError(error, '/purchase');
        errorResponse(res, 'Ошибка покупки', 'PURCHASE_ERROR', 500);
    } finally {
        client.release();
    }
});

/**
 * @deprecated Используйте /purchase (v2)
 */
router.post('/purchase-old', async (req, res) => {
    try {
        const { item_id, currency = 'coins' } = req.body;
        const player = req.player;
        
        if (!item_id) {
            return res.status(400).json({ error: 'Укажите ID предмета' });
        }
        
        // Получаем товар из магазина
        const item = await queryOne(`
            SELECT * FROM shop_items WHERE id = $1
        `, [item_id]);
        
        if (!item) {
            return res.status(404).json({ error: 'Предмет не найден' });
        }
        
        // Проверяем валюту
        let price = item.price_coins;
        let actualCurrency = 'coins';
        
        if (currency === 'stars') {
            price = item.price_stars;
            actualCurrency = 'stars';
        }
        
        if (currency === 'coins' && !item.price_coins) {
            return res.json({
                success: false,
                message: 'Этот предмет нельзя купить за монеты'
            });
        }
        
        if (currency === 'stars' && !item.price_stars) {
            return res.json({
                success: false,
                message: 'Этот предмет нельзя купить за Stars'
            });
        }
        
        // Проверяем баланс
        if (actualCurrency === 'coins' && player.coins < price) {
            return res.json({
                success: false,
                message: 'Недостаточно монет',
                required: price,
                have: player.coins
            });
        }
        
        if (actualCurrency === 'stars' && player.stars < price) {
            return res.json({
                success: false,
                message: 'Недостаточно Stars',
                required: price,
                have: player.stars
            });
        }
        
        // Создаём предмет
        const newItem = {
            id: item.item_id,
            name: item.item_name,
            type: item.item_type,
            damage: item.item_damage,
            defense: item.item_defense,
            rarity: item.item_rarity || 'common',
            upgrade_level: 0,
            modifications: {}
        };
        
        // Добавляем в инвентарь
        const inventory = player.inventory || [];
        inventory.push(newItem);
        
        // Списываем валюту
        if (actualCurrency === 'coins') {
            await query(`
                UPDATE players SET coins = coins - $1, inventory = $2 WHERE id = $3
            `, [price, inventory, player.id]);
        } else {
            await query(`
                UPDATE players SET stars = stars - $1, inventory = $2 WHERE id = $3
            `, [price, inventory, player.id]);
        }
        
        res.json({
            success: true,
            message: 'Покупка совершена!',
            item: newItem,
            price: price,
            currency: actualCurrency
        });
        
    } catch (error) {
        console.error('Ошибка /purchase:', error);
        res.status(500).json({ error: 'Ошибка покупки' });
    }
});

module.exports = router;
