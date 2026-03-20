/**
 * Утилиты и хелперы для фронтенда
 * Общие функции, используемые во всей игре
 */



/**
 * Получить ID текущего пользователя Telegram
 * @returns {string|null}
 */
function getTelegramId() {
    // Проверяем существование Telegram WebApp
    if (!window.Telegram?.WebApp) {
        return localStorage.getItem('telegram_id');
    }
    
    const tg = window.Telegram.WebApp;
    const id = tg.initDataUnsafe?.user?.id;
    // Используем != null для проверки на null/undefined (включая 0)
    return id != null ? String(id) : localStorage.getItem('telegram_id');
}

/**
 * Получить initData для авторизации
 * ВАЖНО: Никогда не использовать localStorage - initData имеет срок жизни
 * @returns {string|null}
 */
function getInitData() {
    return window.Telegram?.WebApp?.initData || null;
}

/**
 * Определение тёмной темы
 * @param {string} hexColor - Hex код цвета
 * @returns {boolean}
 */
function isColorDark(hexColor) {
    if (!hexColor) return false;
    
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Формула яркости
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128;
}

/**
 * Тактильный отклик - удар
 * @param {string} style - Стиль: light, medium, heavy
 */
function hapticImpact(style = 'medium') {
    if (!window.Telegram?.WebApp) return;
    const tg = window.Telegram.WebApp;
    if (tg.HapticFeedback) {
        tg.HapticFeedback.impactOccurred(style);
    }
}

/**
 * Тактильный отклик - уведомление
 * @param {string} type - Тип: success, warning, error
 */
function hapticNotification(type = 'success') {
    if (!window.Telegram?.WebApp) return;
    const tg = window.Telegram.WebApp;
    if (tg.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred(type);
    }
}

/**
 * Тактильный отклик - выбор
 */
function hapticSelection() {
    if (!window.Telegram?.WebApp) return;
    const tg = window.Telegram.WebApp;
    if (tg.HapticFeedback) {
        tg.HapticFeedback.selectionChanged();
    }
}



/**
 * Экранирование HTML
 * @param {string} text - Текст для экранирования
 * @returns {string}
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Форматирование числа с разделением разрядов
 * @param {number} num - Число
 * @returns {string}
 */
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Форматирование процентов
 * @param {number} value - Значение (0-100)
 * @returns {string}
 */
function formatPercent(value) {
    return `${Math.round(value)}%`;
}

/**
 * Форматирование времени (секунды в чч:мм:сс)
 * @param {number} seconds - Секунды
 * @returns {string}
 */
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    // Паддим нулями
    const mStr = String(m).padStart(2, '0');
    const sStr = String(s).padStart(2, '0');
    
    if (h > 0) {
        return `${h}ч ${mStr}:${sStr}`;
    }
    if (m > 0) {
        return `${m}м ${sStr}с`;
    }
    return `${s}с`;
}


// closeModal не используется - удалён дубликат



/**
 * Получить категорию предмета
 * @param {number|string} itemId - ID предмета
 * @returns {string}
 */
function getItemCategory(itemId) {
    const id = parseInt(itemId);
    
    // Еда
    if (id >= 1 && id <= 5) return 'food';
    // Медикаменты
    if (id >= 6 && id <= 10) return 'medicine';
    // Оружие
    if (id >= 11 && id <= 16) return 'weapon';
    // Броня
    if (id >= 17 && id <= 20) return 'armor';
    // Ресурсы
    if (id >= 21 && id <= 28) return 'resource';
    // Ключи
    if (id === 29) return 'key';
    
    return 'unknown';
}

/**
 * Получить цвет редкости предмета
 * @param {string} rarity - Редкость
 * @returns {string}
 */
function getRarityColor(rarity) {
    const colors = {
        common: '#9e9e9e',
        uncommon: '#4caf50',
        rare: '#2196f3',
        epic: '#9c27b0',
        legendary: '#ff9800'
    };
    return colors[rarity] || colors.common;
}

/**
 * Получить emoji роли в клане
 * @param {string} role - Роль
 * @returns {string}
 */
function getClanRoleEmoji(role) {
    const emojis = {
        leader: '👑',
        officer: '⭐',
        member: '👤'
    };
    return emojis[role] || emojis.member;
}






// Делаем функции глобальными для обратной совместимости
window.getTelegramId = getTelegramId;
window.getInitData = getInitData;
window.isColorDark = isColorDark;
window.hapticImpact = hapticImpact;
window.hapticNotification = hapticNotification;
window.hapticSelection = hapticSelection;
window.escapeHtml = escapeHtml;
window.formatNumber = formatNumber;
window.formatPercent = formatPercent;
window.formatTime = formatTime;
// showModal/hideModal - в game-animations.js
// showScreen - в game-core.js
window.getItemCategory = getItemCategory;
window.getRarityColor = getRarityColor;
window.getClanRoleEmoji = getClanRoleEmoji;
