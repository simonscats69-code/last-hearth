/**
 * Энергия и покупки за Stars
 * @deprecated Используйте новые методы из namespace EnergyAPI
 */

const express = require('express');
const router = express.Router();
const { query, tx } = require('../../db/database');
const { logger } = require('../../utils/logger');

// =============================================================================
// Утилиты
// =============================================================================

/**
 * Централизованный обработчик ошибок
 */
function handleError(error, context, res, player = null) {
    const code = error.code || 'UNKNOWN_ERROR';
    const message = error.message || 'Внутренняя ошибка сервера';
    
    if (player) {
        logger.error(`[ENERGY:${context}] Ошибка игрока ${player.id}: ${message}`, {
            code,
            stack: error.stack
        });
    } else {
        logger.error(`[ENERGY:${context}] Ошибка: ${message}`, {
            code,
            stack: error.stack
        });
    }
    
    return res.status(error.statusCode || 500).json({
        success: false,
        error: message,
        code
    });
}

/**
 * Safe JSON parse с fallback
 */
function safeJsonParse(value, fallback = {}) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        console.error('JSON.parse failed:', typeof value, String(value).substring(0, 100));
        return fallback;
    }
}

/**
 * Логирование действия игрока в player_logs
 * @param {number} playerId - ID игрока
 * @param {string} action - Действие
 * @param {object} metadata - JSON метаданные
 */
async function logPlayerAction(playerId, action, metadata = {}) {
    try {
        await query(
            `INSERT INTO player_logs (player_id, action, metadata, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, JSON.stringify(metadata)]
        );
    } catch (err) {
        logger.warn(`Не удалось залогировать действие ${action} для игрока ${playerId}: ${err.message}`);
    }
}

/**
 * Покупка энергии за Stars
 * @deprecated Используйте EnergyAPI.buyEnergy()
 */
router.post('/buy-energy', async (req, res) => {
    try {
        // Валидация: amount должен быть числом от 1 до 100
        let amount = req.body.amount;
        if (amount !== undefined && amount !== null) {
            amount = parseInt(amount);
            if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
                return res.status(400).json({
                    success: false,
                    error: 'amount должен быть числом от 1 до 100',
                    code: 'INVALID_AMOUNT'
                });
            }
        } else {
            amount = 50; // Значение по умолчанию
        }
        
        const player = req.player;
        const playerId = player.id;
        
        // Стоимость: 1 Stars за 10 энергии
        const cost = Math.ceil(amount / 10);
        
        // Проверяем максимум энергии
        if (player.energy >= player.max_energy) {
            return res.status(400).json({
                success: false,
                message: 'Энергия уже полная',
                code: 'ENERGY_FULL'
            });
        }
        
        // Рассчитываем сколько энергии реально восстановится
        const actualAmount = Math.min(amount, player.max_energy - player.energy);
        const actualCost = Math.ceil(actualAmount / 10);
        
        // Используем tx helper с FOR UPDATE для блокировки
        const result = await tx(async () => {
            // Блокируем строку игрока
            const lockResult = await query(`
                SELECT energy, stars, max_energy 
                FROM players 
                WHERE id = $1 
                FOR UPDATE
            `, [playerId]);
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const current = lockResult.rows[0];
            
            // Проверяем хватает ли Stars
            if (current.stars < actualCost) {
                throw { message: 'Недостаточно Stars', code: 'NOT_ENOUGH_STARS', statusCode: 400 };
            }
            
            // Провяем не полная ли энергия
            if (current.energy >= current.max_energy) {
                throw { message: 'Энергия уже полная', code: 'ENERGY_FULL', statusCode: 400 };
            }
            
            // Обновляем
            const updateResult = await query(`
                UPDATE players 
                SET energy = LEAST(max_energy, energy + $1),
                    stars = GREATEST(0, stars - $2)
                WHERE id = $3
                RETURNING energy, stars, max_energy
            `, [actualAmount, actualCost, playerId]);
            
            // Логирование покупки энергии
            await logPlayerAction(playerId, 'buy_energy', {
                amount: actualAmount,
                stars_spent: actualCost,
                cost_per_unit: 0.1
            });
            
            return {
                energy: updateResult.rows[0].energy,
                max_energy: updateResult.rows[0].max_energy,
                stars_remaining: updateResult.rows[0].stars
            };
        });
        
        res.json({
            success: true,
            message: 'Энергия куплена!',
            energy: result.energy,
            max_energy: result.max_energy,
            energy_restored: actualAmount,
            stars_spent: actualCost,
            stars_remaining: result.stars_remaining
        });
        
    } catch (error) {
        if (error.code === 'NOT_ENOUGH_STARS') {
            return res.status(400).json({
                success: false,
                message: 'Недостаточно Stars',
                code: 'NOT_ENOUGH_STARS',
                required: Math.ceil((req.body.amount || 50) / 10),
                have: req.player.stars
            });
        }
        if (error.code === 'ENERGY_FULL') {
            return res.status(400).json({
                success: false,
                message: 'Энергия уже полная',
                code: 'ENERGY_FULL'
            });
        }
        handleError(error, 'BUY_ENERGY', res, req.player);
    }
});

// =============================================================================
// Namespace: EnergyAPI
// =============================================================================

const EnergyAPI = {
    /**
     * Покупка энергии за Stars
     * @param {number} playerId - ID игрока
     * @param {number} amount - Количество энергии (1-100)
     * @returns {Promise<object>} Результат покупки
     */
    async buyEnergy(playerId, amount = 50) {
        // Валидация
        if (!Number.isInteger(playerId) || playerId <= 0) {
            throw { message: 'Некорректный playerId', code: 'INVALID_PLAYER_ID', statusCode: 400 };
        }
        if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
            throw { message: 'amount должен быть от 1 до 100', code: 'INVALID_AMOUNT', statusCode: 400 };
        }
        
        const cost = Math.ceil(amount / 10);
        
        return await tx(async () => {
            const lockResult = await query(`
                SELECT energy, stars, max_energy 
                FROM players 
                WHERE id = $1 
                FOR UPDATE
            `, [playerId]);
            
            if (!lockResult.rows.length) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const current = lockResult.rows[0];
            
            if (current.stars < cost) {
                throw { message: 'Недостаточно Stars', code: 'NOT_ENOUGH_STARS', statusCode: 400 };
            }
            
            if (current.energy >= current.max_energy) {
                throw { message: 'Энергия уже полная', code: 'ENERGY_FULL', statusCode: 400 };
            }
            
            const actualAmount = Math.min(amount, current.max_energy - current.energy);
            const actualCost = Math.ceil(actualAmount / 10);
            
            const updateResult = await query(`
                UPDATE players 
                SET energy = LEAST(max_energy, energy + $1),
                    stars = GREATEST(0, stars - $2)
                WHERE id = $3
                RETURNING energy, stars, max_energy
            `, [actualAmount, actualCost, playerId]);
            
            await logPlayerAction(playerId, 'buy_energy_api', {
                amount: actualAmount,
                stars_spent: actualCost
            });
            
            return {
                success: true,
                energy: updateResult.rows[0].energy,
                max_energy: updateResult.rows[0].max_energy,
                energy_restored: actualAmount,
                stars_spent: actualCost,
                stars_remaining: updateResult.rows[0].stars
            };
        });
    }
};

module.exports = router;
module.exports.EnergyAPI = EnergyAPI;
