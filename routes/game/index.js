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

// Функция для безопасной загрузки модулей с логированием
function safeRequire(path) {
    try {
        const mod = require(path);
        console.log(`[OK] Загружен роутер: ${path}`);
        return mod;
    } catch(e) {
        console.error(`[FATAL] Не удалось загрузить роутер: ${path}`, e.message);
        return null;
    }
}

// Подключаем все модули
const locationsRouter = safeRequire('./locations');
const inventoryRouter = safeRequire('./inventory');
const bossesRouter = safeRequire('./bosses');
const craftingRouter = safeRequire('./crafting');
const baseRouter = safeRequire('./base');
const clansRouter = safeRequire('./clans');
const pvpRouter = safeRequire('./pvp');
const statusRouter = safeRequire('./status');
const marketRouter = safeRequire('./market');
const energyRouter = safeRequire('./energy');
const referralRouter = safeRequire('./referral');
const seasonsRouter = safeRequire('./seasons');
const purchaseRouter = safeRequire('./purchase');
const itemsRouter = safeRequire('./items');
const profileRouter = safeRequire('./profile');
const debuffsModule = require('./debuffs');
const debuffsRouter = debuffsModule.router || debuffsModule;

// Используем модули с проверкой
if (locationsRouter) router.use(locationsRouter);
else console.error('[FATAL] locationsRouter = null');
if (inventoryRouter) router.use(inventoryRouter);
else console.error('[FATAL] inventoryRouter = null');
if (bossesRouter) router.use(bossesRouter);
else console.error('[FATAL] bossesRouter = null');
if (craftingRouter) router.use(craftingRouter);
else console.error('[FATAL] craftingRouter = null');
if (baseRouter) router.use(baseRouter);
else console.error('[FATAL] baseRouter = null');
if (clansRouter) router.use(clansRouter);
else console.error('[FATAL] clansRouter = null');
if (pvpRouter) router.use(pvpRouter);
else console.error('[FATAL] pvpRouter = null');
if (statusRouter) router.use(statusRouter);
else console.error('[FATAL] statusRouter = null');
if (marketRouter) router.use(marketRouter);
else console.error('[FATAL] marketRouter = null');
if (energyRouter) router.use(energyRouter);
else console.error('[FATAL] energyRouter = null');
if (referralRouter) router.use(referralRouter);
else console.error('[FATAL] referralRouter = null');
if (seasonsRouter) router.use(seasonsRouter);
else console.error('[FATAL] seasonsRouter = null');
if (purchaseRouter) router.use(purchaseRouter);
else console.error('[FATAL] purchaseRouter = null');
if (itemsRouter) router.use(itemsRouter);
else console.error('[FATAL] itemsRouter = null');
if (profileRouter) router.use(profileRouter);
else console.error('[FATAL] profileRouter = null');
if (debuffsRouter) router.use(debuffsRouter);
else console.error('[FATAL] debuffsRouter = null');

// Экспортируем для использования в других модулях
module.exports = router;
module.exports.authenticatePlayer = authenticatePlayer;
