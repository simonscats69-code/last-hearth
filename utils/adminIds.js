/**
 * Единый источник истины для ADMIN_IDS.
 *
 * Парсинг выполняется при каждом вызове (без кэширования), чтобы изменения
 * переменной окружения применялись без рассинхрона при перезапуске.
 * Нормализация: trim, фильтрация пустых значений, уникальность.
 */
function getAdminIds() {
    const raw = process.env.ADMIN_IDS || '';
    const ids = raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    return [...new Set(ids)];
}

function isAdmin(telegramId) {
    if (telegramId === undefined || telegramId === null) return false;
    return getAdminIds().includes(String(telegramId).trim());
}

module.exports = { getAdminIds, isAdmin };
