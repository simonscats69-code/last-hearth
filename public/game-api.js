/**
 * ============================================
 * API ЗАПРОСЫ (API Requests)
 * ============================================
 * Управление запросами к серверу
 */

// Базовый URL API
const API_BASE = '/api';

/**
 * Выполнение запроса к API
 * @param {string} endpoint - endpoint API
 * @param {Object} options - дополнительные опции
 * @returns {Promise<Object>} ответ сервера
 */
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    const config = { ...defaultOptions, ...options };
    
    try {
        const response = await fetch(url, config);
        
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
        
        // Показываем ошибку пользователю
        if (options.showError !== false) {
            showNotification('Ошибка соединения: ' + error.message, 'error');
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
        body: JSON.stringify(body)
    });
}

// ============================================
// ИГРОВЫЕ API МЕТОДЫ
// ============================================

/**
 * Регистрация игрока
 * @param {number} telegramId - ID Telegram
 * @param {string} username - username
 * @returns {Promise<Object>} данные игрока
 */
async function registerPlayer(telegramId, username) {
    return apiPost('/game/register', { telegram_id: telegramId, username });
}

/**
 * Получение профиля игрока
 * @returns {Promise<Object>} профиль
 */
async function loadProfile() {
    return apiGet('/game/profile');
}

/**
 * Получение инвентаря
 * @returns {Promise<Object>} инвентарь
 */
async function loadInventory() {
    return apiGet('/game/inventory');
}

/**
 * Поиск лута в текущей локации
 * @returns {Promise<Object>} результат поиска
 */
async function searchLoot() {
    return apiPost('/game/search');
}

/**
 * Переход к локации
 * @param {number} locationId - ID локации
 * @returns {Promise<Object>} результат
 */
async function moveToLocation(locationId) {
    return apiPost('/game/move', { location_id: locationId });
}

/**
 * Использование предмета
 * @param {number} itemId - ID предмета
 * @returns {Promise<Object>} результат
 */
async function useItem(itemId) {
    return apiPost('/game/item/use', { item_id: itemId });
}

/**
 * Крафт предмета
 * @param {number} recipeId - ID рецепта
 * @returns {Promise<Object>} результат
 */
async function craftItem(recipeId) {
    return apiPost('/game/craft', { recipe_id: recipeId });
}

/**
 * Получение списка рецептов
 * @returns {Promise<Object>} рецепты
 */
async function loadRecipes() {
    return apiGet('/game/craft/recipes');
}

/**
 * Нападение на босса
 * @param {number} bossId - ID босса
 * @returns {Promise<Object>} результат
 */
async function attackBoss(bossId) {
    return apiPost('/game/boss/attack', { boss_id: bossId });
}

/**
 * Получение списка боссов
 * @returns {Promise<Object>} боссы
 */
async function loadBosses() {
    return apiGet('/game/bosses');
}

/**
 * Проверка статуса игрока
 * @returns {Promise<Object>} статус
 */
async function checkPlayerStatus() {
    return apiPost('/game/status/check', {});
}

/**
 * Покупка в магазине
 * @param {number} itemId - ID предмета
 * @param {string} currency - валюта (coins/stars)
 * @returns {Promise<Object>} результат
 */
async function buyItem(itemId, currency = 'coins') {
    return apiPost('/game/shop/buy', { item_id: itemId, currency });
}

/**
 * Загрузка заданий
 * @returns {Promise<Object>} задания
 */
async function loadQuests() {
    return apiGet('/game/quests');
}

/**
 * Выполнение задания
 * @param {number} questId - ID задания
 * @returns {Promise<Object>} результат
 */
async function completeQuest(questId) {
    return apiPost('/game/quests/complete', { quest_id: questId });
}

/**
 * Загрузка достижений
 * @returns {Promise<Object>} достижения
 */
async function loadAchievements() {
    return apiGet('/game/achievements');
}

/**
 * Получение рейтинга
 * @param {string} type - тип (players/clans)
 * @returns {Promise<Object>} рейтинг
 */
async function loadRatings(type = 'players') {
    return apiGet(`/game/ratings/${type}`);
}

/**
 * Загрузка рынка
 * @returns {Promise<Object>} объявления
 */
async function loadMarket() {
    return apiGet('/game/market');
}

/**
 * Размещение на рынке
 * @param {number} itemId - ID предмета
 * @param {number} price - цена
 * @returns {Promise<Object>} результат
 */
async function listOnMarket(itemId, price) {
    return apiPost('/game/market/list', { item_id: itemId, price });
}

/**
 * Покупка с рынка
 * @param {number} listingId - ID объявления
 * @returns {Promise<Object>} результат
 */
async function buyFromMarket(listingId) {
    return apiPost('/game/market/buy', { listing_id: listingId });
}

/**
 * Загрузка клана
 * @returns {Promise<Object>} данные клана
 */
async function loadClan() {
    return apiGet('/game/clan');
}

/**
 * Создание клана
 * @param {string} name - название
 * @returns {Promise<Object>} результат
 */
async function createClan(name) {
    return apiPost('/game/clan/create', { name });
}

/**
 * Вступление в клан
 * @param {number} clanId - ID клана
 * @returns {Promise<Object>} результат
 */
async function joinClan(clanId) {
    return apiPost('/game/clan/join', { clan_id: clanId });
}

/**
 * Выход из клана
 * @returns {Promise<Object>} результат
 */
async function leaveClan() {
    return apiPost('/game/clan/leave', {});
}

/**
 * PvP атака на игрока
 * @param {number} targetId - ID цели
 * @returns {Promise<Object>} результат
 */
async function pvpAttack(targetId) {
    return apiPost('/game/pvp/attack', { target_id: targetId });
}

/**
 * Загрузка сезонных данных
 * @returns {Promise<Object>} сезонные данные
 */
async function loadSeasonData() {
    return apiGet('/game/season');
}

/**
 * Получение награды за рекламу
 * @returns {Promise<Object>} награда
 */
async function claimAdReward() {
    return apiPost('/game/ads/reward', {});
}

/**
 * Проверка реферального бонуса
 * @returns {Promise<Object>} данные
 */
async function checkReferralBonus() {
    return apiGet('/game/referral/check');
}

/**
 * Активация реферального бонуса
 * @param {string} code - реферальный код
 * @returns {Promise<Object>} результат
 */
async function activateReferralCode(code) {
    return apiPost('/game/referral/activate', { code });
}

// ==================== КЛАНОВЫЕ БОССЫ ====================

/**
 * Получить текущего босса клана
 * @returns {Promise<Object>} данные босса
 */
async function loadClanBoss() {
    return apiGet('/game/clan-boss');
}

/**
 * Вызвать босса (только лидер клана)
 * @returns {Promise<Object>} результат
 */
async function spawnClanBoss() {
    return apiPost('/game/clan-boss/spawn', {});
}

/**
 * Атаковать босса
 * @param {number} damage - урон
 * @returns {Promise<Object>} результат
 */
async function attackClanBoss(damage) {
    return apiPost('/game/clan-boss/attack', { damage });
}

/**
 * Получить историю боссов
 * @returns {Promise<Object>} история
 */
async function loadClanBossHistory() {
    return apiGet('/game/clan-boss/history');
}
