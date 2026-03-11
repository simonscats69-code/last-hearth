/**
 * ============================================
 * УПРАВЛЕНИЕ ЭКРАНАМИ (Screen Management)
 * ============================================
 * Навигация между экранами приложения
 */

// Доступные экраны
const SCREENS = [
    'main',           // Главный экран
    'map',            // Карта города
    'inventory',      // Инвентарь
    'craft',          // Крафт
    'bosses',         // Боссы
    'boss-fight',     // Бой с боссом
    'clan',           // Клан
    'clans-list',     // Список кланов
    'clan-create',    // Создание клана
    'clan-chat',      // Чат клана
    'shop',           // Магазин
    'slots',          // Слоты
    'wheel',          // Колесо удачи
    'rating',         // Рейтинг
    'base',           // База
    'pvp',            // PvP
    'pvp-players',    // PvP игроки
    'pvp-fight',      // PvP бой
    'pvp-stats',      // PvP статистика
    'market',         // Рынок
    'market-create',  // Создание объявления
    'achievements',   // Достижения
    'seasons',        // Сезоны
    'referral',       // Рефералы
    'quests',         // Задания
    'profile'         // Профиль
];

/**
 * Переход на экран
 * @param {string} screenName - имя экрана
 */
function showScreen(screenName) {
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
            // Обновляем главный экран
            loadProfile();
            break;
            
        case 'map':
            // Рисуем карту
            renderLocations();
            break;
            
        case 'inventory':
            // Загружаем инвентарь
            loadInventory();
            break;
            
        case 'craft':
            // Загружаем рецепты
            loadRecipes();
            break;
            
        case 'bosses':
            // Загружаем боссов
            loadBosses();
            break;
            
        case 'shop':
            // Открываем магазин
            openShop();
            break;
            
        case 'rating':
            // Загружаем рейтинг
            loadRatings();
            break;
            
        case 'clan':
            // Загружаем клан
            loadClan();
            break;
            
        case 'base':
            // Загружаем базу
            loadBase();
            break;
            
        case 'achievements':
            // Загружаем достижения
            loadAchievements();
            break;
            
        case 'quests':
            // Загружаем задания
            loadQuests();
            break;
            
        case 'profile':
            // Загружаем профиль
            loadProfile();
            break;
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
    
    // Обработчики кнопок главного меню
    const mainButtons = {
        'map-btn': 'map',
        'inventory-btn': 'inventory',
        'btn-craft': 'craft',
        'btn-bosses': 'bosses',
        'btn-shop': 'shop',
        'btn-clan': 'clan',
        'btn-rating': 'rating',
        'btn-base': 'base',
        'btn-achievements': 'achievements',
        'btn-quests': 'quests',
        'btn-profile': 'profile'
    };
    
    for (const [btnId, screenName] of Object.entries(mainButtons)) {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => showScreen(screenName));
        }
    }
    
    // Обработчики табов (если есть)
    initTabHandlers();
}

/**
 * Инициализация табов (вкладок)
 */
function initTabHandlers() {
    // Табы рейтинга
    document.querySelectorAll('.rating-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            loadRatings(tabName);
        });
    });
    
    // Табы магазина (если ещё не инициализированы)
    if (typeof initShopHandlers === 'function') {
        initShopHandlers();
    }
}

/**
 * Показать экран загрузки
 */
function showLoadingScreen() {
    const loading = document.getElementById('loading-screen');
    if (loading) {
        loading.style.display = 'flex';
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

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ ВИДИМОСТИ
// ============================================================================

// Экспортируем расширенную версию showScreen (перезаписывает базовую из game-utils)
window.showScreen = showScreen;
window.onScreenOpen = onScreenOpen;
window.goToMain = goToMain;
window.showProfile = showProfile;
window.showBossFight = showBossFight;
window.backToBosses = backToBosses;
window.hideLoadingScreen = hideLoadingScreen;
