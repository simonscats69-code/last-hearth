/**
 * Улучшение и модификация предметов
 * @module game/items
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
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
 * Валидация индекса предмета
 * @param {any} value 
 * @param {number} maxLength 
 * @returns {boolean}
 */
function isValidIndex(value, maxLength) {
    return Number.isInteger(value) && value >= 0 && value < maxLength;
}

/**
 * Валидация булевого значения
 * @param {any} value 
 * @returns {boolean}
 */
function isValidBoolean(value) {
    return typeof value === 'boolean';
}

/**
 * Улучшение предмета
 */
router.post('/upgrade-item', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Начинаем транзакцию
        
        const { item_index, use_protection = false } = req.body;
        const player = req.player;
        
        // Валидация входных данных
        if (!isValidIndex(item_index, player.inventory?.length || 0)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректный индекс предмета', 'INVALID_ITEM_INDEX');
        }
        
        if (!isValidBoolean(use_protection)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Параметр use_protection должен быть boolean', 'INVALID_PARAMETER');
        }
        
        // Блокируем игрока для обновления
        const playerResult = await client.query(`
            SELECT id, coins, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [player.id]);
        
        const playerData = playerResult.rows[0];
        const inventory = serializeJSONField(playerData.inventory) || [];
        
        if (item_index < 0 || item_index >= inventory.length) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Неверный индекс предмета', 'INVALID_INDEX');
        }
        
        const item = inventory[item_index];
        
        // Проверяем, что предмет можно улучшать
        if (!item.damage && !item.defense) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Этот предмет нельзя улучшить', 'ITEM_NOT_UPGRADEABLE');
        }
        
        const currentLevel = item.upgrade_level || 0;
        const maxLevel = 10;
        
        if (currentLevel >= maxLevel) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Максимальный уровень улучшения достигнут', 'MAX_LEVEL_REACHED');
        }
        
        // Стоимость улучшения
        const upgradeCost = (currentLevel + 1) * 50;
        
        const coins = parseInt(playerData.coins) || 0;
        
        if (coins < upgradeCost) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Недостаточно монет', 'INSUFFICIENT_COINS', 400, {
                required: upgradeCost,
                have: coins
            });
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
            await client.query(`
                UPDATE players 
                SET inventory = $1, coins = coins - $2
                WHERE id = $3
            `, [inventory, upgradeCost, player.id]);
            
        } else {
            // Неудача
            if (use_protection) {
                // Защита сработала - предмет не сломался
                await client.query(`
                    UPDATE players SET coins = coins - $1 WHERE id = $2
                `, [upgradeCost, player.id]);
                
            } else {
                // Предмет сломался
                itemBroken = true;
                inventory.splice(item_index, 1);
                
                await client.query(`
                    UPDATE players 
                    SET inventory = $1, coins = coins - $2
                    WHERE id = $3
                `, [inventory, upgradeCost, player.id]);
            }
        }
        
        await client.query('COMMIT');
        
        // Логируем действие (вне транзакции)
        try {
            await logPlayerAction(player.id, 'item_upgrade', {
                item_index: item_index,
                item_type: item?.type,
                success: upgradeSuccess,
                item_broken: itemBroken,
                new_level: item?.upgrade_level,
                success_chance: successChance,
                rolled: rolled.toFixed(2),
                use_protection: use_protection
            });
        } catch (logErr) {
            handleError(logErr, 'logPlayerAction - upgrade-item');
        }
        
        if (upgradeSuccess) {
            successResponse(res, {
                message: 'Улучшение успешно!',
                item: item,
                new_level: item.upgrade_level,
                success_chance: successChance,
                rolled: rolled.toFixed(2)
            });
        } else if (use_protection) {
            successResponse(res, {
                message: 'Улучшение не удалось, но защита сработала!',
                item_protected: true,
                success_chance: successChance,
                rolled: rolled.toFixed(2)
            });
        } else {
            successResponse(res, {
                message: 'Улучшение не удалось! Предмет сломан.',
                item_broken: true,
                success_chance: successChance,
                rolled: rolled.toFixed(2)
            });
        }
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        handleError(error, '/upgrade-item');
        errorResponse(res, 'Ошибка улучшения', 'UPGRADE_ERROR', 500);
    } finally {
        client.release();
    }
});

/**
 * Модификация предмета (заточка, укрепление)
 */
router.post('/modify-item', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Начинаем транзакцию
        
        const { item_index, modification_type } = req.body;
        const player = req.player;
        
        // Валидация входных данных
        if (!isValidIndex(item_index, player.inventory?.length || 0)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите корректный индекс предмета', 'INVALID_ITEM_INDEX');
        }
        
        if (!modification_type || typeof modification_type !== 'string') {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укажите тип модификации', 'INVALID_MODIFICATION_TYPE');
        }
        
        const validTypes = ['sharpening', 'reinforcement'];
        if (!validTypes.includes(modification_type)) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Неверный тип модификации', 'INVALID_TYPE');
        }
        
        // Блокируем игрока для обновления
        const playerResult = await client.query(`
            SELECT id, coins, inventory FROM players WHERE id = $1 FOR UPDATE
        `, [player.id]);
        
        const playerData = playerResult.rows[0];
        const inventory = serializeJSONField(playerData.inventory) || [];
        
        if (item_index < 0 || item_index >= inventory.length) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Неверный индекс предмета', 'INVALID_INDEX');
        }
        
        const item = inventory[item_index];
        
        // Инициализируем модификации
        if (!item.modifications) {
            item.modifications = {};
        }
        
        const currentMod = item.modifications[modification_type] || 0;
        
        if (currentMod >= 5) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Максимальный уровень модификации', 'MAX_MODIFICATION_LEVEL');
        }
        
        // Проверяем соответствие типа модификации типу предмета
        if (modification_type === 'sharpening' && !item.damage) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Заточка только для оружия', 'INVALID_ITEM_TYPE');
        }
        
        if (modification_type === 'reinforcement' && !item.defense) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Укрепление только для брони', 'INVALID_ITEM_TYPE');
        }
        
        // Стоимость
        const modCost = (currentMod + 1) * 30;
        
        const coins = parseInt(playerData.coins) || 0;
        
        if (coins < modCost) {
            await client.query('ROLLBACK');
            return errorResponse(res, 'Недостаточно монет', 'INSUFFICIENT_COINS', 400, {
                required: modCost,
                have: coins
            });
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
            
            await client.query(`
                UPDATE players 
                SET inventory = $1, coins = coins - $2
                WHERE id = $3
            `, [inventory, modCost, player.id]);
            
            await client.query('COMMIT');
            
            // Логируем действие (вне транзакции)
            try {
                await logPlayerAction(player.id, 'item_modification', {
                    item_index: item_index,
                    item_type: item?.type,
                    modification_type: modification_type,
                    success: true,
                    new_level: currentMod + 1,
                    success_chance: successChance,
                    rolled: rolled.toFixed(2)
                });
            } catch (logErr) {
                handleError(logErr, 'logPlayerAction - modify-item');
            }
            
            successResponse(res, {
                message: 'Модификация применена!',
                item: item,
                modification: modification_type,
                new_level: currentMod + 1,
                success_chance: successChance,
                rolled: rolled.toFixed(2)
            });
            
        } else {
            // Неудача
            await client.query(`
                UPDATE players SET coins = coins - $1 WHERE id = $2
            `, [modCost, player.id]);
            
            await client.query('COMMIT');
            
            // Логируем действие (вне транзакции)
            try {
                await logPlayerAction(player.id, 'item_modification', {
                    item_index: item_index,
                    item_type: item?.type,
                    modification_type: modification_type,
                    success: false,
                    current_level: currentMod,
                    success_chance: successChance,
                    rolled: rolled.toFixed(2)
                });
            } catch (logErr) {
                handleError(logErr, 'logPlayerAction - modify-item');
            }
            
            successResponse(res, {
                message: 'Модификация не удалась!',
                success: false,
                success_chance: successChance,
                rolled: rolled.toFixed(2)
            });
        }
        
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        handleError(error, '/modify-item');
        errorResponse(res, 'Ошибка модификации', 'MODIFICATION_ERROR', 500);
    } finally {
        client.release();
    }
});

/**
 * Получение списка предметов (справочник)
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
        
        successResponse(res, {
            items: items,
            pagination: {
                limit,
                offset,
                total,
                hasMore: offset + items.length < total
            }
        });
        
    } catch (error) {
        handleError(error, '/items');
        errorResponse(res, 'Ошибка получения предметов', 'ITEMS_ERROR', 500);
    }
});

/**
 * @deprecated Используйте /upgrade-item с транзакциями
 */
router.post('/upgrade-item-old', async (req, res) => {
    try {
        const { item_index, use_protection = false } = req.body;
        const player = req.player;
        
        if (item_index === undefined) {
            return res.status(400).json({ error: 'Укажите индекс предмета' });
        }
        
        const inventory = player.inventory || [];
        
        if (item_index < 0 || item_index >= inventory.length) {
            return res.status(400).json({ error: 'Неверный индекс предмета' });
        }
        
        const item = inventory[item_index];
        
        // Проверяем, что предмет можно улучшать
        if (!item.damage && !item.defense) {
            return res.json({
                success: false,
                message: 'Этот предмет нельзя улучшить'
            });
        }
        
        const currentLevel = item.upgrade_level || 0;
        const maxLevel = 10;
        
        if (currentLevel >= maxLevel) {
            return res.json({
                success: false,
                message: 'Максимальный уровень улучшения достигнут'
            });
        }
        
        // Стоимость улучшения
        const upgradeCost = (currentLevel + 1) * 50;
        
        if (player.coins < upgradeCost) {
            return res.json({
                success: false,
                message: 'Недостаточно монет',
                required: upgradeCost,
                have: player.coins
            });
        }
        
        // Шанс успеха (уменьшается с каждым уровнем)
        let successChance = 100 - (currentLevel * 8);
        if (use_protection) {
            successChance += 20;
        }
        
        const rolled = Math.random() * 100;
        
        if (rolled <= successChance) {
            // Успех!
            item.upgrade_level = currentLevel + 1;
            
            // Увеличиваем статы
            if (item.damage) {
                item.damage = Math.floor(item.damage * 1.2);
            }
            if (item.defense) {
                item.defense = Math.floor(item.defense * 1.2);
            }
            
            await query(`
                UPDATE players 
                SET inventory = $1, coins = coins - $2
                WHERE id = $3
            `, [inventory, upgradeCost, player.id]);
            
            res.json({
                success: true,
                message: 'Улучшение успешно!',
                item: item,
                new_level: item.upgrade_level,
                success_chance: successChance,
                rolled: rolled.toFixed(2)
            });
            
        } else {
            // Неудача
            if (use_protection) {
                // Защита сработала - предмет не сломался
                await query(`
                    UPDATE players SET coins = coins - $1 WHERE id = $2
                `, [upgradeCost, player.id]);
                
                res.json({
                    success: false,
                    message: 'Улучшение не удалось, но защита сработала!',
                    item_protected: true,
                    success_chance: successChance,
                    rolled: rolled.toFixed(2)
                });
                
            } else {
                // Предмет сломался
                inventory.splice(item_index, 1);
                
                await query(`
                    UPDATE players 
                    SET inventory = $1, coins = coins - $2
                    WHERE id = $3
                `, [inventory, upgradeCost, player.id]);
                
                res.json({
                    success: false,
                    message: 'Улучшение не удалось! Предмет сломан.',
                    item_broken: true,
                    success_chance: successChance,
                    rolled: rolled.toFixed(2)
                });
            }
        }
        
    } catch (error) {
        console.error('Ошибка /upgrade-item:', error);
        res.status(500).json({ error: 'Ошибка улучшения' });
    }
});

module.exports = router;
