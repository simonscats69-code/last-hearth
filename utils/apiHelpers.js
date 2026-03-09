/**
 * Универсальные функции для работы с API
 * Объединяет валидацию и формирование HTTP-ответов
 */

// =============================================================================
// Валидация
// =============================================================================

/**
 * Проверка ID (целое число > 0)
 * @param {any} value - значение для проверки
 * @param {string} [fieldName='ID'] - имя поля для сообщения об ошибке
 * @returns {{ valid: boolean, error?: string, code?: string }}
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
 * @param {any} value - значение для проверки
 * @param {string} [fieldName='строка'] - имя поля для сообщения об ошибке
 * @param {object} [options] - опции валидации
 * @param {number} [options.minLength=1] - минимальная длина
 * @param {number} [options.maxLength=100] - максимальная длина
 * @param {RegExp} [options.pattern] - регулярное выражение для проверки
 * @returns {{ valid: boolean, error?: string, code?: string, value?: string }}
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
 * @param {any} value - значение для проверки
 * @param {number} maxLength - максимальная длина массива
 * @param {string} [fieldName='индекс'] - имя поля для сообщения об ошибке
 * @returns {{ valid: boolean, error?: string, code?: string }}
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
 * @param {any} value - значение для проверки
 * @param {string} [fieldName='значение'] - имя поля для сообщения об ошибке
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
function validateBoolean(value, fieldName = 'значение') {
    if (value === undefined || value === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    
    if (typeof value !== 'boolean') {
        return { valid: false, error: `${fieldName} должно быть булевым значением`, code: 'INVALID_TYPE' };
    }
    
    return { valid: true };
}

/**
 * Проверка числового диапазона
 * @param {any} value - значение для проверки
 * @param {number} min - минимальное значение (включительно)
 * @param {number} max - максимальное значение (включительно)
 * @param {string} [fieldName='значение'] - имя поля для сообщения об ошибке
 * @returns {{ valid: boolean, error?: string, code?: string }}
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
 * @param {any} name - имя для очистки
 * @param {number} [maxLength=50] - максимальная длина
 * @returns {{ valid: boolean, error?: string, code?: string, value?: string }}
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
 * @param {any} value - значение для проверки
 * @param {string} [fieldName='значение'] - имя поля для сообщения об ошибке
 * @returns {{ valid: boolean, error?: string, code?: string }}
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
 * @param {any} value - значение для проверки
 * @returns {{ valid: boolean, error?: string, code?: string }}
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

// =============================================================================
// Ответы API
// =============================================================================

/**
 * Успешный ответ с данными
 * @param {object} res - объект ответа Express
 * @param {any} data - данные для отправки
 * @param {number} [statusCode=200] - HTTP статус код
 * @returns {object} JSON-ответ { success: true, data }
 */
function ok(res, data, statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        data
    });
}

/**
 * Ошибка запроса (клиентская ошибка)
 * @param {object} res - объект ответа Express
 * @param {string} message - сообщение об ошибке
 * @param {string} [code='ERROR'] - код ошибки
 * @param {number} [statusCode=400] - HTTP статус код
 * @returns {object} JSON-ответ { success: false, error: message, code }
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
 * @param {object} res - объект ответа Express
 * @param {string} message - сообщение об ошибке
 * @param {string} [code='INTERNAL_ERROR'] - код ошибки
 * @param {number} [statusCode=500] - HTTP статус код
 * @returns {object} JSON-ответ { success: false, error: message, code }
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
 * @param {object} res - объект ответа Express
 * @param {string} [message='Ресурс не найден'] - сообщение об ошибке
 * @param {string} [code='NOT_FOUND'] - код ошибки
 * @returns {object} JSON-ответ { success: false, error: message, code }
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
 * @param {object} res - объект ответа Express
 * @param {string} [message='Требуется авторизация'] - сообщение об ошибке
 * @param {string} [code='UNAUTHORIZED'] - код ошибки
 * @returns {object} JSON-ответ { success: false, error: message, code }
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
 * @param {object} res - объект ответа Express
 * @param {string} [message='Доступ запрещён'] - сообщение об ошибке
 * @param {string} [code='FORBIDDEN'] - код ошибки
 * @returns {object} JSON-ответ { success: false, error: message, code }
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
 * @param {object} res - объект ответа Express
 * @param {string} message - сообщение об ошибке
 * @param {string} [code='BAD_REQUEST'] - код ошибки
 * @returns {object} JSON-ответ { success: false, error: message, code }
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
 * @param {Array} validations - массив результатов валидации
 * @returns {Function} Express middleware
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
 * @param {Function} fn - асинхронный обработчик маршрута
 * @returns {Function} Express middleware с обработкой ошибок
 */
function wrap(fn) {
    return function(req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// =============================================================================
// Экспорт
// =============================================================================

module.exports = {
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
    wrap
};
