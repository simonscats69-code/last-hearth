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
        
        // Загружаем профиль
        await loadProfile();
        
        // Загружаем локации
        await loadLocations();

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
        } else if (error.message && error.message.includes('network') || error.message?.includes('fetch')) {
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
    
    // API возвращает { success: true, data: { ... } }
    // Нужно распаковать данные для удобного доступа
    const data = response.data || response;
    
    // Гарантируем наличие объекта статуса
    if (!data.status) {
        data.status = {};
    }
    
    // Также дублируем energy на верхний уровень для совместимости
    data.energy = data.status.energy;
    data.max_energy = data.status.max_energy;
    
    gameState.player = data;
    
    // Обновляем UI
    updateProfileUI(data);
    refreshPlayerEnergyUI();
}

const ENERGY_REGEN_INTERVAL_MS = 60 * 1000;

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
    const canNormalSearch = status.energy >= 1 && !actionLocks.searchLoot;
    const canLuckySearch = status.energy >= 2 && !actionLocks.searchLoot;

    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.disabled = !canNormalSearch;
        searchBtn.style.opacity = canNormalSearch ? '1' : '0.5';
    }

    const luckySearchBtn = document.getElementById('lucky-search-btn');
    if (luckySearchBtn) {
        luckySearchBtn.disabled = !canLuckySearch;
        luckySearchBtn.style.opacity = canLuckySearch ? '1' : '0.5';
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
    if (radiationValue) radiationValue.textContent = status.radiation || 0;
    
    const coinsValue = document.getElementById('coins-value');
    if (coinsValue) coinsValue.textContent = player.coins || 0;
    
    // Локация
    if (player.location) {
        const locationName = document.getElementById('location-name');
        const locationRadiation = document.getElementById('location-radiation');
        if (locationName) locationName.textContent = player.location.name;
        if (locationRadiation) locationRadiation.textContent = player.location.radiation;
    }
    
    // Звёзды
    const invStars = document.getElementById('inv-stars');
    const invCoins = document.getElementById('inv-coins');
    if (invStars) invStars.textContent = player.stars || 0;
    if (invCoins) invCoins.textContent = player.coins || 0;
    
    // Обновляем отображение переломов и инфекций
    updateConditionsUI(status);
}

/**
 * Обновление UI переломов и инфекций
 */
function updateConditionsUI(status) {
    const conditionsGrid = document.getElementById('conditions-grid');
    const infectionsDisplay = document.getElementById('infections-display');
    const healActions = document.getElementById('heal-actions');
    const healInfectionsBtn = document.getElementById('heal-infections-btn');
    
    if (!conditionsGrid) return;
    
    const infections = status.infections || 0;
    
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
                effect.textContent = `-${infections * 10}% XP`;
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
}

/**
 * Поиск лута (с защитой от двойного нажатия)
 * @param {boolean} useLuckySearch - использовать удвоенный шанс за 2 энергии
 */
async function searchLoot(useLuckySearch = false) {
    // Блокировка двойного нажатия
    if (actionLocks.searchLoot) return;
    actionLocks.searchLoot = true;
    
    const searchBtn = document.getElementById('search-btn');
    const luckySearchBtn = document.getElementById('lucky-search-btn');

    [searchBtn, luckySearchBtn].forEach((button) => {
        if (button) {
            button.disabled = true;
            button.classList.add('shake');
        }
    });
    
    try {
        const result = await apiRequest('/api/game/locations/search', {
            method: 'POST',
            body: { useLuckySearch }
        });
        
        if (result.success) {
            // Анимация лута если предмет найден
            if (result.found_item) {
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
            
            // Анимация
            playSound('loot');
            
        } else {
            // Обработка ошибок
            let errorMsg = result.message || result.error || 'Неизвестная ошибка';
            
            // Особая обработка для недостатка энергии
            if (result.code === 'INSUFFICIENT_ENERGY') {
                errorMsg = `Недостаточно энергии! Требуется: ${useLuckySearch ? 2 : 1}, у вас: ${result.energy || 0}`;
            }
            
            showModal('⚠️ Внимание', errorMsg);
        }
        
    } catch (error) {
        console.error('Search error:', error);
        showModal('❌ Ошибка', 'Не удалось выполнить поиск');
    } finally {
        [searchBtn, luckySearchBtn].forEach((button) => {
            if (button) {
                button.classList.remove('shake');
            }
        });
        actionLocks.searchLoot = false;
        refreshPlayerEnergyUI();
    }
}

/**
 * Переход к локации
 */
async function moveToLocation(locationId) {
    try {
        const response = await apiRequest('/api/game/locations/move', {
            method: 'POST',
            body: { location_id: locationId }
        });
        const result = response.data || response;
        
        if (result.success) {
            gameState.player.current_location_id = result.location?.id || locationId;
            gameState.player.location = result.location;
            updateProfileUI(gameState.player);
            showScreen('main');
            showModal('✅ Успех', result.message);
        } else {
            showModal('⚠️ Внимание', result.message);
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
// СИСТЕМА КРАФТА
// ============================================================================

/**
 * Загрузка рецептов крафта
 */
async function loadRecipes() {
    try {
        const data = await apiRequest('/api/game/crafting/recipes');
        
        // Обрабатываем разные форматы ответа
        const recipes = data?.data?.recipes || data?.recipes || [];
        gameState.recipes = recipes;
        
        // Обновляем энергию
        const craftEnergy = document.getElementById('craft-energy');
        if (craftEnergy && gameState.player) {
            craftEnergy.textContent = gameState.player.status?.energy || 0;
        }
        
        renderRecipes(recipes);
    } catch (error) {
        console.error('Recipes error:', error);
        
        // При ошибке показываем пустой список
        gameState.recipes = [];
        const list = document.getElementById('recipes-list');
        if (list) {
            list.innerHTML = '<div class="empty-message">Не удалось загрузить рецепты</div>';
        }
        
        // Показываем уведомление об ошибке
        showNotification('Ошибка загрузки рецептов', 'error');
    }
}

/**
 * Отрисовка рецептов крафта
 */
function renderRecipes(recipes) {
    const list = document.getElementById('recipes-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (!recipes || recipes.length === 0) {
        list.innerHTML = '<div class="empty-message">Нет доступных рецептов</div>';
        return;
    }
    
    for (const recipe of recipes) {
        const item = document.createElement('div');
        item.className = `recipe-item ${recipe.can_craft ? '' : 'locked'}`;
        
        // Формируем строку ингредиентов
        const ingredientsHtml = recipe.ingredients.map(ing => {
            const have = ing.have || 0;
            const need = ing.quantity;
            const hasEnough = have >= need;
            return `<span class="ingredient ${hasEnough ? '' : 'missing'}">${ing.icon || ''} ${have}/${need}</span>`;
        }).join('');
        
        item.innerHTML = `
            <div class="recipe-header">
                <span class="recipe-icon">${recipe.icon}</span>
                <div class="recipe-info">
                    <div class="recipe-name">${recipe.name}</div>
                    <div class="recipe-level">⬆️ Требуется уровень: ${recipe.required_level}</div>
                </div>
                <div class="recipe-result">
                    <span>→ ${recipe.icon} x${recipe.result_quantity}</span>
                </div>
            </div>
            <div class="recipe-ingredients">
                <span class="ingredients-label">Ингредиенты:</span>
                ${ingredientsHtml}
            </div>
            <button class="craft-btn ${recipe.can_craft ? '' : 'disabled'}" 
                    data-recipe-id="${recipe.id}" ${!recipe.can_craft ? 'disabled' : ''}>
                ${recipe.can_craft ? '🔨 Скрафтить (1 ⚡)' : '❌ Недостаточно материалов'}
            </button>
        `;
        
        // Обработчик крафта
        const btn = item.querySelector('.craft-btn');
        btn.addEventListener('click', () => craftItem(recipe.id));
        
        list.appendChild(item);
    }
}

/**
 * Крафт предмета
 */
async function craftItem(recipeId) {
    if (!lockAction('crafting')) return;
    try {
        const data = await apiRequest('/api/game/crafting/', {
            method: 'POST',
            body: { recipe_id: recipeId }
        });
        
        if (data.success) {
            showModal('✅ Успех', data.message);
            // Обновляем данные
            if (gameState.player && data.new_energy !== undefined) {
                gameState.player.energy = data.new_energy;
            }
            loadRecipes(); // Перезагружаем рецепты
        } else {
            showModal('❌ Ошибка', data.message);
        }
    } catch (error) {
        console.error('Craft error:', error);
        showModal('❌ Ошибка', 'Не удалось выполнить крафт');
    } finally {
        unlockAction('crafting');
    }
}

/**
 * Использование предмета
 */
async function useItem(itemId) {
    if (!lockAction('useItem')) return;
    try {
        const result = await apiRequest('/api/game/inventory/use-item', {
            method: 'POST',
            body: { item_id: parseInt(itemId) }
        });
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            
            // Обновляем инвентарь и профиль
            await loadInventory();
            await loadProfile();
            
            playSound('use');
        } else {
            showModal('⚠️ Внимание', result.message);
        }
    } catch (error) {
        console.error('Use item error:', error);
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
        const data = await apiRequest('/api/game/inventory');
        gameState.inventory = data.items;
        
        // Обновляем статистику
        const invCoins = document.getElementById('inv-coins');
        const invStars = document.getElementById('inv-stars');
        if (invCoins) invCoins.textContent = data.coins || 0;
        if (invStars) invStars.textContent = data.stars || 0;
        
        // Применяем фильтр и сортировку
        renderInventoryWithFilters(data.items);
        
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
    
    // Сортируем предметы по ID
    const sortedItems = Object.entries(items).sort((a, b) => a[0] - b[0]);
    
    for (const [itemId, item] of sortedItems) {
        const slot = document.createElement('div');
        slot.className = `inventory-slot item-rarity rarity-${item.rarity || 'common'}`;
        slot.innerHTML = `
            <span class="item-icon">${item.icon}</span>
            <span class="item-count">${item.count}</span>
        `;
        
        // Обработчик клика - использовать предмет
        slot.addEventListener('click', () => useItem(itemId));
        
        grid.appendChild(slot);
    }
}

/**
 * Отрисовка инвентаря с учётом фильтра и сортировки
 */
function renderInventoryWithFilters(items) {
    if (!items) {
        renderInventory({});
        return;
    }
    
    // Фильтрация предметов
    let filteredItems = Object.entries(items);
    
    if (typeof currentInventoryFilter !== 'undefined' && currentInventoryFilter !== 'all') {
        filteredItems = filteredItems.filter(([itemId, item]) => {
            const category = getItemCategory(itemId);
            return category === currentInventoryFilter;
        });
    }
    
    // Сортировка предметов
    const sortKey = typeof currentInventorySort !== 'undefined' ? currentInventorySort : 'id';
    filteredItems.sort((a, b) => {
        const [idA, itemA] = a;
        const [idB, itemB] = b;
        
        switch (sortKey) {
            case 'name':
                return (itemA.name || '').localeCompare(itemB.name || '');
            case 'rarity':
                const rarityOrder = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
                const rA = rarityOrder[itemA.rarity] || 0;
                const rB = rarityOrder[itemB.rarity] || 0;
                return rB - rA;
            case 'count':
                return (itemB.count || 0) - (itemA.count || 0);
            case 'id':
            default:
                return parseInt(idA) - parseInt(idB);
        }
    });
    
    // Создаём отфильтрованный объект
    const filteredObject = Object.fromEntries(filteredItems);
    renderInventory(filteredObject);
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
        // Загружаем боссов через новый API
        const data = await apiRequest('/game/bosses');
        
        // Обрабатываем разные форматы ответа API
        // Сервер возвращает: { success: true, data: { bosses: [...] } }
        if (data && data.data && data.data.bosses) {
            gameState.bosses = data.data.bosses;
        } else if (data && data.bosses) {
            // Альтернативный формат: { bosses: [...] }
            gameState.bosses = data.bosses;
        } else if (Array.isArray(data)) {
            // Формат напрямую: массив боссов
            gameState.bosses = data;
        } else {
            // Неизвестный формат - используем пустой массив
            console.warn('[loadBosses] Неизвестный формат ответа:', data);
            gameState.bosses = [];
        }
        
        // Обновляем информацию об энергии игрока
        const playerEnergy = data?.data?.player_energy ?? data?.player_energy;
        if (playerEnergy !== undefined) {
            syncPlayerEnergyState(
                playerEnergy,
                data?.data?.player_max_energy ?? data?.player_max_energy ?? 100
            );
            refreshPlayerEnergyUI();
        }
        
        renderBosses(gameState.bosses);
    } catch (error) {
        console.error('Bosses error:', error);
        // При ошибке показываем пустой список
        gameState.bosses = [];
        renderBosses([]);
    }
}

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
        // Используем новые поля или fallback на старые
        const isUnlocked = boss.is_unlocked ?? boss.unlocked ?? false;
        const canAttack = boss.can_attack !== false;
        const playerKeys = boss.player_keys ?? boss.keys_owned ?? 0;
        const keysRequired = boss.keys_required ?? 1;
        const mastery = boss.mastery ?? 0;
        const maxMastery = boss.max_mastery || 5; // Максимум 5 убийств для полного мастерства
        
        const item = document.createElement('div');
        item.className = `boss-item ${isUnlocked ? '' : 'locked'} ${canAttack && isUnlocked ? 'available' : 'unavailable'}`;
        
        // Генерируем звёзды мастерства
        let masteryStars = '';
        for (let i = 0; i < maxMastery; i++) {
            masteryStars += i < mastery ? '⭐' : '☆';
        }
        
        // Формируем HTML карточки босса
        item.innerHTML = `
            <div class="boss-icon">${boss.icon}</div>
            <div class="boss-info">
                <div class="boss-name">${boss.name}</div>
                <div class="boss-desc">${boss.description || ''}</div>
                <div class="boss-mastery">
                    <span class="mastery-label">Убийств: ${mastery}</span>
                    <span class="mastery-stars">${masteryStars}</span>
                </div>
                <div class="boss-reward">💰 ${boss.reward_coins || 0} | ✨ ${boss.reward_experience || 0} XP</div>
                ${!isUnlocked ? `
                    <div class="boss-keys">
                        <span class="keys-owned">🔑 ${playerKeys}/${keysRequired}</span>
                        <span class="keys-needed">нужно ${keysRequired} ключей</span>
                    </div>
                ` : `
                    <div class="boss-keys unlocked">
                        <span class="keys-owned">🔑 ${playerKeys} ключей</span>
                    </div>
                `}
            </div>
            <div class="boss-actions">
                ${canAttack && isUnlocked ? 
                    `<button class="attack-btn" data-boss-id="${boss.id}">⚔️ Атаковать</button>` :
                    !isUnlocked ?
                    `<button class="attack-btn disabled" disabled>🔒 Заблокировано</button>` :
                    `<button class="attack-btn disabled" disabled>⚡ Нет энергии</button>`
                }
            </div>
        `;
        
        // Клик по боссу - открываем экран боя
        item.addEventListener('click', (e) => {
            // Игнорируем клик на кнопку
            if (e.target.classList.contains('attack-btn')) return;
            
            if (isUnlocked) {
                startBossFight(boss);
            } else {
                showModal('🔒 Заблокировано', `Нужно ${keysRequired} ключей от предыдущего босса\nУ вас есть: ${playerKeys} ключей`);
            }
        });
        
        // Обработчик кнопки атаки
        const attackBtn = item.querySelector('.attack-btn');
        if (attackBtn && canAttack && isUnlocked) {
            attackBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startBossFight(boss);
            });
        }
        
        list.appendChild(item);
    }
}

/**
 * Начало боя с боссом - обновлённый UI с кнопками атаки
 */
function startBossFight(boss) {
    gameState.currentBoss = boss;
    
    const bossName = document.getElementById('boss-name');
    const bossIcon = document.getElementById('boss-icon');
    const bossHealthText = document.getElementById('boss-health-text');
    const bossHealthBar = document.getElementById('boss-health-bar');
    const fightLog = document.getElementById('fight-log');
    
    if (bossName) bossName.textContent = boss.name;
    if (bossIcon) {
        bossIcon.textContent = boss.icon;
        bossIcon.classList.remove('damage-shake');
    }
    if (bossHealthText) bossHealthText.textContent = `${boss.health || boss.max_health}/${boss.max_health}`;
    if (bossHealthBar) bossHealthBar.style.width = '100%';
    if (fightLog) {
        fightLog.innerHTML = `
            <p class="fight-start">🎯 Бой с <strong>${boss.name}</strong> начался!</p>
            <p>Выбери количество атак:</p>
        `;
    }
    
    // Показываем кнопку атаки
    const attackSingleBtn = document.getElementById('attack-boss-btn');
    const progressContainer = document.getElementById('attack-progress-container');
    
    if (attackSingleBtn) {
        attackSingleBtn.style.display = 'inline-flex';
        attackSingleBtn.textContent = '⚔️ Атаковать (1 ⚡)';
    }
    
    // Скрываем прогресс
    if (progressContainer) progressContainer.style.display = 'none';
    
    // Добавляем обработчики кнопок если ещё не добавлены
    if (attackSingleBtn && !attackSingleBtn.hasAttribute('data-handler')) {
        attackSingleBtn.setAttribute('data-handler', 'true');
        attackSingleBtn.addEventListener('click', attackBoss);
    }
    
    // Показываем экран боя
    showScreen('boss-fight');
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
    if (!status || status.energy < 1) {
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
            const hpPercent = (result.boss_hp / result.boss_max_hp) * 100;
            const bossHealthBar = document.getElementById('boss-health-bar');
            const bossHealthText = document.getElementById('boss-health-text');
            if (bossHealthBar) bossHealthBar.style.width = `${hpPercent}%`;
            if (bossHealthText) bossHealthText.textContent = `${result.boss_hp}/${result.boss_max_hp}`;
            
            // Обновляем энергию игрока
            const energyUsed = document.getElementById('boss-energy-used');

            syncPlayerEnergyState(result.player_energy, gameState.player?.status?.max_energy);
            refreshPlayerEnergyUI();

            if (energyUsed) {
                energyUsed.textContent = '-1';
                energyUsed.classList.add('show');
                setTimeout(() => energyUsed.classList.remove('show'), 500);
            }
            
            // Сохраняем текущее HP в state
            gameState.currentBoss.health = result.boss_hp;
            gameState.currentBoss.max_health = result.boss_max_hp;
            
            // Проверка на победу
            if (result.boss_defeated) {
                playSound('victory');
                
                // Показываем награды
                let rewardText = '';
                if (result.rewards) {
                    if (result.rewards.coins) rewardText += `💰 +${result.rewards.coins} монет\n`;
                    if (result.rewards.experience) rewardText += `✨ +${result.rewards.experience} XP\n`;
                    if (result.rewards.key) rewardText += `🔑 Получен ключ от ${result.rewards.key.boss_name}!\n`;
                    if (result.rewards.items && result.rewards.items.length > 0) {
                        result.rewards.items.forEach(item => {
                            rewardText += `${item.icon} +${item.quantity} ${item.name}\n`;
                        });
                    }
                }
                
                showModal('🏆 ПОБЕДА!', 
                    `Ты победил ${gameState.currentBoss.name}!\n\n` +
                    `Награда:\n${rewardText || 'Без награды'}`
                );
                
                // Обновляем мастерство
                if (result.mastery !== undefined) {
                    const masteryText = document.createElement('p');
                    masteryText.className = 'mastery-gain';
                    masteryText.innerHTML = `<span class="star">⭐</span> Мастерство: ${result.mastery}`;
                    if (log) log.appendChild(masteryText);
                }
                
                // Загружаем новых боссов
                await loadBosses();
                
                setTimeout(() => {
                    showScreen('bosses');
                }, 3000);
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
            btn.textContent = '⚔️ Атаковать (1 ⚡)';
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
            ${clan.description ? `<p class="clan-description">${clan.description}</p>` : ''}
            <div class="clan-stats">
                <div class="clan-stat">
                    <span class="stat-icon">👥</span>
                    <span class="stat-value">${clan.total_members}</span>
                    <span class="stat-label">Участников</span>
                </div>
                <div class="clan-stat">
                    <span class="stat-icon">💰</span>
                    <span class="stat-value">${clan.coins}</span>
                    <span class="stat-label">Казна</span>
                </div>
                <div class="clan-stat">
                    <span class="stat-icon">✨</span>
                    <span class="stat-value">${clan.loot_bonus}%</span>
                    <span class="stat-label">Бонус добычи</span>
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
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            if (nameInput) nameInput.value = '';
            if (descInput) descInput.value = '';
            showScreen('clan');
            loadClan();
        } else {
            showModal('⚠️ Ошибка', result.message);
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
        renderClansList(data.clans);
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
    
    renderList(
        list,
        clans,
        (clan) => {
            return '<div class="clan-list-item" data-clan-id="' + clan.id + '">' +
                '<div class="clan-list-icon">🏰</div>' +
                '<div class="clan-list-info">' +
                    '<div class="clan-list-name">' + clan.name + '</div>' +
                    '<div class="clan-list-stats">👥 ' + (clan.member_count || 1) + ' | Уровень ' + clan.level + '</div>' +
                '</div>' +
                '<button class="join-btn" data-clan-id="' + clan.id + '">Вступить</button>' +
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
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            if (!result.application_pending) {
                showScreen('clan');
                loadClan();
            }
        } else {
            showModal('⚠️ Ошибка', result.message);
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
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            clanState.clan = null;
            loadClan();
        } else {
            showModal('⚠️ Ошибка', result.message);
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
        if (data.success) showClanMembersModal(data.members);
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
        
        if (result.success) {
            showModal('✅ Успех', `Пожертвование принято! Вы пожертвовали ${amount} монет.`);
            gameState.player.coins -= amount;
            loadClan();
        } else {
            showModal('⚠️ Ошибка', result.message);
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
        if (data.success) renderClanChat(data.data.messages);
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
    
    renderList(
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
// СИСТЕМА БАЗЫ
// ============================================================================

/**
 * Загрузка базы игрока
 */
async function loadBase() {
    try {
        const baseData = await apiRequest('/api/game/base');
        const buildingsData = await apiRequest('/api/game/base/buildings');
        
        renderBaseBonuses(baseData);
        renderPlayerBuildings(baseData.buildings);
        renderAvailableBuildings(buildingsData.buildings);
        
    } catch (error) {
        console.error('Ошибка загрузки базы:', error);
    }
}

/**
 * Отображение бонусов базы
 */
function renderBaseBonuses(baseData) {
    const bonusesGrid = document.getElementById('bonuses-grid');
    if (!bonusesGrid) return;
    const bonuses = baseData.total_bonuses || {};
    
    if (Object.keys(bonuses).length === 0) {
        bonusesGrid.innerHTML = '<p class="no-bonuses">Постройте здания для получения бонусов</p>';
        return;
    }
    
    const bonusLabels = {
        inventory_limit: 'Лимит инвентаря',
        health_regen: 'Регенерация HP',
        storage: 'Хранилище',
        craft_level: 'Уровень крафта',
        repair_bonus: 'Бонус ремонта',
        weapon_craft: 'Крафт оружия',
        medicine_craft: 'Крафт медикаментов',
        food_production: 'Производство еды'
    };
    
    const bonusIcons = {
        inventory_limit: '🎒',
        health_regen: '❤️+',
        storage: '📦',
        craft_level: '🔨',
        repair_bonus: '🔧',
        weapon_craft: '⚔️',
        medicine_craft: '💊',
        food_production: '🍞'
    };
    
    bonusesGrid.innerHTML = Object.entries(bonuses).map(([key, value]) => `
        <div class="bonus-item">
            <span class="bonus-icon">${bonusIcons[key] || '✨'}</span>
            <span class="bonus-name">${bonusLabels[key] || key}</span>
            <span class="bonus-value">+${value}</span>
        </div>
    `).join('');
}

/**
 * Отображение построек игрока
 */
function renderPlayerBuildings(buildings) {
    const buildingsList = document.getElementById('buildings-list');
    if (!buildingsList) return;
    
    if (!buildings || buildings.length === 0) {
        buildingsList.innerHTML = '<p class="no-buildings">У вас пока нет построек</p>';
        return;
    }
    
    buildingsList.innerHTML = buildings.map(b => `
        <div class="player-building-item" style="border-left: 4px solid ${b.color}">
            <div class="building-header">
                <span class="building-icon">${b.icon}</span>
                <span class="building-name">${b.name}</span>
                <span class="building-level">Уровень ${b.level}</span>
            </div>
            <div class="building-bonuses">
                ${Object.entries(b.bonuses || {}).map(([key, value]) => 
                    `<span class="bonus">+${value} ${key}</span>`
                ).join('')}
            </div>
            ${b.level < b.max_level ? `
                <button class="upgrade-btn" onclick="upgradeBuilding('${b.code}')">
                    Улучшить (${b.upgrade_cost?.coins || 0}💰)
                </button>
            ` : '<span class="max-level">Макс. уровень</span>'}
        </div>
    `).join('');
}

/**
 * Отображение доступных построек
 */
function renderAvailableBuildings(buildings) {
    const availableList = getEl('available-list');
    if (!availableList) return;
    
    if (!buildings || buildings.length === 0) {
        availableList.innerHTML = '<p>Нет доступных построек</p>';
        return;
    }
    
    availableList.innerHTML = buildings.map((b) => renderAvailableBuildingCard(b, true)).join('');
    
    // Добавляем обработчики для табов
    document.querySelectorAll('.build-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.build-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filterBuildings(tab.dataset.tab, buildings);
        });
    });
}

/**
 * Фильтрация построек по типу
 */
function filterBuildings(type, buildings) {
    const availableList = getEl('available-list');
    if (!availableList) return;
    
    const filtered = type === 'all' 
        ? buildings 
        : buildings.filter(b => b.type === type);
    
    if (filtered.length === 0) {
        availableList.innerHTML = '<p>Нет построек этого типа</p>';
        return;
    }
    
    availableList.innerHTML = filtered.map((b) => renderAvailableBuildingCard(b, false)).join('');
}

/**
 * Постройка или улучшение здания
 */
async function buildBuilding(buildingCode) {
    try {
        const result = await apiRequest('/api/game/base/build', {
            method: 'POST',
            body: { building_code: buildingCode }
        });
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            playSound('loot');
            loadBase();
            loadProfile();
        } else {
            showModal('❌ Ошибка', result.message);
        }
    } catch (error) {
        console.error('Ошибка постройки:', error);
    }
}

/**
 * Улучшение здания (алиас)
 */
async function upgradeBuilding(buildingCode) {
    return buildBuilding(buildingCode);
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
        const result = await apiRequest('/api/game/energy/buy-energy', {
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
// РЕКЛАМА
// ============================================================================

/**
 * Запуск рекламы AdsGram
 */
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
    
    try {
        const result = await apiRequest('/api/game/status/heal', {
            method: 'POST',
            body: { type: 'debuff', use_stars: false }
        });
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            await loadProfile();
        } else if (result.has_antidote === false && result.stars_price) {
            showModal('⚠️ Нет антидота', result.message + '\n\nХотите лечить за Stars?');
        } else {
            showModal('⚠️ Внимание', result.message);
        }
    } catch (error) {
        console.error('Ошибка лечения:', error);
    }
}

// ============================================================================
// АНИМАЦИИ И ЭФФЕКТЫ
// ============================================================================

/**
 * Визуальный эффект при получении лута
 */
function showLootAnimation(item) {
    const container = document.getElementById('loading-screen') || document.body;
    
    const lootEl = document.createElement('div');
    lootEl.className = 'loot-animation';
    lootEl.innerHTML = `
        <div class="loot-icon">${item.icon || '📦'}</div>
        <div class="loot-name">${item.name || 'Предмет'}</div>
    `;
    
    container.appendChild(lootEl);
    
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
    if (app) {
        app.style.animation = 'damageFlash 0.3s';
        setTimeout(() => {
            app.style.animation = '';
        }, 300);
    }
}


/**
 * Звуковые эффекты (упрощённо)
 */
function playSound(type) {
    if (navigator.vibrate) {
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
                navigator.vibrate(100);
                break;
        }
    }
}

/**
 * Обновление отображения баланса игрока
 */
function updateBalanceDisplay(newCoins) {
    const balanceElements = document.querySelectorAll('.balance-value, #user-balance, .coins-display');
    balanceElements.forEach(el => {
        if (el) el.textContent = formatNumber(newCoins);
    });
    if (gameState?.player) gameState.player.coins = newCoins;
}


/**
 * Загрузка списка заданий
 */
async function loadQuests() {
    // Задания теперь отдельная система, возвращаем пустой список
    return { tasks: [] };
}

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
window.loadRecipes = loadRecipes;
window.renderRecipes = renderRecipes;
window.craftItem = craftItem;
window.useItem = useItem;
window.loadInventory = loadInventory;
window.renderInventory = renderInventory;
window.renderInventoryWithFilters = renderInventoryWithFilters;
window.loadBosses = loadBosses;
window.renderBosses = renderBosses;
window.startBossFight = startBossFight;
window.attackBoss = attackBoss;

// =============================================================================
// РЕЙДЫ БОССОВ (МУЛЬТИПЛЕЕР)
// =============================================================================

/**
 * Загрузка активных рейдов
 */
async function loadRaids() {
    try {
        const data = await apiRequest('/api/game/bosses/raids');
        gameState.raids = data.raids || [];
        gameState.raidsParticipating = data.participating_boss_ids || [];
        return data;
    } catch (error) {
        console.error('Ошибка загрузки рейдов:', error);
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
        const isParticipating = gameState.raidsParticipating?.includes(raid.boss.id);
        
        return `
            <div class="raid-item" data-raid-id="${raid.id}" data-boss-id="${raid.boss.id}">
                <div class="raid-boss-icon">${raid.boss.icon || '👾'}</div>
                <div class="raid-info">
                    <div class="raid-boss-name">${raid.boss.name}</div>
                    <div class="raid-hp-bar">
                        <div class="raid-hp-fill" style="width: ${hpPercent}%"></div>
                    </div>
                    <div class="raid-hp-text">${formatNumber(raid.hp)} / ${formatNumber(raid.max_hp)} (${hpPercent}%)</div>
                    <div class="raid-leader">Лидер: ${raid.leader?.name || 'Неизвестно'}</div>
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
 * Начать рейд или одиночную атаку
 * @param {number} bossId - ID босса
 * @param {boolean} isRaid - true = мультиплеер, false = одиночный
 */
async function startRaid(bossId, isRaid = true) {
    try {
        const result = await apiRequest('/api/game/bosses/raid/start', {
            method: 'POST',
            body: { boss_id: bossId, is_raid: isRaid }
        });
        
        if (result.success) {
            showNotification(isRaid ? 'Рейд начат!' : 'Атака начата!', 'success');
            
            // Обновляем список рейдов
            if (isRaid) {
                await loadRaids();
                renderRaids(gameState.raids);
            }
            
            // Если одиночная атака - показываем экран боя
            if (!isRaid) {
                startBossFight(result.data.boss);
            }
        } else {
            showNotification(result.error || 'Ошибка', 'error');
        }
        
        return result;
    } catch (error) {
        console.error('Ошибка начала рейда:', error);
        showNotification('Ошибка при начале рейда', 'error');
    }
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
        
        if (result.success) {
            showNotification('Вы присоединились к рейду!', 'success');
            
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
    try {
        lockAction('attack');
        
        const result = await apiRequest(`/api/game/bosses/raid/${raidId}/attack`, {
            method: 'POST'
        });
        
        if (result.success) {
            const data = result.data;
            
            // Показываем урон
            showDamageAnimation(data.damage);
            
            // Обновляем UI рейда
            await loadRaids();
            renderRaids(gameState.raids);
            
            // Если босс убит
            if (data.killed) {
                showVictoryModal(data.rewards);
            }
        } else {
            showNotification(result.error || 'Ошибка атаки', 'error');
        }
        
        return result;
    } catch (error) {
        console.error('Ошибка атаки в рейде:', error);
        showNotification('Ошибка при атаке', 'error');
    } finally {
        unlockAction('attack');
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
window.loadBase = loadBase;
window.renderBaseBonuses = renderBaseBonuses;
window.renderPlayerBuildings = renderPlayerBuildings;
window.renderAvailableBuildings = renderAvailableBuildings;
window.filterBuildings = filterBuildings;
window.buildBuilding = buildBuilding;
window.upgradeBuilding = upgradeBuilding;
window.restoreEnergy = restoreEnergy;
window.loadRating = loadRating;
window.renderRating = renderRating;
window.watchAd = watchAd;
window.healInfections = healInfections;
window.showLootAnimation = showLootAnimation;
window.showDamageEffect = showDamageEffect;
window.playSound = playSound;
window.updateBalanceDisplay = updateBalanceDisplay;
window.loadQuests = loadQuests;
