/**
 * Рынок (магазин между игроками)
 * @module game/market
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const { logPlayerAction, serializeJSONField, handleError, safeJsonParse, logger } = require('../../utils/serverApi');

// Общие функции API из utils/apiHelpers
const { 
    successResponse, 
    errorResponse, 
    isValidId,
    isValidPrice, 
    isValidIndex,
    safeParse,
    parsePagination
} = require('../../utils/apiHelpers');

/**
 * Получение объявлений на рынке
 * GET /market/listings → GET /api/game/market/listings
 * Путь: /listings (внутри роутера)
 */
router.get('/listings', async (req, res) => {
    try {
        const { type, rarity, sort = 'price', order = 'asc' } = req.query;
        const { limit, offset } = parsePagination(req.query, 50, 100);
        
        let sql = 'SELECT * FROM market_listings WHERE status = $1';
        const params = ['active'];
        
        if (type && typeof type === 'string') {
            sql += ' AND item_type = $' + (params.length + 1);
            params.push(type);
        }
        
        if (rarity && typeof rarity === 'string') {
            sql += ' AND item_rarity = $' + (params.length + 1);
            params.push(rarity);
        }
        
        sql += ' ORDER BY price ' + (order === 'desc' ? 'DESC' : 'ASC');
        sql += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
        params.push(limit, offset);
        
        const listings = await queryAll(sql, params);
        
        res.json({
            success: true,
            listings: listings.map(l => ({
                id: l.id,
                seller_id: l.seller_id,
                item: safeParse(l.item_data) || null,
                price: l.price,
                created_at: l.created_at
            }))
        });
        
    } catch (error) {
        handleError(error, '/market/listings');
        errorResponse(res, 'Ошибка получения объявлений', 'LISTINGS_ERROR', 500);
    }
});

/**
 * Получение объявлений с пагинацией (v2)
 * GET /market/listings-v2 → GET /api/game/market/listings-v2
 * Путь: /listings-v2 (внутри роутера)
 */
router.get('/listings-v2', async (req, res) => {
    try {
        const { type, rarity, sort = 'price', order = 'asc' } = req.query;
        const { limit, offset } = parsePagination(req.query, 50, 100);
        
        let sql = 'SELECT ml.*, p.username as seller_username FROM market_listings ml LEFT JOIN players p ON ml.seller_id = p.telegram_id WHERE ml.status = $1';
        const params = ['active'];
        
        if (type && typeof type === 'string') {
            sql += ' AND ml.item_type = $' + (params.length + 1);
            params.push(type);
        }
        
        if (rarity && typeof rarity === 'string') {
            sql += ' AND ml.item_rarity = $' + (params.length + 1);
            params.push(rarity);
        }
        
        // Валидация параметров сортировки
        const allowedSorts = ['price', 'created_at'];
        const safeSort = allowedSorts.includes(sort) ? sort : 'price';
        const safeOrder = order === 'desc' ? 'DESC' : 'ASC';
        
        sql += ` ORDER BY ml.${safeSort} ${safeOrder}`;
        sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        
        const listings = await queryAll(sql, params);
        
        // Получаем общее количество
        let countSql = 'SELECT COUNT(*) as total FROM market_listings WHERE status = $1';
        const countParams = ['active'];
        
        if (type && typeof type === 'string') {
            countSql += ' AND item_type = $2';
            countParams.push(type);
        }
        // ИСПРАВЛЕНО: было item_type вместо item_rarity
        if (rarity && typeof rarity === 'string') {
            countSql += ' AND item_rarity = $' + (countParams.length + 1);
            countParams.push(rarity);
        }
        
        const countResult = await queryOne(countSql, countParams);
        const total = parseInt(countResult?.total) || 0;
        
        successResponse(res, {
            listings: listings.map(l => ({
                id: l.id,
                seller_id: l.seller_id,
                seller_username: l.seller_username,
                item: safeParse(l.item_data) || null,
                price: l.price,
                created_at: l.created_at
            })),
            pagination: {
                limit,
                offset,
                total,
                hasMore: offset + listings.length < total
            }
        });
        
    } catch (error) {
        handleError(error, '/market/listings-v2');
        errorResponse(res, 'Ошибка получения объявлений', 'LISTINGS_ERROR', 500);
    }
});

/**
 * Мои объявления
 * GET /market/my → GET /api/game/market/my
 * Путь: /my (внутри роутера)
 */
router.get('/my', async (req, res) => {
    try {
        const player = req.player;
        
        if (!player || !isValidId(player.id)) {
            return errorResponse(res, 'Игрок не найден', 'INVALID_PLAYER', 401);
        }
        
        const { limit, offset } = parsePagination(req.query, 50, 100);
        
        const listings = await queryAll(`
            SELECT * FROM market_listings 
            WHERE seller_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `, [player.id, limit, offset]);
        
        // Получаем общее количество
        const countResult = await queryOne(`
            SELECT COUNT(*) as total FROM market_listings WHERE seller_id = $1
        `, [player.id]);
        
        const total = parseInt(countResult?.total) || 0;
        
        successResponse(res, {
            listings: listings.map(l => ({
                id: l.id,
                item: safeParse(l.item_data) || null,
                price: l.price,
                status: l.status,
                created_at: l.created_at
            })),
            pagination: {
                limit,
                offset,
                total,
                hasMore: offset + listings.length < total
            }
        });
        
    } catch (error) {
        handleError(error, '/market/my');
        errorResponse(res, 'Ошибка получения объявлений', 'MY_LISTINGS_ERROR', 500);
    }
});

/**
 * Создание объявления
 * POST /market/create → POST /api/game/market/create
 * Путь: /create (внутри роутера)
 */
router.post('/create', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Начинаем транзакцию
        
        const { item_index, price } = req.body;
        const player = req.player;
        
        // Валидация входных данных
        if (!isValidIndex(item_index, player.inventory?.length || 0)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректный индекс предмета', 'INVALID_ITEM_INDEX');
        }
        
        if (!isValidPrice(price)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректную цену (от 1 до 1000000)', 'INVALID_PRICE');
        }
        
        // Блокируем игрока для обновления
        const playerResult = await client.query(`
            SELECT id, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [player.id]);
        
        if (playerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Игрок не найден', 'PLAYER_NOT_FOUND', 404);
        }
        
        const playerData = playerResult.rows[0];
        const inventory = safeParse(playerData.inventory) || [];
        
        if (item_index < 0 || item_index >= inventory.length) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Неверный индекс предмета', 'INVALID_INDEX');
        }
        
        const item = inventory[item_index];
        
        // Создаём объявление
        const listingResult = await client.query(`
            INSERT INTO market_listings (seller_id, item_data, item_type, item_rarity, price, status, created_at)
            VALUES ($1, $2, $3, $4, $5, 'active', NOW())
            RETURNING id
        `, [player.id, item, item.type, item.rarity || 'common', price]);
        
        // Удаляем предмет из инвентаря
        const newInventory = [...inventory];
        newInventory.splice(item_index, 1);
        
        await client.query(`
            UPDATE players SET inventory = $1 WHERE id = $2
        `, [serializeJSONField(newInventory), player.id]);
        
        await client.query('COMMIT');
        
        // Логируем действие (вне транзакции)
        try {
            await logPlayerAction(player.id, 'market_listing_created', {
                listing_id: listingResult.rows[0].id,
                item_type: item.type,
                item_rarity: item.rarity,
                price: price
            });
        } catch (logErr) {
            handleError(logErr, 'logPlayerAction - market_create');
        }
        
        successResponse(res, {
            message: 'Объявление создано!',
            listing_id: listingResult.rows[0].id,
            price: price,
            item: item
        });
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        handleError(error, '/market/create');
        errorResponse(res, 'Ошибка создания объявления', 'CREATE_ERROR', 500);
    } finally {
        client.release();
    }
});

/**
 * Покупка предмета
 * POST /market/buy → POST /api/game/market/buy
 * Путь: /buy (внутри роутера)
 */
router.post('/buy', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Начинаем транзакцию
        
        const { listing_id } = req.body;
        const player = req.player;
        
        // Валидация ID
        if (!isValidId(listing_id)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите ID объявления', 'INVALID_LISTING_ID');
        }
        
        // Получаем объявление с блокировкой
        const listingResult = await client.query(`
            SELECT * FROM market_listings WHERE id = $1 AND status = 'active' FOR UPDATE
        `, [listing_id]);
        
        if (listingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Объявление не найдено', 'LISTING_NOT_FOUND', 404);
        }
        
        const listing = listingResult.rows[0];
        
        if (listing.seller_id === player.id) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Нельзя купить свой товар', 'CANNOT_BUY_OWN');
        }
        
        // ИСПРАВЛЕНО: блокируем в предсказуемом порядке (меньший id первым) для избежания deadlock
        const buyerId = player.id;
        const sellerId = listing.seller_id;
        const firstId = Math.min(buyerId, sellerId);
        const secondId = Math.max(buyerId, sellerId);
        
        // Блокируем первого игрока
        const firstResult = await client.query(`
            SELECT id, coins, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [firstId]);
        
        const firstData = firstResult.rows[0];
        
        // Блокируем второго игрока
        const secondResult = await client.query(`
            SELECT id, coins, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [secondId]);
        
        const secondData = secondResult.rows[0];
        
        // Определяем谁是 покупатель, кто продавец по заблокированным данным
        const isBuyerFirst = (firstId === buyerId);
        const buyerData = isBuyerFirst ? firstData : secondData;
        const sellerData = isBuyerFirst ? secondData : firstData;
        
        const buyerCoins = parseInt(buyerData.coins) || 0;
        
        // Проверяем монеты
        if (buyerCoins < listing.price) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Недостаточно монет', 'INSUFFICIENT_COINS', 400, {
                required: listing.price,
                have: buyerCoins
            });
        }
        
        // Комиссия 5%
        const commission = Math.floor(listing.price * 0.05);
        const sellerGets = listing.price - commission;
        
        // Переводим монеты продавцу
        await client.query(`
            UPDATE players SET coins = coins + $1 WHERE id = $2
        `, [sellerGets, sellerData.id]);
        
        // Забираем монеты у покупателя
        await client.query(`
            UPDATE players SET coins = coins - $1 WHERE id = $2
        `, [listing.price, buyerData.id]);
        
        // Даём предмет покупателю
        const item = safeParse(listing.item_data);
        const buyerInventory = safeParse(buyerData.inventory) || [];
        buyerInventory.push(item);
        
        await client.query(`
            UPDATE players SET inventory = $1 WHERE id = $2
        `, [serializeJSONField(buyerInventory), buyerData.id]);
        
        // Помечаем объявление как проданное
        await client.query(`
            UPDATE market_listings SET status = 'sold', buyer_id = $1, sold_at = NOW()
            WHERE id = $2
        `, [buyerData.id, listing_id]);
        
        await client.query('COMMIT');
        
        // Логируем действие (вне транзакции)
        try {
            await logPlayerAction(buyerData.id, 'market_purchase', {
                listing_id: listing_id,
                item_type: item?.type,
                price: listing.price,
                commission: commission,
                seller_id: sellerData.id
            });
            
            await logPlayerAction(sellerData.id, 'market_sale', {
                listing_id: listing_id,
                item_type: item?.type,
                price: listing.price,
                earnings: sellerGets
            });
        } catch (logErr) {
            handleError(logErr, 'logPlayerAction - market_buy');
        }
        
        successResponse(res, {
            message: 'Покупка совершена!',
            item: item,
            price: listing.price,
            commission: commission
        });
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        handleError(error, '/market/buy');
        errorResponse(res, 'Ошибка покупки', 'BUY_ERROR', 500);
    } finally {
        client.release();
    }
});

/**
 * Отмена объявления
 * POST /market/cancel → POST /api/game/market/cancel
 * Путь: /cancel (внутри роутера)
 */
router.post('/cancel', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Начинаем транзакцию
        
        const { listing_id } = req.body;
        const player = req.player;
        
        // Валидация ID
        if (!isValidId(listing_id)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите ID объявления', 'INVALID_LISTING_ID');
        }
        
        // ИСПРАВЛЕНО: добавлена проверка status = 'active'
        const listingResult = await client.query(`
            SELECT * FROM market_listings WHERE id = $1 AND seller_id = $2 AND status = 'active' FOR UPDATE
        `, [listing_id, player.id]);
        
        if (listingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Объявление не найдено или уже продано', 'LISTING_NOT_FOUND', 404);
        }
        
        const listing = listingResult.rows[0];
        
        // Блокируем игрока для обновления инвентаря
        const playerResult = await client.query(`
            SELECT id, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [player.id]);
        
        const playerData = playerResult.rows[0];
        
        // Возвращаем предмет
        const item = safeParse(listing.item_data);
        const inventory = safeParse(playerData.inventory) || [];
        inventory.push(item);
        
        await client.query(`
            UPDATE players SET inventory = $1 WHERE id = $2
        `, [serializeJSONField(inventory), player.id]);
        
        // Удаляем объявление
        await client.query(`
            DELETE FROM market_listings WHERE id = $1
        `, [listing_id]);
        
        await client.query('COMMIT');
        
        // Логируем действие (вне транзакции)
        try {
            await logPlayerAction(player.id, 'market_listing_cancelled', {
                listing_id: listing_id,
                item_type: item?.type,
                price: listing.price
            });
        } catch (logErr) {
            handleError(logErr, 'logPlayerAction - market_cancel');
        }
        
        successResponse(res, {
            message: 'Объявление отменено',
            item: item
        });
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        handleError(error, '/market/cancel');
        errorResponse(res, 'Ошибка отмены объявления', 'CANCEL_ERROR', 500);
    } finally {
        client.release();
    }
});

/**
 * Покупка предмета из магазина (NPC)
 * POST /market/shop → POST /api/game/market/shop
 * Путь: /shop (внутри роутера)
 */
router.post('/shop', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { item_id, currency = 'coins' } = req.body;
        const player = req.player;
        
        // Валидация входных данных
        if (!isValidId(item_id)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректный ID предмета', 'INVALID_ITEM_ID');
        }
        
        if (!['coins', 'stars'].includes(currency)) {
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
        let price = currency === 'stars' ? item.price_stars : item.price_coins;
        
        if (!price) {
            await client.query('ROLLBACK');
            return errorResponse(res, `Этот предмет нельзя купить за ${currency === 'stars' ? 'Stars' : 'монеты'}`, 'INVALID_CURRENCY');
        }
        
        // Блокируем игрока для проверки баланса
        const playerResult = await client.query(`
            SELECT id, coins, stars, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [player.id]);
        
        const playerData = playerResult.rows[0];
        
        // Проверяем баланс
        const balance = currency === 'stars' ? parseInt(playerData.stars) || 0 : parseInt(playerData.coins) || 0;
        
        if (balance < price) {
            await client.query('ROLLBACK');
            return errorResponse(res, `Недостаточно ${currency === 'stars' ? 'Stars' : 'монет'}`, 
                currency === 'stars' ? 'INSUFFICIENT_STARS' : 'INSUFFICIENT_COINS', 400, {
                required: price,
                have: balance
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
        const inventory = safeParse(playerData.inventory, []);
        inventory.push(newItem);
        
        // Списываем валюту
        if (currency === 'coins') {
            await client.query(`
                UPDATE players SET coins = coins - $1, inventory = $2 WHERE id = $3
            `, [price, serializeJSONField(inventory), player.id]);
        } else {
            await client.query(`
                UPDATE players SET stars = stars - $1, inventory = $2 WHERE id = $3
            `, [price, serializeJSONField(inventory), player.id]);
        }
        
        await client.query('COMMIT');
        
        // Логируем действие
        try {
            await logPlayerAction(player.id, 'shop_purchase', {
                item_id: item_id,
                item_type: item.item_type,
                price: price,
                currency: currency
            });
        } catch (logErr) {
            logger.error('[market] Ошибка логирования:', logErr.message);
        }
        
        successResponse(res, {
            message: 'Покупка совершена!',
            item: newItem,
            price: price,
            currency: currency
        });
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[market/shop] Ошибка:', error.message);
        errorResponse(res, 'Ошибка покупки', 'PURCHASE_ERROR', 500);
    } finally {
        client.release();
    }
});

/**
 * Информация о рынке
 * GET /market/info → GET /api/game/market/info
 * Путь: /info (внутри роутера)
 */
router.get('/info', async (req, res) => {
    try {
        const stats = await queryOne(`
            SELECT 
                COUNT(*) as total_listings,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
                AVG(price) as avg_price
            FROM market_listings
        `);
        
        successResponse(res, {
            total_listings: parseInt(stats.total_listings) || 0,
            active_listings: parseInt(stats.active) || 0,
            average_price: Math.floor(stats.avg_price) || 0,
            commission: '5%'
        });
        
    } catch (error) {
        handleError(error, '/market/info');
        errorResponse(res, 'Ошибка получения информации', 'INFO_ERROR', 500);
    }
});

module.exports = router;
