/**
 * Игровой API-сервер (Last Hearth)
 * База: обработка запросов, API-ответы, БД, логирование действий игрока,
 * авторизация через Telegram initData, обработка ошибок.
 */

const crypto = require('crypto');
const { transaction } = require('../db/database');
const { randomUUID } = crypto;
const { recordRequest } = require('./metrics');

// logger и logPlayerAction берутся из utils/log.js (единственный источник truth).
// db/players.js -> utils/serverApi.js -> db/players.js — цикл,
// поэтому PlayerHelper.addExperience вызывается лениво внутри функции.
// Серверная валидация ID идёт через utils/validate.js.
const { logger, logPlayerAction, logPlayerError, serializeJSONField } = require('./log');
const { validateId } = require('./validate');

const ERROR_MESSAGES = Object.freeze({
    INSUFFICIENT_COINS: 'Недостаточно монет',
    INSUFFICIENT_STARS: 'Недостаточно звёзд',
    INSUFFICIENT_ENERGY: 'Недостаточно энергии',
    INSUFFICIENT_HEALTH: 'Недостаточно здоровья'
});

/**
 * Проверка игрока по Telegram ID.
 */

/**
 * Проверка лимита запросов (rate-limit) по идентификатору (IP или playerId).
 * Реализация на in-memory Map для кэша.
 *
 * @param {string} identifier - IP или playerId
 * @param {number} maxRequests - максимум запросов за окно
 * @param {number} windowMs - размер окна в мс
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
async function checkRateLimit(identifier, maxRequests = 1000, windowMs = 60000) {
    try {
        const { query, transaction } = require('../db/database');

        const windowStart = new Date(Date.now() - windowMs);

        // Очистка старых окон (cleanup).
        await query(
            `DELETE FROM rate_limits WHERE window_start < $1`,
            [windowStart]
        );

        // Проверка существующего окна для идентификатора.
        const result = await transaction(async (client) => {
            const existing = await client.query(
                `SELECT request_count, window_start FROM rate_limits
                 WHERE identifier = $1 AND window_start >= $2
                 ORDER BY window_start DESC LIMIT 1`,
                [identifier, windowStart]
            );

            if (existing.rows[0]) {
                const newCount = existing.rows[0].request_count + 1;
                await client.query(
                    `UPDATE rate_limits SET request_count = $1 WHERE identifier = $2 AND window_start = $3`,
                    [newCount, identifier, existing.rows[0].window_start]
                );
                return { count: newCount, windowStart: existing.rows[0].window_start };
            } else {
                const insertResult = await client.query(
                    `INSERT INTO rate_limits (identifier, window_start, request_count)
                     VALUES ($1, NOW(), 1)
                     RETURNING window_start`,
                    [identifier]
                );
                return { count: 1, windowStart: insertResult.rows[0].window_start };
            }
        });

        const allowed = result.count <= maxRequests;
        const remaining = Math.max(0, maxRequests - result.count);
        const resetAt = new Date(result.windowStart).getTime() + windowMs;

        return { allowed, remaining, resetAt };
    } catch (err) {
        // Fail-closed: при ошибке БД запрещаем запрос (не пропускаем без лимита).
        logger.error('[rateLimit] check failed, denying request', { error: err.message, identifier });
        return { allowed: false, remaining: 0, resetAt: Date.now() + windowMs };
    }
}

/**
 * Middleware rate-limiting для Express.
 *
 * Используется x-telegram-id для идентификации. При отсутствии — 'anonymous'.
 * Полная реализация через express-rate-limit в routes/game/index.js.
 * Здесь остаётся легковесный checkRateLimit.
 */

/**
 * Санитизация объекта для логов (удаление чувствительных данных).
 */
function sanitize(obj, seen = new WeakSet()) {
    if (!obj || typeof obj !== 'object') return obj;
    if (seen.has(obj)) return '[Circular]';

    const sensitive = ['password', 'token', 'authorization', 'secret', 'api_key', 'apikey', 'init_data', 'init-data', 'x-init-data', 'x-telegram-init-data'];
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
 * Извлечение Telegram ID из заголовков HTTP-запроса.
 *
 * Берёт initData из x-telegram-init-data или x-init-data.
 * Если заголовков нет (curl и т.д.) — возвращает null (аналог 'anonymous').
 * Полная валидация initData делается в validateTelegramInitData / telegramAuthMiddleware.
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
 * Middleware логирования HTTP-запросов.
 */
function requestMiddleware(req, res, next) {
    req.requestId = randomUUID();
    const start = Date.now();

    res.on('finish', () => {
        try {
            const duration = Date.now() - start;
            const isProd = process.env.NODE_ENV === 'production';

            // Отправка метрик в metrics.js (один источник truth для метрик).
            try {
                recordRequest(req.path || req.url || 'unknown', res.statusCode, duration);
            } catch {
                // Ошибка метрик не блокирует ответ.
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

            const path = req.originalUrl || req.url || '';
            const isStatic = /\.(css|js|mjs|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|mp[34])($|\?)/i.test(path);
            const isQuiet = isStatic || (req.method === 'GET' && res.statusCode < 400);

            if (!isQuiet) {
                logger.info(entry);
            } else {
                logger.debug(entry);
            }
        } catch (e) {
            logger.error('Logging failed', { error: e.message });
        }
    });

    next();
}

/**
 * Валидация имени (trim, проверка длины и алфавита).
 */
function sanitizeName(name, maxLength = 50) {
    const max = Number.isSafeInteger(maxLength) && maxLength > 0 ? maxLength : 50;
    if (name === undefined || name === null) {
        return { ok: false, valid: false, error: 'Поле не указано', code: 'MISSING_FIELD' };
    }
    if (typeof name !== 'string') {
        return { ok: false, valid: false, error: 'Поле должно быть строкой', code: 'INVALID_TYPE' };
    }
    let sanitized = name.normalize('NFC').trim();
    sanitized = sanitized.replace(/[^\w\s\u0430-\u044f\u0410-\u042f\u0451\u0401]/g, '');
    sanitized = sanitized.replace(/\s+/g, ' ');
    if (sanitized.length === 0) {
        return { ok: false, valid: false, error: 'Поле не может быть пустым или содержать только пробелы', code: 'EMPTY_VALUE' };
    }
    if (sanitized.length > max) {
        return { ok: false, valid: false, error: `Поле слишком длинное (макс. ${max} символов)`, code: 'TOO_LONG', value: sanitized.substring(0, max) };
    }
    return { ok: true, valid: true, value: sanitized };
}

/**
 * Успешный ответ API.
 */
function ok(res, data, statusCode = 200) {
    return res.status(statusCode).json({ success: true, data });
}

/**
 * Ответ об ошибке клиента (по умолчанию 400).
 */
function fail(res, message, code = 'ERROR', statusCode = 400) {
    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 * Внутренняя ошибка сервера (по умолчанию 500).
 */
function error(res, message, code = 'INTERNAL_ERROR', statusCode = 500) {
    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 * Ответ "не найдено" (404).
 */
function notFound(res, message = 'Не найдено', code = 'NOT_FOUND') {
    return res.status(404).json({ success: false, error: message, code });
}

/**
 * Ответ "не авторизован" (401).
 */
function unauthorized(res, message = 'Требуется авторизация', code = 'UNAUTHORIZED') {
    return res.status(401).json({ success: false, error: message, code });
}

/**
 * Проверка авторизации игрока.
 * Возвращает true, если autorizado, иначе отправляет 401 и возвращает false.
 */
function requireAuth(req, res) {
    if (!req.player || !req.player.id) {
        unauthorized(res);
        return false;
    }
    return true;
}

/**
 * Валидация ID босса (целое > 0).
 */
function requireBossId(res, bossId) {
    if (!bossId || bossId <= 0 || !Number.isInteger(bossId)) {
        fail(res, 'Некорректный ID босса', 'INVALID_BOSS_ID');
        return false;
    }
    return true;
}

/**
 * Валидация ID рейда (целое > 0).
 */
function requireRaidId(res, raidId) {
    if (!raidId || raidId <= 0 || !Number.isInteger(raidId)) {
        fail(res, 'Некорректный ID рейда', 'INVALID_RAID_ID');
        return false;
    }
    return true;
}

/**
 * Валидация ID предмета (безопасное целое > 0).
 */
function requireItemId(res, itemId) {
    if (!itemId || itemId <= 0 || !Number.isSafeInteger(itemId)) {
        fail(res, 'Некорректный ID предмета', 'INVALID_ITEM_ID');
        return false;
    }
    return true;
}

/**
 * Увеличение счетчика собранных предметов (items_collected) на 1.
 */
function incrementItemsCollected(client, playerId, amount = 1) {
    return client.query(
        `UPDATE players SET items_collected = COALESCE(items_collected, 0) + $1 WHERE id = $2`,
        [amount, playerId]
    );
}

/**
 * Обёртка для промисов в Express-маршрутах (catch ошибок в next).
 */
function wrap(fn) {
    return function(req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Безопасная сериализация объекта в строку.
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
 * Безопасный парсинг JSON.
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
 * Блокировка игрока (SELECT ... FOR UPDATE) с валидацией ID.
 * @param {number} playerId - ID игрока
 * @param {function} fn - функция с client и lockedPlayer
 * @param {number} timeoutMs - таймаут операции (по умолчанию 10 сек)
 */
async function withPlayerLock(playerId, fn, timeoutMs = 10000) {
    const idCheck = validateId(playerId, 'ID игрока');
    if (!idCheck.ok) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    const id = idCheck.value;

    return await transaction(async (client) => {
        await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);

        const lockedPlayer = await client.query(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [id]
        );

        if (!lockedPlayer.rows[0]) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        return await fn(client, lockedPlayer.rows[0]);
    });
}

/**
 * Единый обработчик ошибок для маршрутов.
 * Клиентские ошибки (4xx) отдают message как есть, серверные (5xx) — общий текст.
 */
function handleError(res, error, action = 'unknown', playerId = null) {
    const statusCode = error.statusCode || 500;
    const rawCode = typeof error.code === 'string' ? error.code : '';
    const isOwnCode = /^[A-Z][A-Z0-9_]{2,}$/.test(rawCode);
    const code = isOwnCode ? rawCode : (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    const internalMessage = error.message || 'Внутренняя ошибка сервера';
    const isClientError = statusCode >= 400 && statusCode < 500;

    logger.error(`[${action}] Ошибка: ${internalMessage}`, {
        code,
        statusCode,
        playerId,
        stack: error.stack
    });

    // Уведомление админу в Telegram при 5xx.
    if (statusCode >= 500) {
        try {
            const { notifyAdminSync } = require('./telegramNotifier');
            notifyAdminSync(`[${action}] ${internalMessage}`, {
                stack: error.stack,
                playerId,
                context: action
            });
        } catch (_) { /* ignore */ }
    }

    const message = isClientError
        ? internalMessage
        : 'Внутренняя ошибка сервера. Повторите позже.';

    return res.status(statusCode).json({ success: false, error: message, code });
}

/**
 * Валидация initData от Telegram.
 */
function validateTelegramInitData(initData, botToken) {
    if (!initData || !botToken) {
        logger.warn('Отсутствуют initData или botToken', { hasInitData: !!initData, hasBotToken: !!botToken });
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
            logger.warn('Отсутствуют auth_date или user', { hasAuthDate: !!authDateStr, hasUser: !!userStr });
            return null;
        }

        const authDate = parseInt(authDateStr, 10);
        if (!Number.isInteger(authDate)) return null;

        const now = Math.floor(Date.now() / 1000);
        const age = now - authDate;
        const MAX_AGE = Number.isFinite(parseInt(process.env.MAX_INIT_DATA_AGE_SECONDS || '3600', 10)) ? parseInt(process.env.MAX_INIT_DATA_AGE_SECONDS || '3600', 10) : 3600;
        if (age < -300 || age > MAX_AGE) {
            logger.warn('initData истекла или из будущего', { age, authDate, now, maxAge: MAX_AGE });
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
                logger.warn('Неверная длина хеша', { expectedLength: hashBuf.length, actualLength: dataHashBuf.length });
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
 * Middleware авторизации через Telegram initData.
 */
async function telegramAuthMiddleware(req, res, next) {
    try {
        // Rate limit для /auth (10 запросов в минуту на IP).
        const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';

        const { allowed, remaining, resetAt } = await checkRateLimit(clientIP, 10, 60000);
        res.set('X-RateLimit-Limit', 10);
        res.set('X-RateLimit-Remaining', remaining);
        res.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

        if (!allowed) {
            return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' });
        }

        const initData = req.headers['x-init-data'] || req.body?.initData;
        const botToken = process.env.TG_BOT_TOKEN;

        if (!botToken) {
            // Fail-closed: доступ запрещён без токена, кроме DEV_MODE.
            if (process.env.DEV_MODE === 'true') {
                logger.warn('TG_BOT_TOKEN не задан — авторизация пропускается (DEV_MODE=true)');
                return next();
            }
            logger.error('TG_BOT_TOKEN не задан — авторизация невозможна');
            return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
        }

        if (!initData) {
            return res.status(401).json({ error: 'Требуется initData' });
        }

        const validated = validateTelegramInitData(initData, botToken);
        if (!validated) {
            return res.status(401).json({ error: 'Неверный initData' });
        }

        req.telegramUser = validated.user;
        req.telegramAuth = validated;
        next();
    } catch (e) {
        logger.error('telegramAuthMiddleware error', e);
        return res.status(500).json({ error: 'Ошибка авторизации' });
    }
}

/**
 * Middleware идемпотентности (Idempotency-Key) для POST/PUT/PATCH/DELETE.
 * Ключ формируется из playerId + idempotency-key (или авто-ключ).
 */
async function idempotencyMiddleware(req, res, next) {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return next();
    }

    const idempotencyKey = req.headers['idempotency-key'] || `auto:${method}:${req.path}:${JSON.stringify(req.body || {})}`;

    const playerId = req.player?.id;
    if (!playerId) {
        return next();
    }

    const fullKey = `idem:${playerId}:${idempotencyKey}`;

    let claimed = false;
    try {
        const { query: dbQuery, queryOne } = require('../db/database');

        await dbQuery(
            `DELETE FROM idempotency_keys
              WHERE idempotency_key = $1 AND created_at < NOW() - INTERVAL '24 hours'`,
            [fullKey]
        );

        const insertResult = await dbQuery(
            `INSERT INTO idempotency_keys (idempotency_key, response_data, created_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [fullKey, {}]
        );
        claimed = insertResult.rowCount > 0;

        if (!claimed) {
            const existing = await queryOne(
                `SELECT response_data, created_at FROM idempotency_keys WHERE idempotency_key = $1`,
                [fullKey]
            );
            const isStale = existing
                && (!existing.response_data || Object.keys(existing.response_data).length === 0)
                && existing.created_at
                && (Date.now() - new Date(existing.created_at).getTime() > 5 * 60 * 1000);

            if (isStale) {
                await dbQuery(`DELETE FROM idempotency_keys WHERE idempotency_key = $1`, [fullKey]);
                const retryInsert = await dbQuery(
                    `INSERT INTO idempotency_keys (idempotency_key, response_data, created_at)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (idempotency_key) DO NOTHING`,
                    [fullKey, {}]
                );
                claimed = retryInsert.rowCount > 0;
            }

            if (!claimed && existing && existing.response_data && Object.keys(existing.response_data).length > 0) {
                logger.info('[idempotency] returning cached response', { key: idempotencyKey, playerId });
                return res.set('Idempotency-Replay', 'true').json(existing.response_data);
            }
            if (!claimed && !isStale) {
                return res.status(409).json({
                    error: 'Запрос с таким Idempotency-Key уже выполняется',
                    code: 'IDEMPOTENCY_IN_PROGRESS'
                });
            }
            if (!claimed) {
                return res.status(409).json({
                    error: 'Запрос с таким Idempotency-Key уже выполняется',
                    code: 'IDEMPOTENCY_IN_PROGRESS'
                });
            }
        }
    } catch (err) {
        logger.error('[idempotency] claim failed, failing closed', { error: err.message });
        return res.status(503).json({ error: 'Сервис временно недоступен', code: 'SERVICE_UNAVAILABLE' });
    }

    const originalJson = res.json.bind(res);
    res.json = function(data) {
        if (claimed && idempotencyKey && res.statusCode >= 200 && res.statusCode < 600) {
            res.__idempotencyData = data;
            res.__idempotencyFullKey = `idem:${playerId}:${idempotencyKey}`;
        }
        return originalJson(data);
    };

    res.on('finish', () => {
        if (claimed && idempotencyKey && res.__idempotencyData !== undefined) {
            const { query } = require('../db/database');
            query(
                `UPDATE idempotency_keys SET response_data = $2, created_at = NOW()
                  WHERE idempotency_key = $1`,
                [res.__idempotencyFullKey, res.__idempotencyData]
            ).catch(() => {});
        } else if (claimed && idempotencyKey) {
            const { query } = require('../db/database');
            query(
                `DELETE FROM idempotency_keys WHERE idempotency_key = $1`,
                [`idem:${playerId}:${idempotencyKey}`]
            ).catch(() => {});
        }
    });

    next();
}

/**
 * Проверка ошибки соединения с БД.
 * Возвращает true, если ошибка соединения (и отправляет 503).
 */
function handleConnectionError(res, error) {
    if (!error) return false;
    const code = error.code || '';
    const message = error.message || '';
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' ||
        message.includes('connect ECONNREFUSED') || message.includes('timeout') ||
        message.includes('Connection terminated')) {
        res.status(503).json({
            success: false,
            error: 'Сервис временно недоступен',
            code: 'SERVICE_UNAVAILABLE'
        });
        return true;
    }
    return false;
}

module.exports = {
    logger,
    requestMiddleware,
    logPlayerError,

    // Валидация.
    validateId,
    sanitizeName,

    // Ответы API.
    ok,
    fail,
    error,
    handleError,
    handleConnectionError,
    notFound,
    unauthorized,
    requireAuth,
    requireBossId,
    requireRaidId,
    requireItemId,
    incrementItemsCollected,
    wrap,

    // JSON helpers.
    serializeJSONField,
    safeStringify,
    safeJsonParse,
    getTelegramIdFromHeaders,

    // Блокировка игрока.
    withPlayerLock,

    // Действия игрока (логирование через utils/log.js).
    logPlayerAction,

    // Сообщения об ошибках.
    ERROR_MESSAGES,

    // Авторизация Telegram.
    validateTelegramInitData,
    telegramAuthMiddleware,

    // Идемпотентность.
    idempotencyMiddleware,

    // Rate limiting: checkRateLimit вызывается из telegramAuthMiddleware.
    // См. verify-dead-exports.js для проверки экспортов.

    // PlayerHelper для bosses.js и других маршрутов.
    PlayerHelper: {
        async addExperience(playerId, exp, client = null) {
            const { addExperienceWithLevelUp } = require('../db/players');
            const { getExpForLevel } = require('./gameConstants');

            if (client) {
                return await addExperienceWithLevelUp(client, playerId, exp, getExpForLevel);
            }

            return await transaction((poolClient) =>
                addExperienceWithLevelUp(poolClient, playerId, exp, getExpForLevel)
            );
        }
    }
};
