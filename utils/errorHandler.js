/**
 * Универсальный обработчик ошибок
 * Вынесено для устранения дублирования кода (DRY)
 */

const { logger } = require('./logger');

/**
 * Стандартизированный формат ответа об ошибке
 */
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

/**
 * Фабрика стандартизированного ответа об ошибке
 * @param {string} errorType - тип ошибки (ключ из ERROR_CODES или кастомный)
 * @param {object} options - дополнительные параметры
 * @returns {object} стандартизированный объект ошибки
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
 * Использование: app.use(errorMiddleware)
 */
function errorMiddleware(err, req, res, next) {
    // Логируем ошибку
    logger.error({
        type: 'request_error',
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
    });
    
    // Определяем код ответа
    let statusCode = 500;
    let errorType = 'INTERNAL_ERROR';
    
    if (err.name === 'ValidationError' || err.name === 'CastError') {
        statusCode = 400;
        errorType = 'BAD_REQUEST';
    } else if (err.name === 'UnauthorizedError') {
        statusCode = 401;
        errorType = 'UNAUTHORIZED';
    } else if (err.code === '23505') { // PostgreSQL unique violation
        statusCode = 409;
        errorType = 'CONFLICT';
    }
    
    res.status(statusCode).json(createErrorResponse(errorType, {
        message: err.message,
    }));
}

/**
 * Async wrapper для обработки ошибок в роутерах
 * Использование: router.get('/', asyncHandler(async (req, res) => {...}))
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Функция для обработки ошибок БД
 * @param {Error} err - объект ошибки
 * @param {string} context - контекст выполнения
 */
function handleDbError(err, context = 'DB_OPERATION') {
    logger.error({
        type: 'database_error',
        context,
        message: err.message,
        code: err.code,
    });
    
    // Не раскрываем детали ошибки клиенту
    return createErrorResponse('DATABASE_ERROR');
}

/**
 * Универсальный обработчик ошибок для роутов
 * @param {object} res - объект ответа Express
 * @param {Error} error - объект ошибки
 * @param {string} action - действие/контекст ошибки
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

module.exports = {
    ERROR_CODES,
    createErrorResponse,
    errorMiddleware,
    asyncHandler,
    handleDbError,
    handleError,
};
