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
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
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

// NODE_ENV=test (так задаёт jest) — консоль не нужна: негативные тесты
// валидации намеренно зовут validateTelegramInitData с пустыми параметрами,
// и их warn-сообщения засоряют вывод тестов вместо отчёта jest.
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
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

logger.on('error', (err) => {
    logger.error('Logger subsystem error:', err);
});

/**
 * Сериализация значения в JSON-строку (безопасная).
 */
function serializeJSONField(value) {
    if (value === undefined || value === null) return '{}';
    if (typeof value === 'function') return '{}';
    try {
        return JSON.stringify(value);
    } catch (error) {
        logger.warn('serializeJSONField failed', { error: error.message });
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
    if (!playerId || !action) {
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
    logger.error({
        type: 'player_error',
        playerId,
        message: error.message,
        stack: error.stack,
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
