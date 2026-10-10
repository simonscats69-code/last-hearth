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
 *
 * Дополнительная страховка: даже если сервер по ошибке пришлёт `true`,
 * на нелокальном домене фоллбэк выключен. Локальными считаем localhost,
 * 127.0.0.1, [::1], *.local, пустой hostname и file:// (открытие файла
 * напрямую при разработке).
 */
const DEV_FALLBACK_ENABLED = (() => {
    if (window.__DEV_MODE__ !== true) return false;

    const hostname = (typeof location !== 'undefined' && location.hostname) || '';
    const protocol = (typeof location !== 'undefined' && location.protocol) || '';

    const isLocalHost = hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '[::1]'
        || hostname === ''
        || hostname.endsWith('.local');
    const isFileProtocol = protocol === 'file:';

    if (!isLocalHost && !isFileProtocol) {
        console.error(
            '[DEV_FALLBACK_ENABLED] Сервер прислал __DEV_MODE__=true на домене "' +
            hostname + '". Фоллбэк-авторизация отключена: это похоже на ' +
            'утечку dev-настроек в production.'
        );
        return false;
    }
    return true;
})();

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
        if (id != null) {
            console.log('[getTelegramId] Got ID from SDK:', id);
            return String(id);
        }
    }

    // SDK недоступен — пробуем подписанные данные из fragment прямой ссылки
    const initData = getInitDataFromHash();
    if (initData) {
        try {
            const user = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
            if (user?.id != null) {
                console.log('[getTelegramId] Got ID from hash:', user.id);
                return String(user.id);
            }
        } catch (e) {
            // повреждённый fragment — падаем в fallback ниже
        }
    }

    // Production: подтвердить пользователя не удалось — возвращаем null.
    // Раньше здесь был жёсткий '123456789': приложение продолжало работать
    // без валидного initData, то есть фактически без авторизации.
    if (DEV_FALLBACK_ENABLED) {
        // Fallback для разработки — только при явном DEV-флаге с сервера
        const fallbackId = localStorage.getItem('telegram_id') || '123456789';
        console.log('[getTelegramId] Using DEV fallback:', fallbackId);
        return fallbackId;
    }

    console.warn('[getTelegramId] No Telegram ID available');
    return null;
}


/**
 * Определение тёмной темы
 * @param {string} hexColor - Hex код цвета
 * @returns {boolean}
 */
function isColorDark(hexColor) {
    if (typeof hexColor !== 'string' || !hexColor) return false;

    // Срезаем '#'. substr заменён на slice — устаревшее API.
    const hex = hexColor.replace('#', '').trim();

    // Поддерживаем и короткую форму #abc, и полную #aabbcc: короткую раньше
    // не разбирали вовсе, и parseInt('ab', 16) давал NaN -> isDark всегда false.
    let r, g, b;
    if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
    } else {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
    }

    // Не HEX, обрезанная или пустая строка — считаем светлым (безопаснее
    // для читаемости: тёмный текст на тёмном фоне нечитаем).
    if ([r, g, b].some(Number.isNaN)) return false;

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
    // null/undefined -> '' (пусто), всё остальное приводим к строке.
    // Числа здесь — обычное дело: id, level, members_count, HP приходят
    // из БД как числа. typeof-guard прошлой версии превращал их в ''
    // и ломал обработчики: escapeHtml(clan.id) давал data-clan-id="",
    // joinClan(parseInt('')) возвращал NaN.
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
 * @param {number} num - Число (может быть нецелым и отрицательным — долги/штрафы)
 * @returns {string}
 */
function formatNumber(num) {
    if (typeof num !== 'number' || !Number.isFinite(num)) {
        return '0';
    }

    // Раньше знак 'минус' входил в разбор регексаром разделителями:
    // для -1000 он давал "- 1000" (или не разделял вовсе), а для дробей
    // вроде 1000.5 — "1 000.5". Обрабатываем знак и дробную часть явно.
    const sign = num < 0 ? '-' : '';
    const normalized = Math.abs(num);

    const [intPart, fracPart] = normalized.toString().split('.');
    const withSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

    return sign + withSpaces + (fracPart ? '.' + fracPart : '');
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
 * Категория предмета ДЛЯ ФИЛЬТРОВ ИНВЕНТАРЯ.
 *
 * Раньше здесь была жёсткая привязка к диапазонам ID (1-5 еда, 6-10 медицина,
 * 11-16 оружие...). Это ловушка: при добавлении предмета с id=30 он молча
 * попадал в 'unknown' и исчезал из инвентаря.
 *
 * Вторая ошибка была противоположной: функция возвращала items.category
 * ('melee', 'body', 'consumable', 'ammo'), а кнопки фильтра подписаны
 * типами — ⚔️ weapon, 🍞 food, 💊 medicine, 🛡️ armor, 📦 resource.
 * Сверка по category не срабатывала ни для одного фильтра, кроме лекарств.
 *
 * Поэтому ориентируемся на items.type — он и есть то, что стоит на кнопках,
 * — а category оставляем запасным вариантом.
 *
 * @param {object} item предмет инвентаря
 * @returns {string} категория в нижнем регистре
 */
function getItemCategory(item) {
    const type = String(item?.type || '').toLowerCase();
    if (type) return type;
    return String(item?.category || 'misc').toLowerCase();
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






// Функции, у которых нет внутренних вызовов, оставлены в глобальной
// области: это единственный способ вызвать их из консоли Telegram Mini App
// и из отладочных сценариев. Функции, вызываемые внутри файла, глобальными
// становятся сами (объявление function верхнего уровня) и экспорта не имеют.
// getInitData иниализируется вместе с Telegram WebApp (см. initGame)
window.isColorDark = isColorDark;
window.hapticImpact = hapticImpact;
window.hapticNotification = hapticNotification;
window.hapticSelection = hapticSelection;
window.formatPercent = formatPercent;
// showModal/hideModal/showScreen определены ниже, в секции анимаций боссов
// и управлении экранами соответственно.
// getRarityColor удалён: он нигде не вызывался, а его таблица цветов
// разошлась с CSS (там было epic: #9c27b0 против #cc7ddb, и
// common: #9e9e9e против #9a9080). Цвета редкости теперь берутся
// из CSS-токенов --rarity-*, поэтому перейти на inline-цвет нельзя:
// используются классы .rarity-common / .rarity-uncommon / .rarity-rare /
// .rarity-epic / .rarity-legendary.
window.getClanRoleEmoji = getClanRoleEmoji;
window.getRarityClassByLevel = getRarityClassByLevel;
window.getPlayerEmoji = getPlayerEmoji;
window.formatTime = formatTime;
window.sellItem = sellItem;
window.showBossFight = showBossFight;
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
    achievements: { endpoint: '/game/profile/achievements', method: 'GET' },
    
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
    
    // Рейдовые боссы
    clanBoss: { endpoint: '/game/bosses/raids', method: 'GET' },
    clanBossSpawn: { endpoint: '/game/bosses/raid/start', method: 'POST' }
};

// ============================================
// КЭШ ДАННЫХ
// ============================================
const apiCache = new Map();
const CACHE_TTL = 30000; // 30 секунд

/**
 * Верхняя граница числа записей в кэше.
 *
 * Без неё Map рос неограниченно: при долгой сессии с разными query-параметрами
 * (например /rating/clans?limit=20&offset=40) в памяти копилась каждая
 * уникальная выборка. Порядок вставок Map сохраняет, поэтому вытесняем
 * самую старую запись — дешёвый LRU без внешних библиотек.
 */
const MAX_CACHE_ENTRIES = 100;

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
    // Перезапись существующего ключа не должна «съедать» лишнюю запись:
    // удаляем, чтобы при повторном set запись ушла в конец порядка.
    apiCache.delete(key);
    apiCache.set(key, { data, timestamp: Date.now() });

    // Вытесняем самые старые записи, пока не влезем в лимит
    while (apiCache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = apiCache.keys().next().value;
        apiCache.delete(oldestKey);
    }
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

/**
 * Задержка перед повторной попыткой.
 *
 * Джиттер обязателен: без него при массовой ошибке (5xx, обрыв сети) все
 * клиенты режут интервал одинаково и бьют по серверу одним синхронным
 * лавинообразным потоком. Разброс ±1000 мс рассыпает пик по времени.
 *
 * @param {number} attempt номер попытки (0 — первая)
 * @returns {Promise<void>}
 */
function delay(attempt) {
    const base = 1000 * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return new Promise(r => setTimeout(r, base + jitter));
}

/**
 * Promise с таймаутом, который гарантированно очищает таймер.
 * Если передан signal, при таймауте он будет вызван abort(), чтобы отменить
 * связанные операции (fetch, чтение тела ответа).
 * @param {Promise} promise - промис для обертывания
 * @param {number} ms - таймаут в мс
 * @param {string} errorMessage - сообщение об ошибке при таймауте
 * @param {AbortSignal} [externalSignal] - внешний сигнал для связывания отмены
 * @returns {Promise}
 */
function withTimeout(promise, ms, errorMessage = 'Таймаут операции', externalSignal = null) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);

    // Если есть внешний сигнал — связываем его с нашим контроллером
    let removeExternalListener = null;
    if (externalSignal) {
        if (externalSignal.aborted) {
            controller.abort();
        } else {
            const onExternalAbort = () => controller.abort();
            externalSignal.addEventListener('abort', onExternalAbort, { once: true });
            removeExternalListener = () => externalSignal.removeEventListener('abort', onExternalAbort);
        }
    }

    const timeoutPromise = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => {
            reject(new Error(errorMessage));
        }, { once: true });
    });

    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => {
        clearTimeout(timeoutId);
        if (removeExternalListener) removeExternalListener();
    });
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
    if (fromTelegram) {
        console.log('[getInitData] Got initData from Telegram SDK');
        return fromTelegram;
    }

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
        // Используем недавнюю auth_date, чтобы сервер не отверг запрос
        // из-за слишком старого токена (MAX_INIT_DATA_AGE_SECONDS=3600)
        const recentAuthDate = Math.floor(Date.now() / 1000) - 60; // минута назад
        return `user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Test%22%2C%22username%22%3A%22testuser%22%7D&chat_instance=123&auth_date=${recentAuthDate}&hash=dummy`;
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
    const { silent = false, signal: externalSignal, idempotent = false, idempotencyKey = null, ...fetchOptions } = options;

    const method = String(fetchOptions.method || 'GET').toUpperCase();
    // Idempotency-Key проверяем без учёта регистра: заголовки HTTP нечувствительны к регистру
    let hasIdempotencyKey = Boolean(fetchOptions.headers &&
        Object.keys(fetchOptions.headers).some(k => k.toLowerCase() === 'idempotency-key'));
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    // Повторять мутацию можно только если сервер гарантирует идемпотентность
    const canRetry = !isMutation || idempotent || hasIdempotencyKey;
    const maxAttempts = canRetry ? retries : 0;

    // P1-8: если вызывающий попросил идемпотентность, а ключ не передал —
    // генерируем его здесь. Без ключа серверный idempotencyMiddleware
    // (который видит req.player только после validatePlayer) не сработает
    // и повтор мутации спишет ресурсы заново.
    // Ключ ОДИН на вызов: ретраи внутри apiRequest уйдут с тем же ключом.
    // Для защиты от двойного тапа используй idempotencyKey, переданный
    // снаружи (см. api.wheelSpin) — тогда оба тапа уносят один ключ.
    const effectiveIdempotencyKey = idempotencyKey
        || (idempotent && !hasIdempotencyKey
            ? `m-${method}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
            : null);
    if (effectiveIdempotencyKey) hasIdempotencyKey = true;

    const queryString = Object.keys(params).length > 0
        ? '?' + new URLSearchParams(params).toString()
        : '';
    const url = `${API_BASE}${normalizedEndpoint.startsWith('/') ? '' : '/'}${normalizedEndpoint}${queryString}`;

    console.log('[apiRequest]', method, url, 'retries:', retries, 'silent:', silent);

    // Получаем initData для авторизации
    const initData = getInitData();

    if (!initData && !DEV_FALLBACK_ENABLED) {
        // Без подписанных initData сервер всё равно отдаст 401. Лучше fail-fast:
        // не тратим 8 секунд таймаута и не показываем «Сервер не отвечает».
        const authError = new Error('Нет данных авторизации Telegram');
        authError.code = 'NO_INIT_DATA';
        throw authError;
    }

    // Защищённые заголовки, которые не должны перезаписываться вызывающим кодом.
    // Используем Headers для корректной работы с регистром: set() перезаписывает
    // заголовки независимо от регистра (content-type, Content-Type, CONTENT-TYPE).
    const headers = new Headers(fetchOptions.headers || {});
    headers.set('Content-Type', 'application/json');
    headers.set('x-init-data', initData || '');

    // P1-8: ключ идемпотентности уходит заголовком. Именно он позволяет
    // серверу распознать повтор того же действия и не выполнить его дважды.
    if (effectiveIdempotencyKey) {
        headers.set('Idempotency-Key', effectiveIdempotencyKey);
    }

    const config = {
        ...fetchOptions,
        headers
    };

    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        let loadingTimeout = null;

        // Позволяем переопределять таймаут через options.timeout (мс)
        const requestTimeout = fetchOptions.timeout ?? 8000;

        try {
            loadingTimeout = createLoadingTimeout(fetchOptions.showLoading);

            // Единый контроллер для таймаута и внешней отмены
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

            // Внешняя отмена (API.cancelRequest) связываем с нашим контроллером
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

            // Выполняем запрос с нашим сигналом
            const fetchPromise = (async () => {
                const response = await fetch(url, { ...config, signal: controller.signal });
                const contentType = response.headers.get('content-type') || '';
                const data = contentType.includes('application/json')
                    ? await response.json()
                    : null;
                return { response, data };
            })();

            let result;
            try {
                result = await fetchPromise;
            } finally {
                clearTimeout(timeoutId);
                if (removeExternalAbort) removeExternalAbort();
            }
            if (loadingTimeout) clearTimeout(loadingTimeout);

            const { response, data } = result;

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

            // Сбрасываем счётчик 503 при успешном ответе
            if (apiRequest._serviceStartingAttempts) {
                apiRequest._serviceStartingAttempts = 0;
            }

            console.log('[apiRequest] Success:', method, url);
            return data;
        } catch (error) {
            console.error('[apiRequest] Error:', method, url, error.message);
            const isLastAttempt = attempt === maxAttempts;
            const isExternalAbort = Boolean(externalSignal?.aborted);

            // Всегда очищаем таймауты при ошибке
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

            const status = Number(error.status || 0);

            // 503 SERVICE_STARTING: сервер только что запустился, БД не готова.
            // Увеличиваем количество попыток и задержку для этого случая —
            // перезапуск контейнера может занять больше 10 секунд.
            // Счётчик попыток 503 хранится ЛОКАЛЬНО в замыкании, а не в объекте ошибки,
            // чтобы не зависеть от maxAttempts (который для мутаций равен 0).
            // Максимум 5 попыток: 3 попытки с задержкой 5с, затем 2 попытки с задержкой 10с.
            if (status === 503 && error.code === 'SERVICE_STARTING') {
                if (!apiRequest._serviceStartingAttempts) {
                    apiRequest._serviceStartingAttempts = 0;
                }
                const maxServiceStartingAttempts = 5;
                if (apiRequest._serviceStartingAttempts < maxServiceStartingAttempts) {
                    const retryDelay = apiRequest._serviceStartingAttempts < 3 ? 5000 : 10000;
                    apiRequest._serviceStartingAttempts++;
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue;
                }
                // Попытки исчерпаны — сбрасываем счётчик и выбрасываем ошибку
                apiRequest._serviceStartingAttempts = 0;
            } else {
                // Любая другая ошибка (не 503 SERVICE_STARTING) сбрасывает счётчик
                if (apiRequest._serviceStartingAttempts) {
                    apiRequest._serviceStartingAttempts = 0;
                }
            }

            // 4xx — детерминированная ошибка клиента: повтор ничего не изменит.
            // Раньше здесь уходили 3 одинаковых запроса (например, 400 «не в клане»).
            // Исключения: 408 (таймаут запроса) и 429 (лимит) — их есть смысл повторить.
            // 4xx — детерминированная ошибка клиента: повтор ничего не изменит.
            // Повтор при 429 исключён: сервер только что сказал «слишком быстро»,
            // а клиент шлёт тот же запрос ещё два раза с нарастающей паузой,
            // разгоняя лавину. Раньше именно это превращало одну ошибку лимита
            // в серию из трёх запросов на каждый чих.
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
                } else if (status === 503) {
                    showNotification('Игра запускается. Попробуйте позже.', 'warning');
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

        // Если цикл завершился без возврата (например, исчерпаны 503 попытки),
        // выбрасываем ошибку вместо неявного undefined
        throw new Error('Сервер недоступен после повторных попыток');
    }
}

// ============================================
// ГЕНЕРАЦИЯ API МЕТОДОВ
// ============================================

/**
 * Текст ошибки для показа игроку.
 *
 * apiRequest кладёт в Error.message текст из тела ответа, а в Error.status —
 * HTTP-код. Но почти все вызовы в этом файле показывали в catch свой
 * обобщённый текст и молча выбрасывали message: игрок, которому сервер
 * ответил «Недостаточно ключей от босса 4», видел «Не удалось начать бой
 * с боссом» и не понимал, что делать.
 *
 * Правило:
 *  - 4xx — детерминированная игровая ошибка, сервер уже объяснил причину.
 *    Показываем его текст: он написан для игрока.
 *  - 5xx, таймаут, обрыв сети — текст либо внутренний, либо его уже
 *    показал тост в apiRequest. Возвращаем запасной вариант.
 *  - без status (ошибка до запроса, например нет initData) — тоже
 *    запасной вариант: message может быть техническим.
 *
 * @param {Error|object} error ошибка из apiRequest
 * @param {string} fallback текст, если причину показать нельзя
 * @returns {string} что показать игроку
 */
function clientErrorMessage(error, fallback) {
    const status = Number(error?.status || 0);
    if (status >= 400 && status < 500 && error?.message) {
        return error.message;
    }
    return fallback;
}

/** Создаёт API метод на основе словаря эндпоинтов */
/**
 * Мутации через createApiMethod, где повтор ВСЕГДА ошибочен и должен
 * схлопываться в первый ответ.
 *
 * Сюда НЕ входят удары/атаки: два удара подряд — легитимная игра (энергии
 * хватает), и схлопывание второго сломало бы бой. Для таких действий
 * защита остаётся на FOR UPDATE + энергетическом кулдауне.
 *
 * Колесо — кулдаун, покупка за звёзды — трата, членство в клане — состояние:
 * повтор не имеет смысла, а двойной тап возможен.
 *
 * ВАЖНО: сюда входят только имена из объекта endpoints. Покупка за монеты
 * (buyCoinItem) идёт через gameApi.post('/game/items/buy') напрямую и
 * защищена lockAction — ей ключ передаётся явно, см. gameApi.post.
 */
const IDEMPOTENT_ENDPOINTS = new Set([
    'wheelSpin',
    'purchase',
    'clanJoin',
    'clanLeave',
    'clanCreate'
]);

/**
 * Окно, в котором повторный вызов несёт ТОТ ЖЕ ключ идемпотентности.
 * Достаточно, чтобы поймать двойной тап (человек тапает за <500 мс),
 * и мало, чтобы схлопнуть осмысленное второе действие.
 */
const IDEMPOTENCY_WINDOW_MS = 1500;

/**
 * Стабильный ключ идемпотентности для области действия в пределах окна.
 *
 * Повторный вызов внутри окна получает ТОТ ЖЕ ключ, поэтому сервер
 * (idempotencyMiddleware) отвечает сохранённым результатом вместо второго
 * выполнения. Разные области (разные предметы, разные действия) получают
 * разные ключи и не схлопываются друг с другом.
 *
 * @param {string} scope область действия, например 'buy-coin-150480'
 * @param {number} [windowMs=1500] окно, в котором ключ считается тем же
 * @returns {string} ключ идемпотентности
 */
const mutationKeys = new Map();
function stableMutationKey(scope, windowMs = 1500) {
    const now = Date.now();
    const prev = mutationKeys.get(scope);
    if (prev && now - prev.at < windowMs) {
        return prev.key;
    }
    const key = `${scope}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    mutationKeys.set(scope, { key, at: now });
    return key;
}

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
        // Ключ идемпотентности живёт в замысании конкретного эндпоинта:
        // повторный вызов внутри окна получает тот же ключ, поэтому сервер
        // отвечает сохранённым результатом вместо второго выполнения.
        let lastIdempotencyKey = null;
        let lastKeyAt = 0;
        const isIdempotent = IDEMPOTENT_ENDPOINTS.has(name);

        return async function(body = {}, callOptions = {}) {
            invalidateCache(name);

            // Повторного вызова внутри окна получает тот же ключ -> сервер
            // отвечает сохранённым результатом вместо второго выполнения.
            const idempotencyKey = callOptions.idempotencyKey
                || (isIdempotent ? stableMutationKey(name, IDEMPOTENCY_WINDOW_MS) : null);

            return apiRequest(config.endpoint, {
                method: 'POST',
                body,
                idempotencyKey
            }, callOptions.retries);
        };
    }
}

/** Генерируем gameApi один раз через Object.fromEntries */
const gameApi = Object.fromEntries(
    Object.keys(endpoints).map(name => [name, createApiMethod(name)])
);

// Добавляем статические методы
// post принимает options: { idempotencyKey, silent, signal } — ключ нужен
// вызовам «в обход» endpoints (например покупка за монеты), чтобы серверный
// idempotencyMiddleware схлопнул повтор вместо второго списания.
gameApi.get = (endpoint, params = {}) => apiRequest(endpoint, { method: 'GET' }, 2, params);
gameApi.post = (endpoint, body = {}, options = {}) => apiRequest(endpoint, {
    method: 'POST',
    body,
    idempotencyKey: options.idempotencyKey || null,
    silent: options.silent,
    signal: options.signal
}, options.retries);
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
// ПРАВИЛА ИЗ ОБЩЕГО ФАЙЛА
// ============================================================================

/**
 * Интервал регена энергии — общая константа из shared/equipment.js, тем же
 * значением считает сервер (utils/game-helpers.js recalcEnergy).
 */
const ENERGY_REGEN_INTERVAL_MS = window.EquipmentShared?.ENERGY_REGEN_INTERVAL_MS ?? 60000;

/**
 * Лимит слотов инвентаря. Берётся из public/shared/equipment.js — того же
 * файла, что использует routes/game/world.js.
 *
 * Optional chaining + значение по умолчанию обязательны: при обращении без
 * `?.` строка упала бы с TypeError, если shared/equipment.js не успел
 * загрузиться (или отдался 404), и НЕ выполнился бы весь последующий код.
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
// МЕНЕДЖЕР ИНТЕРВАЛОВ И ТАЙМАУТОВ (защита от утечек памяти)
// ============================================================================

// Используем Set для O(1) добавления/удаления и автоматической очистки
const activeTimeouts = new Set();
const activeIntervals = new Set();

/**
 * Безопасное создание интервала с автоматической очисткой
 * @param {Function} callback - функция
 * @param {number} delay - задержка в мс
 * @returns {number} id интервала
 */
function safeSetInterval(callback, delay) {
    const id = setInterval(() => {
        try {
            callback();
        } catch (e) {
            console.error('[safeSetInterval] callback error:', e);
        }
    }, delay);
    activeIntervals.add(id);
    return id;
}

/**
 * Безопасное создание таймаута с автоматической очисткой
 * @param {Function} callback - функция
 * @param {number} delay - задержка в мс
 * @returns {number} id таймаута
 */
function safeSetTimeout(callback, delay) {
    const id = setTimeout(() => {
        activeTimeouts.delete(id);
        try {
            callback();
        } catch (e) {
            console.error('[safeSetTimeout] callback error:', e);
        }
    }, delay);
    activeTimeouts.add(id);
    return id;
}

/**
 * Безопасная очистка одного интервала
 * @param {number} id - id интервала для очистки
 */
function safeClearInterval(id) {
    clearInterval(id);
    activeIntervals.delete(id);
}

/**
 * Безопасная очистка одного таймаута
 * @param {number} id - id таймаута для очистки
 */
function safeClearTimeout(id) {
    clearTimeout(id);
    activeTimeouts.delete(id);
}

/**
 * Очистка всех интервалов и таймаутов при выходе
 */
function clearAllIntervals() {
    activeIntervals.forEach(id => clearInterval(id));
    activeIntervals.clear();
    activeTimeouts.forEach(id => clearTimeout(id));
    activeTimeouts.clear();
}

// Очищаем интервалы и таймауты при закрытии страницы
window.addEventListener('beforeunload', clearAllIntervals);
window.addEventListener('pagehide', clearAllIntervals);

// Также чистим actionLocks при выгрузке страницы
window.addEventListener('beforeunload', () => {
    Object.keys(actionLocks).forEach(key => {
        actionLocks[key] = false;
    });
    actionLockTimers.forEach(id => safeClearTimeout(id));
    actionLockTimers.clear();
    // Ключи идемпотентности живут только чтобы схлопнуть быстрый повтор:
    // после выгрузки они не нужны, а Map иначе рос бы по числу предметов.
    mutationKeys.clear();
});

// ============================================================================
// БЛОКИРОВКИ ОПЕРАЦИЙ (защита от состояний гонки)
// ============================================================================

/**
 * Блокировки операций + их таймеры-страховки.
 *
 * Раньше lockAction не ставил никакого автоматического снятия: если
 * unlockAction не вызывался (исключение в коде между try и finally, забытый
 * finally, упавший промис), действие оставалось заблокированным до
 * перезагрузки страницы — кнопка просто переставала работать.
 * Страховочный таймер гарантированно разблокирует операцию.
 */
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
    searchLoot: false,
    attackBoss: false,
    loadBosses: false
};

/** Через сколько мс принудительно снимать блокировку */
const ACTION_LOCK_TIMEOUT_MS = 30000;

/** Страховочные таймеры по имени операции */
const actionLockTimers = new Map();

/**
 * Блокировка операции
 * @param {string} name - имя операции
 * @returns {boolean} true если захватить удалось, false если уже занята
 */
function lockAction(name) {
    if (actionLocks[name]) {
        showNotification?.('Подождите, выполняется другое действие...', 'warning');
        return false;
    }
    actionLocks[name] = true;

    // Снимаем возможный старый таймер этой операции и ставим новый
    const existing = actionLockTimers.get(name);
    if (existing !== undefined) safeClearTimeout(existing);

    const timerId = safeSetTimeout(() => {
        if (actionLocks[name]) {
            console.warn(`[lockAction] Снята зависшая блокировка: ${name}`);
            actionLocks[name] = false;
        }
        actionLockTimers.delete(name);
    }, ACTION_LOCK_TIMEOUT_MS);
    actionLockTimers.set(name, timerId);

    return true;
}

/**
 * Разблокировка операции
 * @param {string} name - имя операции
 */
function unlockAction(name) {
    actionLocks[name] = false;

    // Таймер-страховка больше не нужен — иначе он бы винтовал состояние
    const timerId = actionLockTimers.get(name);
    if (timerId !== undefined) {
        safeClearTimeout(timerId);
        actionLockTimers.delete(name);
    }
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
        if (!this._element) return;

        this._element.classList.remove('active');

        // Лоадер больше не нужен: снимаем его из DOM и обнуляем ссылку.
        // Раньше скрытый элемент (display:none) оставался в document.body
        // с текстом последнего сообщения до конца жизни страницы, а _element
        // продолжал держать его — лишний узел и лишние ссылки на слушателей.
        if (this._element.parentNode) {
            this._element.parentNode.removeChild(this._element);
        }
        this._element = null;
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
                    <div class="modal-body">${escapeHtml(content)}</div>
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
        const canSell = item.rarity && item.rarity !== 'key' && item.type !== 'key';
        const sellBtn = canSell 
            ? `<button class="btn btn-small btn-sell" data-action="sell-item" data-item-index="${escapeAttribute(item.index ?? item.id)}" title="Продать">💰 Продать</button>`
            : '';
        return `
            <div class="inventory-slot rarity-${rarityClass}" 
                 data-use-item="${escapeAttribute(itemActionId)}" data-id="${escapeAttribute(item.id)}">
                <span class="item-icon">${escapeHtml(item.icon || '📦')}</span>
                ${item.count > 1 ? `<span class="item-count">${Number(item.count)}</span>` : ''}
                ${sellBtn}
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
        market: '/api/game/items/shop',
        pvp: '/api/game/pvp/players',
        status: '/api/game/status',
        energy: '/api/game/profile/energy'
    },
    
    // Активные контроллеры для отмены запросов
    _activeControllers: new Map(),
    
    // Отмена запроса по типу
    cancelRequest(type) {
        const controller = this._activeControllers.get(type);
        if (controller) {
            // Помечаем как ручную отмену для корректной обработки в load()
            controller.isManualAbort = true;
            controller.abort();
            this._activeControllers.delete(type);
        }
    },
    
    // Отмена всех активных запросов
    cancelAllRequests() {
        for (const controller of this._activeControllers.values()) {
            controller.isManualAbort = true;
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
            const isManualAbort = error?.name === 'AbortError' && (error?.isManualAbort || error?.target?.isManualAbort);
            if (isManualAbort) {
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
 * Диалог подтверждения в стиле игры.
 *
 * Заменяет системный confirm()/prompt(): в Telegram Mini App они
 * выглядят чужеродно (светлая тема браузера поверх тёмного интерфейса,
 * другой шрифт и кнопки) и на части клиентов блокируются вовсе.
 *
 * Возвращает Promise<boolean>: true — подтверждено, false — отменено
 * (крестик, клик вне окна или кнопка «Отмена»). Если элементов модального
 * окна нет (экран ещё не построен), ведёт себя как обычный confirm().
 *
 * @param {string} message текст вопроса
 * @param {object} [options]
 * @param {string} [options.title='Подтверждение'] заголовок окна
 * @param {string} [options.confirmLabel='Да'] подпись кнопки подтверждения
 * @param {string} [options.cancelLabel='Отмена'] подпись кнопки отмены
 * @param {'info'|'success'|'error'|'warning'} [options.type='info'] тип окна
 * @returns {Promise<boolean>}
 */
function showConfirmDialog(message, options = {}) {
    const {
        title = 'Подтверждение',
        confirmLabel = 'Да',
        cancelLabel = 'Отмена',
        type = 'info'
    } = options;

    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');

    if (!modal || !modalTitle || !modalMessage) {
        // Экраны ещё не построены — откатываемся на системный диалог,
        // чтобы действие не потерялось молча.
        return Promise.resolve(window.confirm(message));
    }

    // Снимаем возможное предыдущее содержимое (например, форму пожертвования)
    modalMessage.innerHTML = '';
    modalTitle.textContent = title;

    const textNode = document.createElement('div');
    textNode.className = 'modal-confirm-text';
    textNode.textContent = message;
    modalMessage.appendChild(textNode);

    const actions = document.createElement('div');
    actions.className = 'modal-confirm-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn modal-confirm-yes';
    confirmBtn.textContent = confirmLabel;

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn modal-confirm-no';
    cancelBtn.textContent = cancelLabel;

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    modalMessage.appendChild(actions);

    modal.className = 'modal';
    modal.classList.add(`modal-${type}`);
    openModalElement(modal);

    return new Promise((resolve) => {
        let settled = false;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };

        const onConfirm = () => {
            hideModal();
            finish(true);
        };

        const onCancel = () => {
            hideModal();
            finish(false);
        };

        // Крестик и клик мимо окна переназначаются openModalElement, поэтому
        // подписываемся на отдельный обработчик закрытия: он срабатывает
        // после hideModal() и гарантирует resolve(false) для всех путей
        // выхода, включая те, о которых эта функция не знает.
        const onModalClosed = () => finish(false);

        function cleanup() {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('modal:closed', onModalClosed);
        }

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('modal:closed', onModalClosed);

        // Автофокус на кнопке подтверждения: на мобильных это позволяет
        // завершить диалог кнопкой «Да» на экране, не наводя взгляд.
        confirmBtn.focus();
    });
}

/**
 * Запрос подтверждения для дорогих операций.
 *
 * Раньше внутри стоял системный confirm(). Теперь используется диалог
 * игры, но сигнатура и поведение прежние: порог цены, при котором
 * добавляется предупреждение, не изменился.
 *
 * @param {string} message описание операции
 * @param {number} [price=0] сумма в монетах
 * @param {number} [threshold=5000] порог, выше которого показывается сумма
 * @returns {Promise<boolean>}
 */
function confirmAction(message, price = 0, threshold = 5000) {
    if (price > threshold) {
        return showConfirmDialog(`${message}\nСумма: ${formatNumber(price)} 🪙\nТочно продолжить?`, {
            title: '⚠️ Подтвердите покупку',
            confirmLabel: 'Продолжить',
            type: 'warning'
        });
    }
    if (message) {
        return showConfirmDialog(message);
    }
    return Promise.resolve(true);
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

// Дополнительная очистка при выгрузке страницы
window.addEventListener('beforeunload', () => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        // Отправляем сообщение контроллеру для корректного завершения
        navigator.serviceWorker.controller.postMessage({ type: 'SHUTDOWN' });
    }
});

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================================================

window.setHtml = setHtml;
window.confirmAction = confirmAction;
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
    // Восстановление: 1 энергия за интервал из shared/equipment.js
    
    if (!lastUpdate) return null;
    
    const lastUpdateTime = new Date(lastUpdate).getTime();
    const now = Date.now();
    const timePassed = now - lastUpdateTime;
    
    // Если прошёл полный интервал - энергия уже восстановилась
    if (timePassed >= ENERGY_REGEN_INTERVAL_MS) {
        return null;
    }
    
    const msUntilNext = ENERGY_REGEN_INTERVAL_MS - timePassed;
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
 * Начать бой с боссом
 * @param {Object} boss - объект босса
 * @param {number} [timeRemainingMs] - оставшееся время в мс (опционально)
 */
async function startBossFight(boss, timeRemainingMs = null) {
    if (!lockAction('attackBoss')) return;

    try {
        // POST /api/game/bosses/start — реальный маршрут (routes/game/bosses.js).
        // Было '/api/game/bosses/attack': такого пути на сервере нет, поэтому
        // кнопка «Начать бой» всегда получала 404 Not found и бой не начинался.
        // Ответ /start содержит ровно то, что читает код ниже: data.boss с hp
        // и data.time_remaining_ms.
        const result = await apiRequest('/api/game/bosses/start', {
            method: 'POST',
            body: { boss_id: boss.id }
        });
        
        if (result.success) {
            // Запускаем бой
            const bossData = result.data || result;
            renderBossFightScreen(bossData, bossData.time_remaining_ms || timeRemainingMs);
            playSound('boss_start');
        } else {
            showModal('⚠️ Ошибка', result.error || result.message || 'Не удалось начать бой');
        }
    } catch (error) {
        console.error('Start boss fight error:', error);
        showModal('⚠️ Ошибка', clientErrorMessage(error, 'Не удалось начать бой'));
    } finally {
        unlockAction('attackBoss');
    }
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

window.goToMain = goToMain;
window.backToBosses = backToBosses;

/**
 * Ожидание готовности сервера.
 *
 * /ready отвечает 503, пока БД не инициализирована. Опрашиваем его перед
 * первым API-запросом, чтобы не гнаться за 503 retry-логикой в apiRequest
 * (которая конфликтует с withTimeout в initGame).
 *
 * @param {number} [maxWait=30000] максимальное время ожидания в мс
 * @returns {Promise<void>}
 */
async function waitForServerReady(maxWait = 30000) {
    const startTime = Date.now();
    const pollInterval = 2000;

    // Обновляем текст загрузки
    const loadingText = document.querySelector('.loading-text');
    if (loadingText) {
        loadingText.textContent = 'Подключение к серверу...';
    }

    while (Date.now() - startTime < maxWait) {
        try {
            const response = await fetch(`${window.location.origin}/ready`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.status === 'ready') {
                    console.log('[waitForServerReady] Сервер готов');
                    return;
                }
            }

            // Сервер ещё запускается (503) или ошибка (500)
            if (loadingText) {
                loadingText.textContent = `Запуск сервера...`;
            }
        } catch (err) {
            // Сетевая ошибка — сервер может ещё не слушать порт
            console.log('[waitForServerReady] Сервер недоступен, ждём...');
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Сервер не ответил за maxWait
    throw new Error('Сервер не готов после ' + maxWait + 'мс ожидания');
}

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
 * resolve() на 5-й секунде продолжил бы инициализацию без Telegram,
 * а дальше сработал бы фиктивный ID/initData — приложение работало бы
 * без авторизации.
 *
 * @param {number} maxWait - сколько ждать, мс
 * @returns {Promise<void>}
 * @throws {Error} если данные Telegram так и не появились
 */
async function waitForTelegramWebApp(maxWait = 5000) {
    const startTime = Date.now();
    
    console.log('[waitForTelegramWebApp] Starting wait, maxWait:', maxWait);
    
    return new Promise((resolve, reject) => {
        // Данные доступны либо из SDK Telegram, либо из fragment прямой ссылки
        const isReady = () => Boolean(
            window.Telegram?.WebApp?.initDataUnsafe?.user || getInitDataFromHash()
        );
        
        // Если уже загружен - сразу успех
        if (isReady()) {
            console.log('[waitForTelegramWebApp] Already ready');
            resolve();
            return;
        }

        // Функция проверки
        const check = () => {
            if (isReady()) {
                console.log('[waitForTelegramWebApp] Ready after', Date.now() - startTime, 'ms');
                resolve();
                return;
            }
            
            if (Date.now() - startTime > maxWait) {
                console.error('[waitForTelegramWebApp] Timeout after', maxWait, 'ms');
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
    // 20 секунд (зависший запрос, сбой SDK и т.п.), показываем пользователю
    // причину и кнопку перезапуска вместо бесконечного лоадера.
    const initWatchdog = setTimeout(() => {
        if (gameState.player) return; // игра уже запущена
        const loadingScreen = document.getElementById('loading-screen');
        if (!loadingScreen || loadingScreen.style.display === 'none') return;
        console.error('[initGame] Watchdog: инициализация не завершилась за 20 секунд');
        renderInitError('⏳', 'Загрузка затянулась', 'Сервер долго не отвечает. Проверь интернет и попробуй ещё раз.');
    }, 20000);

    // Обработчик для отлова unhandled rejections во время инициализации
    const unhandledRejectionHandler = (event) => {
        console.error('[initGame] Unhandled rejection during init:', event.reason);
        event.preventDefault(); // Предотвращаем дефолтное логирование в консоль
    };
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);

    try {
        console.log('[initGame] Starting initialization...');

        // Ждём готовности сервера: пока БД не инициализирована, /api/game/*
        // отвечает 503. Опрашиваем /ready (без auth) чтобы не конфликтовать
        // с withTimeout в дальнейших apiRequest.
        console.log('[initGame] Waiting for server to be ready...');
        const loadingText = document.querySelector('.loading-text');
        if (loadingText) loadingText.textContent = 'Ожидание сервера...';
        await waitForServerReady(30000);
        console.log('[initGame] Server is ready');

        // Ждём пока загрузится Telegram WebApp.
        // В production отсутствие Telegram — фатально: продолжать нельзя,
        // иначе запросы уйдут без валидного initData.
        try {
            console.log('[initGame] Waiting for Telegram WebApp...');
            await waitForTelegramWebApp();
            console.log('[initGame] Telegram WebApp ready');
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
            console.log('[initGame] Calling WebApp.ready() and expand()');
            window.Telegram.WebApp.ready();
            window.Telegram.WebApp.expand();
        }
        
        console.log('[initGame] Getting Telegram ID...');
        const telegramId = getTelegramId();
        console.log('[initGame] Telegram ID:', telegramId);
        if (!telegramId) {
            renderInitError('😿', 'Ошибка', 'Не удалось определить пользователя Telegram. Откройте игру через бота @LastHearthBot');
            return;
        }

        // Подписанные initData обязательны (в production — всегда).
        // localStorage НЕ используется: initData имеет auth_date и протухает,
        // поэтому сохранённая копия — это не валидный вход.
        console.log('[initGame] Getting initData...');
        const initData = getInitData();
        console.log('[initGame] initData present:', !!initData);
        if (!initData) {
            renderInitError('😿', 'Ошибка авторизации', 'Откройте игру через бота @LastHearthBot');
            return;
        }

        // loadProfile() и loadLocations() сами гасят свои ошибки (не бросают
        // наружу), чтобы падение перерисовки не выглядело как провал операции.
        // Отдельные try/catch здесь были лишними и никогда не срабатывали.
        // Сервер валидирует игрока через middleware validatePlayer на всех роутах.
        console.log('[initGame] Loading profile...');
        await withTimeout(loadProfile(), 15000, 'Таймаут загрузки профиля');
        console.log('[initGame] Profile loaded, player:', !!gameState.player);
        
        console.log('[initGame] Loading locations...');
        await withTimeout(loadLocations(), 15000, 'Таймаут загрузки локаций');
        console.log('[initGame] Locations loaded');

        // Проверяем, успешно ли загрузился профиль
        if (!gameState.player) {
            console.error('[initGame] Профиль не загружен, прерываем инициализацию');
            renderInitError('😿', 'Ошибка загрузки', 'Не удалось загрузить профиль. Попробуй перезапустить игру.');
            return;
        }

        console.log('[initGame] Profile OK, showing main screen...');
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
        console.log('[initGame] Initialization complete!');

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
        } else if (error.status === 503 || error.message?.includes('SERVICE_STARTING')) {
            errorMessage = 'Игра запускается. Подожди и перезагрузи.';
        }

        renderInitError('😿', 'Ошибка', errorMessage);
    } finally {
        clearTimeout(initWatchdog);
        window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
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
 * @returns {Promise<boolean>} true если профиль загружен успешно, false при ошибке
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
    // Возвращает true при успехе, false при ошибке (кроме отмены).
    try {
        const response = await apiRequest('/api/game/profile');

        if (!response?.success) {
            console.error('Ошибка загрузки профиля:', response?.message || 'Unknown error');
            return false;
        }

        const payload = response?.data || response;

        if (!payload || typeof payload !== 'object') {
            console.error('Неверный формат ответа профиля:', response);
            return false;
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
        // что читает сервер): вторая копия здесь делала бы полосу опыта врущей.
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
        return true;
    } catch (error) {
        // Сетевая ошибка или таймаут. Отмену запроса не считаем ошибкой.
        if (error?.isManualAbort || error?.name === 'AbortError') {
            return false;
        }
        // Остальные ошибки логируем явно. Вызывающий код решает, показывать ли уведомление.
        console.error('[loadProfile] Не удалось обновить профиль:', error);
        return false;
    }
}

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
 * Считаются из данных, которые сервер действительно отдаёт: списка боссов
 * (refreshMainScreenInsights кладёт его в mainInsights) и списка локаций.
 * Поле `player.journey` использовать нельзя: сервер его не отдаёт, и обе
 * карточки навсегда показывали бы заглушки «Нет цели»/«Все зоны открыты».
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

    // Тиры — из общего файла правил: подпись на экране обязана совпадать с
    // порогами, по которым сервер начисляет множители за лут, опыт и ключ.
    // Текст подсказки — UI-копия клиента.
    const tier = shared.getRiskTierByScore(score);
    const hints = {
        safe: 'Зона безопасна для стабильного фарма.',
        warning: 'Хорошая зона для рывка вперёд, если заранее подготовить защиту и расходники.',
        danger: 'Шанс на лучший лут выше, но без подготовки дебаффы быстро накопятся.',
        deadly: 'Очень высокий риск, но и самые выгодные находки для подготовки к сильным боссам.'
    };

    return {
        tier: tier.key,
        label: tier.label,
        hint: hints[tier.key],
        score,
        radiationDefense: preparation.radiationDefense,
        infectionDefense: preparation.infectionDefense,
        // Порог «освоено» — тот же, что в gameConstants.calculateLocationRiskProfile.
        isPrepared: score <= (shared.RISK_PREPARED_MAX_SCORE ?? 2)
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

    // Настройки автолечения. Порог в HP считаем тем же правилом, по которому
    // лечит сервер (shared.getAutoHealThreshold): раньше лейбл округлял через
    // Math.round, а сервер — вниз, и надпись обещала на 1 HP больше.
    const enabled = player.auto_heal_enabled !== false;
    const threshold = Number(player.auto_heal_threshold) || (shared ? shared.DEFAULT_AUTO_HEAL_THRESHOLD : 35);
    const toggle = document.getElementById('auto-heal-enabled');
    const range = document.getElementById('auto-heal-threshold');
    const label = document.getElementById('auto-heal-threshold-label');
    const thresholdHp = shared
        ? shared.getAutoHealThreshold(maxHealth, threshold)
        : Math.floor((Math.max(1, maxHealth) * threshold) / 100);

    if (toggle) toggle.checked = enabled;
    if (range) {
        // Границы ползунка — из общего файла правил: HTML-атрибуты min/max
        // не должны расходиться с серверной валидацией после смены баланса.
        if (shared) {
            range.min = String(shared.AUTO_HEAL_THRESHOLD_MIN);
            range.max = String(shared.AUTO_HEAL_THRESHOLD_MAX);
        }
        range.value = String(threshold);
    }
    if (label) {
        label.textContent = enabled
            ? `— сработает при ${thresholdHp} HP`
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
        showNotification(clientErrorMessage(error, 'Не удалось сохранить настройку'), 'error');
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
        showNotification(clientErrorMessage(error, 'Не удалось применить лекарство'), 'error');
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
        showNotification(clientErrorMessage(error, 'Не удалось получить бонус'), 'error');
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
    // Предупреждение об опасной зоне. confirm() заменён диалогом игры:
    // системный диалог в Telegram Mini App выглядит чужеродно.
    if (!zoneRisk.isPrepared && zoneRisk.score >= 3) {
        const shouldProceed = await showConfirmDialog(
            `Текущая зона: ${zoneRisk.label}. Защита может быть недостаточной. Продолжить вылазку?`,
            {
                title: '⚠️ Опасная зона',
                confirmLabel: 'Идти в вылазку',
                cancelLabel: 'Остаться',
                type: 'warning'
            }
        );
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
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось выполнить поиск'));
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

    // Запасной вариант на случай, если shared/equipment.js не загрузился
    // (404 или обрыв): без него страница не запустилась бы с TypeError.
    //
    // Список слотов здесь продублирован НАМЕРЕННО и обязан совпадать с
    // COMBAT_SLOTS из общего файла — иначе при аварии загрузки клиент
    // вернётся ровно к тому багу, который этот общий файл и чинил.
    // Предыдущий вариант смотрел только на item.type и относил к
    // экипируемым лишь weapon/armor/helmet: предмет с category 'body' и,
    // скажем, type 'gloves' он объявил бы неэкипируемым.
    const FALLBACK_COMBAT_SLOTS = [
        'armor', 'helmet', 'body', 'head', 'hands', 'legs', 'boots', 'accessory', 'weapon'
    ];

    // Порядок полей тот же, что в resolveEquipmentSlot.
    for (const candidate of [item.slot, item.category, item.type]) {
        const slot = String(candidate || '').toLowerCase();
        if (FALLBACK_COMBAT_SLOTS.includes(slot)) return true;
    }
    return false;
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
        showModal('⚠️ Внимание', clientErrorMessage(error, 'Не удалось использовать предмет'));
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
        showNotification(clientErrorMessage(error, 'Не удалось загрузить инвентарь'), 'error');
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
        showNotification(clientErrorMessage(error, 'Не удалось снять предмет'), 'error');
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
    
    // Форматируем стоимость ремонта с разбивкой
    const repairTooltip = repairCost > 0 
        ? `Ремонт полностью: 🪙 ${formatNumber(repairCost)}` 
        : 'Полностью отремонтировано';
    
    // Форматируем стоимость улучшения с разбивкой
    let upgradeTooltip = 'Максимальный уровень';
    if (upgradeCost) {
        const materialsText = Object.entries(upgradeCost.materials || {})
            .map(([name, qty]) => `  ${name} ×${qty}`)
            .join('\n');
        upgradeTooltip = `Улучшение до +${item.upgrade_level + 1}:\n🪙 ${formatNumber(upgradeCost.coins)}\n${materialsText}`;
    }
    
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
                <button class="ws-btn" data-ws-repair="${slot}" ${repairCost > 0 ? '' : 'disabled'} 
                        title="${escapeHtml(repairTooltip)}">
                    🔧 Ремонт · 🪙 ${formatNumber(repairCost)}
                </button>
                <button class="ws-btn" data-ws-upgrade="${slot}" ${upgradeCost ? '' : 'disabled'}
                        title="${escapeHtml(upgradeTooltip)}">
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
            const shared = window.EquipmentShared;
            if (label && player) {
                const maxHealth = Math.max(1, Number(player.max_health) || 1);
                const value = Number(autoHealRange.value);
                // Тот же расчёт, что у сервера: иначе предпросмотр обещает
                // порог, до которого автолечение не доберётся.
                const thresholdHp = shared
                    ? shared.getAutoHealThreshold(maxHealth, value)
                    : Math.floor((maxHealth * value) / 100);
                label.textContent = `— сработает при ${thresholdHp} HP`;
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
        showNotification(clientErrorMessage(error, 'Не удалось установить модификацию'), 'error');
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
        showNotification(clientErrorMessage(error, 'Не удалось отремонтировать'), 'error');
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
        // Подробное логирование ошибки для отладки
        console.error('[upgradeEquipmentSlot] Error:', {
            slot,
            message: error.message,
            code: error.code,
            status: error.status,
            response: error.response
        });
        showNotification(clientErrorMessage(error, 'Не удалось улучшить'), 'error');
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
        showNotification(clientErrorMessage(error, 'Не удалось разобрать предмет'), 'error');

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
        showNotification(clientErrorMessage(error, 'Не удалось продать предмет'), 'error');

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
        // async: внутри ветки разбора await на диалог подтверждения.
        const activate = async () => {
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
                // Разбор необратим: подтверждаем диалогом игры.
                const confirmed = await showConfirmDialog(
                    `Разобрать «${name}»? Снаряжение даст материалы, остальное просто пропадёт.`,
                    {
                        title: '♻️ Разобрать предмет',
                        confirmLabel: 'Разобрать',
                        cancelLabel: 'Оставить',
                        type: 'warning'
                    }
                );
                if (!confirmed) {
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
/**
 * Диалог продажи стека: выбор количества + превью цены
 * @param {Object} item - предмет
 * @param {number} amount - всего в стеке
 * @param {number} unitPrice - цена за 1 шт.
 */
function showStackSellDialog(item, amount, unitPrice) {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const message = document.getElementById('modal-message');
    if (!modal || !title || !message) {
        sellItem(item.index);
        return;
    }

    title.textContent = '💰 Продажа: ' + escapeHtml(item.name || 'предмет');
    
    // Создаем контент с полем ввода количества
    message.innerHTML = `
        <div class="sell-dialog">
            <p class="sell-dialog-info">В стопке <strong>${amount}</strong> шт. по <strong>${unitPrice} 🪙</strong> за шт.</p>
            <div class="sell-dialog-quantity">
                <label for="sell-quantity">Количество:</label>
                <input type="number" id="sell-quantity" class="sell-quantity-input" 
                       value="1" min="1" max="${amount}" step="1">
                <div class="sell-quantity-buttons">
                    <button type="button" class="btn-sell-qty" data-action="min">1</button>
                    <button type="button" class="btn-sell-qty" data-action="half">${Math.floor(amount / 2)}</button>
                    <button type="button" class="btn-sell-qty" data-action="max">${amount}</button>
                </div>
            </div>
            <div class="sell-dialog-preview">
                <span>Итого: </span>
                <strong id="sell-total-price">${unitPrice} 🪙</strong>
            </div>
        </div>
    `;
    
    openModalElement(modal);
    
    // Обработчики для кнопок количества
    const quantityInput = document.getElementById('sell-quantity');
    const totalPriceEl = document.getElementById('sell-total-price');
    
    const updatePreview = () => {
        let qty = parseInt(quantityInput.value, 10) || 1;
        qty = Math.max(1, Math.min(amount, qty));
        quantityInput.value = qty;
        totalPriceEl.textContent = unitPrice * qty + ' 🪙';
    };
    
    quantityInput.addEventListener('input', updatePreview);
    quantityInput.addEventListener('change', updatePreview);
    
    message.querySelectorAll('.btn-sell-qty').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            if (action === 'min') quantityInput.value = 1;
            else if (action === 'half') quantityInput.value = Math.floor(amount / 2);
            else if (action === 'max') quantityInput.value = amount;
            updatePreview();
        });
    });
    
    // Кнопки действий
    const actions = [
        { label: 'Отмена', class: 'modal-action-btn secondary', onClick: () => hideModal() },
        { label: 'Продать', class: 'modal-action-btn primary', onClick: () => {
            const qty = parseInt(quantityInput.value, 10) || 1;
            const q = Math.max(1, Math.min(amount, qty));
            hideModal();
            sellItem(item.index, q);
        }}
    ];
    
    const box = document.createElement('div');
    box.className = 'modal-actions';
    box.style.marginTop = '16px';
    for (const action of actions) {
        const button = document.createElement('button');
        button.className = 'modal-action-btn ' + (action.class || '');
        button.textContent = action.label;
        bindClickOnce(button, 'sell-stack-' + item.index + '-' + action.label, () => {
            hideModal();
            action.onClick();
        });
        box.appendChild(button);
    }
    message.appendChild(box);
    
    // Фокус на инпут
    setTimeout(() => quantityInput?.focus(), 100);
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
        filteredItems = filteredItems.filter((item) => getItemCategory(item) === currentInventoryFilter);
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
            renderBossFightScreen(
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

async function renderPlayerEquipmentInBossFight() {
    const equipmentContainer = document.getElementById('player-equipment-slots');
    if (!equipmentContainer) return;
    
    const equipment = gameState.player?.equipment || {};
    
    // Слоты в порядке отображения
    const slots = ['head', 'body', 'hands', 'legs', 'boots', 'weapon', 'accessory'];
    // Нормализация своими силами (серверной normalizeEquipment здесь нет):
    // оставляем только валидные объекты-предметы по списку слотов.
    const normalizedEquipment = {};
    for (const slot of slots) {
        const item = equipment[slot];
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            normalizedEquipment[slot] = item;
        }
    }
    const slotNames = {
        head: 'Голова',
        body: 'Тело',
        hands: 'Руки',
        legs: 'Ноги',
        boots: 'Ноги',
        weapon: 'Оружие',
        accessory: 'Аксес.'
    };
    const slotIcons = {
        head: '🪖',
        body: '🧥',
        hands: '🧤',
        legs: '👖',
        boots: '🥾',
        weapon: '⚔️',
        accessory: '🧭'
    };
    
    for (const slot of slots) {
        const item = normalizedEquipment[slot];
        const slotEl = equipmentContainer.querySelector(`[data-slot="${slot}"]`);
        const itemEl = slotEl?.querySelector('.slot-item');
        const durabilityEl = slotEl?.querySelector('.slot-durability');
        
        if (!slotEl) continue;
        
        if (item) {
            slotEl.classList.remove('empty');
            const durability = equipmentRules.getDurabilityInfo(item);
            const isBroken = durability.isBroken;
            
            slotEl.classList.toggle('broken', isBroken);
            
            // Иконка предмета
            const itemIcon = item.icon || (slotIcons[slot] || '📦');
            if (itemEl) {
                itemEl.textContent = itemIcon;
                itemEl.title = `${item.name}${item.upgrade_level ? ` +${item.upgrade_level}` : ''}`;
            }
            
            // Прочность
            if (durabilityEl) {
                const percent = Math.round((durability.current / Math.max(1, durability.max)) * 100);
                let barClass = 'slot-durability-bar';
                if (percent <= 0) barClass += ' broken';
                else if (percent <= 20) barClass += ' critical';
                else if (percent <= 50) barClass += ' low';
                
                durabilityEl.innerHTML = `<div class="${barClass}" style="width: ${percent}%"></div>`;
                durabilityEl.title = `Прочность: ${durability.current}/${durability.max} (${percent}%)`;
            }
        } else {
            slotEl.classList.add('empty');
            slotEl.classList.remove('broken');
            if (itemEl) itemEl.textContent = slotIcons[slot] || '📦';
            if (durabilityEl) durabilityEl.innerHTML = '';
        }
    }
}

function renderBossFightScreen(boss, timeRemainingMs = null) {
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
    
    // Рендерим слоты экипировки игрока
    renderPlayerEquipmentInBossFight();
    
    // Показываем экран боя
    showScreen('boss-fight');
}

/**
 * Обновление таймера боя с боссом
 */


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
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось начать бой с боссом'));
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
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось начать массовый бой'));
    }
}

/**
 * Рендерит слоты экипировки игрока в экране боя с боссом
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
        showNotification(clientErrorMessage(error, 'Ошибка загрузки оружия'), 'error');
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
    
    // Состояние фильтров
    const filterState = {
        type: 'all',      // 'all', 'melee', 'ranged'
        minDamage: 0,
        maxDurability: 100,
        onlyUsable: false
    };
    
    // Создаем панель фильтров
    const filterPanel = document.createElement('div');
    filterPanel.className = 'weapon-filter-panel';
    filterPanel.innerHTML = `
        <div class="filter-row">
            <label>Тип:</label>
            <select id="filter-type" class="filter-select">
                <option value="all">Все типы</option>
                <option value="melee">🗡️ Ближний бой</option>
                <option value="ranged">🏹 Дальний бой</option>
            </select>
        </div>
        <div class="filter-row">
            <label>Мин. урон:</label>
            <input type="number" id="filter-min-damage" class="filter-input" min="0" placeholder="0">
            <label>Макс. износ:</label>
            <input type="number" id="filter-max-durability" class="filter-input" min="0" max="100" placeholder="100%">
            <label class="filter-checkbox">
                <input type="checkbox" id="filter-only-usable"> Только рабочее
            </label>
        </div>
    `;
    list.appendChild(filterPanel);
    
    // Создаем контейнер для списка оружия
    const weaponsContainer = document.createElement('div');
    weaponsContainer.id = 'weapons-container';
    list.appendChild(weaponsContainer);
    
    // Функция фильтрации
    function applyFilters() {
        filterState.type = document.getElementById('filter-type').value;
        filterState.minDamage = parseInt(document.getElementById('filter-min-damage').value, 10) || 0;
        filterState.maxDurability = parseInt(document.getElementById('filter-max-durability').value, 10) || 100;
        filterState.onlyUsable = document.getElementById('filter-only-usable').checked;
        
        renderFilteredWeapons();
    };
    
    // Функция рендера отфильтрованного списка
    function renderFilteredWeapons() {
        const filtered = weapons.filter(w => {
            if (filterState.type !== 'all' && w.category !== filterState.type) return false;
            if (Number(w.damage || 0) < filterState.minDamage) return false;
            
            const durability = EquipmentShared.getDurabilityInfo ? 
                EquipmentShared.getDurabilityInfo({max_durability: w.max_durability, durability: w.durability}) 
                : {current: w.durability, max: w.max_durability, isBroken: !w.durability || w.durability <= 0};
            
            if (filterState.onlyUsable && (durability.isBroken || (durability.current / durability.max * 100) > filterState.maxDurability)) return false;
            if (!durability.isBroken && (durability.current / durability.max * 100) > filterState.maxDurability) return false;
            
            return true;
        });
        
        const container = document.getElementById('weapons-container');
        if (!container) return;
        container.innerHTML = '';
        
        if (!filtered || filtered.length === 0) {
            container.innerHTML = '<div class="empty-message">Нет оружия, соответствующего фильтрам</div>';
            return;
        }
        
        for (const weapon of filtered) {
            const item = document.createElement('div');
            item.className = `weapon-item ${weapon.is_broken ? 'is-broken' : ''}`;
            item.dataset.index = weapon.index;
            
            const durabilityInfo = EquipmentShared.getDurabilityInfo ? 
                EquipmentShared.getDurabilityInfo({max_durability: weapon.max_durability, durability: weapon.durability}) 
                : {current: weapon.durability, max: weapon.max_durability, isBroken: !weapon.durability || weapon.durability <= 0};
            
            const durabilityText = durabilityInfo.isBroken
                ? '⚠️ сломано — отремонтируйте'
                : (durabilityInfo.current < durabilityInfo.max
                    ? `🔧 ${Number(durabilityInfo.current)}/${Number(durabilityInfo.max)}`
                    : '');
            
            const rangeLabel = weapon.category === 'melee'
                ? '<div class="weapon-tag melee">ближний бой · +40% к боссам</div>'
                : '<div class="weapon-tag ranged">дальний бой · +25% в PvP</div>';
            
            const itemEl = document.createElement('div');
            itemEl.className = `weapon-item ${weapon.is_broken ? 'is-broken' : ''}`;
            itemEl.dataset.index = weapon.index;
            
            itemEl.innerHTML = `
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
                itemEl.classList.add('disabled');
            } else {
                itemEl.addEventListener('click', () => attackWithWeapon(weapon.index));
            }
            list.appendChild(itemEl);
        }
    };
    
    // Добавляем слушатели фильтров
    setTimeout(() => {
        const typeSelect = document.getElementById('filter-type');
        const minDamageInput = document.getElementById('filter-min-damage');
        const maxDurabilityInput = document.getElementById('filter-max-durability');
        const onlyUsableCheckbox = document.getElementById('filter-only-usable');
        
        if (typeSelect) typeSelect.addEventListener('change', applyFilters);
        if (minDamageInput) minDamageInput.addEventListener('input', applyFilters);
        if (maxDurabilityInput) maxDurabilityInput.addEventListener('input', applyFilters);
        if (onlyUsableCheckbox) onlyUsableCheckbox.addEventListener('change', applyFilters);
    }, 0);
    
    // Начальный рендер
    applyFilters();
}

/**
 * Общая вступительная проверка атаки по боссу.
 *
 * `lockAction` здесь НЕ используется осознанно: и attackBoss(), и
 * attackWithWeapon() работают с actionLocks.attackBoss и обязаны снимать
 * её в own finally, иначе блокировка залипала бы после неудачного запроса.
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
 * Общая для обоих путей атаки: раздельные правки гарантированно разошлись бы.
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
                        ? ' <strong style="color:var(--color-danger-bright)">сломано — отремонтируй</strong>'
                        : left <= Math.ceil(maxDurability * 0.2)
                            ? ' <strong style="color:var(--energy-color)">почти сломано</strong>'
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
        showNotification(clientErrorMessage(error, 'Ошибка атаки'), 'error');
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
    // Поле обязано быть и в payload, и в payload.data — клиент читает
    // `payload.auto_heal ?? payload.data.auto_heal`.
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
    
    // Перерисуем слоты экипировки в бою
    renderPlayerEquipmentInBossFight();
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
            color: var(--accent-red);
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
        showModal('⚠️ Ошибка', clientErrorMessage(error, 'Не удалось создать клан'));
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
        showModal('⚠️ Ошибка', clientErrorMessage(error, 'Не удалось вступить в клан'));
    } finally {
        unlockAction('clanJoin');
    }
}

/**
 * Выход из клана
 */
async function leaveClan() {
    // Выход из клана необратим (лидерство передать нельзя — сервер
    // отклоняет), поэтому подтверждаем явно. Системный confirm()
    // в Mini App заменён диалогом игры.
    const confirmed = await showConfirmDialog(
        'Ты уверен, что хочешь покинуть клан?',
        {
            title: '🏰 Выход из клана',
            confirmLabel: 'Покинуть клан',
            cancelLabel: 'Остаться',
            type: 'warning'
        }
    );
    if (!confirmed) return;
    
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
        showModal('⚠️ Ошибка', clientErrorMessage(error, 'Не удалось покинуть клан'));
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

    // Убираем возможную старую анимацию перед новой
    modal.style.animation = 'none';
    void modal.offsetWidth; // force reflow
    modal.classList.add('active');
    modal.style.display = 'flex';
    modal.style.animation = 'fade-in-up 0.3s ease-out';

    // Закрытие по клику вне окна и по крестику
    const modalClose = document.getElementById('modal-close');
    if (modalClose) {
        // Удаляем старый обработчик если есть
        modalClose.onclick = null;
        modalClose.addEventListener('click', hideModal, { once: true });
    }
    
    // Удаляем старый обработчик клика по оверлею
    modal.onclick = null;
    modal.addEventListener('click', (e) => {
        if (e.target === modal) hideModal();
    }, { once: true });
}

/**
 * Диалог пожертвования
 *
 * Раньше сумма вводилась через prompt() — системный диалог браузера.
 * В Telegram Mini App он выглядит чужеродно (светлая тема поверх
 * тёмного интерфейса, другой шрифт и кнопки) и на части клиентов
 * Telegram вообще блокируется. Поэтому ввод перенесён в обычное
 * модальное окно игры.
 */
function showDonateDialog() {
    const maxCoins = Number(gameState.player?.coins || 0);
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    if (!modal || !modalTitle || !modalMessage) return;

    modalTitle.textContent = '🏰 Пожертвование в клан';

    // Сумма подставляется числом (Number выше гарантирует), но идёт
    // через escapeAttribute для единообразия с остальной разметкой.
    // Обёртка с white-space: normal обязательна: у #modal-message стоит
    // pre-line (для текстовых сообщений), и без сброса отступы в шаблоне
    // превратились бы в видимые пробелы.
    modalMessage.innerHTML = `
        <div style="white-space:normal">
            <p style="text-align:center;margin-bottom:12px">Введи сумму в монетах</p>
            <input
                id="donate-amount-input"
                type="number"
                inputmode="numeric"
                min="1"
                max="${escapeAttribute(String(maxCoins))}"
                step="1"
                placeholder="Например, 100"
                style="width:100%;padding:12px;border-radius:10px;background:rgba(0,0,0,.35);
                       border:1px solid var(--border-color);color:var(--text-primary);
                       font-size:16px;text-align:center">
            <p style="margin-top:10px;font-size:13px;color:var(--text-secondary)">
                Доступно: ${formatNumber(maxCoins)} 🪙
            </p>
        </div>
    `;

    modal.className = 'modal';
    modal.classList.add('modal-info');
    openModalElement(modal);

    const input = document.getElementById('donate-amount-input');
    if (input) {
        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            submitDonation(input.value, maxCoins);
        });
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn modal-donate-confirm';
    confirmBtn.textContent = 'Пожертвовать';
    confirmBtn.addEventListener('click', () => submitDonation(input?.value, maxCoins));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn modal-donate-cancel';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', () => hideModal());

    modalMessage.appendChild(confirmBtn);
    modalMessage.appendChild(cancelBtn);
}

/**
 * Проверка суммы и отправка пожертвования
 * @param {string|number} rawValue ввод из поля
 * @param {number} maxCoins доступный баланс
 */
function submitDonation(rawValue, maxCoins) {
    const donateAmount = parseInt(rawValue, 10);

    if (!Number.isFinite(donateAmount) || donateAmount <= 0) {
        showModal('⚠️ Ошибка', 'Введи корректную сумму');
        return;
    }

    if (donateAmount > maxCoins) {
        showModal('⚠️ Ошибка', `Недостаточно монет. У тебя: ${formatNumber(maxCoins)}`);
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
        showModal('⚠️ Ошибка', clientErrorMessage(error, 'Не удалось отправить пожертвование'));
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
    // Цена и объём покупки — из общего файла правил, тем же файлом считает
    // сервер (routes/game/player.js). Раньше число 5 было записано здесь
    // отдельно: поднять цену на сервере, и клиент предлагал бы покупку,
    // которую сервер отклоняет с INSUFFICIENT_STARS.
    // Optional chaining + значение по умолчанию обязательны: при обращении
    // без `?.` строка упала бы с TypeError, если shared/equipment.js не
    // успел загрузиться (или отдался 404).
    const STARS_COST = window.EquipmentShared?.ENERGY_PURCHASE_STARS_COST ?? 5;

    if (!gameState.player) {
        showModal('⚠️ Ошибка', 'Данные игрока не загружены');
        return;
    }

    const playerStars = gameState.player.stars || 0;
    if (playerStars < STARS_COST) {
        // Число берётся из STARS_COST, а не пишется текстом: раньше здесь
        // стояло «Нужно 5 ⭐», и при смене цены проверка считала бы по
        // одной цифре, а игрок видел другую.
        showModal('⚠️ Внимание', `Недостаточно звёзд! Нужно ${STARS_COST} ⭐.`);
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
        showModal('⚠️ Ошибка', clientErrorMessage(error, 'Не удалось купить энергию'));
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
        // Публичный рейтинг живёт на /api/leaderboard/{players|clans} и внутри
        // перенаправляется на /minigames/leaderboard/* .
        //
        // Было apiRequest(`/rating/${type}`): такого маршрута на сервере нет
        // (нет ни /api/rating, ни соответствующего router.use), поэтому экран
        // рейтинга всегда получал 404 и показывал «Рейтинг временно недоступен».
        const data = await apiRequest(`/api/leaderboard/${type}`);

        // Сервер отдаёт массив в поле leaderboard (см. routes/game/minigames.js).
        // Старое чтение data.rating всегда давало undefined -> пустой список.
        const rating = data?.leaderboard || data?.data?.leaderboard || data?.rating || [];
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
            // Раньше здесь читалось item.total_members, но сервер отдаёт
            // members_count (см. GET /leaderboard/clans в minigames.js),
            // и рейтинг кланов показывал «undefined участников».
            // Берём members_count, с откатом на total_members для
            // совместимости со старыми кэшами клиента.
            const clanMembers = item.members_count ?? item.total_members ?? 0;
            rank.innerHTML = `
                <span class="rank rank-${i + 1}">#${i + 1}</span>
                <div class="info">
                    <div class="name">${escapeHtml(item.name)}</div>
                    <div class="stats">Уровень ${item.level} | ${clanMembers} участников</div>
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
        showNotification(clientErrorMessage(error, 'Ошибка при присоединении'), 'error');
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
        showNotification(clientErrorMessage(error, 'Ошибка при атаке'), 'error');
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
window.startRaid = startRaid;

window.restoreEnergy = restoreEnergy;
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
        // GET /api/game/player/achievements/progress — реальный маршрут
        // (routes/game/player.js). Было '/api/achievements/progress': путь без
        // монтирования -> 404 Not found, экран достижений оставался пустым.
        const data = await apiRequest('/api/game/player/achievements/progress');

        // Ответ приходит в { success, data: { progress, categories } }
        const payload = (data && data.data) || data;
        if (payload && payload.progress) {
            // Блок «Выполнено достижений X / Y» удалён: та же информация
            // стоит в каждой кнопке категории («Боссы (3/5)») и в каждой
            // карточке достижения. Отдельная шапка была третьим местом,
            // где показывалось одно и то же число.
            renderAchievementsCategories(payload.categories);

            if (category) {
                renderAchievementsList(payload.progress.filter(a => a.category === category));
            } else {
                renderAchievementsList(payload.progress);
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
        // POST /api/game/player/achievements/claim — реальный маршрут
        // (routes/game/player.js). Было '/api/achievements/claim': пути нет
        // на сервере -> 404, награду забрать было невозможно.
        const result = await apiRequest('/api/game/player/achievements/claim', {
            method: 'POST',
            body: { achievement_id: achievementId }
        });

        // Сервер отвечает { success, data: { message, new_balance } }
        const payload = result?.data || result;

        if (result.success) {
            showModal('✅ Награда получена', payload.message || 'Награда получена');
            updateBalanceDisplay(payload.new_balance);
            await loadAchievements();
        } else {
            showModal('❌ Ошибка', payload.error || result.error || 'Ошибка получения награды');
        }
    } catch (error) {
        console.error('Ошибка получения награды:', error);
        showModal('❌ Ошибка', clientErrorMessage(error, 'Ошибка получения награды'));
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
        // Текст из ответа показываем при 4xx: сервер уже объяснил причину
        // («Недостаточно энергии», «Бой уже завершён», «Вы не участник»).
        // Раньше тут стояло общее «Не удалось начать бой» — по нему игрок
        // не мог понять, что делать.
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось начать бой'));
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
        // Раньше этот catch был пустым: игрок жал «АТАКОВАТЬ», получал отказ
        // («Недостаточно энергии», «Бой уже завершён», «Вы не участник») и
        // не видел ничего — кнопка просто оставалась на месте.
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось выполнить атаку'));
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
                <!-- Игрок слева, босс справа -->
                <div class="battle-field">
                    <!-- Игрок -->
                    <div class="combatant player-side">
                        <div class="combatant-info">
                            <div class="combatant-name" id="player-name-display">Игрок</div>
                            <div class="combatant-stats">
                                <div class="stat-row">
                                    <span class="stat-label">❤️</span>
                                    <span class="stat-value" id="player-hp-display">100/100</span>
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">⚡</span>
                                    <span class="stat-value" id="player-energy-display">100/100</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Слоты экипировки (RPG-style) -->
                        <div class="equipment-slots player-equipment" id="player-equipment-slots">
                            <div class="equipment-slot" data-slot="head" title="Шлем">
                                <span class="slot-icon">🪖</span>
                                <span class="slot-name">Голова</span>
                                <div class="slot-item" data-slot="head"></div>
                                <div class="slot-durability" data-slot="head"></div>
                            </div>
                            <div class="equipment-row">
                                <div class="equipment-slot" data-slot="body" title="Нагрудник">
                                    <span class="slot-icon">🧥</span>
                                    <span class="slot-name">Тело</span>
                                    <div class="slot-item" data-slot="body"></div>
                                    <div class="slot-durability" data-slot="body"></div>
                                </div>
                                <div class="equipment-slot" data-slot="hands" title="Перчатки">
                                    <span class="slot-icon">🧤</span>
                                    <span class="slot-name">Руки</span>
                                    <div class="slot-item" data-slot="hands"></div>
                                    <div class="slot-durability" data-slot="hands"></div>
                                </div>
                            </div>
                            <div class="equipment-row">
                                <div class="equipment-slot" data-slot="legs" title="Ноги">
                                    <span class="slot-icon">👖</span>
                                    <span class="slot-name">Ноги</span>
                                    <div class="slot-item" data-slot="legs"></div>
                                    <div class="slot-durability" data-slot="legs"></div>
                                </div>
                                <div class="equipment-slot" data-slot="boots" title="Сапоги">
                                    <span class="slot-icon">🥾</span>
                                    <span class="slot-name">Ноги</span>
                                    <div class="slot-item" data-slot="boots"></div>
                                    <div class="slot-durability" data-slot="boots"></div>
                                </div>
                            </div>
                            <div class="equipment-row">
                                <div class="equipment-slot" data-slot="weapon" title="Оружие">
                                    <span class="slot-icon">⚔️</span>
                                    <span class="slot-name">Оружие</span>
                                    <div class="slot-item" data-slot="weapon"></div>
                                    <div class="slot-durability" data-slot="weapon"></div>
                                </div>
                                <div class="equipment-slot" data-slot="accessory" title="Аксессуар">
                                    <span class="slot-icon">🧭</span>
                                    <span class="slot-name">Аксес.</span>
                                    <div class="slot-item" data-slot="accessory"></div>
                                    <div class="slot-durability" data-slot="accessory"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Центр - VS -->
                    <div class="battle-center">
                        <div class="vs-label">VS</div>
                        <div class="boss-timer" id="boss-fight-timer" style="display:none">
                            <span>⏱️</span>
                            <span id="boss-timer-text">00:00:00</span>
                        </div>
                    </div>
                    
                    <!-- Босс справа -->
                    <div class="combatant boss-side">
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
                    </div>
                </div>
                
                <!-- Лог боя -->
                <div class="fight-log" id="fight-log"></div>
                
                <!-- Энергия и действия -->
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

/**
 * Каталог товаров берётся из общего файла правил (shared/equipment.js) —
 * там же, откуда его читает сервер и откуда списывает цену. Раньше в клиенте
 * стояла вторая копия с ценами: игрок видел бы одну цену, а сервер списал бы
 * другую, а проверка `player.stars < item.price` отказала бы при достаточном
 * балансе.
 *
 * Мини-игра в каталоге не продаётся — это ссылка на колесо, поэтому она
 * остаётся здесь.
 */
const SHOP_ITEMS = (() => {
    const shared = window.EquipmentShared;
    const fromShared = (category) => (shared && typeof shared.getStarShopItemsByCategory === 'function'
        ? shared.getStarShopItemsByCategory(category).map((item) => ({ ...item, currency: 'stars' }))
        : []);

    return {
        buffs: fromShared('buffs'),
        minigames: [
            { id: 'miniwheel', name: 'Колесо удачи', desc: 'Крути колесо бесплатно или за Stars', icon: '🎡', price: 0, currency: 'free', type: 'game', game: 'wheel' },
        ],
        cosmetics: fromShared('cosmetics')
    };
})();

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
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось совершить покупку'));
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
 *
 * P2: сама копия тоже берётся из общего EquipmentShared (тот же модуль,
 * что читает сервер), поэтому «молчалое расхождение» стало невозможным
 * даже до первого ответа сервера. Локальный массив ниже — подстраховка
 * на случай, если EquipmentShared не загрузился.
 */
const WHEEL_PRIZES = (window.EquipmentShared && Array.isArray(window.EquipmentShared.WHEEL_PRIZES))
    ? window.EquipmentShared.WHEEL_PRIZES.map(p => ({ type: p.type, value: p.value, text: p.text }))
    : [
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
        // «Недостаточно Stars» и «следующее вращение через N мин» — обычные
        // ответы сервера с кодом 200 и success:false, они разбираются выше.
        // Здесь приходит отказ с кодом: раньше он всегда выглядел как
        // «не удалось связаться с сервером», даже когда сервер отвечал.
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось связаться с сервером'), 'error');
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
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось связаться с сервером'), 'error');
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

    // Подтверждение покупки — диалогом игры (не системным confirm()).
    const confirmedStars = await showConfirmDialog(
        `Купить «${item.name}» за ${formatNumber(price)} звёзд?`,
        {
            title: '⭐ Покупка за звёзды',
            confirmLabel: 'Купить',
            cancelLabel: 'Отмена',
            type: 'info'
        }
    );
    if (!confirmedStars) {
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
        showNotification(clientErrorMessage(error, 'Не удалось купить за звёзды'), 'error');
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
    
    // Подтверждение покупки — диалогом игры (не системным confirm()).
    const confirmedCoins = await showConfirmDialog(
        `Купить «${item.name}» за ${formatNumber(price)} монет?`,
        {
            title: '🪙 Покупка за монеты',
            confirmLabel: 'Купить',
            cancelLabel: 'Отмена',
            type: 'info'
        }
    );
    if (!confirmedCoins) {
        return;
    }
    
    // Блокировка от двойного клика: покупка тратит монеты, и два быстрых
    // тапа отправляли бы два POST /items/buy (клиентская проверка баланса
    // успевала пройти оба раза до ответа сервера).
    if (!lockAction('buyCoinItem')) return;

    // P1-8: ключ идемпотентности со областью на конкретный предмет. Два
    // быстрых тапа по ОДНОЙ кнопке получают один ключ — сервер ответит
    // сохранённым результатом вместо второго списания. Покупка другого
    // предмета получит свой ключ и выполнится нормально.
    const buyIdempotencyKey = stableMutationKey(`buy-coin-${itemId}`, IDEMPOTENCY_WINDOW_MS);

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
        }, { idempotencyKey: buyIdempotencyKey });
        
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
        showModal('❌ Ошибка', clientErrorMessage(error, 'Не удалось купить предмет'));
    } finally {
        unlockAction('buyCoinItem');
        // Восстанавливаем ТОЛЬКО свою кнопку. Если её уже заменили
        // (перерисовка списка), трогать нечего — renderCoinShop()
        // создаст новые кнопки в корректном состоянии.
        if (button?.isConnected) button.disabled = false;
    }
}

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
    //
    // Раньше здесь стояла старая синяя палитра (#1a1a2e / #16213e /
    // #0f0f23) — та же, что была в инлайновых стилях загрузочного экрана.
    // Она же тянулась из удалённых блоков тем, где --bg-card
    // переопределялся серым. Пока интерфейс был тёплым коричневым, а фон
    // под ним синим, это читалось как два разных приложения в одном.
    // Теперь фон берёт те же тёплые тона, что и --bg-dark / --bg-secondary,
    // а ночь осталась ночью: сверху темнее, у горизонта теплее.
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, '#16130f');
    skyGrad.addColorStop(0.5, '#241f19');
    skyGrad.addColorStop(1, '#2f2820');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // Звёзды
    ctx.fillStyle = 'rgba(255, 240, 214, 0.5)';
    window.cityBackgroundStars.forEach(star => {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
    });

    // Контуры зданий (силуэты)
    ctx.fillStyle = '#100e0c';
    window.cityBackgroundBuildings.forEach(building => {
        ctx.fillRect(building.x, height - building.h, building.w, building.h);
    });
    
    // Земля
    const groundGrad = ctx.createLinearGradient(0, height - 80, 0, height);
    groundGrad.addColorStop(0, '#241f19');
    groundGrad.addColorStop(1, '#14120f');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, height - 80, width, 80);
    
    // Радиационное свечение от центра. Зелёный совпадает с
    // --radiation-color (#39ff14) — то же зелёное свечение, что и в UI.
    const centerX = width / 2;
    const centerY = height / 2;
    const radGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 200);
    radGrad.addColorStop(0, 'rgba(57, 255, 20, 0.05)');
    radGrad.addColorStop(1, 'rgba(57, 255, 20, 0)');
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
    // Заблокированная локация — не серый, а тёмный металл палитры:
    // серый #444/#666 на тёплом фоне выглядел как чужеродное пятно.
    const glowColor = loc.unlocked ? 'rgba(122, 170, 214, 0.4)' : 'rgba(90, 83, 72, 0.35)';
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
        // Сталь из палитры (--accent-blue #4a6b8a), осветлённая для читаемости
        const grad = ctx.createRadialGradient(pos.x - 10, pos.y - 10, 0, pos.x, pos.y, radius);
        grad.addColorStop(0, '#6b96bd');
        grad.addColorStop(1, '#35566f');
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = '#3a352e';
    }
    ctx.fill();
    
    // Рамка
    ctx.strokeStyle = loc.unlocked ? '#8fbde8' : '#5a5348';
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.stroke();
    
    // Иконка
    ctx.font = isHovered ? '24px serif' : '20px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(loc.icon, pos.x, pos.y);
}




// Функции частиц
window.showSparks = showSparks;
window.particles = particles;

// Функции карты
window.redrawMap = redrawMap;
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
 *
 * Исправления:
 * - Используем requestAnimationFrame для синхронизации с браузером
 * - Правильно очищаем все обработчики событий
 * - Защита от double-close и race conditions
 */
function hideModal() {
    const modal = document.getElementById('modal');
    const modalClose = document.getElementById('modal-close');
    
    if (!modal) return;
    
    // Запоминаем поколение на момент закрытия
    const generation = modalState.openGeneration;
    
    // Очищаем обработчики при закрытии
    if (modalClose) {
        modalClose.onclick = null;
        modalClose.removeEventListener('click', () => hideModal());
    }
    modal.onclick = null;
    
    // Убираем анимацию если она уже играет (защита от прерывания)
    modal.style.animation = 'none';
    // Force reflow для корректного перезапуска анимации
    void modal.offsetWidth;
    modal.style.animation = 'fadeOut 0.2s ease-out';
    
    if (modalState.closeTimer) {
        clearTimeout(modalState.closeTimer);
        modalState.closeTimer = null;
    }
    
    modalState.closeTimer = setTimeout(() => {
        modalState.closeTimer = null;
        
        // Пока открывали другое окно — не трогаем текущее
        if (generation !== modalState.openGeneration) return;
        
        // Дополнительная проверка: модалка ещё существует и не была переоткрыта
        const currentModal = document.getElementById('modal');
        if (!currentModal || currentModal !== modal) return;
        if (generation !== modalState.openGeneration) return;
        
        // Убираем анимацию перед скрытием
        modal.style.animation = 'none';
        modal.style.display = 'none';
        modal.classList.remove('active');
        
        // Очистка inline стилей анимации
        modal.style.animation = '';
        
        // Сигнал фактического закрытия. Его слушает showConfirmDialog:
        // без него отмена через крестик или клик мимо окна оставила бы
        // промис подтверждения неразрешённым навсегда.
        try {
            modal.dispatchEvent(new CustomEvent('modal:closed', { bubbles: true }));
        } catch (e) {
            console.warn('[hideModal] dispatchEvent failed:', e);
        }
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
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    container.appendChild(notification);
    
    // Удалить после duration
    setTimeout(() => {
        notification.classList.add('notification-hiding');
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
window.showKeyRewardCelebration = showKeyRewardCelebration;
window.showDamageEffect = showDamageEffect;
