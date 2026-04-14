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

/**
 * Получить CSS класс редкости по уровню игрока
 * @param {number} level - Уровень игрока
 * @returns {string}
 */
function getRarityClassByLevel(level) {
    if (level >= 50) return 'rarity-legendary';
    if (level >= 30) return 'rarity-epic';
    if (level >= 15) return 'rarity-rare';
    if (level >= 5) return 'rarity-uncommon';
    return 'rarity-common';
}

/**
 * Получить emoji для отображения игрока по уровню
 * @param {number} level - Уровень игрока
 * @returns {string}
 */
function getPlayerEmoji(level) {
    if (level >= 50) return '🦸';
    if (level >= 30) return '⚔️';
    if (level >= 15) return '🛡️';
    if (level >= 5) return '🗡️';
    return '👤';
}






// Делаем функции глобальными для обратной совместимости
window.getTelegramId = getTelegramId;
// getInitData moved to game-api.js
window.isColorDark = isColorDark;
window.hapticImpact = hapticImpact;
window.hapticNotification = hapticNotification;
window.hapticSelection = hapticSelection;
window.escapeHtml = escapeHtml;
window.formatNumber = formatNumber;
window.formatPercent = formatPercent;
window.formatTime = formatTimeMs;
// showModal/hideModal - в game-animations.js
// showScreen - в game-core.js
window.getItemCategory = getItemCategory;
window.getRarityColor = getRarityColor;
window.getClanRoleEmoji = getClanRoleEmoji;
window.getRarityClassByLevel = getRarityClassByLevel;
window.getPlayerEmoji = getPlayerEmoji;
/**
 * ============================================
 * API ЗАПРОСЫ (API Requests)
 * ============================================
 * Управление запросами к серверу
 * Оптимизировано со словарём эндпоинтов
 */

// Базовый URL API
// Сначала пробуем явную конфигурацию окна, затем same-origin для prod/dev,
// и только потом fallback на основной production endpoint.
const API_BASE = window.__API_BASE__
    || `${window.location.origin}/api`
    || 'https://last-hearth.bothost.ru/api';

// ============================================
// СЛОВАРЬ ЭНДПОИНТОВ
// ============================================
const endpoints = {
    // Профиль
    profile: { endpoint: '/game/profile', method: 'GET' },
    inventory: { endpoint: '/game/inventory', method: 'GET' },
    
    // Исследование и перемещение
    search: { endpoint: '/game/locations/search', method: 'POST' },
    move: { endpoint: '/game/locations/move', method: 'POST' },
    
    // Предметы
    useItem: { endpoint: '/game/inventory/use-item', method: 'POST' },
    
    // Боссы
    attackBoss: { endpoint: '/game/bosses/attack-boss', method: 'POST' },
    bosses: { endpoint: '/game/bosses', method: 'GET' },
    
    // Колесо удачи
    wheelInfo: { endpoint: '/game/wheel', method: 'GET' },
    wheelSpin: { endpoint: '/game/wheel/spin', method: 'POST' },
    
    // Статус и магазин
    statusCheck: { endpoint: '/game/status/check', method: 'POST' },
    purchase: { endpoint: '/game/purchase', method: 'POST' },
    achievements: { endpoint: '/achievements/progress', method: 'GET' },
    
    // Рейтинги
    ratingsPlayers: { endpoint: '/rating/players', method: 'GET' },
    ratingsClans: { endpoint: '/rating/clans', method: 'GET' },
    
    // Клан
    clan: { endpoint: '/game/clans/clan', method: 'GET' },
    clanCreate: { endpoint: '/game/clans/clan/create', method: 'POST' },
    clanJoin: { endpoint: '/game/clans/clan/join', method: 'POST' },
    clanLeave: { endpoint: '/game/clans/clan/leave', method: 'POST' },
    
    // PvP
    pvpAttack: { endpoint: '/game/pvp/attack', method: 'POST' },
    
    // Рефералы
    referralCode: { endpoint: '/game/referral/code', method: 'GET' },
    referralUse: { endpoint: '/game/referral/use', method: 'POST' },
    
    // Рейдовые боссы
    clanBoss: { endpoint: '/game/bosses/raids', method: 'GET' },
    clanBossSpawn: { endpoint: '/game/bosses/raid/start', method: 'POST' },
    clanBossAttack: { endpoint: '/game/bosses/raid/attack', method: 'POST' }
};

// ============================================
// КЭШ ДАННЫХ
// ============================================
const apiCache = new Map();
const CACHE_TTL = 30000; // 30 секунд

// Связи между endpoint-ами для умной инвалидации
const cacheInvalidationMap = {
    'purchase': ['profile', 'inventory'],
    'useItem': ['inventory', 'profile'],
    'search': ['inventory', 'profile'],
    'move': ['locations', 'profile'],
    'attackBoss': ['bosses', 'profile'],
    'wheelSpin': ['profile', 'inventory'],
    'statusCheck': ['profile'],
    'achievements': ['achievements'],
    'clanCreate': ['clan', 'profile'],
    'clanJoin': ['clan', 'profile'],
    'clanLeave': ['clan', 'profile'],
    'pvpAttack': ['profile'],
    'referralUse': ['profile'],
    'clanBossSpawn': ['clanBoss', 'profile'],
    'clanBossAttack': ['clanBoss', 'profile']
};

function getCached(key) {
    const cached = apiCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    apiCache.delete(key);
    return null;
}

function setCached(key, data) {
    apiCache.set(key, { data, timestamp: Date.now() });
}

function invalidateCache(key) {
    apiCache.delete(key);
    const relatedKeys = cacheInvalidationMap[key] || [];
    relatedKeys.forEach(relatedKey => apiCache.delete(relatedKey));
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

/** Задержка перед повторной попыткой */
function delay(attempt) {
    return new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
}

/** Создание таймаута для индикатора загрузки */
function createLoadingTimeout(showLoading) {
    if (showLoading !== false) {
        return setTimeout(() => showNotification('Соединение...', 'info'), 2000);
    }
    return null;
}

/**
 * Получить initData для авторизации
 * ВАЖНО: Никогда не использовать localStorage - initData имеет срок жизни (auth_date)
 * и становится invalid через некоторое время
 * @returns {string|null}
 */
function getInitData() {
    // Всегда используем только initData от Telegram WebApp
    const initData = window.Telegram?.WebApp?.initData || null;
    
    if (!initData) {
        console.error('[getInitData] Telegram WebApp initData отсутствует');
    }
    
    return initData;
}

/**
 * Выполнение запроса к API с таймаутом и повторами
 * @param {string} endpoint - endpoint API
 * @param {Object} options - дополнительные опции
 * @param {number} retries - количество повторов после первой попытки (по умолчанию 2)
 * @returns {Promise<Object>} ответ сервера
 */
async function apiRequest(endpoint, options = {}, retries = 2, params = {}) {
    const normalizedEndpoint = endpoint.startsWith('/api') 
        ? endpoint.replace(/^\/api/, '') || '/' 
        : endpoint;
    
    const queryString = Object.keys(params).length > 0 
        ? '?' + new URLSearchParams(params).toString() 
        : '';
    const url = `${API_BASE}${normalizedEndpoint.startsWith('/') ? '' : '/'}${normalizedEndpoint}${queryString}`;
    
    // Получаем initData для авторизации
    const initData = getInitData();
    
    const config = {
        headers: {
            'Content-Type': 'application/json',
            'x-init-data': initData || ''  // Используем x-init-data для безопасной авторизации
        },
        ...options
    };

    console.log('[apiRequest] Отправка запроса', {
        url,
        method: options.method || 'GET',
        hasInitData: !!initData,
        initDataLength: initData?.length || 0
    });

    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        let timeoutId = null;
        let loadingTimeout = null;

        try {
            loadingTimeout = createLoadingTimeout(options.showLoading);
            
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 8000);
            
            const response = await fetch(url, { ...config, signal: controller.signal });
            clearTimeout(timeoutId);
            timeoutId = null;
            if (loadingTimeout) clearTimeout(loadingTimeout);

            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json')
                ? await response.json()
                : null;
            
            if (!response.ok) {
                const serverMessage = data?.error || data?.message || `HTTP error! status: ${response.status}`;
                const httpError = new Error(serverMessage);
                httpError.status = response.status;
                httpError.response = data;
                throw httpError;
            }

            if (!data) {
                return { success: true };
            }
            
            if (data.error === true) {
                console.error('API Error:', data.message);
                throw new Error(data.message || 'Unknown error');
            }
            
            return data;
        } catch (error) {
            const isLastAttempt = attempt === retries;
            
            // Всегда очищаем таймауты при ошибке
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (loadingTimeout) clearTimeout(loadingTimeout);
            
            if (error.name === 'AbortError') {
                if (isLastAttempt) {
                    showNotification('Сервер не отвечает. Попробуй позже.', 'error');
                    throw error;
                }
                await delay(attempt);
                continue;
            }
            
            if (isLastAttempt) {
                console.error('API Request failed:', error);
                // Проверяем код ошибки для более понятного сообщения
                if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                    showNotification('Ошибка авторизации. Обновите игру через Telegram.', 'error');
                } else if (error.message.includes('502')) {
                    showNotification('Сервер перегружен. Попробуй через несколько минут.', 'error');
                } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                    showNotification('Пропал интернет. Проверь соединение.', 'error');
                } else {
                    showNotification('Ошибка: ' + error.message, 'error');
                }
                throw error;
            }
            
            await delay(attempt);
        }
    }
}

// ============================================
// ГЕНЕРАЦИЯ API МЕТОДОВ
// ============================================

/** Создаёт API метод на основе словаря эндпоинтов */
function createApiMethod(name) {
    const config = endpoints[name];
    if (!config) {
        return () => { throw new Error(`Unknown endpoint: ${name}`); };
    }
    
    if (config.method === 'GET') {
        return async function(body = {}) {
            if (Object.keys(body).length === 0) {
                const cached = getCached(name);
                if (cached) return cached;
                const data = await apiRequest(config.endpoint, { method: 'GET' });
                setCached(name, data);
                return data;
            }
            return apiRequest(config.endpoint, { method: 'GET' }, 2, body);
        };
    } else {
        return async function(body = {}) {
            invalidateCache(name);
            return apiRequest(config.endpoint, { method: 'POST', body });
        };
    }
}

/** Генерируем gameApi один раз через Object.fromEntries */
const gameApi = Object.fromEntries(
    Object.keys(endpoints).map(name => [name, createApiMethod(name)])
);

// Добавляем статические методы
gameApi.get = (endpoint, params = {}) => apiRequest(endpoint, { method: 'GET' }, 2, params);
gameApi.post = (endpoint, body = {}) => apiRequest(endpoint, { method: 'POST', body });
gameApi.endpoints = endpoints;
gameApi.cache = { get: getCached, set: setCached, invalidate: invalidateCache };

// ============================================================================
// API ЗАПРОСЫ - используются через game-systems.js и game-ui.js
// ============================================================================
/**
 * game-core.js - Ядро игры
 * Основные константы, утилиты и система управления состоянием
 * 
 * Подключение: после game-utils.js и game-api.js
 * Зависимости: gameState, getTelegramId, showNotification, apiRequest
 */

// ============================================================================
// СОСТОЯНИЕ ИГРЫ
// ============================================================================

const gameState = {
    // Данные игрока
    player: null,

    // Инвентарь
    inventory: [],

    // Доступные локации
    locations: [],

    // Локации для рейтинга (map)
    locationPositions: {},

    // Боссы
    bosses: [],

    // Текущий босс
    currentBoss: null,

    // Данные клана
    clan: null,

    // Активные баффы
    buffs: {},

    // Текущий экран
    currentScreen: 'main',

    // PvP матч
    pvpMatch: null,

    // Данные рейдов
    raids: [],
    raidsParticipating: [],

    // Уже показанные анлоки локаций
    seenUnlockedLocations: [],

    // Инсайты для главного экрана
    mainInsights: {
        loadedAt: 0,
        bosses: [],
        achievements: [],
        achievementStats: null
    }
};

window.gameState = gameState;

// ============================================================================
// КОНСТАНТЫ
// ============================================================================

const CONSTANTS = {
    // API
    API_TIMEOUT: 8000,
    API_RETRIES: 2,
    
    // Лимиты ввода
    MAX_PRICE: 1000000000,
    MAX_QUANTITY: 1000,
    MAX_STARS_PRICE: 10000,
    MIN_REFERRAL_LENGTH: 3,
    MAX_REFERRAL_LENGTH: 20,
    REFERRAL_REGEX: /^[A-Z0-9_]+$/i,
    
    // UI
    NOTIFICATION_DURATION: 3000,
    CONFIRM_THRESHOLD: 5000,
    
    // Интервалы
    INTERVALS: {
        ENERGY_UPDATE: 60000,
        STATUS_CHECK: 600000
    },
    
    // Цвета
    COLORS: {
        SUCCESS: '#00C851',
        ERROR: '#ff4444',
        INFO: '#33b5e5',
        WARNING: '#ff8800'
    },
    
    // Редкость
    RARITY_ORDER: {
        legendary: 5,
        epic: 4,
        rare: 3,
        uncommon: 2,
        common: 1
    }
};

// ============================================================================
// МЕНЕДЖЕР ИНТЕРВАЛОВ (защита от утечек памяти)
// ============================================================================

const activeIntervals = [];

/**
 * Безопасное создание интервала с автоматической очисткой
 * @param {Function} callback - функция
 * @param {number} delay - задержка в мс
 * @returns {number} id интервала
 */
function safeSetInterval(callback, delay) {
    const id = setInterval(callback, delay);
    activeIntervals.push(id);
    return id;
}


/**
 * Очистка всех интервалов при выходе
 */
function clearAllIntervals() {
    activeIntervals.forEach(id => clearInterval(id));
    activeIntervals.length = 0;
    
    // Очищаем глобальные таймеры
    if (window.bossFightTimerId) {
        clearInterval(window.bossFightTimerId);
        window.bossFightTimerId = null;
    }
    if (window.pvpCooldownTimerId) {
        clearInterval(window.pvpCooldownTimerId);
        window.pvpCooldownTimerId = null;
    }
}

// Очищаем интервалы при закрытии страницы
window.addEventListener('beforeunload', clearAllIntervals);
window.addEventListener('pagehide', clearAllIntervals);

// ============================================================================
// БЛОКИРОВКИ ОПЕРАЦИЙ (защита от состояний гонки)
// ============================================================================

const actionLocks = {
    healing: false,
    clanCreate: false,
    clanJoin: false,
    clanLeave: false,
    clanDonate: false,
    pvpAttack: false,
    useItem: false,
    purchase: false,
    referral: false,
    searchLoot: false,
    attackBoss: false
};

/**
 * Блокировка операции
 * @param {string} name - имя операции
 * @returns {boolean} true если заблокировано
 */
function lockAction(name) {
    if (actionLocks[name]) {
        showNotification?.('Подождите, выполняется другое действие...', 'warning');
        return false;
    }
    actionLocks[name] = true;
    return true;
}

/**
 * Разблокировка операции
 * @param {string} name - имя операции
 */
function unlockAction(name) {
    actionLocks[name] = false;
}

// ============================================================================
// КЭШИРОВАНИЕ РЕНДЕРИНГА
// ============================================================================

const RenderCache = {
    inventory: { html: '', key: '' },
    market: { html: '', key: '' },
    bosses: { html: '', key: '' },
    
    get(section, renderFn, key) {
        const cache = this[section];
        if (!cache) return renderFn();
        
        if (cache.key === key && cache.html) {
            return cache.html;
        }
        
        const html = renderFn();
        cache.html = html;
        cache.key = key;
        return html;
    },
    
    clear(section) {
        if (section && this[section]) {
            this[section] = { html: '', key: '' };
        } else {
            this.inventory = { html: '', key: '' };
            this.market = { html: '', key: '' };
            this.bosses = { html: '', key: '' };
        }
    }
};

// ============================================================================
// LOADER - объединённый объект загрузки
// ============================================================================

const Loader = {
    _element: null,
    
    show(message = 'Загрузка...') {
        if (!this._element) {
            this._element = document.createElement('div');
            this._element.id = 'global-loader';
            this._element.innerHTML = `
                <div class="loader-overlay">
                    <div class="loader-spinner"></div>
                    <div class="loader-text"></div>
                </div>
            `;
            document.body.appendChild(this._element);
        }
        this._element.querySelector('.loader-text').textContent = message;
        this._element.classList.add('active');
        if (typeof AppState !== 'undefined') {
            AppState.ui.loading = true;
        }
    },
    
    hide() {
        if (this._element) {
            this._element.classList.remove('active');
        }
        if (typeof AppState !== 'undefined') {
            AppState.ui.loading = false;
        }
    },
    
    async wrap(fn, message = 'Загрузка...') {
        if (typeof AppState !== 'undefined' && AppState.ui.loading) {
            console.log('Уже грузится, пропускаем');
            return;
        }
        this.show(message);
        try {
            return await fn();
        } finally {
            this.hide();
        }
    }
};

// ============================================================================
// TEMPLATES - часто используемые шаблоны
// ============================================================================

const Templates = {
    // Модальное окно
    modal(title, content, buttons = '') {
        return `
            <div class="modal active">
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <h3>${escapeHtml(title)}</h3>
                    <div class="modal-body">${content}</div>
                    ${buttons || '<button class="btn modal-close">OK</button>'}
                </div>
            </div>
        `;
    },
    
    // Карточка предмета
    itemCard(item, actions = '') {
        const itemActionId = item.index ?? item.id;
        return `
            <div class="item-card rarity-${item.rarity || 'common'}" 
                 data-id="${item.id}" onclick="useItem(${itemActionId})">
                <span class="item-icon">${item.icon || '📦'}</span>
                <span class="item-name">${escapeHtml(item.name)}</span>
                ${item.count ? `<span class="item-count">x${item.count}</span>` : ''}
                ${actions}
            </div>
        `;
    },
    
    // Карточка босса
    bossCard(boss) {
        const hpPercent = boss.current_hp / boss.max_hp * 100;
        return `
            <div class="boss-card" data-id="${boss.id}">
                <div class="boss-header">
                    <span class="boss-icon">${boss.icon || '👹'}</span>
                    <span class="boss-name">${escapeHtml(boss.name)}</span>
                </div>
                <div class="boss-hp-bar">
                    <div class="boss-hp-fill" style="width: ${hpPercent}%"></div>
                </div>
                <div class="boss-hp-text">${boss.current_hp}/${boss.max_hp} HP</div>
                <button class="btn attack-btn" onclick="attackBoss()">Атаковать</button>
            </div>
        `;
    },
    
    // Кнопка
    button(text, onClick, type = 'primary', extra = '') {
        return `<button class="btn btn-${type}" onclick="${escapeHtml(onClick)}" ${extra}>${escapeHtml(text)}</button>`;
    },
    
    // Уведомление
    notification(message, type = 'info') {
        return `<div class="notification notification-${type}">${escapeHtml(message)}</div>`;
    },
    
    // Пустое состояние
    empty(message = 'Пусто') {
        return `<div class="empty-message">${escapeHtml(message)}</div>`;
    },
    
    // Слот инвентаря
    inventorySlot(item) {
        const itemActionId = item.index ?? item.id;
        return `
            <div class="inventory-slot rarity-${item.rarity || 'common'}" 
                 onclick="useItem(${itemActionId})" data-id="${item.id}">
                <span class="item-icon">${item.icon || '📦'}</span>
                ${item.count > 1 ? `<span class="item-count">${item.count}</span>` : ''}
            </div>
        `;
    }
};

// ============================================================================
// API - универсальная загрузка данных
// ============================================================================

const API = {
    // Маппинг типов на эндпоинты
    endpoints: {
        profile: '/api/game/profile',
        inventory: '/api/game/inventory',
        locations: '/api/game/locations',
        bosses: '/api/game/bosses',
        clan: '/api/game/clans/clan',
        market: '/api/game/market/listings',
        pvp: '/api/game/pvp/players',
        achievements: '/api/achievements/progress',
        status: '/api/game/status',
        energy: '/api/game/energy'
    },
    
    // Активные контроллеры для отмены запросов
    _activeControllers: new Map(),
    
    // Отмена запроса по типу
    cancelRequest(type) {
        const controller = this._activeControllers.get(type);
        if (controller) {
            controller.abort();
            this._activeControllers.delete(type);
        }
    },
    
    // GET запрос
    async get(endpoint) {
        return apiRequest(endpoint);
    },
    
    // POST запрос
    async post(endpoint, data) {
        return apiRequest(endpoint, { method: 'POST', body: data });
    },
    
    // PUT запрос
    async put(endpoint, data) {
        return apiRequest(endpoint, { method: 'PUT', body: data });
    },
    
    // DELETE запрос
    async delete(endpoint) {
        return apiRequest(endpoint, { method: 'DELETE' });
    },
    
    // Универсальная загрузка с поддержкой отмены
    async load(type, id = null) {
        const endpoint = this.endpoints[type];
        if (!endpoint) {
            throw new Error(`Неизвестный тип: ${type}`);
        }
        
        // Отменяем предыдущий запрос того же типа
        this.cancelRequest(type);
        
        // Создаём новый контроллер
        const controller = new AbortController();
        this._activeControllers.set(type, controller);
        
        let url = endpoint;
        if (id) url += `/${id}`;
        
        try {
            const response = await this.get(url);
            const data = response?.data || response;
            
            // Автоматическое обновление gameState
            if (type === 'profile' && typeof gameState !== 'undefined') {
                gameState.player = data;
            }
            if (type === 'inventory' && typeof gameState !== 'undefined') {
                gameState.inventory = data.inventory || [];
            }
            if (type === 'locations' && typeof gameState !== 'undefined') {
                gameState.locations = data.locations || [];
            }
            if (type === 'bosses' && typeof gameState !== 'undefined') {
                gameState.bosses = data.bosses || [];
            }
            
            return data;
        } finally {
            this._activeControllers.delete(type);
        }
    }
};

// ============================================================================
// DataLoader - очередь загрузки данных
// ============================================================================


// ============================================================================
// УНИВЕРСАЛЬНЫЙ RENDER
// ============================================================================

/**
 * Универсальный рендер - заменяет renderList и renderListAdvanced
 * @param {string|HTMLElement} containerIdOrEl - id контейнера или элемент
 * @param {Array|Object} data - массив или объект для рендера
 * @param {Function} template - функция-шаблон для каждого элемента
 * @param {Object} options - { emptyMessage, cacheKey, cacheSection }
 */
function render(containerIdOrEl, data, template, options = {}) {
    const container = typeof containerIdOrEl === 'string' 
        ? document.getElementById(containerIdOrEl) 
        : containerIdOrEl;
    
    const { emptyMessage = 'Пусто', cacheKey = null, cacheSection = null } = options;
    
    if (!container) return;
    
    // Пустые данные
    const isArray = Array.isArray(data);
    if (!data || (isArray && data.length === 0)) {
        container.innerHTML = `<div class="empty-message">${escapeHtml(emptyMessage)}</div>`;
        return;
    }
    
    // Кэширование
    if (cacheKey && cacheSection && typeof RenderCache !== 'undefined') {
        // Создаём хеш для надёжного ключа кэша
        const dataStr = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < dataStr.length; i++) {
            const char = dataStr.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        const key = cacheKey + '_' + hash;
        const html = RenderCache.get(cacheSection, () => {
            return isArray 
                ? data.map(item => template(item)).join('')
                : template(data);
        }, key);
        container.innerHTML = html;
        return;
    }
    
    // Обычный рендер
    container.innerHTML = isArray 
        ? data.map(item => template(item)).join('')
        : template(data);
}
// ============================================================================
// УТИЛИТЫ DOM И РЕНДЕРИНГА
// ============================================================================

/**
 * Получить элемент по id
 */
function getEl(id) {
    return document.getElementById(id);
}

/**
 * Безопасно установить innerHTML
 */
function setHtml(elementOrId, html) {
    const el = typeof elementOrId === 'string' ? getEl(elementOrId) : elementOrId;
    if (!el) return null;
    el.innerHTML = html;
    return el;
}

/**
 * Навесить обработчик клика только один раз на элемент
 */
function bindClickOnce(element, key, handler) {
    if (!element) return;

    // Используем безопасное имя атрибута - только буквы и цифры
    const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
    const attrName = `data-bound-${safeKey}`;
    if (element.getAttribute(attrName) === 'true') {
        return;
    }

    element.addEventListener('click', handler);
    element.setAttribute(attrName, 'true');
}


// ============================================================================
// ПОДТВЕРЖДЕНИЕ ОПАСНЫХ ДЕЙСТВИЙ
// ============================================================================

/**
 * Запрос подтверждения для дорогих операций
 */
async function confirmAction(message, price = 0, threshold = 5000) {
    if (price > threshold) {
        return confirm(`⚠️ ${message}\nСумма: ${price} 🪙\nТочно продолжить?`);
    }
    if (message) {
        return confirm(message);
    }
    return true;
}

// ============================================================================
// SERVICE WORKER
// ============================================================================

// Регистрация Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then((registration) => {
                console.log('SW зарегистрирован:', registration.scope);
            })
            .catch((error) => {
                console.log('SW ошибка:', error);
            });
    });
}

// ============================================================================
// ADSGRAM
// ============================================================================

const ADSGRAM_APP_ID = window.ADSGRAM_APP_ID || '';

// AdsGram инициализация (с проверкой доступности)
let Adsgram = null;
if (window.AdsgramAvailable && typeof AdsgramInit === 'function' && ADSGRAM_APP_ID) {
    try {
        Adsgram = AdsgramInit({
            appId: ADSGRAM_APP_ID
        });
        console.log('AdsGram инициализирован');
    } catch (e) {
        console.warn('AdsGram инициализация не удалась:', e);
    }
} else if (!window.AdsgramAvailable) {
    console.log('AdsGram SDK недоступен');
}

async function watchAd() {
    if (!Adsgram) {
        showModal('⚠️ Реклама', 'Реклама временно недоступна. Попробуй позже!');
        return;
    }

    try {
        await Adsgram.showRewarded({
            onStart: () => {
                console.log('Реклама началась');
            },
            onReward: () => {
                if (!gameState.player || !gameState.player.status) {
                    showModal('⚠️ Ошибка', 'Данные игрока не загружены');
                    return;
                }

                const status = gameState.player.status;
                const maxEnergy = status.max_energy || 100;
                const currentEnergy = status.energy || 0;
                syncPlayerEnergyState(Math.min(maxEnergy, currentEnergy + 20), maxEnergy, new Date().toISOString());
                updateProfileUI(gameState.player);
                refreshPlayerEnergyUI();
                showModal('✅ Награда', '+20 энергии за просмотр рекламы!');
            },
            onError: (error) => {
                console.error('AdsGram error:', error);
                showModal('⚠️ Ошибка', 'Не удалось показать рекламу');
            },
            onEnd: () => {
                console.log('Реклама завершена');
            }
        });
    } catch (error) {
        console.error('AdsGram error:', error);
    }
}

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================================================

window.safeSetInterval = safeSetInterval;
window.clearAllIntervals = clearAllIntervals;
window.lockAction = lockAction;
window.unlockAction = unlockAction;
window.render = render;
window.getEl = getEl;
window.setHtml = setHtml;
window.confirmAction = confirmAction;
window.CONSTANTS = CONSTANTS;
window.Loader = Loader;
window.Templates = Templates;
window.API = API;
window.RenderCache = RenderCache;
window.Adsgram = Adsgram;
window.watchAd = watchAd;

// ============================================================================
// СИСТЕМА ПРЕДПРОСМОТРА УРОНА И ЭНЕРГИИ
// ============================================================================

/**
 * Рассчитать время до следующей единицы энергии
 * @param {string|Date} lastUpdate - время последнего обновления энергии
 * @returns {object|null} объект с секундами и форматированным временем или null если энергия полная
 */
function getTimeToNextEnergy(lastUpdate) {
    // Восстановление: 1 энергия в минуту (60000 мс)
    const ENERGY_REGEN_MS = 60000;
    
    if (!lastUpdate) return null;
    
    const lastUpdateTime = new Date(lastUpdate).getTime();
    const now = Date.now();
    const timePassed = now - lastUpdateTime;
    
    // Если прошло больше минуты - энергия уже восстановилась
    if (timePassed >= ENERGY_REGEN_MS) {
        return null;
    }
    
    const msUntilNext = ENERGY_REGEN_MS - timePassed;
    const seconds = Math.ceil(msUntilNext / 1000);
    
    return {
        seconds,
        ms: msUntilNext,
        formatted: formatTimeMs(msUntilNext)
    };
}

/**
 * Форматировать время в чч:мм:сс
 * @param {number} ms - время в миллисекундах
 * @returns {string} форматированное время
 */
function formatTimeMs(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Обновить таймер энергии в UI
 * Вызывается каждую секунду
 */
function updateEnergyTimer() {
    const status = typeof getEffectivePlayerStatus === 'function'
        ? getEffectivePlayerStatus()
        : gameState?.player?.status;

    if (!status) return;
    
    const { energy, max_energy, last_energy_update } = status;
    
    // Если энергия полная - скрываем таймер
    if (energy >= max_energy) {
        const timerEl = document.getElementById('energy-timer');
        if (timerEl) timerEl.style.display = 'none';
        return;
    }
    
    const timeToEnergy = getTimeToNextEnergy(last_energy_update);
    
    const timerEl = document.getElementById('energy-timer');
    if (timerEl && timeToEnergy) {
        timerEl.style.display = 'block';
        timerEl.textContent = `Энергия через ${timeToEnergy.formatted}`;
    }
}

/**
 * Предпросмотр урона по боссу
 * @param {number} bossId - ID босса
 * @returns {Promise<object>} данные о уроне
 */
async function getDamagePreview(bossId) {
    try {
        const data = await apiRequest('/game/boss-bonuses');
        
        if (data?.success && data?.data?.bonuses) {
            const bonus = data.data.bonuses.find(b => b.boss_id === bossId);
            if (bonus && gameState?.player) {
                const playerLevel = gameState.player.level || 1;
                const baseDamage = 1;
                const masteryBonus = bonus.kill_bonus || 0;
                const levelBonus = playerLevel;
                const totalDamage = baseDamage + masteryBonus + levelBonus;
                
                return {
                    baseDamage,
                    masteryBonus,
                    levelBonus,
                    totalDamage,
                    kills: bonus.kills || 0
                };
            }
        }
        return null;
    } catch (e) {
        console.error('Ошибка получения предпросмотра урона:', e);
        return null;
    }
}

/**
 * Обновить UI предпросмотра урона
 * @param {number} bossId - ID босса
 */
async function updateDamagePreviewUI(bossId) {
    const previewEl = document.getElementById('damage-preview');
    if (!previewEl) return;
    
    const damageData = await getDamagePreview(bossId);
    
    if (damageData) {
        previewEl.innerHTML = `
            <div class="damage-preview-line">
                <span>Базовый урон:</span>
                <span class="damage-base">${damageData.baseDamage}</span>
            </div>
            <div class="damage-preview-line">
                <span>Бонус мастерства:</span>
                <span class="damage-mastery">+${damageData.masteryBonus}</span>
            </div>
            <div class="damage-preview-line">
                <span>Бонус уровня:</span>
                <span class="damage-level">+${damageData.levelBonus}</span>
            </div>
            <div class="damage-preview-total">
                <span>Итого:</span>
                <span class="damage-total">${damageData.totalDamage}</span>
            </div>
        `;
    } else {
        previewEl.innerHTML = '<div class="damage-preview-loading">Загрузка...</div>';
    }
}

// Экспорт новых функций
window.getTimeToNextEnergy = getTimeToNextEnergy;
window.formatTime = formatTimeMs;
window.updateEnergyTimer = updateEnergyTimer;
window.getDamagePreview = getDamagePreview;
window.updateDamagePreviewUI = updateDamagePreviewUI;

// ============================================================================
// УПРАВЛЕНИЕ ЭКРАНАМИ
// ============================================================================

// Доступные экраны
const SCREENS = [
    'main',           // Главный экран
    'map',            // Карта города
    'inventory',      // Инвентарь
    'bosses',         // Боссы
    'boss-fight',     // Бой с боссом
    'weapon-select',  // Выбор оружия
    'clan',           // Клан
    'clans-list',     // Список кланов
    'clan-create',    // Создание клана
    'clan-chat',      // Чат клана
    'shop',           // Магазин
    'wheel',          // Колесо удачи
    'rating',         // Рейтинг
    'pvp',            // PvP
    'pvp-players',    // PvP игроки
    'pvp-fight',      // PvP бой
    'pvp-stats',      // PvP статистика
    'achievements',   // Достижения
    'referral'        // Рефералы
];

/**
 * Переход на экран
 * @param {string} screenName - имя экрана
 */
function showScreen(screenName) {
    // Защита от undefined/null
    if (!screenName || typeof screenName !== 'string') {
        console.warn('Invalid screen name:', screenName);
        return;
    }

    // Валидация
    if (!SCREENS.includes(screenName)) {
        console.warn('Unknown screen:', screenName);
        return;
    }

    // Скрываем все экраны
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });

    // Показываем нужный экран
    const targetScreen = document.getElementById(`${screenName}-screen`);
    if (targetScreen) {
        targetScreen.classList.add('active');
        gameState.currentScreen = screenName;

        // Выполняем специфичные действия при открытии
        onScreenOpen(screenName);
    }
}

/**
 * Обработчик открытия экрана
 * @param {string} screenName - имя экрана
 */
function onScreenOpen(screenName) {
    switch (screenName) {
        case 'main':
            // Обновляем главный экран (данные уже загружены)
            renderMain();
            if (typeof refreshMainScreenInsights === 'function') {
                refreshMainScreenInsights();
            }
            break;

        case 'map':
            // Загружаем локации для карты
            loadLocations().then(() => {
                // Рисуем карту после загрузки данных
                if (typeof renderLocations === 'function') {
                    setTimeout(renderLocations, 100);
                }
            });
            break;

        case 'inventory':
            // Загружаем инвентарь
            loadInventory();
            break;

        case 'weapon-select':
            // Загружаем оружие для выбора
            loadWeapons();
            break;

        case 'bosses':
            // Загружаем боссов
            loadBosses();
            break;

        case 'shop':
            // Открываем магазин (рендерим категорию)
            openShop();
            break;

        case 'rating':
            // Загружаем рейтинг
            loadRating();
            break;

        case 'clan':
            // Загружаем клан
            loadClan();
            break;

        case 'clans-list':
            // Загружаем список кланов
            loadClansList();
            break;

        case 'achievements':
            // Загружаем достижения
            loadAchievements();
            break;

        case 'market':
            // Загружаем магазин за монеты
            loadCoinShop();
            break;

        case 'pvp-players':
            // Загружаем список игроков PvP
            loadPVPGamePlayers();
            break;

        case 'pvp-stats':
            // Загружаем статистику PvP
            loadPVPStats();
            break;
    }
}

/**
 * Отрисовка главного экрана
 * Обновляет все элементы главного экрана на основе данных игрока
 */
function renderMain() {
    const player = gameState.player;
    if (!player) return;

    if (typeof updateProfileUI === 'function') {
        updateProfileUI(player);
    }

    // Обновляем имя игрока
    const nameEl = document.getElementById('player-name');
    if (nameEl) {
        nameEl.textContent = player.name || player.username || 'Выживший';
    }

    // Обновляем уровень
    const levelEl = document.getElementById('player-level');
    if (levelEl) {
        levelEl.textContent = player.level || 1;
    }
    
    // Обновляем прогресс опыта
    const expBar = document.getElementById('exp-bar');
    const expText = document.getElementById('exp-text');
    if (expBar && expText) {
        const expProgress = player.exp_progress || { current: player.experience || 0, needed: player.level * 500, percent: 0 };
        const percent = Math.min(100, expProgress.percent || Math.floor((expProgress.current / expProgress.needed) * 100));
        expBar.style.width = percent + '%';
        expText.textContent = `${expProgress.current}/${expProgress.needed}`;
    }

    // Обновляем текущую локацию
    const location = player.current_location || player.location || {};
    const locationIcon = document.getElementById('location-icon');
    const locationName = document.getElementById('location-name');
    const locationDesc = document.getElementById('location-desc');
    const locationRadiation = document.getElementById('location-radiation');
    const locationDanger = document.getElementById('location-danger');

    if (locationName) locationName.textContent = location.name || 'Спальный район';
    if (locationDesc) locationDesc.textContent = location.description || 'Тихий жилой комплекс';
    if (locationIcon) locationIcon.textContent = location.icon || '🏠';
    if (locationRadiation) locationRadiation.textContent = location.radiation || 0;
    if (locationDanger) locationDanger.textContent = location.danger_level || 1;

    if (typeof refreshPlayerEnergyUI === 'function') {
        refreshPlayerEnergyUI();
    }

    console.log('[renderMain] Главный экран обновлён');
}

/**
 * Инициализация обработчиков кнопок навигации
 */
function initNavigationHandlers() {
    // Обработчики кнопок "назад"
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetScreen = btn.dataset.screen || 'main';
            showScreen(targetScreen);
        });
    });

    // Обработчики табов (если есть)
    initTabHandlers();
}

/**
 * Инициализация табов (вкладок)
 */
function initTabHandlers() {
    // Табы рейтинга
    document.querySelectorAll('.rating-tab').forEach(tab => {
        bindClickOnce(tab, `rating${tab.dataset.tab || ''}`, () => {
            const tabName = tab.dataset.tab;
            loadRating(tabName);
        });
    });

    // Табы достижений
    document.querySelectorAll('.achievement-category-btn').forEach(tab => {
        bindClickOnce(tab, `achievements${tab.dataset.category || ''}`, () => {
            const category = tab.dataset.category;
            filterAchievements(category);
        });
    });

    // Табы PvP статистики (если есть)
    document.querySelectorAll('.pvp-stats-grid .stat-card').forEach(tab => {
        bindClickOnce(tab, `pvp${tab.dataset.tab || ''}`, () => {
            const tabName = tab.dataset.tab;
            loadPVPStats(tabName);
        });
    });

    // Табы магазина (если ещё не инициализированы)
    if (typeof initShopHandlers === 'function') {
        initShopHandlers();
    }
}

/**
 * Скрыть экран загрузки
 */
function hideLoadingScreen() {
    const loading = document.getElementById('loading-screen');
    if (loading) {
        loading.style.display = 'none';
    }
}

/**
 * Переключение на главный экран
 */
function goToMain() {
    showScreen('main');
}

/**
 * Показать экран профиля
 */
function showProfile() {
    showScreen('profile');
}

/**
 * Показать экран боя с боссом
 * @param {number} bossId - ID босса
 */
function showBossFight(bossId) {
    const boss = gameState.bosses?.find(b => b.id === bossId);
    if (boss) {
        // Используем существующую функцию startBossFight
        startBossFight(boss);
    }
}

/**
 * Вернуться к списку боссов
 */
function backToBosses() {
    gameState.currentBoss = null;
    showScreen('bosses');
}

// Экспортируем расширенную версию showScreen (перезаписывает базовую из game-utils)
window.showScreen = showScreen;
window.onScreenOpen = onScreenOpen;
window.renderMain = renderMain;
window.goToMain = goToMain;
window.showProfile = showProfile;
window.showBossFight = showBossFight;
window.backToBosses = backToBosses;
window.hideLoadingScreen = hideLoadingScreen;
/**
 * game-systems.js - Игровые системы
 * Основная логика игры: профиль, инвентарь, крафт, боссы, кланы, PvP, рынок, рефералы, база
 * 
 * Подключение: после game-core.js
 * Зависимости: gameState, apiRequest, showModal, showNotification, playSound, lockAction, unlockAction
 */

// ============================================================================
// ПРОФИЛЬ И ОСНОВНЫЕ ФУНКЦИИ
// ============================================================================

/**
 * Ожидание загрузки Telegram WebApp
 * @returns {Promise<void>}
 */
async function waitForTelegramWebApp(maxWait = 5000) {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
        // Если уже загружен - сразу разрешаем
        if (window.Telegram?.WebApp?.initData) {
            console.log('[waitForTelegramWebApp] Telegram WebApp уже загружен');
            resolve();
            return;
        }
        
        // Функция проверки
        const check = () => {
            if (window.Telegram?.WebApp?.initData) {
                console.log('[waitForTelegramWebApp] Telegram WebApp загружен');
                resolve();
                return;
            }
            
            if (Date.now() - startTime > maxWait) {
                console.warn('[waitForTelegramWebApp] Таймаут ожидания Telegram WebApp');
                resolve(); // Всё равно продолжаем - может работать через localStorage
                return;
            }
            
            setTimeout(check, 100);
        };
        
        check();
    });
}

/**
 * Инициализация игры
 */
async function initGame() {
    try {
        // Ждём пока загрузится Telegram WebApp
        await waitForTelegramWebApp();
        
        // Инициализируем Telegram WebApp
        if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.ready();
            window.Telegram.WebApp.expand();
        }
        
        const telegramId = getTelegramId();
        if (!telegramId) {
            showModal('Ошибка', 'Не удалось определить пользователя Telegram. Откройте игру через бота @LastHearthBot');
            return;
        }

        // Проверяем доступность initData
        const initData = getInitData();
        if (!initData) {
            console.warn('[initGame] initData не доступен, пробуем из localStorage');
            // Пробуем получить из localStorage
            const storedInitData = localStorage.getItem('init_data');
            if (!storedInitData) {
                showModal('Ошибка авторизации', 'Откройте игру через бота @LastHearthBot');
                return;
            }
        }

        // Проверяем/создаём игрока
        const verifyResult = await apiRequest('/verify-telegram', {
            method: 'POST',
            body: { telegram_id: telegramId }
        });
        
        // Загружаем профиль с обработкой ошибок
        try {
            await loadProfile();
        } catch (profileError) {
            console.error('[initGame] Ошибка загрузки профиля:', profileError);
            // Продолжаем - профиль может быть загружен позже
        }
        
        // Загружаем локации с обработкой ошибок
        try {
            await loadLocations();
        } catch (locationsError) {
            console.error('[initGame] Ошибка загрузки локаций:', locationsError);
            // Продолжаем - локации могут быть загружены позже
        }

        // Показываем главный экран
        showScreen('main');
        
        // Скрываем экран загрузки
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.remove('active');
        }
        
        // Запускаем обновление энергии
        safeSetInterval(updateEnergyDisplay, 60000); // Каждую минуту
        
        // Запускаем проверку статуса (переломы, инфекции)
        safeSetInterval(checkPlayerStatus, 600000); // Каждые 10 минут

    } catch (error) {
        console.error('Init error:', error);
        const loadingScreen = document.getElementById('loading-screen');
        
        // Проверяем тип ошибки для более понятного сообщения
        let errorMessage = 'Напиши /start боту';
        if (error.message && error.message.includes('401')) {
            errorMessage = 'Ошибка авторизации. Обновите игру';
        } else if (error.message && error.message.includes('Игрок не найден')) {
            errorMessage = 'Напиши /start боту';
        } else if (error.message && (error.message.includes('network') || error.message.includes('fetch'))) {
            errorMessage = 'Нет соединения. Проверь интернет';
        }
        
        if (loadingScreen) {
            loadingScreen.innerHTML = `
                <div class="loader">
                    <div class="loader-icon">😿</div>
                    <h1>Ошибка</h1>
                    <p>${errorMessage}</p>
                </div>
            `;
        }
    }
}

/**
 * Загрузка профиля игрока
 */
async function loadProfile() {
    const response = await apiRequest('/api/game/profile');
    
    // Проверяем success
    if (!response?.success) {
        console.error('Ошибка загрузки профиля:', response?.message || 'Unknown error');
        return;
    }
    
    // API возвращает { success: true, data: { ... } }
    // Нужно распаковать данные для удобного доступа
    const data = response?.data || response;
    
    if (!data || typeof data !== 'object') {
        console.error('Неверный формат ответа профиля:', response);
        return;
    }
    
    // Гарантируем наличие объекта статуса
    if (!data.status || typeof data.status !== 'object') {
        data.status = {};
    }
    
    // Также дублируем energy на верхний уровень для совместимости
    data.energy = data.status.energy;
    data.max_energy = data.status.max_energy;
    
    gameState.player = data;
    gameState.buffs = data.buffs || {};
    
    // Обновляем UI
    updateProfileUI(data);
    refreshPlayerEnergyUI();
}

// Ссылка на константу интервала энергии из game-core.js
const ENERGY_REGEN_INTERVAL_MS = CONSTANTS?.INTERVALS?.ENERGY_UPDATE || 60000;

function ensurePlayerStatus() {
    if (!gameState.player) {
        gameState.player = {};
    }

    if (!gameState.player.status) {
        gameState.player.status = {};
    }

    return gameState.player.status;
}

function getEffectivePlayerStatus() {
    const status = ensurePlayerStatus();
    const maxEnergy = Number(status.max_energy ?? gameState.player.max_energy ?? 0);
    const currentEnergy = Number(status.energy ?? gameState.player.energy ?? 0);

    status.max_energy = maxEnergy;
    status.energy = currentEnergy;

    if (status.last_energy_update && currentEnergy < maxEnergy) {
        const lastUpdateTime = new Date(status.last_energy_update).getTime();

        if (Number.isFinite(lastUpdateTime)) {
            const elapsedTicks = Math.floor((Date.now() - lastUpdateTime) / ENERGY_REGEN_INTERVAL_MS);

            if (elapsedTicks > 0) {
                const restored = Math.min(elapsedTicks, maxEnergy - currentEnergy);
                status.energy = currentEnergy + restored;
                status.last_energy_update = new Date(lastUpdateTime + (elapsedTicks * ENERGY_REGEN_INTERVAL_MS)).toISOString();
            }
        }
    }

    gameState.player.energy = status.energy;
    gameState.player.max_energy = status.max_energy;

    return status;
}

function syncPlayerEnergyState(energy, maxEnergy, lastEnergyUpdate = null) {
    const status = ensurePlayerStatus();

    if (energy !== undefined && energy !== null) {
        status.energy = Number(energy);
        gameState.player.energy = status.energy;
    }

    if (maxEnergy !== undefined && maxEnergy !== null) {
        status.max_energy = Number(maxEnergy);
        gameState.player.max_energy = status.max_energy;
    }

    if (lastEnergyUpdate) {
        status.last_energy_update = lastEnergyUpdate;
    }

    return status;
}

function updateSearchButtonsState() {
    const status = getEffectivePlayerStatus();
    const canSearch = status.energy >= 1 && !actionLocks.searchLoot;

    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.disabled = !canSearch;
        searchBtn.style.opacity = canSearch ? '1' : '0.5';
    }
}

function renderEnergyIndicators() {
    const status = getEffectivePlayerStatus();
    const maxEnergy = status.max_energy || 1;
    const currentEnergy = status.energy || 0;
    const percent = Math.max(0, Math.min(100, (currentEnergy / maxEnergy) * 100));

    const mainEnergyText = document.getElementById('energy-text');
    if (mainEnergyText) {
        mainEnergyText.textContent = `${Math.floor(currentEnergy)}/${maxEnergy}`;
    }

    const mainEnergyBar = document.getElementById('energy-bar');
    if (mainEnergyBar) {
        mainEnergyBar.style.width = `${percent}%`;
    }

    const bossEnergyText = document.getElementById('boss-energy-text');
    if (bossEnergyText) {
        bossEnergyText.textContent = `${Math.floor(currentEnergy)}/${maxEnergy}`;
    }
}

function refreshPlayerEnergyUI() {
    renderEnergyIndicators();
    updateSearchButtonsState();

    if (typeof updateEnergyTimer === 'function') {
        updateEnergyTimer();
    }
}

// Исправленная функция - теперь только уровень влияет на дроп
function updateDropChanceDisplay() {
    const luck = gameState.player?.stats?.luck || gameState.player?.luck || 1;
    const dropChance = Math.min(60, 10 + (luck * 0.4));
    const dropChanceEl = document.getElementById('player-drop-chance');
    if (dropChanceEl) {
        dropChanceEl.textContent = `${Math.round(dropChance * 10) / 10}%`;
    }
}

const MAIN_INSIGHTS_TTL_MS = 60 * 1000;

function getMainInsightsStore() {
    if (!gameState.mainInsights) {
        gameState.mainInsights = {
            loadedAt: 0,
            bosses: [],
            achievements: [],
            achievementStats: null
        };
    }

    return gameState.mainInsights;
}

async function refreshMainScreenInsights(force = false) {
    const store = getMainInsightsStore();
    const isFresh = (Date.now() - (store.loadedAt || 0)) < MAIN_INSIGHTS_TTL_MS;

    if (!force && isFresh) {
        if (gameState.player) {
            updateMainScreenInsights(gameState.player);
        }
        return store;
    }

    const [bossesResult, achievementsResult] = await Promise.allSettled([
        gameApi.bosses(),
        gameApi.achievements()
    ]);

    if (bossesResult.status === 'fulfilled') {
        const bossesPayload = bossesResult.value?.data || bossesResult.value || {};
        store.bosses = Array.isArray(bossesPayload.bosses) ? bossesPayload.bosses : [];
    }

    if (achievementsResult.status === 'fulfilled') {
        store.achievements = Array.isArray(achievementsResult.value?.progress)
            ? achievementsResult.value.progress
            : [];
        store.achievementStats = achievementsResult.value?.stats || null;
    }

    store.loadedAt = Date.now();

    if (gameState.player) {
        updateMainScreenInsights(gameState.player);
    }

    return store;
}

function getAchievementInsight() {
    const store = getMainInsightsStore();
    const achievements = Array.isArray(store.achievements) ? store.achievements : [];

    const claimable = achievements.find(achievement => achievement.completed && !achievement.reward_claimed);
    if (claimable) {
        return {
            value: claimable.name,
            desc: 'Награда уже готова к получению',
            action: 'achievements'
        };
    }

    const nextAchievement = achievements
        .filter(achievement => !achievement.reward_claimed)
        .sort((first, second) => (second.percent || 0) - (first.percent || 0))[0];

    if (nextAchievement) {
        return {
            value: `${nextAchievement.percent || 0}%`,
            desc: nextAchievement.name,
            action: 'achievements'
        };
    }

    return {
        value: 'Нет задач',
        desc: 'Все ближайшие награды уже закрыты',
        action: 'achievements'
    };
}

function getBossInsight() {
    const store = getMainInsightsStore();
    const bosses = Array.isArray(store.bosses) ? store.bosses : [];

    const availableBoss = bosses.find(boss => boss.can_start_solo);
    if (availableBoss) {
        return {
            value: availableBoss.name,
            desc: 'Босс уже доступен для соло-боя',
            available: true,
            action: 'bosses'
        };
    }

    const nextLockedBoss = bosses.find(boss => !boss.is_unlocked);
    if (nextLockedBoss) {
        const keysMissing = Math.max(0, (nextLockedBoss.required_keys || 0) - (nextLockedBoss.owned_keys || 0));
        return {
            value: nextLockedBoss.name,
            desc: keysMissing > 0 ? `Нужно ещё ключей: ${keysMissing}` : 'Условия почти выполнены',
            available: false,
            action: 'bosses'
        };
    }

    return {
        value: 'Все открыты',
        desc: 'Можно идти на сильнейшего босса',
        available: true,
        action: 'bosses'
    };
}

function getMainRecommendation(player) {
    const status = player.status || {};
    const health = Number(status.health || 0);
    const maxHealth = Math.max(1, Number(status.max_health || 100));
    const energy = Number(status.energy || player.energy || 0);
    const radiation = Number(status.radiation || 0);
    const infections = Number(status.infections || 0);
    const healthPercent = Math.round((health / maxHealth) * 100);
    const achievementInsight = getAchievementInsight();
    const bossInsight = getBossInsight();

    if (health <= 0) {
        return {
            tone: 'danger',
            state: 'Критично',
            title: 'Нужно восстановиться',
            text: 'У персонажа нет здоровья. Сначала лечение, потом вылазки.',
            primary: '❤️ Здоровье на нуле',
            secondary: '🎒 Открой инвентарь и используй лечение',
            actionLabel: 'Открыть инвентарь',
            action: 'inventory'
        };
    }

    if (radiation >= 5) {
        return {
            tone: 'danger',
            state: 'Опасно',
            title: 'Сними радиацию',
            text: 'Высокая радиация уже мешает безопасно фармить. Лучше сначала стабилизировать состояние.',
            primary: `☢️ Радиация: ${radiation}`,
            secondary: '🏪 В магазине уже есть антирад и лекарства',
            actionLabel: 'Открыть магазин',
            action: 'market'
        };
    }

    if (infections > 0) {
        return {
            tone: 'warning',
            state: 'Риск',
            title: 'Вылечи инфекцию',
            text: 'Инфекция будет тормозить прогресс. Лучше снять дебафф до долгой сессии.',
            primary: `🦠 Инфекция: ${infections}`,
            secondary: '💊 Лекарства уже доступны в магазине и инвентаре',
            actionLabel: 'Открыть магазин',
            action: 'market'
        };
    }

    if (achievementInsight.value !== 'Нет задач' && achievementInsight.desc.includes('готова')) {
        return {
            tone: 'ready',
            state: 'Награда',
            title: 'Можно забрать достижение',
            text: 'У тебя уже есть готовая награда. Забери её перед следующей вылазкой.',
            primary: `🏆 ${achievementInsight.value}`,
            secondary: '⭐ Бонус усилит ближайший прогресс',
            actionLabel: 'Открыть достижения',
            action: 'achievements'
        };
    }

    if (energy < 1) {
        return {
            tone: 'warning',
            state: 'Пауза',
            title: 'Подожди энергию или подготовься',
            text: 'Энергия закончилась. Можно купить расходники, проверить цели или зайти в боссы.',
            primary: '⚡ Энергия на нуле',
            secondary: '🛒 Подготовь инвентарь к следующей сессии',
            actionLabel: 'Открыть магазин',
            action: 'market'
        };
    }

    if (healthPercent <= 50) {
        return {
            tone: 'warning',
            state: 'Осторожно',
            title: 'Сначала подлечись',
            text: 'Энергия ещё есть, но по здоровью ты уже в опасной зоне для длинной вылазки.',
            primary: `❤️ ${health}/${maxHealth}`,
            secondary: '💊 Запасись лечением перед поиском',
            actionLabel: 'Открыть магазин',
            action: 'market'
        };
    }

    if (bossInsight.available) {
        return {
            tone: 'ready',
            state: 'Прорыв',
            title: `Можно идти на ${bossInsight.value}`,
            text: 'У тебя уже есть доступ к следующему боссу. Это лучший шанс быстро продвинуться по прогрессии.',
            primary: '👹 Босс доступен',
            secondary: '⚔️ Проверь урон и ключи перед стартом',
            actionLabel: 'Открыть боссов',
            action: 'bosses'
        };
    }

    return {
        tone: 'ready',
        state: 'Фарм',
        title: 'Лучший ход — искать припасы',
        text: 'Состояние стабильное. Сейчас выгодно тратить энергию на поиск, лут и подготовку к следующему боссу.',
        primary: `⚡ Энергии хватит ещё на ${energy} действий`,
        secondary: '🎯 Подходящий момент для фарма и прогресса',
        actionLabel: 'Начать поиск',
        action: 'search'
    };
}

function updateMainRecommendationUI(player) {
    const recommendation = getMainRecommendation(player);
    const card = document.getElementById('main-guidance-card');
    const stateEl = document.getElementById('guidance-state');
    const titleEl = document.getElementById('guidance-title');
    const textEl = document.getElementById('guidance-text');
    const primaryEl = document.getElementById('guidance-meta-primary');
    const secondaryEl = document.getElementById('guidance-meta-secondary');
    const actionBtn = document.getElementById('guidance-action-btn');

    if (card) {
        card.dataset.tone = recommendation.tone;
    }
    if (stateEl) stateEl.textContent = recommendation.state;
    if (titleEl) titleEl.textContent = recommendation.title;
    if (textEl) textEl.textContent = recommendation.text;
    if (primaryEl) primaryEl.textContent = recommendation.primary;
    if (secondaryEl) secondaryEl.textContent = recommendation.secondary;
    if (actionBtn) {
        actionBtn.textContent = recommendation.actionLabel;
        actionBtn.onclick = () => handleMainGuidanceAction(recommendation.action);
    }
}

function updateMainProgressCards(player) {
    const expProgress = player.exp_progress || { current: 0, needed: 0 };
    const remainingXp = Math.max(0, Number(expProgress.needed || 0) - Number(expProgress.current || 0));
    const nextLevelValue = document.getElementById('next-level-value');
    const nextLevelDesc = document.getElementById('next-level-desc');
    if (nextLevelValue) nextLevelValue.textContent = `${remainingXp} XP`;
    if (nextLevelDesc) nextLevelDesc.textContent = `До уровня ${(player.level || 1) + 1}`;

    const bossInsight = getBossInsight();
    const nextBossValue = document.getElementById('next-boss-value');
    const nextBossDesc = document.getElementById('next-boss-desc');
    if (nextBossValue) nextBossValue.textContent = bossInsight.value;
    if (nextBossDesc) nextBossDesc.textContent = bossInsight.desc;

    const rewardInsight = getAchievementInsight();
    const nextRewardValue = document.getElementById('next-reward-value');
    const nextRewardDesc = document.getElementById('next-reward-desc');
    if (nextRewardValue) nextRewardValue.textContent = rewardInsight.value;
    if (nextRewardDesc) nextRewardDesc.textContent = rewardInsight.desc;
}

function updateJourneyProgress(player) {
    const journey = player.journey || {};
    const bossesKilledEl = document.getElementById('journey-bosses-killed');
    const mainBossEl = document.getElementById('journey-main-boss');
    const mainBossDescEl = document.getElementById('journey-main-boss-desc');
    const nextZoneEl = document.getElementById('journey-next-zone');
    const nextZoneDescEl = document.getElementById('journey-next-zone-desc');
    const riskLabelEl = document.getElementById('journey-risk-label');
    const riskDescEl = document.getElementById('journey-risk-desc');

    if (bossesKilledEl) {
        bossesKilledEl.textContent = String(journey.bosses_killed || player.stats_ext?.bosses_killed || 0);
    }

    if (mainBossEl) {
        mainBossEl.textContent = journey.current_main_boss?.name || 'Нет цели';
    }
    if (mainBossDescEl) {
        if (journey.current_main_boss) {
            mainBossDescEl.textContent = journey.current_main_boss.defeated
                ? `Уже побеждён ${journey.current_main_boss.kills} раз`
                : 'Следующая главная цель';
        } else {
            mainBossDescEl.textContent = 'Боссы ещё не определены';
        }
    }

    if (nextZoneEl) {
        nextZoneEl.textContent = journey.next_zone?.name || 'Все зоны открыты';
    }
    if (nextZoneDescEl) {
        nextZoneDescEl.textContent = journey.next_zone
            ? `Нужен уровень ${journey.next_zone.required_level}, риск ${journey.next_zone.danger_level}/7`
            : 'Дальше только освоение самых опасных мест';
    }

    if (riskLabelEl) {
        riskLabelEl.textContent = journey.mastered_risk?.label || 'Стабильный риск';
    }
    if (riskDescEl) {
        riskDescEl.textContent = journey.mastered_risk
            ? `Освоен уровень опасности ${journey.mastered_risk.danger_level}/7`
            : 'Пока открыт только стартовый риск';
    }
}

function updateMainBonuses(player) {
    updateDropChanceDisplay();

    const strength = Number(player.stats?.strength || player.strength || 1);
    const weaponDamage = Number(player.equipment?.weapon?.damage || 0);
    const damagePreviewEl = document.getElementById('player-damage-preview');
    if (damagePreviewEl) {
        damagePreviewEl.textContent = `+${strength + weaponDamage}`;
    }

    const status = player.status || {};
    const survivalPreviewEl = document.getElementById('player-survival-preview');
    if (survivalPreviewEl) {
        if ((status.radiation || 0) >= 5 || (status.infections || 0) > 0) {
            survivalPreviewEl.textContent = 'Риск';
        } else if ((status.health || 0) <= ((status.max_health || 100) * 0.5)) {
            survivalPreviewEl.textContent = 'Низкое HP';
        } else {
            survivalPreviewEl.textContent = 'Стабильно';
        }
    }
}

function getEquipmentStatValue(item, keys) {
    if (!item || typeof item !== 'object') return 0;

    for (const key of keys) {
        const directValue = Number(item[key]);
        if (Number.isFinite(directValue) && directValue > 0) {
            return directValue;
        }
    }

    const stats = item.stats && typeof item.stats === 'object' ? item.stats : null;
    if (!stats) return 0;

    for (const key of keys) {
        const statValue = Number(stats[key]);
        if (Number.isFinite(statValue) && statValue > 0) {
            return statValue;
        }
    }

    return 0;
}

function calculatePlayerPreparation(player) {
    const equipment = player?.equipment || {};
    const slots = ['armor', 'helmet', 'body', 'head', 'hands', 'legs', 'boots', 'accessory'];

    let radiationResistance = 0;
    let infectionResistance = 0;

    for (const slot of slots) {
        const equippedItem = equipment[slot];
        radiationResistance += getEquipmentStatValue(equippedItem, ['radiation_resist', 'radiation_resistance', 'radiationDefense']);
        infectionResistance += getEquipmentStatValue(equippedItem, ['infection_resist', 'infection_resistance', 'infectionDefense']);
    }

    return {
        radiationDefense: Math.max(0, Math.round(radiationResistance / 10)),
        infectionDefense: Math.max(0, Math.round(infectionResistance / 10))
    };
}

function getCurrentZoneRiskProfile(player) {
    const location = player?.location || player?.current_location || {};
    const preparation = calculatePlayerPreparation(player || {});
    const radiationThreat = Math.max(0, Math.ceil(Number(location.radiation || 0) / 10));
    const infectionThreat = Math.max(0, Math.ceil(Number(location.infection || 0) / 10));
    const radiationPressure = Math.max(0, radiationThreat - preparation.radiationDefense);
    const infectionPressure = Math.max(0, infectionThreat - preparation.infectionDefense);
    const score = radiationPressure + infectionPressure;

    let tier = 'safe';
    let label = 'Стабильно';
    let hint = 'Зона безопасна для стабильного фарма.';

    if (score >= 9) {
        tier = 'deadly';
        label = 'Смертельно';
        hint = 'Очень высокий риск, но и самые выгодные находки для подготовки к сильным боссам.';
    } else if (score >= 6) {
        tier = 'danger';
        label = 'Опасно';
        hint = 'Шанс на лучший лут выше, но без подготовки дебаффы быстро накопятся.';
    } else if (score >= 3) {
        tier = 'warning';
        label = 'Риск';
        hint = 'Хорошая зона для рывка вперёд, если заранее подготовить защиту и расходники.';
    }

    return {
        tier,
        label,
        hint,
        score,
        radiationDefense: preparation.radiationDefense,
        infectionDefense: preparation.infectionDefense,
        isPrepared: score <= 2
    };
}

function updateZonePreparationUI(player) {
    const zoneRisk = getCurrentZoneRiskProfile(player || {});
    const riskLabel = document.getElementById('location-risk-label');
    const radDefense = document.getElementById('location-rad-defense');
    const infDefense = document.getElementById('location-inf-defense');
    const riskHint = document.getElementById('location-risk-hint');
    const prepPanel = document.getElementById('location-preparation-panel');

    if (riskLabel) riskLabel.textContent = zoneRisk.label;
    if (radDefense) radDefense.textContent = zoneRisk.radiationDefense;
    if (infDefense) infDefense.textContent = zoneRisk.infectionDefense;
    if (riskHint) riskHint.textContent = zoneRisk.hint;
    if (prepPanel) prepPanel.dataset.risk = zoneRisk.tier;

    return zoneRisk;
}

function findBestPreparationItem(type) {
    const inventory = Array.isArray(gameState.inventory) ? gameState.inventory : [];

    if (type === 'infection') {
        return inventory.find(item => Number(item?.stats?.infection_cure || item?.infection_cure || 0) > 0) || null;
    }

    if (type === 'radiation') {
        return inventory.find(item => Number(item?.stats?.radiation_cure || item?.rad_removal || 0) > 0) || null;
    }

    return null;
}

function updateRiskSummary(player) {
    const status = player.status || {};
    const health = Number(status.health || 0);
    const maxHealth = Math.max(1, Number(status.max_health || 100));
    const healthPercent = Math.round((health / maxHealth) * 100);
    const radiation = Number(status.radiation || 0);
    const infections = Number(status.infections || 0);

    const card = document.getElementById('risk-summary-card');
    const levelEl = document.getElementById('risk-summary-level');
    const textEl = document.getElementById('risk-summary-text');
    const actionEl = document.getElementById('risk-summary-action');
    const zoneRisk = getCurrentZoneRiskProfile(player);

    let risk = 'safe';
    let level = 'Стабильно';
    let text = 'Пока всё под контролем — можно безопасно продолжать вылазку.';
    let action = 'Ищи лут';

    if (health <= 0 || radiation >= 8 || infections >= 3) {
        risk = 'danger';
        level = 'Критическое состояние';
        text = 'Есть высокий шанс сорвать прогресс. Сначала стабилизируй персонажа.';
        action = 'Срочно лечиться';
    } else if (!zoneRisk.isPrepared && zoneRisk.score >= 6) {
        risk = 'danger';
        level = `Зона: ${zoneRisk.label}`;
        text = 'Текущая локация слишком опасна для твоей подготовки. Сначала усили защиту или возьми расходники.';
        action = 'Сначала подготовиться';
    } else if (!zoneRisk.isPrepared) {
        risk = 'warning';
        level = `Зона: ${zoneRisk.label}`;
        text = 'Локация уже выгоднее, но без подготовки дебаффы будут копиться слишком быстро.';
        action = 'Купить подготовку';
    } else if (healthPercent <= 50 || radiation >= 5 || infections > 0) {
        risk = 'warning';
        level = 'Повышенный риск';
        text = 'Можно играть дальше, но дебаффы и низкое здоровье уже заметно мешают.';
        action = 'Купить расходники';
    }

    if (card) card.dataset.risk = risk;
    if (levelEl) levelEl.textContent = level;
    if (textEl) textEl.textContent = text;
    if (actionEl) actionEl.textContent = action;
}

function setQuickEntryBadge(id, text) {
    const badge = document.getElementById(id);
    if (!badge) return;

    if (!text) {
        badge.style.display = 'none';
        badge.textContent = '';
        return;
    }

    badge.style.display = 'inline-flex';
    badge.textContent = text;
}

function syncUnlockedLocations(announce = false) {
    if (!Array.isArray(gameState.locations) || !gameState.locations.length || !gameState.player) {
        return;
    }

    const currentUnlocked = gameState.locations
        .filter((location) => gameState.player.level >= (location.required_level || location.min_level || 1))
        .map((location) => location.id);

    if (!Array.isArray(gameState.seenUnlockedLocations) || !gameState.seenUnlockedLocations.length) {
        gameState.seenUnlockedLocations = [...currentUnlocked];
        return;
    }

    if (!announce) {
        gameState.seenUnlockedLocations = [...currentUnlocked];
        return;
    }

    const unlockedNow = gameState.locations.filter(
        (location) => currentUnlocked.includes(location.id) && !gameState.seenUnlockedLocations.includes(location.id)
    );

    gameState.seenUnlockedLocations = [...currentUnlocked];

    unlockedNow.forEach((location) => {
        showLocationUnlockCelebration?.(location.name);
        showConfetti?.(90);
    });
}

function updateQuickEntryBadges(player) {
    const bossInsight = getBossInsight();
    const rewardInsight = getAchievementInsight();
    const locationDanger = Number(player.location?.danger_level || 1);
    const status = player.status || {};
    const zoneRisk = getCurrentZoneRiskProfile(player);

    setQuickEntryBadge('bosses-badge', bossInsight.available ? 'доступно' : 'цель');
    setQuickEntryBadge('shop-badge', (!zoneRisk.isPrepared || (status.radiation || 0) >= 5 || (status.infections || 0) > 0 || (status.health || 0) <= ((status.max_health || 100) * 0.5)) ? 'нужно' : 'запасы');
    setQuickEntryBadge('rating-badge', rewardInsight.desc.includes('готова') ? 'награда' : 'топы');
    setQuickEntryBadge('pvp-badge', locationDanger >= 6 ? 'опасно' : 'закрыто');
}

function updateMainScreenInsights(player) {
    if (!player) return;

    updateMainRecommendationUI(player);
    updateMainProgressCards(player);
    updateJourneyProgress(player);
    updateMainBonuses(player);
    updateRiskSummary(player);
    updateQuickEntryBadges(player);
    updateZonePreparationUI(player);
}

function handleMainGuidanceAction(action) {
    switch (action) {
        case 'search':
            document.getElementById('search-btn')?.click();
            break;
        case 'bosses':
            showScreen('bosses');
            break;
        case 'market':
            showScreen('market');
            break;
        case 'achievements':
            showScreen('achievements');
            break;
        case 'inventory':
            showScreen('inventory');
            break;
    }
}

/**
 * Обновление UI профиля
 */
async function updateProfileUI(player) {
    // Защитная проверка
    if (!player) return;
    
    // Имя игрока
    const nameEl = document.getElementById('player-name');
    if (nameEl) nameEl.textContent = player.first_name || 'Выживший';
    
    const levelEl = document.getElementById('player-level');
    if (levelEl) levelEl.textContent = player.level || 1;
    
    // Статы - с защитой от null
    const status = player.status || {};
    
    const healthText = document.getElementById('health-text');
    const healthBar = document.getElementById('health-bar');
    if (healthText) {
        healthText.textContent = `${status.health || 0}/${status.max_health || 100}`;
    }
    if (healthBar) {
        healthBar.style.width = `${((status.health || 0) / (status.max_health || 100)) * 100}%`;
    }
    
    refreshPlayerEnergyUI();
    
    // Статусы
    const radiationValue = document.getElementById('radiation-value');
    const infectionValue = document.getElementById('infection-value');
    if (radiationValue) radiationValue.textContent = status.radiation || 0;
    if (infectionValue) infectionValue.textContent = status.infections || 0;
    
    const coinsValue = document.getElementById('coins-value');
    if (coinsValue) coinsValue.textContent = player.coins || 0;
    
    // Локация
    if (player.location) {
        const locationIcon = document.getElementById('location-icon');
        const locationName = document.getElementById('location-name');
        const locationDesc = document.getElementById('location-desc');
        const locationRadiation = document.getElementById('location-radiation');
        const locationInfection = document.getElementById('location-infection');
        const locationDanger = document.getElementById('location-danger');
        if (locationIcon) locationIcon.textContent = player.location.icon || '🏠';
        if (locationName) locationName.textContent = player.location.name;
        if (locationDesc) locationDesc.textContent = player.location.description || 'Описание локации недоступно';
        if (locationRadiation) locationRadiation.textContent = player.location.radiation;
        if (locationInfection) locationInfection.textContent = player.location.infection || 0;
        if (locationDanger) locationDanger.textContent = player.location.danger_level || 1;
    }
    
    // Звёзды
    const invStars = document.getElementById('inv-stars');
    const invCoins = document.getElementById('inv-coins');
    const mainStars = document.getElementById('main-stars-value');
    const mainCoins = document.getElementById('main-coins-value');
    if (invStars) invStars.textContent = player.stars || 0;
    if (invCoins) invCoins.textContent = player.coins || 0;
    if (mainStars) mainStars.textContent = player.stars || 0;
    if (mainCoins) mainCoins.textContent = player.coins || 0;

    const searchBtnCost = document.querySelector('#search-btn .btn-cost');
    if (searchBtnCost) {
        searchBtnCost.textContent = player?.buffs?.free_energy ? 'Бесплатно' : '-1 ⚡';
    }

    renderActiveBuffs(player.buffs || gameState.buffs || {});
    
    // Обновляем отображение переломов и инфекций
    updateConditionsUI(status);
    updateMainScreenInsights(player);
    syncUnlockedLocations(true);
    refreshMainScreenInsights().catch(error => {
        console.debug('Не удалось обновить инсайты главного экрана:', error);
    });
}

function renderActiveBuffs(buffs = {}) {
    const section = document.getElementById('active-buffs-section');
    const list = document.getElementById('active-buffs-list');
    if (!section || !list) return;

    const buffMeta = {
        loot_x2: { icon: '📦', label: 'x2 добыча' },
        exp_x2: { icon: '⬆️', label: 'x2 опыт' },
        free_energy: { icon: '⚡', label: 'Без расхода энергии' },
        no_radiation: { icon: '☢️', label: 'Защита от радиации' }
    };

    const activeBuffs = Object.entries(buffs).filter(([, buff]) => {
        const expiresAt = new Date(buff?.expires_at || buff?.expiresAt || buff?.expires || 0).getTime();
        return Number.isFinite(expiresAt) && expiresAt > Date.now();
    });

    if (!activeBuffs.length) {
        section.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    section.style.display = 'flex';
    list.innerHTML = activeBuffs.map(([effect, buff]) => {
        const meta = buffMeta[effect] || { icon: '✨', label: effect };
        const expiresAt = new Date(buff?.expires_at || buff?.expiresAt || buff?.expires || 0).getTime();
        const minutesLeft = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000));

        return `
            <div class="active-buff-pill">
                <span class="buff-icon">${meta.icon}</span>
                <span class="buff-label">${meta.label}</span>
                <span class="buff-time">${minutesLeft}м</span>
            </div>
        `;
    }).join('');
}

/**
 * Обновление UI переломов и инфекций
 */
function updateConditionsUI(status) {
    const conditionsGrid = document.getElementById('conditions-grid');
    const infectionsDisplay = document.getElementById('infections-display');
    const infectionValue = document.getElementById('infection-value');
    const healActions = document.getElementById('heal-actions');
    const healInfectionsBtn = document.getElementById('heal-infections-btn');
    
    if (!conditionsGrid) return;
    
    const infections = status.infections || 0;
    if (infectionValue) infectionValue.textContent = infections;
    
    // Показываем/скрываем секцию состояний
    if (infections > 0) {
        conditionsGrid.style.display = 'grid';
        if (healActions) healActions.style.display = 'flex';
    } else {
        conditionsGrid.style.display = 'none';
        if (healActions) healActions.style.display = 'none';
    }
    
    // Инфекции
    if (infectionsDisplay) {
        if (infections > 0) {
            infectionsDisplay.style.display = 'flex';
            const infectionsTextEl = document.getElementById('infections-text');
            if (infectionsTextEl) {
                infectionsTextEl.textContent = `🤒 Инфекции: ${infections}`;
            }
            // Обновляем эффект
            const effect = document.getElementById('infection-effect');
            if (effect) {
                effect.textContent = `Ослабление: ур. ${infections}`;
            }
            if (healInfectionsBtn) healInfectionsBtn.style.display = 'flex';
        } else {
            infectionsDisplay.style.display = 'none';
            if (healInfectionsBtn) healInfectionsBtn.style.display = 'none';
        }
    }
}

/**
 * Загрузка списка локаций
 */
async function loadLocations() {
    const response = await apiRequest('/api/game/locations');
    const data = response.data || response;
    gameState.locations = data.locations || [];
    syncUnlockedLocations(false);
}

/**
 * Поиск лута (с защитой от двойного нажатия)
 */
async function searchLoot() {
    // Блокировка двойного нажатия
    if (actionLocks.searchLoot) return;

    const zoneRisk = getCurrentZoneRiskProfile(gameState.player || {});
    if (!zoneRisk.isPrepared && zoneRisk.score >= 3) {
        const shouldProceed = confirm(`Текущая зона: ${zoneRisk.label}. Защита может быть недостаточной. Продолжить вылазку?`);
        if (!shouldProceed) {
            return;
        }
    }

    actionLocks.searchLoot = true;
    
    const searchBtn = document.getElementById('search-btn');

    if (searchBtn) {
        searchBtn.disabled = true;
        searchBtn.classList.add('shake');
    }
    
    try {
        const response = await apiRequest('/api/game/world/search', {
            method: 'POST',
            body: {}
        });
        
        const result = response?.data || response;
        
        if (result.success) {
            // Анимация лута если предмет найден
            if (result.found_item) {
                showLootAnimation(result.found_item);
                if (result.found_item.type === 'key') {
                    showKeyAnimation?.();
                    showConfetti?.(80);
                    showKeyRewardCelebration?.(result.found_item.name);
                } else {
                    showModal(
                        '🎉 Предмет найден!',
                        `Вы нашли: ${result.found_item.name} (${result.found_item.rarity})`
                    );
                }
            } else {
                showModal(
                    '🔍 Поиск',
                    'Ничего не найдено. Попробуйте ещё раз!'
                );
            }
            
            // Обновляем энергию в UI
            if (result.energy) {
                syncPlayerEnergyState(
                    result.energy.current,
                    result.energy.max,
                    result.energy.last_update || null
                );
                refreshPlayerEnergyUI();
            }
            
            // Обновляем профиль после получения XP
            if (result.exp_gained !== undefined) {
                await loadProfile();
            }
            
            // Обновляем радиацию после поиска (всегда, не только при увеличении)
            if (result.radiation) {
                if (!gameState.player.status) gameState.player.status = {};
                gameState.player.status.radiation = result.radiation.level || 0;
                updateConditionsUI(gameState.player.status);
            }

            if (result.infection) {
                if (!gameState.player.status) gameState.player.status = {};
                const currentInfections = Number(gameState.player.status.infections || 0);
                gameState.player.status.infections = Math.max(0, currentInfections + Number(result.infection.gained || 0));
                updateConditionsUI(gameState.player.status);
            }

            if (result.risk_profile) {
                const riskHint = document.getElementById('location-risk-hint');
                if (riskHint) {
                    riskHint.textContent = result.risk_profile.is_prepared
                        ? 'Подготовка достаточная — можно стабильно фармить эту зону.'
                        : `Зона ${result.risk_profile.label}: шанс на лучший лут выше, но подготовка пока недостаточна.`;
                }
            }

            updateMainScreenInsights(gameState.player);
            
            // Анимация
            playSound('loot');
            updateMapRiskPreview();
            
        } else {
            // Обработка ошибок
            let errorMsg = result.message || result.error || 'Неизвестная ошибка';
            
            // Особая обработка для недостатка энергии
            if (result.code === 'INSUFFICIENT_ENERGY') {
                errorMsg = `Недостаточно энергии! Требуется: 1, у вас: ${result.energy || 0}`;
            }
            
            showModal('⚠️ Внимание', errorMsg);
        }
        
    } catch (error) {
        console.error('Search error:', error);
        showModal('❌ Ошибка', 'Не удалось выполнить поиск');
    } finally {
        if (searchBtn) {
            searchBtn.classList.remove('shake');
        }
        actionLocks.searchLoot = false;
        refreshPlayerEnergyUI();
    }
}

/**
 * Переход к локации
 */
async function moveToLocation(locationId) {
    try {
        const response = await apiRequest('/api/game/world/move', {
            method: 'POST',
            body: { location_id: locationId }
        });
        const result = response.data || response;
        
        if (result.success) {
            const locationData = result.location || result.data?.location;
            gameState.player.current_location_id = locationData?.id || locationId;
            gameState.player.location = locationData;
            updateProfileUI(gameState.player);
            updateMapRiskPreview();
            showScreen('main');
            showModal('✅ Успех', result.message || result.data?.message);
        } else {
            showModal('⚠️ Внимание', result.error || result.message);
        }
    } catch (error) {
        console.error('Move error:', error);
    }
}

/**
 * Обновление отображения энергии (локальное обновление без запроса к API)
 * Теперь также рассчитывает восстановление энергии на клиенте
 */
function updateEnergyDisplay() {
    refreshPlayerEnergyUI();
}

/**
 * Проверка статуса игрока (переломы, инфекции)
 */
async function checkPlayerStatus() {
    if (!gameState.player) return;
    
    try {
        const result = await apiRequest('/api/game/status/check', {
            method: 'POST',
            body: {}
        });
        
        if (result.died) {
            // Игрок умер
            showModal(
                result.reason === 'radiation' ? '☢️ Гибель' : '☠️ Гибель',
                result.message + '\n\nНапиши /start боту чтобы начать заново'
            );
            return;
        }
        
        // Обновляем UI если есть изменения
        if (result.infection_result?.success) {
            showModal('🤒 Инфекция!', result.infection_result.message);
        }
        
        // Перезагружаем профиль
        await loadProfile();
        
    } catch (error) {
        console.log('Ошибка проверки статуса:', error);
    }
}

// ============================================================================
// ИСПОЛЬЗОВАНИЕ ПРЕДМЕТОВ
// ============================================================================

/**
 * Использование предмета
 */
function isEquippableInventoryItem(item) {
    if (!item || typeof item !== 'object') return false;

    const type = String(item.type || '').toLowerCase();
    const slot = String(item.slot || '').toLowerCase();
    const category = String(item.category || '').toLowerCase();

    return type === 'weapon'
        || type === 'armor'
        || ['weapon', 'armor', 'helmet', 'boots', 'accessory'].includes(slot)
        || ['weapon', 'armor'].includes(category);
}

async function useItem(itemId, options = {}) {
    if (!lockAction('useItem')) return;
    try {
        const result = await apiRequest('/api/game/inventory/use-item', {
            method: 'POST',
            body: {
                item_index: parseInt(itemId, 10),
                equip: Boolean(options.equip)
            }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            showModal('✅ Успех', payload.message || result.message || 'Действие выполнено');
            
            // Обновляем инвентарь и профиль
            await loadInventory();
            await loadProfile();
            
            playSound('use');
        } else {
            showModal('⚠️ Внимание', result.error || result.message || 'Не удалось выполнить действие');
        }
    } catch (error) {
        console.error('Use item error:', error);
        showModal('⚠️ Внимание', error?.message || 'Не удалось использовать предмет');
    } finally {
        unlockAction('useItem');
    }
}

// ============================================================================
// СИСТЕМА ИНВЕНТАРЯ
// ============================================================================

/**
 * Загрузка инвентаря
 */
async function loadInventory() {
    try {
        const response = await apiRequest('/api/game/inventory');
        const data = response.data || response;
        const inventoryItems = Array.isArray(data.inventory) ? data.inventory : [];

        gameState.inventory = inventoryItems;
        
        // Обновляем статистику
        const invCoins = document.getElementById('inv-coins');
        const invStars = document.getElementById('inv-stars');
        if (invCoins) invCoins.textContent = gameState.player?.coins || 0;
        if (invStars) invStars.textContent = gameState.player?.stars || 0;
        
        // Применяем фильтр и сортировку
        renderInventoryWithFilters(inventoryItems);
        
    } catch (error) {
        console.error('Inventory error:', error);
    }
}

/**
 * Отрисовка инвентаря
 */
function renderInventory(items) {
    const grid = document.getElementById('inventory-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    const normalizedItems = Array.isArray(items) ? items : [];

    for (const item of normalizedItems) {
        const slot = document.createElement('div');
        slot.className = `inventory-slot item-rarity rarity-${item.rarity || 'common'}`;
        const isEquippable = isEquippableInventoryItem(item);
        const amount = item.quantity || item.count || 1;
        slot.innerHTML = `
            <span class="item-icon">${item.icon || '📦'}</span>
            <span class="item-count">${amount}</span>
        `;
        
        // Обработчик клика: расходник используем, экипировку надеваем
        slot.addEventListener('click', () => useItem(item.index, { equip: isEquippable }));
        
        grid.appendChild(slot);
    }
}

/**
 * Отрисовка инвентаря с учётом фильтра и сортировки
 */
function renderInventoryWithFilters(items) {
    if (!Array.isArray(items)) {
        renderInventory([]);
        return;
    }
    
    // Фильтрация предметов
    let filteredItems = [...items];
    
    if (typeof currentInventoryFilter !== 'undefined' && currentInventoryFilter !== 'all') {
        filteredItems = filteredItems.filter((item) => {
            const category = String(item.category || item.type || getItemCategory(item.id)).toLowerCase();
            return category === currentInventoryFilter;
        });
    }
    
    // Сортировка предметов
    const sortKey = typeof currentInventorySort !== 'undefined' ? currentInventorySort : 'id';
    filteredItems.sort((a, b) => {
        switch (sortKey) {
            case 'name':
                return (a.name || '').localeCompare(b.name || '');
            case 'rarity':
                const rarityOrder = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
                const rA = rarityOrder[a.rarity] || 0;
                const rB = rarityOrder[b.rarity] || 0;
                return rB - rA;
            case 'count':
                return (b.quantity || b.count || 1) - (a.quantity || a.count || 1);
            case 'id':
            default:
                return (a.id || 0) - (b.id || 0);
        }
    });

    renderInventory(filteredItems);
}

// ============================================================================
// СИСТЕМА БОССОВ
// ============================================================================

/**
 * Загрузка списка боссов с новой механикой "Война с боссами"
 * GET /bosses - массив боссов с полями: is_unlocked, keys_required, player_keys, mastery, can_attack
 */
async function loadBosses() {
    try {
        const response = await apiRequest('/api/game/bosses');
        const data = response?.data || response;

        gameState.bosses = Array.isArray(data?.bosses) ? data.bosses : [];
        gameState.raids = Array.isArray(data?.raids) ? data.raids : [];
        gameState.raidsParticipating = data?.participating_raid_ids || [];
        gameState.participatingBossIds = data?.participating_boss_ids || [];
        gameState.bossesInfo = data?.info || null;
        gameState.activeBattle = data?.active_battle || null;

        // Обновляем информацию об энергии игрока
        const playerEnergy = data?.player_energy;
        if (playerEnergy !== undefined) {
            syncPlayerEnergyState(
                playerEnergy,
                data?.player_max_energy ?? 100
            );
            refreshPlayerEnergyUI();
        }

        renderBossesInfo(gameState.bossesInfo);

        if (gameState.activeBattle?.type === 'solo' && gameState.activeBattle?.boss) {
            const timeRemaining = gameState.activeBattle?.time_remaining_ms;
            startBossFight(
                gameState.activeBattle.boss, 
                typeof timeRemaining === 'number' && timeRemaining > 0 ? timeRemaining : null
            );
            return;
        }

        if (gameState.activeBattle?.type === 'mass') {
            showScreen('bosses');
            switchBossesTab('mass');
            renderRaids(gameState.raids);
            return;
        }

        showScreen('bosses');
        switchBossesTab('solo');
        renderBosses(gameState.bosses);
    } catch (error) {
        console.error('Bosses error:', error);
        // При ошибке показываем пустой список
        gameState.bosses = [];
        gameState.raids = [];
        gameState.raidsParticipating = [];
        gameState.participatingBossIds = [];
        renderBosses([]);
        renderRaids([]);
    }
}

function renderBossesInfo(info) {
    const container = document.getElementById('bosses-info');
    if (!container) return;

    if (!info) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="bosses-info-card">
            <div><strong>Соло:</strong> ${info.solo || ''}</div>
            <div><strong>Прокачка:</strong> ${info.mastery || ''}</div>
            <div><strong>Массовый бой:</strong> ${info.raids || ''}</div>
        </div>
    `;
}

function switchBossesTab(tabName = 'solo') {
    const toggle = document.getElementById('boss-mode-switch');
    const isRaid = toggle ? toggle.checked : (tabName === 'mass');
    const isSolo = !isRaid;
    
    const bossesList = document.getElementById('bosses-list');
    const raidsList = document.getElementById('raids-list');

    if (bossesList) bossesList.style.display = isSolo ? 'block' : 'none';
    if (raidsList) raidsList.style.display = isSolo ? 'none' : 'block';

    if (isSolo) {
        renderBosses(gameState.bosses || []);
    } else {
        renderRaids(gameState.raids || []);
    }
}

// Обработчик переключателя режима боссов
document.getElementById('boss-mode-switch')?.addEventListener('change', function() {
    switchBossesTab(this.checked ? 'mass' : 'solo');
});

/**
 * Отрисовка боссов с новой механикой "Война с боссами"
 * - Показываем мастерство (убийства) для каждого босса
 * - Показываем ключи игрока и требования
 * - Заблокированные боссы показываем серыми
 * - Кнопка "Атаковать" только если is_unlocked && can_attack
 */
function renderBosses(bosses) {
    const list = document.getElementById('bosses-list');
    if (!list) return;
    list.innerHTML = '';
    
    // Если нет боссов
    if (!bosses || bosses.length === 0) {
        list.innerHTML = '<div class="empty-message">Нет доступных боссов</div>';
        return;
    }
    
    for (const boss of bosses) {
        const isUnlocked = boss.is_unlocked ?? false;
        const canStartSolo = boss.can_start_solo !== false;
        const canStartMass = boss.can_start_mass !== false;
        const playerKeys = boss.owned_keys ?? boss.player_keys ?? 0;
        const keysRequired = boss.required_keys ?? 0;
        const defeatedCount = boss.defeated_count ?? boss.mastery ?? 0;
        const currentDamage = boss.current_damage ?? 1;
        const currentHp = boss.hp ?? boss.max_hp;
        const maxHp = boss.max_hp || 1;
        const hpPercent = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));

        const item = document.createElement('div');
        item.className = `boss-item ${isUnlocked ? '' : 'locked'} ${isUnlocked ? 'available' : 'unavailable'}`;

        item.innerHTML = `
            <div class="boss-icon">${escapeHtml(boss.icon)}</div>
            <div class="boss-info">
                <div class="boss-name">${escapeHtml(boss.name)}</div>
                <div class="boss-desc">${escapeHtml(boss.description || '')}</div>
                <div class="boss-hp-bar">
                    <div class="boss-hp-fill" style="width: ${hpPercent}%"></div>
                </div>
                <div class="boss-hp-text">${formatNumber(currentHp)} / ${formatNumber(maxHp)} HP</div>
                <div class="boss-mastery">Побеждено: ${defeatedCount}</div>
                <div class="boss-damage">Урон по боссу: ${currentDamage}</div>
                <div class="boss-reward">💰 ${boss.reward_coins || 0} | ✨ ${boss.reward_experience || 0} XP</div>
                <div class="boss-keys ${isUnlocked ? 'unlocked' : ''}">
                    <span class="keys-owned">🔑 ${playerKeys}/${keysRequired}</span>
                    ${boss.id > 1 ? `<span class="keys-needed">нужно ${keysRequired} ключей</span>` : '<span class="keys-needed">первый босс без ключей</span>'}
                </div>
            </div>
            <div class="boss-actions">
                ${isUnlocked && canStartSolo
                    ? `<button class="attack-btn start-solo-btn" data-boss-id="${boss.id}">⚔️ Начать бой</button>`
                    : `<button class="attack-btn disabled" disabled>🔒 Соло-бой недоступен</button>`}
                ${isUnlocked && canStartMass
                    ? `<button class="attack-btn mass-btn" data-boss-id="${boss.id}">👥 Массовый бой</button>`
                    : `<button class="attack-btn disabled" disabled>👥 Массовый бой недоступен</button>`}
            </div>
        `;

        const soloBtn = item.querySelector('.start-solo-btn');
        if (soloBtn) {
            soloBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await startSoloBossFight(boss.id);
            });
        }

        const massBtn = item.querySelector('.mass-btn');
        if (massBtn) {
            massBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await startMassBossFight(boss.id);
            });
        }

        list.appendChild(item);
    }
}

async function startSoloBossFight(bossId) {
    try {
        const result = await apiRequest('/api/game/bosses/start', {
            method: 'POST',
            body: { boss_id: bossId }
        });
        
        const bossData = result?.data || result;

        if (result.success && bossData.boss) {
            startBossFight(bossData.boss, bossData.time_remaining_ms);
        } else {
            showModal('⚠️ Внимание', bossData.error || result.error || result.message || 'Не удалось начать бой');
        }
    } catch (error) {
        console.error('Start solo boss fight error:', error);
        showModal('❌ Ошибка', 'Не удалось начать бой с боссом');
    }
}

async function startMassBossFight(bossId) {
    try {
        const result = await apiRequest('/api/game/bosses/raid/start', {
            method: 'POST',
            body: { boss_id: bossId }
        });

        if (result.success) {
            await loadBosses();
            switchBossesTab('mass');
        } else {
            showModal('⚠️ Внимание', result.error || result.message || 'Не удалось начать массовый бой');
        }
    } catch (error) {
        console.error('Start mass boss fight error:', error);
        showModal('❌ Ошибка', 'Не удалось начать массовый бой');
    }
}

/**
 * Начало боя с боссом - обновлённый UI с кнопками атаки
 */
function startBossFight(boss, timeRemainingMs = null) {
    gameState.currentBoss = boss;
    gameState.bossFightEndTime = timeRemainingMs ? Date.now() + timeRemainingMs : null;
    const isFreeAttack = Boolean(gameState.buffs?.free_energy);
    
    const bossName = document.getElementById('boss-name');
    const bossIcon = document.getElementById('boss-icon');
    const bossHealthText = document.getElementById('boss-health-text');
    const bossHealthBar = document.getElementById('boss-health-bar');
    const fightLog = document.getElementById('fight-log');
    const bossTimer = document.getElementById('boss-fight-timer');
    const bossTimerText = document.getElementById('boss-timer-text');
    
    if (bossName) bossName.textContent = boss.name;
    if (bossIcon) {
        bossIcon.textContent = boss.icon;
        bossIcon.classList.remove('damage-shake');
    }
    const currentBossHp = boss.hp ?? boss.health ?? boss.max_health;
    const maxBossHp = boss.max_hp ?? boss.max_health;
    if (bossHealthText) bossHealthText.textContent = `${currentBossHp}/${maxBossHp}`;
    if (bossHealthBar) {
        bossHealthBar.style.width = `${Math.max(0, Math.min(100, (currentBossHp / maxBossHp) * 100))}%`;
    }
    if (fightLog) {
        fightLog.innerHTML = `
            <p class="fight-start">🎯 Бой с <strong>${escapeHtml(boss.name)}</strong> начался!</p>
            <p>${isFreeAttack ? 'Бафф активен: атаки не тратят энергию.' : '1 удар = 1 энергия.'} Бой длится 8 часов.</p>
        `;
    }
    
    // Показываем/скрываем таймер
    if (bossTimer && bossTimerText) {
        if (gameState.bossFightEndTime) {
            bossTimer.style.display = 'flex';
            updateBossFightTimer();
        } else {
            bossTimer.style.display = 'none';
        }
    }
    
    // Показываем кнопку атаки
    const attackSingleBtn = document.getElementById('attack-boss-btn');
    const progressContainer = document.getElementById('attack-progress-container');
    
    if (attackSingleBtn) {
        attackSingleBtn.style.display = 'inline-flex';
        attackSingleBtn.textContent = isFreeAttack ? '⚔️ Атаковать (бесплатно)' : '⚔️ Атаковать (1 ⚡)';
    }
    
    // Скрываем прогресс
    if (progressContainer) progressContainer.style.display = 'none';
    const attackMultiBtn = document.getElementById('attack-boss-multiple-btn');
    if (attackMultiBtn) attackMultiBtn.style.display = 'none';
    
    // Добавляем обработчики кнопок если ещё не добавлены
    if (attackSingleBtn && !attackSingleBtn.hasAttribute('data-handler')) {
        attackSingleBtn.setAttribute('data-handler', 'true');
        attackSingleBtn.addEventListener('click', attackBoss);
    }
    
    // Показываем экран боя
    showScreen('boss-fight');
}

/**
 * Обновление таймера боя с боссом
 */
function updateBossFightTimer() {
    const timerText = document.getElementById('boss-timer-text');
    if (!timerText || !gameState.bossFightEndTime) return;
    
    const updateTimer = () => {
        const now = Date.now();
        const remaining = gameState.bossFightEndTime - now;
        
        if (remaining <= 0) {
            timerText.textContent = 'Время вышло!';
            timerText.style.color = 'var(--accent-red)';
            return;
        }
        
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        timerText.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };
    
    updateTimer();
    if (window.bossFightTimerId) clearInterval(window.bossFightTimerId);
    window.bossFightTimerId = setInterval(updateTimer, 1000);
}

/**
 * Загрузка списка оружия игрока
 */
async function loadWeapons() {
    try {
        const result = await apiRequest('/api/game/bosses/weapons');
        
        if (result.success) {
            renderWeapons(result.weapons);
        } else {
            showNotification('Ошибка загрузки оружия', 'error');
        }
    } catch (error) {
        console.error('Load weapons error:', error);
        showNotification('Ошибка загрузки оружия', 'error');
    }
}

/**
 * Отрисовка списка оружия
 */
function renderWeapons(weapons) {
    const list = document.getElementById('weapon-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (!weapons || weapons.length === 0) {
        list.innerHTML = '<div class="empty-message">У вас нет оружия в инвентаре</div>';
        return;
    }
    
    for (const weapon of weapons) {
        const item = document.createElement('div');
        item.className = 'weapon-item';
        item.dataset.index = weapon.index;
        
        item.innerHTML = `
            <span class="weapon-icon">${weapon.icon}</span>
            <div class="weapon-info">
                <div class="weapon-name">${weapon.name}</div>
                <div class="weapon-damage">Урон: +${weapon.damage}</div>
            </div>
            <span class="weapon-rarity ${weapon.rarity}">${weapon.rarity}</span>
        `;
        
        item.addEventListener('click', () => attackWithWeapon(weapon.index));
        list.appendChild(item);
    }
}

/**
 * Атака босса с использованием оружия из инвентаря
 */
async function attackWithWeapon(itemIndex) {
    if (!gameState.currentBoss) return;
    
    if (actionLocks.attackBoss) return;
    actionLocks.attackBoss = true;
    
    const status = gameState.player?.status;
    const isFreeAttack = Boolean(gameState.buffs?.free_energy);
    if (!status || (!isFreeAttack && status.energy < 1)) {
        showModal('⚠️ Нет энергии', 'Подожди пока восстановится или купи за звёзды');
        actionLocks.attackBoss = false;
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/bosses/attack-with-weapon', {
            method: 'POST',
            body: { 
                boss_id: gameState.currentBoss.id,
                item_index: itemIndex
            }
        });
        
        const log = document.getElementById('fight-log');
        
        if (result.success) {
            showDamageAnimation();
            
            if (log) {
                const damageText = document.createElement('p');
                damageText.className = 'damage';
                damageText.innerHTML = `<span class="hit">⚔️</span> Использовал <strong>${result.data.weapon_used}</strong>! Нанёс <strong>${result.data.damage}</strong> урона!`;
                log.appendChild(damageText);
                log.scrollTop = log.scrollHeight;
            }
            
            const hpPercent = Math.max(0, Math.min(100, (result.data.boss_hp / result.data.boss_max_hp) * 100));
            const bossHealthBar = document.getElementById('boss-health-bar');
            const bossHealthText = document.getElementById('boss-health-text');
            if (bossHealthBar) bossHealthBar.style.width = `${hpPercent}%`;
            if (bossHealthText) bossHealthText.textContent = `${result.data.boss_hp}/${result.data.boss_max_hp}`;

            gameState.currentBoss.hp = result.data.boss_hp;
            gameState.currentBoss.max_hp = result.data.boss_max_hp;
            gameState.currentBoss.health = result.data.boss_hp;
            gameState.currentBoss.max_health = result.data.boss_max_hp;
             
            syncPlayerEnergyState(result.data.energy, gameState.player?.status?.max_energy);
            refreshPlayerEnergyUI();

            const attackBtn = document.getElementById('attack-boss-btn');
            if (attackBtn) {
                attackBtn.textContent = Boolean(gameState.buffs?.free_energy)
                    ? '⚔️ Атаковать (бесплатно)'
                    : '⚔️ Атаковать (1 ⚡)';
            }
            
            if (result.data.killed) {
                showVictoryFlash?.();
                showBossDeathParticles?.();
                showConfetti?.(120);
                if (result.data.rewards?.key?.boss_name) {
                    showKeyAnimation?.();
                }
                showBossVictorySummary?.(gameState.currentBoss?.name || 'Босс', result.data.rewards || {}, result.data.mastery ?? null);
                gameState.currentBoss = null;
                gameState.activeBattle = null;
                setTimeout(() => {
                    loadBosses().catch((loadError) => {
                        console.error('Boss reload error:', loadError);
                    });
                }, 2200);
            }
        } else {
            showNotification(result.error || 'Ошибка атаки', 'error');
        }
        
    } catch (error) {
        console.error('Attack with weapon error:', error);
        showNotification('Ошибка атаки', 'error');
    } finally {
        actionLocks.attackBoss = false;
    }
}

/**
 * Открытие экрана выбора оружия
 */
async function openWeaponSelect() {
    await loadWeapons();
    showScreen('weapon-select');
}

/**
 * Атака босса - один клик = одна атака = -1 энергия
 * Обновляем HP босса, показываем анимацию урона, обрабатываем убийство
 */
async function attackBoss() {
    if (!gameState.currentBoss) return;
    
    // Блокировка двойного нажатия
    if (actionLocks.attackBoss) return;
    actionLocks.attackBoss = true;
    
    // Проверка энергии
    const status = gameState.player?.status;
    const isFreeAttack = Boolean(gameState.buffs?.free_energy);
    if (!status || (!isFreeAttack && status.energy < 1)) {
        showModal('⚠️ Нет энергии', 'Подожди пока восстановится или купи за звёзды');
        actionLocks.attackBoss = false;
        return;
    }
    
    const btn = document.getElementById('attack-boss-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⚔️ Атакую...';
    }
    
    try {
        const result = await apiRequest('/api/game/bosses/attack-boss', {
            method: 'POST',
            body: { boss_id: gameState.currentBoss.id }
        });
        
        // Обновляем лог боя
        const log = document.getElementById('fight-log');
        
        if (result.success) {
            // Показываем анимацию урона
            showDamageAnimation();
            
            if (log) {
                const damageText = document.createElement('p');
                damageText.className = 'damage';
                damageText.innerHTML = `<span class="hit">⚔️</span> Нанёс <strong>${result.damage_dealt}</strong> урона!`;
                log.appendChild(damageText);
                log.scrollTop = log.scrollHeight;
            }
            
            // Обновляем HP босса
            const hpPercent = Math.max(0, Math.min(100, (result.boss_hp / result.boss_max_hp) * 100));
            const bossHealthBar = document.getElementById('boss-health-bar');
            const bossHealthText = document.getElementById('boss-health-text');
            if (bossHealthBar) bossHealthBar.style.width = `${hpPercent}%`;
            if (bossHealthText) bossHealthText.textContent = `${result.boss_hp}/${result.boss_max_hp}`;
            
            // Обновляем энергию игрока
            const energyUsed = document.getElementById('boss-energy-used');

            syncPlayerEnergyState(result.player_energy, gameState.player?.status?.max_energy);
            refreshPlayerEnergyUI();

            if (energyUsed) {
                energyUsed.textContent = isFreeAttack ? '0' : '-1';
                energyUsed.classList.add('show');
                setTimeout(() => energyUsed.classList.remove('show'), 500);
            }
            
            // Сохраняем текущее HP в state
            gameState.currentBoss.health = result.boss_hp;
            gameState.currentBoss.max_health = result.boss_max_hp;
            gameState.currentBoss.hp = result.boss_hp;
            gameState.currentBoss.max_hp = result.boss_max_hp;
            
            // Проверка на победу
            if (result.boss_defeated) {
                playSound('victory');
                showVictoryFlash?.();
                showBossDeathParticles?.();
                showConfetti?.(140);
                if (result.rewards?.key?.boss_name) {
                    showKeyAnimation?.();
                }
                showBossVictorySummary?.(gameState.currentBoss?.name || 'Босс', result.rewards || {}, result.mastery ?? null);
                gameState.currentBoss = null;
                gameState.activeBattle = null;
                
                // Обновляем мастерство
                if (result.mastery !== undefined) {
                    const masteryText = document.createElement('p');
                    masteryText.className = 'mastery-gain';
                    masteryText.innerHTML = `<span class="star">⭐</span> Мастерство: ${result.mastery}`;
                    if (log) log.appendChild(masteryText);
                }
                
                // Загружаем новых боссов
                setTimeout(() => {
                    loadBosses().catch((loadError) => {
                        console.error('Boss reload error:', loadError);
                    });
                }, 2200);
            }
            
            // Обновляем энергию локально (уже обновлена выше из result.player_energy)
            if (gameState.player?.status) {
                gameState.player.status.energy = result.player_energy;
            }
            
            playSound('attack');
        } else {
            showModal('⚠️ Внимание', result.message);
        }
        
    } catch (error) {
        console.error('Attack error:', error);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = Boolean(gameState.buffs?.free_energy)
                ? '⚔️ Атаковать (бесплатно)'
                : '⚔️ Атаковать (1 ⚡)';
        }
        actionLocks.attackBoss = false;
    }
}

/**
 * Показать анимацию урона
 * @param {number} damage - количество нанесённого урона (опционально)
 */
function showDamageAnimation(damage) {
    const bossIcon = document.getElementById('boss-icon');
    if (bossIcon) {
        bossIcon.classList.add('damage-shake');
        setTimeout(() => {
            bossIcon.classList.remove('damage-shake');
        }, 300);
    }
    
    // Показываем значение урона если передан
    if (damage !== undefined && damage !== null) {
        const damageText = document.createElement('div');
        damageText.className = 'damage-text';
        damageText.textContent = `-${damage}`;
        damageText.style.cssText = `
            position: absolute;
            color: #ff4444;
            font-size: 24px;
            font-weight: bold;
            animation: fadeUp 1s ease-out forwards;
            pointer-events: none;
        `;
        
        const bossContainer = document.querySelector('.boss-fight-container');
        if (bossContainer) {
            bossContainer.appendChild(damageText);
            setTimeout(() => damageText.remove(), 1000);
        }
    }
    
    // Создаём эффект частиц
    if (window.createDamageParticles) {
        const bossElement = document.querySelector('.boss-fight-container');
        if (bossElement) {
            window.createDamageParticles(bossElement);
        }
    }
}

// ============================================================================
// СИСТЕМА КЛАНОВ
// ============================================================================

// Состояние клана
let clanState = {
    clan: null,
    members: [],
    messages: []
};

/**
 * Загрузка информации о клане
 */
async function loadClan() {
    try {
        const data = await apiRequest('/api/game/clans/clan');
        
        if (data?.success && data?.data?.in_clan) {
            clanState.clan = data.data.clan;
            renderClanScreen(data.data);
        } else {
            // Игрок не в клане - показываем экран создания/вступления
            renderNoClanScreen();
        }
    } catch (error) {
        console.error('Clan load error:', error);
        
        // Обрабатываем ошибку 400 (игрок не в клане)
        // Сервер возвращает: { success: false, error: 'Вы не состоите в клане', code: 'NOT_IN_CLAN' }
        if (error.status === 400 || error.message?.includes('NOT_IN_CLAN')) {
            renderNoClanScreen();
            return;
        }
        
        // При других ошибках показываем экран без клана
        renderNoClanScreen();
    }
}

/**
 * Отрисовка экрана клана (игрок в клане)
 */
function renderClanScreen(data) {
    const content = document.getElementById('clan-content');
    if (!content) return;
    const clan = data.clan;
    const clanCoins = Number(clan.coins || 0);
    const totalDonated = Number(clan.total_donated || 0);
    
    const roleEmoji = { leader: '👑', officer: '⭐', member: '👤' };
    
    content.innerHTML = `
        <div class="clan-card">
            <div class="clan-header">
                <div class="clan-icon">🏰</div>
                <div class="clan-title">
                    <h3>${escapeHtml(clan.name)}</h3>
                    <span class="clan-level">Уровень ${clan.level}</span>
                </div>
            </div>
            ${clan.description ? `<p class="clan-description">${escapeHtml(clan.description)}</p>` : ''}
            <div class="clan-stats">
                <div class="clan-stat">
                    <span class="stat-icon">👥</span>
                    <span class="stat-value">${clan.total_members}</span>
                    <span class="stat-label">Участников</span>
                </div>
                <div class="clan-stat">
                    <span class="stat-icon">💰</span>
                    <span class="stat-value">${clanCoins}</span>
                    <span class="stat-label">Казна</span>
                </div>
                <div class="clan-stat">
                    <span class="stat-icon">✨</span>
                    <span class="stat-value">${clan.loot_bonus}%</span>
                    <span class="stat-label">Бонус добычи</span>
                </div>
                <div class="clan-stat">
                    <span class="stat-icon">📈</span>
                    <span class="stat-value">${totalDonated}</span>
                    <span class="stat-label">Пожертвовано всего</span>
                </div>
            </div>
        </div>
        
        <div class="clan-actions">
            <button class="action-btn" id="clan-chat-btn">
                <span class="btn-icon">💬</span>
                <span class="btn-text">Чат клана</span>
            </button>
            <button class="action-btn" id="clan-members-btn">
                <span class="btn-icon">👥</span>
                <span class="btn-text">Участники</span>
            </button>
            <button class="action-btn" id="clan-donate-btn">
                <span class="btn-icon">💎</span>
                <span class="btn-text">Пожертвовать</span>
            </button>
        </div>
        
        ${data.is_leader ? `
        <div class="clan-admin">
            <h4>Управление кланом</h4>
            <button class="action-btn secondary" id="clan-settings-btn">
                <span class="btn-icon">⚙️</span>
                <span class="btn-text">Настройки</span>
            </button>
            <button class="action-btn danger" id="clan-leave-btn">
                <span class="btn-icon">🚪</span>
                <span class="btn-text">Покинуть клан</span>
            </button>
        </div>
        ` : `
        <div class="clan-actions">
            <button class="action-btn danger" id="clan-leave-btn">
                <span class="btn-icon">🚪</span>
                <span class="btn-text">Покинуть клан</span>
            </button>
        </div>
        `}
        
        <div class="clan-members-preview">
            <h4>Участники онлайн</h4>
            <div class="members-list">
                ${data.members && data.members.length > 0 ? 
                    data.members.filter(m => m.is_online).map(m => `
                        <div class="member-item ${m.is_online ? 'online' : ''}">
                            <span class="member-role">${roleEmoji[m.clan_role]}</span>
                            <span class="member-name">${escapeHtml(m.first_name)}</span>
                            <span class="member-level">ур. ${m.level}</span>
                        </div>
                    `).join('') : 
                    '<div class="empty-message">Нет участников онлайн</div>'
                }
            </div>
        </div>
    `;
    
    document.getElementById('clan-chat-btn')?.addEventListener('click', () => showScreen('clan-chat'));
    document.getElementById('clan-members-btn')?.addEventListener('click', loadClanMembers);
    document.getElementById('clan-donate-btn')?.addEventListener('click', showDonateDialog);
    document.getElementById('clan-leave-btn')?.addEventListener('click', leaveClan);
    document.getElementById('clan-settings-btn')?.addEventListener('click', showClanSettings);
}

/**
 * Отрисовка экрана для игрока без клана
 */
function renderNoClanScreen() {
    const content = document.getElementById('clan-content');
    if (!content) return;
    
    content.innerHTML = `
        <div class="no-clan-card">
            <div class="no-clan-icon">🏰</div>
            <h3>Ты не состоишь в клане</h3>
            <p>Присоединяйся к клану или создай свой!</p>
        </div>
        
        <div class="clan-actions">
            <button class="action-btn" id="clans-list-btn">
                <span class="btn-icon">🔍</span>
                <span class="btn-text">Найти клан</span>
            </button>
            <button class="action-btn primary" id="create-clan-nav-btn">
                <span class="btn-icon">🏰</span>
                <span class="btn-text">Создать клан</span>
            </button>
        </div>
        
        <div class="clan-info">
            <h4>Зачем нужен клан?</h4>
            <ul>
                <li>💬 Общий чат с участниками</li>
                <li>✨ Бонус к добыче для всех участников</li>
                <li>👥 Совместная игра с друзьями</li>
                <li>🏆 Участие в клановых событиях</li>
            </ul>
        </div>
    `;
    
    document.getElementById('clans-list-btn')?.addEventListener('click', () => showScreen('clans-list'));
    document.getElementById('create-clan-nav-btn')?.addEventListener('click', () => showScreen('clan-create'));
}

/**
 * Создание клана
 */
async function createClan() {
    const nameInput = document.getElementById('clan-name-input');
    const descInput = document.getElementById('clan-desc-input');
    const publicInput = document.getElementById('clan-public-input');
    
    const name = nameInput?.value.trim() || '';
    const description = descInput?.value.trim() || '';
    const isPublic = publicInput?.checked || false;
    
    if (!name || name.length < 3) {
        showModal('⚠️ Ошибка', 'Название клана должно быть от 3 символов');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/clans/clan/create', {
            method: 'POST',
            body: { name, description, is_public: isPublic }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            showModal('✅ Успех', payload.message || 'Клан создан');
            if (nameInput) nameInput.value = '';
            if (descInput) descInput.value = '';
            showScreen('clan');
            loadClan();
        } else {
            showModal('⚠️ Ошибка', result.error || result.message || 'Не удалось создать клан');
        }
    } catch (error) {
        console.error('Create clan error:', error);
    }
}

/**
 * Загрузка списка кланов
 */
async function loadClansList(search = '') {
    try {
        const url = search ? '/api/game/clans?search=' + encodeURIComponent(search) : '/api/game/clans';
        const data = await apiRequest(url);
        const payload = data?.data || data;
        renderClansList(payload.clans || []);
    } catch (error) {
        console.error('Load clans error:', error);
    }
}

/**
 * Отрисовка списка кланов
 */
function renderClansList(clans) {
    const list = getEl('clans-list');
    if (!list) return;

    render(
        list,
        clans,
        (clan) => {
            return '<div class="clan-list-item" data-clan-id="' + escapeHtml(clan.id) + '">' +
                '<div class="clan-list-icon">🏰</div>' +
                '<div class="clan-list-info">' +
                    '<div class="clan-list-name">' + escapeHtml(clan.name) + '</div>' +
                    '<div class="clan-list-stats">👥 ' + (clan.member_count || 1) + ' | Уровень ' + escapeHtml(clan.level) + '</div>' +
                '</div>' +
                '<button class="join-btn" data-clan-id="' + escapeHtml(clan.id) + '">Вступить</button>' +
            '</div>';
        },
        '<div class="empty-message">Нет доступных кланов</div>'
    );
    
    list.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', () => joinClan(parseInt(btn.dataset.clanId)));
    });
}

/**
 * Вступление в клан
 */
async function joinClan(clanId) {
    try {
        const result = await apiRequest('/api/game/clans/clan/join', {
            method: 'POST',
            body: { clan_id: clanId }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            showModal('✅ Успех', payload.message || 'Вы вступили в клан');
            if (!payload.application_pending) {
                showScreen('clan');
                loadClan();
            }
        } else {
            showModal('⚠️ Ошибка', result.error || result.message || 'Не удалось вступить в клан');
        }
    } catch (error) {
        console.error('Join clan error:', error);
    }
}

/**
 * Выход из клана
 */
async function leaveClan() {
    if (!confirm('Ты уверен, что хочешь покинуть клан?')) return;
    
    try {
        const result = await apiRequest('/api/game/clans/clan/leave', {
            method: 'POST',
            body: {}
        });
        const payload = result?.data || result;
        
        if (result.success) {
            showModal('✅ Успех', payload.message || 'Вы покинули клан');
            clanState.clan = null;
            loadClan();
        } else {
            showModal('⚠️ Ошибка', result.error || result.message || 'Не удалось покинуть клан');
        }
    } catch (error) {
        console.error('Leave clan error:', error);
    }
}

/**
 * Загрузка участников клана
 */
async function loadClanMembers() {
    try {
        const data = await apiRequest('/api/game/clans/clan/members');
        const payload = data?.data || data;
        if (data.success) showClanMembersModal(payload.members || []);
    } catch (error) {
        console.error('Load members error:', error);
    }
}

/**
 * Показ модального окна с участниками
 */
function showClanMembersModal(members) {
    const roleEmoji = { leader: '👑', officer: '⭐', member: '👤' };
    
    let html = '<div class="clan-members-modal">';
    html += '<h3>👥 Участники клана</h3>';
    
    members.forEach(m => {
        html += '<div class="member-row">' +
            '<span class="member-role">' + roleEmoji[m.clan_role] + '</span>' +
            '<div class="member-info">' +
                '<div class="member-name">' + m.first_name + '</div>' +
                '<div class="member-level">Уровень ' + m.level + '</div>' +
            '</div>' +
            '<div class="member-status ' + (m.is_online ? 'online' : 'offline') + '">' +
                (m.is_online ? '🟢 Онлайн' : '⚪ Офлайн') +
            '</div>' +
        '</div>';
    });
    html += '</div>';
    
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modal = document.getElementById('modal');
    
    if (modalTitle) modalTitle.textContent = 'Участники клана';
    if (modalMessage) modalMessage.innerHTML = html;
    if (modal) modal.classList.add('active');
}

/**
 * Показ диалога пожертвования
 */
function showDonateDialog() {
    const amount = prompt('Сколько монет пожертвовать в клан?');
    if (!amount) return;
    
    const donateAmount = parseInt(amount);
    if (isNaN(donateAmount) || donateAmount <= 0) {
        showModal('⚠️ Ошибка', 'Введи корректную сумму');
        return;
    }
    
    if (donateAmount > (gameState.player?.coins || 0)) {
        showModal('⚠️ Ошибка', 'Недостаточно монет. У тебя: ' + (gameState.player?.coins || 0));
        return;
    }
    
    donateToClan(donateAmount);
}

/**
 * Пожертвование в клан
 */
async function donateToClan(amount) {
    if (!gameState.player) {
        showModal('⚠️ Ошибка', 'Данные игрока не загружены');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/clans/clan/donate', {
            method: 'POST',
            body: { amount }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            showModal('✅ Успех', `Пожертвование принято! Вы пожертвовали ${amount} монет. Казна: ${payload.clan_total || 0}`);
            gameState.player.coins = Number(payload.new_balance ?? (gameState.player.coins - amount));
            loadClan();
        } else {
            showModal('⚠️ Ошибка', result.error || result.message || 'Не удалось отправить пожертвование');
        }
    } catch (error) {
        console.error('Donate error:', error);
    }
}

/**
 * Показ настроек клана
 */
function showClanSettings() {
    const clan = clanState.clan;
    if (!clan) return;
    
    let html = '<div class="clan-settings">';
    html += '<p>Код приглашения: <strong>' + clan.invite_code + '</strong></p>';
    html += '<p>Поделитесь кодом с друзьями!</p>';
    html += '</div>';
    
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modal = document.getElementById('modal');
    
    if (modalTitle) modalTitle.textContent = 'Настройки клана';
    if (modalMessage) modalMessage.innerHTML = html;
    if (modal) modal.classList.add('active');
}

/**
 * Загрузка чата клана
 */
async function loadClanChat() {
    try {
        const data = await apiRequest('/api/game/clans/clan/chat');
        const payload = data?.data || data;
        if (data.success) renderClanChat(payload.messages || []);
    } catch (error) {
        console.error('Load chat error:', error);
    }
}

/**
 * Отрисовка чата клана
 */
function renderClanChat(messages) {
    const container = getEl('clan-chat-messages');
    if (!container) return;

    render(
        container,
        messages,
        (msg) => {
            const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            const playerName = msg.first_name || msg.username || 'Игрок';
            return '<div class="chat-message">' +
                '<div class="chat-header">' +
                    '<span class="chat-author">' + playerName + '</span>' +
                    '<span class="chat-level">[' + msg.level + ']</span>' +
                    '<span class="chat-time">' + time + '</span>' +
                '</div>' +
                '<div class="chat-text">' + escapeHtml(msg.message) + '</div>' +
            '</div>';
        },
        '<div class="empty-message">Сообщений пока нет</div>'
    );
    
    container.scrollTop = container.scrollHeight;
}

/**
 * Отправка сообщения в чат
 */
async function sendClanMessage() {
    const input = document.getElementById('clan-message-input');
    const message = input?.value.trim();
    
    if (!message) return;
    
    try {
        const result = await apiRequest('/api/game/clans/clan/chat', {
            method: 'POST',
            body: { message }
        });
        
        if (result.success) {
            if (input) input.value = '';
            loadClanChat();
        }
    } catch (error) {
        console.error('Send message error:', error);
    }
}

// ============================================================================
// ВОССТАНОВЛЕНИЕ ЭНЕРГИИ
// ============================================================================

/**
 * Восстановление энергии за Stars
 */
async function restoreEnergy() {
    const cost = 1;
    
    if (!gameState.player) {
        showModal('⚠️ Ошибка', 'Данные игрока не загружены');
        return;
    }
    
    const playerStars = gameState.player.stars || 0;
    if (playerStars < cost) {
        showModal('⚠️ Внимание', 'Недостаточно звёзд!');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/player/buy-energy', {
            method: 'POST',
            body: { amount: 10 }
        });
        
        if (result.success) {
            syncPlayerEnergyState(result.energy, result.max_energy, result.last_energy_update || null);
            refreshPlayerEnergyUI();
            await loadProfile();
            showModal('✅ Успех', `Энергия восстановлена! (-${result.stars_spent} ⭐)`);
        }
    } catch (error) {
        console.error('Restore energy error:', error);
    }
}

// ============================================================================
// РЕЙТИНГ
// ============================================================================

/**
 * Просмотр рейтинга
 */
async function loadRating(type = 'players') {
    try {
        const data = await apiRequest(`/rating/${type}`);
        
        // Обрабатываем разные форматы ответа
        const rating = data?.data?.rating || data?.rating || [];
        renderRating(rating, type);
    } catch (error) {
        console.error('Rating error:', error);
        
        // При ошибке показываем пустой список
        const list = document.getElementById('rating-list');
        if (list) {
            list.innerHTML = '<div class="empty-message">Рейтинг временно недоступен</div>';
        }
    }
}

/**
 * Отрисовка рейтинга
 */
function renderRating(items, type) {
    const list = document.getElementById('rating-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (!items || items.length === 0) {
        list.innerHTML = '<div class="empty-message">Нет данных для отображения</div>';
        return;
    }
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rank = document.createElement('div');
        rank.className = 'rating-item';
        
        if (type === 'players') {
            rank.innerHTML = `
                <span class="rank rank-${i + 1}">#${i + 1}</span>
                <div class="info">
                    <div class="name">${escapeHtml(item.first_name) || 'Игрок'}</div>
                    <div class="stats">Уровень ${item.level} | ${item.bosses_killed} боссов</div>
                </div>
            `;
        } else {
            rank.innerHTML = `
                <span class="rank rank-${i + 1}">#${i + 1}</span>
                <div class="info">
                    <div class="name">${escapeHtml(item.name)}</div>
                    <div class="stats">Уровень ${item.level} | ${item.total_members} участников</div>
                </div>
            `;
        }
        
        list.appendChild(rank);
    }
}
// ============================================================================
// ЛЕЧЕНИЕ
// ============================================================================

/**
 * Лечение инфекций
 */
async function healInfections() {
    const status = gameState.player?.status;
    if (!status || status.infections === 0) {
        showModal('ℹ️ Инфо', 'У вас нет инфекций');
        return;
    }

    if (!Array.isArray(gameState.inventory) || gameState.inventory.length === 0) {
        await loadInventory();
    }

    const cureItem = findBestPreparationItem('infection');
    if (!cureItem) {
        showModal('⚠️ Нет антидота', 'В инвентаре нет предмета для лечения инфекции. Загляни в магазин подготовки.');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/inventory/use-item', {
            method: 'POST',
            body: { item_index: cureItem.index }
        });
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            await loadInventory();
            await loadProfile();
        } else {
            showModal('⚠️ Внимание', result.message || result.error || 'Не удалось вылечить инфекцию');
        }
    } catch (error) {
        console.error('Ошибка лечения:', error);
    }
}

function updateMapRiskPreview() {
    const infoContainer = document.querySelector('.map-info');
    if (!infoContainer) return;

    const info = infoContainer.querySelector('.map-location-info');
    if (!info || !gameState.player?.location) return;

    const zoneRisk = getCurrentZoneRiskProfile(gameState.player);
    info.textContent = `☢️ ${gameState.player.location.radiation || 0} | 🦠 ${gameState.player.location.infection || 0} | ${zoneRisk.label}`;
}

// ============================================================================
// АНИМАЦИИ И ЭФФЕКТЫ
// ============================================================================

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================================================

window.initGame = initGame;
window.loadProfile = loadProfile;
window.updateProfileUI = updateProfileUI;
window.updateConditionsUI = updateConditionsUI;
window.loadLocations = loadLocations;
window.searchLoot = searchLoot;
window.moveToLocation = moveToLocation;
window.updateEnergyDisplay = updateEnergyDisplay;
window.checkPlayerStatus = checkPlayerStatus;
window.useItem = useItem;
window.loadInventory = loadInventory;
window.renderInventory = renderInventory;
window.renderInventoryWithFilters = renderInventoryWithFilters;
window.loadBosses = loadBosses;
window.renderBosses = renderBosses;
window.startBossFight = startBossFight;
window.updateBossFightTimer = updateBossFightTimer;
window.attackBoss = attackBoss;
window.openWeaponSelect = openWeaponSelect;
window.loadWeapons = loadWeapons;
window.renderWeapons = renderWeapons;
window.attackWithWeapon = attackWithWeapon;

// =============================================================================
// РЕЙДЫ БОССОВ (МУЛЬТИПЛЕЕР)
// =============================================================================

/**
 * Загрузка активных рейдов
 */
async function loadRaids() {
    try {
        const response = await apiRequest('/api/game/bosses/raids');
        const data = response?.data || response;
        gameState.raids = data.raids || [];
        gameState.raidsParticipating = data.participating_raid_ids || [];
        gameState.participatingBossIds = data.participating_boss_ids || [];
        return data;
    } catch (error) {
        console.error('Ошибка загрузки рейдов:', error);
        gameState.raids = [];
        gameState.raidsParticipating = [];
        gameState.participatingBossIds = [];
        return { raids: [], participating_boss_ids: [] };
    }
}

/**
 * Отображение списка рейдов
 */
function renderRaids(raids) {
    const container = document.getElementById('raids-list');
    if (!container) return;
    
    if (!raids || raids.length === 0) {
        container.innerHTML = '<div class="empty-message">Нет активных рейдов</div>';
        return;
    }
    
    container.innerHTML = raids.map(raid => {
        const hpPercent = raid.hp_percent || 0;
        const timeRemaining = formatTimeRemaining(raid.time_remaining_ms);
        const isParticipating = gameState.raidsParticipating?.includes(raid.id);
        
        return `
            <div class="raid-item" data-raid-id="${raid.id}" data-boss-id="${raid.boss.id}">
                <div class="raid-boss-icon">${raid.boss.icon || '👾'}</div>
                <div class="raid-info">
                    <div class="raid-boss-name">${raid.boss.name}</div>
                    <div class="raid-hp-bar">
                        <div class="raid-hp-fill" style="width: ${hpPercent}%"></div>
                    </div>
                    <div class="raid-hp-text">${formatNumber(raid.hp)} / ${formatNumber(raid.max_hp)} (${hpPercent}%)</div>
                    <div class="raid-leader">Лидер: ${escapeHtml(raid.leader?.name || 'Неизвестно')}</div>
                    <div class="raid-participants">Участников: ${raid.participants_count || 0}</div>
                    <div class="raid-timer">Осталось: ${timeRemaining}</div>
                    ${isParticipating ? 
                        `<button class="btn-attack" onclick="attackRaid(${raid.id})">Атаковать</button>` :
                        `<button class="btn-join" onclick="joinRaid(${raid.id})">Присоединиться</button>`
                    }
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Начать массовый бой или одиночный бой
 * @param {number} bossId - ID босса
 * @param {boolean} isRaid - true = массовый бой, false = соло
 */
async function startRaid(bossId, isRaid = true) {
    if (isRaid) {
        return startMassBossFight(bossId);
    }

    return startSoloBossFight(bossId);
}

/**
 * Присоединиться к рейду
 * @param {number} raidId - ID рейда
 */
async function joinRaid(raidId) {
    try {
        const result = await apiRequest(`/api/game/bosses/raid/${raidId}/join`, {
            method: 'POST'
        });
        const payload = result?.data || result;
        
        if (result.success) {
            showNotification(`Вы присоединились к рейду против ${payload?.boss?.name || 'босса'}!`, 'success');
             
            // Обновляем список рейдов
            await loadRaids();
            renderRaids(gameState.raids);
        } else {
            showNotification(result.error || 'Ошибка', 'error');
        }
        
        return result;
    } catch (error) {
        console.error('Ошибка присоединения к рейду:', error);
        showNotification('Ошибка при присоединении', 'error');
    }
}

/**
 * Атаковать в рейде
 * @param {number} raidId - ID рейда
 */
async function attackRaid(raidId) {
    if (!lockAction('attackBoss')) return;

    try {
        const result = await apiRequest(`/api/game/bosses/raid/${raidId}/attack`, {
            method: 'POST'
        });
        
        if (result.success) {
            const data = result.data;
            
            // Показываем урон
            showDamageAnimation(data.damage);

            if (typeof data.player_energy === 'number') {
                syncPlayerEnergyState(data.player_energy, gameState.player?.status?.max_energy);
                refreshPlayerEnergyUI();
            }
            
            // Обновляем UI рейда
            await loadRaids();
            renderRaids(gameState.raids);
            
            // Если босс убит
            if (data.killed) {
                showVictoryFlash?.();
                showBossDeathParticles?.();
                showConfetti?.(160);
                if (data.rewards?.key?.boss_name) {
                    showKeyAnimation?.();
                }
                gameState.activeBattle = null;
                showBossVictorySummary?.('Рейдовый босс', data.rewards || {}, null);
            } else if (typeof data.your_total_damage === 'number') {
                showNotification(`Урон нанесён. Ваш вклад: ${data.your_total_damage}`, 'success');
            }
        } else {
            showNotification(result.error || 'Ошибка атаки', 'error');
        }
        
        return result;
    } catch (error) {
        console.error('Ошибка атаки в рейде:', error);
        showNotification('Ошибка при атаке', 'error');
    } finally {
        unlockAction('attackBoss');
    }
}

/**
 * Форматирование оставшегося времени
 */
function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Завершён';
    
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
        return `${hours}ч ${minutes}м`;
    }
    return `${minutes}м`;
}

// Экспорты
window.loadRaids = loadRaids;
window.renderRaids = renderRaids;
window.startRaid = startRaid;
window.joinRaid = joinRaid;
window.attackRaid = attackRaid;
window.formatTimeRemaining = formatTimeRemaining;

window.loadClan = loadClan;
window.renderClanScreen = renderClanScreen;
window.renderNoClanScreen = renderNoClanScreen;
window.createClan = createClan;
window.loadClansList = loadClansList;
window.renderClansList = renderClansList;
window.joinClan = joinClan;
window.leaveClan = leaveClan;
window.loadClanMembers = loadClanMembers;
window.showClanMembersModal = showClanMembersModal;
window.showDonateDialog = showDonateDialog;
window.donateToClan = donateToClan;
window.showClanSettings = showClanSettings;
window.loadClanChat = loadClanChat;
window.renderClanChat = renderClanChat;
window.sendClanMessage = sendClanMessage;
window.restoreEnergy = restoreEnergy;
window.loadRating = loadRating;
window.renderRating = renderRating;
window.healInfections = healInfections;
/**
 * game-ui.js - Интерфейс и обработчики событий
 * Обработчики DOM, фильтры, модальные окна, PvP, достижения, рефералы
 * 
 * Подключение: после game-systems.js
 * Зависимости: все функции из game-core.js и game-systems.js
 */

// ============================================================================
// ФИЛЬТРЫ ИНВЕНТАРЯ
// ============================================================================

// Глобальные переменные для фильтрации и сортировки инвентаря
let currentInventoryFilter = 'all';
let currentInventorySort = 'id';
let inventoryControlsInitialized = false;

/**
 * Инициализация обработчиков кнопок фильтрации и сортировки
 */
function initInventoryControls() {
    if (inventoryControlsInitialized) return;
    inventoryControlsInitialized = true;

    // Кнопки фильтров
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentInventoryFilter = btn.dataset.filter;
            renderInventoryWithFilters(gameState.inventory);
        });
    });
    
    // Выбор сортировки
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            currentInventorySort = sortSelect.value;
            renderInventoryWithFilters(gameState.inventory);
        });
    }
}

// ============================================================================
// ДОСТИЖЕНИЯ
// ============================================================================

// Текущая категория достижений
let currentAchievementCategory = null;

/**
 * Загрузка достижений
 */
async function loadAchievements() {
    try {
        const data = await apiRequest('/api/achievements/progress');
        
        if (data && data.progress) {
            renderAchievementsStats(data.stats);
            renderAchievementsCategories(data.categories);
            
            if (currentAchievementCategory) {
                renderAchievementsList(data.progress.filter(a => a.category === currentAchievementCategory));
            } else {
                renderAchievementsList(data.progress);
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки достижений:', error);
    }
}

/**
 * Отрисовка статистики достижений
 */
function renderAchievementsStats(stats) {
    const container = document.getElementById('achievements-stats');
    if (!container) return;
    
    container.innerHTML = `
        <div class="total">${stats.completed} / ${stats.total_achievements}</div>
        <div class="subtitle">Выполнено достижений</div>
    `;
}

/**
 * Отрисовка категорий достижений
 */
function renderAchievementsCategories(categories) {
    const container = document.getElementById('achievements-categories');
    if (!container) return;
    
    const categoryNames = {
        survival: '🌅 Выживание',
        bosses: '👾 Боссы',
        pvp: '⚔️ PvP',
        collection: '📦 Коллекция',
        exploration: '🗺️ Исследование',
        social: '👥 Социальное'
    };
    
    let html = `<button class="achievement-category-btn ${!currentAchievementCategory ? 'active' : ''}" 
        onclick="filterAchievements(null)">Все</button>`;
    
    for (const [key, cat] of Object.entries(categories)) {
        html += `
            <button class="achievement-category-btn ${currentAchievementCategory === key ? 'active' : ''}" 
                onclick="filterAchievements('${key}')">
                ${categoryNames[key] || key} (${cat.completed}/${cat.total})
            </button>
        `;
    }
    
    container.innerHTML = html;
}

/**
 * Фильтрация достижений по категории
 */
async function filterAchievements(category) {
    currentAchievementCategory = category;
    
    // Фильтруем уже загруженные данные вместо перезагрузки
    const data = await apiRequest('/api/achievements/progress');
    
    if (data && data.progress) {
        renderAchievementsStats(data.stats);
        renderAchievementsCategories(data.categories);
        
        if (currentAchievementCategory) {
            renderAchievementsList(data.progress.filter(a => a.category === currentAchievementCategory));
        } else {
            renderAchievementsList(data.progress);
        }
    }
}

/**
 * Отрисовка списка достижений
 */
function renderAchievementsList(achievements) {
    const container = document.getElementById('achievements-list');
    if (!container) return;
    
    if (!achievements || achievements.length === 0) {
        container.innerHTML = '<div class="empty">Нет достижений</div>';
        return;
    }
    
    let html = '';
    
    for (const ach of achievements) {
        let reward;
        try {
            reward = typeof ach.reward === 'string' ? JSON.parse(ach.reward) : ach.reward;
        } catch(e) {
            console.error('JSON.parse reward failed:', ach.reward);
            reward = ach.reward;
        }
        const rarityClass = `rarity-${ach.rarity || 'common'}`;
        
        html += `
            <div class="achievement-card ${ach.completed ? 'completed' : ''} ${rarityClass}">
                <div class="icon">${ach.icon || '🏆'}</div>
                <div class="info">
                    <div class="name">${escapeHtml(ach.name || '')}</div>
                    <div class="description">${escapeHtml(ach.description || '')}</div>
                    <div class="progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${ach.percent}%"></div>
                        </div>
                        <div class="progress-text">${ach.current}/${ach.target}</div>
                    </div>
                    ${reward && (reward.coins > 0 || reward.stars > 0) ? `
                        <div class="reward">
                            ${reward.coins > 0 ? `<span class="reward-item">💰 ${reward.coins}</span>` : ''}
                            ${reward.stars > 0 ? `<span class="reward-item">⭐ ${reward.stars}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
                ${ach.completed && !ach.reward_claimed ? `
                    <button class="claim-btn" onclick="claimAchievement(${ach.id})">Получить</button>
                ` : ''}
                ${ach.reward_claimed ? `
                    <div class="claimed-badge">✓ Получено</div>
                ` : ''}
            </div>
        `;
    }
    
    container.innerHTML = html;
}

/**
 * Получение награды за достижение
 */
async function claimAchievement(achievementId) {
    try {
        const data = await apiRequest('/api/achievements/claim', {
            method: 'POST',
            body: { achievement_id: achievementId }
        });
        
        if (data.success) {
            showModal('✅ Награда получена', data.message || 'Награда получена');
            updateBalanceDisplay(data.new_balance);
            await loadAchievements();
        } else {
            showModal('❌ Ошибка', data.error || 'Ошибка получения награды');
        }
    } catch (error) {
        console.error('Ошибка получения награды:', error);
        showModal('❌ Ошибка', 'Ошибка получения награды');
    }
}

// ============================================================================
// PVP СИСТЕМА
// ============================================================================

/**
 * Загрузка списка игроков в PvP зоне
 */
async function loadPVPGamePlayers() {
    try {
        const result = await apiRequest('/api/game/pvp/players');
        const payload = result?.data || result;
        
        const indicator = document.getElementById('pvp-zone-indicator');
        const list = document.getElementById('pvp-players-list');
        if (!indicator || !list) return;
        
        if (payload.available === false) {
            indicator.innerHTML = `<div class="pvp-zone-safe">🛡️ ${payload.message || 'PvP недоступно'}</div>`;
            list.innerHTML = '<div class="empty-message">Перейдите в локацию с опасностью 6+ для PvP</div>';
            return;
        }
        
        indicator.innerHTML = '<div class="pvp-zone-danger">⚠️ КРАСНАЯ ЗОНА - PvP РАЗРЕШЕНО!</div>';
        
        if (!payload.players || payload.players.length === 0) {
            list.innerHTML = '<div class="empty-message">Нет игроков для атаки</div>';
            return;
        }
        
        list.innerHTML = payload.players.map(player => `
            <div class="pvp-player-item">
                <div class="pvp-player-info">
                    <div class="pvp-player-name">${escapeHtml(player.username) || 'Игрок'}</div>
                    <div class="pvp-player-stats">
                        <span>Уровень: ${player.level}</span>
                        <span>HP: ${player.health}/${player.max_health}</span>
                    </div>
                    <div class="pvp-player-pvp">
                        <span>Побед: ${player.pvp_wins || 0}</span>
                        <span>Рейтинг: ${player.pvp_rating || 1000}</span>
                        <span>Серия: ${player.pvp_streak || 0}</span>
                    </div>
                </div>
                <button
                    class="pvp-attack-player-btn"
                    data-target-id="${player.id}"
                    data-target-name="${escapeHtml(player.username) || 'Игрок'}"
                    data-target-level="${player.level}"
                    data-target-health="${player.health}"
                    data-target-max-health="${player.max_health}">
                    ⚔️ Атаковать
                </button>
            </div>
        `).join('');

        list.querySelectorAll('.pvp-attack-player-btn').forEach((button) => {
            button.addEventListener('click', () => {
                startPVPFight(
                    Number(button.dataset.targetId),
                    button.dataset.targetName || 'Игрок',
                    Number(button.dataset.targetLevel || 1),
                    Number(button.dataset.targetHealth || 0),
                    Number(button.dataset.targetMaxHealth || 100)
                );
            });
        });
        
    } catch (error) {
        console.error('Ошибка загрузки PvP игроков:', error);
    }
}

/**
 * Начало PvP боя
 */
async function startPVPFight(targetId, targetName, targetLevel, targetHealth, targetMaxHealth) {
    try {
        const result = await apiRequest('/api/game/pvp/attack', {
            method: 'POST',
            body: { target_id: targetId }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            gameState.pvpMatch = {
                battleId: payload.battle_id,
                targetId: targetId,
                targetName: targetName,
                targetLevel: targetLevel
            };
            
            const defenderName = document.getElementById('pvp-defender-name');
            const defenderLevel = document.getElementById('pvp-defender-level');
            const attackerName = document.getElementById('pvp-attacker-name');
            const attackerLevel = document.getElementById('pvp-attacker-level');
            
            if (defenderName) defenderName.textContent = targetName;
            if (defenderLevel) defenderLevel.textContent = `Уровень: ${targetLevel}`;
            if (attackerName) attackerName.textContent = 'Вы';
            if (attackerLevel && gameState.player) attackerLevel.textContent = `Уровень: ${gameState.player.level}`;
            
            updatePVPHealth(
                'attacker',
                gameState.player?.status?.health || 100,
                gameState.player?.status?.max_health || 100
            );
            updatePVPHealth('defender', targetHealth, targetMaxHealth);
            
            const battleLog = document.getElementById('pvp-battle-log');
            if (battleLog) {
                battleLog.innerHTML = `
                    <p>⚔️ Бой начат против ${escapeHtml(targetName)}!</p>
                    <p>${gameState.buffs?.free_energy ? 'Атаки бесплатны благодаря активному баффу' : 'Каждый удар тратит 1 энергию'}</p>
                `;
            }

            const attackBtn = document.getElementById('pvp-attack-btn');
            if (attackBtn) {
                attackBtn.disabled = false;
                attackBtn.textContent = gameState.buffs?.free_energy ? '👊 АТАКОВАТЬ БЕСПЛАТНО' : '👊 АТАКОВАТЬ';
            }
             
            showScreen('pvp-fight');
            playSound('attack');
        } else {
            showModal('❌ Ошибка', result.error || result.message || 'Не удалось начать PvP бой');
        }
        
    } catch (error) {
        console.error('Ошибка начала PvP:', error);
        showModal('❌ Ошибка', 'Не удалось начать бой');
    }
}

/**
 * Атака в PvP
 */
async function attackPVPTarget() {
    if (!gameState.pvpMatch || !gameState.pvpMatch.battleId) {
        showModal('❌ Ошибка', 'Бой не найден');
        return;
    }
    
    const attackBtn = document.getElementById('pvp-attack-btn');
    if (attackBtn) {
        attackBtn.disabled = true;
        attackBtn.textContent = '⏳ АТАКА...';
    }

    try {
        const result = await apiRequest('/api/game/pvp/attack-hit', {
            method: 'POST',
            body: { battle_id: gameState.pvpMatch.battleId }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            playSound('attack');

            if (payload.energy_left !== undefined && gameState.player?.status) {
                gameState.player.status.energy = payload.energy_left;
                gameState.player.energy = payload.energy_left;
                refreshPlayerEnergyUI?.();
            }
            
            if (payload.battleEnded) {
                handlePVPBattleEnd(payload);
            } else {
                if (payload.hit) {
                    updatePVPHealth(
                        'attacker',
                        payload.hit.yourHealth,
                        gameState.player?.status?.max_health || 100
                    );
                    updatePVPHealth('defender', payload.hit.targetHealth, payload.hit.maxHealth);
                    
                    const log = document.getElementById('pvp-battle-log');
                    if (log) {
                        log.innerHTML += `<p>${payload.message || 'Удар нанесён'}</p>`;
                        log.scrollTop = log.scrollHeight;
                    }
                }
            }
            
            loadProfile();
            
        } else {
            showModal('❌ Ошибка', result.error || result.message || 'Не удалось выполнить атаку');
        }
        
    } catch (error) {
        console.error('Ошибка атаки в PvP:', error);
    } finally {
        if (attackBtn) {
            attackBtn.disabled = false;
            attackBtn.textContent = gameState.buffs?.free_energy ? '👊 АТАКОВАТЬ БЕСПЛАТНО' : '👊 АТАКОВАТЬ';
        }
    }
}

/**
 * Обновление здоровья в PvP
 */
function updatePVPHealth(target, current, max) {
    const percent = Math.max(0, (current / max) * 100);
    const healthBar = document.getElementById(`pvp-${target}-health`);
    const healthText = document.getElementById(`pvp-${target}-health-text`);
    
    if (healthBar) healthBar.style.width = `${percent}%`;
    if (healthText) healthText.textContent = `${Math.max(0, current)}/${max}`;
}

/**
 * Обработка завершения PvP боя
 */
function handlePVPBattleEnd(result) {
    const log = document.getElementById('pvp-battle-log');
    if (log) {
        log.innerHTML += `<p class="battle-result">${result.message}</p>`;
        log.scrollTop = log.scrollHeight;
    }
    
    const attackBtn = document.getElementById('pvp-attack-btn');
    if (attackBtn) attackBtn.style.display = 'none';
    
    const rewardsDiv = document.getElementById('pvp-rewards');
    const rewardsContent = document.getElementById('pvp-rewards-content');
    
    if (result.winner && result.winner.id === gameState.player?.id) {
        if (rewardsContent) {
            rewardsContent.innerHTML = `
                <div class="reward-item">💰 +${result.rewards?.coins || 0} монет</div>
                <div class="reward-item">📦 ${result.rewards?.item ? 'Получен предмет' : 'Без предмета'}</div>
                <div class="reward-item">⭐ +${result.rewards?.experience || 0} опыта</div>
            `;
        }
        playSound('loot');
    } else {
        if (rewardsContent) {
            rewardsContent.innerHTML = `
                <div class="reward-item loss">Вы проиграли бой</div>
                <div class="reward-item loss">Телепортированы в безопасную зону</div>
            `;
        }
    }
    
    if (rewardsDiv) rewardsDiv.style.display = 'block';
    
    gameState.pvpMatch = null;
    
    loadProfile();
}

/**
 * Забрать награды PvP
 */
async function claimPVPRewards() {
    const rewardsDiv = document.getElementById('pvp-rewards');
    const attackBtn = document.getElementById('pvp-attack-btn');
    const battleLog = document.getElementById('pvp-battle-log');
    
    if (rewardsDiv) rewardsDiv.style.display = 'none';
    if (attackBtn) attackBtn.style.display = 'block';
    if (battleLog) battleLog.innerHTML = '<p>⚔️ Бой завершён!</p>';
    
    showScreen('pvp-players');
    loadPVPGamePlayers();
}

/**
 * Загрузка PvP статистики
 */
async function loadPVPStats() {
    try {
        const result = await apiRequest('/api/game/pvp/stats');
        const payload = result?.data || result;
        
        if (result.success && payload.stats) {
            const stats = payload.stats;
            
            setElementText('pvp-rating-value', stats.rating || 1000);
            setElementText('pvp-wins', stats.wins || 0);
            setElementText('pvp-losses', stats.losses || 0);
            setElementText('pvp-streak', stats.streak || 0);
            setElementText('pvp-max-streak', stats.maxStreak || 0);
            setElementText('pvp-damage-dealt', stats.totalDamageDealt || 0);
            setElementText('pvp-damage-taken', stats.totalDamageTaken || 0);
            setElementText('pvp-coins-lost', stats.coinsStolenFromMe || 0);
            setElementText('pvp-items-lost', stats.itemsStolenFromMe || 0);
            
            // Кулдаун
            const cooldownDiv = document.getElementById('pvp-cooldown');
            if (payload.cooldown && payload.cooldown.active && cooldownDiv) {
                cooldownDiv.style.display = 'flex';
                const expiresAt = new Date(payload.cooldown.expiresAt);
                const timerEl = document.getElementById('pvp-cooldown-timer');
                
                const updateTimer = () => {
                    const now = new Date();
                    const diff = expiresAt - now;
                    if (diff <= 0) {
                        cooldownDiv.style.display = 'none';
                        if (window.pvpCooldownTimerId) {
                            clearInterval(window.pvpCooldownTimerId);
                            window.pvpCooldownTimerId = null;
                        }
                        return;
                    }
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    if (timerEl) timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                };
                
                updateTimer();
                if (window.pvpCooldownTimerId) clearInterval(window.pvpCooldownTimerId);
                window.pvpCooldownTimerId = setInterval(updateTimer, 1000);
            } else if (cooldownDiv) {
                cooldownDiv.style.display = 'none';
                if (window.pvpCooldownTimerId) {
                    clearInterval(window.pvpCooldownTimerId);
                    window.pvpCooldownTimerId = null;
                }
            }
            
            // Последние бои
            const matchesList = document.getElementById('pvp-recent-matches-list');
            if (matchesList) {
                if (payload.recentMatches && payload.recentMatches.length > 0) {
                    matchesList.innerHTML = payload.recentMatches.map(m => {
                        const resultClass = m.result === 'win' ? 'win' : (m.result === 'loss' ? 'loss' : 'draw');
                        const resultIcon = m.result === 'win' ? '✅' : (m.result === 'loss' ? '❌' : '➖');
                        const date = new Date(m.date).toLocaleDateString();
                        
                        return `
                            <div class="pvp-match-item ${resultClass}">
                                <div class="match-result">${resultIcon}</div>
                                <div class="match-info">
                                    <div class="match-opponent">vs ${m.opponentName || 'Игрок'}</div>
                                    <div class="match-date">${date}</div>
                                </div>
                                <div class="match-damage">
                                    <span>⬆️ ${m.damageDealt || 0}</span>
                                    <span>⬇️ ${m.damageTaken || 0}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                } else {
                    matchesList.innerHTML = '<div class="empty-message">Нет боёв</div>';
                }
            }
            
        }
        
    } catch (error) {
        console.error('Ошибка загрузки PvP статистики:', error);
    }
}

// ============================================================================
// РЕФЕРАЛЬНАЯ СИСТЕМА
// ============================================================================

/**
 * Загрузка реферального кода
 */
async function loadReferralCode() {
    try {
        const result = await apiRequest('/api/game/player/referral/code');
        
        if (result.success) {
            const codeEl = document.getElementById('referral-code');
            if (codeEl) codeEl.textContent = result.code;
            
            const changeSection = document.getElementById('referral-change-section');
            if (changeSection) {
                changeSection.style.display = result.can_change ? 'block' : 'none';
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки реферального кода:', error);
    }
}

/**
 * Загрузка статистики рефералов
 */
async function loadReferralStats() {
    try {
        const result = await apiRequest('/api/game/player/referral/stats');
        
        if (result.success) {
            setElementText('total-referrals', result.stats.total_referrals);
            setElementText('total-coins-earned', result.stats.total_coins_earned);
            setElementText('total-stars-earned', result.stats.total_stars_earned);
        }
    } catch (error) {
        console.error('Ошибка загрузки статистики рефералов:', error);
    }
}

/**
 * Загрузка списка рефералов
 */
async function loadReferralsList() {
    try {
        const result = await apiRequest('/api/game/player/referral/list');
        
        const listContainer = document.getElementById('referrals-list');
        
        if (result.success && result.referrals.length > 0) {
            listContainer.innerHTML = result.referrals.map(ref => {
                const joinedDate = new Date(ref.joined_at).toLocaleDateString();
                const bonusIcons = [];
                if (ref.bonuses.level_5) bonusIcons.push('⭐');
                if (ref.bonuses.level_10) bonusIcons.push('⭐⭐');
                if (ref.bonuses.level_20) bonusIcons.push('⭐⭐⭐');
                
                return `
                    <div class="referral-item">
                        <div class="referral-info">
                            <div class="referral-name">${escapeHtml(ref.first_name || ref.username || 'Игрок')}</div>
                            <div class="referral-level">Уровень ${ref.level}</div>
                            <div class="referral-joined">Присоединился: ${joinedDate}</div>
                        </div>
                        <div class="referral-bonuses">${bonusIcons.join(' ') || '🕐'}</div>
                    </div>
                `;
            }).join('');
        } else if (listContainer) {
            listContainer.innerHTML = '<div class="empty-message">У тебя пока нет рефералов. Пригласи друзей!</div>';
        }
    } catch (error) {
        console.error('Ошибка загрузки списка рефералов:', error);
    }
}

/**
 * Загрузка данных реферального экрана
 */
async function loadReferralScreen() {
    await Promise.all([
        loadReferralCode(),
        loadReferralStats(),
        loadReferralsList()
    ]);
}

/**
 * Копирование реферального кода
 */
function copyReferralCode() {
    const codeEl = document.getElementById('referral-code');
    const code = codeEl?.textContent;
    if (!code) return;
    
    navigator.clipboard.writeText(code).then(() => {
        showModal('✅ Скопировано', 'Реферальный код скопирован в буфер обмена!');
    }).catch(() => {
        showModal('❌ Ошибка', 'Не удалось скопировать код');
    });
}

/**
 * Изменение реферального кода
 */
async function changeReferralCode() {
    const newCodeInput = document.getElementById('new-referral-code');
    const newCode = newCodeInput?.value.trim().toUpperCase();
    
    if (!newCode) {
        showModal('❌ Ошибка', 'Введите новый код');
        return;
    }
    if (newCode.length < 3 || newCode.length > 20) {
        showModal('❌ Ошибка', 'Код должен быть от 3 до 20 символов');
        return;
    }
    if (!/^[A-Z0-9_]+$/.test(newCode)) {
        showModal('❌ Ошибка', 'Код должен содержать только латинские буквы, цифры и подчёркивания');
        return;
    }

    if (!lockAction('referral')) return;
    
    try {
        const result = await apiRequest('/api/game/player/referral/code', {
            method: 'PUT',
            body: { new_code: newCode }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            const codeEl = document.getElementById('referral-code');
            const changeSection = document.getElementById('referral-change-section');
            if (codeEl) codeEl.textContent = payload.code;
            if (changeSection) changeSection.style.display = 'none';
            if (newCodeInput) newCodeInput.value = '';
            showModal('✅ Успех', 'Реферальный код изменён!');
        } else {
            showModal('❌ Ошибка', result.error || 'Не удалось изменить код');
        }
    } catch (error) {
        console.error('Ошибка изменения реферального кода:', error);
        showModal('❌ Ошибка', 'Произошла ошибка');
    } finally {
        unlockAction('referral');
    }
}

/**
 * Использование реферального кода
 */
async function useReferralCode() {
    const codeInput = document.getElementById('use-referral-code');
    const code = codeInput?.value.trim().toUpperCase();
    
    if (!code) {
        showModal('❌ Ошибка', 'Введите реферальный код');
        return;
    }
    if (code.length < 3 || code.length > 20) {
        showModal('❌ Ошибка', 'Код должен быть от 3 до 20 символов');
        return;
    }

    if (!lockAction('referral')) return;
    
    try {
        const result = await apiRequest('/api/game/player/referral/use', {
            method: 'POST',
            body: { code: code }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            const bonus = payload.bonus || {};
            showModal(
                '🎁 Бонус получен!',
                `Ты получил: +${bonus.coins || 0} монет, +${bonus.energy || 0} Energy!`
            );
            if (codeInput) codeInput.value = '';
            loadProfile();
        } else {
            showModal('❌ Ошибка', result.error || 'Не удалось использовать код');
        }
    } catch (error) {
        console.error('Ошибка использования реферального кода:', error);
        showModal('❌ Ошибка', 'Произошла ошибка');
    } finally {
        unlockAction('referral');
    }
}

/**
 * Инициализация обработчиков реферальной системы
 */
function initReferralHandlers() {
    document.getElementById('copy-referral-code')?.addEventListener('click', copyReferralCode);
    document.getElementById('change-referral-code-btn')?.addEventListener('click', changeReferralCode);
    document.getElementById('use-referral-code-btn')?.addEventListener('click', useReferralCode);
}

// ============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================================

/**
 * Установка текста элемента
 */
function setElementText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ============================================================================
// ОБРАБОТЧИКИ СОБЫТИЙ DOM
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Нижняя навигация
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const screen = btn.dataset.screen;
            if (screen && typeof showScreen === 'function') {
                showScreen(screen);
            }
        });
    });

    // Основные кнопки
    document.getElementById('search-btn')?.addEventListener('click', () => searchLoot());
    document.getElementById('map-btn')?.addEventListener('click', () => showScreen('map'));
    document.getElementById('inventory-btn')?.addEventListener('click', () => showScreen('inventory'));
    document.getElementById('boss-fight-inventory-btn')?.addEventListener('click', () => openWeaponSelect());
    document.getElementById('bosses-btn')?.addEventListener('click', () => showScreen('bosses'));
    document.getElementById('shop-btn')?.addEventListener('click', () => showScreen('shop'));
    document.getElementById('rating-btn')?.addEventListener('click', () => showScreen('rating'));
    document.getElementById('pvp-btn')?.addEventListener('click', () => showScreen('pvp-players'));
    
    // Лечение инфекций
    document.getElementById('heal-infections-btn')?.addEventListener('click', healInfections);
    
    
    // PvP
    document.getElementById('pvp-refresh-btn')?.addEventListener('click', loadPVPGamePlayers);
    document.getElementById('pvp-stats-btn')?.addEventListener('click', () => showScreen('pvp-stats'));
    document.getElementById('pvp-attack-btn')?.addEventListener('click', attackPVPTarget);
    document.getElementById('pvp-claim-rewards-btn')?.addEventListener('click', claimPVPRewards);
    
    // Боссы
    document.getElementById('attack-boss-btn')?.addEventListener('click', attackBoss);
    
    // Кланы
    document.getElementById('create-clan-btn')?.addEventListener('click', createClan);
    document.getElementById('clans-search-btn')?.addEventListener('click', () => {
        const search = document.getElementById('clans-search-input')?.value;
        loadClansList(search);
    });
    document.getElementById('clans-search-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadClansList(e.target.value);
        }
    });
    document.getElementById('clan-send-btn')?.addEventListener('click', sendClanMessage);
    document.getElementById('clan-message-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendClanMessage();
    });
    
    // Инициализация - ждём загрузки всех модулей
    function startGame() {
        // Проверяем, что экранный слой загружен
        if (typeof showScreen !== 'function') {
            console.warn('Экранный слой не загружен, ожидаем...');
            setTimeout(startGame, 100);
            return;
        }
        
        initGame();
        initReferralHandlers();
        
        // Инициализация навигации из game-core.js
        if (typeof initNavigationHandlers === 'function') {
            initNavigationHandlers();
        }
    }
    
    // Запускаем игру после полной загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startGame);
    } else {
        startGame();
    }
});

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================================================

// Removed window exports for currentInventoryFilter, etc. to avoid sync issues
window.initInventoryControls = initInventoryControls;
window.currentAchievementCategory = currentAchievementCategory;
window.loadAchievements = loadAchievements;
window.renderAchievementsStats = renderAchievementsStats;
window.renderAchievementsCategories = renderAchievementsCategories;
window.filterAchievements = filterAchievements;
window.renderAchievementsList = renderAchievementsList;
window.claimAchievement = claimAchievement;
window.loadPVPGamePlayers = loadPVPGamePlayers;
window.startPVPFight = startPVPFight;
window.attackPVPTarget = attackPVPTarget;
window.updatePVPHealth = updatePVPHealth;
window.handlePVPBattleEnd = handlePVPBattleEnd;
window.claimPVPRewards = claimPVPRewards;
window.loadPVPStats = loadPVPStats;
window.loadReferralCode = loadReferralCode;
window.loadReferralStats = loadReferralStats;
window.loadReferralsList = loadReferralsList;
window.loadReferralScreen = loadReferralScreen;
window.copyReferralCode = copyReferralCode;
window.changeReferralCode = changeReferralCode;
window.useReferralCode = useReferralCode;
window.initReferralHandlers = initReferralHandlers;
/**
 * ============================================
 * МАГАЗИН (Store)
 * ============================================
 * Магазин с 3 категориями:
 * - Баффы (временные усиления)
 * - Мини-игры (колесо удачи)
 * - Косметика (эффекты, скины)
 */

// Данные товаров магазина
const SHOP_ITEMS = {
    // Баффы
    buffs: [
        { id: 'buff_loot_1h', name: 'x2 Добыча', desc: 'Удвоенный лут на 1 час', icon: '📦', price: 5, currency: 'stars', duration: 3600, effect: 'loot_x2' },
        { id: 'buff_energy_1h', name: 'Бесплатная энергия', desc: 'Энергия не тратится 1 час', icon: '⚡', price: 3, currency: 'stars', duration: 3600, effect: 'free_energy' },
        { id: 'buff_radiation_1h', name: 'Анти-rad', desc: 'Защита от радиации 1 час', icon: '☢️', price: 2, currency: 'stars', duration: 3600, effect: 'no_radiation' },
        { id: 'buff_exp_1h', name: 'x2 Опыт', desc: 'Удвоенный опыт 1 час', icon: '⬆️', price: 4, currency: 'stars', duration: 3600, effect: 'exp_x2' },
        { id: 'buff_loot_daily', name: 'x2 Добыча (24ч)', desc: 'Удвоенный лут на 24 часа', icon: '📦', price: 20, currency: 'stars', duration: 86400, effect: 'loot_x2' },
    ],
    
    // Мини-игры
    minigames: [
        { id: 'miniwheel', name: 'Колесо удачи', desc: 'Крути колесо бесплатно или за Stars', icon: '🎡', price: 0, currency: 'free', type: 'game', game: 'wheel' },
    ],
    
    // Косметика
    cosmetics: [
        { id: 'cosm_glow_gold', name: 'Золотое свечение', desc: 'Золотое свечение вокруг профиля', icon: '✨', price: 50, currency: 'stars', type: 'effect', effect: 'glow_gold' },
        { id: 'cosm_glow_blue', name: 'Синее свечение', desc: 'Синее свечение вокруг профиля', icon: '💠', price: 30, currency: 'stars', type: 'effect', effect: 'glow_blue' },
        { id: 'cosm_frame_elite', name: 'Элитная рамка', desc: 'Особая рамка профиля', icon: '🖼️', price: 100, currency: 'stars', type: 'frame', effect: 'frame_elite' },
        { id: 'cosm_title_veteran', name: 'Звание: Ветеран', desc: 'Звание под ником', icon: '🎖️', price: 25, currency: 'stars', type: 'title', effect: 'title_veteran' },
        { id: 'cosm_particles_fire', name: 'Огненные частицы', desc: 'Огненные частицы при действиях', icon: '🔥', price: 40, currency: 'stars', type: 'particles', effect: 'particles_fire' },
    ]
};

/**
 * Открытие магазина (рендерит категорию)
 * Примечание: showScreen уже вызывается до этой функции,
 * поэтому здесь НЕ вызываем showScreen('shop') во избежание бесконечного цикла
 */
function openShop() {
    renderShopCategory('buffs');
}

function formatMinutesRemaining(ms) {
    const totalMinutes = Math.max(1, Math.ceil(Number(ms || 0) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
        return `${hours}ч ${minutes}м`;
    }

    return `${minutes}м`;
}

/**
 * Отрисовка категории магазина
 * @param {string} category - категория (buffs/minigames/cosmetics)
 */
function renderShopCategory(category) {
    const itemsContainer = document.getElementById('shop-items');
    if (!itemsContainer) return;
    
    const items = SHOP_ITEMS[category] || [];
    
    // Обновляем активную кнопку
    document.querySelectorAll('.shop-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === category);
    });
    
    if (items.length === 0) {
        itemsContainer.innerHTML = '<div class="empty-message">Товаров пока нет</div>';
        return;
    }
    
    itemsContainer.innerHTML = items.map(item => {
        const priceText = item.currency === 'free' ? 'Бесплатно' : 
                          item.currency === 'stars' ? `⭐ ${item.price}` : 
                          `💰 ${item.price}`;
        const isOwnedCosmetic = category === 'cosmetics' && Array.isArray(gameState.player?.cosmetics) && gameState.player.cosmetics.includes(item.effect);
        const isActiveBuff = category === 'buffs' && hasBuff(item.effect);
        const isUnavailable = isOwnedCosmetic || isActiveBuff;
        const buttonLabel = item.type === 'game'
            ? 'Играть'
            : isOwnedCosmetic
                ? 'Куплено'
                : isActiveBuff
                    ? 'Активно'
                    : 'Купить';
        
        return `
            <div class="shop-item" data-item-id="${item.id}">
                <div class="shop-item-icon">${item.icon}</div>
                <div class="shop-item-info">
                    <div class="shop-item-name">${item.name}</div>
                    <div class="shop-item-desc">${item.desc}</div>
                </div>
                <div class="shop-item-price">${priceText}</div>
                <button class="shop-buy-btn" ${(item.price === 0 && item.currency !== 'free') || isUnavailable ? 'disabled' : ''}>
                    ${buttonLabel}
                </button>
            </div>
        `;
    }).join('');
    
    // Добавляем обработчики кнопок
    itemsContainer.querySelectorAll('.shop-item').forEach(itemEl => {
        const buyBtn = itemEl.querySelector('.shop-buy-btn');
        const itemId = itemEl.dataset.itemId;
        
        buyBtn.addEventListener('click', () => buyShopItem(itemId, category));
    });
}

/**
 * Покупка товара
 * @param {string} itemId - ID товара
 * @param {string} category - категория
 */
async function buyShopItem(itemId, category) {
    const item = SHOP_ITEMS[category]?.find(i => i.id === itemId);
    if (!item) return;
    
    // Если это мини-игра
    if (item.type === 'game') {
        if (item.game === 'wheel') {
            openWheel();
        }
        return;
    }
    
    // Проверка валюты
    const player = gameState.player;
    if (!player) return;
    
    if (item.currency === 'stars') {
        if (player.stars < item.price) {
            showModal('❌ Недостаточно Stars', 'Купите Stars в Telegram!');
            return;
        }
    } else if (item.currency === 'coins') {
        if (player.coins < item.price) {
            showModal('❌ Недостаточно монет', 'Нужно больше монет!');
            return;
        }
    }
    
    // Покупка
    try {
        const result = await apiRequest('/api/game/purchase', {
            method: 'POST',
            body: {
                item_id: itemId,
                currency: item.currency
            }
        });
        
        if (result.success) {
            // Применяем эффект баффа
            if (category === 'buffs') {
                applyBuff(item);
            }
            
            // Обновляем валюту из правильных полей ответа
            if (result.balance !== undefined) {
                player.balance = result.balance;
            }
            if (result.coins !== undefined) {
                player.coins = result.coins;
            }
            // Для совместимости со старым API
            if (result.new_stars !== undefined) {
                player.stars = result.new_stars;
            }
            if (result.new_coins !== undefined) {
                player.coins = result.new_coins;
            }
            
            showModal('✅ Успешно!', `Куплено: ${item.name}`);
            showConfetti();

            if (typeof loadProfile === 'function') {
                loadProfile().catch(error => console.error('Не удалось обновить профиль после покупки:', error));
            }
        }
    } catch (error) {
        showModal('❌ Ошибка', 'Не удалось совершить покупку');
    }
}

/**
 * Применение баффа
 * @param {Object} buff - данные баффа
 */
function applyBuff(buff) {
    gameState.buffs = gameState.buffs || {};
    const expiresAt = Date.now() + (buff.duration * 1000);
    gameState.buffs[buff.effect] = {
        expires: expiresAt,
        expires_at: new Date(expiresAt).toISOString()
    };
    
    showNotification(`⚡ ${buff.name} активирован!`, 'success');
    
    // Запускаем таймер окончания
    setTimeout(() => {
        delete gameState.buffs[buff.effect];
        showNotification(`⏰ ${buff.name} закончился`, 'info');
    }, buff.duration * 1000);
}


/**
 * Проверка баффа
 * @param {string} effect - эффект
 * @returns {boolean} активен ли бафф
 */
function hasBuff(effect) {
    if (!gameState.buffs?.[effect]) return false;

    const data = gameState.buffs[effect];
    const expiresAt = data?.expires || new Date(data?.expires_at || 0).getTime();
    if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
        delete gameState.buffs[effect];
        return false;
    }

    return true;
}

// ============================================
// КОЛЕСО УДАЧИ
// ============================================

const WHEEL_PRIZES = [
    { type: 'coins', value: 10, text: '10 монет' },
    { type: 'coins', value: 25, text: '25 монет' },
    { type: 'coins', value: 50, text: '50 монет' },
    { type: 'coins', value: 100, text: '100 монет' },
    { type: 'multiplier', value: 2, text: 'x2 к монетам' },
    { type: 'energy', value: 20, text: '20 энергии' },
];

/**
 * Открытие колеса удачи
 */
function openWheel() {
    showScreen('wheel');
    loadWheelInfo();
}

async function loadWheelInfo() {
    const freeBtn = document.getElementById('wheel-free-btn');
    const paidBtn = document.getElementById('wheel-paid-btn');
    const freeInfo = document.getElementById('wheel-free-info');
    const paidInfo = document.getElementById('wheel-paid-info');

    if (freeBtn) freeBtn.disabled = true;
    if (paidBtn) paidBtn.disabled = true;

    try {
        const response = await gameApi.get('/game/wheel');
        const payload = response?.data || response;
        const canSpinFree = Boolean(payload.can_spin_free);
        const nextFreeSpin = Number(payload.next_free_spin || 0);

        if (freeBtn) {
            freeBtn.disabled = !canSpinFree;
            freeBtn.textContent = canSpinFree
                ? '🎡 Бесплатно'
                : `⏳ ${formatMinutesRemaining(nextFreeSpin)}`;
        }

        if (paidBtn) {
            const stars = Number(gameState.player?.stars || 0);
            paidBtn.disabled = stars < 1;
            paidBtn.textContent = stars < 1 ? '⭐ Нужен 1 Star' : '⭐ За 1 Star';
        }

        if (freeInfo) {
            freeInfo.textContent = canSpinFree
                ? 'Бесплатное вращение доступно прямо сейчас.'
                : `Следующее бесплатное вращение через ${formatMinutesRemaining(nextFreeSpin)}.`;
        }

        if (paidInfo) {
            paidInfo.textContent = `Платное вращение доступно всегда. Stars: ${Number(gameState.player?.stars || 0)}.`;
        }
    } catch (error) {
        console.error('Ошибка загрузки информации о колесе:', error);
        if (freeBtn) freeBtn.disabled = false;
        if (paidBtn) paidBtn.disabled = false;
        if (freeInfo) freeInfo.textContent = 'Не удалось получить состояние колеса.';
    }
}

/**
 * Бесплатное вращение колеса
 */
async function spinWheelFree() {
    try {
        const response = await gameApi.post('/game/wheel/spin', { is_paid: false });
        
        if (!response.success) {
            if (response.code === 'COOLDOWN' && response.next_free_spin) {
                const minutes = Math.ceil(response.next_free_spin / 60000);
                showModal('⏳ Подождите', `Следующее бесплатное вращение через ${minutes} мин.`, 'info');
            } else {
                showModal('❌ Ошибка', response.error || 'Не удалось крутить колесо', 'error');
            }
            return;
        }
        
        // Анимация с призом от сервера
        spinWheelAnimation(response.data.prize, false);
        
    } catch (error) {
        console.error('Ошибка вращения колеса:', error);
        showModal('❌ Ошибка', 'Не удалось связаться с сервером', 'error');
    }
}

/**
 * Платное вращение колеса
 */
async function spinWheelPaid() {
    const player = gameState.player;
    if (!player || (player.stars || 0) < 1) {
        showModal('❌ Недостаточно Stars', 'Купите Stars в Telegram!');
        return;
    }
    
    try {
        const response = await gameApi.post('/game/wheel/spin', { is_paid: true });
        
        if (!response.success) {
            showModal('❌ Ошибка', response.error || 'Не удалось крутить колесо', 'error');
            return;
        }
        
        // Анимация с призом от сервера
        spinWheelAnimation(response.data.prize, true);
        
    } catch (error) {
        console.error('Ошибка вращения колеса:', error);
        showModal('❌ Ошибка', 'Не удалось связаться с сервером', 'error');
    }
}

/**
 * Анимация колеса
 * @param {object} prize - приз от сервера
 * @param {boolean} isPaid - платное вращение
 */
function spinWheelAnimation(prize, isPaid) {
    const wheel = document.getElementById('wheel');
    const freeBtn = document.getElementById('wheel-free-btn');
    const paidBtn = document.getElementById('wheel-paid-btn');
    if (!wheel) return;

    if (freeBtn) freeBtn.disabled = true;
    if (paidBtn) paidBtn.disabled = true;
    
    // Анимация
    const rotations = 5 + Math.random() * 5;
    const prizeIndex = WHEEL_PRIZES.findIndex(p => p.type === prize.type && p.value === prize.value);
    const finalAngle = rotations * 360 + (360 / WHEEL_PRIZES.length) * (prizeIndex >= 0 ? prizeIndex : 0);
    
    wheel.style.transition = 'transform 3s ease-out';
    wheel.style.transform = `rotate(${finalAngle}deg)`;
    
    setTimeout(() => {
        // Выдача приза
        if (prize.type === 'coins') {
            showModal('🎉 Выигрыш!', `Выпало: ${prize.text}`, 'success');
        } else if (prize.type === 'multiplier') {
            showModal('🎉 Удвоение!', `Множитель x${prize.value}!`, 'success');
        } else if (prize.type === 'energy') {
            showModal('⚡ Энергия!', `+${prize.value} энергии!`, 'success');
        }
        
        showConfetti(80);
        
        // Обновляем данные игрока после вращения
        if (typeof loadProfile === 'function') {
            loadProfile().catch(e => console.error('Failed to update player:', e));
        }
        loadWheelInfo().catch(e => console.error('Не удалось обновить состояние колеса:', e));
        
        // Сброс колеса
        setTimeout(() => {
            wheel.style.transition = 'none';
            wheel.style.transform = 'rotate(0deg)';
        }, 2000);
        
    }, 3000);
}

// Флаг инициализации обработчиков магазина
let shopHandlersInitialized = false;

/**
 * Инициализация обработчиков магазина
 * Защита от повторного добавления EventListener
 */
function initShopHandlers() {
    if (shopHandlersInitialized) {
        return; // Защита от повторной инициализации
    }
    shopHandlersInitialized = true;
    // Обработчики табов магазина
    document.querySelectorAll('.shop-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            renderShopCategory(btn.dataset.tab);
        });
    });
    
    // Кнопки колеса
    const wheelFreeBtn = document.getElementById('wheel-free-btn');
    if (wheelFreeBtn) {
        wheelFreeBtn.addEventListener('click', spinWheelFree);
    }
    
    const wheelPaidBtn = document.getElementById('wheel-paid-btn');
    if (wheelPaidBtn) {
        wheelPaidBtn.addEventListener('click', spinWheelPaid);
    }
}

// ============================================
// МАГАЗИН ЗА МОНЕТЫ
// ============================================

let coinShopItems = [];
let currentCoinShopCategory = 'all';

async function loadCoinShop() {
    try {
        const response = await gameApi.get('/game/items/shop');
        coinShopItems = response.items || [];
        
        // Обновляем баланс монет
        const balanceEl = document.getElementById('shop-coins-balance');
        if (balanceEl && gameState.player) {
            balanceEl.textContent = formatNumber(gameState.player.coins || 0);
        }
        
        renderCoinShop();
    } catch (error) {
        console.error('Ошибка загрузки магазина:', error);
        const container = document.getElementById('shop-items-list');
        if (container) {
            container.innerHTML = '<div class="error">Ошибка загрузки товаров</div>';
        }
    }
}

function renderCoinShop() {
    const container = document.getElementById('shop-items-list');
    if (!container) return;
    
    const getCategory = (item) => item.shop_category || item.type || item.category;
    const filtered = currentCoinShopCategory === 'all' 
        ? coinShopItems 
        : coinShopItems.filter(item => getCategory(item) === currentCoinShopCategory);
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-message">Нет товаров в этой категории</div>';
        return;
    }
    
    container.innerHTML = filtered.map(item => {
        const rarityClass = item.rarity || 'common';
        const prepTag = item.stats?.radiation_cure || item.stats?.infection_cure || item.stats?.radiation_resist || item.stats?.infection_resist
            ? '<div class="shop-item-role">Подготовка к опасной зоне</div>'
            : '';
        return `
            <div class="shop-item-card ${rarityClass}" data-item-id="${item.id}">
                <div class="shop-item-icon">${item.icon || '📦'}</div>
                <div class="shop-item-info">
                    <div class="shop-item-name">${escapeHtml(item.name)}</div>
                    <div class="shop-item-desc">${escapeHtml(item.description || '')}</div>
                    ${prepTag}
                    <div class="shop-item-stats">
                        ${renderItemStats(item.stats)}
                    </div>
                </div>
                <div class="shop-item-buy">
                    <div class="shop-item-price">💰 ${formatNumber(item.price || 0)}</div>
                    <button class="buy-btn" onclick="buyCoinItem(${item.id})">Купить</button>
                </div>
            </div>
        `;
    }).join('');
    
    // Обработчики категорий
    document.querySelectorAll('.shop-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.shop-category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCoinShopCategory = btn.dataset.category;
            renderCoinShop();
        });
    });
}

function renderItemStats(stats) {
    if (!stats) return '';
    const statLines = [];
    if (stats.damage) statLines.push(`⚔️ Урон: +${stats.damage}`);
    if (stats.defense) statLines.push(`🛡️ Защита: +${stats.defense}`);
    if (stats.health) statLines.push(`❤️ Здоровье: +${stats.health}`);
    if (stats.energy) statLines.push(`⚡ Энергия: +${stats.energy}`);
    if (stats.radiation_cure) statLines.push(`☢️ Лечение радиации: ${stats.radiation_cure}`);
    if (stats.infection_cure) statLines.push(`🦠 Лечение инфекции: ${stats.infection_cure}`);
    if (stats.radiation_resist) statLines.push(`🛡️ Защита от радиации: ${stats.radiation_resist}`);
    if (stats.infection_resist) statLines.push(`🧪 Защита от инфекции: ${stats.infection_resist}`);
    return statLines.join('<br>');
}

async function buyCoinItem(itemId) {
    const item = coinShopItems.find(i => i.id === itemId);
    if (!item) return;
    
    const price = item.price || 0;
    const playerCoins = gameState.player?.coins || 0;
    
    if (playerCoins < price) {
        showModal('❌ Недостаточно монет', `Нужно ${formatNumber(price)} монет, у вас ${formatNumber(playerCoins)}`);
        return;
    }
    
    if (!confirm(`Купить ${item.name} за ${formatNumber(price)} монет?`)) {
        return;
    }
    
    try {
        const response = await gameApi.post('/game/items/buy', { 
            item_id: itemId,
            currency: 'coins'
        });
        
        if (response.success) {
            showModal('✅ Успешно', `Вы купили ${item.name}!`);
            
            // Обновляем баланс
            if (gameState.player) {
                gameState.player.coins = Number(response.remaining_coins ?? ((gameState.player.coins || 0) - price));
                const balanceEl = document.getElementById('shop-coins-balance');
                if (balanceEl) {
                    balanceEl.textContent = formatNumber(gameState.player.coins);
                }
            }
            
            // Перезагружаем инвентарь
            if (typeof loadInventory === 'function') {
                loadInventory();
            }
            if (typeof loadProfile === 'function') {
                loadProfile().catch(error => console.error('Не удалось обновить профиль после покупки за монеты:', error));
            }
        } else {
            showModal('❌ Ошибка', response.error || 'Не удалось купить предмет');
        }
    } catch (error) {
        console.error('Ошибка покупки:', error);
        showModal('❌ Ошибка', 'Не удалось купить предмет');
    }
}

// Экспорт функции openShop в window для использования в других модулях
window.openShop = openShop;
window.loadCoinShop = loadCoinShop;
window.buyCoinItem = buyCoinItem;
/**
 * ============================================
 * ВИЗУАЛЬНЫЕ ЭФФЕКТЫ (Visual Effects)
 * ============================================
 * Объединяет:
 * - Система частиц (Particle System) - Canvas анимации
 * - Карта города (City Map) - Canvas отрисовка
 * 
 * Подключение: после game-core.js
 */



/**
 * Класс ParticleSystem - управление визуальными эффектами
 * Улучшенная версия с защитой от утечек памяти
 */
class ParticleSystem {
    constructor() {
        this.particles = [];
        this.canvas = null;
        this.ctx = null;
        this.animationId = null;
        this._resizeHandler = null;
        this._isDestroyed = false;
    }

    /**
     * Инициализация canvas для частиц
     */
    init() {
        if (this._isDestroyed) {
            console.warn('[ParticleSystem] Система уже уничтожена');
            return;
        }
        if (this.canvas) return;
        
        try {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'particle-canvas';
            this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
            document.body.appendChild(this.canvas);
            
            this.ctx = this.canvas.getContext('2d');
            this.resize();
            
            // Удаляем старый обработчик если есть
            if (this._resizeHandler) {
                window.removeEventListener('resize', this._resizeHandler);
            }
            // Сохраняем ссылку на обработчик
            this._resizeHandler = () => this.resize();
            window.addEventListener('resize', this._resizeHandler);
        } catch (e) {
            console.error('[ParticleSystem] Ошибка инициализации:', e);
        }
    }

    /**
     * Очистка всех ресурсов (предотвращение утечек памяти)
     */
    destroy() {
        this._isDestroyed = true;
        
        // Останавливаем анимацию
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Удаляем обработчик resize
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        
        // Очищаем canvas
        if (this.canvas) {
            try {
                this.ctx = null;
                this.canvas.remove();
                this.canvas = null;
            } catch (e) {
                console.warn('[ParticleSystem] Ошибка удаления canvas:', e);
            }
        }
        
        // Очищаем массив частиц
        this.particles = [];
    }

    /**
     * Изменение размера canvas при ресайзе окна
     */
    resize() {
        if (this._isDestroyed || !this.canvas) return;
        
        try {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        } catch (e) {
            console.warn('[ParticleSystem] Ошибка изменения размера:', e);
        }
    }

    /**
     * Создание эффекта конфetti
     * @param {number} count - количество частиц
     * @param {string[]} colors - цвета конфetti
     */
    confetti(count = 100, colors = ['#ff0', '#f0f', '#0ff', '#0f0', '#fa0']) {
        this.init();
        
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
                vx: (Math.random() - 0.5) * 20,
                vy: (Math.random() - 1) * 15 - 5,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: Math.random() * 8 + 4,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 10,
                life: 1,
                decay: 0.01 + Math.random() * 0.02,
                type: 'confetti'
            });
        }
        
        this.animate();
    }

    /**
     * Создание эффекта искр
     * @param {number} x - координата X
     * @param {number} y - координата Y
     * @param {number} count - количество искр
     */
    sparks(x, y, count = 20) {
        this.init();
        
        const colors = ['#ff0', '#fa0', '#f00', '#fff'];
        
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const speed = 3 + Math.random() * 5;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: Math.random() * 4 + 2,
                life: 1,
                decay: 0.03 + Math.random() * 0.02,
                type: 'spark'
            });
        }
        
        if (!this.animationId) {
            this.animate();
        }
    }

    /**
     * Основной цикл анимации частиц
     */
    animate() {
        if (!this.ctx) return;
        
        // Очистка canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Обновление и отрисовка каждой частицы
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            
            // Обновление позиции
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.3; // Гравитация
            
            if (p.type === 'confetti') {
                p.rotation += p.rotationSpeed;
                p.vx *= 0.99;
            }
            
            // Затухание
            p.life -= p.decay;
            
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            
            // Отрисовка
            this.ctx.globalAlpha = p.life;
            this.ctx.fillStyle = p.color;
            
            if (p.type === 'confetti') {
                this.ctx.save();
                this.ctx.translate(p.x, p.y);
                this.ctx.rotate(p.rotation * Math.PI / 180);
                this.ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                this.ctx.restore();
            } else {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
        
        this.ctx.globalAlpha = 1;
        
        if (this.particles.length > 0) {
            this.animationId = requestAnimationFrame(() => this.animate());
        } else {
            this.animationId = null;
        }
    }
}

// Глобальный экземпляр
const particles = new ParticleSystem();

/**
 * Запуск эффекта конфetti (для побед и особых событий)
 * @param {number} count - количество частиц
 */
function showConfetti(count = 150) {
    particles.confetti(count);
}

/**
 * Запуск эффекта искр (для ударов и действий)
 * @param {number} x - координата X
 * @param {number} y - координата Y
 * @param {number} count - количество искр
 */
function showSparks(x, y, count = 15) {
    particles.sparks(x, y, count);
}




/**
 * Отрисовка локаций на Canvas карте
 */
function renderLocations() {
    const canvas = document.getElementById('city-map');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Очищаем canvas
    ctx.clearRect(0, 0, width, height);
    
    // Рисуем фон карты (постапокалиптический город)
    drawCityBackground(ctx, width, height);
    
    // Определяем позиции локаций на карте
    const locations = gameState.locations || [];
    const positions = calculateLocationPositions(locations.length, width, height);
    
    // Сохраняем позиции для кликов
    gameState.locationPositions = {};
    
    // Рисуем дороги между локациями
    drawRoads(ctx, positions);
    
    // Рисуем локации
    locations.forEach((loc, index) => {
        const pos = positions[index];
        gameState.locationPositions[loc.id] = { x: pos.x, y: pos.y, radius: 30 };
        drawLocation(ctx, loc, pos);
    });
    
    // Обработчик клика по карте
    canvas.onclick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        // Проверяем клик по локациям
        for (const loc of locations) {
            const pos = gameState.locationPositions[loc.id];
            if (!pos || pos.radius === undefined) continue;
            
            const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
            
            if (dist < pos.radius) {
                if (loc.unlocked) {
                    moveToLocation(loc.id);
                } else {
                    showModal('🔒 Заблокировано', `Нужен уровень ${loc.min_level} для входа`);
                }
                return;
            }
        }
    };
    
    // Обработчик движения мыши (подсветка)
    canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        let hoveredLoc = null;
        for (const loc of locations) {
            const pos = gameState.locationPositions[loc.id];
            if (!pos || pos.radius === undefined) continue;
            
            const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
            if (dist < pos.radius) {
                hoveredLoc = loc;
                break;
            }
        }
        
        // Обновляем информацию о локации
        const infoEl = document.querySelector('.map-location-name');
        if (infoEl && hoveredLoc) {
            infoEl.textContent = `${hoveredLoc.icon} ${hoveredLoc.name}`;
            const infoContainer = document.querySelector('.map-info');
            if (infoContainer && !infoContainer.querySelector('.map-location-info')) {
                const info = document.createElement('div');
                info.className = 'map-location-info';
                const fakePlayer = {
                    location: hoveredLoc,
                    equipment: gameState.player?.equipment || {}
                };
                const risk = typeof getCurrentZoneRiskProfile === 'function'
                    ? getCurrentZoneRiskProfile(fakePlayer)
                    : { label: 'Неизвестно' };
                info.textContent = `☢️ Радиация: ${hoveredLoc.radiation} | 🦠 Инфекция: ${hoveredLoc.infection || 0} | ${hoveredLoc.unlocked ? '✅' : '🔒'} ${risk.label}`;
                infoContainer.appendChild(info);
            }
        }
        
        // Перерисовываем с подсветкой
        redrawMap(hoveredLoc);
    };
    
    canvas.onmouseleave = () => {
        const infoContainer = document.querySelector('.map-info');
        const info = infoContainer?.querySelector('.map-location-info');
        if (info) info.remove();
        const infoEl = document.querySelector('.map-location-name');
        if (infoEl) infoEl.textContent = 'Выберите локацию';
        redrawMap(null);
    };
}

/**
 * Перерисовка карты с подсветкой
 * @param {Object} hoveredLoc - локация под курсором
 */
function redrawMap(hoveredLoc) {
    const canvas = document.getElementById('city-map');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    drawCityBackground(ctx, width, height);
    
    const locations = gameState.locations || [];
    const positions = calculateLocationPositions(locations.length, width, height);
    drawRoads(ctx, positions);
    
    locations.forEach((loc, index) => {
        const pos = positions[index];
        const isHovered = hoveredLoc && hoveredLoc.id === loc.id;
        drawLocation(ctx, loc, pos, isHovered);
    });
}

/**
 * Расчёт позиций локаций на карте
 * @param {number} count - количество локаций
 * @param {number} width - ширина canvas
 * @param {number} height - высота canvas
 * @returns {Array} массив позиций
 */
function calculateLocationPositions(count, width, height) {
    const positions = [];
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Располагаем локации от центра к краям по кругу
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const radius = 40 + (i * 35);
        positions.push({
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius
        });
    }
    
    return positions;
}

/**
 * Рисуем фон карты (постапокалиптический город)
 * @param {CanvasRenderingContext2D} ctx - контекст canvas
 * @param {number} width - ширина
 * @param {number} height - высота
 */
function drawCityBackground(ctx, width, height) {
    // Инициализируем статичные позиции при первом вызове
    if (!window.cityBackgroundStars) {
        window.cityBackgroundStars = [];
        for (let i = 0; i < 50; i++) {
            window.cityBackgroundStars.push({
                x: Math.random() * width,
                y: Math.random() * height * 0.4,
                size: Math.random() * 1.5
            });
        }
    }
    if (!window.cityBackgroundBuildings) {
        window.cityBackgroundBuildings = [];
        for (let i = 0; i < 15; i++) {
            window.cityBackgroundBuildings.push({
                x: Math.random() * width,
                w: 20 + Math.random() * 40,
                h: 50 + Math.random() * 150
            });
        }
    }

    // Градиент неба
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, '#1a1a2e');
    skyGrad.addColorStop(0.5, '#16213e');
    skyGrad.addColorStop(1, '#0f0f23');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // Звёзды
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    window.cityBackgroundStars.forEach(star => {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
    });

    // Контуры зданий (силуэты)
    ctx.fillStyle = '#0a0a15';
    window.cityBackgroundBuildings.forEach(building => {
        ctx.fillRect(building.x, height - building.h, building.w, building.h);
    });
    
    // Земля
    const groundGrad = ctx.createLinearGradient(0, height - 80, 0, height);
    groundGrad.addColorStop(0, '#1a1a1a');
    groundGrad.addColorStop(1, '#0d0d0d');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, height - 80, width, 80);
    
    // Радиационное свечение от центра
    const centerX = width / 2;
    const centerY = height / 2;
    const radGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 200);
    radGrad.addColorStop(0, 'rgba(0, 255, 0, 0.05)');
    radGrad.addColorStop(1, 'rgba(0, 255, 0, 0)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, width, height);
}

/**
 * Рисуем дороги между локациями
 * @param {CanvasRenderingContext2D} ctx - контекст canvas
 * @param {Array} positions - позиции локаций
 */
function drawRoads(ctx, positions) {
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 10]);
    
    for (let i = 0; i < positions.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(positions[i].x, positions[i].y);
        ctx.lineTo(positions[i + 1].x, positions[i + 1].y);
        ctx.stroke();
    }
    
    // Дорога от низа экрана к первой локации
    if (positions.length > 0) {
        ctx.beginPath();
        ctx.moveTo(ctx.canvas.width / 2, ctx.canvas.height - 30);
        ctx.lineTo(positions[0].x, positions[0].y);
        ctx.stroke();
    }
    
    ctx.setLineDash([]);
}

/**
 * Рисуем локацию на карте
 * @param {CanvasRenderingContext2D} ctx - контекст canvas
 * @param {Object} loc - данные локации
 * @param {Object} pos - позиция на карте
 * @param {boolean} isHovered - подсветка при наведении
 */
function drawLocation(ctx, loc, pos, isHovered = false) {
    const radius = isHovered ? 35 : 30;
    
    // Радиационное свечение
    const radGrad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius + 15);
    const glowColor = loc.unlocked ? 'rgba(74, 144, 217, 0.4)' : 'rgba(100, 100, 100, 0.3)';
    radGrad.addColorStop(0, glowColor);
    radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radGrad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius + 15, 0, Math.PI * 2);
    ctx.fill();
    
    // Основной круг
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    
    if (loc.unlocked) {
        const grad = ctx.createRadialGradient(pos.x - 10, pos.y - 10, 0, pos.x, pos.y, radius);
        grad.addColorStop(0, '#4a90d9');
        grad.addColorStop(1, '#2a5f9e');
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = '#444';
    }
    ctx.fill();
    
    // Рамка
    ctx.strokeStyle = loc.unlocked ? '#6ab0ff' : '#666';
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.stroke();
    
    // Иконка
    ctx.font = isHovered ? '24px serif' : '20px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(loc.icon, pos.x, pos.y);
}




// Функции частиц
window.showConfetti = showConfetti;
window.showSparks = showSparks;
window.particles = particles;

// Функции карты
window.renderLocations = renderLocations;
window.redrawMap = redrawMap;
window.calculateLocationPositions = calculateLocationPositions;
window.drawCityBackground = drawCityBackground;
window.drawRoads = drawRoads;
window.drawLocation = drawLocation;
/**
 * ============================================
 * АНИМАЦИИ (Animations)
 * ============================================
 * Управление CSS анимациями и визуальными эффектами
 */



/**
 * Показать модальное окно
 * @param {string} title - заголовок
 * @param {string} message - сообщение
 * @param {string} type - тип (success, error, info)
 */
function showModal(title, message, type = 'info') {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalClose = document.getElementById('modal-close');
    
    if (!modal || !modalTitle || !modalMessage || !modalClose) return;
    
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    
    // Устанавливаем класс типа
    modal.className = 'modal';
    if (type === 'success') modal.classList.add('modal-success');
    else if (type === 'error') modal.classList.add('modal-error');
    else modal.classList.add('modal-info');
    
    // Показываем модальное окно с анимацией
    modal.style.display = 'flex';
    modal.style.animation = 'fadeIn 0.3s ease-out';
    
    // Обработчик закрытия (сначала удаляем старый)
    modalClose.onclick = null;
    modalClose.onclick = () => hideModal();
    
    // Закрытие по клику вне окна (сначала удаляем старый)
    modal.onclick = null;
    modal.onclick = (e) => {
        if (e.target === modal) hideModal();
    };
}

/**
 * Скрыть модальное окно
 */
function hideModal() {
    const modal = document.getElementById('modal');
    const modalClose = document.getElementById('modal-close');
    
    // Очищаем обработчики при закрытии
    if (modalClose) modalClose.onclick = null;
    if (modal) {
        modal.onclick = null;
        modal.style.animation = 'fadeOut 0.2s ease-out';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    }
}

/**
 * Показать уведомление (toast)
 * @param {string} message - текст уведомления
 * @param {string} type - тип (success, error, info, warning)
 * @param {number} duration - длительность в мс
 */
function showNotification(message, type = 'info', duration = 3000) {
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        padding: 12px 20px;
        border-radius: 8px;
        background: ${type === 'success' ? '#4a9' : type === 'error' ? '#a44' : '#48a'};
        color: white;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    
    container.appendChild(notification);
    
    // Удаляем после duration
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, duration);
}

/**
 * Визуальный эффект при получении лута
 * @param {Object} item - данные предмета
 */
function showLootAnimation(item) {
    const app = document.getElementById('app') || document.body;

    const lootEl = document.createElement('div');
    lootEl.className = 'loot-animation';
    lootEl.innerHTML = `
        <div class="loot-icon">${item.icon || '📦'}</div>
        <div class="loot-name">${item.name || 'Предмет'}</div>
    `;

    app.appendChild(lootEl);
    lootEl.style.animation = 'slideUp 1s ease-out forwards';

    setTimeout(() => {
        lootEl.remove();
    }, 1000);
}

/**
 * Визуальный эффект при получении урона
 */
function showDamageEffect() {
    const app = document.getElementById('app');
    if (!app) return;

    app.style.animation = 'damageFlash 0.3s';
    setTimeout(() => {
        app.style.animation = '';
    }, 300);
}

/**
 * Звуковые эффекты (упрощённо через вибрацию)
 */
function playSound(type) {
    if (!navigator.vibrate) return;

    switch (type) {
        case 'loot':
            navigator.vibrate(50);
            break;
        case 'attack':
            navigator.vibrate([50, 30, 50]);
            break;
        case 'use':
            navigator.vibrate(30);
            break;
        case 'modal':
            navigator.vibrate(20);
            break;
        case 'success':
        case 'victory':
            navigator.vibrate(100);
            break;
    }
}

/**
 * Обновление отображения баланса игрока
 */
function updateBalanceDisplay(newCoins) {
    if (newCoins && typeof newCoins === 'object') {
        const coins = Number(newCoins.coins ?? 0);
        const stars = Number(newCoins.stars ?? 0);

        updateBalanceDisplay(coins);

        const starsElements = document.querySelectorAll('#inv-stars, #main-stars-value, .stars-display');
        starsElements.forEach(el => {
            if (el) el.textContent = formatNumber(stars);
        });

        if (gameState?.player) {
            gameState.player.coins = coins;
            gameState.player.stars = stars;
        }

        return;
    }

    const balanceElements = document.querySelectorAll('.balance-value, #user-balance, .coins-display');
    balanceElements.forEach(el => {
        if (el) el.textContent = formatNumber(newCoins);
    });
    if (gameState?.player) gameState.player.coins = newCoins;
}



// =============================================================================
// АНИМАЦИИ БОССОВ
// =============================================================================

/**
 * Анимация частиц при убийстве босса
 * @param {string} bossName - имя босса (для позиционирования)
 */
function showBossDeathParticles(bossName = null) {
    // Получаем элемент босса или центра экрана
    const bossIcon = document.getElementById('boss-icon');
    let centerX = window.innerWidth / 2;
    let centerY = window.innerHeight / 2;
    
    if (bossIcon) {
        const rect = bossIcon.getBoundingClientRect();
        centerX = rect.left + rect.width / 2;
        centerY = rect.top + rect.height / 2;
    }
    
    // Цвета для частиц (золото, огонь, розовый)
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#FF8C00', '#FF69B4'];
    const particleCount = 30;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'boss-particle';
        
        const size = Math.random() * 12 + 4;
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        particle.style.cssText = `
            position: fixed;
            left: ${centerX}px;
            top: ${centerY}px;
            width: ${size}px;
            height: ${size}px;
            background: ${color};
            border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
            pointer-events: none;
            z-index: 1000;
            box-shadow: 0 0 ${size}px ${color};
        `;
        
        document.body.appendChild(particle);
        
        // Расчёт направления и скорости
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 250 + 100;
        const dx = Math.cos(angle) * velocity;
        const dy = Math.sin(angle) * velocity - 100; // небольшой подъём
        
        // Анимация
        const animation = particle.animate([
            { 
                transform: 'translate(-50%, -50%) scale(1)', 
                opacity: 1 
            },
            { 
                transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`, 
                opacity: 0 
            }
        ], {
            duration: 1000 + Math.random() * 500,
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        });
        
        animation.onfinish = () => particle.remove();
    }
}


/**
 * Анимация вспышки экрана при победе
 */
function showVictoryFlash() {
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 70%);
        pointer-events: none;
        z-index: 999;
        animation: victoryFlash 1s ease-out forwards;
    `;
    
    document.body.appendChild(flash);
    
    // Добавляем CSS анимацию если нет
    if (!document.getElementById('victory-flash-style')) {
        const style = document.createElement('style');
        style.id = 'victory-flash-style';
        style.textContent = `
            @keyframes victoryFlash {
                0% { opacity: 1; transform: scale(0.5); }
                50% { opacity: 1; transform: scale(1.5); }
                100% { opacity: 0; transform: scale(2); }
            }
        `;
        document.head.appendChild(style);
    }
    
    setTimeout(() => flash.remove(), 1000);
}

/**
 * Анимация получения ключа
 * @param {number} bossId - ID следующего босса
 */
function showKeyAnimation(bossId) {
    const key = document.createElement('div');
    key.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        font-size: 48px;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 1001;
        animation: keyPop 1.5s ease-out forwards;
    `;
    key.textContent = '🔑';
    
    document.body.appendChild(key);
    
    // Добавляем CSS анимацию если нет
    if (!document.getElementById('key-anim-style')) {
        const style = document.createElement('style');
        style.id = 'key-anim-style';
        style.textContent = `
            @keyframes keyPop {
                0% { transform: translate(-50%, -50%) scale(0) rotate(-180deg); opacity: 0; }
                30% { transform: translate(-50%, -50%) scale(1.2) rotate(0deg); opacity: 1; }
                50% { transform: translate(-50%, -50%) scale(1) rotate(10deg); }
                70% { transform: translate(-50%, -50%) scale(1) rotate(-10deg); }
                100% { transform: translate(-50%, -100%) scale(0.5) rotate(0deg); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    setTimeout(() => key.remove(), 1500);
}

function showRewardCelebration({ icon = '🏆', title = 'Награда!', subtitle = '', lines = [], tone = 'gold' } = {}) {
    const overlay = document.createElement('div');
    overlay.className = `reward-celebration-overlay tone-${tone}`;

    const card = document.createElement('div');
    card.className = 'reward-celebration-card';

    const iconEl = document.createElement('div');
    iconEl.className = 'reward-celebration-icon';
    iconEl.textContent = icon;

    const titleEl = document.createElement('h3');
    titleEl.className = 'reward-celebration-title';
    titleEl.textContent = title;

    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'reward-celebration-subtitle';
    subtitleEl.textContent = subtitle;

    const list = document.createElement('div');
    list.className = 'reward-celebration-lines';

    lines.filter(Boolean).forEach((line) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'reward-celebration-line';
        lineEl.textContent = line;
        list.appendChild(lineEl);
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'reward-celebration-close';
    closeBtn.textContent = 'Забрать';
    closeBtn.onclick = () => overlay.remove();

    card.appendChild(iconEl);
    card.appendChild(titleEl);
    if (subtitle) card.appendChild(subtitleEl);
    if (list.childElementCount > 0) card.appendChild(list);
    card.appendChild(closeBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    setTimeout(() => {
        if (overlay.isConnected) {
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.remove(), 300);
        }
    }, 4500);
}

function showBossVictorySummary(bossName, rewards = {}, mastery = null) {
    const lines = [];

    if (rewards.coins) lines.push(`💰 Монеты: +${rewards.coins}`);
    if (rewards.experience) lines.push(`✨ Опыт: +${rewards.experience}`);
    if (rewards.key?.boss_name) lines.push(`🔑 Новый ключ: ${rewards.key.boss_name}`);
    if (Array.isArray(rewards.items)) {
        rewards.items.forEach((item) => {
            lines.push(`${item.icon || '📦'} ${item.name} ×${item.quantity || 1}`);
        });
    }
    if (mastery !== null && mastery !== undefined) {
        lines.push(`⭐ Мастерство босса: ${mastery}`);
    }

    showRewardCelebration({
        icon: '👑',
        title: 'Босс повержён!',
        subtitle: `Победа над ${bossName}`,
        lines,
        tone: 'gold'
    });
}

function showKeyRewardCelebration(keyName) {
    showRewardCelebration({
        icon: '🔑',
        title: 'Ключ найден!',
        subtitle: 'Ты сделал шаг к следующему боссу.',
        lines: [keyName],
        tone: 'key'
    });
}

function showLocationUnlockCelebration(locationName) {
    showRewardCelebration({
        icon: '🗺️',
        title: 'Открыта новая зона!',
        subtitle: 'Теперь можно идти дальше.',
        lines: [locationName],
        tone: 'unlock'
    });
}

// Экспорт функций для глобального доступа
window.showBossDeathParticles = showBossDeathParticles;
window.showVictoryFlash = showVictoryFlash;
window.showKeyAnimation = showKeyAnimation;
window.showRewardCelebration = showRewardCelebration;
window.showBossVictorySummary = showBossVictorySummary;
window.showKeyRewardCelebration = showKeyRewardCelebration;
window.showLocationUnlockCelebration = showLocationUnlockCelebration;
window.showLootAnimation = showLootAnimation;
window.showDamageEffect = showDamageEffect;
window.playSound = playSound;
window.updateBalanceDisplay = updateBalanceDisplay;
