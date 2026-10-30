/**
 * Единый источник истины для ADMIN_IDS.
 * index.js и routes/admin.js должны использовать эту функцию, чтобы
 * парсинг не разошёлся при изменении переменной окружения без рестарта.
 */
function getAdminIds() {
    return (process.env.ADMIN_IDS || '').split(',').filter(Boolean);
}

module.exports = { getAdminIds };
