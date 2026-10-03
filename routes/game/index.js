/**
 * Главный файл игровых роутеров
 * Объединяет все модули game API
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, describeError } = require('../../db/database');
const rateLimit = require('express-rate-limit');
const { validateTelegramInitData, logger } = require('../../utils/serverApi');
const { generateReferralCode } = require('../../utils/referralCode');

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

// Загрузка роутеров без шума в логах.
//
// Здесь было четыре logger.info на КАЖДЫЙ модуль («Попытка загрузить»,
// «загружен, тип», «имеет stack…», «возвращаем как есть») плюс ещё два блока
// на world и bosses с дампом маршрутов — около 40 строк на каждый старт
// процесса. Реальную ошибку логирует только catch, поэтому успешные
// сообщения ушли на debug: на уровне info старт остаётся читаемым.
function safeRequire(path, name) {
    try {
        let module = require(path);

        if (typeof module === 'function' && !Array.isArray(module.stack)) {
            module = module();
        }

        if (module && typeof module === 'object') {
            if (module.router) return module.router;
            if (module.get || module.post || module.put || module.delete || module.patch) return module;
            if (Array.isArray(module.stack)) return module;
        }

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

const clansRouter = safeRequire('./clans', 'clans');
const pvpRouter = safeRequire('./pvp', 'pvp');
const playerRouter = safeRequire('./player', 'player');
const itemsRouter = safeRequire('./items', 'items');
const workshopRouter = safeRequire('./workshop', 'workshop');
const statusRouter = safeRequire('./status', 'status');
const minigamesRouter = safeRequire('./minigames', 'minigames');

const REFERRAL_COLLISION = '23505';

async function upsertPlayerFromTelegramUser(user) {
    const telegramId = Number(user.id);

    // Retry: с UNIQUE-индексом на referral_code коллизия кода бросает 23505,
    // а ON CONFLICT ниже обрабатывает только конфликт по telegram_id.
    // Вероятность ничтожна (32^8 вариантов), но одна неудачная попытка
    // не должна приводить к 500 на регистрации.
    const MAX_CODE_ATTEMPTS = 5;
    for (let attempt = 1; ; attempt++) {
        try {
            return await upsertOnce(user, telegramId);
        } catch (err) {
            const isReferralCollision = err?.code === REFERRAL_COLLISION &&
                String(err?.constraint || '').includes('referral_code');
            if (!isReferralCollision || attempt >= MAX_CODE_ATTEMPTS) throw err;
        }
    }
}

async function upsertOnce(user, telegramId) {
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
        // Единый генератор: раньше здесь был LH-<base36(telegram_id)> без
        // случайной части, из-за чего коды в игре были двух разных видов
        // и предсказуемыми.
        generateReferralCode()
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

/**
 * Разбор пользователя из initData без проверки подписи.
 * Допустим ТОЛЬКО в development (когда нет TG_BOT_TOKEN и проверить подпись невозможно).
 */
function parseUserFromInitDataUnsafe(initData) {
    try {
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user') || '{}');
        return user?.id ? { user } : null;
    } catch {
        return null;
    }
}

// Middleware для валидации Telegram данных
async function validatePlayer(req, res, next) {
    try {
        const initData = req.headers['x-telegram-init-data'] || req.headers['x-init-data'];
        const botToken = process.env.TG_BOT_TOKEN;

        if (!initData) {
            logger.warn('[validatePlayer] Отсутствует initData');
            return res.status(401).json({ error: 'Нет данных авторизации' });
        }

        let validated;
        if (botToken) {
            validated = validateTelegramInitData(initData, botToken);
        } else if (process.env.NODE_ENV !== 'production') {
            // Dev-режим без токена: подпись проверить нечем, разбираем как есть
            logger.warn('[validatePlayer] TG_BOT_TOKEN не настроен — авторизация без проверки подписи (development)');
            validated = parseUserFromInitDataUnsafe(initData);
        }

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

        // Отметка активности. Колонка last_action_time была DEFAULT NOW()
        // при регистрации и больше НИКОГДА не обновлялась: игроки вечно
        // считались офлайн в кланах (is_online), а планировщик достижений
        // выбирал для проверки только тех, кто зарегистрировался за сутки.
        // Пишем не чаще раза в 5 минут на игрока — иначе это лишний UPDATE
        // на каждый запрос; троттлинг держится в памяти процесса.
        touchPlayerActivity(dbPlayer.id);

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

/**
 * Отметка «игрок активен» с троттлингом.
 *
 * Запись в БД делается не чаще раза в 5 минут на игрока: защита
 * last_action_time нужна кланам (онлайн), планировщику достижений и
 * админской статистике, но обновлять её на каждом запросе слишком дорого.
 *
 * @param {number} playerId
 */
const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastActivityTouch = new Map();

function touchPlayerActivity(playerId) {
    const id = Number(playerId);
    if (!Number.isInteger(id) || id <= 0) return;

    const now = Date.now();
    const last = lastActivityTouch.get(id) || 0;
    if (now - last < ACTIVITY_TOUCH_INTERVAL_MS) return;

    lastActivityTouch.set(id, now);

    // Ошибку не пробрасываем: отметка активности не должна ломать запрос.
    query(
        `UPDATE players
            SET last_action_time = NOW()
          WHERE id = $1
            AND (last_action_time IS NULL OR last_action_time < NOW() - INTERVAL '5 minutes')`,
        [id]
    ).catch((error) => {
        lastActivityTouch.delete(id);
        logger.warn('[activity] Не удалось обновить last_action_time', describeError(error));
    });
}

// ====== RATE LIMITERS FIRST (защита от DoS через неавторизованные запросы) ======
router.use('/bosses/attack-boss', criticalActionLimiter);
router.use('/bosses/attack-with-weapon', criticalActionLimiter);
router.use(/^\/bosses\/raid\/\d+\/attack$/, criticalActionLimiter);
router.use('/pvp/attack', criticalActionLimiter);
router.use('/pvp/attack-hit', criticalActionLimiter);
router.use('/minigames/wheel/spin', criticalActionLimiter);
router.use('/minigames/purchase', purchaseLimiter);
// Ремонт и улучшение — траты валюты, поэтому под тем же лимитом покупок.
router.use('/items/buy', purchaseLimiter);
router.use('/workshop/repair', purchaseLimiter);
router.use('/workshop/upgrade', purchaseLimiter);
router.use('/workshop/modify', purchaseLimiter);
router.use('/items/buy-stars', purchaseLimiter);
// Алиас /inventory монтирует тот же роутер предметов (см. конец файла),
// поэтому лимиты трат монет нужно продублировать: иначе /inventory/buy
// и /inventory/buy-stars проходили бы мимо purchaseLimiter.
router.use('/inventory/buy', purchaseLimiter);
router.use('/inventory/buy-stars', purchaseLimiter);
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
router.use('/items', itemsRouter);
router.use('/workshop', workshopRouter);
router.use('/status', statusRouter);
router.use('/minigames', minigamesRouter);

// Алиасы для обратной совместимости
router.use('/locations', worldRouter);
router.use('/profile', playerRouter);
router.use('/inventory', itemsRouter);
router.use('/wheel', minigamesRouter);
router.use('/purchase', minigamesRouter);

module.exports = router;