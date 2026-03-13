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
            // Обновляем главный экран (данные уже загружены)
            renderMain();
            break;
            
        case 'map':
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
            loadRating();
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
            // Профиль уже загружен, обновляем UI из кэша
            if (gameState.player) {
                updateProfileUI(gameState.player);
            }
            break;
    }
}

/**
 * Отрисовка главного экрана
 * Обновляет все элементы главного экрана на основе данных игрока
 */
function renderMain() {
    // Вызываем базовое обновление UI
    if (typeof updateUI === 'function') {
        updateUI();
    }
    
    const player = gameState.player;
    if (!player) return;
    
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
    
    // Обновляем звание/ранг
    const rankEl = document.getElementById('player-rank');
    if (rankEl) {
        const rank = getPlayerRank(player.level || 1);
        rankEl.textContent = rank;
    }
    
    // Обновляем здоровье
    const healthBar = document.getElementById('health-bar');
    const healthText = document.getElementById('health-text');
    if (healthBar || healthText) {
        const hp = player.hp || player.health || 100;
        const maxHp = player.max_hp || player.maxHealth || 100;
        const percent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
        if (healthBar) healthBar.style.width = percent + '%';
        if (healthText) healthText.textContent = `${Math.floor(hp)}/${maxHp}`;
    }
    
    // Обновляем энергию
    const energyBar = document.getElementById('energy-bar');
    const energyText = document.getElementById('energy-text');
    if (energyBar || energyText) {
        const energy = player.energy || 100;
        const maxEnergy = player.max_energy || player.maxEnergy || 100;
        const percent = Math.max(0, Math.min(100, (energy / maxEnergy) * 100));
        if (energyBar) energyBar.style.width = percent + '%';
        if (energyText) energyText.textContent = `${Math.floor(energy)}/${maxEnergy}`;
    }
    
    // Обновляем монеты
    const coinsEl = document.getElementById('coins-value');
    if (coinsEl) {
        coinsEl.textContent = player.coins || 0;
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
    
    // Обновляем дебаффы
    const status = player.status || {};
    
    // Радиация
    const radiationValue = document.getElementById('radiation-value');
    const radiationBar = document.getElementById('debuff-radiation-bar');
    if (radiationValue) {
        const rad = status.radiation || 0;
        radiationValue.textContent = typeof rad === 'object' ? (rad.level || 0) : rad;
    }
    if (radiationBar) {
        const rad = status.radiation || 0;
        const radLevel = typeof rad === 'object' ? (rad.level || 0) : rad;
        radiationBar.style.width = Math.min(100, radLevel * 10) + '%';
    }
    
    // Инфекция
    const infectionValue = document.getElementById('infection-value');
    const infectionBar = document.getElementById('debuff-infection-bar');
    if (infectionValue) {
        const inf = status.infection || 0;
        infectionValue.textContent = typeof inf === 'object' ? (inf.level || 0) : inf;
    }
    if (infectionBar) {
        const inf = status.infection || 0;
        const infLevel = typeof inf === 'object' ? (inf.level || 0) : inf;
        infectionBar.style.width = Math.min(100, infLevel * 10) + '%';
    }
    
    // Обновляем отображение переломов
    const brokenBonesDisplay = document.getElementById('broken-bones-display');
    const brokenBonesText = document.getElementById('broken-bones-text');
    const conditionsGrid = document.getElementById('conditions-grid');
    const brokenBones = status.broken_bones || 0;
    if (brokenBones > 0) {
        if (brokenBonesDisplay) brokenBonesDisplay.style.display = 'flex';
        if (brokenBonesText) brokenBonesText.textContent = `Переломы: ${brokenBones}`;
        if (conditionsGrid) conditionsGrid.style.display = 'flex';
    } else {
        if (brokenBonesDisplay) brokenBonesDisplay.style.display = 'none';
    }
    
    // Обновляем отображение инфекций
    const infectionsDisplay = document.getElementById('infections-display');
    const infections = status.infections || 0;
    if (infections > 0) {
        if (infectionsDisplay) infectionsDisplay.style.display = 'flex';
        if (conditionsGrid) conditionsGrid.style.display = 'flex';
    } else {
        if (infectionsDisplay) infectionsDisplay.style.display = 'none';
    }
    
    // Скрываем conditions-grid если нет активных состояний
    if (brokenBones === 0 && infections === 0 && conditionsGrid) {
        conditionsGrid.style.display = 'none';
    }
    
    // Обновляем панель дебаффов если есть активные
    const hasDebuffs = (status.radiation || 0) > 0 || (status.infection || 0) > 0;
    const debuffsPanel = document.getElementById('debuffs-panel');
    if (debuffsPanel) {
        debuffsPanel.style.display = hasDebuffs ? 'block' : 'none';
    }
    
    // Обновляем кнопку поиска (доступность)
    const playerEnergy = gameState?.player?.energy ?? 0;
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.disabled = playerEnergy < 1;
        searchBtn.style.opacity = playerEnergy < 1 ? '0.5' : '1';
    }
    
    console.log('[renderMain] Главный экран обновлён');
}

/**
 * Получить звание игрока по уровню
 * @param {number} level - уровень игрока
 * @returns {string} звание
 */
function getPlayerRank(level) {
    if (level >= 50) return 'Легенда';
    if (level >= 40) return 'Мастер выживания';
    if (level >= 30) return 'Охотник';
    if (level >= 20) return 'Выживший';
    if (level >= 10) return 'Искатель';
    return 'Новичок';
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
            loadRating(tabName);
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

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ ВИДИМОСТИ
// ============================================================================

// Экспортируем расширенную версию showScreen (перезаписывает базовую из game-utils)
window.showScreen = showScreen;
window.onScreenOpen = onScreenOpen;
window.renderMain = renderMain;
window.getPlayerRank = getPlayerRank;
window.goToMain = goToMain;
window.showProfile = showProfile;
window.showBossFight = showBossFight;
window.backToBosses = backToBosses;
window.hideLoadingScreen = hideLoadingScreen;
