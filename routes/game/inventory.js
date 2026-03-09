/**
 * Инвентарь и использование предметов
 * Namespace: inventory
 * 
 * Критерии продакшна:
 * - Транзакции и атомарность для операций записи
 * - Валидация входных данных
 * - Логирование действий игрока
 * - Единый формат ответов {success, data}
 * - Обратная совместимость (@deprecated)
 * - Централизованный namespace
 * - Единый обработчик ошибок
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne } = require('../../db/database');
const playerHelper = require('../../utils/playerHelper');
const { logger } = require('../../utils/logger');

/**
 * Универсальный обработчик ошибок
 * @param {object} res - объект ответа Express
 * @param {Error} error - объект ошибки
 * @param {string} action - действие, в котором произошла ошибка
 */
function handleError(res, error, action = 'unknown') {
    logger.error(`[inventory] ${action}`, {
        error: error.message,
        stack: error.stack
    });
    
    return res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        code: 'INTERNAL_ERROR'
    });
}

/**
 * Safe JSON parsing с fallback
 * @param {any} value - значение для парсинга
 * @param {object} fallback - значение по умолчанию
 * @returns {object} распарсенный объект
 */
function safeJsonParse(value, fallback = {}) {
    if (value === null || value === undefined) {
        return fallback;
    }
    
    if (typeof value === 'object') {
        return value;
    }
    
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (e) {
            logger.warn('[inventory] Ошибка парсинга JSON', { value: value.substring(0, 100) });
            return fallback;
        }
    }
    
    return fallback;
}

/**
 * Валидация индекса предмета
 * @param {any} itemIndex - индекс для валидации
 * @param {number} maxIndex - максимальный допустимый индекс
 * @returns {boolean} результат валидации
 */
function validateItemIndex(itemIndex, maxIndex) {
    return Number.isInteger(itemIndex) && itemIndex >= 0 && itemIndex < maxIndex;
}

/**
 * Валидация булева параметра
 * @param {any} value - значение для валидации
 * @returns {boolean} результат валидации
 */
function validateBoolean(value) {
    return typeof value === 'boolean';
}

/**
 * Использование предмета из инвентаря
 */
router.post('/use-item', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { item_index, equip = false } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
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
        
        if (!validateBoolean(equip)) {
            return res.status(400).json({
                success: false,
                error: 'Параметр equip должен быть boolean',
                code: 'INVALID_EQUIP_TYPE'
            });
        }
        
        // Используем транзакцию для атомарности
        await client.query('BEGIN');
        
        try {
            // Получаем игрока с блокировкой строки
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
            
            // Валидация диапазона индекса
            if (item_index < 0 || item_index >= inventory.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Неверный индекс предмета',
                    code: 'INVALID_ITEM_INDEX'
                });
            }
            
            const item = inventory[item_index];
            
            if (equip) {
                // Экипировка предмета
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
                
                // Снимаем старый предмет
                const oldItem = equipment[slot];
                if (oldItem) {
                    inventory.push(oldItem);
                }
                
                // Экипируем новый
                equipment[slot] = item;
                inventory.splice(item_index, 1);
                
                await client.query(`
                    UPDATE players 
                    SET equipment = $1, inventory = $2
                    WHERE id = $3
                `, [JSON.stringify(equipment), JSON.stringify(inventory), playerId]);
                
                await client.query('COMMIT');
                
                // Логируем действие
                logger.info(`[inventory] Экипировка предмета`, {
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
                // Использование предмета (расходник)
                let message = '';
                let updated = false;
                
                // Удаляем предмет из инвентаря
                const newInventory = inventory.filter((_, i) => i !== item_index);
                
                if (item.type === 'food') {
                    const hungerRestored = item.hunger || 10;
                    await client.query(`
                        UPDATE players 
                        SET hunger = LEAST(100, hunger + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [hungerRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Съели ${item.name}. Голод +${hungerRestored}`;
                    updated = true;
                    
                } else if (item.type === 'water') {
                    const thirstRestored = item.thirst || 15;
                    await client.query(`
                        UPDATE players 
                        SET thirst = LEAST(100, thirst + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [thirstRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Выпили ${item.name}. Жажда +${thirstRestored}`;
                    updated = true;
                    
                } else if (item.type === 'medicine') {
                    const healthRestored = item.heal || 20;
                    await client.query(`
                        UPDATE players 
                        SET health = LEAST(max_health, health + $1),
                            infection_count = GREATEST(0, infection_count - 1),
                            inventory = $2
                        WHERE id = $3
                    `, [healthRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Здоровье +${healthRestored}`;
                    updated = true;
                    
                } else if (item.type === 'antirad') {
                    const radRemoved = item.rad_removal || 30;
                    await client.query(`
                        UPDATE players 
                        SET radiation = GREATEST(0, radiation - $1),
                            inventory = $2
                        WHERE id = $3
                    `, [radRemoved, JSON.stringify(newInventory), playerId]);
                    
                    message = `Выпили ${item.name}. Радиация -${radRemoved}`;
                    updated = true;
                    
                } else if (item.type === 'bandage') {
                    // Лечим переломы
                    if (player.broken_leg || player.broken_arm) {
                        await client.query(`
                            UPDATE players 
                            SET broken_leg = false, broken_arm = false,
                                inventory = $1
                            WHERE id = $2
                        `, [JSON.stringify(newInventory), playerId]);
                        
                        message = `Перевязали ${item.name}. Переломы излечены`;
                    } else {
                        await client.query('ROLLBACK');
                        return res.status(400).json({
                            success: false,
                            error: 'Нет переломов для лечения',
                            code: 'NO_BROKEN_BONES'
                        });
                    }
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
                    // Логируем действие
                    logger.info(`[inventory] Использование предмета`, {
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

/**
 * Получение инвентаря
 */
router.get('/inventory', async (req, res) => {
    try {
        const player = req.player;
        
        // Safe JSON parsing
        const inventory = safeJsonParse(player.inventory, []);
        const equipment = safeJsonParse(player.equipment, {});
        
        // Группируем по типам
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
        
        // Единый формат ответа
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
        
    } catch (error) {
        handleError(res, error, 'inventory_view');
    }
});

/**
 * Получение инвентаря (устаревшая версия)
 * @deprecated Используйте GET /inventory с единым форматом ответа
 */
router.get('/inventory-legacy', async (req, res) => {
    try {
        const player = req.player;
        
        const inventory = player.inventory || [];
        const equipment = player.equipment || {};
        
        // Группируем по типам
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
            inventory: inventory.map((item, index) => ({
                index: index,
                ...item
            })),
            equipment: equipment,
            items_by_type: itemsByType,
            total_items: inventory.length,
            max_inventory: player.max_inventory || 30
        });
        
    } catch (error) {
        console.error('Ошибка /inventory:', error);
        res.status(500).json({ error: 'Ошибка получения инвентаря' });
    }
});

module.exports = router;
