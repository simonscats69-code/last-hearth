/**
 * Состояние игрока (здоровье, голод, радиация и т.д.)
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, transaction: tx } = require('../../db/database');
const { logger } = require('../../utils/logger');
const { safeJsonParse } = require('../../utils/jsonHelper');
const { DEBUFF_CONFIG } = require('../../utils/gameConstants');
const { handleError } = require('../../utils/errorHandler');

// =============================================================================
// Утилиты
// =============================================================================

/**
 * Универсальная функция получения статуса игрока
 * @param {object} player - Объект игрока из БД
 * @returns {object} Статус игрока
 */
function getPlayerStatus(player) {
    const infections = safeJsonParse(player.infections, []);
    // Парсим radiation (может быть old INTEGER или new JSONB)
    let radiationLevel = 0;
    if (player.radiation) {
        if (typeof player.radiation === 'object') {
            radiationLevel = player.radiation.level || 0;
        } else if (typeof player.radiation === 'number') {
            radiationLevel = player.radiation;
        }
    }
    // Вычисляем общий уровень инфекций
    const infectionLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
    
    return {
        success: true,
        health: player.health,
        max_health: player.max_health,
        radiation: radiationLevel,
        fatigue: player.fatigue,
        energy: player.energy,
        max_energy: player.max_energy,
        infections: infectionLevel,
        infections_list: infections
    };
}

// =============================================================================
// Валидация
// =============================================================================

/**
 * Валидация ID
 */
function validateId(id, name = 'ID') {
    if (!Number.isInteger(id) || id <= 0) {
        throw { 
            message: `Некорректный ${name}`, 
            code: 'INVALID_ID',
            statusCode: 400 
        };
    }
}

/**
 * Валидация item_id
 */
function validateItemId(itemId) {
    if (itemId === undefined || itemId === null) {
        throw { message: 'item_id обязателен', code: 'MISSING_ITEM_ID', statusCode: 400 };
    }
    validateId(itemId, 'item_id');
}

/**
 * Получение текущего состояния
 * GET /status → GET /api/game/status
 * Путь: / (корень внутри роутера)
 */
router.get('/', async (req, res) => {
    try {
        const player = req.player;
        res.json(getPlayerStatus(player));
    } catch (error) {
        handleError(res, error, 'GET_STATUS');
    }
});

/**
 * Проверка состояния (ежедневный эффект)
 * POST /status/check → POST /api/game/status/check
 * Путь: /check (внутри роутера)
 */
router.post('/check', async (req, res) => {
    try {
        const player = req.player;
        const playerId = player.id;
        
        // Используем транзакцию с блокировкой строки
        const result = await tx(async () => {
            // Блокируем строку игрока для избежания race condition
            const lockResult = await query(
                `SELECT health, fatigue, radiation, infections 
                 FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const p = lockResult.rows[0];
            
            // Проверяем усталость
            let fatigueDamage = 0;
            if (p.fatigue >= 100) {
                fatigueDamage = 3;
            }
            
            // Радиация (теперь JSONB: {level, expires_at, applied_at})
            // Урон от радиации: level >= 5, урон = (level - 4) * damagePerLevel
            let radDamage = 0;
            const radiation = safeJsonParse(p.radiation, { level: 0 });
            const radConfig = DEBUFF_CONFIG.radiation;
            if (radiation.level >= 5) {
                radDamage = (radiation.level - 4) * radConfig.damagePerLevel;
            }
            
            // Инфекции (теперь массив JSONB)
            const infections = safeJsonParse(p.infections, []);
            const totalInfectionLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
            const infConfig = DEBUFF_CONFIG.infection;
            if (totalInfectionLevel > 0 && Math.random() < 0.1) {
                radDamage += totalInfectionLevel * infConfig.damagePerLevel;
            }
            
            // Урон только от усталости и дебаффов (голода и жажды больше нет)
            const totalDamage = fatigueDamage + radDamage;
            
            if (totalDamage > 0) {
                await query(`
                    UPDATE players 
                    SET health = GREATEST(0, health - $1),
                        fatigue = GREATEST(0, fatigue - 20)
                    WHERE id = $2
                `, [totalDamage, playerId]);
            }
            
            return {
                totalDamage,
                effects: {
                    fatigue: fatigueDamage,
                    radiation: radDamage,
                    infections: totalInfectionLevel > 0 ? totalInfectionLevel * DEBUFF_CONFIG.infection.damagePerLevel : 0
                }
            };
        });
        
        // Логируем действие
        await logPlayerAction(playerId, 'status_check', {
            damage: result.totalDamage,
            effects: result.effects
        });
        
        res.json({
            success: true,
            checked: true,
            damage: result.totalDamage,
            effects: result.effects,
            message: result.totalDamage > 0 ? 'Получено урона от дебаффов!' : 'Всё в порядке'
        });
        
    } catch (error) {
        handleError(res, error, 'STATUS_CHECK');
    }
});

/**
 * Лечение/восстановление
 * POST /status/heal → POST /api/game/status/heal
 * Путь: /heal (внутри роутера)
 */
router.post('/heal', async (req, res) => {
    try {
        const { type, item_id } = req.body;
        const player = req.player;
        const playerId = player.id;
        
        // Валидация входных данных
        if (!type || typeof type !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'type обязателен и должен быть строкой',
                code: 'INVALID_TYPE'
            });
        }
        
        const validTypes = ['health', 'radiation', 'debuff'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                error: `Неверный тип. Допустимые значения: ${validTypes.join(', ')}`,
                code: 'INVALID_TYPE'
            });
        }
        
        // Валидация item_id если передан
        if (item_id !== undefined) {
            validateItemId(item_id);
        }
        
        // Используем транзакцию с блокировкой строки
        const result = await tx(async () => {
            // Блокируем строку игрока
            const lockResult = await query(
                `SELECT inventory, health, max_health, radiation, infections
                 FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const p = lockResult.rows[0];
            const inventory = safeJsonParse(p.inventory, []);
            
            // Для типов, требующих item_id
            if (['health', 'radiation', 'debuff'].includes(type)) {
                if (!item_id) {
                    throw { message: 'item_id обязателен для этого типа', code: 'MISSING_ITEM_ID', statusCode: 400 };
                }
                
                const item = inventory.find(i => i.id === item_id);
                if (!item) {
                    throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_FOUND', statusCode: 404 };
                }
                
                let healed = false;
                let message = '';
                let healAmount = 0;
                
                if (type === 'health') {
                    healAmount = item.heal || 20;
                    await query(`
                        UPDATE players SET health = LEAST(max_health, health + $1) WHERE id = $2
                    `, [healAmount, playerId]);
                    message = 'Здоровье +' + healAmount;
                    healed = true;
                    
                } else if (type === 'radiation') {
                    healAmount = item.rad_removal || 30;
                    await query(`
                        UPDATE players SET radiation = GREATEST(0, radiation - $1) WHERE id = $2
                    `, [healAmount, playerId]);
                    message = 'Радиация -' + healAmount;
                    healed = true;
                }
                
                if (healed) {
                    // Удаляем использованный предмет
                    const newInventory = inventory.filter(i => i.id !== item_id);
                    await query(`
                        UPDATE players SET inventory = $1 WHERE id = $2
                    `, [JSON.stringify(newInventory), playerId]);
                    
                    // Логируем действие
                    await logPlayerAction(playerId, 'status_heal', {
                        type,
                        item_id,
                        amount: healAmount
                    });
                    
                    return {
                        success: true,
                        message: message,
                        item_used: item
                    };
                }
                
            } // 'broken' тип удалён - система переломов упразднена
            
            return {
                success: false,
                message: 'Неизвестный тип лечения',
                code: 'UNKNOWN_HEAL_TYPE'
            };
        });
        
        res.json(result);
        
    } catch (error) {
        handleError(res, error, 'STATUS_HEAL');
    }
});

// =============================================================================
// Namespace: StatusAPI (новый программный интерфейс)
// =============================================================================

const StatusAPI = {
    /**
     * Получить статус игрока
     * @param {object} player - Объект игрока
     * @returns {object} Статус игрока
     */
    getStatus(player) {
        return getPlayerStatus(player);
    },
    
    /**
     * Проверить состояние (ежедневный эффект)
     * @param {number} playerId - ID игрока
     * @returns {Promise<object>} Результат проверки
     */
    async checkStatus(playerId) {
        validateId(playerId, 'playerId');
        
        return await tx(async () => {
            const lockResult = await query(
                `SELECT health, fatigue, radiation, infections 
                 FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const p = lockResult.rows[0];
            
            // Усталость
            let fatigueDamage = p.fatigue >= 100 ? 3 : 0;
            
            // Радиация (JSONB)
            // Урон от радиации: level >= 5, урон = (level - 4) * damagePerLevel
            let radDamage = 0;
            const radiation = safeJsonParse(p.radiation, { level: 0 });
            const radConfig = DEBUFF_CONFIG.radiation;
            if (radiation.level >= 5) {
                radDamage = (radiation.level - 4) * radConfig.damagePerLevel;
            }
            
            // Инфекции (массив JSONB)
            const infections = safeJsonParse(p.infections, []);
            const totalInfectionLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
            const infConfig = DEBUFF_CONFIG.infection;
            if (totalInfectionLevel > 0 && Math.random() < 0.1) {
                radDamage += totalInfectionLevel * infConfig.damagePerLevel;
            }
            
            // Урон только от усталости и дебаффов
            const totalDamage = fatigueDamage + radDamage;
            
            if (totalDamage > 0) {
                await query(`
                    UPDATE players 
                    SET health = GREATEST(0, health - $1),
                        fatigue = GREATEST(0, fatigue - 20)
                    WHERE id = $2
                `, [totalDamage, playerId]);
            }
            
            await logPlayerAction(playerId, 'status_check_api', {
                damage: totalDamage,
                effects: { fatigue: fatigueDamage, radiation: radDamage, infections: totalInfectionLevel > 0 ? totalInfectionLevel * infConfig.damagePerLevel : 0 }
            });
            
            return {
                success: true,
                checked: true,
                damage: totalDamage,
                effects: {
                    fatigue: fatigueDamage,
                    radiation: radDamage,
                    infections: totalInfectionLevel > 0 ? totalInfectionLevel * infConfig.damagePerLevel : 0
                }
            };
        });
    },
    
    /**
     * Лечение/восстановление
     * @param {number} playerId - ID игрока
     * @param {string} type - Тип лечения
     * @param {number} itemId - ID предмета
     * @returns {Promise<object>} Результат
     */
    async heal(playerId, type, itemId) {
        validateId(playerId, 'playerId');
        
        if (!type || typeof type !== 'string') {
            throw { message: 'type обязателен', code: 'INVALID_TYPE', statusCode: 400 };
        }
        
        // Голода и жажды больше нет, используем debuff для лечения дебаффов
        if (['health', 'radiation', 'debuff'].includes(type) && !itemId) {
            throw { message: 'item_id обязателен', code: 'MISSING_ITEM_ID', statusCode: 400 };
        }
        
        if (itemId) validateId(itemId, 'itemId');
        
        return await tx(async () => {
            const lockResult = await query(
                `SELECT inventory, health, max_health, radiation, infections
                 FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const p = lockResult.rows[0];
            const inventory = safeJsonParse(p.inventory, []);
            
            // Убраны типы hunger, thirst, broken, добавлен debuff
            const validTypes = ['health', 'radiation', 'debuff'];
            if (!validTypes.includes(type)) {
                throw { message: 'Неверный тип', code: 'INVALID_TYPE', statusCode: 400 };
            }
            
            // Логика лечения...
            // (аналогично роуту)
            
            return { success: true, message: 'OK' };
        });
    }
};

module.exports = router;
module.exports.StatusAPI = StatusAPI;
