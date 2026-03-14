/**
 * Утилиты для безопасной работы с JSON
 * Вынесено для устранения дублирования кода (DRY)
 */

/**
 * Безопасный парсинг JSON
 * @param {string} str - JSON строка для парсинга
 * @param {*} defaultValue - значение по умолчанию при ошибке
 * @returns {*} распарсенный объект или defaultValue
 */
function safeJsonParse(str, defaultValue = null) {
    if (!str) return defaultValue;
    
    if (typeof str === 'object') {
        // Если уже объект, возвращаем как есть
        return str;
    }
    
    try {
        return JSON.parse(str);
    } catch (e) {
        logger.warn('safeJsonParse: failed to parse', str.substring(0, 100));
        return defaultValue;
    }
}

/**
 * Безопасное превращение в JSON строку
 * @param {*} obj - объект для сериализации
 * @returns {string} JSON строка или пустая строка при ошибке
 */
function safeStringify(obj) {
    if (!obj) return '';
    
    try {
        return JSON.stringify(obj);
    } catch (e) {
        logger.warn('safeStringify: failed to stringify', obj);
        return '';
    }
}

module.exports = {
    safeJsonParse,
    safeStringify
};
