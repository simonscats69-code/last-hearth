/**
 * Состояние игрока (здоровье, голод, радиация и т.д.)
 */

const express = require('express');
const router = express.Router();
const { transaction } = require('../../db/database');
const { DEBUFF_CONFIG, getDebuffTier } = require('../../utils/gameConstants');
// Порог урона от заражения — единое место правды (раньше «5» было вписано
// и здесь, и в debuffs.js).
const CONTAMINATION_DAMAGE_FROM_LEVEL = require('../../public/shared/equipment.js').CONTAMINATION_DAMAGE_FROM_LEVEL;
const { safeJsonParse, handleError, logPlayerAction } = require('../../utils/serverApi');
const { validateId } = require('../../utils/validate');
const { DebuffAPI } = require('./debuffs');

// Ленивая загрузка helpers: utils/game-helpers.js — единственный источник
// функций состояния игрока. Он тянет db/database, поэтому импорт ленивый
// (иначе цикл загрузки модулей). Общий загрузчик — utils/getGameHelpers.js.
const { getGameHelpers } = require('../../utils/getGameHelpers');

// Экспортируемые функции через getGameHelpers()
const helpers = getGameHelpers();
const { buildPlayerStatus, normalizeInventory, consumeInventoryItem } = helpers;



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
        `SELECT health, radiation
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
    
    // Порог урона — из общего файла правил, одно место на весь проект.
    if (radiationLevel >= CONTAMINATION_DAMAGE_FROM_LEVEL) {
        radDamage = (radiationLevel - (CONTAMINATION_DAMAGE_FROM_LEVEL - 1)) * radConfig.damagePerLevel;
    }

    // Инфекции объединены с радиацией: урон один, отдельного слагаемого
    // от players.infections больше нет. Прежняя строка второго урона
    // (10% шанс × уровень × 2) удалена вместе с ним.

    const totalDamage = radDamage;

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
            radiation: radDamage
        },
        states: {
            radiation: getDebuffTier(radiationLevel),
            overall: getDebuffTier(radiationLevel)
        }
    };
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
        const result = await transaction(async (client) => runStatusCheck(client, playerId));
        
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
            if (item_id === null || item_id === '') {
                return res.status(400).json({
                    success: false,
                    error: 'Требуется item_id',
                    code: 'MISSING_ITEM_ID'
                });
            }
            const itemIdCheck = validateId(item_id, 'item_id');
            if (!itemIdCheck.ok) {
                return res.status(400).json({
                    success: false,
                    error: itemIdCheck.error,
                    code: itemIdCheck.code
                });
            }
        }
        if (item_index !== undefined && !Number.isInteger(normalizedItemIndex)) {
            return res.status(400).json({
                success: false,
                error: 'item_index должен быть целым числом',
                code: 'INVALID_ITEM_INDEX'
            });
        }

        if (type === 'debuff') {
            const result = await DebuffAPI.cure(playerId, 'auto', item_id, normalizedItemIndex);
            return res.json({
                success: true,
                ...result,
                message: `Использован ${result.itemUsed}!`
            });
        }
        
        // Используем транзакцию с блокировкой строки
        const result = await transaction(async (client) => {
            // Блокируем строку игрока.
            // infections из SELECT убран: инфекции объединены с радиацией,
            // теперь все лечится одним типом 'radiation'.
            const lockResult = await client.query(
                `SELECT inventory, health, max_health, radiation
                 FROM players WHERE id = $1 FOR UPDATE`,
                [playerId]
            );
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const p = lockResult.rows[0];
            const inventory = normalizeInventory(p.inventory);
            
            // Для типов, требующих item_id.
            // Инфекционный тип ('infection') больше не принимается: зона лечится
            // тем же 'radiation', антидот работает как антирад.
            if (['health', 'radiation'].includes(type)) {
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
                    // Один тип лечения зоны: радиация и инфекция объединены,
                    // поэтому антирад, антидот и спирт читаются одинаково —
                    // по radiation_cure, rad_removal или infection_cure.
                    healAmount = Number(
                        item.rad_removal || itemStats.radiation_cure
                        || item.infection_cure || itemStats.infection_cure || 0
                    );
                    if (healAmount <= 0) {
                        throw { message: 'Этот предмет не снижает заражение', code: 'INVALID_ITEM_TYPE', statusCode: 400 };
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
                    
                    // Обновляем ТОЛЬКО level, сохраняя expires_at/applied_at (jsonb_set)
                    await client.query(`
                        UPDATE players SET radiation = jsonb_set(
                            COALESCE(radiation, '{"level":0}'::jsonb),
                            '{level}',
                            to_jsonb($1)
                        ) WHERE id = $2
                    `, [newLevel, playerId]);
                    
                    message = 'Радиация -' + healAmount;
                    healed = true;
                }
                
if (healed) {
                     // Расходуем ОДНУ штуку, а не весь стек.
                     const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, resolvedItemIndex);

                     await client.query(
                         `UPDATE players SET inventory = $1 WHERE id = $2`,
                         [JSON.stringify(updatedInventory), playerId]
                     );

                     return {
                         success: true,
                         message: message,
                         item_used: item,
                         quantity_left: quantityLeft,
                         log: {
                             action: 'status_heal',
                             playerId,
                             data: {
                                 type,
                                 item_id: item.id ?? item_id ?? null,
                                 amount: healAmount
                             }
                         }
                     };
                 }
                
            } // 'broken' тип удалён - система переломов упразднена
            
            return {
                success: false,
                message: 'Неизвестный тип лечения',
                code: 'UNKNOWN_HEAL_TYPE'
            };
        });
        
        // Логируем ПОСЛЕ коммита транзакции
        if (result.log) {
            await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
        }
        
        res.json(result);
        
    } catch (error) {
        handleError(res, error, 'STATUS_HEAL');
    }
});
module.exports = router;
