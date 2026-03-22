/**
 * Состояние игрока (здоровье, голод, радиация и т.д.)
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, transaction: tx } = require('../../db/database');
const { DEBUFF_CONFIG } = require('../../utils/gameConstants');
const { logger, safeJsonParse, handleError, logPlayerActionSimple } = require('../../utils/serverApi');
const { DebuffAPI } = require('./debuffs');
const { buildPlayerStatus, normalizeInventory } = require('../../utils/playerState');



/**
 * Универсальная функция получения статуса игрока
 * @param {object} player - Объект игрока из БД
 * @returns {object} Статус игрока
 */
function getPlayerStatus(player) {
    return {
        success: true,
        ...buildPlayerStatus(player)
    };
}

async function runStatusCheck(client, playerId) {
    const lockResult = await client.query(
        `SELECT health, fatigue, radiation, infections
         FROM players WHERE telegram_id = $1 FOR UPDATE`,
        [playerId]
    );

    if (!lockResult.rows.length) {
        throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }

    const p = lockResult.rows[0];

    let fatigueDamage = 0;
    if (p.fatigue >= 100) {
        fatigueDamage = 3;
    }

    let radDamage = 0;
    const radConfig = DEBUFF_CONFIG.radiation;
    
    // Обрабатываем оба формата хранения радиации (JSON и число)
    let radiationLevel = 0;
    const rawRadiation = p.radiation;
    
    if (typeof rawRadiation === 'object' && rawRadiation !== null) {
        radiationLevel = rawRadiation.level || 0;
    } else if (typeof rawRadiation === 'number') {
        radiationLevel = rawRadiation;
    } else if (typeof rawRadiation === 'string') {
        const parsed = safeJsonParse(rawRadiation, { level: 0 });
        radiationLevel = typeof parsed === 'object' ? (parsed.level || 0) : (parseInt(parsed) || 0);
    }
    
    if (radiationLevel >= 5) {
        radDamage = (radiationLevel - 4) * radConfig.damagePerLevel;
    }

    const infections = safeJsonParse(p.infections, []);
    const totalInfectionLevel = infections.reduce((sum, infection) => sum + (infection.level || 0), 0);
    const infConfig = DEBUFF_CONFIG.infection;
    const infectionDamage = totalInfectionLevel > 0 && Math.random() < 0.1
        ? totalInfectionLevel * infConfig.damagePerLevel
        : 0;

    const totalDamage = fatigueDamage + radDamage + infectionDamage;

    if (totalDamage > 0) {
        await client.query(
            `UPDATE players
             SET health = GREATEST(0, health - $1),
                 fatigue = GREATEST(0, fatigue - 20)
             WHERE id = $2`,
            [totalDamage, playerId]
        );
    }

    return {
        totalDamage,
        effects: {
            fatigue: fatigueDamage,
            radiation: radDamage,
            infections: infectionDamage
        }
    };
}



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
        const result = await tx(async (client) => runStatusCheck(client, playerId));
        
        // Логируем действие
        await logPlayerActionSimple(query, playerId, 'status_check', {
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

        if (type === 'debuff') {
            const result = await DebuffAPI.cure(playerId, 'antidote', item_id);
            return res.json({
                success: true,
                ...result,
                message: `Использован ${result.itemUsed}!`
            });
        }
        
        // Используем транзакцию с блокировкой строки
        const result = await tx(async (client) => {
            // Блокируем строку игрока
            const lockResult = await client.query(
                `SELECT inventory, health, max_health, radiation, infections
                 FROM players WHERE telegram_id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const p = lockResult.rows[0];
            const inventory = normalizeInventory(p.inventory);
            
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
                    await client.query(`
                        UPDATE players SET health = LEAST(max_health, health + $1) WHERE telegram_id = $2
                    `, [healAmount, playerId]);
                    message = 'Здоровье +' + healAmount;
                    healed = true;
                    
                } else if (type === 'radiation') {
                    healAmount = item.rad_removal || 30;
                    
                    // Получаем текущее значение радиации (может быть JSON или числом)
                    const currentRadiation = p.radiation;
                    let currentLevel = 0;
                    
                    if (typeof currentRadiation === 'object' && currentRadiation !== null) {
                        currentLevel = currentRadiation.level || 0;
                    } else if (typeof currentRadiation === 'number') {
                        currentLevel = currentRadiation;
                    }
                    
                    const newLevel = Math.max(0, currentLevel - healAmount);
                    
                    // Обновляем как JSON объект
                    await client.query(`
                        UPDATE players SET radiation = $1 WHERE telegram_id = $2
                    `, [JSON.stringify({ level: newLevel, expires_at: null, applied_at: null }), playerId]);
                    
                    message = 'Радиация -' + healAmount;
                    healed = true;
                }
                
                if (healed) {
                    // Удаляем использованный предмет
                    const newInventory = inventory.filter(i => i.id !== item_id);
                    await client.query(`
                        UPDATE players SET inventory = $1 WHERE telegram_id = $2
                    `, [JSON.stringify(newInventory), playerId]);
                    
                    // Логируем действие
                    await logPlayerActionSimple(client, playerId, 'status_heal', {
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
        
        const result = await tx(async (client) => runStatusCheck(client, playerId));

        await logPlayerActionSimple(query, playerId, 'status_check_api', {
            damage: result.totalDamage,
            effects: result.effects
        });

        return {
            success: true,
            checked: true,
            damage: result.totalDamage,
            effects: result.effects
        };
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

        if (type === 'debuff') {
            return await DebuffAPI.cure(playerId, 'antidote', itemId);
        }
        
        return await tx(async (client) => {
            const lockResult = await client.query(
                `SELECT inventory, health, max_health, radiation, infections
                 FROM players WHERE telegram_id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const p = lockResult.rows[0];
            const inventory = normalizeInventory(p.inventory);
            
            // Убраны типы hunger, thirst, broken, добавлен debuff
            const validTypes = ['health', 'radiation', 'debuff'];
            if (!validTypes.includes(type)) {
                throw { message: 'Неверный тип', code: 'INVALID_TYPE', statusCode: 400 };
            }
            
            const item = inventory.find((candidate) => candidate.id === itemId);
            if (!item) {
                throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_FOUND', statusCode: 404 };
            }

            if (type === 'health') {
                const healAmount = item.heal || 20;

                await client.query(
                    `UPDATE players SET health = LEAST(max_health, health + $1) WHERE telegram_id = $2`,
                    [healAmount, playerId]
                );

                const newInventory = inventory.filter((candidate) => candidate.id !== itemId);
                await client.query(
                    `UPDATE players SET inventory = $1 WHERE telegram_id = $2`,
                    [JSON.stringify(newInventory), playerId]
                );

                return { success: true, message: 'Здоровье +' + healAmount, item_used: item };
            }

            if (type === 'radiation') {
                const healAmount = item.rad_removal || 30;

                // Получаем текущее значение радиации (может быть JSON или числом)
                const currentRadiation = p.radiation;
                let currentLevel = 0;
                
                if (typeof currentRadiation === 'object' && currentRadiation !== null) {
                    currentLevel = currentRadiation.level || 0;
                } else if (typeof currentRadiation === 'number') {
                    currentLevel = currentRadiation;
                }
                
                const newLevel = Math.max(0, currentLevel - healAmount);
                
                // Обновляем как JSON объект
                await client.query(
                    `UPDATE players SET radiation = $1 WHERE telegram_id = $2`,
                    [JSON.stringify({ level: newLevel, expires_at: null, applied_at: null }), playerId]
                );

                const newInventory = inventory.filter((candidate) => candidate.id !== itemId);
                await client.query(
                    `UPDATE players SET inventory = $1 WHERE telegram_id = $2`,
                    [JSON.stringify(newInventory), playerId]
                );

                return { success: true, message: 'Радиация -' + healAmount, item_used: item };
            }

            throw { message: 'Неверный тип', code: 'INVALID_TYPE', statusCode: 400 };
        });
    }
};

module.exports = router;
module.exports.StatusAPI = StatusAPI;
