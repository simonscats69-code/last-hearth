/**
 * Главный файл игровых роутеров
 * Объединяет все модули game API
 */

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db/database');
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
        return require(path);
    } catch (error) {
        logger.warn(`[game] Не удалось загрузить роутер ${name}: ${error.message}`);
        const mockRouter = express.Router();
        mockRouter.use((req, res) => res.status(500).json({ error: `Модуль ${name} недоступен` }));
        return mockRouter;
    }
}

// Импорт роутеров
const locationsRouter = safeRequire('./locations', 'locations');
const inventoryRouter = safeRequire('./inventory', 'inventory');
const bossesRouter = safeRequire('./bosses', 'bosses');
const craftingRouter = safeRequire('./crafting', 'crafting');
const baseRouter = safeRequire('./base', 'base');
const clansRouter = safeRequire('./clans', 'clans');
const pvpRouter = safeRequire('./pvp', 'pvp');
const profileRouter = safeRequire('./profile', 'profile');
const debuffsRouter = safeRequire('./debuffs', 'debuffs');
const marketRouter = safeRequire('./market', 'market');
const energyRouter = safeRequire('./energy', 'energy');
const referralRouter = safeRequire('./referral', 'referral');
const purchaseRouter = safeRequire('./purchase', 'purchase');
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

// Подключение роутеров
router.use('/locations', locationsRouter);
router.use('/inventory', inventoryRouter);
router.use('/bosses', bossesRouter);
router.use('/crafting', craftingRouter);
router.use('/base', baseRouter);
router.use('/clans', clansRouter);
router.use('/pvp', pvpRouter);
router.use('/profile', profileRouter);
router.use('/debuffs', debuffsRouter);
router.use('/market', marketRouter);
router.use('/energy', energyRouter);
router.use('/referral', referralRouter);
router.use('/purchase', purchaseRouter);
router.use('/items', itemsRouter);

// Экспорт
module.exports = router;
