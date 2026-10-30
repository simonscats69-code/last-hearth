/**
 * Логирование действий и ошибок игрока.
 *
 * Модуль выделен из utils/serverApi.js, чтобы разорвать циклическую
 * зависимость:
 *
 *     db/players.js  ->  utils/serverApi.js  ->  db/players.js
 *
 * serverApi грузил db/players ЛЕНИВО (require внутри PlayerHelper.addExperience),
 * а db/players грузил serverApi наверху. Такой цикл работает, но хрупок:
 * любой новый require на верхнем уровне в любом из этих файлов превратит
 * модуль в частично инициализированный, и ошибка проявится не при старте,
 * а в середине игры — при первом вызове начисления опыта.
 *
 * Теперь db/players.js импортирует логирование отсюда, а не из serverApi,
 * и цикл разорван на уровне модулей, без ленивых require.
 *
 * Зависимости: только db/database (для query) и winston. Обратных ссылок
 * на serverApi нет — поэтому serverApi может импортировать этот модуль.
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { query } = require('../db/database');

/**
 * Таблица журнала действий. Раньше константа жила в serverApi.js.
 */
const TABLES = Object.freeze({
    PLAYER_ACTIONS: 'player_logs'
});

// Создаём директорию для логов
const logDir = path.join(__dirname, '../logs');
try {
    fs.mkdirSync(logDir, { recursive: true });
} catch (err) {
    if (err.code !== 'EEXIST') throw err;
}

// JSON формат для продакшена
const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
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

// ВСЕГДА добавляем консольный транспорт (и в production тоже),
// иначе в контейнерах логи не видны вовсе (файлы не читаются без exec).
transports.push(
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            winston.format.printf(({ level, message, timestamp, stack, ...rest }) => {
                let msg = message;
                if (typeof message === 'object' && message !== null) {
                    msg = JSON.stringify(message, null, 2);
                }
                const meta = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
                if (stack) {
                    return `${timestamp} ${level}: ${msg}${meta}\n${stack}`;
                }
                return `${timestamp} ${level}: ${msg}${meta}`;
            })
        )
    })
);

const allowedLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
const requestedLevel = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const loggerLevel = allowedLevels.includes(requestedLevel) ? requestedLevel : 'info';

const logger = winston.createLogger({
    level: loggerLevel,
    format: jsonFormat,
    defaultMeta: { service: 'last-hearth-api' },
    transports
});

logger.on('error', (err) => {
    console.error('Logger subsystem error:', err && err.message, err && err.stack);
});

/**
 * Сериализация значения в JSON-строку (безопасная).
 */
function serializeJSONField(value) {
    if (value === undefined || value === null) return '{}';
    if (typeof value === 'function' || typeof value === 'symbol') return '{}';
    if (typeof value === 'bigint') return JSON.stringify(value.toString());
    try {
        const s = JSON.stringify(value);
        return typeof s === 'string' ? s : '{}';
    } catch (error) {
        logger.warn('serializeJSONField failed', { error: error.message, stack: error.stack });
        return '{}';
    }
}

/**
 * Централизованный обработчик ошибок логирования.
 */
function handleLogError(error, context) {
    logger.error(`[${context}] Ошибка логирования`, { message: error.message, stack: error.stack });
}

/**
 * Универсальное логирование действия игрока
 * @param {number} playerId - ID игрока
 * @param {string} action - Действие
 * @param {object} metadata - Метаданные
 * @param {object} client - Опциональный клиент БД (для использования внутри транзакции)
 */
async function logPlayerAction(playerId, action, metadata = {}, client = null) {
    if (playerId == null || typeof action !== 'string' || !action.trim()) {
        logger.error('[logPlayerAction] Некорректные параметры');
        return;
    }

    try {
        const execFn = client
            ? (sql, params) => client.query(sql, params)
            : (sql, params) => query(sql, params);

        await execFn(
            `INSERT INTO ${TABLES.PLAYER_ACTIONS} (player_id, action, metadata, created_at) VALUES ($1, $2, $3, NOW())`,
            [playerId, action, serializeJSONField(metadata)]
        );
    } catch (error) {
        // Внутри транзакции (client передан) — пробрасываем ошибку,
        // чтобы транзакция откатилась и операция+лог были атомарны.
        // Вне транзакции — глотаем ошибку, чтобы логирование не ломало игровые операции.
        if (client) {
            throw error;
        }
        handleLogError(error, 'logPlayerAction');
    }
}

/**
 * Логирование ошибок игрока
 */
function logPlayerError(playerId, error, context = {}) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({
        type: 'player_error',
        playerId,
        message: err.message,
        stack: err.stack,
        ...context
    });
}

module.exports = {
    logger,
    logPlayerAction,
    logPlayerError,
    serializeJSONField,
    handleLogError
};
