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
const { pool, query, queryOne, transaction: tx } = require('../../db/database');
const { DEBUFF_CURES } = require('../../utils/gameConstants');
const { logger, safeJsonParse, PlayerHelper: playerHelper, handleError } = require('../../utils/serverApi');

// handleError импортируется из utils/serverApi

/**
 * Safe JSON parsing с fallback
 * Теперь импортируется из utils/jsonHelper.js
 */
// safeJsonParse теперь импортируется

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
            
            // Валидация структуры предмета
            if (!item || typeof item !== 'object' || !item.id || !item.name) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Некорректная структура предмета',
                    code: 'INVALID_ITEM_STRUCTURE'
                });
            }
            
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
                
                if (item.type === 'medicine') {
                    const healthRestored = item.heal ?? 20;
                    await client.query(`
                        UPDATE players 
                        SET health = LEAST(max_health, health + $1),
                            inventory = $2
                        WHERE id = $3
                    `, [healthRestored, JSON.stringify(newInventory), playerId]);
                    
                    message = `Использовали ${item.name}. Здоровье +${healthRestored}`;
                    updated = true;
                    
                } else if (item.type === 'antirad') {
                    // Антирад - лечим радиацию через систему дебаффов
                    const radiationCure = item.stats?.radiation_cure || item.rad_removal || 2;
                    
                    // Используем данные из уже полученного player
                    let currentRadiation = { level: 0 };
                    if (player.radiation) {
                        if (typeof player.radiation === 'object') {
                            currentRadiation = player.radiation;
                        } else if (typeof player.radiation === 'number') {
                            currentRadiation = { level: player.radiation };
                        }
                    }
                    
                    const newLevel = Math.max(0, currentRadiation.level - radiationCure);
                    
                    // Пересчитываем время истечения пропорционально
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
                    
                } else if (item.type === 'bandage') {
                    // Перевязочные материалы - расходуются и восстанавливают здоровье
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
 * Путь: / (корень внутри роутера)
 */
router.get('/', async (req, res) => {
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
 * @deprecated Используйте GET /inventory
 * Путь: /legacy (внутри роутера)
 */
router.get('/legacy', async (req, res) => {
    try {
        const player = req.player;
        
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
        logger.error({ type: 'inventory_get_error', message: error.message });
        res.status(500).json({ error: 'Ошибка получения инвентаря' });
    }
});

module.exports = router;
