/**
 * Главный файл игровых роутеров
 * Объединяет все модули game API
 */

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db/database');
const { validateTelegramInitData } = require('../../utils/telegramAuth');
const rateLimit = require('express-rate-limit');

// Используем console для логирования - простой и надёжный способ
const log = {
    info: (...args) => console.log('[game]', ...args),
    warn: (...args) => console.warn('[game]', ...args),
    error: (...args) => console.error('[game]', ...args)
};

// Rate limiter для критических endpoints (атака босса, PvP)
const criticalActionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 минута
    max: 30, // 30 запросов в минуту
    message: { error: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
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
 * Middleware авторизации для Telegram Mini App
 * Использует x-init-data с валидацией подписи через Bot API
 * 
 * Поток:
 * 1. Mini App отправляет x-init-data с каждым запросом
 * 2. Сервер валидирует подпись через TELEGRAM_BOT_TOKEN
 * 3. Из данных получаем telegram_id пользователя
 * 4. Ищем/создаём игрока в БД
 */
async function authenticatePlayer(req, res, next) {
    try {
        const initData = req.headers['x-init-data'];
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        // Логируем информацию о запросе для отладки
        log.info('authenticatePlayer вызван', {
            path: req.path,
            hasInitData: !!initData,
            initDataLength: initData?.length || 0,
            // Показываем только структуру initData (первые ключи)
            initDataKeys: initData ? initData.split('&').map(k => k.split('=')[0]) : []
        });

        // Проверяем наличие initData
        if (!initData) {
            log.warn('Отсутствует initData', { path: req.path, headers: Object.keys(req.headers) });
            return res.status(401).json({ 
                error: 'Требуется авторизация. Откройте игру через Telegram.',
                code: 'NO_INIT_DATA'
            });
        }

        // Проверяем наличие токена бота
        if (!botToken) {
            log.error('TELEGRAM_BOT_TOKEN не настроен');
            return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
        }
        
        // Проверяем что токен не placeholder
        if (botToken === 'YOUR_BOT_TOKEN_HERE' || botToken.includes('your_')) {
            log.error('TELEGRAM_BOT_TOKEN установлен как placeholder! нужно заменить на реальный токен');
            return res.status(500).json({ 
                error: 'Ошибка конфигурации сервера. Токен бота не настроен.',
                code: 'BOT_TOKEN_NOT_CONFIGURED'
            });
        }
        
        log.info('Токен бота настроен, начинаем валидацию');

        // Валидация подписи initData
        const validated = validateTelegramInitData(initData, botToken);
        if (!validated) {
            log.warn('Неверная подпись initData', { 
                path: req.path, 
                initDataLength: initData.length,
                initDataPrefix: initData.substring(0, 100)
            });
            return res.status(401).json({ 
                error: 'Неверная подпись авторизации. Обновите игру.',
                code: 'INVALID_SIGNATURE'
            });
        }

        // Получаем ID пользователя из данных Telegram
        const telegramUserId = String(validated.user.id);

        // Ищем игрока в БД
        const player = await queryOne(
            'SELECT * FROM players WHERE telegram_id = $1',
            [telegramUserId]
        );

        if (!player) {
            log.warn('Игрок не найден в БД', { 
                telegramId: telegramUserId, 
                path: req.path 
            });
            return res.status(404).json({ 
                error: 'Игрок не найден. Начните игру через /start в боте.',
                code: 'PLAYER_NOT_FOUND'
            });
        }

        log.info('Авторизация игрока', { 
            telegramId: telegramUserId, 
            playerId: player.id,
            path: req.path 
        });

        req.player = player;
        next();
    } catch (error) {
        log.error('Ошибка авторизации', { error: error.message, stack: error.stack });
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
        log.info(`Загружен роутер: ${name}`);
        return mod;
    } catch(e) {
        log.error(`FATAL: Не удалось загрузить роутер: ${name}`, { path, error: e.message });
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
const { router: debuffsRouter } = safeRequire('./debuffs', 'debuffs'); // debuffs.js экспортирует { router, DebuffAPI } - нужна деструктуризация

// Используем модули с namespace (роутеры подключаются как /game/:routerName)
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
