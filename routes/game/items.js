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
                    WHERE id = $3
                    RETURNING *
                `, [inventory, upgradeCost, playerId]);
                
            } else {
                // Неудача
                if (use_protection) {
                    // Защита сработала - предмет не сломался
                    await queryOne(`
                        UPDATE players SET coins = coins - $1 WHERE id = $2
                        RETURNING *
                    `, [upgradeCost, playerId]);
                    
                } else {
                    // Предмет сломался
                    itemBroken = true;
                    inventory.splice(item_index, 1);
                    
                    await queryOne(`
                        UPDATE players 
                        SET inventory = $1, coins = coins - $2
                        WHERE id = $3
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
                    WHERE id = $3
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
                    UPDATE players SET coins = coins - $1 WHERE id = $2
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
 * Путь: / (корень внутри роутера)
 */
router.get('/', async (req, res) => {
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

module.exports = router;
