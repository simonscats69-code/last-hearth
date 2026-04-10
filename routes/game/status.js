/**
 * Состояние игрока (здоровье, голод, радиация и т.д.)
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, transaction: tx } = require('../../db/database');
const { DEBUFF_CONFIG, getDebuffTier } = require('../../utils/gameConstants');
const { logger, safeJsonParse, handleError, logPlayerActionSimple } = require('../../utils/serverApi');
const { DebuffAPI } = require('./debuffs');
const { buildPlayerStatus, normalizeInventory } = require('../../utils/game-helpers');



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
        `SELECT health, radiation, infections
         FROM players WHERE id = $1 FOR UPDATE`,
        [playerId]
    );

    if (!lockResult.rows.length) {
        throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }

    const p = lockResult.rows[0];

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

    const totalDamage = radDamage + infectionDamage;

    if (totalDamage > 0) {
        await client.query(
            `UPDATE players
             SET health = GREATEST(0, health - $1)
             WHERE id = $2`,
            [totalDamage, playerId]
        );
    }

    return {
        totalDamage,
        effects: {
            radiation: radDamage,
            infections: infectionDamage
        },
        states: {
            radiation: getDebuffTier(radiationLevel),
            infections: getDebuffTier(totalInfectionLevel),
            overall: getDebuffTier(Math.max(radiationLevel, totalInfectionLevel))
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
            states: result.states,
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
        const { type, item_id, item_index } = req.body;
        const player = req.player;
        const playerId = player.id;
        const normalizedItemIndex = item_index === undefined ? null : Number(item_index);
        
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
        if (item_index !== undefined && !Number.isInteger(normalizedItemIndex)) {
            return res.status(400).json({
                success: false,
                error: 'item_index должен быть целым числом',
                code: 'INVALID_ITEM_INDEX'
            });
        }

        if (type === 'debuff') {
            const result = await DebuffAPI.cure(playerId, 'antibiotic', item_id, normalizedItemIndex);
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
                 FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const p = lockResult.rows[0];
            const inventory = normalizeInventory(p.inventory);
            
            // Для типов, требующих item_id
            if (['health', 'radiation', 'debuff'].includes(type)) {
                if (item_id === undefined && item_index === undefined) {
                    throw { message: 'item_id или item_index обязателен для этого типа', code: 'MISSING_ITEM_ID', statusCode: 400 };
                }

                const resolvedItemIndex = Number.isInteger(normalizedItemIndex)
                    ? normalizedItemIndex
                    : inventory.findIndex(i => Number(i?.id) === Number(item_id));
                if (resolvedItemIndex < 0 || resolvedItemIndex >= inventory.length) {
                    throw { message: 'Предмет не найден в инвентаре', code: 'ITEM_NOT_FOUND', statusCode: 404 };
                }
                const item = inventory[resolvedItemIndex];
                const itemStats = safeJsonParse(item.stats, item.stats && typeof item.stats === 'object' ? item.stats : {}) || {};
                
                let healed = false;
                let message = '';
                let healAmount = 0;
                
                if (type === 'health') {
                    healAmount = Number(item.heal || itemStats.health || itemStats.health_restore || 0);
                    if (healAmount <= 0) {
                        throw { message: 'Этот предмет не восстанавливает здоровье', code: 'INVALID_ITEM_TYPE', statusCode: 400 };
                    }
                    await client.query(`
                        UPDATE players SET health = LEAST(max_health, health + $1) WHERE id = $2
                    `, [healAmount, playerId]);
                    message = 'Здоровье +' + healAmount;
                    healed = true;
                    
                } else if (type === 'radiation') {
                    healAmount = Number(item.rad_removal || itemStats.radiation_cure || 0);
                    if (healAmount <= 0) {
                        throw { message: 'Этот предмет не снижает радиацию', code: 'INVALID_ITEM_TYPE', statusCode: 400 };
                    }
                    
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
                        UPDATE players SET radiation = $1 WHERE id = $2
                    `, [JSON.stringify({ level: newLevel, expires_at: null, applied_at: null }), playerId]);
                    
                    message = 'Радиация -' + healAmount;
                    healed = true;
                }
                
                if (healed) {
                    // Удаляем использованный предмет
                    const newInventory = [...inventory];
                    newInventory.splice(resolvedItemIndex, 1);
                    await client.query(`
                        UPDATE players SET inventory = $1 WHERE id = $2
                    `, [JSON.stringify(newInventory), playerId]);
                    
                    // Логируем действие
                    await logPlayerActionSimple(client, playerId, 'status_heal', {
                        type,
                        item_id: item.id ?? item_id ?? null,
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
module.exports = router;
