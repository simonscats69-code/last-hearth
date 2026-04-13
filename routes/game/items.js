/**
 * Улучшение и модификация предметов
 * @module game/items
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const { withPlayerLock, validateIndex, validateBoolean, ok, fail, error, badRequest, logPlayerAction, logger, safeJsonParse, handleError } = require('../../utils/serverApi');
const { normalizeInventory, createInventoryItem } = require('../../utils/game-helpers');

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
    const rawSlot = String(item?.slot ?? item?.category ?? item?.type ?? '').toLowerCase();

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

function resolveInventoryItemIndex(inventory, itemIndex, itemId) {
    const normalizedItemIndex = itemIndex === undefined || itemIndex === null ? null : Number(itemIndex);
    if (Number.isInteger(normalizedItemIndex) && normalizedItemIndex >= 0 && normalizedItemIndex < inventory.length) {
        return normalizedItemIndex;
    }

    if (itemId !== undefined && itemId !== null) {
        const normalizedItemId = Number(itemId);
        const itemIndexById = inventory.findIndex((item) => Number(item?.id) === normalizedItemId);
        if (itemIndexById >= 0) {
            return itemIndexById;
        }
    }

    return Number.isInteger(normalizedItemIndex) ? normalizedItemIndex : -1;
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

        const inventory = normalizeInventory(player.inventory);
        const equipment = safeJsonParse(player.equipment, {});

        // Удалены DEBUG логи
        
        const itemsByType = {};
        inventory.forEach((item, index) => {
            const itemType = item.type || 'misc';
            if (!itemsByType[itemType]) {
                itemsByType[itemType] = [];
            }
            itemsByType[itemType].push({
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
            const inventory = normalizeInventory(lockedPlayer.inventory);
            
            // Валидация индекса внутри транзакции на актуальных данных
            const indexValidation = validateIndex(item_index, inventory.length, 'индекс предмета');
            if (!indexValidation.valid) {
                throw { message: indexValidation.error, code: indexValidation.code, statusCode: 400 };
            }
            
            const item = inventory[item_index];
            
            // Проверяем, что предмет можно улучшать
            if (!('damage' in item) && !('defense' in item)) {
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
            let successChance = Math.max(0, 100 - (currentLevel * 8));
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
                `, [inventory, upgradeCost, lockedPlayer.id]);
                
            } else {
                // Неудача
                if (normalizedUseProtection) {
                    // Защита сработала - предмет не сломался
                    await client.query(`
                        UPDATE players SET coins = coins - $1 WHERE id = $2
                    `, [upgradeCost, lockedPlayer.id]);
                    
                } else {
                    // Предмет сломался
                    itemBroken = true;
                    inventory.splice(item_index, 1);

                    await client.query(`
                        UPDATE players
                        SET inventory = $1, coins = coins - $2
                        WHERE id = $3
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
            const inventory = normalizeInventory(lockedPlayer.inventory);
            
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
            const successChance = Math.max(0, 90 - (currentMod * 10));
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
 * GET /api/game/items/list
 */
router.get('/list', async (req, res) => {
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
    try {
        const { item_index, item_id, equip = false } = req.body;
        const playerId = req.player.id;
        const normalizedItemIndexInput = item_index === undefined ? null : Number(item_index);

        // Валидация входных данных
        if (item_index === undefined && item_id === undefined) {
            return badRequest(res, 'Укажите индекс или ID предмета', 'MISSING_ITEM_INDEX');
        }

        if (item_index !== undefined && !Number.isInteger(normalizedItemIndexInput)) {
            return badRequest(res, 'Индекс предмета должен быть целым числом', 'INVALID_ITEM_INDEX_TYPE');
        }

        // Используем withPlayerLock для автоматического управления транзакцией
        const result = await withPlayerLock(playerId, async (client, lockedPlayer) => {
            const inventory = normalizeInventory(lockedPlayer.inventory);
            const normalizedItemIndex = resolveInventoryItemIndex(inventory, normalizedItemIndexInput, item_id);

            // Валидация индекса внутри транзакции
            if (normalizedItemIndex < 0 || normalizedItemIndex >= inventory.length) {
                throw { message: 'Неверный индекс предмета', code: 'INVALID_ITEM_INDEX', statusCode: 400 };
            }

            const item = inventory[normalizedItemIndex];

            if (!item || typeof item !== 'object' || !item.name || !(item.type || item.category)) {
                throw { message: 'Некорректная структура предмета', code: 'INVALID_ITEM_STRUCTURE', statusCode: 400 };
            }

            if (equip) {
                const equipment = safeJsonParse(lockedPlayer.equipment, {});
                const slot = resolveEquipSlot(item);

                if (!slot) {
                    throw { message: 'Этот предмет нельзя экипировать', code: 'INVALID_EQUIP_TYPE', statusCode: 400 };
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
                `, [equipment, inventory, lockedPlayer.id]);

                return {
                    action: 'equip',
                    slot,
                    item
                };

            } else {
                let message = '';
                let updated = false;

                const newInventory = inventory.filter((_, i) => i !== normalizedItemIndex);
                const stats = normalizeItemStats(item);

                if (stats.infection_cure) {
                    const cureAmount = Number(stats.infection_cure || 0);
                    const currentInfections = safeJsonParse(lockedPlayer.infections, []);
                    const updatedInfections = reduceInfections(currentInfections, cureAmount);
                    const oldLevel = currentInfections.reduce((sum, infection) => sum + Number(infection.level || 0), 0);
                    const newLevel = updatedInfections.reduce((sum, infection) => sum + Number(infection.level || 0), 0);

                    await client.query(`
                        UPDATE players
                        SET infections = $1,
                            inventory = $2
                        WHERE id = $3
                    `, [updatedInfections, newInventory, lockedPlayer.id]);

                    message = `Использовали ${item.name}. Инфекция снижена с ${oldLevel} до ${newLevel}`;
                    updated = true;

                } else if (stats.radiation_cure || item.type === 'antirad') {
                    const radiationCure = Number(stats.radiation_cure || item.rad_removal || 2);

                    let currentRadiation = { level: 0 };
                    if (lockedPlayer.radiation) {
                        if (typeof lockedPlayer.radiation === 'object') {
                            currentRadiation = lockedPlayer.radiation;
                        } else if (typeof lockedPlayer.radiation === 'number') {
                            currentRadiation = { level: lockedPlayer.radiation };
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
                    `, [{ level: newLevel, expires_at: newExpiresAt, applied_at: currentRadiation.applied_at }, newInventory, lockedPlayer.id]);

                    message = `Использовали ${item.name}. Радиация снижена с ${currentRadiation.level} до ${newLevel}`;
                    updated = true;

                } else if (item.type === 'food' && stats.energy) {
                    const energyRestored = Number(stats.energy || 0);
                    await client.query(`
                        UPDATE players
                        SET energy = LEAST(max_energy, energy + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [energyRestored, newInventory, lockedPlayer.id]);

                    message = `Использовали ${item.name}. Энергия +${energyRestored}`;
                    updated = true;

                } else if (item.type === 'medicine') {
                    // Бонус к лечению от intelligence: +10% за каждую единицу
                    const intBonus = 1 + (((lockedPlayer.intelligence || 1) - 1) * 0.1);
                    const healthRestored = Math.floor(((item.heal ?? stats.health ?? 20)) * intBonus);
                    await client.query(`
                        UPDATE players
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [healthRestored, newInventory, lockedPlayer.id]);

                    message = `Использовали ${item.name}. Здоровье +${healthRestored}${lockedPlayer.intelligence > 1 ? ' (бонус интеллекта +' + Math.round((intBonus - 1) * 100) + '%)' : ''}`;
                    updated = true;

                } else if (item.type === 'bandage') {
                    const healthRestored = stats.health_restore || item.heal || 10;

                    await client.query(`
                        UPDATE players
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [healthRestored, newInventory, lockedPlayer.id]);

                    message = `Использовали ${item.name}. Здоровье +${healthRestored}`;
                    updated = true;

                } else {
                    throw { message: 'Этот предмет нельзя использовать', code: 'UNUSABLE_ITEM', statusCode: 400 };
                }

                if (updated) {
                    return {
                        action: 'use',
                        message,
                        item
                    };
                }
            }
        });

        // Логируем действие после успешной транзакции
        try {
            if (result.action === 'equip') {
                logger.info(`[items] Экипировка предмета`, {
                    playerId,
                    itemName: result.item.name,
                    slot: result.slot
                });
            } else if (result.action === 'use') {
                logger.info(`[items] Использование предмета`, {
                    playerId,
                    itemName: result.item.name,
                    itemType: result.item.type
                });
            }
        } catch (logErr) {
            logger.error({ type: 'use_item_log_error', message: logErr.message });
        }

        // Отправляем ответ
        if (result.action === 'equip') {
            ok(res, {
                message: `Экипирован ${result.item.name}`,
                equipped: result.slot,
                item: result.item
            });
        } else if (result.action === 'use') {
            ok(res, {
                message: result.message,
                item: result.item
            });
        }

    } catch (err) {
        // Обработка ошибок from withPlayerLock
        if (err.code && err.statusCode) {
            return fail(res, err.message, err.code, err.statusCode);
        }
        logger.error('[items] Ошибка использования:', err);
        error(res, 'Ошибка использования предмета', 'USE_ITEM_ERROR', 500);
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
                        parsedStats = typeof item.stats === 'string' ? JSON.parse(item.stats) : (typeof item.stats === 'object' ? item.stats : {});
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
        let inventory = normalizeInventory(player.inventory);
        const newItem = createInventoryItem(shopItem, { quantity: 1 });
        
        inventory.push(newItem);
        
        const updateResult = await client.query(
            `UPDATE players
             SET inventory = $1,
                 items_collected = COALESCE(items_collected, 0) + 1
             WHERE id = $2
             RETURNING coins`,
            [inventory, playerId]
        );

        await client.query('COMMIT');

        // Логируем действие после успешного коммита
        try {
            await logPlayerAction(pool, playerId, 'shop_buy', {
                item_id: shopItem.id,
                item_name: shopItem.name,
                price: price,
                currency: currency
            });
        } catch (logErr) {
            logger.error({ type: 'shop_buy_log_error', message: logErr.message });
        }
        
        res.json({
            success: true,
            message: `Вы купили ${shopItem.name} за ${price} монет`,
            purchased_item: newItem,
            remaining_coins: updateResult.rows[0].coins
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
