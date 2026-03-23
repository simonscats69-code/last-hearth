/**
 * Улучшение и модификация предметов
 * @module game/items
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const { withPlayerLock, validateId, validateIndex, validateBoolean, validatePositiveInt, ok, fail, error, badRequest, guard, wrap, logPlayerAction, serializeJSONField, logger } = require('../../utils/serverApi');

/**
 * Улучшение предмета
 * Использует withPlayerLock для автоматического управления транзакцией
 */
router.post('/upgrade-item', async (req, res) => {
    try {
        const { item_index, use_protection = false } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        const playerInventory = req.player.inventory || [];
        const indexValidation = validateIndex(item_index, playerInventory.length, 'индекс предмета');
        if (!indexValidation.valid) {
            return badRequest(res, indexValidation.error, indexValidation.code);
        }
        
        const booleanValidation = validateBoolean(use_protection, 'use_protection');
        if (!booleanValidation.valid) {
            return badRequest(res, booleanValidation.error, booleanValidation.code);
        }
        
        // Используем withPlayerLock для автоматического управления транзакцией
        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            const inventory = serializeJSONField(lockedPlayer.inventory) || [];
            
            if (item_index < 0 || item_index >= inventory.length) {
                throw { message: 'Неверный индекс предмета', code: 'INVALID_INDEX', statusCode: 400 };
            }
            
            const item = inventory[item_index];
            
            // Проверяем, что предмет можно улучшать
            if (!item.damage && !item.defense) {
                throw { message: 'Этот предмет нельзя улучшить', code: 'ITEM_NOT_UPGRADEABLE', statusCode: 400 };
            }
            
            const currentLevel = item.upgrade_level || 0;
            const maxLevel = 10;
            
            if (currentLevel >= maxLevel) {
                throw { message: 'Максимальный уровень улучшения достигнут', code: 'MAX_LEVEL_REACHED', statusCode: 400 };
            }
            
            // Стоимость улучшения
            const upgradeCost = (currentLevel + 1) * 50;
            
            const coins = parseInt(lockedPlayer.coins) || 0;
            
            if (coins < upgradeCost) {
                throw { 
                    message: 'Недостаточно монет', 
                    code: 'INSUFFICIENT_COINS', 
                    statusCode: 400,
                    required: upgradeCost,
                    have: coins
                };
            }
            
            // Шанс успеха (уменьшается с каждым уровнем)
            let successChance = 100 - (currentLevel * 8);
            if (use_protection) {
                successChance += 20;
            }
            
            const rolled = Math.random() * 100;
            let upgradeSuccess = false;
            let itemBroken = false;
            
            if (rolled <= successChance) {
                // Успех!
                upgradeSuccess = true;
                item.upgrade_level = currentLevel + 1;
                
                // Увеличиваем статы
                if (item.damage) {
                    item.damage = Math.floor(item.damage * 1.2);
                }
                if (item.defense) {
                    item.defense = Math.floor(item.defense * 1.2);
                }
                
                // Обновляем инвентарь и списываем монеты
                        await queryOne(`
                            UPDATE players 
                            SET inventory = $1, coins = coins - $2
                            WHERE telegram_id = $3
                            RETURNING *
                        `, [inventory, upgradeCost, playerId]);
                
            } else {
                // Неудача
                if (use_protection) {
                    // Защита сработала - предмет не сломался
                        await queryOne(`
                            UPDATE players SET coins = coins - $1 WHERE telegram_id = $2
                            RETURNING *
                        `, [upgradeCost, playerId]);
                    
                } else {
                    // Предмет сломался
                    itemBroken = true;
                    inventory.splice(item_index, 1);
                    
                        await queryOne(`
                            UPDATE players 
                            SET inventory = $1, coins = coins - $2
                            WHERE telegram_id = $3
                            RETURNING *
                        `, [inventory, upgradeCost, playerId]);
                }
            }
            
            // Возвращаем результат для логирования после транзакции
            return {
                item,
                upgradeSuccess,
                itemBroken,
                successChance,
                rolled: rolled.toFixed(2),
                use_protection
            };
        });
        
        // Логируем действие после успешной транзакции
        try {
            await logPlayerAction(pool, playerId, 'item_upgrade', {
                item_index: item_index,
                item_type: result.item?.type,
                success: result.upgradeSuccess,
                item_broken: result.itemBroken,
                new_level: result.item?.upgrade_level,
                success_chance: result.successChance,
                rolled: result.rolled,
                use_protection: result.use_protection
            });
        } catch (logErr) {
            logger.error({ type: 'items_upgrade_log_error', message: logErr.message });
        }
        
        // Отправляем ответ
        if (result.upgradeSuccess) {
            ok(res, {
                message: 'Улучшение успешно!',
                item: result.item,
                new_level: result.item.upgrade_level,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        } else if (result.use_protection) {
            ok(res, {
                message: 'Улучшение не удалось, но защита сработала!',
                item_protected: true,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        } else {
            ok(res, {
                message: 'Улучшение не удалось! Предмет сломан.',
                item_broken: true,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        }
        
    } catch (err) {
        // Обработка ошибок from withPlayerLock
        if (err.code && err.statusCode) {
            return fail(res, err.message, err.code, err.statusCode);
        }
        logger.error('[items] Ошибка улучшения:', err);
        error(res, 'Ошибка улучшения', 'UPGRADE_ERROR', 500);
    }
});

/**
 * Модификация предмета (заточка, укрепление)
 * Использует withPlayerLock для автоматического управления транзакцией
 */
router.post('/modify-item', async (req, res) => {
    try {
        const { item_index, modification_type } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        const playerInventory = req.player.inventory || [];
        const indexValidation = validateIndex(item_index, playerInventory.length, 'индекс предмета');
        if (!indexValidation.valid) {
            return badRequest(res, indexValidation.error, indexValidation.code);
        }
        
        if (!modification_type || typeof modification_type !== 'string') {
            return badRequest(res, 'Укажите тип модификации', 'INVALID_MODIFICATION_TYPE');
        }
        
        const validTypes = ['sharpening', 'reinforcement'];
        if (!validTypes.includes(modification_type)) {
            return badRequest(res, 'Неверный тип модификации', 'INVALID_TYPE');
        }
        
        // Используем withPlayerLock для автоматического управления транзакцией
        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            const inventory = serializeJSONField(lockedPlayer.inventory) || [];
            
            if (item_index < 0 || item_index >= inventory.length) {
                throw { message: 'Неверный индекс предмета', code: 'INVALID_INDEX', statusCode: 400 };
            }
            
            const item = inventory[item_index];
            
            // Инициализируем модификации
            if (!item.modifications) {
                item.modifications = {};
            }
            
            const currentMod = item.modifications[modification_type] || 0;
            
            if (currentMod >= 5) {
                throw { message: 'Максимальный уровень модификации', code: 'MAX_MODIFICATION_LEVEL', statusCode: 400 };
            }
            
            // Проверяем соответствие типа модификации типу предмета
            if (modification_type === 'sharpening' && !item.damage) {
                throw { message: 'Заточка только для оружия', code: 'INVALID_ITEM_TYPE', statusCode: 400 };
            }
            
            if (modification_type === 'reinforcement' && !item.defense) {
                throw { message: 'Укрепление только для брони', code: 'INVALID_ITEM_TYPE', statusCode: 400 };
            }
            
            // Стоимость
            const modCost = (currentMod + 1) * 30;
            
            const coins = parseInt(lockedPlayer.coins) || 0;
            
            if (coins < modCost) {
                throw { 
                    message: 'Недостаточно монет', 
                    code: 'INSUFFICIENT_COINS', 
                    statusCode: 400,
                    required: modCost,
                    have: coins
                };
            }
            
            // Шанс успеха
            const successChance = 90 - (currentMod * 10);
            const rolled = Math.random() * 100;
            
            if (rolled <= successChance) {
                // Применяем модификацию
                item.modifications[modification_type] = currentMod + 1;
                
                if (modification_type === 'sharpening') {
                    item.damage = (item.damage || 0) + 5;
                } else if (modification_type === 'reinforcement') {
                    item.defense = (item.defense || 0) + 5;
                }
                
                await queryOne(`
                    UPDATE players 
                    SET inventory = $1, coins = coins - $2
                    WHERE telegram_id = $3
                    RETURNING *
                `, [inventory, modCost, playerId]);
                
                // Возвращаем результат успеха
                return {
                    success: true,
                    item,
                    currentMod: currentMod + 1,
                    successChance,
                    rolled: rolled.toFixed(2),
                    modification_type
                };
                
            } else {
                // Неудача - монеты все равно списываются
                await queryOne(`
                    UPDATE players SET coins = coins - $1 WHERE telegram_id = $2
                    RETURNING *
                `, [modCost, playerId]);
                
                // Возвращаем результат неудачи
                return {
                    success: false,
                    currentMod,
                    successChance,
                    rolled: rolled.toFixed(2),
                    modification_type
                };
            }
        });
        
        // Логируем действие после успешной транзакции
        try {
            await logPlayerAction(pool, playerId, 'item_modification', {
                item_index: item_index,
                item_type: result.item?.type,
                modification_type: result.modification_type,
                success: result.success,
                new_level: result.currentMod,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        } catch (logErr) {
            logger.error({ type: 'items_modify_log_error', message: logErr.message });
        }
        
        // Отправляем ответ
        if (result.success) {
            ok(res, {
                message: 'Модификация применена!',
                item: result.item,
                modification: result.modification_type,
                new_level: result.currentMod,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        } else {
            ok(res, {
                message: 'Модификация не удалась!',
                success: false,
                success_chance: result.successChance,
                rolled: result.rolled
            });
        }
        
    } catch (err) {
        // Обработка ошибок from withPlayerLock
        if (err.code && err.statusCode) {
            return fail(res, err.message, err.code, err.statusCode);
        }
        logger.error('[items] Ошибка модификации:', err);
        error(res, 'Ошибка модификации', 'MODIFICATION_ERROR', 500);
    }
});

/**
 * Получение списка предметов (справочник)
 * GET /api/game/items или GET /api/game/items/
 */
router.get('/items', async (req, res) => {
    try {
        // Валидация пагинации
        let limit = parseInt(req.query.limit) || 50;
        let offset = parseInt(req.query.offset) || 0;
        
        // Ограничения
        limit = Math.min(Math.max(1, limit), 100);
        offset = Math.max(0, offset);
        
        // Получаем все предметы из справочника
        const items = await queryAll(`
            SELECT * FROM items ORDER BY type, rarity LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        // Получаем общее количество
        const countResult = await queryOne(`
            SELECT COUNT(*) as total FROM items
        `);
        
        const total = parseInt(countResult?.total) || 0;
        
        ok(res, {
            items: items,
            pagination: {
                limit,
                offset,
                total,
                hasMore: offset + items.length < total
            }
        });
        
    } catch (err) {
        logger.error({ type: 'items_get_error', message: err.message });
        error(res, 'Ошибка получения предметов', 'ITEMS_ERROR', 500);
    }
});



// =============================================================================
// ИНВЕНТАРЬ
// =============================================================================

/**
 * Получение инвентаря игрока
 * GET /api/game/inventory (через алиас) или GET /api/game/items/inventory
 */
router.get('/', async (req, res) => {
    try {
        const player = req.player;
        
        const inventory = safeJsonParse(player.inventory, []);
        const equipment = safeJsonParse(player.equipment, {});
        
        const itemsByType = {};
        inventory.forEach((item, index) => {
            if (!itemsByType[item.type]) {
                itemsByType[item.type] = [];
            }
            itemsByType[item.type].push({
                index: index,
                ...item
            });
        });
        
        res.json({
            success: true,
            data: {
                inventory: inventory.map((item, index) => ({
                    index: index,
                    ...item
                })),
                equipment: equipment,
                items_by_type: itemsByType,
                total_items: inventory.length,
                max_inventory: player.max_inventory || 30
            }
        });
        
    } catch (err) {
        handleError(res, err, 'inventory_view');
    }
});

/**
 * Использование предмета из инвентаря
 * POST /api/game/inventory/use-item (через алиас) или POST /api/game/items/use
 */
router.post('/use-item', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { item_index, equip = false } = req.body;
        const playerId = req.player.id;
        
        if (item_index === undefined || item_index === null) {
            return res.status(400).json({
                success: false,
                error: 'Укажите индекс предмета',
                code: 'MISSING_ITEM_INDEX'
            });
        }
        
        if (!Number.isInteger(item_index)) {
            return res.status(400).json({
                success: false,
                error: 'Индекс предмета должен быть целым числом',
                code: 'INVALID_ITEM_INDEX_TYPE'
            });
        }
        
        await client.query('BEGIN');
        
        try {
            const playerResult = await client.query(`
                SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE
            `, [playerId]);
            
            const player = playerResult.rows[0];
            
            if (!player) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Игрок не найден',
                    code: 'PLAYER_NOT_FOUND'
                });
            }
            
            const inventory = safeJsonParse(player.inventory, []);
            
            if (item_index < 0 || item_index >= inventory.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Неверный индекс предмета',
                    code: 'INVALID_ITEM_INDEX'
                });
            }
            
            const item = inventory[item_index];
            
            if (!item || typeof item !== 'object' || !item.id || !item.name) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Некорректная структура предмета',
                    code: 'INVALID_ITEM_STRUCTURE'
                });
            }
            
            if (equip) {
                const equipment = safeJsonParse(player.equipment, {});
                const slot = item.type === 'weapon' ? 'weapon' :
                            item.type === 'armor' ? 'armor' :
                            item.type === 'helmet' ? 'helmet' :
                            item.type === 'boots' ? 'boots' :
                            item.type === 'accessory' ? 'accessory' : null;
                
                if (!slot) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Этот предмет нельзя экипировать',
                        code: 'INVALID_EQUIP_TYPE'
                    });
                }
                
                const oldItem = equipment[slot];
                if (oldItem) {
                    inventory.push(oldItem);
                }
                
                equipment[slot] = item;
                inventory.splice(item_index, 1);
                
                await client.query(`
                    UPDATE players 
                    SET equipment = $1, inventory = $2
                    WHERE telegram_id = $3
                `, [JSON.stringify(equipment), JSON.stringify(inventory), playerId]);
                
                await client.query('COMMIT');
                
                logger.info(`[items] Экипировка предмета`, {
                    playerId,
                    itemName: item.name,
                    slot
                });
                
                res.json({
                    success: true,
                    data: {
                        message: `Экипирован ${item.name}`,
                        equipped: slot,
                        item: item
                    }
                });
                
            } else {
                let message = '';
                let updated = false;
                
                const newInventory = inventory.filter((_, i) => i !== item_index);
                
                if (item.type === 'medicine') {
                    const healthRestored = item.heal ?? 20;
                    await client.query(`
                        UPDATE players 
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE telegram_id = $3
                    `, [healthRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Здоровье +${healthRestored}`;
                    updated = true;
                    
                } else if (item.type === 'antirad') {
                    const radiationCure = item.stats?.radiation_cure || item.rad_removal || 2;
                    
                    let currentRadiation = { level: 0 };
                    if (player.radiation) {
                        if (typeof player.radiation === 'object') {
                            currentRadiation = player.radiation;
                        } else if (typeof player.radiation === 'number') {
                            currentRadiation = { level: player.radiation };
                        }
                    }
                    
                    const newLevel = Math.max(0, currentRadiation.level - radiationCure);
                    
                    let newExpiresAt = null;
                    if (newLevel > 0 && currentRadiation.expires_at && currentRadiation.level > 0) {
                        const oldExpires = new Date(currentRadiation.expires_at);
                        const now = new Date();
                        const safeLevel = Math.max(1, currentRadiation.level);
                        const reductionRatio = radiationCure / safeLevel;
                        const reduction = (oldExpires - now) * reductionRatio;
                        newExpiresAt = new Date(Math.max(now.getTime(), oldExpires.getTime() - reduction)).toISOString();
                    }
                    
                    await client.query(`
                        UPDATE players 
                        SET radiation = $1,
                            inventory = $2
                        WHERE telegram_id = $3
                    `, [JSON.stringify({ level: newLevel, expires_at: newExpiresAt, applied_at: currentRadiation.applied_at }), JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Радиация снижена с ${currentRadiation.level} до ${newLevel}`;
                    updated = true;
                    
                } else if (item.type === 'bandage') {
                    const healthRestored = item.heal || item.stats?.health_restore || 10;
                    
                    await client.query(`
                        UPDATE players 
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE telegram_id = $3
                    `, [healthRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Здоровье +${healthRestored}`;
                    updated = true;
                    
                } else {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Этот предмет нельзя использовать',
                        code: 'UNUSABLE_ITEM'
                    });
                }
                
                await client.query('COMMIT');
                
                if (updated) {
                    logger.info(`[items] Использование предмета`, {
                        playerId,
                        itemName: item.name,
                        itemType: item.type
                    });
                    
                    res.json({
                        success: true,
                        data: {
                            message: message,
                            item: item
                        }
                    });
                }
            }
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'use_item');
    } finally {
        client.release();
    }
});

// =============================================================================
// МАГАЗИН ЗА МОНЕТЫ
// =============================================================================

/**
 * Получить список товаров магазина за монеты
 */
router.get('/shop', async (req, res) => {
    try {
        // Получаем предметы, которые можно купить за монеты (с ценой > 0)
        const items = await queryAll(`
            SELECT id, name, description, type, category, rarity, icon, stats, price, durability
            FROM items 
            WHERE price > 0 AND category IS NOT NULL
            ORDER BY rarity, price
        `);
        
        res.json({
            success: true,
            items: items.rows.map(item => ({
                ...item,
                stats: typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats
            }))
        });
    } catch (error) {
        logger.error({ type: 'shop_error', message: error.message });
        res.status(500).json({ success: false, error: 'Ошибка загрузки магазина' });
    }
});

/**
 * Купить предмет за монеты
 */
router.post('/buy', async (req, res) => {
    const client = await pool.connect();
    try {
        const { item_id, currency = 'coins' } = req.body;
        const playerId = req.player.id;
        
        if (!item_id) {
            return badRequest(res, 'Требуется ID предмета', 'ITEM_REQUIRED');
        }
        
        if (currency !== 'coins') {
            return badRequest(res, 'Магазин принимает только монеты', 'INVALID_CURRENCY');
        }
        
        // Получаем предмет из БД
        const itemResult = await client.query('SELECT * FROM items WHERE id = $1', [item_id]);
        if (itemResult.rows.length === 0) {
            return badRequest(res, 'Предмет не найден', 'ITEM_NOT_FOUND');
        }
        
        const shopItem = itemResult.rows[0];
        const price = shopItem.price || 0;
        
        if (price <= 0) {
            return badRequest(res, 'Этот предмет нельзя купить', 'NOT_FOR_SALE');
        }
        
        // Начинаем транзакцию
        await client.query('BEGIN');
        
        // Получаем игрока с блокировкой
        const playerResult = await client.query(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        const player = playerResult.rows[0];
        const playerCoins = player.coins || 0;
        
        if (playerCoins < price) {
            await client.query('ROLLBACK');
            return badRequest(res, 'Недостаточно монет', 'NOT_ENOUGH_COINS');
        }
        
        // Списываем монеты
        await client.query(
            'UPDATE players SET coins = coins - $1 WHERE id = $2',
            [price, playerId]
        );
        
        // Добавляем предмет в инвентарь
        let inventory = typeof player.inventory === 'string' ? JSON.parse(player.inventory) : (player.inventory || []);
        
        const newItem = {
            id: shopItem.id,
            name: shopItem.name,
            type: shopItem.type,
            category: shopItem.category,
            rarity: shopItem.rarity,
            icon: shopItem.icon,
            stats: typeof shopItem.stats === 'string' ? JSON.parse(shopItem.stats) : (shopItem.stats || {}),
            durability: shopItem.durability || 100,
            max_durability: shopItem.durability || 100,
            quantity: 1
        };
        
        inventory.push(newItem);
        
        await client.query(
            'UPDATE players SET inventory = $1 WHERE id = $2',
            [JSON.stringify(inventory), playerId]
        );
        
        // Логируем действие
        await logPlayerAction(playerId, 'shop_buy', {
            item_id: shopItem.id,
            item_name: shopItem.name,
            price: price,
            currency: currency
        });
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: `Вы купили ${shopItem.name} за ${price} монет`,
            purchased_item: newItem,
            remaining_coins: playerCoins - price
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ type: 'shop_buy_error', playerId: req.player.id, message: error.message });
        res.status(500).json({ success: false, error: 'Ошибка покупки' });
    } finally {
        client.release();
    }
});


// =============================================================================
// КРАФТ (УДАЛЁН)
// =============================================================================

module.exports = router;
