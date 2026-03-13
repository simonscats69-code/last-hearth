/**
 * ============================================
 * API ЗАПРОСЫ (API Requests)
 * ============================================
 * Управление запросами к серверу
 * Оптимизировано со словарём эндпоинтов
 */

// Базовый URL API (используем HTTPS для работы с BotHost)
const API_BASE = 'https://last-hearth.bothost.ru/api';

// ============================================
// СЛОВАРЬ ЭНДПОИНТОВ
// ============================================
const endpoints = {
    // Регистрация и профиль
    register: { endpoint: '/game/register', method: 'POST' },
    profile: { endpoint: '/game/profile', method: 'GET' },
    inventory: { endpoint: '/game/inventory', method: 'GET' },
    
    // Исследование и перемещение
    search: { endpoint: '/game/search', method: 'POST' },
    move: { endpoint: '/game/move', method: 'POST' },
    
    // Предметы
    useItem: { endpoint: '/game/use-item', method: 'POST' },
    craft: { endpoint: '/game/craft', method: 'POST' },
    recipes: { endpoint: '/game/craft/recipes', method: 'GET' },
    
    // Боссы
    attackBoss: { endpoint: '/game/attack-boss', method: 'POST' },
    bosses: { endpoint: '/game/bosses', method: 'GET' },
    
    // Статус и магазин
    statusCheck: { endpoint: '/game/status/check', method: 'POST' },
    purchase: { endpoint: '/game/purchase', method: 'POST' },
    achievements: { endpoint: '/game/achievements', method: 'GET' },
    
    // Рейтинги
    ratingsPlayers: { endpoint: '/rating/players', method: 'GET' },
    ratingsClans: { endpoint: '/rating/clans', method: 'GET' },
    
    // Рынок
    marketList: { endpoint: '/game/market/listings-v2', method: 'GET' },
    marketCreate: { endpoint: '/game/market/create', method: 'POST' },
    marketBuy: { endpoint: '/game/market/buy', method: 'POST' },
    
    // Клан
    clan: { endpoint: '/game/clan', method: 'GET' },
    clanCreate: { endpoint: '/game/clan/create', method: 'POST' },
    clanJoin: { endpoint: '/game/clan/join', method: 'POST' },
    clanLeave: { endpoint: '/game/clan/leave', method: 'POST' },
    
    // PvP
    pvpAttack: { endpoint: '/game/pvp/attack', method: 'POST' },
    
    // Сезоны
    seasonsCurrent: { endpoint: '/game/seasons/current', method: 'GET' },
    
    // Рефералы
    referralCode: { endpoint: '/game/referral/code', method: 'GET' },
    referralUse: { endpoint: '/game/referral/use', method: 'POST' },
    
    // Клановые боссы
    clanBoss: { endpoint: '/game/clan-boss', method: 'GET' },
    clanBossSpawn: { endpoint: '/game/clan-boss/spawn', method: 'POST' },
    clanBossAttack: { endpoint: '/game/clan-boss/attack', method: 'POST' }
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
    'craft': ['inventory', 'profile'],
    'clanJoin': ['clan', 'profile'],
    'clanLeave': ['clan', 'profile'],
    'marketBuy': ['inventory', 'profile', 'marketList'],
    'marketCreate': ['marketList']
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
    
    let loadingTimeout = createLoadingTimeout(options.showLoading);
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            if (loadingTimeout) clearTimeout(loadingTimeout);
            loadingTimeout = createLoadingTimeout(options.showLoading);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            
            const response = await fetch(url, { ...config, signal: controller.signal });
            clearTimeout(timeoutId);
            clearTimeout(loadingTimeout);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.error === true) {
                console.error('API Error:', data.message);
                throw new Error(data.message || 'Unknown error');
            }
            
            return data;
        } catch (error) {
            const isLastAttempt = attempt === retries;
            clearTimeout(loadingTimeout);
            
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
