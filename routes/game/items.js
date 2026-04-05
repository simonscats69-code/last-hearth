/**
 * Улучшение и модификация предметов
 * @module game/items
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const { withPlayerLock, validateId, validateIndex, validateBoolean, validatePositiveInt, ok, fail, error, badRequest, guard, wrap, logPlayerAction, serializeJSONField, logger, safeJsonParse, handleError } = require('../../utils/serverApi');

function getShopCategory(item) {
    if (!item) return 'misc';

    if (item.type === 'weapon') return 'weapon';
    if (item.type === 'armor') return 'armor';
    if (item.type === 'food') return 'food';
    if (item.type === 'medicine') return 'medicine';
    if (item.type === 'resource') return 'resource';
    return item.type || 'misc';
}

function resolveEquipSlot(item) {
    const rawSlot = String(item?.slot || item?.category || item?.type || '').toLowerCase();

    if (rawSlot === 'weapon') return 'weapon';
    if (['body', 'armor', 'chest'].includes(rawSlot)) return 'armor';
    if (['head', 'helmet'].includes(rawSlot)) return 'helmet';
    if (['boots', 'feet', 'legs'].includes(rawSlot)) return 'boots';
    if (['accessory', 'ring', 'neck'].includes(rawSlot)) return 'accessory';

    return null;
}

function normalizeItemStats(item) {
    if (!item) return {};
    return safeJsonParse(item.stats, item.stats && typeof item.stats === 'object' ? item.stats : {}) || {};
}

function reduceInfections(infections, cureAmount) {
    const normalized = Array.isArray(infections) ? [...infections] : [];
    let remainingCure = Math.max(0, Number(cureAmount || 0));

    return normalized
        .map((infection) => {
            const level = Math.max(0, Number(infection.level || 0));
            if (remainingCure <= 0 || level <= 0) {
                return infection;
            }

            const reducedBy = Math.min(level, remainingCure);
            remainingCure -= reducedBy;
            return {
                ...infection,
                level: level - reducedBy
            };
        })
        .filter((infection) => Number(infection.level || 0) > 0);
}

// =============================================================================
// ИНВЕНТАРЬ
// =============================================================================

/**
 * Получение инвентаря игрока (объединённый маршрут)
 * GET /api/game/inventory (через алиас)
 * 
 * Возвращает:
 * - inventory: массив предметов
 * - coins/stars: валюта игрока
 * - data: расширенная информация (equipment, items_by_type)
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
            inventory: inventory.map((item, index) => ({
                index: index,
                ...item
            })),
            coins: player.coins || 0,
            stars: player.stars || 0,
            data: {
                inventory: inventory.map((item, index) => ({
                    index: index,
                    ...item
                })),
                equipment: equipment,
                items_by_type: itemsByType,
                total_items: inventory.length,
                max_inventory: 30
            }
        });
        
    } catch (err) {
        handleError(res, err, 'inventory_view');
    }
});

/**
 * Улучшение предмета
 * Использует withPlayerLock для автоматического управления транзакцией
 */
router.post('/upgrade-item', async (req, res) => {
    try {
        const { item_index, use_protection = false } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        // Примечание: валидация индекса перенесена внутрь транзакции для избежания race condition
        const normalizedUseProtection = use_protection === 'true' ? true : use_protection === 'false' ? false : use_protection;
        const booleanValidation = validateBoolean(normalizedUseProtection, 'use_protection');
        if (!booleanValidation.valid) {
            return badRequest(res, booleanValidation.error, booleanValidation.code);
        }
        
        // Используем withPlayerLock для автоматического управления транзакцией
        // Передаём client для выполнения запросов внутри транзакции
        const result = await withPlayerLock(playerId, async (client, lockedPlayer) => {
            const inventory = safeJsonParse(lockedPlayer.inventory, []);
            
            // Валидация индекса внутри транзакции на актуальных данных
            const indexValidation = validateIndex(item_index, inventory.length, 'индекс предмета');
            if (!indexValidation.valid) {
                throw { message: indexValidation.error, code: indexValidation.code, statusCode: 400 };
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
            if (normalizedUseProtection) {
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
                
                // Обновляем инвентарь и списываем монеты внутри транзакции
                await client.query(`
                    UPDATE players 
                    SET inventory = $1, coins = coins - $2
                    WHERE id = $3
                    RETURNING *
                `, [inventory, upgradeCost, lockedPlayer.id]);
                
            } else {
                // Неудача
                if (normalizedUseProtection) {
                    // Защита сработала - предмет не сломался
                    await client.query(`
                        UPDATE players SET coins = coins - $1 WHERE id = $2
                        RETURNING *
                    `, [upgradeCost, lockedPlayer.id]);
                    
                } else {
                    // Предмет сломался
                    itemBroken = true;
                    inventory.splice(item_index, 1);
                    
                    await client.query(`
                        UPDATE players 
                        SET inventory = $1, coins = coins - $2
                        WHERE id = $3
                        RETURNING *
                    `, [inventory, upgradeCost, lockedPlayer.id]);
                }
            }
            
            // Возвращаем результат для логирования после транзакции
            return {
                item,
                upgradeSuccess,
                itemBroken,
                successChance,
                rolled: rolled.toFixed(2),
                use_protection: normalizedUseProtection
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
        // Примечание: валидация индекса перенесена внутрь транзакции
        if (!modification_type || typeof modification_type !== 'string') {
            return badRequest(res, 'Укажите тип модификации', 'INVALID_MODIFICATION_TYPE');
        }
        
        const validTypes = ['sharpening', 'reinforcement'];
        if (!validTypes.includes(modification_type)) {
            return badRequest(res, 'Неверный тип модификации', 'INVALID_TYPE');
        }
        
        // Используем withPlayerLock для автоматического управления транзакцией
        // Передаём client для выполнения запросов внутри транзакции
        const result = await withPlayerLock(playerId, async (client, lockedPlayer) => {
            const inventory = safeJsonParse(lockedPlayer.inventory, []);
            
            // Валидация индекса внутри транзакции
            const indexValidation = validateIndex(item_index, inventory.length, 'индекс предмета');
            if (!indexValidation.valid) {
                throw { message: indexValidation.error, code: indexValidation.code, statusCode: 400 };
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
                
                // Выполняем запрос внутри транзакции
                await client.query(`
                    UPDATE players 
                    SET inventory = $1, coins = coins - $2
                    WHERE id = $3
                    RETURNING *
                `, [inventory, modCost, lockedPlayer.id]);
                
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
                await client.query(`
                    UPDATE players SET coins = coins - $1 WHERE id = $2
                    RETURNING *
                `, [modCost, lockedPlayer.id]);
                
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
 * Использование предмета из инвентаря
 * POST /api/game/inventory/use-item (через алиас) или POST /api/game/items/use
 */
router.post('/use-item', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { item_index, item_id, equip = false } = req.body;
        const playerId = req.player.id;
        const normalizedItemIndex = Number(item_index ?? item_id);
        
        if (item_index === undefined && item_id === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Укажите индекс предмета',
                code: 'MISSING_ITEM_INDEX'
            });
        }
        
        if (!Number.isInteger(normalizedItemIndex)) {
            return res.status(400).json({
                success: false,
                error: 'Индекс предмета должен быть целым числом',
                code: 'INVALID_ITEM_INDEX_TYPE'
            });
        }
        
        await client.query('BEGIN');
        
        try {
            const playerResult = await client.query(`
                SELECT * FROM players WHERE id = $1 FOR UPDATE
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
            
            if (normalizedItemIndex < 0 || normalizedItemIndex >= inventory.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Неверный индекс предмета',
                    code: 'INVALID_ITEM_INDEX'
                });
            }
            
            const item = inventory[normalizedItemIndex];
            
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
                const slot = resolveEquipSlot(item);
                
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
                inventory.splice(normalizedItemIndex, 1);
                
                await client.query(`
                    UPDATE players 
                    SET equipment = $1, inventory = $2
                    WHERE id = $3
                `, [JSON.stringify(equipment), JSON.stringify(inventory), playerId]);
                
                await client.query('COMMIT');
                
                logger.info(`[items] Экипировка предмета`, {
                    playerId,
                    itemName: item.name,
                    slot
                });
                
                res.json({
                    success: true,
                    message: `Экипирован ${item.name}`,
                    data: {
                        message: `Экипирован ${item.name}`,
                        equipped: slot,
                        item: item
                    }
                });
                
            } else {
                let message = '';
                let updated = false;
                
                const newInventory = inventory.filter((_, i) => i !== normalizedItemIndex);
                const stats = normalizeItemStats(item);
                
                if (stats.infection_cure) {
                    const cureAmount = Number(stats.infection_cure || 0);
                    const currentInfections = safeJsonParse(player.infections, []);
                    const updatedInfections = reduceInfections(currentInfections, cureAmount);
                    const oldLevel = currentInfections.reduce((sum, infection) => sum + Number(infection.level || 0), 0);
                    const newLevel = updatedInfections.reduce((sum, infection) => sum + Number(infection.level || 0), 0);

                    await client.query(`
                        UPDATE players
                        SET infections = $1,
                            inventory = $2
                        WHERE id = $3
                    `, [JSON.stringify(updatedInfections), JSON.stringify(newInventory), playerId]);

                    message = `Использовали ${item.name}. Инфекция снижена с ${oldLevel} до ${newLevel}`;
                    updated = true;

                } else if (stats.radiation_cure || item.type === 'antirad') {
                    const radiationCure = Number(stats.radiation_cure || item.rad_removal || 2);

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
                        WHERE id = $3
                    `, [JSON.stringify({ level: newLevel, expires_at: newExpiresAt, applied_at: currentRadiation.applied_at }), JSON.stringify(newInventory), playerId]);

                    message = `Использовали ${item.name}. Радиация снижена с ${currentRadiation.level} до ${newLevel}`;
                    updated = true;

                } else if (item.type === 'food' && stats.energy) {
                    const energyRestored = Number(stats.energy || 0);
                    await client.query(`
                        UPDATE players
                        SET energy = LEAST(max_energy, energy + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [energyRestored, JSON.stringify(newInventory), playerId]);

                    message = `Использовали ${item.name}. Энергия +${energyRestored}`;
                    updated = true;

                } else if (item.type === 'medicine') {
                    // Бонус к лечению от intelligence: +10% за каждую единицу
                    const intBonus = 1 + (((player.intelligence || 1) - 1) * 0.1);
                    const healthRestored = Math.floor(((item.heal ?? stats.health ?? 20)) * intBonus);
                    await client.query(`
                        UPDATE players 
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [healthRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Здоровье +${healthRestored}${player.intelligence > 1 ? ' (бонус интеллекта +' + Math.round((intBonus - 1) * 100) + '%)' : ''}`;
                    updated = true;
                    
                } else if (item.type === 'bandage') {
                    const healthRestored = item.heal || item.stats?.health_restore || 10;
                    
                    await client.query(`
                        UPDATE players 
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE id = $3
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
                        message,
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
        // Получаем все предметы, которые можно купить за монеты.
        // Ключи по-прежнему не продаются, но еда, медицина, броня и ресурсы доступны.
        const items = await queryAll(`
            SELECT id, name, description, type, category, rarity, icon, stats, price, durability, slot
            FROM items 
            WHERE price > 0 AND type != 'key'
            ORDER BY 
                CASE type
                    WHEN 'food' THEN 1
                    WHEN 'medicine' THEN 2
                    WHEN 'weapon' THEN 3
                    WHEN 'armor' THEN 4
                    WHEN 'resource' THEN 5
                    ELSE 6
                END,
                CASE rarity
                    WHEN 'common' THEN 1
                    WHEN 'uncommon' THEN 2
                    WHEN 'rare' THEN 3
                    WHEN 'epic' THEN 4
                    WHEN 'legendary' THEN 5
                    ELSE 6
                END,
                price ASC
        `);
        
        res.json({
            success: true,
            items: items.map(item => {
                let parsedStats = {};
                if (item.stats) {
                    try {
                        parsedStats = typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats;
                    } catch (e) {
                        parsedStats = {};
                    }
                }
                return {
                    ...item,
                    stats: parsedStats,
                    shop_category: getShopCategory(item)
                };
            })
        });
    } catch (error) {
        logger.error({ type: 'shop_error', message: error.message, stack: error.stack });
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
        if (!shopItem) {
            return res.status(404).json({ success: false, error: 'Товар не найден' });
        }
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
        let inventory = safeJsonParse(player.inventory, []);
        const parsedStats = safeJsonParse(shopItem.stats, {});
        
        const newItem = {
            id: shopItem.id,
            name: shopItem.name,
            type: shopItem.type,
            category: shopItem.category,
            rarity: shopItem.rarity,
            icon: shopItem.icon,
            slot: shopItem.slot || null,
            stats: parsedStats,
            damage: parsedStats.damage || 0,
            defense: parsedStats.defense || 0,
            heal: parsedStats.health || 0,
            rad_removal: parsedStats.radiation_cure || 0,
            radiation_resist: parsedStats.radiation_resist || 0,
            infection_resist: parsedStats.infection_resist || 0,
            durability: shopItem.durability || 100,
            max_durability: shopItem.durability || 100,
            quantity: 1
        };
        
        inventory.push(newItem);
        
        await client.query(
            `UPDATE players
             SET inventory = $1,
                 items_collected = COALESCE(items_collected, 0) + 1
             WHERE id = $2`,
            [JSON.stringify(inventory), playerId]
        );
        
        // Логируем действие
        await logPlayerAction(pool, playerId, 'shop_buy', {
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
