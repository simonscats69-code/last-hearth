/**
 * Колесо удачи - серверная часть
 */

const express = require('express');
const router = express.Router();
const { pool, query } = require('../../db/database');
const { logger, handleError } = require('../../utils/serverApi');

/**
 * Призы колеса удачи (должны совпадать с клиентом)
 */
const WHEEL_PRIZES = [
    { type: 'coins', value: 10, text: '10 монет', weight: 20 },
    { type: 'coins', value: 25, text: '25 монет', weight: 15 },
    { type: 'coins', value: 50, text: '50 монет', weight: 10 },
    { type: 'coins', value: 100, text: '100 монет', weight: 5 },
    { type: 'multiplier', value: 2, text: 'x2 к монетам', weight: 3 },
    { type: 'energy', value: 20, text: '20 энергии', weight: 12 },
];

// Время между бесплатными вращениями (24 часа)
const FREE_SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Выбор приза на сервере (с весами)
 */
function selectPrize() {
    const totalWeight = WHEEL_PRIZES.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const prize of WHEEL_PRIZES) {
        random -= prize.weight;
        if (random <= 0) {
            return prize;
        }
    }
    return WHEEL_PRIZES[0];
}

/**
 * GET /wheel - получить информацию о колесе
 */
router.get('/', async (req, res) => {
    const playerId = req.player?.id;
    
    if (!playerId) {
        return res.status(401).json({ success: false, error: 'Не авторизован' });
    }
    
    try {
        // Получаем время последнего вращения
        const result = await query(
            'SELECT last_wheel_spin FROM players WHERE telegram_id = $1',
            [playerId]
        );
        
        const lastSpin = result.rows[0]?.last_wheel_spin;
        const now = Date.now();
        
        // Проверяем, можно ли крутить бесплатно
        let canSpinFree = false;
        if (!lastSpin) {
            canSpinFree = true;
        } else {
            const timeSinceLastSpin = now - new Date(lastSpin).getTime();
            canSpinFree = timeSinceLastSpin >= FREE_SPIN_COOLDOWN_MS;
        }
        
        // Время до следующего бесплатного вращения
        let nextFreeSpin = null;
        if (!canSpinFree && lastSpin) {
            const nextSpinTime = new Date(lastSpin).getTime() + FREE_SPIN_COOLDOWN_MS;
            nextFreeSpin = Math.max(0, nextSpinTime - now);
        }
        
        res.json({
            success: true,
            data: {
                can_spin_free: canSpinFree,
                next_free_spin: nextFreeSpin,
                prizes: WHEEL_PRIZES.map(p => ({ type: p.type, value: p.value, text: p.text }))
            }
        });
    } catch (error) {
        return handleError(res, error, 'wheel_info');
    }
});

/**
 * POST /wheel/spin - крутить колесо
 */
router.post('/spin', async (req, res) => {
    const playerId = req.player?.id;
    // Валидация: преобразуем к boolean
    const is_paid = req.body?.is_paid === true || req.body?.is_paid === 'true';
    
    if (!playerId) {
        return res.status(401).json({ success: false, error: 'Не авторизован' });
    }
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Получаем игрока
        const playerResult = await client.query(
            'SELECT coins, stars, energy, max_energy, last_wheel_spin FROM players WHERE telegram_id = $1 FOR UPDATE',
            [playerId]
        );
        
        const player = playerResult.rows[0];
        
        if (!player) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Игрок не найден' });
        }
        
        // Проверяем возможность вращения
        const now = Date.now();
        const lastSpin = player.last_wheel_spin;
        
        let canSpinFree = false;
        if (!lastSpin) {
            canSpinFree = true;
        } else {
            const timeSinceLastSpin = now - new Date(lastSpin).getTime();
            canSpinFree = timeSinceLastSpin >= FREE_SPIN_COOLDOWN_MS;
        }
        
        // Проверка платного вращения
        if (is_paid) {
            if ((player.stars || 0) < 1) {
                await client.query('ROLLBACK');
                return res.json({ success: false, error: 'Недостаточно Stars', code: 'NO_STARS' });
            }
            // Списываем Stars
            await client.query(
                'UPDATE players SET stars = stars - 1 WHERE telegram_id = $1',
                [playerId]
            );
        } else {
            // Бесплатное вращение
            if (!canSpinFree) {
                const nextSpinTime = new Date(lastSpin).getTime() + FREE_SPIN_COOLDOWN_MS;
                const timeLeft = Math.ceil((nextSpinTime - now) / 1000 / 60);
                await client.query('ROLLBACK');
                return res.json({ 
                    success: false, 
                    error: `Следующее бесплатное вращение через ${timeLeft} мин.`,
                    code: 'COOLDOWN',
                    next_free_spin: nextSpinTime - now
                });
            }
        }
        
        // Выбираем приз на сервере
        const prize = selectPrize();
        
        // Применяем приз
        if (prize.type === 'coins') {
            await client.query(
                'UPDATE players SET coins = coins + $1, last_wheel_spin = NOW() WHERE telegram_id = $2',
                [prize.value, playerId]
            );
        } else if (prize.type === 'energy') {
            const newEnergy = Math.min(player.max_energy || 100, (player.energy || 0) + prize.value);
            await client.query(
                'UPDATE players SET energy = $1, last_wheel_spin = NOW() WHERE telegram_id = $2',
                [newEnergy, playerId]
            );
        } else if (prize.type === 'multiplier') {
            // Умножаем монеты (от текущего значения)
            const newCoins = Math.floor((player.coins || 0) * prize.value);
            const bonus = newCoins - (player.coins || 0);
            if (bonus > 0) {
                await client.query(
                    'UPDATE players SET coins = coins + $1, last_wheel_spin = NOW() WHERE telegram_id = $2',
                    [bonus, playerId]
                );
            } else {
                await client.query(
                    'UPDATE players SET last_wheel_spin = NOW() WHERE telegram_id = $1',
                    [playerId]
                );
            }
        }
        
        await client.query('COMMIT');
        
        logger.info({ playerId, prize: prize.type, value: prize.value, is_paid }, 'wheel_spin');
        
        res.json({
            success: true,
            data: {
                prize: prize,
                is_paid: is_paid || false
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        return handleError(res, error, 'wheel_spin');
    } finally {
        client.release();
    }
});

module.exports = router;
