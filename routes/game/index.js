/**
 * Главный файл игровых роутеров
 * Объединяет все модули game API
 */

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db/database');
const { logger } = require('../../utils/logger');

// Мидлвар для проверки игрока
async function authenticatePlayer(req, res, next) {
    const telegramId = req.headers['x-telegram-id'] || req.query.telegram_id;
    
    console.log('Auth attempt - x-telegram-id:', req.headers['x-telegram-id'], 'query:', req.query.telegram_id);
    
    if (!telegramId) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    try {
        const player = await queryOne(
            'SELECT * FROM players WHERE telegram_id = $1',
            [telegramId]
        );

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден. Начните игру через /start' });
        }

        req.player = player;
        next();
    } catch (error) {
        console.error('Ошибка авторизации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
}

router.use(authenticatePlayer);

// Подключаем все модули
const locationsRouter = require('./locations');
const inventoryRouter = require('./inventory');
const bossesRouter = require('./bosses');
const craftingRouter = require('./crafting');
const baseRouter = require('./base');
const clansRouter = require('./clans');
const pvpRouter = require('./pvp');
const statusRouter = require('./status');
const marketRouter = require('./market');
const energyRouter = require('./energy');
const referralRouter = require('./referral');
const seasonsRouter = require('./seasons');
const purchaseRouter = require('./purchase');
const itemsRouter = require('./items');
const profileRouter = require('./profile');
const debuffsRouter = require('./debuffs');

// Используем модули
router.use(locationsRouter);
router.use(inventoryRouter);
router.use(bossesRouter);
router.use(craftingRouter);
router.use(baseRouter);
router.use(clansRouter);
router.use(pvpRouter);
router.use(statusRouter);
router.use(marketRouter);
router.use(energyRouter);
router.use(referralRouter);
router.use(seasonsRouter);
router.use(purchaseRouter);
router.use(itemsRouter);
router.use(profileRouter);
router.use(debuffsRouter);

// Экспортируем для использования в других модулях
module.exports = router;
module.exports.authenticatePlayer = authenticatePlayer;
