/**
 * Энергия и покупки за Stars
 * @deprecated Используйте новые методы из namespace EnergyAPI
 */

const express = require('express');
const router = express.Router();
const { query, transaction: tx } = require('../../db/database');
const { logger, safeJsonParse, logPlayerActionSimple } = require('../../utils/serverApi');



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
 * Теперь импортируется из utils/jsonHelper.js
 */
// safeJsonParse теперь импортируется

async function performBuyEnergy(client, playerId, amount) {
    const lockResult = await client.query(
        `SELECT energy, stars, max_energy
         FROM players
         WHERE id = $1
         FOR UPDATE`,
        [playerId]
    );

    if (!lockResult.rows.length) {
        throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }

    const current = lockResult.rows[0];

    if (current.energy >= current.max_energy) {
        throw { message: 'Энергия уже полная', code: 'ENERGY_FULL', statusCode: 400 };
    }

    const actualAmount = Math.min(amount, current.max_energy - current.energy);
    const actualCost = Math.ceil(actualAmount / 10);

    if (current.stars < actualCost) {
        throw { message: 'Недостаточно Stars', code: 'NOT_ENOUGH_STARS', statusCode: 400 };
    }

    const updateResult = await client.query(
        `UPDATE players
         SET energy = LEAST(max_energy, energy + $1),
             stars = GREATEST(0, stars - $2),
             last_energy_update = NOW()
         WHERE id = $3
         RETURNING energy, stars, max_energy, last_energy_update`,
        [actualAmount, actualCost, playerId]
    );

    await logPlayerActionSimple(client, playerId, 'buy_energy', {
        amount: actualAmount,
        stars_spent: actualCost,
        cost_per_unit: 0.1
    }, client);

    return {
        success: true,
        energy: updateResult.rows[0].energy,
        max_energy: updateResult.rows[0].max_energy,
        energy_restored: actualAmount,
        stars_spent: actualCost,
        stars_remaining: updateResult.rows[0].stars,
        last_energy_update: updateResult.rows[0].last_energy_update
    };
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
        // Проверяем максимум энергии
        if (player.energy >= player.max_energy) {
            return res.status(400).json({
                success: false,
                message: 'Энергия уже полная',
                code: 'ENERGY_FULL'
            });
        }
        
        const result = await tx(async (client) => performBuyEnergy(client, playerId, amount));
        
        res.json({
            message: 'Энергия куплена!',
            ...result
        });
        
    } catch (error) {
        if (error.code === 'NOT_ENOUGH_STARS') {
            return res.status(400).json({
                success: false,
                message: 'Недостаточно Stars',
                code: 'NOT_ENOUGH_STARS',
                required: Math.ceil((Number(req.body.amount || 50)) / 10)
                // Примечание: have убран, т.к. данные могут быть устаревшими после транзакции
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
        
        return await tx(async (client) => {
            const result = await performBuyEnergy(client, playerId, amount);
            await logPlayerActionSimple(query, playerId, 'buy_energy_api', {
                amount: result.energy_restored,
                stars_spent: result.stars_spent
            }, client);
            return result;
        });
    }
};

module.exports = router;
module.exports.EnergyAPI = EnergyAPI;
