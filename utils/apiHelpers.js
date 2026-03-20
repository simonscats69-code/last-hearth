/**
 * Универсальные функции для API роутеров
 * Используются в routes/game/market.js и routes/game/purchase.js
 */

const { handleError } = require('./serverApi');

/**
 * Универсальный формат успешного ответа
 * @param {object} res - объект ответа Express
 * @param {object} data - данные для ответа
 */
function successResponse(res, data) {
    res.json({ success: true, ...data });
}

/**
 * Универсальный формат ответа с ошибкой
 * @param {object} res - объект ответа Express
 * @param {string} error - сообщение об ошибке
 * @param {string} code - код ошибки
 * @param {number} statusCode - HTTP статус код
 * @param {object} extraData - дополнительные данные
 */
function errorResponse(res, error, code = 'INTERNAL_ERROR', statusCode = 400, extraData = {}) {
    res.status(statusCode).json({ success: false, error, code, ...extraData });
}

/**
 * Валидация ID
 * @param {any} value - значение для валидации
 * @returns {boolean} результат валидации
 */
function isValidId(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Валидация цены
 * @param {any} value - значение для валидации
 * @returns {boolean} результат валидации
 */
function isValidPrice(value) {
    return Number.isInteger(value) && value > 0 && value <= 1000000;
}

/**
 * Валидация индекса
 * @param {any} value - значение для валидации
 * @param {number} maxLength - максимальная длина
 * @returns {boolean} результат валидации
 */
function isValidIndex(value, maxLength) {
    return Number.isInteger(value) && value >= 0 && value < maxLength;
}

/**
 * Валидация ID предмета
 * @param {any} value - значение для валидации
 * @returns {boolean} результат валидации
 */
function isValidItemId(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Валидация валюты
 * @param {any} value - значение для валидации
 * @returns {boolean} результат валидации
 */
function isValidCurrency(value) {
    return value === 'coins' || value === 'stars';
}

/**
 * Безопасный парсинг JSON поля из БД
 * @param {any} field - поле для парсинга
 * @returns {object|null} распарсенное значение или null
 */
function safeParse(field) {
    if (!field) return null;
    try {
        if (typeof field === 'object') {
            return field;
        }
        return JSON.parse(field);
    } catch {
        return null;
    }
}

/**
 * Пагинация
 * @param {object} queryParams - параметры запроса
 * @param {number} defaultLimit - лимит по умолчанию
 * @param {number} maxLimit - максимальный лимит
 * @returns {object} объект с limit и offset
 */
function parsePagination(queryParams, defaultLimit = 50, maxLimit = 100) {
    let limit = parseInt(queryParams.limit) || defaultLimit;
    let offset = parseInt(queryParams.offset) || 0;
    
    // Ограничиваем максимальный limit
    limit = Math.min(limit, maxLimit);
    // Ограничиваем минимальный offset
    offset = Math.max(0, offset);
    
    return { limit, offset };
}

module.exports = {
    successResponse,
    errorResponse,
    isValidId,
    isValidPrice,
    isValidIndex,
    isValidItemId,
    isValidCurrency,
    safeParse,
    parsePagination,
    handleError
};
