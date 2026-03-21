/**
 * Главный файл игровых роутеров
 * Объединяет все модули game API
 */

const express = require('express');
const router = express.Router();
const { query } = require('../../db/database');
const rateLimit = require('express-rate-limit');
const { validateTelegramInitData, logger } = require('../../utils/serverApi');

// Rate limiters
const criticalActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: { error: 'Слишком много атак. Отдохните минуту.', code: 'CRITICAL_ACTION_LIMIT' },
    keyGenerator: (req) => req.player?.id || req.ip
});

const bossActionLimiter = (req, res, next) => next();
const bossClickLimiter = (req, res, next) => next();

const generalActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    message: { error: 'Слишком много запросов.', code: 'ACTION_LIMIT' },
    keyGenerator: (req) => req.player?.id || req.ip
});

const getLimiter = (req, res, next) => next();

const purchaseLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Слишком много покупок.', code: 'PURCHASE_LIMIT' },
    keyGenerator: (req) => req.player?.id || req.ip
});

// Safe require - не падает если модуль не найден
function safeRequire(path, name) {
    try {
        const module = require(path);
        // Если модуль экспортирует объект с полем router, извлекаем его
        if (module && typeof module === 'object' && module.router) {
            return module.router;
        }
        return module;
    } catch (error) {
        logger.warn(`[game] Не удалось загрузить роутер ${name}: ${error.message}`);
        const mockRouter = express.Router();
        mockRouter.use((req, res) => res.status(500).json({ error: `Модуль ${name} недоступен` }));
        return mockRouter;
    }
}

// Импорт роутеров (объединённые модули)
const worldRouter = safeRequire('./world', 'world');
const bossesRouter = safeRequire('./bosses', 'bosses');
const clansRouter = safeRequire('./clans', 'clans');
const pvpRouter = safeRequire('./pvp', 'pvp');
const playerRouter = safeRequire('./player', 'player');
const debuffsRouter = safeRequire('./debuffs', 'debuffs');
const marketRouter = safeRequire('./market', 'market');
const itemsRouter = safeRequire('./items', 'items');

// Middleware для валидации Telegram данных
async function validatePlayer(req, res, next) {
    try {
        const initData = req.headers['x-telegram-init-data'];
        if (!initData) {
            return res.status(401).json({ error: 'Нет данных авторизации' });
        }

        const player = await validateTelegramInitData(initData);
        if (!player) {
            return res.status(401).json({ error: 'Невалидные данные авторизации' });
        }

        req.player = player;
        next();
    } catch (error) {
        logger.error('[game] Ошибка валидации игрока:', error);
        return res.status(500).json({ error: 'Ошибка сервера' });
    }
}

// Применяем валидацию ко всем роутерам
router.use(validatePlayer);

// Подключение роутеров (объединённые модули)
router.use('/world', worldRouter);
router.use('/bosses', bossesRouter);
router.use('/clans', clansRouter);
router.use('/pvp', pvpRouter);
router.use('/player', playerRouter);
router.use('/debuffs', debuffsRouter);
router.use('/market', marketRouter);
router.use('/items', itemsRouter);

// Алиасы для обратной совместимости
router.use('/locations', worldRouter);
router.use('/base', worldRouter);
router.use('/profile', playerRouter);
router.use('/achievements', playerRouter);
router.use('/referral', playerRouter);
router.use('/energy', playerRouter);
router.use('/inventory', itemsRouter);
router.use('/crafting', itemsRouter);
router.use('/purchase', marketRouter);

// Экспорт
module.exports = router;
