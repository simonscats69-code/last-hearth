/**
 * ============================================
 * API ЗАПРОСЫ (API Requests)
 * ============================================
 * Управление запросами к серверу
 * Оптимизировано с использованием Proxy и словаря эндпоинтов
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

/**
 * Выполнение запроса к API
 * @param {string} endpoint - endpoint API
 * @param {Object} options - дополнительные опции
 * @returns {Promise<Object>} ответ сервера
 */
async function apiRequest(endpoint, options = {}) {
    const normalizedEndpoint = API_BASE.endsWith('/api') && endpoint.startsWith('/api/')
        ? endpoint.slice(4)
        : endpoint;
    const url = `${API_BASE}${normalizedEndpoint}`;
    
    // Получаем telegram_id из Telegram WebApp
    const telegramId = getTelegramId();
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'x-telegram-id': telegramId || ''
        }
    };
    
    const config = { ...defaultOptions, ...options };

    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }
    
    try {
        // Добавляем timeout для предотвращения зависания
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            ...config,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Обработка ошибок от сервера
        if (data.error) {
            console.error('API Error:', data.error);
            throw new Error(data.message || 'Unknown error');
        }
        
        return data;
    } catch (error) {
        console.error('API Request failed:', error);
        console.error('URL:', url);
        console.error('Config:', config);
        
        // Показываем ошибку пользователю
        if (options.showError !== false) {
            let errorMessage = 'Ошибка соединения';
            if (error.name === 'AbortError') {
                errorMessage = 'Время ожидания истекло. Попробуйте ещё раз.';
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                errorMessage = 'Не удаётся подключиться к серверу. Проверьте интернет и попробуйте позже.';
            } else if (error.message.includes('HTTP error')) {
                errorMessage = 'Сервер вернул ошибку: ' + error.message;
            } else {
                errorMessage = 'Ошибка: ' + error.message;
            }
            showNotification(errorMessage, 'error');
        }
        
        throw error;
    }
}

/**
 * GET запрос
 * @param {string} endpoint - endpoint
 * @returns {Promise<Object>} данные
 */
async function apiGet(endpoint) {
    return apiRequest(endpoint, { method: 'GET' });
}

/**
 * POST запрос с JSON телом
 * @param {string} endpoint - endpoint
 * @param {Object} body - данные
 * @returns {Promise<Object>} данные
 */
async function apiPost(endpoint, body = {}) {
    return apiRequest(endpoint, {
        method: 'POST',
        body: body
    });
}

// ============================================
// КЭШ ДАННЫХ (опционально, для часто используемых данных)
// ============================================
const apiCache = new Map();
const CACHE_TTL = 30000; // 30 секунд кэширование

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
}

// ============================================
// ПРОКСИ ДЛЯ ДИНАМИЧЕСКОЙ ГЕНЕРАЦИИ МЕТОДОВ
// ============================================

/**
 * Создаёт API метод на основе словаря эндпоинтов
 * @param {string} name - имя эндпоинта
 * @returns {Function} функция API
 */
function createApiMethod(name) {
    const config = endpoints[name];
    if (!config) {
        return () => { throw new Error(`Unknown endpoint: ${name}`); };
    }
    
    if (config.method === 'GET') {
        return async function(body = {}, options = {}) {
            // Проверяем кэш для GET запросов без параметров
            const cacheKey = name;
            if (Object.keys(body).length === 0) {
                const cached = getCached(cacheKey);
                if (cached) return cached;
                const data = await apiGet(config.endpoint);
                setCached(cacheKey, data);
                return data;
            }
            return apiGet(config.endpoint);
        };
    } else {
        return async function(body = {}, options = {}) {
            // Инвалидируем кэш после POST запросов
            invalidateCache(name);
            return apiPost(config.endpoint, body);
        };
    }
}

/**
 * Динамический API через Proxy
 * Позволяет вызывать методы как gameApi.profile() или gameApi.purchase({...})
 */
const gameApi = new Proxy({}, {
    get(target, name) {
        // Проверяем статические методы
        if (name === 'get') return apiGet;
        if (name === 'post') return apiPost;
        if (name === 'endpoints') return endpoints;
        if (name === 'cache') return { get: getCached, set: setCached, invalidate: invalidateCache };
        
        // Создаём метод на лету
        return createApiMethod(name);
    }
});

// ============================================
// АЛИАСЫ (для обратной совместимости)
// ============================================

// Регистрация и профиль
const registerPlayer = (telegramId, username) => gameApi.register({ telegram_id: telegramId, username });
const loadProfile = () => gameApi.profile();
const loadInventory = () => gameApi.inventory();

// Исследование и перемещение
const searchLoot = () => gameApi.search();
const moveToLocation = (locationId) => gameApi.move({ location_id: locationId });

// Предметы
const useItem = (itemIndex) => gameApi.useItem({ item_index: itemIndex });
const craftItem = (recipeId) => gameApi.craft({ recipe_id: recipeId });
const loadRecipes = () => gameApi.recipes();

// Боссы
const attackBoss = (bossId, isRaid = false) => gameApi.attackBoss({ boss_id: bossId, is_raid: isRaid });
const loadBosses = () => gameApi.bosses();

// Статус и магазин
const checkPlayerStatus = () => gameApi.statusCheck({});
const buyItem = (itemId, currency = 'coins') => gameApi.purchase({ item_id: parseInt(itemId), currency });
const loadAchievements = () => gameApi.achievements();

// Рейтинги
const loadRatings = (type = 'players') => {
    const endpoint = type === 'clans' ? endpoints.ratingsClans.endpoint : endpoints.ratingsPlayers.endpoint;
    return apiGet(endpoint);
};

// Рынок
const loadMarket = () => gameApi.marketList();
const listOnMarket = (itemIndex, price) => gameApi.marketCreate({ item_index: itemIndex, price });
const buyFromMarket = (listingId) => gameApi.marketBuy({ listing_id: listingId });

// Клан
const loadClan = () => gameApi.clan();
const createClan = (name) => gameApi.clanCreate({ name });
const joinClan = (clanId) => gameApi.clanJoin({ clan_id: clanId });
const leaveClan = () => gameApi.clanLeave({});

// PvP
const pvpAttack = (targetId) => gameApi.pvpAttack({ target_id: targetId });

// Сезоны
const loadSeasonData = () => gameApi.seasonsCurrent();

// Рефералы
const checkReferralBonus = () => gameApi.referralCode();
const activateReferralCode = (code) => gameApi.referralUse({ code });

// Клановые боссы
const loadClanBoss = () => gameApi.clanBoss();
const spawnClanBoss = () => gameApi.clanBossSpawn({});
const attackClanBoss = (damage) => gameApi.clanBossAttack({ damage });

// Экспорт
window.gameApi = gameApi;
