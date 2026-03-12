/**
 * Главный файл игровых роутеров
 * Объединяет все модули game API
 */

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db/database');
const { logger } = require('../../utils/logger');
const { validateTelegramInitData } = require('../../utils/telegramAuth');
const rateLimit = require('express-rate-limit');

// Rate limiter для критических endpoints (атака босса, PvP)
const criticalActionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: 30, // 30 запросов в минуту
    message: { error: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Используем telegramId или IP
        return req.player?.id || req.ip;
    }
});

// Rate limiter для обычных endpoints
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: 100, // 100 запросов в минуту
    message: { error: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.player?.id || req.ip;
    }
});

/**
 * Унифицированный middleware авторизации
 * Поддерживает:
 * 1. x-telegram-id (простой режим для backend запросов)
 * 2. x-init-data (безопасный режим для Telegram Mini App)
 */
async function authenticatePlayer(req, res, next) {
    try {
        const telegramId = req.headers['x-telegram-id'] || req.query.telegram_id;
        const initData = req.headers['x-init-data'];
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        
        let player;
        
        // Режим 1: Проверка через initData (более безопасный)
        if (initData && botToken) {
            const validated = validateTelegramInitData(initData, botToken);
            if (!validated) {
                logger.warn('[game] Неверная подпись initData', { path: req.path });
                return res.status(401).json({ error: 'Неверная подпись initData' });
            }
            
            // Получаем игрока по telegram id из валидированных данных
            const telegramUserId = String(validated.user.id);
            player = await queryOne(
                'SELECT * FROM players WHERE telegram_id = $1',
                [telegramUserId]
            );
            
            logger.info('[game] Авторизация через initData', { 
                telegramId: telegramUserId, 
                path: req.path 
            });
        } 
        // Режим 2: Простой x-telegram-id (для обратной совместимости)
        else if (telegramId) {
            player = await queryOne(
                'SELECT * FROM players WHERE telegram_id = $1',
                [telegramId]
            );
            
            logger.info('[game] Авторизация через telegram_id', { 
                telegramId, 
                path: req.path 
            });
        } 
        else {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден. Начните игру через /start' });
        }

        req.player = player;
        next();
    } catch (error) {
        logger.error('[game] Ошибка авторизации', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Ошибка сервера' });
    }
}

router.use(authenticatePlayer);

/**
 * Безопасная загрузка модулей - выбрасывает ошибку если модуль не найден
 * @param {string} path - Путь к модулю
 * @param {string} name - Имя модуля для логирования
 */
function safeRequire(path, name) {
    try {
        const mod = require(path);
        logger.info(`[game] Загружен роутер: ${name}`);
        return mod;
    } catch(e) {
        logger.error(`[FATAL] Не удалось загрузить роутер: ${name}`, { path, error: e.message });
        throw new Error(`Не удалось загрузить роутер ${name}: ${e.message}`);
    }
}

// Подключаем все модули с явными namespace
const locationsRouter = safeRequire('./locations', 'locations');
const inventoryRouter = safeRequire('./inventory', 'inventory');
const bossesRouter = safeRequire('./bosses', 'bosses');
const craftingRouter = safeRequire('./crafting', 'crafting');
const baseRouter = safeRequire('./base', 'base');
const clansRouter = safeRequire('./clans', 'clans');
const pvpRouter = safeRequire('./pvp', 'pvp');
const statusRouter = safeRequire('./status', 'status');
const marketRouter = safeRequire('./market', 'market');
const energyRouter = safeRequire('./energy', 'energy');
const referralRouter = safeRequire('./referral', 'referral');
const seasonsRouter = safeRequire('./seasons', 'seasons');
const purchaseRouter = safeRequire('./purchase', 'purchase');
const itemsRouter = safeRequire('./items', 'items');
const profileRouter = safeRequire('./profile', 'profile');
const debuffsRouter = safeRequire('./debuffs', 'debuffs');

// Используем модули с namespace
router.use('/locations', locationsRouter);
router.use('/inventory', inventoryRouter);
router.use('/bosses', bossesRouter);
router.use('/crafting', craftingRouter);
router.use('/base', baseRouter);
router.use('/clans', clansRouter);
router.use('/pvp', pvpRouter);
router.use('/status', statusRouter);
router.use('/market', marketRouter);
router.use('/energy', energyRouter);
router.use('/referral', referralRouter);
router.use('/seasons', seasonsRouter);
router.use('/purchase', purchaseRouter);
router.use('/items', itemsRouter);
router.use('/profile', profileRouter);
router.use('/debuffs', debuffsRouter);

// Экспортируем всё необходимое
module.exports = Object.assign(router, { 
    authenticatePlayer, 
    criticalActionLimiter, 
    generalLimiter 
});
