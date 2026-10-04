/**
 * Объединённый модуль серверных утилит для Last Hearth
 * Объединяет: валидацию, ответы API, транзакции, логирование, обработку ошибок, Telegram авторизацию
 */

const { queryOne, transaction: tx } = require('../db/database');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { recordRequest } = require('./metrics');

// Логирование вынесено в utils/log.js, чтобы разорвать цикл
// db/players.js -> utils/serverApi.js -> db/players.js.
// Теперь db/players.js импортирует логирование оттуда же, а serverApi
// переиспользует тот же экземпляр — дублирования логгера не возникает.
//
// Импортируются ровно те, что нужны в теле файла ИЛИ в реэкспорте ниже:
// 6 роутов (clans, debuffs, items, player, status, pvp) берут
// logPlayerAction/handleLogError из serverApi — реэкспорт для них обязателен,
// пока все потребители не переведены на прямой импорт из utils/log.js.
const { logger, logPlayerAction, logPlayerError, serializeJSONField } = require('./log');

const ERROR_MESSAGES = Object.freeze({
    INSUFFICIENT_COINS: 'Недостаточно монет',
    INSUFFICIENT_STARS: 'Недостаточно звёзд',
    INSUFFICIENT_ENERGY: 'Недостаточно энергии',
    INSUFFICIENT_HEALTH: 'Недостаточно здоровья'
});

/**
 * Получить игрока по Telegram ID
 */
async function getPlayerByTelegramId(telegramId) {
    return await queryOne('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
}

const rateLimitMap = new Map();

// Очистка устаревших записей каждые 60 секунд (не в тестах)
if (process.env.NODE_ENV !== 'test') {
    setInterval(() => {
        const now = Date.now();
        for (const [ip, timestamps] of rateLimitMap.entries()) {
            const filtered = timestamps.filter(t => now - t < 60000);
            if (filtered.length === 0) {
                rateLimitMap.delete(ip);
            } else {
                rateLimitMap.set(ip, filtered);
            }
        }
    }, 60000);
}

// Настройка логгера (директория логов, форматы, транспорты, обработчик
// ошибок самого логгера) переехала в utils/log.js вместе с
// logPlayerAction/logPlayerError/serializeJSONField/handleLogError.
// Здесь они импортированы оттуда, поэтому дубликатов нет.

/**
 * Санитайз чувствительных данных в логах
 */
function sanitize(obj, seen = new WeakSet()) {
    if (!obj || typeof obj !== 'object') return obj;
    if (seen.has(obj)) return '[Circular]';

    const sensitive = ['password', 'token', 'authorization', 'secret', 'api_key', 'apikey'];
    const clone = Array.isArray(obj) ? [] : {};
    seen.add(obj);

    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (sensitive.includes(key.toLowerCase())) {
            clone[key] = '***';
        } else if (typeof value === 'object' && value !== null) {
            clone[key] = sanitize(value, seen);
        } else {
            clone[key] = value;
        }
    }
    return clone;
}

/**
 * Идентификатор клиента для rate-limit и логов.
 *
 * ВАЖНО: заголовок x-telegram-id НЕ учитывается. Он приходит от клиента
 * и подделывается одним curl, из-за чего лимиты обходились перебором
 * значений заголовка. Идентификатор берётся только из ПОДПИСАННЫХ
 * initData (подпись проверяется в validateTelegramInitData) либо из IP.
 */
function getTelegramIdFromHeaders(headers = {}) {
    const initData = headers['x-telegram-init-data'] || headers['x-init-data'];
    if (!initData || typeof initData !== 'string') {
        return null;
    }

    try {
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user') || '{}');
        return user?.id ? String(user.id) : null;
    } catch (e) {
        logger.warn('Ошибка парсинга initData в getTelegramIdFromHeaders:', e.message);
        return null;
    }
}

/**
 * Middleware для автоматического логирования HTTP запросов
 */
function requestMiddleware(req, res, next) {
    req.requestId = randomUUID();
    const start = Date.now();

    res.on('finish', () => {
        try {
            const duration = Date.now() - start;
            const isProd = process.env.NODE_ENV === 'production';

            // Прямой импорт наверху файла: metrics.js не тянет serverApi,
            // поэтому циклической зависимости больше нет.
            try {
                recordRequest(req.originalUrl || req.url || 'unknown', res.statusCode, duration);
            } catch {
                // метрики не должны ломать обработку запроса
            }

            const entry = {
                type: 'http_request',
                requestId: req.requestId,
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                duration,
                playerId: getTelegramIdFromHeaders(req.headers) || 'anonymous',
                ...(isProd ? {} : {
                    query: sanitize(req.query),
                    ip: req.ip,
                    userAgent: req.headers?.['user-agent']
                })
            };

            // Статика (css/js/картинки) и успешные GET-запросы — рутинный шум:
            // в combined.log их сотни в минуту и они топят настоящие события.
            // Понижаем до debug (видно при LOG_LEVEL=debug), ошибки и мутации
            // остаются на info/error.
            const path = req.originalUrl || req.url || '';
            const isStatic = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|mp[34])($|\?)/i.test(path);
            const isQuiet = isStatic || (req.method === 'GET' && res.statusCode < 400);

            if (!isQuiet) {
                logger.info(entry);
            } else {
                // winston сам отфильтрует по LOG_LEVEL (по умолчанию info)
                logger.debug(entry);
            }
        } catch (e) {
            logger.error('Logging failed', { error: e.message });
        }
    });

    next();
}

/**
 * Проверка ID (целое число > 0)
 */
function validateId(value, fieldName = 'ID') {
    if (value === undefined || value === null) {
        return { ok: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    if (!Number.isInteger(value) || value <= 0) {
        return { ok: false, error: `${fieldName} должен быть целым числом > 0`, code: 'INVALID_ID' };
    }
    return { ok: true, value };
}

/**
 * Проверка, является ли пользователь админом
 */
function isAdmin(userId, adminList) {
    if (!adminList || !Array.isArray(adminList)) {
        return false;
    }
    return adminList.includes(String(userId));
}

/**
 * Очистка имени (trim, удаление спецсимволов)
 */
function sanitizeName(name, maxLength = 50) {
    if (name === undefined || name === null) {
        return { valid: false, error: 'Требуется имя', code: 'MISSING_FIELD' };
    }
    if (typeof name !== 'string') {
        return { valid: false, error: 'Имя должно быть строкой', code: 'INVALID_TYPE' };
    }
    let sanitized = name.trim();
    sanitized = sanitized.replace(/[^\w\s\-а-яА-ЯёЁ]/g, '');
    sanitized = sanitized.replace(/\s+/g, ' ');
    if (sanitized.length === 0) {
        return { valid: false, error: 'Имя не может быть пустым после очистки', code: 'EMPTY_VALUE' };
    }
    if (sanitized.length > maxLength) {
        return { valid: false, error: `Имя слишком длинное (макс. ${maxLength} символов)`, code: 'TOO_LONG', value: sanitized.substring(0, maxLength) };
    }
    return { valid: true, value: sanitized };
}

/**
 * Успешный ответ с данными
 */
function ok(res, data, statusCode = 200) {
    return res.status(statusCode).json({ success: true, data });
}

/**
 * Ошибка запроса (клиентская ошибка)
 */
function fail(res, message, code = 'ERROR', statusCode = 400) {
    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 * Внутренняя ошибка сервера
 */
function error(res, message, code = 'INTERNAL_ERROR', statusCode = 500) {
    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 * Ресурс не найден (404)
 */
function notFound(res, message = 'Ресурс не найден', code = 'NOT_FOUND') {
    return res.status(404).json({ success: false, error: message, code });
}

/**
 * Требуется авторизация (401)
 */
function unauthorized(res, message = 'Требуется авторизация', code = 'UNAUTHORIZED') {
    return res.status(401).json({ success: false, error: message, code });
}

/**
 * Middleware-обёртка для catch ошибок в асинхронных обработчиках
 */
function wrap(fn) {
    return function(req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Безопасное превращение объекта в строку
 */
function safeStringify(obj, space) {
    if (obj === undefined || obj === null) return '{}';
    if (typeof obj === 'function') return '{}';
    try {
        return JSON.stringify(obj, null, space);
    } catch (error) {
        logger.warn('JSON stringify failed');
        return '{}';
    }
}

/**
 * Безопасный парсинг JSON
 */
function safeJsonParse(str, defaultValue = null) {
    if (!str) return defaultValue;
    if (typeof str === 'object') return str;
    try {
        return JSON.parse(str);
    } catch (e) {
        logger.warn('[safeJsonParse failed]', {
            error: e.message,
            str: str?.substring(0, 100),
            type: typeof str,
            length: str?.length
        });
        return defaultValue;
    }
}

/**
 * Выполнить функцию в транзакции с блокировкой игрока
 * @param {number} playerId - ID игрока (внутренний id из БД)
 * @param {function} fn - Функция для выполнения (получает client и lockedPlayer)
 * @param {number} timeoutMs - Таймаут в миллисекундах (по умолчанию 10000мс)
 */
async function withPlayerLock(playerId, fn, timeoutMs = 10000) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }

    return await tx(async (client) => {
        await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);

        const lockedPlayer = await client.query(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );

        if (!lockedPlayer.rows[0]) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        return await fn(client, lockedPlayer.rows[0]);
    });
}

/**
 * Универсальный обработчик ошибок для роутов
 *
 * Клиенту отдаём текст ТОЛЬКО для клиентских ошибок (4xx). Для 500
 * наружу уходит обобщённый текст: иначе игрок видел бы внутренние
 * сообщения (например, текст ошибки PostgreSQL с именами таблиц и
 * колонок). Полные детали остаются в логах.
 */
function handleError(res, error, action = 'unknown') {
    const statusCode = error.statusCode || 500;
    // Коды ошибок БД (23505, 42P01...) — это внутренние коды Postgres,
    // отдавать их клиенту незачем. Наружу уходят только наши
    // буквенно-цифровые коды вида INSUFFICIENT_COINS.
    const rawCode = typeof error.code === 'string' ? error.code : '';
    const isOwnCode = /^[A-Z][A-Z0-9_]{2,}$/.test(rawCode);
    const code = isOwnCode ? rawCode : (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    const internalMessage = error.message || 'Внутренняя ошибка сервера';
    const isClientError = statusCode >= 400 && statusCode < 500;

    logger.error(`[${action}] Ошибка: ${internalMessage}`, {
        code,
        statusCode,
        stack: error.stack
    });

    const message = isClientError
        ? internalMessage
        : 'Внутренняя ошибка сервера. Попробуй позже.';

    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 * Проверяет подпись initData от Telegram
 */
function validateTelegramInitData(initData, botToken) {
    if (!initData || !botToken) {
        logger.warn('Отсутствуют параметры', { hasInitData: !!initData, hasBotToken: !!botToken });
        return null;
    }

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) {
            logger.warn('Отсутствует hash');
            return null;
        }
        params.delete('hash');

        const entries = [...params.entries()];
        const dataCheckString = entries
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        const authDateStr = params.get('auth_date');
        const userStr = params.get('user');
        if (!authDateStr || !userStr) {
            logger.warn('Отсутствуют обязательные поля', { hasAuthDate: !!authDateStr, hasUser: !!userStr });
            return null;
        }

        const authDate = parseInt(authDateStr, 10);
        if (!Number.isInteger(authDate)) return null;

        const now = Math.floor(Date.now() / 1000);
        const age = now - authDate;
        // initData — подписанный Telegram bearer-токен: кто им владеет, тот
        // от имени игрока. 48 часов (старое значение по умолчанию) — слишком
        // широкое окно для перехвата (ссылка, кэш браузера, прокси).
        // Telegram выдаёт initData при каждом открытии Mini App, поэтому
        // сутки достаточно: вернувшийся позже просто получит новый токен.
        const MAX_AGE = parseInt(process.env.MAX_INIT_DATA_AGE_SECONDS || '86400', 10);
        if (age < -300 || age > MAX_AGE) {
            logger.warn('initData истёк или время не синхронизировано', { age, authDate, now, maxAge: MAX_AGE });
            return null;
        }

        let user;
        let userId;
        try {
            user = JSON.parse(userStr);
            userId = user.id;
        } catch (e) {
            logger.warn('Ошибка парсинга user', { error: e.message });
            return null;
        }

        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();

        const computedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        let isValid = false;
        try {
            const hashBuf = Buffer.from(computedHash, 'hex');
            const dataHashBuf = Buffer.from(hash, 'hex');
            if (hashBuf.length === dataHashBuf.length) {
                isValid = crypto.timingSafeEqual(hashBuf, dataHashBuf);
            } else {
                logger.warn('Разная длина хешей', { expectedLength: hashBuf.length, actualLength: dataHashBuf.length });
            }
        } catch (e) {
            logger.warn({ type: 'auth_failed', reason: 'hash_compare_error', userId, error: e.message });
            return null;
        }

        if (!isValid) {
            logger.warn({ type: 'auth_failed', reason: 'hash_mismatch', userId });
            return null;
        }

        return {
            user: user,
            auth_date: authDate,
            chat_instance: params.get('chat_instance'),
            chat_type: params.get('chat_type'),
            start_param: params.get('start_param'),
            raw: Object.fromEntries(
                [...params.entries()].filter(([k]) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype')
            ),
            rawInitData: initData
        };
    } catch (err) {
        logger.error('[serverApi] Ошибка валидации Telegram', err.message, err.stack);
        return null;
    }
}

/**
 * Middleware для Express - проверяет Telegram initData
 */
function telegramAuthMiddleware(req, res, next) {
    try {
        const clientIP =
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.ip ||
            req.connection?.remoteAddress;
        const now = Date.now();
        const windowMs = 60000;
        const maxRequests = 10;

        let requests = rateLimitMap.get(clientIP) || [];
        requests = requests.filter(t => now - t < windowMs);
        if (requests.length >= maxRequests) {
            return res.status(429).json({ error: 'Too many requests' });
        }
        requests.push(now);
        rateLimitMap.set(clientIP, requests);

        const initData = req.headers['x-init-data'] || req.body?.initData;
        const botToken = process.env.TG_BOT_TOKEN;

        if (!botToken) {
            if (process.env.NODE_ENV === 'production') {
                logger.error('TG_BOT_TOKEN не настроен в production!');
                return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
            }
            logger.warn('TG_BOT_TOKEN не настроен - авторизация пропущена (development mode)');
            return next();
        }

        if (!initData) {
            return res.status(401).json({ error: 'Требуется initData' });
        }

        const validated = validateTelegramInitData(initData, botToken);
        if (!validated) {
            return res.status(401).json({ error: 'Неверная подпись initData' });
        }

        req.telegramUser = validated.user;
        req.telegramAuth = validated;
        next();
    } catch (e) {
        logger.error('telegramAuthMiddleware error', e);
        return res.status(500).json({ error: 'Ошибка авторизации' });
    }
}

module.exports = {
    // Логирование
    logger,
    requestMiddleware,
    logPlayerError,
    sanitize,

    // Валидация
    validateId,
    sanitizeName,
    // Ответы API
    ok,
    fail,
    error,
    // Универсальный обработчик ошибок для роутов. Экспортируется, чтобы
    // его поведение (сокрытие внутренних сообщений при 5xx) можно было
    // проверить тестами без поднятия HTTP-сервера
    handleError,
    notFound,
    unauthorized,
    wrap,

    // JSON утилиты
    serializeJSONField,
    safeStringify,
    safeJsonParse,
    getTelegramIdFromHeaders,

    // Транзакции с блокировкой
    withPlayerLock,

    // Логирование действий игрока: реэкспорт из utils/log.js.
    // Отдельно от logger/logPlayerError выше, потому что используется
    // другими модулями (роуты логируют действия, db/players.js — начисление
    // опыта). Определение живёт в utils/log.js, здесь только ссылка на него.
    logPlayerAction,

    // Обработка ошибок
    ERROR_MESSAGES,
    // Утилиты игроков
    getPlayerByTelegramId,

    // Telegram авторизация
    validateTelegramInitData,
    telegramAuthMiddleware,

    // Админ утилиты
    isAdmin,

    // PlayerHelper для bosses.js и других модулей
    PlayerHelper: {
        async addExperience(playerId, exp, client = null) {
            // Импорты подняты наверх: цикл db/players.js <-> utils/serverApi.js разорван
            // переносом логирования в utils/log.js. db/players.js больше не
            // ссылается на serverApi, gameConstants и database — на этот файл
            // тоже не ссылаются.
            const { addExperienceWithLevelUp } = require('../db/players');
            const { getExpForLevel } = require('./gameConstants');
            const { pool } = require('../db/database');

            if (client) {
                return await addExperienceWithLevelUp(client, playerId, exp, getExpForLevel);
            }

            const poolClient = await pool.connect();
            try {
                await poolClient.query('BEGIN');
                const result = await addExperienceWithLevelUp(poolClient, playerId, exp, getExpForLevel);
                await poolClient.query('COMMIT');
                return result;
            } catch (err) {
                await poolClient.query('ROLLBACK');
                throw err;
            } finally {
                poolClient.release();
            }
        }
    }
};