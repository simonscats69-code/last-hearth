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
const statusRouter = safeRequire('./status', 'status');

// Middleware для валидации Telegram данных
async function validatePlayer(req, res, next) {
    try {
        // Поддерживаем оба варианта заголовков для совместимости
        const initData = req.headers['x-telegram-init-data'] || req.headers['x-init-data'];
        const botToken = process.env.TG_BOT_TOKEN;
        
        // Development mode: пропускаем валидацию если токен не настроен
        if (!botToken || botToken === 'YOUR_BOT_TOKEN_HERE') {
            logger.warn('[validatePlayer] TG_BOT_TOKEN не настроен - режим разработки');
            
            // Пытаемся извлечь user_id из initData без валидации подписи
            if (initData) {
                try {
                    const params = new URLSearchParams(initData);
                    const userStr = params.get('user');
                    if (userStr) {
                        const user = JSON.parse(userStr);
                        req.player = {
                            id: user.id,
                            telegram_id: user.id,
                            username: user.username || null,
                            first_name: user.first_name || 'DevPlayer',
                            last_name: user.last_name || null,
                            language_code: user.language_code || 'ru',
                            is_premium: user.is_premium || false
                        };
                        req.telegramAuth = { user, raw: Object.fromEntries(params) };
                        
                        logger.info('[validatePlayer] Dev mode авторизация', {
                            telegramId: user.id,
                            firstName: user.first_name
                        });
                        
                        return next();
                    }
                } catch (parseErr) {
                    logger.warn('[validatePlayer] Ошибка парсинга initData в dev mode:', parseErr.message);
                }
            }
            
            // Fallback: используем тестовый аккаунт для разработки
            req.player = {
                id: 123456789,
                telegram_id: 123456789,
                username: 'dev_user',
                first_name: 'Dev',
                last_name: 'Player',
                language_code: 'ru',
                is_premium: false
            };
            req.telegramAuth = { user: req.player, raw: {} };
            
            logger.info('[validatePlayer] Dev mode fallback авторизация');
            return next();
        }
        
        if (!initData) {
            logger.warn('[validatePlayer] Отсутствует initData', {
                headers: Object.keys(req.headers),
                hasBotToken: !!botToken
            });
            return res.status(401).json({ error: 'Нет данных авторизации' });
        }

        const validated = validateTelegramInitData(initData, botToken);
        if (!validated) {
            logger.warn('[validatePlayer] Невалидные данные авторизации', {
                initDataLength: initData.length,
                hasBotToken: !!botToken
            });
            return res.status(401).json({ error: 'Невалидные данные авторизации' });
        }

        // Устанавливаем данные пользователя из валидированных данных
        // Преобразуем объект Telegram user в формат, ожидаемый роутерами
        req.player = {
            id: validated.user.id,           // ID для внутреннего использования (совпадает с telegram_id)
            telegram_id: validated.user.id,  // Telegram ID для запросов к БД
            username: validated.user.username || null,
            first_name: validated.user.first_name || 'Player',
            last_name: validated.user.last_name || null,
            language_code: validated.user.language_code || 'ru',
            is_premium: validated.user.is_premium || false
        };
        req.telegramAuth = validated;
        
        logger.info('[validatePlayer] Авторизация успешна', {
            telegramId: validated.user.id,
            firstName: validated.user.first_name,
            username: validated.user.username
        });
        
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
router.use('/status', statusRouter);

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
