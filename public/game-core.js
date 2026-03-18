/**
 * game-core.js - Ядро игры
 * Основные константы, утилиты и система управления состоянием
 * 
 * Подключение: после game-state.js, game-utils.js, game-api.js
 * Зависимости: gameState, getTelegramId, showNotification, apiRequest
 */

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
}

// Очищаем интервалы при закрытии страницы
window.addEventListener('beforeunload', clearAllIntervals);
window.addEventListener('pagehide', clearAllIntervals);

// ============================================================================
// БЛОКИРОВКИ ОПЕРАЦИЙ (защита от состояний гонки)
// ============================================================================

const actionLocks = {
    crafting: false,
    marketBuy: false,
    marketCreate: false,
    marketCancel: false,
    marketRenew: false,
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
        return `
            <div class="item-card rarity-${item.rarity || 'common'}" 
                 data-id="${item.id}" onclick="useItem(${item.id})">
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
        return `
            <div class="inventory-slot rarity-${item.rarity || 'common'}" 
                 onclick="useItem(${item.id})" data-id="${item.id}">
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
        bosses: '/game/bosses',
        recipes: '/api/game/crafting/recipes',
        clan: '/api/game/clans/clan',
        market: '/api/game/market/listings',
        pvp: '/api/game/pvp/players',
        achievements: '/api/game/achievements/progress',
        status: '/api/game/status',
        energy: '/api/game/energy'
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
    
    // Универсальная загрузка
    async load(type, id = null) {
        const endpoint = this.endpoints[type];
        if (!endpoint) {
            throw new Error(`Неизвестный тип: ${type}`);
        }
        
        let url = endpoint;
        if (id) url += `/${id}`;
        
        const data = await this.get(url);
        
        // Автоматическое обновление gameState
        if (type === 'profile' && typeof gameState !== 'undefined') {
            gameState.player = data;
        }
        if (type === 'inventory' && typeof gameState !== 'undefined') {
            gameState.inventory = data.items || data;
        }
        if (type === 'locations' && typeof gameState !== 'undefined') {
            gameState.locations = data.locations || data;
        }
        if (type === 'bosses' && typeof gameState !== 'undefined') {
            gameState.bosses = data.bosses || data;
        }
        
        return data;
    }
};

// ============================================================================
// DataLoader - очередь загрузки данных
// ============================================================================

const DataLoader = {
    queue: [],
    loading: false,
    
    // Добавить в очередь
    async add(type, callback, message = null) {
        this.queue.push({ type, callback, message });
        if (!this.loading) await this.process();
    },
    
    // Обработать очередь
    async process() {
        this.loading = true;
        while (this.queue.length > 0) {
            const { type, callback, message } = this.queue.shift();
            const msg = message || `Загрузка ${type}...`;
            await Loader.wrap(async () => {
                try {
                    const data = await API.load(type);
                    if (callback) callback(data);
                    return data;
                } catch (e) {
                    console.error(`Ошибка загрузки ${type}:`, e);
                    showNotification?.(`Ошибка загрузки ${type}`, 'error');
                }
            }, msg);
        }
        this.loading = false;
    },
    
    // Загрузить всё сразу
    async loadAll(loaders) {
        await Loader.wrap(async () => {
            const promises = loaders.map(({ type, callback }) => 
                API.load(type).then(data => ({ type, data, callback }))
            );
            const results = await Promise.all(promises);
            results.forEach(({ type, data, callback }) => {
                if (callback) callback(data);
            });
        }, 'Загрузка данных...');
    }
};

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


// performAction - универсальный обработчик действий
// ============================================================================

/**
 * Универсальное выполнение действия с подтверждением и обработкой
 * @param {string} type - тип действия (craft, market/buy, pvp/attack и т.д.)
 * @param {Object} data - данные для отправки
 * @param {Object} options - опции
 */
async function performAction(type, data, options = {}) {
    const {
        confirmMsg = null,
        confirmPrice = 0,
        successMsg = '✅ Успешно',
        errorMsg = '❌ Ошибка',
        onSuccess = null,
        lockKey = null
    } = options;
    
    // Блокировка
    const lockName = lockKey || type.replace(/[\/]/g, '');
    if (!lockAction(lockName)) return;
    
    // Подтверждение
    if (confirmMsg || confirmPrice > 0) {
        const confirmed = await confirmAction(
            confirmMsg || 'Подтвердите действие',
            confirmPrice,
            CONSTANTS.CONFIRM_THRESHOLD
        );
        if (!confirmed) {
            unlockAction(lockName);
            return;
        }
    }
    
    try {
        const result = await apiRequest(`/api/game/${type}`, { method: 'POST', body: data });
        
        if (result.success) {
            showNotification?.(result.message || successMsg, 'success');
            if (typeof playSound === 'function') playSound('success');
            if (onSuccess) await onSuccess(result);
            // Инвалидировать кэш
            if (typeof RenderCache !== 'undefined') RenderCache.clear();
        } else {
            showNotification?.(result.message || errorMsg, 'error');
        }
        
        return result;
    } catch (error) {
        console.error(`${type} error:`, error);
        showNotification?.('Произошла ошибка', 'error');
    } finally {
        unlockAction(lockName);
    }
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
 * Унифицированный рендер списка
 */
function renderList(container, items, renderItem, emptyHtml = '<div class="empty-message">Пусто</div>') {
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = emptyHtml;
        return;
    }
    container.innerHTML = items.map(renderItem).join('');
}

/**
 * Рассчитать статус доступной постройки
 */
function getBuildingStatus(building) {
    if (!building.requirements?.has_required_building) {
        return {
            statusClass: 'locked',
            statusText: `Требуется: ${building.requirements?.required_building}`,
            buttonDisabled: 'disabled'
        };
    }

    if ((gameState?.player?.level || 1) < building.required_level) {
        return {
            statusClass: 'locked',
            statusText: `Требуется уровень: ${building.required_level}`,
            buttonDisabled: 'disabled'
        };
    }

    if (building.current_level >= building.max_level) {
        return {
            statusClass: 'maxed',
            statusText: 'Макс. уровень',
            buttonDisabled: 'disabled'
        };
    }

    if (building.is_built) {
        return {
            statusClass: 'upgradable',
            statusText: `Уровень ${building.current_level}/${building.max_level}`,
            buttonDisabled: ''
        };
    }

    return {
        statusClass: 'available',
        statusText: 'Доступно',
        buttonDisabled: ''
    };
}

/**
 * Шаблон карточки доступной постройки
 */
function renderAvailableBuildingCard(building, includeResources = true) {
    const { statusClass, statusText, buttonDisabled } = getBuildingStatus(building);

    return `
        <div class="available-building-item ${statusClass}" style="border-left: 4px solid ${building.color}">
            <div class="building-header">
                <span class="building-icon">${building.icon}</span>
                <span class="building-name">${building.name}</span>
                ${building.current_level > 0 ? `<span class="building-level">Ур. ${building.current_level}</span>` : ''}
            </div>
            <div class="building-desc">${building.description || ''}</div>
            <div class="building-cost">
                <span class="cost-coins">💰 ${building.upgrade_cost?.coins || 0}</span>
                ${includeResources && building.upgrade_cost?.resources
                    ? Object.entries(building.upgrade_cost.resources).map(([k, v]) => 
                        `<span class="cost-resource">${k}: ${v}</span>`
                    ).join('')
                    : ''}
            </div>
            <div class="building-status">${statusText}</div>
            <button class="build-btn" onclick="buildBuilding('${building.code}')" ${buttonDisabled}>
                ${building.is_built ? 'Улучшить' : 'Построить'}
            </button>
        </div>
    `;
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

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================================================

window.safeSetInterval = safeSetInterval;
window.clearAllIntervals = clearAllIntervals;
window.lockAction = lockAction;
window.unlockAction = unlockAction;
window.render = render;
window.performAction = performAction;
window.getEl = getEl;
window.setHtml = setHtml;
window.renderList = renderList;
window.getBuildingStatus = getBuildingStatus;
window.renderAvailableBuildingCard = renderAvailableBuildingCard;
window.confirmAction = confirmAction;
window.CONSTANTS = CONSTANTS;
window.Loader = Loader;
window.Templates = Templates;
window.API = API;
window.DataLoader = DataLoader;
window.RenderCache = RenderCache;
window.Adsgram = Adsgram;

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
        formatted: formatTime(msUntilNext)
    };
}

/**
 * Форматировать время в чч:мм:сс
 * @param {number} ms - время в миллисекундах
 * @returns {string} форматированное время
 */
function formatTime(ms) {
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
window.formatTime = formatTime;
window.updateEnergyTimer = updateEnergyTimer;
window.getDamagePreview = getDamagePreview;
window.updateDamagePreviewUI = updateDamagePreviewUI;
