/**
 * Логирование для Last Hearth
 * Winston - логи в файл и консоль
 * Production-ready с JSON форматом для аналитики
 */

const winston = require('winston');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');

// Создаём директорию для логов
const logDir = path.join(__dirname, '../../logs');
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
    winston.format.printf(({ level, message, timestamp, stack }) => {
        if (stack) {
            return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
        }
        return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
);

// Транспорты
const transports = [
    // Логи ошибок
    new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5
    }),
    // Все логи
    new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5
    })
];

// Консоль только в development
if (process.env.NODE_ENV !== 'production') {
    transports.push(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ level, message, timestamp }) => {
                    return `${timestamp} ${level}: ${message}`;
                })
            )
        })
    );
}

// Основной логгер
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: jsonFormat,
    defaultMeta: { service: 'last-hearth-api' },
    transports
});

// Защита от падения логгера
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

// Хелпер для игрового логирования
const gameLogger = {
    action: logGameAction,
    security: logSecurity,
    error: logPlayerError
};

module.exports = {
    logger,
    requestMiddleware,
    logGameAction,
    logPlayerError,
    logSecurity,
    gameLogger,
    sanitize
};
