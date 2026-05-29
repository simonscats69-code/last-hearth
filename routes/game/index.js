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
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Слишком много попыток авторизации', code: 'AUTH_LIMIT' },
    keyGenerator: (req) => req.ip
});

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
        
        if (typeof module === 'function') {
            if (Array.isArray(module.stack)) {
                logger.info(`[game] ${name} имеет stack (Express router), возвращаем как есть`);
                return module;
            }
            logger.info(`[game] ${name} вызываем как функцию()`);
            module = module();
        }
        
        if (module && typeof module === 'object' && module.router) {
            logger.info(`[game] ${name} имеет .router, возвращаем его`);
            return module.router;
        }
        
        if (module && typeof module === 'object' && (module.get || module.post || module.put || module.delete || module.patch || module.handle)) {
            logger.info(`[game] ${name} является Express router, возвращаем как есть`);
            return module;
        }
        
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
    logger.info('[validatePlayer] Начало валидации', { path: req.path, method: req.method });
    try {
        const initData = req.headers['x-telegram-init-data'] || req.headers['x-init-data'];
        const botToken = process.env.TG_BOT_TOKEN;
        
        if (!initData) {
            logger.warn('[validatePlayer] Отсутствует initData');
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

        const dbPlayer = await upsertPlayerFromTelegramUser(validated.user);
        
        if (dbPlayer.banned) {
            logger.warn({ type: 'banned_player_access', playerId: dbPlayer.id, telegramId: validated.user.id });
            return res.status(403).json({ error: 'Ваш аккаунт заблокирован.' });
        }
        
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

// ====== RATE LIMITERS FIRST (защита от DoS через неавторизованные запросы) ======
router.use('/bosses/attack-boss', criticalActionLimiter);
router.use('/bosses/attack-with-weapon', criticalActionLimiter);
router.use(/^\/bosses\/raid\/\d+\/attack$/, criticalActionLimiter);
router.use('/pvp/attack', criticalActionLimiter);
router.use('/pvp/attack-hit', criticalActionLimiter);
router.use('/minigames/wheel/spin', criticalActionLimiter);
router.use('/minigames/purchase', purchaseLimiter);
router.use('/items/buy', purchaseLimiter);
router.use(authLimiter); // Лимит на auth-запросы
router.use(generalActionLimiter);

// ====== ЗАТЕМ ВАЛИДАЦИЯ ======
router.use(validatePlayer);

// ====== ЛОГИРОВАНИЕ ======
router.use((req, res, next) => {
    logger.info('[game] Входящий запрос:', { method: req.method, path: req.path, originalUrl: req.originalUrl, playerId: req.player?.id });
    next();
});

// ====== ПОДКЛЮЧЕНИЕ РОУТЕРОВ ======
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
router.use('/locations', worldRouter);
router.use('/profile', playerRouter);
router.use('/inventory', itemsRouter);
router.use('/wheel', minigamesRouter);
router.use('/purchase', minigamesRouter);

module.exports = router;