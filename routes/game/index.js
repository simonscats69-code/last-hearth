/**
 * Главный файл игровых роутеров
 * Объединяет все модули game API
 */

const express = require('express');
const router = express.Router();
const { queryOne } = require('../../db/database');
const rateLimit = require('express-rate-limit');
const { validateTelegramInitData, logger } = require('../../utils/serverApi');

// Rate limiters
const criticalActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: { error: 'Слишком много атак. Отдохните минуту.', code: 'CRITICAL_ACTION_LIMIT' },
    keyGenerator: (req) => req.player?.id || req.ip
});

const generalActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    message: { error: 'Слишком много запросов.', code: 'ACTION_LIMIT' },
    keyGenerator: (req) => req.player?.id || req.ip
});

const purchaseLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Слишком много покупок.', code: 'PURCHASE_LIMIT' },
    keyGenerator: (req) => req.player?.id || req.ip
});

// Safe require - не падает если модуль не найден
function safeRequire(path, name) {
    try {
        logger.info(`[game] Попытка загрузить ${name} из ${path}`);
        let module = require(path);
        logger.info(`[game] Модуль ${name} загружен, тип:`, typeof module);
        
        // Если модуль является функцией (Express router), проверяем её методы
        if (typeof module === 'function') {
            // Проверяем через stack (для роутеров с middleware)
            if (Array.isArray(module.stack)) {
                logger.info(`[game] ${name} имеет stack (Express router), возвращаем как есть`);
                return module;
            }
            // Функция без stack - пробуем вызвать для получения роутера
            logger.info(`[game] ${name} вызываем как функцию()`);
            module = module();
        }
        
        // Если модуль экспортирует объект с полем router, извлекаем его
        if (module && typeof module === 'object' && module.router) {
            logger.info(`[game] ${name} имеет .router, возвращаем его`);
            return module.router;
        }
        
        // Если модуль является Express роутером (имеет методы маршрутизации), возвращаем как есть
        if (module && typeof module === 'object' && (module.get || module.post || module.put || module.delete || module.patch || module.handle)) {
            logger.info(`[game] ${name} является Express router, возвращаем как есть`);
            return module;
        }
        
        // Fallback: проверяем через stack (для роутеров с middleware)
        if (module && typeof module === 'object' && Array.isArray(module.stack)) {
            logger.info(`[game] ${name} имеет stack (Express router), возвращаем как есть`);
            return module;
        }
        
        logger.info(`[game] ${name} возвращаем как есть (${typeof module})`);
        return module;
    } catch (error) {
        logger.error(`[game] Ошибка загрузки ${name}:`, error.message, error.stack);
        const mockRouter = express.Router();
        mockRouter.use((req, res) => res.status(500).json({ error: `Модуль ${name} недоступен` }));
        return mockRouter;
    }
}

// Импорт роутеров (объединённые модули)
const worldRouter = safeRequire('./world', 'world');
const bossesRouter = safeRequire('./bosses', 'bosses');

logger.info('[game] worldRouter загружен:', worldRouter ? 'OK' : 'NULL');
if (worldRouter?.stack) {
    logger.info('[game] world routes:', worldRouter.stack.map(r => r.route?.path).filter(Boolean));
}

logger.info('[game] bossesRouter загружен:', bossesRouter ? 'OK' : 'NULL');
if (bossesRouter?.stack) {
    logger.info('[game] bosses routes:', bossesRouter.stack.map(r => r.route?.path).filter(Boolean));
}

const clansRouter = safeRequire('./clans', 'clans');
const pvpRouter = safeRequire('./pvp', 'pvp');
const playerRouter = safeRequire('./player', 'player');
const debuffsRouter = safeRequire('./debuffs', 'debuffs');
const itemsRouter = safeRequire('./items', 'items');
const statusRouter = safeRequire('./status', 'status');
const minigamesRouter = safeRequire('./minigames', 'minigames');

function buildReferralCode(telegramId) {
    try {
        return `LH-${BigInt(String(telegramId)).toString(36).toUpperCase()}`.slice(0, 20);
    } catch {
        return `LH-${String(telegramId).slice(-10)}`;
    }
}

async function upsertPlayerFromTelegramUser(user) {
    const telegramId = Number(user.id);

    return await queryOne(`
        INSERT INTO players (
            telegram_id,
            username,
            first_name,
            last_name,
            referral_code,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (telegram_id)
        DO UPDATE SET
            username = COALESCE(EXCLUDED.username, players.username),
            first_name = COALESCE(EXCLUDED.first_name, players.first_name),
            last_name = COALESCE(EXCLUDED.last_name, players.last_name),
            updated_at = NOW()
        RETURNING *
    `, [
        telegramId,
        user.username || null,
        user.first_name || 'Player',
        user.last_name || null,
        buildReferralCode(telegramId)
    ]);
}

function buildRequestPlayer(user, dbPlayer) {
    return {
        ...dbPlayer,
        id: Number(dbPlayer.id),
        player_id: Number(dbPlayer.id),
        telegram_id: Number(dbPlayer.telegram_id),
        username: dbPlayer.username || user.username || null,
        first_name: dbPlayer.first_name || user.first_name || 'Player',
        last_name: dbPlayer.last_name || user.last_name || null,
        language_code: user.language_code || 'ru',
        is_premium: Boolean(user.is_premium),
        telegram_user: user
    };
}

// Middleware для валидации Telegram данных
async function validatePlayer(req, res, next) {
    logger.info('[validatePlayer] Начало валидации', { path: req.path, method: req.method, headers: Object.keys(req.headers) });
    try {
        // Поддерживаем оба варианта заголовков для совместимости
        const initData = req.headers['x-telegram-init-data'] || req.headers['x-init-data'];
        const botToken = process.env.TG_BOT_TOKEN;
        
        // Development mode: пропускаем валидацию если токен не настроен
        // ВАЖНО: Разрешаем только в режиме разработки!
        const isDevelopment = process.env.NODE_ENV !== 'production';
        if (isDevelopment && (!botToken || botToken === 'YOUR_BOT_TOKEN_HERE')) {
            logger.warn('[validatePlayer] TG_BOT_TOKEN не настроен - режим разработки');
            
            // Пытаемся извлечь user_id из initData без валидации подписи
            if (initData) {
                try {
                    const params = new URLSearchParams(initData);
                    const userStr = params.get('user');
                    if (userStr) {
                        const user = JSON.parse(userStr);
                        const dbPlayer = await upsertPlayerFromTelegramUser(user);
                        req.player = buildRequestPlayer(user, dbPlayer);
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
            const devUser = {
                id: 123456789,
                username: 'dev_user',
                first_name: 'Dev',
                last_name: 'Player',
                language_code: 'ru',
                is_premium: false
            };
            const dbPlayer = await upsertPlayerFromTelegramUser(devUser);
            req.player = buildRequestPlayer(devUser, dbPlayer);
            req.telegramAuth = { user: devUser, raw: {} };
            
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
        const dbPlayer = await upsertPlayerFromTelegramUser(validated.user);
        req.player = buildRequestPlayer(validated.user, dbPlayer);
        req.telegramAuth = validated;
        
        logger.info('[validatePlayer] Авторизация успешна', {
            telegramId: validated.user.id,
            playerId: dbPlayer.id,
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

// Применяем rate limiters к критическим маршрутам
// Критические действия: атаки боссов, PvP атаки, спин колеса
router.use('/bosses', criticalActionLimiter);
router.use('/pvp', criticalActionLimiter);
router.use('/minigames/wheel/spin', criticalActionLimiter);

// Покупки: отдельный лимитер
router.use('/minigames/purchase', purchaseLimiter);
router.use('/items/buy', purchaseLimiter);

// Общие действия: все остальные маршруты
router.use(generalActionLimiter);

// Логируем все входящие запросы к game роутеру
router.use((req, res, next) => {
    logger.info('[game] Входящий запрос:', { method: req.method, path: req.path, originalUrl: req.originalUrl, playerId: req.player?.id });
    next();
});

// Подключение роутеров (объединённые модули)
router.use('/world', worldRouter);
router.use('/bosses', bossesRouter);
router.use('/clans', clansRouter);
router.use('/pvp', pvpRouter);
router.use('/player', playerRouter);
router.use('/debuffs', debuffsRouter);
router.use('/items', itemsRouter);
router.use('/status', statusRouter);
router.use('/minigames', minigamesRouter);

// Алиасы для обратной совместимости
router.use('/locations', worldRouter); // /api/game/locations -> worldRouter
logger.info('[game] Алиас /locations -> worldRouter подключён');
router.use('/profile', playerRouter);    // /api/game/profile + /api/game/player
router.use('/inventory', itemsRouter);   // /api/game/inventory + /api/game/items
// Алиасы для обратной совместимости со старыми endpoints
router.use('/wheel', minigamesRouter);   // /api/game/wheel -> minigames
router.use('/purchase', minigamesRouter); // /api/game/purchase -> minigames

// Экспорт
module.exports = router;
