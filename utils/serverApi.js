/**
 * Объединённый модуль серверных утилит для Last Hearth
 * Объединяет: валидацию, ответы API, транзакции, логирование, обработку ошибок, Telegram авторизацию
 * 
 * Объединённые модули:
 * - apiHelpers.js (валидация, ответы API)
 * - transactions.js (транзакции, блокировки, логирование)
 * - jsonHelper.js (работа с JSON)
 * - errorHandler.js (обработка ошибок)
 * - logger.js (логирование)
 * - telegramAuth.js (авторизация Telegram)
 * - playerHelper.js (работа с игроками)
 */



const { query, queryOne, transaction: tx, pool } = require('../db/database');
const playerService = require('../playerService');
const winston = require('winston');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');



const ERROR_CODES = {
    // 4xx клиентские ошибки
    BAD_REQUEST: { status: 400, message: 'Некорректный запрос' },
    UNAUTHORIZED: { status: 401, message: 'Требуется авторизация' },
    FORBIDDEN: { status: 403, message: 'Доступ запрещён' },
    NOT_FOUND: { status: 404, message: 'Ресурс не найден' },
    TOO_MANY_REQUESTS: { status: 429, message: 'Слишком много запросов' },
    
    // 5xx серверные ошибки
    INTERNAL_ERROR: { status: 500, message: 'Внутренняя ошибка сервера' },
    DATABASE_ERROR: { status: 500, message: 'Ошибка базы данных' },
    EXTERNAL_SERVICE_ERROR: { status: 502, message: 'Ошибка внешнего сервиса' },
};

const PLAYER_ACTIONS_TABLE = 'player_logs';



// Создаём директорию для логов
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// JSON формат для продакшена
const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Консольный формат для разработки
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
        let msg = message;
        if (typeof message === 'object' && message !== null) {
            msg = JSON.stringify(message, null, 2);
        }
        const cleanMeta = { ...meta };
        delete cleanMeta.level;
        delete cleanMeta.message;
        delete cleanMeta.timestamp;
        delete cleanMeta.stack;
        const metaStr = Object.keys(cleanMeta).length > 0 ? ' ' + JSON.stringify(cleanMeta) : '';
        if (stack) {
            return `${timestamp} [${level.toUpperCase()}]: ${msg}${metaStr}\n${stack}`;
        }
        return `${timestamp} [${level.toUpperCase()}]: ${msg}${metaStr}`;
    })
);

// Транспорты
const transports = [
    new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5
    }),
    new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5
    })
];

if (process.env.NODE_ENV !== 'production') {
    transports.push(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ level, message, timestamp, stack }) => {
                    let msg = message;
                    if (typeof message === 'object' && message !== null) {
                        msg = JSON.stringify(message, null, 2);
                    }
                    if (stack) {
                        return `${timestamp} ${level}: ${msg}\n${stack}`;
                    }
                    return `${timestamp} ${level}: ${msg}`;
                })
            )
        })
    );
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: jsonFormat,
    defaultMeta: { service: 'last-hearth-api' },
    transports
});

logger.on('error', err => {
    console.error('Logger error:', err);
});

/**
 * Санитайз чувствительных данных в логах
 */
function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const clone = { ...obj };
    const sensitive = ['password', 'token', 'authorization', 'secret', 'api_key', 'apikey'];
    
    for (const key of sensitive) {
        if (clone[key]) clone[key] = '***';
    }
    
    return clone;
}

/**
 * Middleware для автоматического логирования HTTP запросов
 */
function requestMiddleware(req, res, next) {
    req.requestId = randomUUID();
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        
        logger.info({
            type: 'http_request',
            requestId: req.requestId,
            method: req.method,
            url: req.originalUrl,
            query: sanitize(req.query),
            status: res.statusCode,
            duration,
            playerId: req.headers['x-telegram-id'] || 'anonymous',
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            contentLength: parseInt(req.headers['content-length']) || 0
        });
    });

    next();
}

/**
 * Логирование игровых действий
 */
function logGameAction(playerId, action, details = {}) {
    logger.info({
        type: 'game_action',
        playerId,
        action,
        ...details
    });
}

/**
 * Логирование ошибок игроков
 */
function logPlayerError(playerId, error, context = {}) {
    logger.error({
        type: 'player_error',
        playerId,
        message: error.message,
        stack: error.stack,
        ...context
    });
}

/**
 * Логирование безопасности
 */
function logSecurity(event, details = {}) {
    logger.warn({
        type: 'security',
        event,
        ...details
    });
}

const gameLogger = {
    action: logGameAction,
    security: logSecurity,
    error: logPlayerError
};



/**
 * Проверка ID (целое число > 0)
 */
function validateId(value, fieldName = 'ID') {
    if (value === undefined || value === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    if (!Number.isInteger(value) || value <= 0) {
        return { valid: false, error: `${fieldName} должен быть целым числом > 0`, code: 'INVALID_ID' };
    }
    return { valid: true };
}

/**
 * Проверка строки с различными опциями
 */
function validateString(value, fieldName = 'строка', options = {}) {
    const { minLength = 1, maxLength = 100, pattern } = options;
    
    if (value === undefined || value === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    
    if (typeof value !== 'string') {
        return { valid: false, error: `${fieldName} должна быть строкой`, code: 'INVALID_TYPE' };
    }
    
    const trimmed = value.trim();
    
    if (trimmed.length < minLength) {
        return { valid: false, error: `${fieldName} слишком короткая (мин. ${minLength} символов)`, code: 'TOO_SHORT' };
    }
    
    if (trimmed.length > maxLength) {
        return { valid: false, error: `${fieldName} слишком длинная (макс. ${maxLength} символов)`, code: 'TOO_LONG' };
    }
    
    if (pattern && !pattern.test(trimmed)) {
        return { valid: false, error: `${fieldName} содержит недопустимые символы`, code: 'INVALID_FORMAT' };
    }
    
    return { valid: true, value: trimmed };
}

/**
 * Проверка индекса массива (0 <= idx < maxLength)
 */
function validateIndex(value, maxLength, fieldName = 'индекс') {
    if (value === undefined || value === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    
    if (!Number.isInteger(value)) {
        return { valid: false, error: `${fieldName} должен быть целым числом`, code: 'INVALID_TYPE' };
    }
    
    if (value < 0 || value >= maxLength) {
        return { valid: false, error: `${fieldName} должен быть в диапазоне [0, ${maxLength - 1}]`, code: 'OUT_OF_RANGE' };
    }
    
    return { valid: true };
}

/**
 * Проверка булева значения
 */
function validateBoolean(value, fieldName = 'значение') {
    if (value === undefined || value === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    
    if (typeof value === 'boolean') {
        return { valid: true };
    }
    
    if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true' || lower === 'false') {
            return { valid: true };
        }
    }
    
    return { valid: false, error: `${fieldName} должно быть булевым значением`, code: 'INVALID_TYPE' };
}

/**
 * Проверка числового диапазона
 */
function validateRange(value, min, max, fieldName = 'значение') {
    if (value === undefined || value === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    
    if (!Number.isInteger(value)) {
        return { valid: false, error: `${fieldName} должно быть целым числом`, code: 'INVALID_TYPE' };
    }
    
    if (value < min || value > max) {
        return { valid: false, error: `${fieldName} должно быть в диапазоне [${min}, ${max}]`, code: 'OUT_OF_RANGE' };
    }
    
    return { valid: true };
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
 * Проверка положительного целого числа (>= 1)
 */
function validatePositiveInt(value, fieldName = 'значение') {
    if (value === undefined || value === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    
    if (!Number.isInteger(value) || value < 1) {
        return { valid: false, error: `${fieldName} должно быть положительным целым числом`, code: 'INVALID_POSITIVE_INT' };
    }
    
    return { valid: true };
}

/**
 * Проверка количества монет
 */
function validateCoins(value) {
    if (value === undefined || value === null) {
        return { valid: false, error: 'Требуется количество монет', code: 'MISSING_FIELD' };
    }
    
    if (!Number.isInteger(value)) {
        return { valid: false, error: 'Количество монет должно быть целым числом', code: 'INVALID_TYPE' };
    }
    
    if (value < 0) {
        return { valid: false, error: 'Количество монет не может быть отрицательным', code: 'NEGATIVE_AMOUNT' };
    }
    
    const MAX_COINS = 1000000000;
    
    if (value > MAX_COINS) {
        return { valid: false, error: `Количество монет не может превышать ${MAX_COINS}`, code: 'AMOUNT_TOO_LARGE' };
    }
    
    return { valid: true };
}



/**
 * Успешный ответ с данными
 */
function ok(res, data, statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        data
    });
}

/**
 * Ошибка запроса (клиентская ошибка)
 */
function fail(res, message, code = 'ERROR', statusCode = 400) {
    return res.status(statusCode).json({
        success: false,
        error: message,
        code
    });
}

/**
 * Внутренняя ошибка сервера
 */
function error(res, message, code = 'INTERNAL_ERROR', statusCode = 500) {
    return res.status(statusCode).json({
        success: false,
        error: message,
        code
    });
}

/**
 * Ресурс не найден (404)
 */
function notFound(res, message = 'Ресурс не найден', code = 'NOT_FOUND') {
    return res.status(404).json({
        success: false,
        error: message,
        code
    });
}

/**
 * Требуется авторизация (401)
 */
function unauthorized(res, message = 'Требуется авторизация', code = 'UNAUTHORIZED') {
    return res.status(401).json({
        success: false,
        error: message,
        code
    });
}

/**
 * Доступ запрещён (403)
 */
function forbidden(res, message = 'Доступ запрещён', code = 'FORBIDDEN') {
    return res.status(403).json({
        success: false,
        error: message,
        code
    });
}

/**
 * Некорректный запрос (400)
 */
function badRequest(res, message, code = 'BAD_REQUEST') {
    return res.status(400).json({
        success: false,
        error: message,
        code
    });
}

/**
 * Middleware для валидации параметров запроса
 */
function guard(validations) {
    return function(req, res, next) {
        for (const validation of validations) {
            if (!validation.valid) {
                return fail(res, validation.error, validation.code, 400);
            }
        }
        next();
    };
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
 * Сериализация значения в JSON-строку
 */
function serializeJSONField(value) {
    if (value === undefined || value === null) {
        return '{}';
    }
    if (typeof value === 'function') {
        return '{}';
    }
    try {
        return JSON.stringify(value);
    } catch (error) {
        return '{}';
    }
}

/**
 * Безопасное превращение объекта в строку
 */
function safeStringify(obj, space) {
    if (obj === undefined || obj === null) {
        return '{}';
    }
    if (typeof obj === 'function') {
        return '{}';
    }
    try {
        return JSON.stringify(obj, null, space);
    } catch (error) {
        return '{}';
    }
}

/**
 * Безопасный парсинг JSON-строки
 */
function parseJSONField(str, defaultValue = {}) {
    if (!str || typeof str !== 'string') {
        return defaultValue;
    }
    if (!str.trim()) {
        return defaultValue;
    }
    try {
        return JSON.parse(str);
    } catch (error) {
        logger.error('[serverApi] JSON.parse failed:', { type: typeof str, preview: str?.toString?.().substring(0, 100) });
        return defaultValue;
    }
}

/**
 * Безопасный парсинг JSON (из jsonHelper.js)
 */
function safeJsonParse(str, defaultValue = null) {
    if (!str) return defaultValue;
    
    if (typeof str === 'object') {
        return str;
    }
    
    try {
        return JSON.parse(str);
    } catch (e) {
        logger.warn('safeJsonParse: failed to parse', str.substring(0, 100));
        return defaultValue;
    }
}

// Алиас для совместимости
const safeParse = safeJsonParse;



/**
 * Выполнить функцию в транзакции с блокировкой игрока
 */
async function withPlayerLock(playerId, fn) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { 
            message: 'Некорректный ID игрока', 
            code: 'INVALID_PLAYER_ID',
            statusCode: 400 
        };
    }
    
    return await tx(async () => {
        const lockedPlayer = await queryOne(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!lockedPlayer) {
            throw { 
                message: 'Игрок не найден', 
                code: 'PLAYER_NOT_FOUND',
                statusCode: 404 
            };
        }
        
        return await fn(lockedPlayer);
    });
}

/**
 * Выполнить функцию в транзакции с блокировкой клана
 */
async function withClanLock(clanId, fn) {
    if (!Number.isInteger(clanId) || clanId <= 0) {
        throw { 
            message: 'Некорректный ID клана', 
            code: 'INVALID_CLAN_ID',
            statusCode: 400 
        };
    }
    
    return await tx(async () => {
        const lockedClan = await queryOne(
            'SELECT * FROM clans WHERE id = $1 FOR UPDATE',
            [clanId]
        );
        
        if (!lockedClan) {
            throw { 
                message: 'Клан не найден', 
                code: 'CLAN_NOT_FOUND',
                statusCode: 404 
            };
        }
        
        return await fn(lockedClan);
    });
}

/**
 * Выполнить функцию в транзакции с блокировкой игрока и клана
 */
async function withPlayerAndClanLock(playerId, clanId, fn) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { 
            message: 'Некорректный ID игрока', 
            code: 'INVALID_PLAYER_ID',
            statusCode: 400 
        };
    }
    
    if (!Number.isInteger(clanId) || clanId <= 0) {
        throw { 
            message: 'Некорректный ID клана', 
            code: 'INVALID_CLAN_ID',
            statusCode: 400 
        };
    }
    
    return await tx(async () => {
        const lockedPlayer = await queryOne(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!lockedPlayer) {
            throw { 
                message: 'Игрок не найден', 
                code: 'PLAYER_NOT_FOUND',
                statusCode: 404 
            };
        }
        
        const lockedClan = await queryOne(
            'SELECT * FROM clans WHERE id = $1 FOR UPDATE',
            [clanId]
        );
        
        if (!lockedClan) {
            throw { 
                message: 'Клан не найден', 
                code: 'CLAN_NOT_FOUND',
                statusCode: 404 
            };
        }
        
        return await fn(lockedPlayer, lockedClan);
    });
}



/**
 * Middleware: проверка что игрок состоит в клане
 */
function ensureInClan(req, res, next) {
    const playerId = req.player?.id;
    
    if (!playerId) {
        return res.status(401).json({ 
            success: false, 
            error: 'Требуется авторизация',
            code: 'UNAUTHORIZED'
        });
    }
    
    queryOne(
        'SELECT c.*, pc.role as clan_role FROM players p ' +
        'LEFT JOIN clans c ON p.clan_id = c.id ' +
        'LEFT JOIN player_clans pc ON pc.player_id = p.id AND pc.clan_id = c.id ' +
        'WHERE p.id = $1',
        [playerId]
    ).then(playerWithClan => {
        if (!playerWithClan || !playerWithClan.clan_id) {
            return res.status(400).json({
                success: false,
                error: 'Вы не состоите в клане',
                code: 'NOT_IN_CLAN'
            });
        }
        
        req.clan = {
            id: playerWithClan.clan_id,
            name: playerWithClan.name,
            role: playerWithClan.clan_role,
            leaderId: playerWithClan.leader_id,
            membersCount: playerWithClan.members_count,
            level: playerWithClan.level
        };
        req.playerClan = playerWithClan;
        
        next();
    }).catch(err => {
        logger.error({ type: 'ensureInClan_error', message: err.message });
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки клана',
            code: 'INTERNAL_ERROR'
        });
    });
}

/**
 * Middleware: проверка что игрок - лидер клана
 */
function ensureLeader(req, res, next) {
    if (!req.clan) {
        return res.status(400).json({
            success: false,
            error: 'Сначала проверьте членство в клане (ensureInClan)',
            code: 'MIDDLEWARE_ORDER_ERROR'
        });
    }
    
    if (req.clan.role !== 'leader') {
        return res.status(403).json({
            success: false,
            error: 'Только лидер клана может это сделать',
            code: 'NOT_LEADER'
        });
    }
    
    next();
}



/**
 * Проверить достаточно ли ресурсов у игрока
 */
function checkResources(player, resources, options = {}) {
    const { allowNegative = false } = options;
    
    if (resources.coins !== undefined) {
        if (!allowNegative && resources.coins < 0) {
            return { valid: false, error: 'Количество монет не может быть отрицательным', code: 'INVALID_AMOUNT' };
        }
        if (player.coins < resources.coins) {
            return { 
                valid: false, 
                error: `Недостаточно монет. Требуется: ${resources.coins}, у вас: ${player.coins}`,
                code: 'INSUFFICIENT_COINS',
                required: resources.coins,
                available: player.coins
            };
        }
    }
    
    if (resources.stars !== undefined) {
        if (!allowNegative && resources.stars < 0) {
            return { valid: false, error: 'Количество звёзд не может быть отрицательным', code: 'INVALID_AMOUNT' };
        }
        if (player.stars < resources.stars) {
            return { 
                valid: false, 
                error: `Недостаточно звёзд. Требуется: ${resources.stars}, у вас: ${player.stars}`,
                code: 'INSUFFICIENT_STARS',
                required: resources.stars,
                available: player.stars
            };
        }
    }
    
    if (resources.energy !== undefined) {
        if (!allowNegative && resources.energy < 0) {
            return { valid: false, error: 'Энергия не может быть отрицательной', code: 'INVALID_AMOUNT' };
        }
        if (player.energy < resources.energy) {
            return { 
                valid: false, 
                error: `Недостаточно энергии. Требуется: ${resources.energy}, у вас: ${player.energy}`,
                code: 'INSUFFICIENT_ENERGY',
                required: resources.energy,
                available: player.energy
            };
        }
    }
    
    if (resources.health !== undefined) {
        if (!allowNegative && resources.health < 0) {
            return { valid: false, error: 'Здоровье не может быть отрицательным', code: 'INVALID_AMOUNT' };
        }
        if (player.health < resources.health) {
            return { 
                valid: false, 
                error: `Недостаточно здоровья. Требуется: ${resources.health}, у вас: ${player.health}`,
                code: 'INSUFFICIENT_HEALTH',
                required: resources.health,
                available: player.health
            };
        }
    }
    
    return { valid: true };
}

/**
 * Проверить лимит клана (участники)
 */
function checkClanMembersLimit(clan, additionalMembers = 1) {
    if (!clan) {
        return { valid: false, error: 'Клан не найден', code: 'CLAN_NOT_FOUND' };
    }
    
    const currentMembers = clan.members_count || 0;
    const maxMembers = clan.max_members || 50;
    
    if (currentMembers + additionalMembers > maxMembers) {
        return { 
            valid: false, 
            error: `Клан полный. Максимум участников: ${maxMembers}`,
            code: 'CLAN_FULL',
            current: currentMembers,
            max: maxMembers
        };
    }
    
    return { valid: true };
}



/**
 * Универсальная пагинация
 */
async function paginate(countSql, countParams, dataSql, dataParams, options = {}) {
    const { defaultLimit = 10, maxLimit = 50 } = options;
    
    let limit = defaultLimit;
    let offset = 0;
    
    if (options.page !== undefined && options.limit !== undefined) {
        limit = Math.min(Math.max(1, options.limit), maxLimit);
        offset = (options.page - 1) * limit;
    } else if (options.limit !== undefined) {
        limit = Math.min(Math.max(1, options.limit), maxLimit);
        offset = options.offset || 0;
    }
    
    const totalResult = await query(countSql, countParams);
    const total = parseInt(totalResult.rows[0]?.count || 0, 10);
    
    const dataResult = await query(
        `${dataSql} LIMIT $${dataParams.length + 1} OFFSET $${dataParams.length + 2}`,
        [...dataParams, limit, offset]
    );
    
    const page = Math.floor(offset / limit) + 1;
    const hasMore = offset + dataResult.rows.length < total;
    
    return {
        data: dataResult.rows,
        total,
        page,
        limit,
        hasMore,
        rows: dataResult.rows,
        count: total
    };
}



/**
 * Централизованный обработчик ошибок логирования
 */
function handleLogError(error, context) {
    logger.error(`[${context}] Ошибка логирования:`, error.message);
}

/**
 * Логирование действия игрока в БД
 */
async function logPlayerAction(poolConnection, playerId, action, meta = {}) {
    if (!poolConnection || !playerId || !action) {
        logger.error('[logPlayerAction] Некорректные параметры');
        return;
    }

    try {
        const serializedMeta = serializeJSONField(meta);
        await poolConnection.query(
            `INSERT INTO ${PLAYER_ACTIONS_TABLE} (player_id, action, metadata, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, serializedMeta]
        );
    } catch (error) {
        handleLogError(error, 'logPlayerAction');
    }
}

/**
 * Логирование действия игрока в рамках транзакции
 */
async function logPlayerActionWithTx(txConnection, playerId, action, meta = {}) {
    if (!txConnection || !playerId || !action) {
        logger.error('[logPlayerActionWithTx] Некорректные параметры');
        return;
    }

    try {
        const serializedMeta = serializeJSONField(meta);
        await txConnection.query(
            `INSERT INTO ${PLAYER_ACTIONS_TABLE} (player_id, action, metadata, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, serializedMeta]
        );
    } catch (error) {
        handleLogError(error, 'logPlayerActionWithTx');
    }
}

/**
 * Универсальное логирование действия игрока (работает с query, pool или tx client)
 * @param {Function|object} queryFn - Функция запроса (query из database.js) или client объект
 * @param {number} playerId - ID игрока
 * @param {string} action - Действие
 * @param {object} metadata - Метаданные
 */
async function logPlayerActionSimple(queryFn, playerId, action, metadata = {}) {
    try {
        // Определяем, передан ли pool/client или функция query
        let execFn;
        if (typeof queryFn === 'function') {
            execFn = queryFn;
        } else if (queryFn && typeof queryFn.query === 'function') {
            execFn = queryFn.query.bind(queryFn);
        } else {
            logger.warn('[logPlayerActionSimple] Некорректный параметр queryFn');
            return;
        }
        
        await execFn(
            `INSERT INTO ${PLAYER_ACTIONS_TABLE} (player_id, action, metadata, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, serializeJSONField(metadata)]
        );
    } catch (error) {
        handleLogError(error, 'logPlayerActionSimple');
    }
}



/**
 * Фабрика стандартизированного ответа об ошибке
 */
function createErrorResponse(errorType, options = {}) {
    const errorConfig = ERROR_CODES[errorType] || ERROR_CODES.INTERNAL_ERROR;
    
    const response = {
        error: options.message || errorConfig.message,
        type: errorType,
    };
    
    if (options.details && process.env.NODE_ENV !== 'production') {
        response.details = options.details;
    }
    
    return response;
}

/**
 * Middleware для централизованной обработки ошибок
 */
function errorMiddleware(err, req, res, next) {
    logger.error({
        type: 'request_error',
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
    });
    
    let statusCode = 500;
    let errorType = 'INTERNAL_ERROR';
    
    if (err.name === 'ValidationError' || err.name === 'CastError') {
        statusCode = 400;
        errorType = 'BAD_REQUEST';
    } else if (err.name === 'UnauthorizedError') {
        statusCode = 401;
        errorType = 'UNAUTHORIZED';
    } else if (err.code === '23505') {
        statusCode = 409;
        errorType = 'CONFLICT';
    }
    
    res.status(statusCode).json(createErrorResponse(errorType, {
        message: err.message,
    }));
}

/**
 * Async wrapper для обработки ошибок в роутерах
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Функция для обработки ошибок БД
 */
function handleDbError(err, context = 'DB_OPERATION') {
    logger.error({
        type: 'database_error',
        context,
        message: err.message,
        code: err.code,
    });
    
    return createErrorResponse('DATABASE_ERROR');
}

/**
 * Универсальный обработчик ошибок для роутов
 */
function handleError(res, error, action = 'unknown') {
    const code = error.code || 'UNKNOWN_ERROR';
    const message = error.message || 'Внутренняя ошибка сервера';
    const statusCode = error.statusCode || 500;

    logger.error(`[${action}] Ошибка: ${message}`, {
        code,
        stack: error.stack
    });

    return res.status(statusCode).json({
        success: false,
        error: message,
        code
    });
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

        logger.info('Валидация initData', {
            hasDataHash: !!hash,
            paramsCount: entries.length,
            dataCheckStringLength: dataCheckString.length
        });

        const authDateStr = params.get('auth_date');
        const userStr = params.get('user');
        if (!authDateStr || !userStr) {
            logger.warn('Отсутствуют обязательные поля', { 
                hasAuthDate: !!authDateStr, 
                hasUser: !!userStr,
                keys: [...params.keys()]
            });
            return null;
        }

        const authDate = parseInt(authDateStr, 10);
        const now = Math.floor(Date.now() / 1000);
        const age = now - authDate;
        if (age < -300 || age > 86400) {
            logger.warn('initData истёк или время не синхронизировано', { age, authDate, now });
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

        logger.info('Проверка подписи', {
            userId,
            dataKeys: [...params.keys()].sort(),
            dataCheckStringLength: dataCheckString.length
        });

        const computedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');

        let isValid = false;
        try {
            const hashBuf = Buffer.from(computedHash, 'hex');
            const dataHashBuf = Buffer.from(hash, 'hex');
            
            logger.info('Сравнение хешей', {
                userId,
                hashMatch: computedHash === hash,
                computedLength: hashBuf.length,
                receivedLength: dataHashBuf.length
            });
            
            if (hashBuf.length === dataHashBuf.length) {
                isValid = crypto.timingSafeEqual(hashBuf, dataHashBuf);
            } else {
                logger.warn('Разная длина хешей', { expectedLength: hashBuf.length, actualLength: dataHashBuf.length });
            }
        } catch (e) {
            logger.warn({ type: 'ws_auth_failed', reason: 'hash_compare_error', userId, error: e.message });
            return null;
        }
        
        if (!isValid) {
            logger.warn({ type: 'ws_auth_failed', reason: 'hash_mismatch', userId });
            return null;
        }

        return {
            user: user,
            auth_date: authDate,
            chat_instance: params.get('chat_instance'),
            chat_type: params.get('chat_type'),
            start_param: params.get('start_param'),
            raw: Object.fromEntries(params),
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
    const initData = req.headers['x-init-data'] || req.body.initData;
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
}

/**
 * Проверяет является ли пользователь админом
 */
function isAdmin(telegramId, adminIds) {
    if (!adminIds || !Array.isArray(adminIds)) {
        return false;
    }
    return adminIds.includes(String(telegramId));
}



const PlayerHelper = {
    /**
     * Получить игрока по Telegram ID
     */
    async getByTelegramId(telegramId) {
        return await playerService.getByTelegramId(telegramId);
    },
    
    /**
     * Получить игрока по ID
     */
    async getById(playerId) {
        return await playerService.getById(playerId);
    },
    
    /**
     * Обновить инвентарь
     */
    async updateInventory(playerId, inventory) {
        return await playerService.updateInventory(playerId, inventory);
    },
    
    /**
     * Обновить энергию
     */
    async updateEnergy(playerId, energyChange) {
        return await playerService.updateEnergy(playerId, energyChange);
    },
    
    /**
     * Обновить здоровье
     */
    async updateHealth(playerId, health) {
        return await playerService.updateHealth(playerId, health);
    },
    
    /**
     * Увеличить счётчик действий
     */
    async incrementActions(playerId) {
        return await playerService.incrementActions(playerId);
    },
    
    /**
     * Регенерировать энергию
     */
    async regenerateEnergy(playerId) {
        return await playerService.regenerateEnergy(playerId);
    },
    
    /**
     * Добавить опыт
     */
    async addExperience(playerId, exp, client = null) {
        return await playerService.addExperience(playerId, exp, client);
    }
};



module.exports = {
    // Логирование
    logger,
    requestMiddleware,
    logGameAction,
    logPlayerError,
    logSecurity,
    gameLogger,
    sanitize,
    
    // Валидация
    validateId,
    validateString,
    validateIndex,
    validateBoolean,
    validateRange,
    sanitizeName,
    validatePositiveInt,
    validateCoins,
    
    // Ответы API
    ok,
    fail,
    error,
    notFound,
    unauthorized,
    forbidden,
    badRequest,
    guard,
    wrap,
    
    // JSON утилиты
    serializeJSONField,
    safeStringify,
    parseJSONField,
    safeJsonParse,
    safeParse,
    
    // Транзакции с блокировкой
    withPlayerLock,
    withClanLock,
    withPlayerAndClanLock,
    
    // Middleware для клана
    ensureInClan,
    ensureLeader,
    
    // Валидация ресурсов
    checkResources,
    checkClanMembersLimit,
    
    // Пагинация
    paginate,
    
    // Логирование игроков
    logPlayerAction,
    logPlayerActionWithTx,
    logPlayerActionSimple,
    PLAYER_ACTIONS_TABLE,
    
    // Обработка ошибок
    ERROR_CODES,
    createErrorResponse,
    errorMiddleware,
    asyncHandler,
    handleDbError,
    handleError,
    
    // Telegram авторизация
    validateTelegramInitData,
    telegramAuthMiddleware,
    isAdmin,
    
    // Player Helper
    PlayerHelper
};
