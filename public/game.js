/**
 * Утилиты и хелперы для фронтенда
 * Общие функции, используемые во всей игре
 */



/**
 * Разрешён ли dev-фоллбэк авторизации.
 *
 * ВАЖНО: значение приходит с сервера (index.html, инлайн-скрипт с nonce).
 * В production там всегда `false`, поэтому поддельные telegram_id/initData
 * физически недоступны: без настоящего Telegram.WebApp.initData игра не
 * стартует, а не продолжает работать от имени фиктивного игрока 123456789.
 */
const DEV_FALLBACK_ENABLED = window.__DEV_MODE__ === true;

/**
 * Состояние анимации закрытия модального окна.
 *
 * Объявлено здесь, а не рядом с hideModal(): файл выполняется сверху вниз,
 * а startGame() (и, значит, openModalElement) вызывается раньше конца файла —
 * при объявлении ниже была бы обращение к переменной в TDZ.
 */
const modalState = {
    openGeneration: 0,
    closeTimer: null
};

/**
 * Получить ID текущего пользователя Telegram
 * @returns {string|null} null, если подтвердить пользователя не удалось
 */
function getTelegramId() {
    const tg = window.Telegram?.WebApp;

    // Основной источник: SDK Telegram
    if (tg) {
        const id = tg.initDataUnsafe?.user?.id;
        // Используем != null для проверки на null/undefined (включая 0)
        if (id != null) return String(id);
    }

    // SDK недоступен — пробуем подписанные данные из fragment прямой ссылки
    const initData = getInitDataFromHash();
    if (initData) {
        try {
            const user = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
            if (user?.id != null) return String(user.id);
        } catch (e) {
            // повреждённый fragment — падаем в fallback ниже
        }
    }

    // Production: подтвердить пользователя не удалось — возвращаем null.
    // Раньше здесь был жёсткий '123456789': приложение продолжало работать
    // без валидного initData, то есть фактически без авторизации.
    if (DEV_FALLBACK_ENABLED) {
        // Fallback для разработки — только при явном DEV-флаге с сервера
        return localStorage.getItem('telegram_id') || '123456789';
    }

    return null;
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
 * Экранирование значения для подстановки внутрь HTML-атрибута.
 *
 * escapeHtml() экранирует только текстовый узел: кавычки в нём остаются
 * как есть. В атрибуте вида data-x="${value}" значение `x" onmouseover=...`
 * сломало бы разметку и выполнило произвольный код, поэтому для атрибутов
 * нужен отдельный, более строгий вариант.
 *
 * @param {*} value - значение атрибута
 * @returns {string}
 */
function escapeAttribute(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Форматирование числа с разделением разрядов
 * @param {number} num - Число
 * @returns {string}
 */
function formatNumber(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        return '0';
    }
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


/**
 * Получить категорию предмета
 * @param {number|string} itemId - ID предмета
 * @returns {string}
 */
/**
 * Категория предмета для фильтров инвентаря.
 *
 * Раньше здесь была жёсткая привязка к диапазонам ID (1-5 еда, 6-10 медицина,
 * 11-16 оружие...). Это ловушка: при добавлении предмета с id=30 он молча
 * попадал в 'unknown' и исчезал из инвентаря. Сервер от такого подхода
 * давно отказался (getInventoryItemCategory в utils/game-helpers.js) —
 * здесь должна быть ровно та же логика: читаем поле, а не угадываем по id.
 * @param {number|string} itemId - id предмета (не используется, оставлен
 *   для совместимости с window.getItemCategory)
 * @returns {string} категория в нижнем регистре
 */
function getItemCategory(itemId) {
    // Категория всегда приходит с сервера (items.category, а createInventoryItem
    // дополнительно подставляет type). Если её нет — честно отдаём misc,
    // а не выдумываем по диапазону id.
    if (itemId && typeof itemId === 'object') {
        return String(itemId.category || itemId.type || 'misc').toLowerCase();
    }
    return 'misc';
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
// getInitData иниализируется вместе с Telegram WebApp (см. initGame)
window.isColorDark = isColorDark;
window.hapticImpact = hapticImpact;
window.hapticNotification = hapticNotification;
window.hapticSelection = hapticSelection;
window.escapeHtml = escapeHtml;
window.escapeAttribute = escapeAttribute;
window.formatNumber = formatNumber;
window.formatPercent = formatPercent;
// showModal/hideModal/showScreen определены ниже, в секции анимаций боссов
// и управлении экранами соответственно.
window.getItemCategory = getItemCategory;
window.getRarityColor = getRarityColor;
window.getClanRoleEmoji = getClanRoleEmoji;
window.getRarityClassByLevel = getRarityClassByLevel;
window.getPlayerEmoji = getPlayerEmoji;
window.formatTime = formatTime;
/**
 * ============================================
 * ОБРАБОТЧИКИ ОШИБОК
 * ============================================
 */

// Глобальный обработчик для unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    // Предотвращаем default logging, если нужно
    // event.preventDefault();
});

/**
 * ============================================
 * API ЗАПРОСЫ (API Requests)
 * ============================================
 * Управление запросами к серверу
 * Оптимизировано со словарём эндпоинтов
 */

// Базовый URL API: явная конфигурация окна либо same-origin /api
const API_BASE = window.__API_BASE__ || `${window.location.origin}/api`;

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
    useItem: { endpoint: '/game/items/use', method: 'POST' },
    
    // Боссы
    attackBoss: { endpoint: '/game/bosses/attack-boss', method: 'POST' },
    bosses: { endpoint: '/game/bosses', method: 'GET' },
    
    // Колесо удачи
    // wheelInfo удалён: loadWheelInfo() ходит напрямую через
    // gameApi.get('/game/wheel'), сгенерированный метод никто не вызывал.
    wheelSpin: { endpoint: '/game/wheel/spin', method: 'POST' },
    
    // Статус и магазин
    statusCheck: { endpoint: '/game/status/check', method: 'POST' },
    purchase: { endpoint: '/game/purchase', method: 'POST' },
    achievements: { endpoint: '/achievements/progress', method: 'GET' },
    
    // Рейтинги
    // ratingsPlayers/ratingsClans удалены: loadRating(type) собирает путь
    // динамически — apiRequest(`/rating/${type}`), из словаря они не брались.
    
    // Клан
    clan: { endpoint: '/game/clans/clan', method: 'GET' },
    clanCreate: { endpoint: '/game/clans/clan/create', method: 'POST' },
    clanJoin: { endpoint: '/game/clans/clan/join', method: 'POST' },
    clanLeave: { endpoint: '/game/clans/clan/leave', method: 'POST' },
    
    // PvP
    pvpAttack: { endpoint: '/game/pvp/attack', method: 'POST' },
    
    // Рефералы
    // referralCode удалён: loadReferralCode() ходит напрямую на
    // /api/game/player/referral/code, а путь в словаре был устаревшим
    // (/game/player/referrals — такого маршрута на сервере нет).
    referralUse: { endpoint: '/game/player/referral/use', method: 'POST' },

    // Рейдовые боссы
    clanBoss: { endpoint: '/game/bosses/raids', method: 'GET' },
    clanBossSpawn: { endpoint: '/game/bosses/raid/start', method: 'POST' }
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
    'clanBossSpawn': ['clanBoss', 'profile']
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

/**
 * Полный сброс API-кэша после любой успешной мутации.
 *
 * Зачем: cacheInvalidationMap срабатывает только для вызовов вида
 * gameApi.post('purchase'), а почти все изменяющие запросы в игре уходят
 * напрямую через apiRequest('/api/game/...') и его мимо. Профиль,
 * инвентарь, достижения и боссы оставались в кэше на 30 секунд, и
 * интерфейс показывал состояние до последнего действия.
 *
 * Сброс консервативный (все ключи): цена — один лишний GET, зато
 * «устаревший профиль после покупки/атаки» исключён полностью.
 */
function invalidateAllCaches() {
    apiCache.clear();
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
 * Извлечь initData из fragment прямой ссылки Mini App (#tgWebAppData=...).
 * Нужен, когда SDK Telegram (window.Telegram) недоступен: например, страница
 * открыта по прямой ссылке и telegram-web-app.js не загрузился (сеть/блокировка).
 * Формат совпадает с логикой официального SDK: значение параметра закодировано
 * целиком и раскодируется один раз.
 * @returns {string|null}
 */
function getInitDataFromHash() {
    if (typeof location === 'undefined' || !location.hash) return null;

    const raw = location.hash.replace(/^#/, '');
    const marker = 'tgWebAppData=';
    const start = raw.indexOf(marker);
    if (start === -1) return null;

    let value = raw.slice(start + marker.length);
    // Отрезаем следующие параметры fragment (tgWebAppVersion, tgWebAppThemeParams, ...)
    const cut = value.search(/&tgWebApp[A-Za-z]+=/);
    if (cut !== -1) value = value.slice(0, cut);
    if (!value) return null;

    let decoded = value;
    // Целиком закодированное значение не содержит сырого '&hash=' — раскодируем
    if (!value.includes('&hash=')) {
        try {
            decoded = decodeURIComponent(value);
        } catch (e) {
            decoded = value; // не удалось раскодировать — используем как есть
        }
    }

    // Признак подписанных данных — наличие hash
    return decoded.includes('hash=') ? decoded : null;
}

/**
 * Получить initData для авторизации
 * ВАЖНО: Никогда не использовать localStorage - initData имеет срок жизни (auth_date)
 * и становится invalid через некоторое время
 * @returns {string|null} null, если подписанных данных нет
 */
function getInitData() {
    // 1. Основной источник: SDK Telegram (инжектится клиентом или telegram-web-app.js)
    const fromTelegram = window.Telegram?.WebApp?.initData || null;
    if (fromTelegram) return fromTelegram;

    // 2. Фоллбэк: fragment прямой ссылки (если SDK не загрузился)
    const fromHash = getInitDataFromHash();
    if (fromHash) {
        console.log('[getInitData] initData взят из fragment ссылки');
        return fromHash;
    }

    // 3. Заглушка для разработки — только при явном DEV-флаге с сервера.
    // В production её нет: поддельный initData с hash=dummy раньше позволял
    // пройти инициализацию без Telegram вообще.
    if (DEV_FALLBACK_ENABLED) {
        console.warn('[getInitData] initData отсутствует, используется DEV-заглушка');
        return 'user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22username%22%3A%22testuser%22%7D&chat_instance=123&auth_date=1234567890&hash=dummy';
    }

    console.warn('[getInitData] Telegram WebApp initData отсутствует');
    return null;
}

/**
 * Выполнение запроса к API с таймаутом и повторами
 *
 * БЕЗОПАСНОСТЬ МУТАЦИЙ: POST/PUT/PATCH/DELETE НЕ повторяются автоматически.
 * Сервер мог выполнить действие (списать валюту, нанести урон, выдать награду),
 * а ответ не дошёл из-за таймаута — повтор списал бы дважды. Повтор разрешён
 * только для идемпотентных GET, либо когда вызывающая сторона явно подтверждает
 * идемпотентность через options.idempotent (или headers['Idempotency-Key']).
 *
 * @param {string} endpoint - endpoint API
 * @param {Object} options - дополнительные опции (signal, silent, idempotent, showLoading)
 * @param {number} retries - количество повторов после первой попытки (только для идемпотентных)
 * @param {Object} params - query-параметры (для GET)
 * @returns {Promise<Object>} ответ сервера
 */
async function apiRequest(endpoint, options = {}, retries = 2, params = {}) {
    const normalizedEndpoint = endpoint.startsWith('/api')
        ? endpoint.replace(/^\/api/, '') || '/'
        : endpoint;

    // silent — не показывать toast при ошибке (для ожидаемых состояний,
    // например «игрок не в клане»). Вытаскиваем из options, чтобы не утекло в fetch.
    // signal — внешний AbortController (API.cancelRequest), чтобы отмена
    // действительно разрывала fetch, а не жила в отдельном Map.
    const { silent = false, signal: externalSignal, idempotent = false, ...fetchOptions } = options;

    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const hasIdempotencyKey = Boolean(fetchOptions.headers?.['Idempotency-Key']);
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    // Повторять мутацию можно только если сервер гарантирует идемпотентность
    const canRetry = !isMutation || idempotent || hasIdempotencyKey;
    const maxAttempts = canRetry ? retries : 0;

    const queryString = Object.keys(params).length > 0
        ? '?' + new URLSearchParams(params).toString()
        : '';
    const url = `${API_BASE}${normalizedEndpoint.startsWith('/') ? '' : '/'}${normalizedEndpoint}${queryString}`;

    // Получаем initData для авторизации
    const initData = getInitData();

    if (!initData && !DEV_FALLBACK_ENABLED) {
        // Без подписанных initData сервер всё равно отдаст 401. Лучше fail-fast:
        // не тратим 8 секунд таймаута и не показываем «Сервер не отвечает».
        const authError = new Error('Нет данных авторизации Telegram');
        authError.code = 'NO_INIT_DATA';
        throw authError;
    }

    const config = {
        headers: {
            'Content-Type': 'application/json',
            'x-init-data': initData || ''  // Используем x-init-data для безопасной авторизации
        },
        ...fetchOptions
    };

    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        let timeoutId = null;
        let loadingTimeout = null;

        try {
            loadingTimeout = createLoadingTimeout(fetchOptions.showLoading);

            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), 8000);

            // Внешняя отмена (API.cancelRequest) тоже должна разрывать fetch.
            // Раньше контроллер создавался здесь и никогда не доходил до
            // настоящего запроса, поэтому cancelRequest() ни на что не влиял.
            let removeExternalAbort = null;
            if (externalSignal) {
                if (externalSignal.aborted) {
                    clearTimeout(timeoutId);
                    throw new DOMException('Запрос отменён', 'AbortError');
                }
                const onExternalAbort = () => controller.abort();
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
                removeExternalAbort = () => externalSignal.removeEventListener('abort', onExternalAbort);
            }

            let response;
            try {
                response = await fetch(url, { ...config, signal: controller.signal });
            } finally {
                clearTimeout(timeoutId);
                timeoutId = null;
                if (removeExternalAbort) removeExternalAbort();
            }
            if (loadingTimeout) clearTimeout(loadingTimeout);

            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json')
                ? await response.json()
                : null;

            if (!response.ok) {
                const serverMessage = data?.error || data?.message || `HTTP error! status: ${response.status}`;
                const httpError = new Error(serverMessage);
                httpError.status = response.status;
                httpError.code = data?.code || null;
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

            // Успешная мутация изменила состояние на сервере — сбрасываем
            // кэш, иначе следующий gameApi.profile()/bosses() отдаст
            // данные, актуальные до этого действия
            if (isMutation) {
                invalidateAllCaches();
            }

            return data;
        } catch (error) {
            const isLastAttempt = attempt === maxAttempts;
            const isExternalAbort = Boolean(externalSignal?.aborted);

            // Всегда очищаем таймауты при ошибке
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (loadingTimeout) clearTimeout(loadingTimeout);

            if (error.name === 'AbortError') {
                // Отмена по инициативе вызывающей стороны — не ошибка и не повод
                // показывать тост: это штатное поведение API.cancelRequest.
                // Оборачиваем в обычный Error с явными флагами: полагаться на
                // присвоение свойств DOMException нельзя.
                if (isExternalAbort) {
                    const cancelError = new Error('Запрос отменён');
                    cancelError.name = 'AbortError';
                    cancelError.isManualAbort = true;
                    cancelError.isTimeoutAbort = false;
                    throw cancelError;
                }
                if (isLastAttempt) {
                    const timeoutError = new Error('Таймаут запроса');
                    timeoutError.name = 'AbortError';
                    timeoutError.isManualAbort = false;
                    timeoutError.isTimeoutAbort = true;
                    showNotification('Сервер не отвечает. Попробуй позже.', 'error');
                    throw timeoutError;
                }
                await delay(attempt);
                continue;
            }

            // 4xx — детерминированная ошибка клиента: повтор ничего не изменит.
            // Раньше здесь уходили 3 одинаковых запроса (например, 400 «не в клане»).
            // Исключения: 408 (таймаут запроса) и 429 (лимит) — их есть смысл повторить.
            // 4xx — детерминированная ошибка клиента: повтор ничего не изменит.
            // Повтор при 429 исключён: сервер только что сказал «слишком быстро»,
            // а клиент шлёт тот же запрос ещё два раза с нарастающей паузой,
            // разгоняя лавину. Раньше именно это превращало одну ошибку лимита
            // в серию из трёх запросов на каждый чих.
            const status = Number(error.status || 0);
            if (status >= 400 && status < 500 && status !== 408) {
                if (!silent) {
                    console.warn(`[apiRequest] ${status} ${normalizedEndpoint}: ${error.message}`);
                }
                if (status === 429 && !silent) {
                    showNotification('Слишком много запросов — подожди секунду и повтори.', 'warning');
                }
                throw error;
            }

            if (isLastAttempt) {
                if (!silent) {
                    console.error('API Request failed:', error);
                }
                // Проверяем код ошибки для более понятного сообщения
                if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                    showNotification('Ошибка авторизации. Обновите игру через Telegram.', 'error');
                } else if (error.message.includes('502')) {
                    showNotification('Сервер перегружен. Попробуй через несколько минут.', 'error');
                } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                    showNotification('Пропал интернет. Проверь соединение.', 'error');
                } else if (!silent) {
                    const message = error.message || 'Неизвестная ошибка';
                    showNotification('Ошибка: ' + message, 'error');
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
// API ЗАПРОСЫ - используются всеми игровыми системами этого файла
// ============================================================================
/**
 * Ядро игры
 * Основные константы, утилиты и система управления состоянием
 *
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

/**
 * Лимит слотов инвентаря. Берётся из public/shared/equipment.js — того же
 * файла, что использует routes/game/world.js. Раньше значение 100 было
 * продублировано в двух местах, и правка одного ломала второе.
 *
 * Optional chaining + значение по умолчанию: раньше здесь стояло
 * window.EquipmentShared.MAX_INVENTORY_SLOTS, и если shared/equipment.js
 * не успел загрузиться (или отдался 404), выполнение файла падало с
 * TypeError на этой строке — то есть НЕ выполнялся весь последующий код.
 * Значение 100 совпадает с константой в shared/equipment.js и routes/game/items.js.
 */
const INVENTORY_MAX_SLOTS = window.EquipmentShared?.MAX_INVENTORY_SLOTS ?? 100;

/** Подписи редкости для интерфейса (в CSS цвета заданы переменными --rarity-*) */
const RARITY_LABELS = {
    common: 'Обычное',
    uncommon: 'Необычное',
    rare: 'Редкое',
    epic: 'Эпическое',
    legendary: 'Легендарное'
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
 * Безопасная очистка одного интервала
 * @param {number} id - id интервала для очистки
 */
function safeClearInterval(id) {
    clearInterval(id);
    const index = activeIntervals.indexOf(id);
    if (index !== -1) {
        activeIntervals.splice(index, 1);
    }
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
    healing: false,
    clanCreate: false,
    clanJoin: false,
    clanLeave: false,
    clanDonate: false,
    raidJoin: false,
    claimAchievement: false,
    pvpAttack: false,
    pvpStart: false,
    useItem: false,
    purchase: false,
    buyCoinItem: false,
    buyEnergy: false,
    wheelSpin: false,
    sellItem: false,
    referral: false,
    searchLoot: false,
    attackBoss: false,
    loadBosses: false
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
    },
    
    hide() {
        if (this._element) {
            this._element.classList.remove('active');
        }
    },
    
    async wrap(fn, message = 'Загрузка...') {
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
        const rarityClass = escapeAttribute(item.rarity || 'common');
        return `
            <div class="item-card rarity-${rarityClass}" 
                 data-id="${escapeAttribute(item.id)}" data-use-item="${escapeAttribute(itemActionId)}">
                <span class="item-icon">${escapeHtml(item.icon || '📦')}</span>
                <span class="item-name">${escapeHtml(item.name)}</span>
                ${item.count ? `<span class="item-count">x${Number(item.count)}</span>` : ''}
                ${actions}
            </div>
        `;
    },
    
    // Карточка босса
    bossCard(boss) {
        const hpPercent = boss.current_hp / boss.max_hp * 100;
        return `
            <div class="boss-card" data-id="${escapeAttribute(boss.id)}">
                <div class="boss-header">
                    <span class="boss-icon">${escapeHtml(boss.icon || '👹')}</span>
                    <span class="boss-name">${escapeHtml(boss.name)}</span>
                </div>
                <div class="boss-hp-bar">
                    <div class="boss-hp-fill" style="width: ${hpPercent}%"></div>
                </div>
                <div class="boss-hp-text">${Number(boss.current_hp)}/${Number(boss.max_hp)} HP</div>
                <button class="btn attack-btn" data-attack-boss>Атаковать</button>
            </div>
        `;
    },
    
    // Кнопка.
    // ВНИМАНИЕ: inline onclick заблокирован CSP (script-src-attr без nonce),
    // поэтому обработчик передаётся через data-* и вызывается делегированным
    // слушателем из document (см. блок «ДЕЛЕГИРОВАНИЕ КЛИКОВ»).
    // action попадает в значение атрибута — экранируем escapeAttribute(),
    // иначе кавычка в action разорвёт разметку.
    button(text, action, type = 'primary', extra = '') {
        return `<button class="btn btn-${escapeAttribute(type)}" data-action="${escapeAttribute(action || '')}" ${extra}>${escapeHtml(text)}</button>`;
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
        const rarityClass = escapeAttribute(item.rarity || 'common');
        return `
            <div class="inventory-slot rarity-${rarityClass}" 
                 data-use-item="${escapeAttribute(itemActionId)}" data-id="${escapeAttribute(item.id)}">
                <span class="item-icon">${escapeHtml(item.icon || '📦')}</span>
                ${item.count > 1 ? `<span class="item-count">${Number(item.count)}</span>` : ''}
            </div>
        `;
    }
};

// ============================================================================
// API - универсальная загрузка данных
// ============================================================================

const API = {
    /**
     * Маппинг типов на эндпоинты.
     *
     * Строится из общего словаря `endpoints` (он же источник для gameApi) —
     * раньше здесь был второй независимый список, и правка эндпоинта в
     * одном месте оставляла другой устаревшим.
     *
     * Обратная совместимость: дополнительно сохраняем ключи, которых нет
     * в `endpoints` (market, pvp, status, energy). Иначе внешний код с
     * API.load('market') получил бы «Неизвестный тип» — это регрессия
     * публичного API. Правки в этих адресах нужно дублировать в endpoints.
     */
    endpoints: {
        ...Object.fromEntries(
            Object.entries(endpoints).map(([name, config]) => [name, `/api${config.endpoint}`])
        ),
        // Ключи из прежнего API.endpoints, отсутствующие в общем словаре
        market: '/api/game/market/listings',
        pvp: '/api/game/pvp/players',
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
    
    // Отмена всех активных запросов
    cancelAllRequests() {
        for (const controller of this._activeControllers.values()) {
            controller.abort();
        }
        this._activeControllers.clear();
    },
    
    // GET запрос
    async get(endpoint, options = {}) {
        return apiRequest(endpoint, { method: 'GET', ...options });
    },
    
    // POST запрос
    async post(endpoint, data, options = {}) {
        return apiRequest(endpoint, { method: 'POST', body: data, ...options });
    },
    
    // PUT запрос
    async put(endpoint, data, options = {}) {
        return apiRequest(endpoint, { method: 'PUT', body: data, ...options });
    },
    
    // DELETE запрос
    async delete(endpoint, options = {}) {
        return apiRequest(endpoint, { method: 'DELETE', ...options });
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
            // signal обязателен: без него controller жил бы только в Map
            // и отмена запроса ни на что бы не влияла.
            const response = await this.get(url, { signal: controller.signal });
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
        } catch (error) {
            // Отменённый пользователем запрос — не ошибка, глотаем,
            // чтобы не сыпались необработанные rejection'ы
            if (error?.name === 'AbortError' && error?.isManualAbort) {
                return null;
            }
            throw error;
        } finally {
            // Снимаем только если контроллер всё ещё наш: за время запроса
            // мог появиться новый запрос того же типа
            if (this._activeControllers.get(type) === controller) {
                this._activeControllers.delete(type);
            }
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

// Регистрация Service Worker намеренно отключена.
// Файл /sw.js на сервере — самоуничтожающийся: при активации он снимает свою
// регистрацию и перезагружает все открытые страницы. Если игра при каждой
// загрузке снова вызывает register(), получается бесконечный цикл
// "загрузка -> активация SW -> перезагрузка" и игрок видит вечный лоадер.
// Поэтому здесь только тихо снимаем возможные старые регистрации и чистим
// их кэши — без регистрации и без перезагрузки страницы.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.getRegistrations()
            .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
            .then(() => (typeof caches !== 'undefined' ? caches.keys() : []))
            .then((cacheNames) => Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))))
            .then(() => {
                if (navigator.serviceWorker.controller) {
                    console.debug('[SW] Легаси-регистрации Service Worker сняты, кэши очищены');
                }
            })
            .catch((error) => {
                console.debug('[SW] Очистка Service Worker пропущена:', error && error.message);
            });
    });
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
 * Удалены getDamagePreview и updateDamagePreviewUI вместе с блоком
 * damage-preview на экране выбора оружия: функцию никто не вызывал,
 * предпросмотр не отображался, а список оружия и так показывает урон
 * каждого ствола. Вместе с ними удалены обращения к /bosses/bonuses —
 * единственным потребителем был этот мёртвый предпросмотр.
 */

// Экспорт новых функций
window.getTimeToNextEnergy = getTimeToNextEnergy;
window.formatTimeMs = formatTimeMs;
window.updateEnergyTimer = updateEnergyTimer;

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
    'shop',           // Магазин (Stars)
    'market',         // Магазин за монеты
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

        // Подсветка активной кнопки нижней навигации
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.screen === screenName);
        });

        // Выполняем специфичные действия при открытии
        onScreenOpen(screenName);
    }
}

/**
 * Обработчик открытия экрана
 * @param {string} screenName - имя экрана
 */
/**
 * Обертка для загрузчиков экрана: почти все они делают await apiRequest
 * без собственного try/catch, и голый вызов давал UnhandledPromiseRejection
 * в консоли при любой сетевой ошибке. Здесь реджекция логируется и гасится,
 * а сам промис возвращается — вызывающий может всё ещё дождаться его.
 */
function safeAsync(name, promise) {
    Promise.resolve(promise).catch(error => {
        console.error(`[${name}] Не удалось загрузить экран:`, error);
    });
    return promise;
}

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
            // Загружаем локации для карты.
            // .catch обязателен: без него сетевая ошибка даёт unhandled
            // promise rejection и молча не рисует карту
            loadLocations().then(() => {
                // Рисуем карту после загрузки данных
                if (typeof renderLocations === 'function') {
                    setTimeout(renderLocations, 100);
                }
            }).catch((mapError) => {
                console.error('Не удалось загрузить локации для карты:', mapError);
                const mapEl = document.getElementById('city-map');
                if (mapEl) {
                    const fallback = document.createElement('div');
                    fallback.className = 'empty-message';
                    fallback.textContent = 'Не удалось загрузить карту';
                    mapEl.parentNode?.replaceChild(fallback, mapEl);
                }
            });
            break;

        case 'inventory':
            safeAsync('inventory', loadInventory());
            break;

        case 'weapon-select':
            safeAsync('weapon-select', loadWeapons());
            break;

        case 'bosses':
            // Загружаем боссов
            if (!actionLocks['loadBosses']) {
                safeAsync('bosses', loadBosses());
            }
            break;

        case 'shop':
            // Открываем магазин (рендерим категорию)
            openShop();
            break;

        case 'rating':
            safeAsync('rating', loadRating());
            break;

        case 'clan':
            safeAsync('clan', loadClan());
            break;

        case 'clans-list':
            safeAsync('clans-list', loadClansList());
            break;

        case 'achievements':
            safeAsync('achievements', loadAchievements());
            break;

        case 'market':
            safeAsync('market', loadCoinShop());
            break;

        case 'pvp-players':
            safeAsync('pvp-players', loadPVPGamePlayers());
            break;

        case 'pvp-stats':
            safeAsync('pvp-stats', loadPVPStats());
            break;

        case 'wheel':
            safeAsync('wheel', loadWheelInfo());
            break;

        case 'referral':
            safeAsync('referral', loadReferralScreen());
            break;

        case 'clan-chat':
            safeAsync('clan-chat', loadClanChat());
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

    // Табы достижений.
    // .catch обязателен: filterAchievements() делает await apiRequest без
    // собственного try/catch, и реджек션 без обработчика всплывает как
    // UnhandledPromiseRejection. Раньше здесь был голый вызов.
    document.querySelectorAll('.achievement-category-btn').forEach(tab => {
        bindClickOnce(tab, `achievements${tab.dataset.category || ''}`, () => {
            const category = tab.dataset.category;
            filterAchievements(category).catch(error => {
                console.error('[achievements] Не удалось загрузить категорию:', error);
            });
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
window.showBossFight = showBossFight;
window.backToBosses = backToBosses;
window.hideLoadingScreen = hideLoadingScreen;
/**
 * Игровые системы
 * Основная логика игры: профиль, инвентарь, крафт, боссы, кланы, PvP, рынок, рефералы, база
 *
 * Зависимости: gameState, apiRequest, showModal, showNotification, playSound, lockAction, unlockAction
 */

// ============================================================================
// ПРОФИЛЬ И ОСНОВНЫЕ ФУНКЦИИ
// ============================================================================

/**
 * Ожидание загрузки Telegram WebApp
 *
 * ВАЖНО: промис теперь ОТКЛОНЯЕТСЯ по таймауту, а не резолвится.
 * Раньше resolve() на 5-й секунде позволял продолжить инициализацию без
 * Telegram, а дальше срабатывал фиктивный ID/initData — приложение
 * работало без авторизации.
 *
 * @param {number} maxWait - сколько ждать, мс
 * @returns {Promise<void>}
 * @throws {Error} если данные Telegram так и не появились
 */
async function waitForTelegramWebApp(maxWait = 5000) {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
        // Данные доступны либо из SDK Telegram, либо из fragment прямой ссылки
        const isReady = () => Boolean(
            window.Telegram?.WebApp?.initDataUnsafe?.user || getInitDataFromHash()
        );
        
        // Если уже загружен - сразу успех
        if (isReady()) {
            resolve();
            return;
        }

        // Функция проверки
        const check = () => {
            if (isReady()) {
                resolve();
                return;
            }
            
            if (Date.now() - startTime > maxWait) {
                reject(new Error('Telegram WebApp не загрузился'));
                return;
            }
            
            setTimeout(check, 100);
        };
        
        check();
    });
}

/**
 * Показать ошибку инициализации вместо экрана загрузки.
 * Кнопка перезапуска навешивается через addEventListener, а не inline onclick:
 * inline-обработчики блокируются строгим CSP (script-src с nonce).
 * @param {string} icon - эмодзи для сообщения
 * @param {string} title - заголовок ошибки
 * @param {string} text - текст ошибки
 */
function renderInitError(icon, title, text) {
    const loadingScreen = document.getElementById('loading-screen');
    if (!loadingScreen) return;

    loadingScreen.style.display = 'flex';
    loadingScreen.innerHTML = `
        <div class="loader">
            <div class="loader-icon">${icon}</div>
            <h1>${title}</h1>
            <p>${text}</p>
            <button class="btn" id="init-error-restart-btn" type="button">🔄 Перезапустить</button>
        </div>
    `;

    const restartBtn = document.getElementById('init-error-restart-btn');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => location.reload());
    }
}

/**
 * Инициализация игры
 */
async function initGame() {
    // Страховка от «вечной загрузки»: если инициализация не завершилась за
    // 30 секунд (зависший запрос, сбой SDK и т.п.), показываем пользователю
    // причину и кнопку перезапуска вместо бесконечного лоадера.
    const initWatchdog = setTimeout(() => {
        if (gameState.player) return; // игра уже запущена
        const loadingScreen = document.getElementById('loading-screen');
        if (!loadingScreen || loadingScreen.style.display === 'none') return;
        console.error('[initGame] Watchdog: инициализация не завершилась за 30 секунд');
        renderInitError('⏳', 'Загрузка затянулась', 'Сервер долго не отвечает. Проверь интернет и попробуй ещё раз.');
    }, 30000);

    try {
        // Ждём пока загрузится Telegram WebApp.
        // В production отсутствие Telegram — фатально: продолжать нельзя,
        // иначе запросы уйдут без валидного initData.
        try {
            await waitForTelegramWebApp();
        } catch (waitError) {
            if (!DEV_FALLBACK_ENABLED) {
                console.error('[initGame] Telegram WebApp не загрузился:', waitError);
                renderInitError(
                    '😿',
                    'Ошибка авторизации',
                    'Не удалось получить данные Telegram. Откройте игру через бота @LastHearthBot'
                );
                return;
            }
            console.warn('[initGame] Telegram WebApp не загрузился, продолжаем в DEV-режиме');
        }
        
        // Инициализируем Telegram WebApp
        if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.ready();
            window.Telegram.WebApp.expand();
        }
        
        const telegramId = getTelegramId();
        if (!telegramId) {
            renderInitError('😿', 'Ошибка', 'Не удалось определить пользователя Telegram. Откройте игру через бота @LastHearthBot');
            return;
        }

        // Подписанные initData обязательны (в production — всегда).
        // localStorage НЕ используется: initData имеет auth_date и протухает,
        // поэтому сохранённая копия — это не валидный вход.
        const initData = getInitData();
        if (!initData) {
            renderInitError('😿', 'Ошибка авторизации', 'Откройте игру через бота @LastHearthBot');
            return;
        }

        // Проверяем/создаём игрока.
        // Сервер берёт user.id ИЗ ПОДПИСАННЫХ initData и сверяет его с
        // переданным telegram_id — подделать чужой ID невозможно.
        await apiRequest('/verify-telegram', {
            method: 'POST',
            body: { telegram_id: telegramId, initData }
        });
        
        // loadProfile() и loadLocations() сами гасят свои ошибки (не бросают
        // наружу), чтобы падение перерисовки не выглядело как провал операции.
        // Отдельные try/catch здесь были лишними и никогда не срабатывали.
        await loadProfile();
        await loadLocations();

        // Проверяем, успешно ли загрузился профиль
        if (!gameState.player) {
            console.error('[initGame] Профиль не загружен, прерываем инициализацию');
            renderInitError('😿', 'Ошибка загрузки', 'Не удалось загрузить профиль. Попробуй перезапустить игру.');
            return;
        }

        // Показываем основной контейнер: в index.html он скрыт (display: none),
        // чтобы до окончания инициализации игрок не видел полупустой интерфейс
        const gameContent = document.getElementById('game-content');
        if (gameContent) {
            gameContent.style.display = 'block';
        }

        // Показываем главный экран только после успешной загрузки профиля
        showScreen('main');

        // Скрываем экран загрузки
        hideLoadingScreen();

        // Запускаем обновление энергии
        safeSetInterval(updateEnergyDisplay, 60000); // Каждую минуту

        // Запускаем проверку статуса (переломы, инфекции)
        safeSetInterval(checkPlayerStatus, 600000); // Каждые 10 минут

    } catch (error) {
        console.error('Init error:', error);

        // Проверяем тип ошибки для более понятного сообщения
        let errorMessage = 'Напиши /start боту';
        if (error.message && error.message.includes('401')) {
            errorMessage = 'Ошибка авторизации. Обновите игру';
        } else if (error.message && error.message.includes('Игрок не найден')) {
            errorMessage = 'Напиши /start боту';
        } else if (error.message && (error.message.includes('network') || error.message.includes('fetch'))) {
            errorMessage = 'Нет соединения. Проверь интернет';
        }

        renderInitError('😿', 'Ошибка', errorMessage);
    } finally {
        clearTimeout(initWatchdog);
    }
}

/**
 * Единая точка записи инвентаря в gameState.
 *
 * Сервер не возвращает индексы, а они нужны для use-item (item_index).
 * Раньше индексы проставлял только loadInventory(), а loadProfile() писал
 * «сырые» предметы без index. Так как useItem() вызывает и то, и другое,
 * после первого использования предмета состояние оставалось без индексов,
 * и ЛЮБОЙ следующий клик по инвентару уходил с item_index=NaN → 400.
 * @param {Array} rawItems - предметы из API
 * @returns {Array} предметы с проставленным index
 */
function setInventoryState(rawItems) {
    const list = Array.isArray(rawItems) ? rawItems : [];
    gameState.inventory = list.map((item, index) => ({ ...item, index }));
    return gameState.inventory;
}

/**
 * Загрузка профиля игрока
 * API возвращает { success, data: { player, achievements, progress, inventory, equipment, active_buffs } }
 */
async function loadProfile() {
    // Сбрасываем кэш ДО запроса: gameApi кэширует GET на 30 секунд, и после
    // мутаций (атака, покупка, колесо) закэшированный профиль отдавал бы
    // устаревшие монеты/XP/инвентарь даже при явном loadProfile()
    invalidateCache('profile');

    // Функция НЕ бросает исключение наружу. Раньше await apiRequest стоял
    // здесь без try/catch, и реджекция улетала в catch вызывающего кода.
    // Так как loadProfile() вызывается ПОСЛЕ успешной мутации (продажа,
    // покупка, перемещение), игрок видел «Не удалось продать предмет»,
    // хотя продажа прошла — падал только перерисованный профиль.
    try {
        const response = await apiRequest('/api/game/profile');

        if (!response?.success) {
            console.error('Ошибка загрузки профиля:', response?.message || 'Unknown error');
            return;
        }

        const payload = response?.data || response;

        if (!payload || typeof payload !== 'object') {
            console.error('Неверный формат ответа профиля:', response);
            return;
        }

    // Распаковываем вложенный объект player в плоскую структуру,
    // которую ожидает остальной UI
    const rawPlayer = payload.player || {};
    const playerData = { ...rawPlayer };

    // Статус для getEffectivePlayerStatus / updateProfileUI
    playerData.status = {
        health: Number(playerData.health || 0),
        max_health: Number(playerData.max_health || 100),
        radiation: Number(playerData.radiation || 0),
        infections: Number(playerData.infections || 0),
        infections_list: playerData.infections_list || [],
        energy: Number(playerData.energy || 0),
        max_energy: Number(playerData.max_energy || 100),
        last_energy_update: playerData.last_energy_update || null
    };
    playerData.energy = playerData.status.energy;
    playerData.max_energy = playerData.status.max_energy;

    // Прогресс опыта по ОБЩЕЙ формуле (public/shared/equipment.js — тот же файл,
// что читает сервер). Раньше формула была продублирована здесь второй
// копией: любое изменение одной из двух копий делало полосу опыта врущей.
    const sharedRules = window.EquipmentShared;
    const level = Math.max(1, Number(playerData.level || 1));
    const expNeeded = sharedRules && typeof sharedRules.getExpForLevel === 'function'
        ? sharedRules.getExpForLevel(level)
        : Math.round(500 * level * (1 + level / 25));
    const expCurrent = Number(playerData.experience || 0);
    playerData.exp_progress = {
        current: expCurrent,
        needed: expNeeded,
        percent: Math.min(100, Math.floor((expCurrent / expNeeded) * 100))
    };

    // Экипировка, баффы и инвентарь из ответа
    playerData.equipment = payload.equipment || {};
    setInventoryState(payload.inventory);
    gameState.buffs = payload.active_buffs || {};
    playerData.buffs = gameState.buffs;

    // Текущая локация — берём из уже загруженного списка локаций
    if (Array.isArray(gameState.locations) && gameState.locations.length && playerData.current_location_id) {
        playerData.location = gameState.locations.find(loc => loc.id === playerData.current_location_id)
            || playerData.location
            || null;
    }

    gameState.player = playerData;

    // Обновляем UI
    updateProfileUI(playerData);
    refreshPlayerEnergyUI();
    } catch (error) {
        // Сетевая ошибка или таймаут. Молча гасим: вызывающий код уже
        // показал результат своей операции (продажа, покупка, переход),
        // и сообщение об ошибке здесь было бы ложным.
        if (error?.isManualAbort || error?.name === 'AbortError') return;
        console.error('[loadProfile] Не удалось обновить профиль:', error);
    }
}

// Интервал регена энергии. Сервер считает его так же (utils/game-helpers.js:
// Math.floor(elapsedSec / 60)), поэтому расхождение значений видно сразу:
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

/**
 * Синхронизация энергии с ответом сервера.
 *
 * ВАЖНО про last_energy_update: регенерация на клиенте считается ОТ этой
 * метки. Если сервер вернул новую энергию, но не вернул метку (либо вернул
 * старую), getEffectivePlayerStatus() тут же дочислит реген от устаревшего
 * времени — и кнопка атаки станет активной при энергии, которой на сервере
 * уже нет. Поэтому метку нужно обновлять всегда, когда пришла новая энергия.
 *
 * @param {number|null} energy - энергия с сервера
 * @param {number|null} maxEnergy - максимум энергии с сервера
 * @param {string|null} lastEnergyUpdate - метка последнего начисления с сервера
 */
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
    } else if (energy !== undefined && energy !== null) {
        // Метки нет, но энергия изменилась — считаем, что сервер только что
        // её списал. Иначе клиент «нарисует» себе энергию из старой метки.
        status.last_energy_update = new Date().toISOString();
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

    // Ежедневный бонус живёт 24 часа — дешевле всего напомнить о нём
    // здесь: раньше механику было видно только кнопкой на экране.
    const lastBonus = player.last_daily_bonus ? new Date(player.last_daily_bonus).getTime() : 0;
    if (!lastBonus || Date.now() - lastBonus >= 24 * 60 * 60 * 1000) {
        const streak = Number(player.daily_streak || 0);
        return {
            tone: 'ready',
            state: 'Награда',
            title: streak > 0 ? `Ежедневный бонус: день ${streak + 1}` : 'Забери ежедневный бонус',
            text: 'Раз в сутки за серию дней: монеты каждый день и звезда каждый третий.',
            primary: '🎁 Бонус доступен прямо сейчас',
            secondary: streak > 0 ? `🔥 Серия: ${streak} дн.` : '⌛ Серия начнётся с первого дня',
            actionLabel: 'Забрать бонус',
            action: 'daily'
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

/**
 * Карточки целей: следующий босс и следующая зона.
 *
 * Раньше здесь читался `player.journey`, которого сервер НЕ отдаёт: в
 * профиле есть только `progress`. Поэтому обе карточки навсегда показывали
 * заглушки «Нет цели» и «Все зоны открыты» — то есть врали игроку и были
 * чистым шумом на экране. Теперь цели вычисляются из данных, которые
 * действительно есть: список боссов (refreshMainScreenInsights кладёт его в
 * mainInsights) и список локаций.
 */
function updateJourneyProgress(player) {
    const mainBossEl = document.getElementById('journey-main-boss');
    const mainBossDescEl = document.getElementById('journey-main-boss-desc');
    const nextZoneEl = document.getElementById('journey-next-zone');
    const nextZoneDescEl = document.getElementById('journey-next-zone-desc');

    // --- Следующий босс: первый, кого ещё не побеждали ---
    const bosses = getMainInsightsStore().bosses;
    const nextBoss = Array.isArray(bosses)
        ? bosses.find((boss) => Number(boss.defeated_count || 0) === 0)
        : null;

    if (mainBossEl) {
        mainBossEl.textContent = nextBoss ? nextBoss.name : 'Все побеждены';
    }
    if (mainBossDescEl) {
        if (!nextBoss) {
            mainBossDescEl.textContent = 'Финальный страж позади';
        } else if (nextBoss.is_unlocked) {
            mainBossDescEl.textContent = `Доступен · урон ${Number(nextBoss.current_damage) || 0}`;
        } else {
            const required = Number(nextBoss.required_keys) || 1;
            const owned = Number(nextBoss.owned_keys) || 0;
            mainBossDescEl.textContent = `Ключи: ${owned}/${required}`;
        }
    }

    // --- Следующая зона: первая, на которую не хватает уровня ---
    const level = Math.max(1, Number(player?.level) || 1);
    const zones = Array.isArray(gameState.locations) ? gameState.locations : [];
    const nextZone = zones.find((zone) => {
        const required = Number(zone.required_level ?? zone.min_level ?? 1);
        return required > level;
    });

    if (nextZoneEl) {
        nextZoneEl.textContent = nextZone ? nextZone.name : 'Все зоны открыты';
    }
    if (nextZoneDescEl) {
        nextZoneDescEl.textContent = nextZone
            ? `Уровень ${Number(nextZone.required_level ?? nextZone.min_level) || 1} · риск ${Number(nextZone.danger_level) || 1}/7`
            : 'Открыты самые опасные места';
    }
}

/**
 * Правила экипировки и расчёт защиты — в public/shared/equipment.js,
 * том же файле, что читает сервер. Копия в браузере разъезжалась с
 * серверной: клиент показывал игроку одну защиту, а сервер начислял другую.
 * Слоты, синонимы полей и формула /10 берутся оттуда же.
 */
function calculatePlayerPreparation(player) {
    const equipment = player?.equipment || {};
    const shared = window.EquipmentShared;

    return {
        radiationDefense: shared.calculateRadiationDefense(equipment),
        infectionDefense: shared.calculateInfectionDefense(equipment)
    };
}

function getCurrentZoneRiskProfile(player) {
    const location = player?.location || player?.current_location || {};
    const preparation = calculatePlayerPreparation(player || {});
    // Общие правила живут в shared/equipment.js -> window.EquipmentShared.
    // Раньше здесь стоял голый `shared.` без объявления — браузер падал с
    // ReferenceError: shared is not defined, и весь initGame прерывался.
    const shared = window.EquipmentShared;
    const radiationThreat = shared.normalizeThreatLevelToPoints(location.radiation);
    const infectionThreat = shared.normalizeThreatLevelToPoints(location.infection);
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

/**
 * Удалены updateQuickEntryBadges и setQuickEntryBadge: бейджи «доступно»,
 * «нужно», «награда» ставились на кнопки быстрого доступа, но элементов
 * bosses-badge / shop-badge / rating-badge / pvp-badge в разметке нет —
 * функции молча ничего не делали, но требовали данных о боссах и
 * достижениях, то есть лишние запросы при каждом обновлении экрана.
 * Совет «что делать» теперь даёт единственная карточка рекомендаций.
 */

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

function updateMainScreenInsights(player) {
    if (!player) return;

    // Три функции-дубли удалены вместе с их блоками разметки:
    // updateMainProgressCards (карточки Опыт/Боссы/Достижения),
    // updateMainBonuses (пилюли Урон/Дроп/Выживаемость) и
    // updateRiskSummary (карточка «Состояние»).
    // Карточка рекомендаций ниже уже показывает состояние, совет и действие,
    // поэтому экран больше не повторяет одну мысль четыре раза.
    updateMainRecommendationUI(player);
    updateJourneyProgress(player);
    updateZonePreparationUI(player);
}

function handleMainGuidanceAction(action) {
    switch (action) {
        case 'search':
            document.getElementById('search-btn')?.click();
            break;
        case 'daily':
            claimDailyBonus();
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
 *
 * Синхронная функция: async больше не нужен (внутри нет await), а промис
 * без причины усложнял чтение и вызовы вида `updateProfileUI(x).catch(...)`.
 */
function updateProfileUI(player) {
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
    
    // Локацию
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

    updateDailyBonusUI(player);
    updateHealPanel(player);
    
    // Обновляем отображение переломов и инфекций
    updateConditionsUI(status);
    updateMainScreenInsights(player);
    syncUnlockedLocations(true);
    refreshMainScreenInsights().catch(error => {
        console.debug('Не удалось обновить инсайты главного экрана:', error);
    });
}

/**
 * Панель лечения на главном экране.
 *
 * Показывается, когда здоровье неполное. Внутри — все лечащие предметы из
 * инвентаря крупными кнопками с понятным «+30 HP», настройка автолечения и
 * подсказка про пассивное восстановление.
 *
 * Раньше лечить здоровье было можно только вручную через инвентарь: игрок
 * не знал, что делать, и терял бой.
 */
function updateHealPanel(player) {
    const panel = document.getElementById('heal-panel');
    if (!panel || !player) return;

    const shared = window.EquipmentShared;
    const maxHealth = Math.max(1, Number(player.max_health) || Number(player.status?.max_health) || 1);
    const health = Math.max(0, Number(player.status?.health ?? player.health) || 0);
    const missing = maxHealth - health;

    // Инвентарь нужен всегда: показываем панель и когда лечить нечем
    // (тогда в ней будет подсказка, куда идти).
    const items = (Array.isArray(gameState.inventory) ? gameState.inventory : [])
        .map((entry) => {
            const heal = Number(entry?.stats?.health ?? entry?.stats?.healing ?? entry?.heal ?? 0);
            if (heal <= 0) return null;
            return {
                index: Number(entry.index),
                id: Number(entry.id),
                name: entry.name || 'Лекарство',
                icon: entry.icon || '💊',
                heal: Math.min(heal, maxHealth),
                quantity: Math.max(1, Number(entry.quantity || entry.count || 1))
            };
        })
        .filter(Boolean);

    if (missing <= 0 && items.length === 0) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';

    // Подсказка: что именно сейчас происходит со здоровьем.
    const hintEl = document.getElementById('heal-panel-hint');
    if (hintEl) {
        const cap = shared ? shared.getHealthRegenCap(maxHealth) : Math.floor(maxHealth * 0.6);
        const interval = shared ? Math.round(shared.HEALTH_REGEN_INTERVAL_MS / 1000) : 90;
        hintEl.textContent = missing <= 0
            ? `Здоровье полное · восстановление до ${cap}/${maxHealth} идёт само (+1 HP / ${interval} с)`
            : `Не хватает ${missing} HP · реген сам поднимет до ${cap}/${maxHealth}`;
    }

    // Кнопки лечения.
    const itemsEl = document.getElementById('heal-panel-items');
    if (itemsEl) {
        if (items.length === 0) {
            itemsEl.innerHTML = '<div class="heal-panel-empty">Нет лекарств — купи в магазине или жди восстановления</div>';
        } else {
            itemsEl.innerHTML = items.map((item) => `
                <button class="heal-item-btn" data-heal-index="${item.index}">
                    <span class="heal-item-icon">${escapeHtml(item.icon)}</span>
                    <span class="heal-item-name">${escapeHtml(item.name)}</span>
                    <span class="heal-item-value">+${item.heal} HP</span>
                    ${item.quantity > 1 ? `<span class="heal-item-stack">×${item.quantity}</span>` : ''}
                </button>
            `).join('');
        }
    }

    // Настройки автолечения.
    const enabled = player.auto_heal_enabled !== false;
    const threshold = Number(player.auto_heal_threshold) || (shared ? shared.DEFAULT_AUTO_HEAL_THRESHOLD : 35);
    const toggle = document.getElementById('auto-heal-enabled');
    const range = document.getElementById('auto-heal-threshold');
    const label = document.getElementById('auto-heal-threshold-label');

    if (toggle) toggle.checked = enabled;
    if (range) range.value = String(threshold);
    if (label) {
        label.textContent = enabled
            ? `— сработает при ${Math.round((maxHealth * threshold) / 100)} HP`
            : '— выключено';
    }
}

/** Настройка автолечения */
async function saveAutoHealSettings() {
    const toggle = document.getElementById('auto-heal-enabled');
    const range = document.getElementById('auto-heal-threshold');
    if (!toggle || !range) return;

    try {
        const result = await apiRequest('/api/game/player/auto-heal', {
            method: 'POST',
            body: {
                enabled: toggle.checked,
                threshold: Number(range.value)
            }
        });

        if (gameState.player) {
            gameState.player.auto_heal_enabled = result.data?.enabled ?? toggle.checked;
            gameState.player.auto_heal_threshold = result.data?.threshold ?? Number(range.value);
        }
        updateHealPanel(gameState.player);
    } catch (error) {
        showNotification(error?.message || 'Не удалось сохранить настройку', 'error');
    }
}

/** Использовать лечебный предмет из панели лечения */
async function healItem(itemIndex) {
    if (!lockAction('healItem')) return;
    try {
        const result = await apiRequest('/api/game/inventory/use-item', {
            method: 'POST',
            body: { item_index: itemIndex, equip: false }
        });
        if (result.success) {
            showNotification(`❤️ ${result.message || 'Здоровье восстановлено'}`, 'success');
            RenderCache.clear();
            await loadProfile();
            await loadInventory();
        }
    } catch (error) {
        showNotification(error?.message || 'Не удалось применить лекарство', 'error');
    } finally {
        unlockAction('healItem');
    }
}

/** Ежедневный бонус: доступность кнопки и серия дней.
 *
 * Механика была недоступна из UI: эндпоинта /daily-bonus не существовало,
 * хотя бот обещал бонус на команду /daily, а профиль отдаёт daily_streak.
 * Кнопка появляется только когда бонус реально доступен.
 */
function updateDailyBonusUI(player) {
    const button = document.getElementById('daily-bonus-btn');
    if (!button) return;

    const streak = Number(player?.daily_streak || 0);
    const lastBonus = player?.last_daily_bonus ? new Date(player.last_daily_bonus).getTime() : 0;
    const readyAt = lastBonus + 24 * 60 * 60 * 1000;
    const available = !lastBonus || Date.now() >= readyAt;

    button.style.display = available ? '' : 'none';
    button.dataset.dailyStreak = String(streak);
    button.textContent = streak > 0 ? `🎁 Ежедневный бонус (день ${streak + 1})` : '🎁 Получить ежедневный бонус';
}

/** Забрать ежедневный бонус */
async function claimDailyBonus() {
    if (!lockAction('dailyBonus')) return;
    try {
        const result = await apiRequest('/api/game/player/daily-bonus', { method: 'POST' });
        showNotification(`🎁 ${result.data?.message || 'Бонус получен'}`, 'success');
        playSound('coin');
        await loadProfile().catch(() => null);
        RenderCache.clear();
    } catch (error) {
        showNotification(error?.message || 'Не удалось получить бонус', 'error');
    } finally {
        unlockAction('dailyBonus');
    }
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
    // Как и loadProfile: не бросаем наружу. Иначе ошибка загрузки локаций
    // превращалась в «Не удалось переместиться» / «Не удалось найти лут»,
    // хотя сама операция уже завершилась успешно.
    try {
        const response = await apiRequest('/api/game/locations');
        const data = response.data || response;
        gameState.locations = data.locations || [];

        // Обновляем текущую локацию игрока, если профиль уже загружен
        if (gameState.player?.current_location_id) {
            gameState.player.location = gameState.locations.find(
                loc => loc.id === gameState.player.current_location_id
            ) || gameState.player.location || null;
        }

        syncUnlockedLocations(false);
    } catch (error) {
        if (error?.isManualAbort || error?.name === 'AbortError') return;
        console.error('[loadLocations] Не удалось загрузить локации:', error);
    }
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
            // Сбрасываем кэш рендеринга — инвентарь мог измениться
            RenderCache.clear();
            
            // Анимация лута если предмет найден
            if (result.found_key) {
                // Ключ босса хранится в boss_keys, а не в инвентаре:
                // сервер присылает его отдельным полем found_key.
                showLootAnimation(result.found_key);
                showModal(
                    '🗝️ Найден ключ!',
                    `${result.found_key.name} — откроет бой с боссом «${result.found_key.boss_name}».`
                );
                playSound('loot');
                invalidateCache('bosses');
            } else if (result.found_item) {
                showLootAnimation(result.found_item);
                showModal(
                    '🎉 Предмет найден!',
                    `Вы нашли: ${result.found_item.name} (${result.found_item.rarity})`
                );
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

            // Финальная синхронизация статуса/локации с сервером,
            // чтобы исключить рассинхрон UI после лута и дебаффов.
            await loadProfile();

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
                const currentEnergy = Number(result?.energy?.current ?? result?.energy ?? 0);
                errorMsg = `Недостаточно энергии! Требуется: 1, у вас: ${currentEnergy}`;
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
            showModal('✅ Успех', result.data?.message || result.message || `Вы прибыли в ${locationData?.name || 'новую локацию'}`);
            await loadProfile();
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

    // Баффы тоже живут на таймере: раньше истёкший бафф оставался на экране
    // до следующего loadProfile()/перерендера. Пересчитываем раз в минуту
    // (точность до минуты для UI более чем достаточна) и чистим истёкшие.
    pruneExpiredBuffs();
    renderActiveBuffs(gameState.buffs || {});
}

/**
 * Удаляет из gameState.buffs все баффы с истёкшим сроком.
 * Единственный источник истины — сервер; здесь только чистим локальный кэш.
 */
function pruneExpiredBuffs() {
    const buffs = gameState.buffs;
    if (!buffs || typeof buffs !== 'object') return;

    const now = Date.now();
    for (const [effect, buff] of Object.entries(buffs)) {
        const expiresAt = new Date(
            buff?.expires_at || buff?.expires || 0
        ).getTime();
        if (Number.isFinite(expiresAt) && expiresAt <= now) {
            delete buffs[effect];
        }
    }
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
        const payload = result?.data || result;
        
        if (payload.died) {
            // Игрок умер
            showModal(
                payload.reason === 'radiation' ? '☢️ Гибель' : '☠️ Гибель',
                (payload.message || 'Персонаж погиб') + '\n\nНапиши /start боту чтобы начать заново'
            );
            return;
        }
        
        // Обновляем UI если есть изменения
        if (payload.infection_result?.success) {
            showModal('🤒 Инфекция!', payload.infection_result.message);
        }
        
        // Перезагружаем профиль
        await loadProfile();

    } catch (error) {
        // Раньше здесь был пустой catch {}: фоновая проверка статуса
        // (раз в 10 минут) молча падала, и игрок не узнавал, что переломы,
        // инфекции и смерть обновляются только при смене экрана.
        // Тихим делаем только отмену запроса — она штатная.
        const isManualAbort = error?.isManualAbort || error?.name === 'AbortError';
        if (!isManualAbort) {
            console.warn('[checkPlayerStatus] Не удалось проверить статус:', error);
        }
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

    // Слот определяет общий файл правил (public/shared/equipment.js) — тот же,
    // что использует сервер. Раньше здесь был свой список, в котором не было
    // слотов body/head/hands/legs: такие предметы клиент считал неэкипируемыми.
    if (window.EquipmentShared?.resolveEquipmentSlot) {
        return Boolean(window.EquipmentShared.resolveEquipmentSlot(item));
    }

    const type = String(item.type || '').toLowerCase();
    return type === 'weapon' || type === 'armor' || type === 'helmet';
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
            // Для экипировки модалка на каждый клик раздражала —
            // ограничиваемся всплывающим уведомлением.
            const message = payload.message || result.message || 'Действие выполнено';
            if (options.equip) {
                showNotification(`✅ ${message}`, 'success');
            } else {
                showModal('✅ Успех', message);
            }

            // Сбрасываем кэш рендеринга, т.к. инвентарь изменился
            RenderCache.clear();

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

        // Индексы проставляет setInventoryState — тот же путь, что и в loadProfile,
        // иначе состояния расходятся и клики по инвентарю ломаются.
        const inventoryItems = setInventoryState(data.inventory);

        // Обновляем статистику
        const invCoins = document.getElementById('inv-coins');
        const invStars = document.getElementById('inv-stars');
        if (invCoins) invCoins.textContent = gameState.player?.coins || 0;
        if (invStars) invStars.textContent = gameState.player?.stars || 0;

        renderEquipment(data.equipment);
        renderInventoryCapacity();
        renderInventoryWithFilters(inventoryItems);
        // Мастерская тянет цены ремонта/улучшения с сервера, поэтому грузится
        // после отрисовки панели снаряжения.
        renderWorkshopPanel();

    } catch (error) {
        console.error('Inventory error:', error);
        showNotification('Не удалось загрузить инвентарь', 'error');
    }
}

/**
 * Прочность и уровень улучшения надетого предмета.
 *
 * Считаем через EquipmentShared — тот же модуль, что использует сервер,
 * поэтому цифры в панели и в бою всегда совпадают.
 */
function renderEquipmentState(item) {
    const rules = window.EquipmentShared;
    if (!rules) return '';

    const durability = rules.getDurabilityInfo(item);
    const upgradeLevel = rules.getUpgradeLevel(item);
    const parts = [];

    if (upgradeLevel > 0) {
        parts.push(`<span class="equip-slot-upgrade">+${upgradeLevel}</span>`);
    }

    if (durability.isBroken) {
        parts.push('<span class="equip-slot-durability is-broken">⚠️ сломано</span>');
    } else if (durability.current < durability.max) {
        parts.push(`<span class="equip-slot-durability">🔧 ${durability.current}/${durability.max}</span>`);
    }

    return parts.length ? `<span class="equip-slot-state">${parts.join(' ')}</span>` : '';
}

/**
 * Панель снаряжения.
 *
 * Экипировка влияла на урон и защиту, но нигде не отображалась — игрок
 * надевал предмет и не получал никакой обратной связи. Слоты повторяют
 * VALID_SLOTS из normalizeEquipment() (utils/game-helpers.js).
 * @param {object} equipment - объект { slot: item }
 */
function renderEquipment(equipment) {
    const root = document.getElementById('inventory-equipment');
    if (!root) return;

    const eq = (equipment && typeof equipment === 'object') ? equipment : {};
    const slots = [
        ['weapon', '⚔️ Оружие'],
        ['armor', '🛡️ Броня'],
        ['helmet', '🪖 Шлем'],
        ['body', '🧥 Костюм'],
        ['head', '🎽 Голова'],
        ['hands', '🧤 Руки'],
        ['legs', '👖 Ноги'],
        ['boots', '🥾 Обувь'],
        ['accessory', '💍 Аксессуар']
    ];

    root.innerHTML = `
        <h4 class="inv-equipment-title">Снаряжение</h4>
        <div class="inv-equipment-grid">
            ${slots.map(([slot, label]) => {
                const item = eq[slot];
                if (!item) {
                    return `<div class="equip-slot is-empty">
                        <span class="equip-slot-label">${label}</span>
                        <span class="equip-slot-empty">пусто</span>
                    </div>`;
                }
                return `<div class="equip-slot rarity-${escapeHtml(item.rarity || 'common')}">
                    <span class="equip-slot-icon">${escapeHtml(item.icon || '📦')}</span>
                    <span class="equip-slot-info">
                        <span class="equip-slot-name">${escapeHtml(item.name || label)}</span>
                        <span class="equip-slot-label">${escapeHtml(RARITY_LABELS[item.rarity] || '')}</span>
                        ${renderEquipmentState(item)}
                    </span>
                    <!-- Снятие было невозможно: слот можно было только заменить
                         другим предметом. Кнопка возвращает вещь в инвентарь. -->
                    <button class="btn equip-unequip-btn" data-ws-unequip="${escapeAttribute(slot)}"
                            title="Снять">✕</button>
                </div>`;
            }).join('')}
        </div>
        <div id="workshop-panel" class="inv-workshop"></div>
    `;
}

/**
 * Блок мастерской: ремонт и улучшение надетого снаряжения.
 *
 * Данные берём с /api/game/workshop (там считаются цены по тем же правилам,
 * что и на сервере), поэтому кнопки сразу показывают реальную стоимость.
 */
async function renderWorkshopPanel() {
    const root = document.getElementById('workshop-panel');
    if (!root) return;

    try {
        const response = await apiRequest('/api/game/workshop');
        const data = response?.data || response;
        const slots = Array.isArray(data.slots) ? data.slots : [];

        if (slots.length === 0) {
            root.innerHTML = '';
            return;
        }

        // Монетам в мастерской нужно быть свежими: покупка в магазине или
        // продажа лута меняет баланс, и цена кнопки должна быть актуальной.
        const coins = Number(gameState.player?.coins ?? data.coins ?? 0);
        root.innerHTML = `
            <h4 class="inv-equipment-title">Мастерская · 🪙 ${formatNumber(coins)}</h4>
            <div class="inv-workshop-list">
                ${slots.map((entry) => renderWorkshopSlot(entry, data)).join('')}
            </div>
        `;

        bindWorkshopActions();
    } catch (error) {
        console.warn('Не удалось загрузить мастерскую:', error);
        root.innerHTML = '';
    }
}

/** Снять предмет из слота обратно в инвентарь */
async function unequipSlot(slot) {
    if (!lockAction(`unequip-${slot}`)) return;
    try {
        const result = await apiRequest('/api/game/inventory/unequip', {
            method: 'POST',
            body: { slot }
        });
        showNotification(`🎒 ${result.message || 'Предмет снят'}`, 'success');
        RenderCache.clear();
        await loadInventory();
        await loadProfile();
    } catch (error) {
        showNotification(error?.message || 'Не удалось снять предмет', 'error');
    } finally {
        unlockAction(`unequip-${slot}`);
    }
}

/** Модификации для строки мастерской */
function renderWorkshopModifications(entry, data) {
    const list = Array.isArray(entry.modifications) ? entry.modifications : [];
    if (list.length === 0) return '';

    const buttons = list.map((modification) => {
        const cost = modification.cost;
        const maxed = !cost;
        const materials = cost?.materials || {};
        const materialText = Object.entries(materials)
            .map(([name, quantity]) => {
                const owned = Number(data.materials?.[name] || 0);
                return `${owned >= Number(quantity) ? '✅' : '❌'} ${escapeHtml(name)} ${owned}/${quantity}`;
            })
            .join(' ');

        return `
            <div class="inv-workshop-mod">
                <span class="inv-workshop-mod-name">${modification.icon} ${escapeHtml(modification.name)} ${modification.level}/${modification.max_level}</span>
                <button class="ws-btn ws-btn-mod" data-ws-modify="${entry.slot}"
                        data-ws-modification="${escapeAttribute(modification.key)}" ${maxed ? 'disabled' : ''}>
                    ${maxed ? 'максимум' : `+1 · 🪙 ${formatNumber(cost.coins)}`}
                </button>
                ${materialText ? `<span class="inv-workshop-mod-mats">${materialText}</span>` : ''}
            </div>
        `;
    }).join('');

    return `<div class="inv-workshop-mods">${buttons}</div>`;
}

/** Строка мастерской для одного слота */
function renderWorkshopSlot(entry, data) {
    const { slot, item, durability, repair_cost: repairCost, upgrade_cost: upgradeCost } = entry;
    const materials = upgradeCost?.materials || {};

    const materialText = Object.entries(materials)
        .map(([name, quantity]) => {
            const owned = Number(data.materials?.[name] || 0);
            const enough = owned >= Number(quantity);
            return `${enough ? '✅' : '❌'} ${escapeHtml(name)} ${owned}/${quantity}`;
        })
        .join('<br>');

    return `
        <div class="inv-workshop-slot">
            <div class="inv-workshop-head">
                <span class="inv-workshop-name">${item.icon || '📦'} ${escapeHtml(item.name)}${item.upgrade_level ? ` +${item.upgrade_level}` : ''}</span>
                <span class="inv-workshop-dur ${durability.is_broken ? 'is-broken' : ''}">
                    ${durability.is_broken ? '⚠️ сломано' : `🔧 ${durability.current}/${durability.max}`}
                </span>
            </div>
            <div class="inv-workshop-actions">
                <button class="ws-btn" data-ws-repair="${slot}" ${repairCost > 0 ? '' : 'disabled'}>
                    🔧 Ремонт · 🪙 ${formatNumber(repairCost)}
                </button>
                <button class="ws-btn" data-ws-upgrade="${slot}" ${upgradeCost ? '' : 'disabled'}>
                    ⬆️ Улучшение${upgradeCost ? ` · 🪙 ${formatNumber(upgradeCost.coins)}` : ' · максимум'}
                </button>
            </div>
            ${materialText ? `<div class="inv-workshop-materials">${materialText}</div>` : ''}
            ${renderWorkshopModifications(entry, data)}
        </div>
    `;
}

/** Обработчики кнопок мастерской */
function bindWorkshopActions() {
    document.querySelectorAll('[data-heal-index]').forEach(button => {
        bindClickOnce(button, `heal-${button.dataset.healIndex}`, () => healItem(Number(button.dataset.healIndex)));
    });

    const autoHealToggle = document.getElementById('auto-heal-enabled');
    if (autoHealToggle && !autoHealToggle.dataset.bound) {
        autoHealToggle.dataset.bound = '1';
        autoHealToggle.addEventListener('change', saveAutoHealSettings);
    }

    const autoHealRange = document.getElementById('auto-heal-threshold');
    if (autoHealRange && !autoHealRange.dataset.bound) {
        autoHealRange.dataset.bound = '1';
        // Ползунок меняется часто — шлём настройку только по отпусканию.
        autoHealRange.addEventListener('input', () => {
            const label = document.getElementById('auto-heal-threshold-label');
            const player = gameState.player;
            if (label && player) {
                const maxHealth = Math.max(1, Number(player.max_health) || 1);
                label.textContent = `— сработает при ${Math.round((maxHealth * Number(autoHealRange.value)) / 100)} HP`;
            }
        });
        autoHealRange.addEventListener('change', saveAutoHealSettings);
    }

    document.querySelectorAll('[data-ws-unequip]').forEach(button => {
        bindClickOnce(button, `ws-unequip-${button.dataset.wsUnequip}`, () => unequipSlot(button.dataset.wsUnequip));
    });

    document.querySelectorAll('[data-ws-repair]').forEach(button => {
        bindClickOnce(button, `ws-repair-${button.dataset.wsRepair}`, () => repairEquipmentSlot(button.dataset.wsRepair));
    });

    document.querySelectorAll('[data-ws-upgrade]').forEach(button => {
        bindClickOnce(button, `ws-upgrade-${button.dataset.wsUpgrade}`, () => upgradeEquipmentSlot(button.dataset.wsUpgrade));
    });

    document.querySelectorAll('[data-ws-modify]').forEach(button => {
        bindClickOnce(button, `ws-modify-${button.dataset.wsModify}-${button.dataset.wsModification}`, () => modifyEquipmentSlot(
            button.dataset.wsModify,
            button.dataset.wsModification
        ));
    });
}

async function modifyEquipmentSlot(slot, modification) {
    if (!lockAction('workshopModify')) return;
    try {
        const result = await apiRequest('/api/game/workshop/modify', {
            method: 'POST',
            body: { slot, modification }
        });
        showNotification(`🔩 ${result.message || 'Модификация установлена'}`, 'success');
        playSound('coin');
        RenderCache.clear();
        await loadInventory();
        await renderWorkshopPanel();
    } catch (error) {
        showNotification(error?.message || 'Не удалось установить модификацию', 'error');
    } finally {
        unlockAction('workshopModify');
    }
}

async function repairEquipmentSlot(slot) {
    if (!lockAction('workshopRepair')) return;
    try {
        const result = await apiRequest('/api/game/workshop/repair', {
            method: 'POST',
            body: { slot }
        });
        showNotification(`🔧 ${result.message || 'Отремонтировано'}`, 'success');
        playSound('coin');
        RenderCache.clear();
        await loadInventory();
        await renderWorkshopPanel();
    } catch (error) {
        showNotification(error?.message || 'Не удалось отремонтировать', 'error');
    } finally {
        unlockAction('workshopRepair');
    }
}

async function upgradeEquipmentSlot(slot) {
    if (!lockAction('workshopUpgrade')) return;
    try {
        const result = await apiRequest('/api/game/workshop/upgrade', {
            method: 'POST',
            body: { slot }
        });
        showNotification(`⬆️ ${result.message || 'Улучшено'}`, 'success');
        playSound('coin');
        RenderCache.clear();
        await loadInventory();
        await renderWorkshopPanel();
    } catch (error) {
        showNotification(error?.message || 'Не удалось улучшить', 'error');
    } finally {
        unlockAction('workshopUpgrade');
    }
}

/**
 * Индикатор вместимости инвентаря.
 * Лимит берём из ответа сервера, а при его отсутствии — из локальной константы,
 * синхронизированной с MAX_INVENTORY_SLOTS в routes/game/world.js.
 */
function renderInventoryCapacity() {
    const el = document.getElementById('inventory-capacity');
    if (!el) return;

    const used = Array.isArray(gameState.inventory) ? gameState.inventory.length : 0;
    // max > 0 гарантирует: INVENTORY_MAX_SLOTS приходит из общего модуля,
    // но при его отсутствии используется запасное 100. Явная проверка
    // защищает от деления на ноль, если значение вдруг окажется 0.
    const max = Math.max(1, Number(INVENTORY_MAX_SLOTS) || 100);
    const percent = Math.min(100, Math.round((used / max) * 100));

    el.textContent = `${used} / ${max}`;
    el.dataset.level = used >= max ? 'full' : used >= max * 0.8 ? 'warn' : 'ok';
    el.style.width = `${percent}%`;
}

/**
 * Разобрать предмет (или стек) на материалы.
 * Отдельный режим в инвентаре: раньше предмет можно было только продать
 * за 35% цены, поэтому 100 слотов забивались ненужным снаряжением.
 * @param {number|string} itemIndex - индекс слота в инвентаре
 */
async function dropItem(itemIndex) {
    if (!lockAction('dropItem')) return;

    try {
        const result = await apiRequest('/api/game/inventory/drop', {
            method: 'POST',
            body: { item_index: parseInt(itemIndex, 10) }
        });

        if (result?.success) {
            const materials = (result.materials || [])
                .map((material) => `${material.icon || '📦'} ${material.name} ×${material.quantity}`)
                .join(', ');

            showNotification(
                materials ? `♻️ ${result.message} → ${materials}` : `♻️ ${result.message}`,
                'success'
            );
            playSound('coin');
            RenderCache.clear();
            await loadInventory();
            await loadProfile();
        } else {
            showNotification(result?.error || 'Не удалось разобрать предмет', 'error');
        }
    } catch (error) {
        console.error('Drop item error:', error);
        showNotification(error?.message || 'Не удалось разобрать предмет', 'error');

        // Индекс мог протухнуть — перерисуем список.
        if (error?.code === 'ITEM_NOT_IN_INVENTORY' || error?.status === 400) {
            await loadInventory();
        }
    } finally {
        unlockAction('dropItem');
    }
}

/**
 * Продать предмет за монеты.
 * Закрывает петлю экономики: добыча → использование → продажа.
 * @param {number|string} itemIndex - индекс слота в инвентаре
 * @param {number} [quantity] - сколько продать из стека (по умолчанию весь)
 */
async function sellItem(itemIndex, quantity = null) {
    if (!lockAction('sellItem')) return;

    try {
        const result = await apiRequest('/api/game/inventory/sell', {
            method: 'POST',
            body: {
                item_index: parseInt(itemIndex, 10),
                ...(quantity ? { quantity: parseInt(quantity, 10) } : {})
            }
        });

        if (result?.success) {
            const earned = Number(result.coins_earned || 0);
            showNotification(`💰 ${result.message || 'Продано'} · +${earned} 🪙`, 'success');
            playSound('coin');
            RenderCache.clear();
            await loadInventory();
            await loadProfile();
        } else {
            showNotification(result?.error || 'Не удалось продать предмет', 'error');
        }
    } catch (error) {
        console.error('Sell item error:', error);
        showNotification(error?.message || 'Не удалось продать предмет', 'error');

        // Индекс мог протухнуть (инвентарь изменился) — перерисуем список.
        if (error?.code === 'ITEM_NOT_IN_INVENTORY' || error?.status === 400) {
            await loadInventory();
        }
    } finally {
        unlockAction('sellItem');
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

    if (normalizedItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-message';
        empty.textContent = Array.isArray(gameState.inventory) && gameState.inventory.length > 0
            ? 'Нет предметов в этой категории'
            : 'Инвентарь пуст. Найди что-нибудь поиском или купи в магазине.';
        grid.appendChild(empty);
        return;
    }

    for (const item of normalizedItems) {
        const slot = document.createElement('div');
        slot.className = `inventory-slot item-rarity rarity-${item.rarity || 'common'}`;

        const isEquippable = isEquippableInventoryItem(item);
        const amount = Number(item.quantity || item.count || 1);
        const name = item.name || 'Предмет';
        const rarityLabel = RARITY_LABELS[item.rarity] || item.rarity || '';
        const sellPrice = Number(item.sell_price || 0);
        const isSellMode = currentInventoryMode === 'sell';
        const canSell = sellPrice > 0;

        slot.classList.toggle('is-sell-mode', isSellMode);
        slot.classList.toggle('is-unsellable', isSellMode && !canSell);

        slot.dataset.index = item.index;
        slot.innerHTML = `
            <span class="item-icon">${escapeHtml(item.icon || '📦')}</span>
            <span class="item-name">${escapeHtml(name)}</span>
            ${amount > 1 ? `<span class="item-count">${amount}</span>` : ''}
            ${isSellMode
                ? `<span class="item-sell-price">${canSell ? `💰 ${sellPrice * amount}` : 'нельзя'}</span>`
                : `<span class="item-rarity-label">${escapeHtml(rarityLabel)}</span>`}
        `;
        slot.setAttribute('role', 'button');
        slot.setAttribute('tabindex', '0');
        slot.setAttribute('aria-label', isSellMode
            ? `${name}. Продать за ${sellPrice * amount} монет`
            : `${name}. ${rarityLabel}. ${isEquippable ? 'Нажмите чтобы надеть' : 'Нажмите чтобы использовать'}`);

        // Клик: в режиме продажи — продажа, иначе использование/экипировка.
        // Отдельный переключатель вместо long-press: long-press ненадёжен
        // в Telegram WebView и не discoverable.
        const activate = () => {
            if (currentInventoryMode === 'sell') {
                if (!canSell) {
                    showNotification('Этот предмет нельзя продать', 'warning');
                    return;
                }
                // Стеку предлагаем выбор: одна штука или весь стек.
                // Раньше продавался только весь стек, а это неудобно, когда
                // нужно оставить пару аптечек.
                if (amount > 1 && canAskStackChoice(item)) {
                    showStackSellDialog(item, amount, sellPrice);
                    return;
                }
                sellItem(item.index);
                return;
            }
            if (currentInventoryMode === 'drop') {
                if (!confirm(`Разобрать «${name}»? Снаряжение даст материалы, остальное просто пропадёт.`)) {
                    return;
                }
                dropItem(item.index);
                return;
            }
            useItem(item.index, { equip: isEquippable });
        };
        slot.addEventListener('click', activate);
        slot.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
            }
        });

        grid.appendChild(slot);
    }
}

/**
 * Диалог продажи части стека.
 *
 * Отдельная функция, а не window.prompt: промпт в Telegram WebApp выглядит
 * чужеродно и на некоторых платформах не поддерживается.
 */
function showStackSellDialog(item, amount, unitPrice) {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const message = document.getElementById('modal-message');
    if (!modal || !title || !message) {
        sellItem(item.index);
        return;
    }

    title.textContent = `Продать: ${item.name || 'предмет'}`;
    message.textContent = `В стопке ${amount} шт. по ${unitPrice} 🪙. Сколько продать?`;
    openModalElement(modal);

    const close = hideModal;
    const actions = [
        { label: `Продать 1 шт. (+${unitPrice} 🪙)`, onClick: () => sellItem(item.index, 1) },
        { label: `Продать всё (+${unitPrice * amount} 🪙)`, onClick: () => sellItem(item.index, amount) },
        { label: 'Отмена', onClick: () => {} }
    ];

    const box = document.createElement('div');
    box.className = 'modal-actions';
    for (const action of actions) {
        const button = document.createElement('button');
        button.className = 'modal-action-btn';
        button.textContent = action.label;
        bindClickOnce(button, `sell-stack-${item.index}-${action.label}`, () => {
            close();
            action.onClick();
        });
        box.appendChild(button);
    }
    message.appendChild(box);
}

/** Снаряжение не стакается, поэтому выбор количества нужен только для стопок */
function canAskStackChoice(item) {
    const type = String(item.type || '').toLowerCase();
    return !['weapon', 'armor'].includes(type) && !item.slot;
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
            // Передаём весь предмет: категория берётся из поля, а не угадывается
            // по диапазону id (см. getItemCategory).
            const category = getItemCategory(item);
            return category === currentInventoryFilter;
        });
    }
    
    // Сортировка предметов
    const sortKey = typeof currentInventorySort !== 'undefined' ? currentInventorySort : 'id';
    filteredItems.sort((a, b) => {
        switch (sortKey) {
            case 'name':
                return (a.name || '').localeCompare(b.name || '');
            case 'rarity': {
                const rarityOrder = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
                const rA = rarityOrder[a.rarity] || 0;
                const rB = rarityOrder[b.rarity] || 0;
                return rB - rA;
            }
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
    if (!lockAction('loadBosses')) return;

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
    } finally {
        unlockAction('loadBosses');
    }
}

function renderBossesInfo(info) {
    const container = document.getElementById('bosses-info');
    if (!container) return;

    if (!info) {
        container.innerHTML = '';
        return;
    }

    // Правила режимов приходят с сервера (bosses.js → data.info) и не меняются
    // от игрока к игроку. Раньше они занимали карточку из трёх строк над
    // списком боссов — постоянный шум на главном экране раздела. Теперь это
    // свёрнутая подсказка «Правила»: видна по требованию, а не всегда.
    // info.* приходит с сервера — экранируем, иначе это XSS-вектор.
    container.innerHTML = `
        <details class="bosses-rules">
            <summary>Правила режимов</summary>
            <ul class="bosses-rules-list">
                <li><strong>Соло:</strong> ${escapeHtml(info.solo || '')}</li>
                <li><strong>Прокачка:</strong> ${escapeHtml(info.mastery || '')}</li>
                <li><strong>Массовый бой:</strong> ${escapeHtml(info.raids || '')}</li>
            </ul>
        </details>
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

// Обработчик переключателя режима боссов (перенесён в startGame)
// document.getElementById('boss-mode-switch')?.addEventListener('change', ...)
// теперь вызывается внутри startGame() после generateScreens()

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
                ${boss.damage_percent ? `<div class="boss-counter">Ответный удар: ~${boss.damage_percent}% здоровья (защита снижает)</div>` : ''}
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
    
    // Удаляем старый обработчик и атрибут data-handler перед добавлением нового
    if (attackSingleBtn) {
        if (attackSingleBtn.hasAttribute('data-handler')) {
            attackSingleBtn.removeAttribute('data-handler');
        }
        // Клонируем элемент, чтобы снять все старые обработчики
        const newBtn = attackSingleBtn.cloneNode(true);
        attackSingleBtn.parentNode.replaceChild(newBtn, attackSingleBtn);
        const freshBtn = document.getElementById('attack-boss-btn');
        if (freshBtn) {
            freshBtn.setAttribute('data-handler', 'true');
            freshBtn.addEventListener('click', attackBoss);
            freshBtn.style.display = 'inline-flex';
        }
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

    const stopTimer = () => {
        if (window.bossFightTimerId) {
            safeClearInterval(window.bossFightTimerId);
            window.bossFightTimerId = null;
        }
    };

    const updateTimer = () => {
        const now = Date.now();
        const remaining = gameState.bossFightEndTime - now;
        
        if (remaining <= 0) {
            timerText.textContent = 'Время вышло!';
            timerText.style.color = 'var(--accent-red)';
            // Снимаем интервал: раньше он продолжал крутиться раз в секунду
            // до конца страницы, хотя бой давно закончился.
            stopTimer();
            return;
        }
        
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        timerText.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };
    
    stopTimer();
    updateTimer();

    // Если время уже истекло до запуска таймера — интервал не нужен вовсе
    if (gameState.bossFightEndTime <= Date.now()) return;

    window.bossFightTimerId = safeSetInterval(updateTimer, 1000);
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
        item.className = `weapon-item ${weapon.is_broken ? 'is-broken' : ''}`;
        item.dataset.index = weapon.index;

        const durabilityText = weapon.is_broken
            ? '⚠️ сломано — отремонтируйте'
            : (weapon.durability < weapon.max_durability
                ? `🔧 ${Number(weapon.durability)}/${Number(weapon.max_durability)}`
                : '');

        // Тип оружия важен: ближний бой бьёт боссов, дальний — людей в PvP.
        const rangeLabel = weapon.category === 'melee'
            ? '<div class="weapon-tag melee">ближний бой · +40% к боссам</div>'
            : '<div class="weapon-tag ranged">дальний бой · +25% в PvP</div>';

        // Название/иконка приходят из инвентаря игрока (серверные данные) —
        // без экранирования это XSS-вектор.
        item.innerHTML = `
            <span class="weapon-icon">${escapeHtml(weapon.icon)}</span>
            <div class="weapon-info">
                <div class="weapon-name">${escapeHtml(weapon.name)}</div>
                <div class="weapon-damage">Урон: +${Number(weapon.damage) || 0}</div>
                ${durabilityText ? `<div class="weapon-durability">${escapeHtml(durabilityText)}</div>` : ''}
                ${rangeLabel}
            </div>
            <span class="weapon-rarity ${escapeAttribute(weapon.rarity)}">${escapeHtml(weapon.rarity)}</span>
        `;

        if (weapon.is_broken) {
            item.classList.add('disabled');
        } else {
            item.addEventListener('click', () => attackWithWeapon(weapon.index));
        }
        list.appendChild(item);
    }
}

/**
 * Общая вступительная проверка атаки по боссу.
 *
 * Раньше она копировалась в attackBoss() и attackWithWeapon(): блокировка
 * двойного нажатия и проверка энергии. Различаться могло только одно —
 * сам `lockAction`, который здесь не используется осознанно: обе функции
 * работают с actionLocks.attackBoss и обязаны снимать её в own finally,
 * иначе блокировка залипала бы после неудачного запроса.
 *
 * @returns {boolean} true — можно атаковать, false — атака отклонена
 */
function canStartBossAttack() {
    if (!gameState.currentBoss) return false;
    if (actionLocks.attackBoss) return false;

    const status = gameState.player?.status;
    const isFreeAttack = Boolean(gameState.buffs?.free_energy);
    if (!status || (!isFreeAttack && status.energy < 1)) {
        showModal('⚠️ Нет энергии', 'Подожди пока восстановится или купи за звёзды');
        return false;
    }

    actionLocks.attackBoss = true;
    return true;
}

/**
 * Обновить полосу HP босса на экране боя.
 *
 * Раньше эти четыре строки дублировались в attackBoss() и attackWithWeapon():
 * правка (например, добавление анимации) гарантированно расходилась бы
 * между двумя путями атаки.
 */
function updateBossHealthUi(bossHp, bossMaxHp) {
    const hpPercent = Math.max(0, Math.min(100, (Number(bossHp) / Number(bossMaxHp)) * 100));
    const bar = document.getElementById('boss-health-bar');
    const text = document.getElementById('boss-health-text');
    if (bar) bar.style.width = `${hpPercent}%`;
    if (text) text.textContent = `${bossHp}/${bossMaxHp}`;

    if (gameState.currentBoss) {
        gameState.currentBoss.hp = bossHp;
        gameState.currentBoss.max_hp = bossMaxHp;
        gameState.currentBoss.health = bossHp;
        gameState.currentBoss.max_health = bossMaxHp;
    }
}

/**
 * Общая часть «босс убит» для обоих путей атаки.
 *
 * Раньше дублировалась почти целиком: анимации, сброс currentBattle,
 * отложенная перезагрузка списка боссов и обновление профиля. Различались
 * только количество конфетти и то, что обычная атака чистит RenderCache.
 *
 * @param {object} rewards - rewards из ответа сервера
 * @param {number|null} mastery - мастерство (null = не показывать)
 * @param {number} confettiCount - сколько частиц конфетти
 * @param {boolean} clearRenderCache - чистить ли кэш рендеринга
 * @param {string|null} sound - звук победы (null = без звука)
 */
function onBossDefeated(rewards, mastery, confettiCount, clearRenderCache, sound = null) {
    if (clearRenderCache) RenderCache.clear();
    if (sound) playSound(sound);

    showVictoryFlash?.();
    showBossDeathParticles?.();
    showConfetti?.(confettiCount);
    if (rewards?.key?.boss_name) showKeyAnimation?.();
    showBossVictorySummary?.(gameState.currentBoss?.name || 'Босс', rewards || {}, mastery ?? null);

    gameState.currentBoss = null;
    gameState.activeBattle = null;

    // Блокировку loadBosses держим до конца перезагрузки списка.
    actionLocks.loadBosses = true;
    setTimeout(() => {
        loadBosses().catch((loadError) => {
            console.error('Boss reload error:', loadError);
            actionLocks.loadBosses = false;
        });
    }, 2200);

    // После убийства изменились монеты/XP/ключи/инвентарь/мастерство —
    // RenderCache.clean() чистит только UI-кэш, данные обновляет только сервер.
    loadProfile().catch((profileError) => {
        console.error('Не удалось обновить профиль после победы:', profileError);
    });
}

/**
 * Атака босса с использованием оружия из инвентаря
 */
async function attackWithWeapon(itemIndex) {
    if (!canStartBossAttack()) return;

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
                // weapon_used приходит с сервера — экранируем
                damageText.innerHTML = `<span class="hit">⚔️</span> Использовал <strong>${escapeHtml(result.data.weapon_used)}</strong>! Нанёс <strong>${Number(result.data.damage) || 0}</strong> урона!`;
                log.appendChild(damageText);

                // Износ оружия виден сразу после удара: без этой строки игрок
                // не понимает, зачем заглядывать в мастерскую.
                const maxDurability = Number(result.data.weapon_max_durability) || 0;
                if (maxDurability > 0) {
                    const left = Number(result.data.weapon_durability) || 0;
                    const wearText = document.createElement('p');
                    wearText.className = 'damage';
                    const tone = result.data.weapon_broken || left === 0
                        ? ' <strong style="color:#ff595e">сломано — отремонтируй</strong>'
                        : left <= Math.ceil(maxDurability * 0.2)
                            ? ' <strong style="color:#ffcc00">почти сломано</strong>'
                            : '';
                    wearText.innerHTML = `🔧 Прочность оружия: ${left}/${maxDurability}${tone}`;
                    log.appendChild(wearText);
                }

                log.scrollTop = log.scrollHeight;
            }
            
            updateBossHealthUi(result.data.boss_hp, result.data.boss_max_hp);

            appendCounterDamageToLog(result.data);
            updatePlayerHealthUi(result.data.health);
            warnAboutBrokenEquipment(result.data.broken_equipment);

            syncPlayerEnergyState(
                result.data.energy,
                gameState.player?.status?.max_energy,
                result.data.last_energy_update || null
            );
            refreshPlayerEnergyUI();

            const attackBtn = document.getElementById('attack-boss-btn');
            if (attackBtn) {
                attackBtn.textContent = gameState.buffs?.free_energy
                    ? '⚔️ Атаковать (бесплатно)'
                    : '⚔️ Атаковать (1 ⚡)';
            }
            
            if (result.data.killed) {
                onBossDefeated(result.data.rewards, result.data.mastery ?? null, 120, false);
            } else {
                // Прочность оружия изменилась — инвентарь на сервере уже обновлён
                loadInventory().catch((invError) => {
                    console.error('Не удалось обновить инвентарь после атаки оружием:', invError);
                });
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
    if (!canStartBossAttack()) return;

    const isFreeAttack = Boolean(gameState.buffs?.free_energy);

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
                // Числа с сервера приводим явно: без Number() строка ответа попала бы
                // в innerHTML как есть (потенциальный XSS при подмене ответа)
                damageText.innerHTML = `<span class="hit">⚔️</span> Нанёс <strong>${Number(result.damage_dealt) || 0}</strong> урона!`;
                log.appendChild(damageText);
                log.scrollTop = log.scrollHeight;
            }
            
            // Обновляем HP босса
            updateBossHealthUi(result.boss_hp, result.boss_max_hp);

            appendCounterDamageToLog(result);
            updatePlayerHealthUi(result.player_health);
            warnAboutBrokenEquipment(result.broken_equipment);
            
            // Обновляем энергию игрока.
            // last_energy_update обязателен: без него клиент посчитает реген
            // от устаревшей метки и покажет энергию, которой на сервере нет.
            const energyUsed = document.getElementById('boss-energy-used');

            syncPlayerEnergyState(
                result.player_energy,
                result.player_max_energy ?? gameState.player?.status?.max_energy,
                result.last_energy_update ?? result.data?.last_energy_update ?? null
            );
            refreshPlayerEnergyUI();

            if (energyUsed) {
                energyUsed.textContent = isFreeAttack ? '0' : '-1';
                energyUsed.classList.add('show');
                setTimeout(() => energyUsed.classList.remove('show'), 500);
            }
            
            // Проверка на победу
            if (result.boss_defeated) {
                // Сообщение о мастерпечатаем ДО сброса currentBoss и
                // до перезагрузки списка — потом onBossDefeated обнулит
                // currentBoss, и подпись экрана боя уже не нужна.
                if (result.mastery !== undefined) {
                    const masteryText = document.createElement('p');
                    masteryText.className = 'mastery-gain';
                    // innerHTML с Number(): значение приходит с сервера,
                    // и без приведения строка ушла бы в innerHTML как HTML
                    masteryText.innerHTML = `<span class="star">⭐</span> Мастерство: ${Number(result.mastery) || 0}`;
                    if (log) log.appendChild(masteryText);
                }

                onBossDefeated(result.rewards, result.mastery ?? null, 140, true, 'victory');
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
            btn.textContent = gameState.buffs?.free_energy
                ? '⚔️ Атаковать (бесплатно)'
                : '⚔️ Атаковать (1 ⚡)';
        }
        actionLocks.attackBoss = false;
    }
}

/**
 * Ответный урон босса в лог боя.
 *
 * Раньше босс не бил в ответ (колонка bosses.damage не использовалась), и
 * игрок не знал, что здоровье вообще можно потерять в бою.
 * @param {object} payload - ответ /attack-boss или /attack-with-weapon
 */
function appendCounterDamageToLog(payload) {
    const taken = Number(payload?.damage_taken ?? payload?.data?.damage_taken ?? 0);
    if (taken <= 0) return;

    const log = document.getElementById('fight-log');
    if (!log) return;

    const line = document.createElement('p');
    line.className = 'damage damage-taken';
    line.innerHTML = `<span class="hit">💥</span> Ответный удар: <strong>-${taken}</strong> HP`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;

    // Автолечение: сервер сам выпил лекарство, сообщаем что именно.
    const autoHeal = payload?.auto_heal ?? payload?.data?.auto_heal;
    if (autoHeal?.used) {
        const healLine = document.createElement('p');
        healLine.className = 'damage damage-heal';
        healLine.innerHTML = `❤️ Автолечение: <strong>${escapeHtml(autoHeal.used)}</strong> +${Number(autoHeal.heal) || 0} HP`;
        log.appendChild(healLine);
        log.scrollTop = log.scrollHeight;
    }

    if (Number(payload?.health ?? payload?.data?.health ?? 0) <= 0) {
        showModal('💀 Вы погибли', 'Здоровье кончилось. Используйте аптечку, чтобы продолжить бой.', 'error');
    }
}

/** Обновить здоровье игрока в UI после боя */
function updatePlayerHealthUi(health) {
    const value = Number(health);
    if (!Number.isFinite(value)) return;

    if (!gameState.player) return;
    if (!gameState.player.status) gameState.player.status = {};
    gameState.player.status.health = value;

    // Те же элементы, что и в updateProfileUI: полоса и подпись «x/y».
    const maxHealth = Number(gameState.player.status.max_health) || 100;
    const healthText = document.getElementById('health-text');
    if (healthText) healthText.textContent = `${value}/${maxHealth}`;

    const healthBar = document.getElementById('health-bar');
    if (healthBar) {
        healthBar.style.width = `${Math.max(0, Math.min(100, (value / maxHealth) * 100))}%`;
    }
}

/**
 * Предупреждение о сломанном снаряжении.
 * @param {string[]|undefined} brokenSlots
 */
function warnAboutBrokenEquipment(brokenSlots) {
    if (!Array.isArray(brokenSlots) || brokenSlots.length === 0) return;

    showNotification('⚠️ Снаряжение сломано — почините его в мастерской (инвентарь → снаряжение)', 'warning', 5000);
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
 * Загрузка информации о клане.
 *
 * Отсутствие клана — это НЕ ошибка, а обычное состояние игрока, поэтому
 * запрос идёт с silent: true (без красного тоста и без записи в консоль).
 * Раньше здесь был красный тост «Ошибка: Вы не состоите в клане» и три
 * одинаковых запроса подряд (apiRequest ретраил 400 дважды).
 */
async function loadClan() {
    try {
        const data = await apiRequest('/api/game/clans/clan', { silent: true });

        if (data?.success && data?.data?.in_clan) {
            clanState.clan = data.data.clan;
            renderClanScreen(data.data);
        } else {
            clanState.clan = null;
            renderNoClanScreen();
        }
    } catch (error) {
        // Старый деплой отдавал 400 NOT_IN_CLAN, пока игрок не состоял в клане.
        // Текущий сервер отвечает 200 + in_clan:false (ветка выше), поэтому
        // сюда мы попадаем только на старом бэкенде или при настоящей ошибке.
        const isNotInClan = error.status === 400
            || error.code === 'NOT_IN_CLAN'
            || /не состоите в клане/i.test(error.message || '');

        if (isNotInClan) {
            clanState.clan = null;
            renderNoClanScreen();
            return;
        }

        // Настоящая ошибка (сеть, 5xx) — сообщаем и не рисуем «экран создания
        // клана», чтобы игрок не решил, что потерял клан.
        console.error('Clan load error:', error);
        showNotification('Не удалось загрузить клан. Попробуй позже.', 'error');
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
                    <span class="stat-value">${Number(clan.members_count || 0)}</span>
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
    
    // Блокировка от двойного клика: без неё два быстрых тапа создавали
    // два запроса, и игрок мог получить два клана или ошибку от сервера.
    if (!lockAction('clanCreate')) return;

    const createBtn = document.getElementById('create-clan-btn');
    if (createBtn) createBtn.disabled = true;
    
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
        showModal('⚠️ Ошибка', 'Не удалось создать клан');
    } finally {
        unlockAction('clanCreate');
        if (createBtn) createBtn.disabled = false;
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
                    '<div class="clan-list-stats">👥 ' + (clan.members_count || 1) + ' | Уровень ' + escapeHtml(clan.level) + '</div>' +
                '</div>' +
                '<button class="join-btn" data-clan-id="' + escapeHtml(clan.id) + '">Вступить</button>' +
            '</div>';
        },
        { emptyMessage: 'Нет доступных кланов' }
    );
    
    list.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', () => joinClan(parseInt(btn.dataset.clanId)));
    });
}

/**
 * Вступление в клан
 */
async function joinClan(clanId) {
    // Блокировка от двойного клика: вступление меняет членство,
    // два быстрых тапа отправляли бы два POST /clans/clan/join
    if (!lockAction('clanJoin')) return;

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
        showModal('⚠️ Ошибка', 'Не удалось вступить в клан');
    } finally {
        unlockAction('clanJoin');
    }
}

/**
 * Выход из клана
 */
async function leaveClan() {
    if (!confirm('Ты уверен, что хочешь покинуть клан?')) return;
    
    // Блокировка от двойного клика: повторный запрос вышел бы уже не из клана
    if (!lockAction('clanLeave')) return;
    
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
        showModal('⚠️ Ошибка', 'Не удалось покинуть клан');
    } finally {
        unlockAction('clanLeave');
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
            '<span class="member-role">' + (roleEmoji[m.clan_role] || roleEmoji.member) + '</span>' +
            '<div class="member-info">' +
                '<div class="member-name">' + escapeHtml(m.first_name || 'Выживший') + '</div>' +
                '<div class="member-level">Уровень ' + escapeHtml(String(m.level ?? 1)) + '</div>' +
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
    openModalElement(modal);
}

/**
 * Показать существующее окно #modal.
 * В разметке у #modal стоит inline style="display:none", поэтому одного
 * класса .active недостаточно — раньше из-за этого окна участников и настроек
 * клана «не открывались». display задаём явно здесь.
 * @param {HTMLElement|null} modal - элемент #modal
 */
function openModalElement(modal) {
    if (!modal) return;

    // Новое открытие «отменяет» отложенное закрытие и увеличивает поколение:
    // таймер из hideModal() увидит несовпадение и не закроет это окно
    if (modalState.closeTimer) {
        clearTimeout(modalState.closeTimer);
        modalState.closeTimer = null;
    }
    modalState.openGeneration++;

    modal.classList.add('active');
    modal.style.display = 'flex';
    modal.style.animation = 'fadeIn 0.3s ease-out';

    // Закрытие по клику вне окна и по крестику
    const modalClose = document.getElementById('modal-close');
    if (modalClose) modalClose.onclick = () => hideModal();
    modal.onclick = (e) => {
        if (e.target === modal) hideModal();
    };
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
    
    // Блокировка от двойного клика: пожертвование тратит монеты, и два
    // быстрых вызова отправляли бы две суммы подряд
    if (!lockAction('clanDonate')) return;
    
    try {
        const result = await apiRequest('/api/game/clans/clan/donate', {
            method: 'POST',
            body: { amount }
        });
        const payload = result?.data || result;
        
        if (result.success) {
            showModal('✅ Успех', `Пожертвование принято! Вы пожертвовали ${amount} монет. Казна: ${Number(payload.clan_total) || 0}`);
            gameState.player.coins = Number(payload.new_balance ?? ((gameState.player.coins || 0) - amount));
            loadClan();
        } else {
            showModal('⚠️ Ошибка', result.error || result.message || 'Не удалось отправить пожертвование');
        }
    } catch (error) {
        console.error('Donate error:', error);
        showModal('⚠️ Ошибка', 'Не удалось отправить пожертвование');
    } finally {
        unlockAction('clanDonate');
    }
}

/**
 * Показ настроек клана
 */
function showClanSettings() {
    const clan = clanState.clan;
    if (!clan) return;
    
    let html = '<div class="clan-settings">';
    html += '<p>Код приглашения: <strong>' + escapeHtml(clan.invite_code || '—') + '</strong></p>';
    html += '<p>Поделитесь кодом с друзьями!</p>';
    html += '</div>';
    
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modal = document.getElementById('modal');
    
    if (modalTitle) modalTitle.textContent = 'Настройки клана';
    if (modalMessage) modalMessage.innerHTML = html;
    openModalElement(modal);
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
            // Имя и уровень приходят из профиля игрока в Telegram, который он
            // контролирует сам, и пишутся в БД без очистки. Без escapeHtml
            // имя вида <img src=x onerror=...> выполнялся бы у всех, кто откроет
            // чат. Текст сообщения ниже экранируется — имя тоже обязано.
            const playerName = escapeHtml(msg.first_name || msg.username || 'Игрок');
            const playerLevel = escapeHtml(msg.level);
            return '<div class="chat-message">' +
                '<div class="chat-header">' +
                    '<span class="chat-author">' + playerName + '</span>' +
                    '<span class="chat-level">[' + playerLevel + ']</span>' +
                    '<span class="chat-time">' + time + '</span>' +
                '</div>' +
                '<div class="chat-text">' + escapeHtml(msg.message) + '</div>' +
            '</div>';
        },
        { emptyMessage: 'Сообщений пока нет' }
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
    // Сервер: покупка энергии стоит 5 звёзд (даёт до +25 энергии)
    const STARS_COST = 5;

    if (!gameState.player) {
        showModal('⚠️ Ошибка', 'Данные игрока не загружены');
        return;
    }

    const playerStars = gameState.player.stars || 0;
    if (playerStars < STARS_COST) {
        showModal('⚠️ Внимание', 'Недостаточно звёзд! Нужно 5 ⭐.');
        return;
    }

    // Блокировка от двойного клика: покупка энергии списывает Stars, и два
    // быстрых тапа отправляли бы два POST и списывали 10 звёзд вместо 5
    if (!lockAction('buyEnergy')) return;

    try {
        const result = await apiRequest('/api/game/player/buy-energy', {
            method: 'POST',
            body: {}
        });

        if (result.success) {
            const payload = result?.data || result;
            syncPlayerEnergyState(
                payload.energy,
                payload.max_energy ?? gameState.player?.status?.max_energy,
                payload.last_energy_update || null
            );
            if (payload.stars !== undefined) {
                gameState.player.stars = Number(payload.stars);
            }
            refreshPlayerEnergyUI();
            await loadProfile();
            showModal('✅ Успех', `Энергия восстановлена! (-${STARS_COST} ⭐)`);
        } else {
            showModal('⚠️ Ошибка', result.error || result.message || 'Не удалось купить энергию');
        }
    } catch (error) {
        console.error('Restore energy error:', error);
        showModal('⚠️ Ошибка', 'Не удалось купить энергию');
    } finally {
        unlockAction('buyEnergy');
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

/**
 * Выбранная на карте локация и троттлинг перерисовки.
 *
 * lastSelectedMapLocationId — чтобы DOM обновлялся только при смене выбора
 * (иначе блок деталей мигает и сдвигает карту при каждом движении мыши).
 *
 * hoveredMapLocationId + mapRepaintPending — перерисовка canvas не чаще
 * одного раза на кадр. Раньше mousemove вызывал полную отрисовку карты на
 * КАЖДОЕ событие: на телефоне это десятки полных repaint в секунду и
 * постоянное «мерцание», из-за которого попасть по локации было невозможно.
 */
let lastSelectedMapLocationId = 0;
let hoveredMapLocationId = 0;
let mapRepaintPending = false;

/**
 * Выбор локации на карте (тап или наведение).
 *
 * Показывает название, радиацию, инфекцию, уровень и оценку риска именно
 * ВЫБРАННОЙ зоны — раньше эта информация жила только в обработчике наведения
 * и была недоступна на телефоне. Переход выполняется отдельной кнопкой.
 *
 * @param {object} loc локация из списка локаций
 */
function selectMapLocation(loc) {
    if (!loc) return;

    // Ключевая строка против «карта прыгает при наведении»: раньше
    // обработчик mousemove вызывал эту функцию на КАЖДОЕ движение мыши,
    // а функция переключала display у блока деталей и кнопки «Перейти».
    // Блок то появлялся, то исчезал — карта под ним сдвигалась вверх-вниз
    // на несколько пикселей, и наводиться на локации становилось невозможно.
    // Теперь обновляем DOM только когда выбранная локация реально изменилась.
    const locationId = Number(loc.id) || 0;
    if (locationId === lastSelectedMapLocationId) return;
    lastSelectedMapLocationId = locationId;

    const nameEl = document.querySelector('.map-location-name');
    if (nameEl) nameEl.textContent = `${loc.icon || ''} ${loc.name || ''}`.trim();

    const infoEl = document.getElementById('map-location-info');
    const travelBtn = document.getElementById('map-travel-btn');

    // Оценка риска зоны считается для подготовки игрока: если он без защиты,
    // это честнее, чем просто «радиация 40».
    const risk = getCurrentZoneRiskProfile({
        location: loc,
        equipment: gameState.player?.equipment || {}
    });
    const level = Math.max(1, Number(gameState.player?.level) || 1);
    const requiredLevel = Number(loc.required_level ?? loc.min_level ?? 1);
    const isCurrent = Number(gameState.player?.current_location_id) === locationId;

    if (infoEl) {
        // textContent, а не innerHTML: значения приходят с сервера.
        infoEl.textContent =
            `☢️ ${Number(loc.radiation) || 0} · 🦠 ${Number(loc.infection) || 0} · ⚠️ риск ${Number(loc.danger_level) || 1}/7 · ${risk.label}`;
        infoEl.dataset.locked = requiredLevel > level ? 'true' : 'false';
    }

    if (travelBtn) {
        if (isCurrent) {
            travelBtn.style.display = 'none';
            delete travelBtn.dataset.locationId;
        } else {
            travelBtn.style.display = '';
            travelBtn.textContent = requiredLevel > level
                ? `🔒 Нужен уровень ${requiredLevel}`
                : 'Перейти';
            travelBtn.disabled = requiredLevel > level;
            travelBtn.dataset.locationId = loc.id;
        }
    }
}

/** Переход в выбранную на карте локацию (кнопка «Перейти») */
function travelToSelectedLocation() {
    const travelBtn = document.getElementById('map-travel-btn');
    const locationId = Number(travelBtn?.dataset.locationId);
    if (!locationId) return;

    const loc = (gameState.locations || []).find((item) => Number(item.id) === locationId);
    const level = Math.max(1, Number(gameState.player?.level) || 1);
    const requiredLevel = Number(loc?.required_level ?? loc?.min_level ?? 1);

    if (requiredLevel > level) {
        showModal('🔒 Заблокировано', `Нужен уровень ${requiredLevel} для входа`);
        return;
    }
    moveToLocation(locationId);
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
            <div class="raid-item" data-raid-id="${escapeAttribute(raid.id)}" data-boss-id="${escapeAttribute(raid.boss?.id)}">
                <div class="raid-boss-icon">${escapeHtml(raid.boss?.icon || '👾')}</div>
                <div class="raid-info">
                    <div class="raid-boss-name">${escapeHtml(raid.boss?.name || 'Босс')}</div>
                    <div class="raid-hp-bar">
                        <div class="raid-hp-fill" style="width: ${hpPercent}%"></div>
                    </div>
                    <div class="raid-hp-text">${formatNumber(raid.hp)} / ${formatNumber(raid.max_hp)} (${hpPercent}%)</div>
                    <div class="raid-leader">Лидер: ${escapeHtml(raid.leader?.name || 'Неизвестно')}</div>
                    <div class="raid-participants">Участников: ${Number(raid.participants_count) || 0}</div>
                    <div class="raid-timer">Осталось: ${escapeHtml(timeRemaining)}</div>
                    ${isParticipating ? 
                        `<button class="btn-attack" data-raid-attack="${escapeAttribute(raid.id)}">Атаковать</button>` :
                        `<button class="btn-join" data-raid-join="${escapeAttribute(raid.id)}">Присоединиться</button>`
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
    // Блокировка от двойного клика: присоединение к рейду пишет на сервере,
    // повторный запрос мог бы задвоить участие
    if (!lockAction('raidJoin')) return;

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
    } finally {
        unlockAction('raidJoin');
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

            // Метка времени обязательна — иначе клиент досчитает регенерацию
            // от устаревшей метки и покажет лишнюю энергию
            if (typeof data.player_energy === 'number') {
                syncPlayerEnergyState(
                    data.player_energy,
                    gameState.player?.status?.max_energy,
                    data.last_energy_update || null
                );
                refreshPlayerEnergyUI();
            }
            
            // Обновляем UI рейда
            await loadRaids();
            renderRaids(gameState.raids);
            
            // После удара в рейде на сервере изменились энергия/урон, а после
            // убийства — монеты/XP/ключи. Профиль нужно перечитать, иначе
            // награды появятся в интерфейсе позже, чем реально начислены.
            loadProfile().catch((profileError) => {
                console.error('Не удалось обновить профиль после атаки в рейде:', profileError);
            });
            
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
 * Интерфейс и обработчики событий
 * Обработчики DOM, фильтры, модальные окна, PvP, достижения, рефералы
 *
 * Зависимости: игровые системы этого файла
 */

// ============================================================================
// ФИЛЬТРЫ ИНВЕНТАРЯ
// ============================================================================

// Глобальные переменные для фильтрации и сортировки инвентаря
let currentInventoryFilter = 'all';
let currentInventorySort = 'id';

/** Режим клика по предмету: 'use' (использовать/надеть) или 'sell' (продать) */
let currentInventoryMode = 'use';

/**
 * Инициализация обработчиков кнопок фильтрации и сортировки
 */
function initInventoryControls() {
    // Раньше стоял флаг inventoryControlsInitialized, который запрещал
    // повторную привязку. Но generateScreens() пересоздаёт DOM-элементы —
    // обработчики на старых кнопках исчезали, а флаг не давал навесить новые,
    // и фильтры/сортировка просто переставали работать.
    // Привязываемся к конкретным элементам через data-bound (bindClickOnce).
    document.querySelectorAll('.filter-btn').forEach(btn => {
        bindClickOnce(btn, `inv-filter-${btn.dataset.filter || 'x'}`, () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentInventoryFilter = btn.dataset.filter || 'all';
            renderInventoryWithFilters(gameState.inventory);
        });
    });

    // Выбор сортировки
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        if (sortSelect.value !== currentInventorySort) {
            sortSelect.value = currentInventorySort;
        }
        bindClickOnce(sortSelect, 'inv-sort', () => {
            currentInventorySort = sortSelect.value || 'id';
            renderInventoryWithFilters(gameState.inventory);
        });
    }

    // Третий режим — «Разобрать»: снаряжение превращается в материалы,
        // остальные предметы просто выбрасываются. Без него инвентарь на
        // 100 слотах был тупиком: продать ненужное можно было только за 35%.
        document.querySelectorAll('.inv-mode-btn').forEach(btn => {
            bindClickOnce(btn, `inv-mode-${btn.dataset.invMode || 'use'}`, () => {
                currentInventoryMode = ['sell', 'drop'].includes(btn.dataset.invMode)
                    ? btn.dataset.invMode
                    : 'use';
                document.querySelectorAll('.inv-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderInventoryWithFilters(gameState.inventory);
            });
        });
}

// ============================================================================
// ДОСТИЖЕНИЯ
// ============================================================================

// Текущая категория достижений
let currentAchievementCategory = null;

/**
 * Загрузить прогресс достижений и отрисовать экран.
 *
 * Раньше этот код был скопирован в loadAchievements() и filterAchievements()
 * целиком (запрос + три вызова рендера + фильтрация по категории). Правка
 * одного из них — например, добавление новой секции на экран — обязательно
 * забывала другой, и фильтр показывал устаревшую разметку.
 *
 * @param {string|null} category - категория для фильтра, null = все
 * @param {string} logPrefix - префикс для сообщения об ошибке
 */
async function renderAchievementsScreen(category, logPrefix) {
    currentAchievementCategory = category;
    try {
        const data = await apiRequest('/api/achievements/progress');

        if (data && data.progress) {
            // Блок «Выполнено достижений X / Y» удалён: та же информация
            // стоит в каждой кнопке категории («Боссы (3/5)») и в каждой
            // карточке достижения. Отдельная шапка была третьим местом,
            // где показывалось одно и то же число.
            renderAchievementsCategories(data.categories);

            if (category) {
                renderAchievementsList(data.progress.filter(a => a.category === category));
            } else {
                renderAchievementsList(data.progress);
            }
        }
    } catch (error) {
        if (error?.isManualAbort || error?.name === 'AbortError') return;
        console.error(`${logPrefix}:`, error);
    }
}

/**
 * Загрузка достижений
 */
async function loadAchievements() {
    await renderAchievementsScreen(currentAchievementCategory, 'Ошибка загрузки достижений');
}

/**
 * Удалены renderAchievementsStats и блок achievements-stats:
 * счётчик «X / Y» дублировался в кнопках категорий и в карточках.
 */

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
        data-achievement-filter="">Все</button>`;
    
    for (const [key, cat] of Object.entries(categories)) {
        html += `
            <button class="achievement-category-btn ${currentAchievementCategory === key ? 'active' : ''}" 
                data-achievement-filter="${escapeHtml(key)}">
                ${categoryNames[key] || escapeHtml(key)} (${cat.completed}/${cat.total})
            </button>
        `;
    }
    
    container.innerHTML = html;
}

/**
 * Фильтрация достижений по категории.
 *
 * Дублировала loadAchievements() целиком; теперь только переключает
 * категорию и просит общий хелпер перерисовать экран.
 */
async function filterAchievements(category) {
    await renderAchievementsScreen(category, '[filterAchievements] Не удалось загрузить достижения');
}

/**
 * Отрисовка списка достижений
 */
function renderAchievementsList(achievements) {
    const container = document.getElementById('achievements-list');
    if (!container) return;
    
    if (!achievements || achievements.length === 0) {
        container.innerHTML = '<div class="empty-message">Нет достижений</div>';
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
        const rarityClass = `rarity-${escapeHtml(ach.rarity || 'common')}`;
        // Числа приводим явно: percent попадает в style, current/target — в текст,
        // и без приведения строка ответа ушла бы в разметку как есть.
        const percent = Math.max(0, Math.min(100, Number(ach.percent) || 0));
        const current = Number(ach.current) || 0;
        const target = Number(ach.target) || 0;

        html += `
            <div class="achievement-card ${ach.completed ? 'completed' : ''} ${rarityClass}">
                <div class="icon">${escapeHtml(ach.icon || '🏆')}</div>
                <div class="info">
                    <div class="name">${escapeHtml(ach.name || '')}</div>
                    <div class="description">${escapeHtml(ach.description || '')}</div>
                    <div class="progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${percent}%"></div>
                        </div>
                        <div class="progress-text">${current}/${target}</div>
                    </div>
                    ${reward && (Number(reward.coins) > 0 || Number(reward.stars) > 0) ? `
                        <div class="reward">
                            ${Number(reward.coins) > 0 ? `<span class="reward-item">🪙 ${Number(reward.coins)}</span>` : ''}
                            ${Number(reward.stars) > 0 ? `<span class="reward-item">⭐ ${Number(reward.stars)}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
                ${ach.completed && !ach.reward_claimed ? `
                    <button class="claim-btn" data-claim-achievement="${ach.id}">Получить</button>
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
    // Блокировка от двойного клика: выдача награды тратит ресурсы игрока,
    // два быстрых тапа отправляли бы два POST /achievements/claim
    if (!lockAction('claimAchievement')) return;

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
    } finally {
        unlockAction('claimAchievement');
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
            // message приходит с сервера — экранируем, иначе это XSS-вектор
            indicator.innerHTML = `<div class="pvp-zone-safe">🛡️ ${escapeHtml(payload.message || 'PvP недоступно')}</div>`;
            list.innerHTML = '<div class="empty-message">Перейдите в локацию с опасностью 6+ для PvP</div>';
            return;
        }
        
        indicator.innerHTML = '<div class="pvp-zone-danger">⚠️ КРАСНАЯ ЗОНА - PvP РАЗРЕШЕНО!</div>';
        
        if (!payload.players || payload.players.length === 0) {
            list.innerHTML = '<div class="empty-message">Нет игроков для атаки</div>';
            return;
        }
        
        list.innerHTML = payload.players.map(player => {
            // Имя соперника — это данные, которые игрок контролирует сам
            // (Telegram username/first_name). В атрибуте data-target-name
            // нужен escapeAttribute: escapeHtml не экранирует кавычки,
            // и значение вида x" onclick="... разорвало бы разметку.
            const safeName = escapeHtml(player.username || 'Игрок');
            return `
            <div class="pvp-player-item">
                <div class="pvp-player-info">
                    <div class="pvp-player-name">${safeName}</div>
                    <div class="pvp-player-stats">
                        <span>Уровень: ${Number(player.level) || 1}</span>
                        <span>HP: ${Number(player.health) || 0}/${Number(player.max_health) || 100}</span>
                    </div>
                    <div class="pvp-player-pvp">
                        <span>Побед: ${Number(player.pvp_wins) || 0}</span>
                        <span>Рейтинг: ${Number(player.pvp_rating) || 1000}</span>
                        <span>Серия: ${Number(player.pvp_streak) || 0}</span>
                    </div>
                </div>
                <button
                    class="pvp-attack-player-btn"
                    data-target-id="${escapeAttribute(player.id)}"
                    data-target-name="${escapeAttribute(player.username || 'Игрок')}"
                    data-target-level="${Number(player.level) || 1}"
                    data-target-health="${Number(player.health) || 0}"
                    data-target-max-health="${Number(player.max_health) || 100}">
                    ⚔️ Атаковать
                </button>
            </div>
        `;
        }).join('');

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
    // Блокировка от двойного клика: без неё два быстрых тапа по «Атаковать»
    // отправляли два POST /pvp/attack и создавали два боя.
    if (!lockAction('pvpStart')) return;

    // Кнопку блокируем сразу, до отправки запроса
    const listButtons = document.querySelectorAll('.pvp-attack-player-btn');
    listButtons.forEach((button) => { button.disabled = true; });

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
    } finally {
        unlockAction('pvpStart');
        // Разблокируем кнопки списка — боя уже нет, можно выбрать другую цель
        document.querySelectorAll('.pvp-attack-player-btn').forEach((button) => {
            button.disabled = false;
        });
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

            // Энергию синхронизируем через syncPlayerEnergyState — он двигает
            // и last_energy_update, иначе клиент досчитает лишнюю регенерацию
            // от старой метки (кнопка атаки станет активна при 0 энергии).
            if (payload.energy_left !== undefined) {
                syncPlayerEnergyState(
                    payload.energy_left,
                    gameState.player?.status?.max_energy,
                    payload.last_energy_update || null
                );
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
                        // message приходит с сервера — экранируем обязательно
                        log.innerHTML += `<p>${escapeHtml(payload.message || 'Удар нанесён')}</p>`;
                        log.scrollTop = log.scrollHeight;
                    }
                }
            }
            
            loadProfile().catch((profileError) => {
                console.error('Не удалось обновить профиль после удара PvP:', profileError);
            });
            
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
    // Ограничиваем процент: max может прийти 0 или меньше текущего HP,
    // и без клампа полоса здоровья растягивалась бы за контейнер.
    const safeMax = Number(max) > 0 ? Number(max) : 1;
    const percent = Math.max(0, Math.min(100, (Number(current) / safeMax) * 100));
    const healthBar = document.getElementById(`pvp-${target}-health`);
    const healthText = document.getElementById(`pvp-${target}-health-text`);
    
    if (healthBar) healthBar.style.width = `${percent}%`;
    if (healthText) healthText.textContent = `${Math.max(0, Number(current) || 0)}/${safeMax}`;
}

/**
 * Обработка завершения PvP боя
 */
function handlePVPBattleEnd(result) {
    const log = document.getElementById('pvp-battle-log');
    if (log) {
        // message может содержать имя соперника (пользовательские данные)
        log.innerHTML += `<p class="battle-result">${escapeHtml(result.message || '')}</p>`;
        log.scrollTop = log.scrollHeight;
    }
    
    const attackBtn = document.getElementById('pvp-attack-btn');
    if (attackBtn) attackBtn.style.display = 'none';
    
    const rewardsDiv = document.getElementById('pvp-rewards');
    const rewardsContent = document.getElementById('pvp-rewards-content');
    
    if (result.winner && result.winner.id === gameState.player?.id) {
        if (rewardsContent) {
            rewardsContent.innerHTML = `
                <div class="reward-item">💰 +${Number(result.rewards?.coins) || 0} монет</div>
                <div class="reward-item">📦 ${result.rewards?.item ? 'Получен предмет' : 'Без предмета'}</div>
                <div class="reward-item">⭐ +${Number(result.rewards?.experience) || 0} опыта</div>
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
    
    loadProfile().catch((profileError) => {
        console.error('Не удалось обновить профиль после PvP-боя:', profileError);
    });
}

/**
 * Завершение экрана PvP-боя
 *
 * ВНИМАНИЕ: награда начисляется СЕРВЕРом внутри POST /pvp/attack-hit
 * (в транзакции боя), отдельного эндпоинта «забрать награды» в API нет.
 * Поэтому здесь только закрывается окно результатов — отправлять запрос
 * не нужно. Имя функции оставлено прежним ради совместимости с
 * делегированными вызовами, но поведение — чисто навигационное.
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
                            safeClearInterval(window.pvpCooldownTimerId);
                            window.pvpCooldownTimerId = null;
                        }
                        return;
                    }
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    if (timerEl) timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                };
                
                updateTimer();
                if (window.pvpCooldownTimerId) safeClearInterval(window.pvpCooldownTimerId);
                window.pvpCooldownTimerId = safeSetInterval(updateTimer, 1000);
            } else if (cooldownDiv) {
                cooldownDiv.style.display = 'none';
                if (window.pvpCooldownTimerId) {
                    safeClearInterval(window.pvpCooldownTimerId);
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
                                    <div class="match-opponent">vs ${escapeHtml(m.opponentName || 'Игрок')}</div>
                                    <div class="match-date">${escapeHtml(date)}</div>
                                </div>
                                <div class="match-damage">
                                    <span>⬆️ ${Number(m.damageDealt) || 0}</span>
                                    <span>⬇️ ${Number(m.damageTaken) || 0}</span>
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
            // total_stars_earned больше не выводится: Stars за рефералов
            // не начисляются, карточка удалена из шаблона выше.
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

                // Бонусы приходят с сервера двумя наборами: earned_* — уровень
                // достигнут, level_* — выплачено. Раньше сервер отдавал
                // level_10 и level_20 жёстко как false, поэтому звёзды ⭐⭐ и ⭐⭐⭐
                // не могли появиться в принципе.
                const b = ref.bonuses || {};
                const bonusIcons = [];
                const bonusTitles = [];

                const addBonus = (earned, claimed, icon, level) => {
                    if (!earned) return;
                    bonusIcons.push(claimed ? icon : '☆');
                    bonusTitles.push(claimed
                        ? `Бонус за ${level} уровень — получен`
                        : `Бонус за ${level} уровень — доступен к получению`);
                };

                addBonus(b.earned_5, b.level_5, '⭐', 5);
                addBonus(b.earned_10, b.level_10, '⭐⭐', 10);
                addBonus(b.earned_20, b.level_20, '⭐⭐⭐', 20);

                const title = bonusTitles.length
                    ? ` title="${escapeAttribute(bonusTitles.join('; '))}"`
                    : '';

                return `
                    <div class="referral-item">
                        <div class="referral-info">
                            <div class="referral-name">${escapeHtml(ref.first_name || ref.username || 'Игрок')}</div>
                            <div class="referral-level">Уровень ${escapeHtml(ref.level)}</div>
                            <div class="referral-joined">Присоединился: ${joinedDate}</div>
                        </div>
                        <div class="referral-bonuses"${title}>${bonusIcons.join(' ') || '🕐'}</div>
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
            if (codeEl) codeEl.textContent = payload.code || newCode;
            // Смена доступна один раз за аккаунт, поэтому секция скрывается
            // навсегда. Сервер вернёт can_change: false — на случай, если
            // раздел открыли повторно без перезагрузки экрана.
            if (changeSection) changeSection.style.display = 'none';
            if (newCodeInput) newCodeInput.value = '';
            showModal('✅ Успех', 'Реферальный код изменён! Повторно изменить его уже нельзя.');
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
    // Нижняя навигация (кнопки есть уже в index.html)
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const screen = btn.dataset.screen;
            if (screen && typeof showScreen === 'function') {
                showScreen(screen);
            }
        });
    });

    // Остальные обработчики навешиваются в initEventHandlers() — после того,
    // как generateScreens() создаст экраны. Раньше эти элементы не существуют,
    // поэтому повторная регистрация здесь была бы и бессмысленной, и лишней.

    // Функция для повторной инициализации обработчиков после generateScreens
    function initEventHandlers() {
        // Основные кнопки
        document.getElementById('search-btn')?.addEventListener('click', () => searchLoot());
        document.getElementById('map-travel-btn')?.addEventListener('click', travelToSelectedLocation);
        document.getElementById('boss-fight-inventory-btn')?.addEventListener('click', () => openWeaponSelect());
        document.getElementById('shop-btn')?.addEventListener('click', () => showScreen('shop'));
        document.getElementById('market-btn')?.addEventListener('click', () => showScreen('market'));
        document.getElementById('wheel-btn')?.addEventListener('click', openWheel);
        document.getElementById('rating-btn')?.addEventListener('click', () => showScreen('rating'));
        document.getElementById('pvp-btn')?.addEventListener('click', () => showScreen('pvp-players'));
        document.getElementById('achievements-btn')?.addEventListener('click', () => showScreen('achievements'));
        document.getElementById('referral-btn')?.addEventListener('click', () => showScreen('referral'));
        
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
    }

    // Инициализация - определяем startGame и сразу запускаем
    function startGame() {
        // Проверяем, что экранный слой загружен
        if (typeof showScreen !== 'function') {
            console.warn('Экранный слой не загружен, ожидаем...');
            setTimeout(startGame, 100);
            return;
        }
        
        // Генерируем все экраны (.screen) динамически
        if (typeof generateScreens === 'function') {
            generateScreens();
        }
        
        // Навешиваем обработчики на свежесозданные DOM-элементы
        initEventHandlers();
        
        // Инициализируем фильтры инвентаря.
        // Раньше здесь стоял setTimeout(..., 200) — гонка с рендером экрана.
        // bindClickOnce идемпотентен, поэтому достаточно вызвать сразу.
        if (typeof initInventoryControls === 'function') {
            initInventoryControls();
        }
        
        initGame();
        initReferralHandlers();
        
        // Инициализация навигации
        if (typeof initNavigationHandlers === 'function') {
            initNavigationHandlers();
        }
        
        // Обработчик переключателя режима боссов
        const bossModeSwitch = document.getElementById('boss-mode-switch');
        if (bossModeSwitch) {
            bossModeSwitch.addEventListener('change', function() {
                if (typeof switchBossesTab === 'function') {
                    switchBossesTab(this.checked ? 'mass' : 'solo');
                }
            });
        }
    }
    
    // Запускаем игру (DOMContentLoaded уже произошёл, вызываем напрямую)
    startGame();
});

// ============================================================================
// ДЕЛЕГИРОВАНИЕ КЛИКОВ ДЛЯ ДИНАМИЧЕСКИХ КНОПОК
// ============================================================================

// Inline-обработчики onclick блокируются строгим CSP (для script-src-attr
// nonce не действует), поэтому кнопки, создаваемые шаблонами (рейды,
// достижения, магазин, карточки предметов/боссов), помечаются data-атрибутами,
// а клики обрабатываются одним общим делегированным обработчиком на document.
document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const raidAttackBtn = target.closest('[data-raid-attack]');
    if (raidAttackBtn) {
        attackRaid(Number(raidAttackBtn.dataset.raidAttack));
        return;
    }

    const raidJoinBtn = target.closest('[data-raid-join]');
    if (raidJoinBtn) {
        joinRaid(Number(raidJoinBtn.dataset.raidJoin));
        return;
    }

    const claimBtn = target.closest('[data-claim-achievement]');
    if (claimBtn) {
        claimAchievement(Number(claimBtn.dataset.claimAchievement));
        return;
    }

    if (target.closest('#daily-bonus-btn')) {
        claimDailyBonus();
        return;
    }

    const achievementFilterBtn = target.closest('[data-achievement-filter]');
    if (achievementFilterBtn) {
        filterAchievements(achievementFilterBtn.dataset.achievementFilter || null);
        return;
    }

    const buyBtn = target.closest('[data-buy-coin-item]');
    if (buyBtn) {
        // Передаём саму кнопку: buyCoinItem блокирует и восстанавливает
        // именно её, а не все кнопки списка
        buyCoinItem(Number(buyBtn.dataset.buyCoinItem), buyBtn);
        return;
    }

    const buyStarBtn = target.closest('[data-buy-star-item]');
    if (buyStarBtn) {
        buyStarItem(Number(buyStarBtn.dataset.buyStarItem), buyStarBtn);
        return;
    }

    const useItemEl = target.closest('[data-use-item]');
    if (useItemEl) {
        useItem(Number(useItemEl.dataset.useItem));
        return;
    }

    if (target.closest('[data-attack-boss]')) {
        attackBoss();
        return;
    }

    // Кнопки из Templates.button(): действие приходит строкой в data-action
    const actionBtn = target.closest('[data-action]');
    if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action && typeof window[action] === 'function') {
            window[action]();
        }
    }
});

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================================================

// Removed window exports for currentInventoryFilter, etc. to avoid sync issues
window.initInventoryControls = initInventoryControls;
window.currentAchievementCategory = currentAchievementCategory;
window.loadAchievements = loadAchievements;

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
// ============================================================================
// ГЕНЕРАЦИЯ ЭКРАНОВ (Screen Generator)
// ============================================================================

/**
 * Создаёт контейнеры экранов (.screen) в #game-content
 * Каждый экран: <div class="screen" id="main-screen">...</div>
 * Вызывается перед initGame()
 */
function generateScreens() {
    const gameContent = document.getElementById('game-content');
    if (!gameContent) return;

    // Удаляем старые screen'ы, если есть (кроме навигации)
    gameContent.querySelectorAll('.screen').forEach(el => el.remove());

    // Шаблон экрана для основных разделов.
    // Раньше здесь были шаблоны fullScreen(id, title) и subScreen(id, title),
    // но их использовала лишь вёрстка экрана выбора оружия. Она описана
    // литералом выше: subScreen не давал указать внутренние блоки
    // (weapon-list, damage-preview), из-за чего экран оставался пустым.
    const screensHtml = `
        <!-- Главный экран -->
        <div class="screen active" id="main-screen">
            <div id="main-content">
                <!-- Хедер -->
                <div class="game-header main-hero-header" id="game-header">
                    <div class="player-info-row">
                        <div class="player-info">
                            <span class="player-name" id="player-name">Загрузка...</span>
                            <span class="player-level" id="player-level">1</span>
                        </div>
                        <div class="main-currency-badges">
                            <span class="currency-badge coins">🪙 <span id="main-coins-value">0</span></span>
                            <span class="currency-badge stars">⭐ <span id="main-stars-value">0</span></span>
                        </div>
                    </div>

                    <!-- Полоски здоровья, энергии, опыта -->
                    <div class="player-stats">
                        <div class="stat-bar">
                            <div class="bar health-bar" id="health-bar" style="width:100%"></div>
                            <span class="bar-text" id="health-text">❤️ 100/100</span>
                        </div>
                        <div class="stat-bar">
                            <div class="bar energy-bar" id="energy-bar" style="width:100%"></div>
                            <span class="bar-text" id="energy-text">⚡ 100/100</span>
                        </div>
                        <div class="stat-bar">
                            <div class="bar exp-bar" id="exp-bar" style="width:0%"></div>
                            <span class="bar-text" id="exp-text">XP 0/500</span>
                        </div>
                    </div>

                    <div class="energy-timer inline" id="energy-timer" style="display:none">⌛ Энергия полная</div>

                    <!-- Состояния: радиация и инфекции -->
                    <div class="conditions-grid" id="conditions-grid" style="display:none">
                        <div class="condition-item">
                            <span class="condition-icon">☢️</span>
                            <span class="condition-text">Радиация</span>
                            <span class="condition-effect" id="radiation-value">0</span>
                        </div>
                        <div class="condition-item infections" id="infections-display" style="display:none">
                            <span class="condition-icon">🤒</span>
                            <span class="condition-text" id="infections-text">Инфекции: 0</span>
                            <span class="condition-effect" id="infection-effect"></span>
                            <span id="infection-value" hidden>0</span>
                        </div>
                    </div>
                </div>

                <!-- Кнопки лечения -->
                <div class="heal-actions" id="heal-actions" style="display:none">
                    <button class="heal-btn" id="heal-infections-btn" style="display:none">💊 Лечить инфекции</button>
                </div>

                <!-- Панель лечения: раньше кнопки лечения здоровья не было
                     ВООБЩЕ — игрок должен был сам догадаться зайти в инвентарь,
                     переключить режим и найти аптечку посреди боя с боссом. -->
                <section class="heal-panel" id="heal-panel" style="display:none">
                    <div class="heal-panel-head">
                        <span class="heal-panel-title">❤️ Лечение</span>
                        <span class="heal-panel-hint" id="heal-panel-hint"></span>
                    </div>
                    <div class="heal-panel-items" id="heal-panel-items"></div>
                    <label class="auto-heal-toggle">
                        <input type="checkbox" id="auto-heal-enabled">
                        <span>Автолечение</span>
                        <span class="auto-heal-threshold" id="auto-heal-threshold-label"></span>
                    </label>
                    <input type="range" class="auto-heal-range" id="auto-heal-threshold"
                           min="10" max="90" step="5" value="35">
                </section>

                <!-- Текущая локация -->
                <section class="location-section">
                    <div class="location-card">
                        <div class="location-icon" id="location-icon">🏠</div>
                        <div class="location-info">
                            <h3 id="location-name">Спальный район</h3>
                            <p id="location-desc">Тихий жилой комплекс</p>
                            <div class="location-stats">
                                <span class="radiation">☢️ <span id="location-radiation">0</span></span>
                                <span class="infection">🦠 <span id="location-infection">0</span></span>
                                <span class="danger">⚠️ ур. <span id="location-danger">1</span></span>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Карточка рекомендаций -->
                <section class="main-guidance-section">
                    <div class="main-guidance-card" id="main-guidance-card" data-tone="ready">
                        <div class="guidance-topline">
                            <span class="guidance-kicker">Что делать сейчас</span>
                            <span class="guidance-state" id="guidance-state">Фарм</span>
                        </div>
                        <div class="guidance-title" id="guidance-title">Лучший ход — искать припасы</div>
                        <div class="guidance-text" id="guidance-text">...</div>
                        <div class="guidance-meta">
                            <span class="meta-pill" id="guidance-meta-primary"></span>
                            <span class="meta-pill" id="guidance-meta-secondary"></span>
                        </div>
                        <button class="action-btn guidance-action-btn" id="guidance-action-btn">Действие</button>
                    </div>
                </section>

                <!-- Главное действие. Вторую кнопку «Карта» убрали: она дублировала
                     пункт нижней навигации и стояла рядом с единственным
                     действием, ради которого игрок сюда приходит. -->
                <section class="actions-section">
                    <button class="action-btn search-btn" id="search-btn">
                        <span class="btn-icon">🔍</span>
                        <span class="btn-text">Искать</span>
                        <span class="btn-cost">-1 ⚡</span>
                    </button>
                </section>
                <section class="extra-actions">
                    <button class="extra-btn" id="shop-btn">🏪 Магазин ⭐</button>
                    <button class="extra-btn" id="market-btn">🛒 Рынок</button>
                    <button class="extra-btn" id="wheel-btn">🎡 Колесо</button>
                    <button class="extra-btn" id="rating-btn">🏆 Рейтинг</button>
                    <button class="extra-btn" id="pvp-btn">⚔️ PvP</button>
                    <button class="extra-btn" id="achievements-btn">🎖️ Достижения</button>
                    <button class="extra-btn" id="referral-btn">📨 Рефералы</button>
                </section>

                <!-- Убраны три блока-дубли:
                     1) quick-progress (Опыт/Боссы/Достижения) — опыт виден по
                        полосе в шапке, боссы и достижения — на своих экранах;
                     2) player-bonuses (Урон/Шанс дропа/Выживаемость) — повторяли
                        состояние, а «шанс дропа» считался по формуле 10+luck*0.4,
                        которая НЕ совпадает с серверной calculateDropChance:
                        игрок видел неверный процент;
                     3) risk-summary («Состояние» + текст + «Ищи лут») — полностью
                        дублировал карточку «Что делать сейчас» с действием.
                     Вместо трёх карточек осталась одна карточка рекомендаций,
                     которая уже содержит состояние, совет и кнопку действия. -->

                <!-- Активные баффы -->
                <div class="active-buffs-section" id="active-buffs-section" style="display:none;margin:0 16px 16px">
                    <div class="active-buffs-header">Активные баффы</div>
                    <div class="active-buffs-list" id="active-buffs-list"></div>
                </div>

                <!-- Ежедневный бонус: виден только когда бонус доступен (updateDailyBonusUI) -->
                <section class="daily-bonus-section" style="margin:0 16px 16px">
                    <button class="btn daily-bonus-btn" id="daily-bonus-btn" style="display:none;width:100%">
                        🎁 Получить ежедневный бонус
                    </button>
                </section>

                <!-- Прогресс: только цели. Раньше здесь стояли ещё три карточки
                     (Опыт / Боссы / Достижения) — они дублировали полосу опыта,
                     карточку рекомендаций и отдельные экраны, из-за чего экран
                     показывал одну и ту же мысль четыре раза. -->
                <section class="journey-progress-section">
                    <div class="journey-progress-grid">
                        <div class="journey-card">
                            <span class="journey-label">Следующий босс</span>
                            <span class="journey-value" id="journey-main-boss">Нет цели</span>
                            <span class="journey-desc" id="journey-main-boss-desc"></span>
                        </div>
                        <div class="journey-card">
                            <span class="journey-label">Следующая зона</span>
                            <span class="journey-value" id="journey-next-zone">Все открыты</span>
                            <span class="journey-desc" id="journey-next-zone-desc"></span>
                        </div>
                    </div>
                </section>
            </div>
        </div>

        <!-- Карта -->
        <div class="screen" id="map-screen">
            <div class="screen-header">
                <h2>🗺️ Карта города</h2>
            </div>
            <div class="map-container">
                <div class="map-info">
                    <span class="map-location-name">Выберите локацию</span>
                    <!-- Появляется по тапу: в мобильном WebView наведения нет,
                         а раньше тап сразу уводил в зону — игрок шёл туда,
                         не видя ни радиации, ни риска. -->
                    <div class="map-location-info" id="map-location-info" style="display:none"></div>
                    <button class="btn map-travel-btn" id="map-travel-btn" style="display:none;width:100%;margin-top:8px">
                        Перейти
                    </button>
                </div>
                <canvas id="city-map" width="350" height="400"></canvas>
                <div class="location-preparation" id="location-preparation-panel">
                    <span class="prep-pill risk">⚠️ <span id="location-risk-label">—</span></span>
                    <span class="prep-pill rad-def">🛡☢ <span id="location-rad-defense">0</span></span>
                    <span class="prep-pill inf-def">🛡🦠 <span id="location-inf-defense">0</span></span>
                </div>
                <div class="location-risk-hint" id="location-risk-hint">Выберите локацию для просмотра рисков</div>
            </div>
        </div>

        <!-- Инвентарь -->
        <div class="screen" id="inventory-screen">
            <div class="screen-header">
                <h2>🎒 Инвентарь</h2>
                <div class="inventory-balance">
                    <span class="currency-badge stars">⭐ <span id="inv-stars">0</span></span>
                    <span class="currency-badge coins">🪙 <span id="inv-coins">0</span></span>
                </div>
            </div>
            <div class="screen-content">
                <div class="inv-toolbar">
                    <div class="inv-filters" id="inventory-filters">
                        <button class="filter-btn active" data-filter="all">Все</button>
                        <button class="filter-btn" data-filter="weapon">⚔️</button>
                        <button class="filter-btn" data-filter="food">🍞</button>
                        <button class="filter-btn" data-filter="medicine">💊</button>
                        <button class="filter-btn" data-filter="armor">🛡️</button>
                        <button class="filter-btn" data-filter="resource">📦</button>
                    </div>
                    <div class="inv-toolbar-row">
                        <label class="inv-capacity">
                            <span class="inv-capacity-label">Слоты</span>
                            <span class="inv-capacity-track"><span class="inv-capacity-fill" id="inventory-capacity" data-level="ok">0 / 100</span></span>
                        </label>
                        <label class="inv-sort">
                            <span class="inv-sort-label">Сортировка</span>
                            <select id="sort-select">
                                <option value="id">По ID</option>
                                <option value="rarity">По редкости</option>
                                <option value="name">По названию</option>
                                <option value="count">По количеству</option>
                            </select>
                        </label>
                    </div>
                    <div class="inv-mode" role="group" aria-label="Действие с предметом">
                        <button class="inv-mode-btn active" data-inv-mode="use">Использовать</button>
                        <button class="inv-mode-btn" data-inv-mode="sell">Продать</button>
    <button class="inv-mode-btn" data-inv-mode="drop">Разобрать</button>
                    </div>
                </div>
                <div class="inv-equipment" id="inventory-equipment"></div>
                <div class="inventory-grid" id="inventory-grid"></div>
            </div>
        </div>

        <!-- Боссы -->
        <div class="screen" id="bosses-screen">
            <div class="screen-header">
                <h2>👹 Боссы</h2>
            </div>
            <div class="screen-content">
                <div class="bosses-info" id="bosses-info"></div>
                <div class="boss-mode-toggle">
                    <span class="toggle-label">Соло</span>
                    <label class="switch">
                        <input type="checkbox" id="boss-mode-switch">
                        <span class="slider"></span>
                    </label>
                    <span class="toggle-label">Массовый</span>
                </div>
                <div class="bosses-list" id="bosses-list"></div>
                <div id="raids-list" style="display:none"></div>
            </div>
        </div>

        <!-- Бой с боссом -->
        <div class="screen" id="boss-fight-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="bosses">← Назад</button>
                <h2>⚔️ Бой с боссом</h2>
            </div>
            <div class="boss-fight-container">
                <div class="boss-fight-header">
                    <div class="boss-icon-large" id="boss-icon">👹</div>
                    <div class="boss-name-large" id="boss-name">Босс</div>
                </div>
                <div class="boss-hp-section">
                    <div class="boss-hp-bar">
                        <div class="boss-hp-fill" id="boss-health-bar" style="width:100%"></div>
                    </div>
                    <div class="boss-hp-text" id="boss-health-text">0/0</div>
                </div>
                <div class="boss-timer" id="boss-fight-timer" style="display:none">
                    <span>⏱️</span>
                    <span id="boss-timer-text">00:00:00</span>
                </div>
                <div class="fight-log" id="fight-log"></div>
                <div class="fight-energy-display">
                    <span class="energy-label">⚡ Энергия:</span>
                    <span id="boss-energy-text">0/100</span>
                    <span class="energy-used" id="boss-energy-used"></span>
                </div>
                <div class="boss-actions">
                    <button class="btn attack-btn" id="attack-boss-btn" style="display:none">⚔️ Атаковать</button>
                    <div class="attack-progress-container" id="attack-progress-container" style="display:none"></div>
                    <button class="btn weapon-btn" id="boss-fight-inventory-btn">🔧 Выбрать оружие</button>
                </div>
            </div>
        </div>

        <!-- Выбор оружия -->
        <div class="screen" id="weapon-select-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="boss-fight">← Назад</button>
                <h2>🔪 Выбор оружия</h2>
            </div>
            <div class="weapon-select-content">
                <!-- Текст про «исчезнет из инвентаря» остался от старой механики,
                     где мощная атака стирала оружие целиком. Теперь оружие
                     изнашивается на 1 прочность и чинится в мастерской. -->
                <p class="weapon-info">Выберите оружие для удара. Оно потратит 1 единицу прочности (чинится в мастерской).</p>
                <div class="weapon-list" id="weapon-list"></div>
            </div>
        </div>

        <!-- Клан -->
        <div class="screen" id="clan-screen">
            <div class="screen-header">
                <h2>🏰 Клан</h2>
            </div>
            <div class="screen-content" id="clan-content"></div>
        </div>

        <!-- Список кланов -->
        <div class="screen" id="clans-list-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="clan">← Назад</button>
                <h2>🏰 Список кланов</h2>
            </div>
            <div class="screen-content">
                <div class="clans-list-search">
                    <input type="text" id="clans-search-input" placeholder="Поиск клана...">
                    <button class="btn" id="clans-search-btn">🔍</button>
                </div>
                <div class="clans-list" id="clans-list"></div>
            </div>
        </div>

        <!-- Создание клана -->
        <div class="screen" id="clan-create-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="clan">← Назад</button>
                <h2>🏰 Создать клан</h2>
            </div>
            <div class="screen-content">
                <div class="form-group">
                    <label>Название клана</label>
                    <input type="text" id="clan-name-input" placeholder="Введите название" maxlength="20">
                </div>
                <div class="form-group">
                    <label>Описание</label>
                    <textarea id="clan-desc-input" placeholder="Описание клана" rows="3"></textarea>
                </div>
                <div class="form-group checkbox-group">
                    <label>
                        <input type="checkbox" id="clan-public-input" checked>
                        Открытый клан
                    </label>
                </div>
                <button class="btn btn-primary" id="create-clan-btn">Создать клан</button>
            </div>
        </div>

        <!-- Чат клана -->
        <div class="screen" id="clan-chat-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="clan">← Назад</button>
                <h2>💬 Чат клана</h2>
            </div>
            <div class="screen-content">
                <div class="clan-chat-messages" id="clan-chat-messages"></div>
                <div class="clan-chat-input">
                    <input type="text" id="clan-message-input" placeholder="Сообщение...">
                    <button class="btn" id="clan-send-btn">Отправить</button>
                </div>
            </div>
        </div>

        <!-- Магазин (Stars) -->
        <div class="screen" id="shop-screen">
            <div class="screen-header">
                <h2>🏪 Магазин</h2>
            </div>
            <div class="screen-content">
                <div class="shop-tabs">
                    <button class="shop-tab active" data-tab="buffs">💪 Баффы</button>
                    <button class="shop-tab" data-tab="minigames">🎮 Мини-игры</button>
                    <button class="shop-tab" data-tab="cosmetics">✨ Косметика</button>
                </div>
                <div class="shop-items" id="shop-items"></div>
            </div>
        </div>

        <!-- Магазин за монеты -->
        <div class="screen" id="market-screen">
            <div class="screen-header">
                // Заголовок совпадает с кнопкой на главном экране. Раньше экран за монеты
                // назывался «Магазин», как и экран за звёзды, — два разных
                // магазина с одинаковым названием.
                <h2>🛒 Рынок</h2>
                <span class="shop-coins-balance">🪙 <strong id="shop-coins-balance">0</strong></span>
            </div>
            <div class="screen-content">
                <div class="shop-categories">
                    <button class="shop-category-btn active" data-category="all">Все</button>
                    <button class="shop-category-btn" data-category="weapon">⚔️ Оружие</button>
                    <button class="shop-category-btn" data-category="armor">🛡️ Броня</button>
                    <button class="shop-category-btn" data-category="medicine">💊 Медицина</button>
                    <button class="shop-category-btn" data-category="food">🍞 Еда</button>
                </div>
                <div class="shop-items shop-items-list" id="shop-items-list"></div>
            </div>
        </div>

        <!-- Колесо удачи -->
        <div class="screen" id="wheel-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="shop">← Назад</button>
                <h2>🎡 Колесо удачи</h2>
            </div>
            <div class="screen-content">
                <div class="wheel-container">
                    <div class="wheel" id="wheel">
                        <!-- Секторы и подписи рисует renderWheelSectors() из списка призов
                     с сервера: раньше здесь стояли шесть захардкоженных
                     подписей, которые разъезжались с реальными призами. -->
                <div class="wheel-prizes"></div>
                    </div>
                    <button class="btn" id="wheel-free-btn">🎡 Бесплатно</button>
                    <button class="btn" id="wheel-paid-btn">⭐ За 1 звезду</button>
                    <p id="wheel-free-info">Загрузка...</p>
                    <p id="wheel-paid-info">Платное вращение доступно всегда.</p>
                </div>
            </div>
        </div>

        <!-- Рейтинг -->
        <div class="screen" id="rating-screen">
            <div class="screen-header">
                <h2>🏆 Рейтинг</h2>
            </div>
            <div class="screen-content">
                <div class="rating-tabs">
                    <button class="rating-tab active" data-tab="players">👤 Игроки</button>
                    <button class="rating-tab" data-tab="clans">🏰 Кланы</button>
                </div>
                <div class="rating-list" id="rating-list"></div>
            </div>
        </div>

        <!-- PvP игроки -->
        <div class="screen" id="pvp-players-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="main">← Назад</button>
                <h2>⚔️ PvP</h2>
                <button class="btn small" id="pvp-stats-btn">📊 Статистика</button>
            </div>
            <div class="screen-content">
                <div class="pvp-zone-indicator" id="pvp-zone-indicator"></div>
                <div class="pvp-players-list" id="pvp-players-list"></div>
                <button class="btn" id="pvp-refresh-btn">🔄 Обновить</button>
            </div>
        </div>

        <!-- PvP бой -->
        <div class="screen" id="pvp-fight-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="pvp-players">← Назад</button>
                <h2>⚔️ PvP Бой</h2>
            </div>
            <div class="pvp-fight-container" id="pvp-fight-container">
                <div class="pvp-battle-arena">
                    <div class="pvp-combatant attacker">
                        <div class="pvp-combatant-name" id="pvp-attacker-name">Вы</div>
                        <div class="pvp-combatant-level" id="pvp-attacker-level">Уровень: 1</div>
                        <div class="pvp-health-bar">
                            <div class="pvp-health-fill" id="pvp-attacker-health" style="width:100%"></div>
                        </div>
                        <div class="pvp-health-text" id="pvp-attacker-health-text">0/0</div>
                    </div>
                    <div class="pvp-vs">⚔️</div>
                    <div class="pvp-combatant defender">
                        <div class="pvp-combatant-name" id="pvp-defender-name">Противник</div>
                        <div class="pvp-combatant-level" id="pvp-defender-level">Уровень: 1</div>
                        <div class="pvp-health-bar">
                            <div class="pvp-health-fill" id="pvp-defender-health" style="width:100%"></div>
                        </div>
                        <div class="pvp-health-text" id="pvp-defender-health-text">0/0</div>
                    </div>
                </div>
                <div class="pvp-battle-log" id="pvp-battle-log">
                    <p>⚔️ Приготовьтесь к бою!</p>
                </div>
                <div class="pvp-actions">
                    <button class="btn attack-btn" id="pvp-attack-btn">👊 АТАКОВАТЬ</button>
                </div>
                <div class="pvp-rewards" id="pvp-rewards" style="display:none">
                    <h3>Награды</h3>
                    <div id="pvp-rewards-content"></div>
                    <button class="btn" id="pvp-claim-rewards-btn">Забрать</button>
                </div>
            </div>
        </div>

        <!-- PvP статистика -->
        <div class="screen" id="pvp-stats-screen">
            <div class="screen-header">
                <button class="back-btn" data-screen="pvp-players">← Назад</button>
                <h2>📊 PvP Статистика</h2>
            </div>
            <div class="pvp-stats-content" id="pvp-stats-content">
                <div class="pvp-stats-grid">
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-rating-value">1000</span>
                        <span class="stat-label">Рейтинг</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-wins">0</span>
                        <span class="stat-label">Побед</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-losses">0</span>
                        <span class="stat-label">Поражений</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-streak">0</span>
                        <span class="stat-label">Текущая серия</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-max-streak">0</span>
                        <span class="stat-label">Лучшая серия</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-damage-dealt">0</span>
                        <span class="stat-label">Урона нанесено</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-damage-taken">0</span>
                        <span class="stat-label">Урона получено</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-coins-lost">0</span>
                        <span class="stat-label">Потеряно монет</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="pvp-items-lost">0</span>
                        <span class="stat-label">Потеряно предметов</span>
                    </div>
                </div>
                <div class="pvp-cooldown" id="pvp-cooldown" style="display:none">
                    <span>⏱️ Кулдаун: </span>
                    <span id="pvp-cooldown-timer">0:00</span>
                </div>
                <h3>Последние бои</h3>
                <div class="pvp-recent-matches-list" id="pvp-recent-matches-list"></div>
            </div>
        </div>

        <!-- Достижения -->
        <div class="screen" id="achievements-screen">
            <div class="screen-header">
                <h2>🏆 Достижения</h2>
            </div>
            <div class="screen-content">
                <div class="achievements-categories" id="achievements-categories"></div>
                <div class="achievements-list" id="achievements-list"></div>
            </div>
        </div>

        <!-- Рефералы -->
        <div class="screen" id="referral-screen">
            <div class="screen-header">
                <h2>📨 Рефералы</h2>
            </div>
            <div class="screen-content">
                <div class="referral-code-box" id="referral-code-box">
                    <div class="referral-code-section">
                        <h3>Твой реферальный код</h3>
                        <div class="referral-code-display">
                            <span id="referral-code">ЗАГРУЗКА...</span>
                            <button class="btn small" id="copy-referral-code">📋 Копировать</button>
                        </div>
                    </div>
                    <div class="referral-change-section" id="referral-change-section" style="display:none">
                        <h4>Изменить код</h4>
                        <input type="text" id="new-referral-code" placeholder="Новый код" maxlength="20">
                        <button class="btn small" id="change-referral-code-btn">Изменить</button>
                    </div>
                    <div class="referral-use-section">
                        <h4>Использовать код друга</h4>
                        <input type="text" id="use-referral-code" placeholder="Введи код друга">
                        <button class="btn small" id="use-referral-code-btn">Активировать</button>
                    </div>
                </div>
                <div class="referral-stats" id="referral-stats">
                    <div class="stat-card">
                        <span class="stat-value" id="total-referrals">0</span>
                        <span class="stat-label">Рефералов</span>
                    </div>
                    <div class="stat-card">
                        <span class="stat-value" id="total-coins-earned">0</span>
                        <span class="stat-label">Монет заработано</span>
                    </div>
                    <!-- Карточка «Stars заработано» удалена: Stars за рефералов
                         не начисляются (см. player.js, GET /referral/stats),
                         и карточка обещала награду, которой нет. -->
                </div>
                <div class="referral-list" id="referrals-list"></div>
            </div>
        </div>
    `;

    // Добавляем модальное окно и уведомления после экранов
    const modalsHtml = `
        <!-- Модальное окно -->
        <div class="modal" id="modal" style="display:none">
            <div class="modal-content">
                <span class="modal-close" id="modal-close">&times;</span>
                <h3 id="modal-title">Заголовок</h3>
                <p id="modal-message">Сообщение</p>
            </div>
        </div>
    `;

    gameContent.insertAdjacentHTML('beforeend', screensHtml + modalsHtml);
}

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
    // Инициализируем обработчики табов магазина, если ещё не инициализированы
    if (typeof initShopHandlers === 'function') {
        initShopHandlers();
    }
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
            <div class="shop-item" data-item-id="${escapeAttribute(item.id)}" data-category="${escapeAttribute(category)}">
                <div class="shop-item-icon">${escapeHtml(item.icon)}</div>
                <div class="shop-item-info">
                    <div class="shop-item-name">${escapeHtml(item.name)}</div>
                    <div class="shop-item-desc">${escapeHtml(item.desc)}</div>
                </div>
                <div class="shop-item-price">${escapeHtml(priceText)}</div>
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
    
    // Блокировка от двойного клика: покупка за Stars/монеты тратит валюту.
    // Без неё два быстрых тапа списывали валюту дважды (или покупали два баффа)
    if (!lockAction('purchase')) return;

    const buyButtons = document.querySelectorAll('.shop-buy-btn:not([disabled])');
    buyButtons.forEach((button) => { button.disabled = true; });

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
            // Сбрасываем кэш, т.к. инвентарь изменился
            RenderCache.clear();
            
            // Обновляем валюту из правильных полей ответа
            if (result.new_stars !== undefined) {
                player.stars = Number(result.new_stars);
            }
            if (result.new_coins !== undefined) {
                player.coins = Number(result.new_coins);
            }
            if (result.balance !== undefined) {
                player.balance = Number(result.balance);
            }

            // showModal() выводит message через textContent, поэтому экранировать
            // здесь НЕЛЬЗЯ: игрок увидел бы буквальные «&amp;» вместо символа.
            showModal('✅ Успешно!', `Куплено: ${item.name}`);
            showConfetti();

            // Бафф применяем ТОЛЬКО из ответа сервера (reward.effect +
            // reward.expires_at приходят из minigames.js). Раньше здесь был
            // applyBuff(item) по локальным данным SHOP_ITEMS — интерфейс мог
            // показать бафф, которого на сервере фактически нет.
            const reward = result.purchased_item?.reward;
            if (reward?.type === 'buff' && reward.effect) {
                applyBuff({ effect: reward.effect, expires_at: reward.expires_at });
                showNotification('⚡ Бафф активирован!', 'success');
            }

            loadProfile().catch(error => console.error('Не удалось обновить профиль после покупки:', error));
        } else {
            showModal('❌ Ошибка', result.error || result.message || 'Не удалось совершить покупку');
        }
    } catch (error) {
        showModal('❌ Ошибка', 'Не удалось совершить покупку');
    } finally {
        unlockAction('purchase');
        document.querySelectorAll('.shop-buy-btn').forEach((button) => {
            if (button.dataset.permanentlyDisabled !== 'true') button.disabled = false;
        });
        // Перерисовываем список — кнопки получат корректные disabled-состояния
        if (typeof renderShopCategory === 'function' && category) {
            renderShopCategory(category);
        }
    }
}

/**
 * Применение баффа
 * @param {Object} buff - данные баффа
 */
function applyBuff(buff) {
    // ВАЖНО: источник истины — сервер. Здесь принимаются ТОЛЬКО данные,
    // пришедшие с сервера (effect + expires_at). Раньше длительность бралась
    // из локального SHOP_ITEMS, и интерфейс мог показать бафф, которого
    // на сервере фактически нет (или с другой длительностью).
    gameState.buffs = gameState.buffs || {};

    const effect = buff?.effect;
    if (!effect) {
        console.warn('[applyBuff] Ответ сервера не содержит effect — бафф не применён');
        return;
    }

    const expiresAt = buff.expires_at
        ? new Date(buff.expires_at).getTime()
        : Date.now() + (Number(buff.duration) || 0) * 1000;

    if (!Number.isFinite(expiresAt)) {
        console.warn('[applyBuff] Некорректный expires_at — бафф не применён');
        return;
    }

    gameState.buffs[effect] = {
        expires: expiresAt,
        expires_at: new Date(expiresAt).toISOString()
    };

    renderActiveBuffs?.(gameState.buffs);
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

/**
 * Призы колеса по умолчанию — только для первого рендера и оффлайн-фоллбэка.
 *
 * Источник истины — сервер: GET /game/wheel возвращает поле `prizes`,
 * и loadWheelInfo() перезаписывает эту переменную. Раньше клиент держал
 * свою копию списка, и если сервер менял набор призов, анимация
 * подсвечивала не тот сектор.
 */
const WHEEL_PRIZES = [
    { type: 'coins', value: 10, text: '10 монет' },
    { type: 'coins', value: 25, text: '25 монет' },
    { type: 'coins', value: 50, text: '50 монет' },
    { type: 'coins', value: 100, text: '100 монет' },
    { type: 'multiplier', value: 2, text: 'x2 к монетам' },
    { type: 'energy', value: 20, text: '20 энергии' },
];

/** Актуальный список призов: перезаписывается ответом сервера. */
let wheelPrizes = WHEEL_PRIZES;

/**
 * Отрисовка секторов колеса по списку призов с сервера.
 *
 * Раньше и градиент секторов (conic-gradient с шестью фиксированными
 * границами), и подписи (шесть правил :nth-child) были захардкожены под
 * ровно шесть призов. Стоило серверу вернуть другой набор — и подписи
 * разъезжались с секторами, а анимация подсвечивала не то. Теперь и цвет,
 * и угол считаются из актуального списка.
 *
 * @param {string[]} [palette] цвета секторов
 */
function renderWheelSectors(palette) {
    const wheel = document.getElementById('wheel');
    const wrap = wheel?.querySelector('.wheel-prizes');
    if (!wheel || !wrap) return;

    const prizes = Array.isArray(wheelPrizes) && wheelPrizes.length ? wheelPrizes : WHEEL_PRIZES;
    const count = prizes.length;
    const segment = 360 / count;

    const colors = palette || [
        '#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#c0392b'
    ];
    const stops = prizes
        .map((_, index) => `${colors[index % colors.length]} ${index * segment}deg ${(index + 1) * segment}deg`)
        .join(', ');
    wheel.style.background = `conic-gradient(${stops})`;

    // Радиус считаем от реального размера колеса: колесо адаптивное, и
    // фиксированное смещение в CSS переставало попадать на обод.
    const size = wheel.clientWidth || 260;
    const radius = Math.max(36, Math.round(size * 0.35));

    wrap.innerHTML = prizes.map((prize, index) => {
        const angle = -90 + segment * (index + 0.5);
        // Контр-поворот (-angle) держит текст горизонтальным.
        return `<span class="prize" style="transform: translate(-50%, -50%) rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)">${escapeHtml(prize.text || '')}</span>`;
    }).join('');
}

/**
 * Открытие колеса удачи.
 * Данные подгружает onScreenOpen('wheel') — здесь только переход.
 */
function openWheel() {
    showScreen('wheel');
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

        // Призы берём с сервера: он уже отдаёт их в GET /wheel.
        // Так сектор анимации всегда совпадает с реально выпавшим призом,
        // даже если набор призов изменится на сервере.
        if (Array.isArray(payload.prizes) && payload.prizes.length > 0) {
            wheelPrizes = payload.prizes.map((p) => ({
                type: p.type,
                value: p.value,
                text: p.text
            }));
        }
        renderWheelSectors();

        if (freeBtn) {
            freeBtn.disabled = !canSpinFree;
            freeBtn.textContent = canSpinFree
                ? '🎡 Бесплатно'
                : `⏳ ${formatMinutesRemaining(nextFreeSpin)}`;
        }

        if (paidBtn) {
            const stars = Number(gameState.player?.stars || 0);
            paidBtn.disabled = stars < 1;
            // Раньше здесь было «За 1 Star»: JS перезаписывал подпись в шаблоне
            // при каждом открытии колеса и возвращал английский текст.
            paidBtn.textContent = stars < 1 ? '⭐ Нужна 1 звезда' : '⭐ За 1 звезду';
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
    // Блокировка ДО отправки запроса: раньше кнопка блокировалась только
    // внутри spinWheelAnimation (после ответа), поэтому несколько быстрых
    // тапов успевали отправить несколько POST /wheel/spin.
    if (!lockAction('wheelSpin')) return;

    const freeBtn = document.getElementById('wheel-free-btn');
    const paidBtn = document.getElementById('wheel-paid-btn');
    if (freeBtn) freeBtn.disabled = true;
    if (paidBtn) paidBtn.disabled = true;

    try {
        const response = await gameApi.post('/game/wheel/spin', { is_paid: false });
        
        if (!response.success) {
            if (response.code === 'COOLDOWN' && response.next_free_spin) {
                const minutes = Math.ceil(response.next_free_spin / 60000);
                showModal('⏳ Подождите', `Следующее бесплатное вращение через ${minutes} мин.`, 'info');
            } else {
                showModal('❌ Ошибка', response.error || 'Не удалось крутить колесо', 'error');
            }
            // Анимации не будет — снимаем блокировку сразу
            unlockAction('wheelSpin');
            loadWheelInfo().catch(() => {});
            return;
        }
        
        // Успех: блокировку снимает spinWheelAnimation после конца анимации
        spinWheelAnimation(response.data.prize, false);
        
    } catch (error) {
        console.error('Ошибка вращения колеса:', error);
        showModal('❌ Ошибка', 'Не удалось связаться с сервером', 'error');
        unlockAction('wheelSpin');
        loadWheelInfo().catch(() => {});
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
    
    // Критично для платного вращения: каждый клик списывает звезду,
    // поэтому запрос обязан уйти ровно один раз
    if (!lockAction('wheelSpin')) return;

    const freeBtn = document.getElementById('wheel-free-btn');
    const paidBtn = document.getElementById('wheel-paid-btn');
    if (freeBtn) freeBtn.disabled = true;
    if (paidBtn) paidBtn.disabled = true;
    
    try {
        const response = await gameApi.post('/game/wheel/spin', { is_paid: true });
        
        if (!response.success) {
            showModal('❌ Ошибка', response.error || 'Не удалось крутить колесо', 'error');
            unlockAction('wheelSpin');
            loadWheelInfo().catch(() => {});
            return;
        }
        
        // Успех: блокировку снимает spinWheelAnimation после конца анимации
        spinWheelAnimation(response.data.prize, true);
        
    } catch (error) {
        console.error('Ошибка вращения колеса:', error);
        showModal('❌ Ошибка', 'Не удалось связаться с сервером', 'error');
        unlockAction('wheelSpin');
        loadWheelInfo().catch(() => {});
    }
}

/**
 * Анимация колеса
 *
 * Снимает блокировку wheelSpin в конце: пока идёт анимация (3 с) и
 * обновление состояния, повторное вращение невозможно — раньше блокировка
 * снималась сразу по ответу сервера, и игрок мог запустить второе вращение
 * ещё до конца анимации первого.
 *
 * @param {object} prize - приз от сервера
 * @param {boolean} isPaid - платное вращение
 */
function spinWheelAnimation(prize, isPaid) {
    const wheel = document.getElementById('wheel');
    const freeBtn = document.getElementById('wheel-free-btn');
    const paidBtn = document.getElementById('wheel-paid-btn');
    if (!wheel) {
        unlockAction('wheelSpin');
        return;
    }

    if (freeBtn) freeBtn.disabled = true;
    if (paidBtn) paidBtn.disabled = true;
    
    // Анимация.
    // Сектор ищем в актуальном списке призов (обновляется ответом сервера),
    // поэтому подсветка совпадает с реально выпавшим призом.
    // Если приз всё же не найден, показываем первый сектор и предупреждаем
    // в консоль — награда всё равно выдана по серверному ответу.
    const prizes = Array.isArray(wheelPrizes) && wheelPrizes.length ? wheelPrizes : WHEEL_PRIZES;
    const rotations = 5 + Math.random() * 5;
    const prizeIndex = prizes.findIndex(p => p.type === prize?.type && p.value === prize?.value);
    if (prizeIndex < 0) {
        console.warn('[spinWheelAnimation] Приз с сервера не найден в списке призов:', prize);
    }
    const finalAngle = rotations * 360 + (360 / prizes.length) * (prizeIndex >= 0 ? prizeIndex : 0);
    
    wheel.style.transition = 'transform 3s ease-out';
    wheel.style.transform = `rotate(${finalAngle}deg)`;
    
    setTimeout(() => {
        // Выдача приза
        if (prize?.type === 'coins') {
            // prize.text идёт в showModal, который выводит его через textContent,
            // поэтому escapeHtml здесь показал бы буквальные «&amp;»
            showModal('🎉 Выигрыш!', `Выпало: ${prize.text}`, 'success');
        } else if (prize?.type === 'multiplier') {
            showModal('🎉 Удвоение!', `Множитель x${Number(prize.value) || 0}!`, 'success');
        } else if (prize?.type === 'energy') {
            showModal('⚡ Энергия!', `+${Number(prize.value) || 0} энергии!`, 'success');
        }
        
        showConfetti(80);
        
        // Обновляем данные игрока после вращения.
        // Энергия/монеты/звёзды изменились на сервере — профиль перечитываем.
        loadProfile().catch(e => console.error('Failed to update player:', e));
        
        // Сброс колеса
        setTimeout(() => {
            wheel.style.transition = 'none';
            wheel.style.transform = 'rotate(0deg)';
        }, 2000);
        
        // Блокировку снимаем в самом конце цикла: loadWheelInfo() сам
        // пересчитает доступность кнопок (кулдаун, звезды)
        loadWheelInfo()
            .catch(e => console.error('Не удалось обновить состояние колеса:', e))
            .finally(() => unlockAction('wheelSpin'));
        
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
            container.innerHTML = '<div class="empty-message">Ошибка загрузки товаров</div>';
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
        const escapedRarity = escapeHtml(item.rarity || 'common');
        const escapedIcon = escapeHtml(item.icon || '📦');
        const safeItemId = parseInt(item.id) || 0;
        const prepTag = item.stats?.radiation_cure || item.stats?.infection_cure || item.stats?.radiation_resist || item.stats?.infection_resist
            ? '<div class="shop-item-role">Подготовка к опасной зоне</div>'
            : '';
        return `
            <div class="shop-item-card ${escapedRarity}" data-item-id="${safeItemId}">
                <div class="shop-item-icon">${escapedIcon}</div>
                <div class="shop-item-info">
                    <div class="shop-item-name">${escapeHtml(item.name)}</div>
                    <div class="shop-item-desc">${escapeHtml(item.description || '')}</div>
                    ${prepTag}
                    <div class="shop-item-stats">
                        ${renderItemStats(item.stats)}
                    </div>
                </div>
                <div class="shop-item-buy">
                    <div class="shop-item-price">
                        ${item.price > 0 ? `💰 ${formatNumber(item.price)}` : ''}
                        ${item.stars_price > 0 ? `<div class="shop-item-stars">⭐ ${formatNumber(item.stars_price)}</div>` : ''}
                    </div>
                    ${item.price > 0 ? `<button class="buy-btn" data-buy-coin-item="${safeItemId}">Купить</button>` : ''}
                    ${item.stars_price > 0 ? `<button class="buy-btn buy-btn-stars" data-buy-star-item="${safeItemId}">За звёзды</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Обработчики категорий.
    // bindClickOnce идемпотентен: раньше здесь каждый вызов renderCoinShop()
    // добавлял новый addEventListener на те же кнопки, и после нескольких
    // открытий магазина один клик вызывал renderCoinShop() десятки раз.
    document.querySelectorAll('.shop-category-btn').forEach(btn => {
        bindClickOnce(btn, `shopCategory_${btn.dataset.category || 'unknown'}`, () => {
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
    if (stats.damage) statLines.push(`⚔️ Урон: +${Number(stats.damage)}`);
    if (stats.defense) statLines.push(`🛡️ Защита: +${Number(stats.defense)}`);
    if (stats.health) statLines.push(`❤️ Здоровье: +${Number(stats.health)}`);
    if (stats.energy) statLines.push(`⚡ Энергия: +${Number(stats.energy)}`);
    if (stats.radiation_cure) statLines.push(`☢️ Лечение радиации: ${Number(stats.radiation_cure)}`);
    if (stats.infection_cure) statLines.push(`🦠 Лечение инфекции: ${Number(stats.infection_cure)}`);
    if (stats.radiation_resist) statLines.push(`🛡️ Защита от радиации: ${Number(stats.radiation_resist)}`);
    if (stats.infection_resist) statLines.push(`🧪 Защита от инфекции: ${Number(stats.infection_resist)}`);
    return statLines.join('<br>');
}

/**
 * Купить предмет за звёзды.
 *
 * Раньше колонка items.stars_price показывалась в магазине, но купить по ней
 * было нельзя: обработчик знал только про монеты.
 */
async function buyStarItem(itemId, triggerButton = null) {
    const item = coinShopItems.find(i => i.id === itemId);
    if (!item) return;

    const price = Number(item.stars_price || 0);
    const playerStars = Number(gameState.player?.stars || 0);

    if (playerStars < price) {
        showModal('❌ Недостаточно звёзд', `Нужно ${formatNumber(price)} ⭐, у вас ${formatNumber(playerStars)}`);
        return;
    }

    if (!confirm(`Купить ${item.name} за ${formatNumber(price)} звёзд?`)) {
        return;
    }

    // Списание звёзд: блокировка от двойного клика обязательна.
    if (!lockAction('buyStarItem')) return;

    const button = triggerButton instanceof Element
        ? triggerButton
        : document.querySelector(`[data-buy-star-item="${itemId}"]`);
    if (button) button.disabled = true;

    try {
        const response = await gameApi.post('/game/items/buy-stars', { item_id: itemId, quantity: 1 });
        const payload = response?.data || response;

        if (response?.success) {
            showNotification(`⭐ ${payload.message || 'Куплено за звёзды'}`, 'success');
            playSound('coin');

            if (typeof gameState.player === 'object') {
                gameState.player.stars = Number(payload.stars_total ?? (playerStars - price));
            }

            RenderCache.clear();
            await loadCoinShop();
            await loadInventory();
        } else {
            showNotification(response?.error || 'Не удалось купить за звёзды', 'error');
        }
    } catch (error) {
        console.error('Buy with stars error:', error);
        showNotification(error?.message || 'Не удалось купить за звёзды', 'error');
    } finally {
        if (button) button.disabled = false;
        unlockAction('buyStarItem');
    }
}

async function buyCoinItem(itemId, triggerButton = null) {
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
    
    // Блокировка от двойного клика: покупка тратит монеты, и два быстрых
    // тапа отправляли бы два POST /items/buy (клиентская проверка баланса
    // успевала пройти оба раза до ответа сервера).
    if (!lockAction('buyCoinItem')) return;

    // Блокируем ТОЛЬКО нажатую кнопку. Раньше отключались все кнопки
    // покупки, и если список перерисовывался, восстановление зависело от
    // того, какие элементы ещё остались в DOM.
    const button = triggerButton instanceof Element
        ? triggerButton
        : document.querySelector(`[data-buy-coin-item="${itemId}"]`);
    if (button) button.disabled = true;
    
    try {
        const response = await gameApi.post('/game/items/buy', { 
            item_id: itemId,
            currency: 'coins'
        });
        
        if (response.success) {
            // textContent не интерпретирует HTML, поэтому escapeHtml здесь дал бы
            // игроку буквальные сущности вида &amp; вместо символа
            showModal('✅ Успешно', `Вы купили ${item.name}!`);
            
            // Сбрасываем кэш, т.к. инвентарь изменился
            RenderCache.clear();
            
            // Обновляем баланс
            if (gameState.player) {
                gameState.player.coins = Number(response.coins_remaining ?? ((gameState.player.coins || 0) - price));
                const balanceEl = document.getElementById('shop-coins-balance');
                if (balanceEl) {
                    balanceEl.textContent = formatNumber(gameState.player.coins);
                }
            }
            
            // Перезагружаем инвентарь и профиль: предмет уже в инвентаре,
            // а монеты на сервере изменились
            loadInventory().catch(error => 
                console.error('Не удалось обновить инвентарь после покупки за монеты:', error));
            loadProfile().catch(error => 
                console.error('Не удалось обновить профиль после покупки за монеты:', error));
        } else {
            showModal('❌ Ошибка', response.error || 'Не удалось купить предмет');
        }
    } catch (error) {
        console.error('Ошибка покупки:', error);
        showModal('❌ Ошибка', 'Не удалось купить предмет');
    } finally {
        unlockAction('buyCoinItem');
        // Восстанавливаем ТОЛЬКО свою кнопку. Если её уже заменили
        // (перерисовка списка), трогать нечего — renderCoinShop()
        // создаст новые кнопки в корректном состоянии.
        if (button?.isConnected) button.disabled = false;
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
 * Общие данные канвы карты: контекст, размеры и список локаций.
 * renderLocations() и redrawMap() нуждались в одинаковой прологовой
 * части, которая раньше была скопирована в обе.
 */
function readMapCanvas(canvas) {
    return {
        ctx: canvas.getContext('2d'),
        width: canvas.width,
        height: canvas.height,
        locations: gameState.locations || []
    };
}

/**
 * Рисует карту целиком: фон, дороги, локации.
 *
 * Единственная реализация отрисовки. Раньше renderLocations() и
 * redrawMap() каждая содержали свою копию (ctx/clearRect/фон/позиции/
 * дороги/локации) — правка, например, нового слоя карты попадала
 * только в одну из них, и карта выглядела по-разному при первом рендере
 * и при наведении мыши.
 *
 * @param {Object|null} hoveredLoc - локация под курсором (для подсветки)
 */
function paintCityMap(hoveredLoc) {
    const canvas = document.getElementById('city-map');
    if (!canvas) return;

    const { ctx, width, height, locations } = readMapCanvas(canvas);

    ctx.clearRect(0, 0, width, height);
    drawCityBackground(ctx, width, height);

    const positions = calculateLocationPositions(locations.length, width, height);
    drawRoads(ctx, positions);

    locations.forEach((loc, index) => {
        const pos = positions[index];
        const isHovered = Boolean(hoveredLoc && hoveredLoc.id === loc.id);
        drawLocation(ctx, loc, pos, isHovered);
    });
}

/**
 * Отрисовка локаций на Canvas карте
 */
function renderLocations() {
    const canvas = document.getElementById('city-map');
    if (!canvas) return;

    const { width, height, locations } = readMapCanvas(canvas);

    // Сохраняем позиции для кликов
    gameState.locationPositions = {};
    const positions = calculateLocationPositions(locations.length, width, height);
    locations.forEach((loc, index) => {
        const pos = positions[index];
        gameState.locationPositions[loc.id] = { x: pos.x, y: pos.y, radius: 30 };
    });

    paintCityMap(null);

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
                // Тап по локации теперь ВЫБИРАЕТ её и показывает детали,
                // а не переводит сразу. Причина: игра идёт в мобильном
                // Telegram WebView, где наведения мыши нет — игрок тапал по
                // зоне и уезжал в неё, не увидев ни радиации, ни инфекции,
                // ни риска. Переход — явной кнопкой.
                selectMapLocation(loc);
                return;
            }
        }
    };
    
    // Обработчик движения мыши (подсветка)
    //
    // Две оптимизации против «карта сама ездит под курсором»:
    // 1) DOM обновляется только при СМЕНЕ локации под курсором;
    // 2) canvas перерисовывается не чаще одного раза на кадр (requestAnimationFrame),
    //    а не на каждое событие mousemove — раньше это были десятки полных
    //    отрисовок в секунду.
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

        const hoveredId = hoveredLoc ? Number(hoveredLoc.id) : 0;
        if (hoveredId !== hoveredMapLocationId) {
            hoveredMapLocationId = hoveredId;
            // Общая функция для наведения и тапа: раньше эти ветки расходились,
            // и палец на телефоне не показывал детали вообще.
            selectMapLocation(hoveredLoc);
            scheduleMapRepaint(hoveredLoc);
        }
    };

    canvas.onmouseleave = () => {
        const infoEl = document.getElementById('map-location-info');
        if (infoEl) infoEl.style.display = 'none';
        const travelBtn = document.getElementById('map-travel-btn');
        if (travelBtn) {
            travelBtn.style.display = 'none';
            delete travelBtn.dataset.locationId;
        }
        const nameEl = document.querySelector('.map-location-name');
        if (nameEl) nameEl.textContent = 'Выберите локацию';

        hoveredMapLocationId = 0;
        lastSelectedMapLocationId = 0;
        scheduleMapRepaint(null);
    };
}

/**
 * Перерисовка карты не чаще одного раза на кадр.
 *
 * @param {object|null} hoveredLoc локация под курсором
 */
function scheduleMapRepaint(hoveredLoc) {
    if (mapRepaintPending) return;
    mapRepaintPending = true;

    const paint = () => {
        mapRepaintPending = false;
        paintCityMap(hoveredLoc || null);
    };

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(paint);
    } else {
        setTimeout(paint, 16);
    }
}

/**
 * Перерисовка карты с подсветкой.
 * Отрисовка живёт в paintCityMap(), здесь только передаём подсветку.
 * @param {Object} hoveredLoc - локация под курсором
 */
function redrawMap(hoveredLoc) {
    paintCityMap(hoveredLoc || null);
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
    // Инициализируем или переинициализируем позиции при изменении размера
    if (!window.cityBackgroundStars || !window.cityBackgroundWidth || window.cityBackgroundWidth !== width || window.cityBackgroundHeight !== height) {
        window.cityBackgroundStars = [];
        for (let i = 0; i < 50; i++) {
            window.cityBackgroundStars.push({
                x: Math.random() * width,
                y: Math.random() * height * 0.4,
                size: Math.random() * 1.5
            });
        }
        window.cityBackgroundWidth = width;
        window.cityBackgroundHeight = height;
    }
    if (!window.cityBackgroundBuildings || !window.cityBackgroundWidth || window.cityBackgroundWidth !== width || window.cityBackgroundHeight !== height) {
        window.cityBackgroundBuildings = [];
        for (let i = 0; i < 15; i++) {
            window.cityBackgroundBuildings.push({
                x: Math.random() * width,
                w: 20 + Math.random() * 40,
                h: 50 + Math.random() * 150
            });
        }
        window.cityBackgroundWidth = width;
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

    // Сбрасываем класс типа (openModalElement добавит .active)
    modal.className = 'modal';
    if (type === 'success') modal.classList.add('modal-success');
    else if (type === 'error') modal.classList.add('modal-error');
    else modal.classList.add('modal-info');

    openModalElement(modal);
}

/**
 * Скрыть модальное окно
 *
 * Анимация закрытия идёт 200 мс, и раньше отложенный колбэк безусловно
 * делал display='none'. Если за эти 200 мс открывали НОВОЕ окно (частый
 * случай: showModal сразу после hideModal), старое закрывало новое.
 * Поэтому каждое открытие увеличивает счётчик modalState.openGeneration,
 * и таймер закрытия работает только если счётчик не изменился.
 */
function hideModal() {
    const modal = document.getElementById('modal');
    const modalClose = document.getElementById('modal-close');
    
    if (!modal) return;
    
    // Запоминаем поколение на момент закрытия
    const generation = modalState.openGeneration;
    
    // Очищаем обработчики при закрытии
    if (modalClose) modalClose.onclick = null;
    modal.onclick = null;
    modal.style.animation = 'fadeOut 0.2s ease-out';
    
    if (modalState.closeTimer) clearTimeout(modalState.closeTimer);
    modalState.closeTimer = setTimeout(() => {
        modalState.closeTimer = null;
        // Пока открывали другое окно — не трогаем текущее
        if (generation !== modalState.openGeneration) return;
        modal.style.display = 'none';
        modal.classList.remove('active');
        modal.style.animation = '';
    }, 200);
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
    
    const iconEl = document.createElement('div');
    iconEl.className = 'loot-icon';
    iconEl.textContent = item.icon || '📦';
    lootEl.appendChild(iconEl);
    
    const nameEl = document.createElement('div');
    nameEl.className = 'loot-name';
    nameEl.textContent = item.name || 'Предмет';
    lootEl.appendChild(nameEl);

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
    // #app в разметке нет (корневой контейнер — #game-content),
    // поэтому падаем на body, как и showLootAnimation.
    const app = document.getElementById('app') || document.body;
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
        case 'coin':
            // короткий двойной импульс — «монеты»
            navigator.vibrate([25, 40, 25]);
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
 * @param {number|Object} newCoins - число монет или объект {coins, stars}
 */
function updateBalanceDisplay(newCoins) {
    if (newCoins && typeof newCoins === 'object') {
        const coins = Number(newCoins.coins ?? 0);
        const stars = Number(newCoins.stars ?? 0);

        // Обновляем монеты (без рекурсии - напрямую)
        const balanceElements = document.querySelectorAll('.balance-value, #user-balance, .coins-display, #main-coins-value, #inv-coins, #coins-value');
        balanceElements.forEach(el => {
            if (el) el.textContent = formatNumber(coins);
        });

        // Обновляем звёзды
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

    if (newCoins !== undefined && newCoins !== null) {
        const balanceElements = document.querySelectorAll('.balance-value, #user-balance, .coins-display, #main-coins-value, #inv-coins, #coins-value');
        balanceElements.forEach(el => {
            if (el) el.textContent = formatNumber(Number(newCoins));
        });
        if (gameState?.player) gameState.player.coins = Number(newCoins);
    }
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
window.generateScreens = generateScreens;
