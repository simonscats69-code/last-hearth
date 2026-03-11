/**
 * Последний Очаг - Основной клиентский скрипт
 * Telegram Mini App
 */

// Инициализация Telegram WebApp (с проверкой для разработки вне Telegram)
// Примечание: expand() и ready() вызываем в initGame() после загрузки всех скриптов
const tg = window.Telegram?.WebApp || {
    expand: () => {},
    ready: () => {},
    themeParams: {},
    initDataUnsafe: { user: {} },
    HapticFeedback: null,
    sendData: () => {},
    close: () => {}
};

// Определение цветовой схемы Telegram
function isColorDark(hexColor) {
    if (!hexColor) return false;
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128;
}

const isDarkTheme = tg.themeParams && tg.themeParams.bg_color 
    ? isColorDark(tg.themeParams.bg_color)
    : false;

// Применяем тему Telegram
if (isDarkTheme) {
    document.documentElement.setAttribute('data-theme', 'dark');
}

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

// Конфигурация
const API_URL = 'https://last-hearth.bothost.ru';
const ADSGRAM_APP_ID = window.ADSGRAM_APP_ID || ''; // Загружается из env или пустая строка

// Состояние игры (уже определено в game-state.js)
// gameState доступен глобально

// AdsGram инициализация
let Adsgram = null;
if (typeof AdsgramInit === 'function' && ADSGRAM_APP_ID) {
    try {
        Adsgram = AdsgramInit({
            appId: ADSGRAM_APP_ID
        });
    } catch (e) {
        console.warn('AdsGram инициализация не удалась:', e);
    }
}

// Блокировка двойного нажатия (КРИТИЧЕСКИЙ БАГ #3)
const actionLocks = {
    searchLoot: false,
    attackBoss: false,
    attackPVP: false,
    craft: false,
    market: false,
    build: false
};

/**
 * Инициализация игры
 */
async function initGame() {
    try {
        // Инициализируем Telegram WebApp
        if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.ready();
            window.Telegram.WebApp.expand();
        }
        
        const telegramId = getTelegramId();
        if (!telegramId) {
            showModal('Ошибка', 'Не удалось определить пользователя Telegram');
            return;
        }

        // Проверяем/создаём игрока
        await apiRequest('/api/verify-telegram', {
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
        document.getElementById('loading-screen').classList.remove('active');
        
        // Запускаем обновление энергии
        setInterval(updateEnergyDisplay, 60000); // Каждую минуту
        
        // Запускаем проверку статуса (переломы, инфекции)
        setInterval(checkPlayerStatus, 600000); // Каждые 10 минут
        
    } catch (error) {
        console.error('Init error:', error);
        document.getElementById('loading-screen').innerHTML = `
            <div class="loader">
                <div class="loader-icon">😿</div>
                <h1>Ошибка</h1>
                <p>Напиши /start боту</p>
            </div>
        `;
    }
}

/**
 * Загрузка профиля игрока
 */
async function loadProfile() {
    const data = await apiRequest('/api/game/profile');
    
    // Также загружаем статус переломов и инфекций
    try {
        const statusData = await apiRequest('/api/game/status');
        // Добавляем расширенный статус к данным игрока
        data.status.broken_bones = statusData.broken_bones?.count || 0;
        data.status.broken_leg = statusData.broken_bones?.broken_leg || false;
        data.status.broken_arm = statusData.broken_bones?.broken_arm || false;
        data.status.infections = statusData.infections?.count || 0;
        data.status.can_walk = statusData.broken_bones?.can_walk ?? true;
        data.status.can_attack = statusData.broken_bones?.can_attack ?? true;
    } catch (e) {
        console.log('Статус недоступен:', e);
    }
    
    gameState.player = data;
    
    // Обновляем UI
    updateProfileUI(data);
}

/**
 * Обновление UI профиля
 */
async function updateProfileUI(player) {
    // Защитная проверка
    if (!player) return;
    
    // Имя игрока
    document.getElementById('player-name').textContent = player.first_name || 'Выживший';
    document.getElementById('player-level').textContent = player.level || 1;
    
    // Загружаем звание
    try {
        const rankData = await apiRequest('/api/game/rank');
        if (rankData && rankData.rank) {
            const rankEl = document.getElementById('player-rank');
            if (rankEl) {
                rankEl.textContent = `${rankData.rank.icon} ${rankData.rank.name}`;
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки звания:', error);
    }
    
    // Статы - с защитой от null
    const status = player.status || {};
    document.getElementById('health-text').textContent = 
        `${status.health || 0}/${status.max_health || 100}`;
    document.getElementById('health-bar').style.width = 
        `${((status.health || 0) / (status.max_health || 100)) * 100}%`;
    
    document.getElementById('energy-text').textContent = 
        `${status.energy || 0}/${status.max_energy || 100}`;
    document.getElementById('energy-bar').style.width = 
        `${((status.energy || 0) / (status.max_energy || 100)) * 100}%`;
    
    // Статусы (голода и жажды больше нет - удалено в миграции дебаффов)
    document.getElementById('radiation-value').textContent = status.radiation || 0;
    document.getElementById('coins-value').textContent = player.coins || 0;
    
    // Локация
    if (player.location) {
        document.getElementById('location-name').textContent = player.location.name;
        document.getElementById('location-radiation').textContent = player.location.radiation;
    }
    
    // Звёзды
    document.getElementById('inv-stars').textContent = player.stars || 0;
    document.getElementById('inv-coins').textContent = player.coins || 0;
    
    // Обновляем отображение переломов и инфекций
    updateConditionsUI(status);
}

/**
 * Обновление UI переломов и инфекций
 */
function updateConditionsUI(status) {
    const conditionsGrid = document.getElementById('conditions-grid');
    const brokenBonesDisplay = document.getElementById('broken-bones-display');
    const infectionsDisplay = document.getElementById('infections-display');
    const healActions = document.getElementById('heal-actions');
    const healBonesBtn = document.getElementById('heal-bones-btn');
    const healInfectionsBtn = document.getElementById('heal-infections-btn');
    
    if (!conditionsGrid) return;
    
    const brokenBones = status.broken_bones || 0;
    const infections = status.infections || 0;
    
    // Показываем/скрываем секцию состояний
    if (brokenBones > 0 || infections > 0) {
        conditionsGrid.style.display = 'grid';
        if (healActions) healActions.style.display = 'flex';
    } else {
        conditionsGrid.style.display = 'none';
        if (healActions) healActions.style.display = 'none';
    }
    
    // Переломы
    if (brokenBonesDisplay) {
        if (brokenBones > 0) {
            brokenBonesDisplay.style.display = 'flex';
            const brokenText = [];
            if (status.broken_leg) brokenText.push('нога');
            if (status.broken_arm) brokenText.push('рука');
            document.getElementById('broken-bones-text').textContent = 
                `🦴 Перелом: ${brokenText.join(', ')}`;
            if (healBonesBtn) healBonesBtn.style.display = 'flex';
        } else {
            brokenBonesDisplay.style.display = 'none';
            if (healBonesBtn) healBonesBtn.style.display = 'none';
        }
    }
    
    // Инфекции
    if (infectionsDisplay) {
        if (infections > 0) {
            infectionsDisplay.style.display = 'flex';
            document.getElementById('infections-text').textContent = 
                `🤒 Инфекции: ${infections}`;
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
    const data = await apiRequest('/api/game/locations');
    gameState.locations = data.locations;
}

/**
 * Поиск лута (с защитой от двойного нажатия)
 */
async function searchLoot() {
    // КРИТИЧЕСКИЙ БАГ #3: Блокировка двойного нажатия
    if (actionLocks.searchLoot) return;
    actionLocks.searchLoot = true;
    
    const btn = document.getElementById('search-btn');
    btn.disabled = true;
    btn.classList.add('shake');
    
    try {
        const result = await apiRequest('/api/game/search', {
            method: 'POST',
            body: {}
        });
        
        if (result.success) {
            // Анимация лута если предмет найден
            if (result.found_item) {
                showLootAnimation(result.found_item);
            }
            
            // Показываем результат
            showModal(
                result.died ? '☠️ Гибель' : '🔍 Поиск',
                result.message
            );
            
            // Обновляем UI
            if (result.new_status) {
                gameState.player.status = { ...gameState.player.status, ...result.new_status };
                updateProfileUI(gameState.player);
            }
            
            // Анимация
            if (!result.died) {
                playSound('loot');
            } else {
                showDamageEffect();
            }
        } else {
            showModal('⚠️ Внимание', result.message);
        }
        
    } catch (error) {
        console.error('Search error:', error);
    } finally {
        btn.disabled = false;
        btn.classList.remove('shake');
        actionLocks.searchLoot = false;
    }
}

/**
 * Переход к локации
 */
async function moveToLocation(locationId) {
    try {
        const result = await apiRequest('/api/game/move', {
            method: 'POST',
            body: { location_id: locationId }
        });
        
        if (result.success) {
            gameState.player.current_location_id = locationId;
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
 * Загрузка инвентаря
 */
async function loadInventory() {
    try {
        const data = await apiRequest('/api/game/inventory');
        gameState.inventory = data.items;
        
        // Обновляем статистику
        document.getElementById('inv-coins').textContent = data.coins || 0;
        document.getElementById('inv-stars').textContent = data.stars || 0;
        
        // Применяем фильтр и сортировку
        renderInventoryWithFilters(data.items);
        
        // Инициализируем обработчики фильтров
        initInventoryControls();
    } catch (error) {
        console.error('Inventory error:', error);
    }
}

/**
 * Глобальные переменные для фильтрации и сортировки инвентаря
 */
let currentInventoryFilter = 'all';
let currentInventorySort = 'id';

/**
 * Инициализация обработчиков кнопок фильтрации и сортировки
 */
function initInventoryControls() {
    // Кнопки фильтров
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Убираем активный класс со всех кнопок
            filterBtns.forEach(b => b.classList.remove('active'));
            // Добавляем активный класс нажатой кнопке
            btn.classList.add('active');
            // Устанавливаем фильтр
            currentInventoryFilter = btn.dataset.filter;
            // Перерисовываем инвентарь
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
    
    if (currentInventoryFilter !== 'all') {
        filteredItems = filteredItems.filter(([itemId, item]) => {
            const category = getItemCategory(itemId);
            return category === currentInventoryFilter;
        });
    }
    
    // Сортировка предметов
    filteredItems.sort((a, b) => {
        const [idA, itemA] = a;
        const [idB, itemB] = b;
        
        switch (currentInventorySort) {
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

/**
 * Отрисовка инвентаря
 */
function renderInventory(items) {
    const grid = document.getElementById('inventory-grid');
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
 * Загрузка рецептов крафта
 */
async function loadRecipes() {
    try {
        const data = await apiRequest('/api/game/craft/recipes');
        gameState.recipes = data.recipes;
        
        // Обновляем энергию
        document.getElementById('craft-energy').textContent = gameState.player.energy;
        
        renderRecipes(data.recipes);
    } catch (error) {
        console.error('Recipes error:', error);
    }
}

/**
 * Отрисовка рецептов крафта
 */
function renderRecipes(recipes) {
    const list = document.getElementById('recipes-list');
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
    try {
        const data = await apiRequest('/api/game/craft', {
            method: 'POST',
            body: JSON.stringify({ recipe_id: recipeId })
        });
        
        if (data.success) {
            showModal('✅ Успех', data.message);
            // Обновляем данные
            gameState.player.energy = data.new_energy;
            loadRecipes(); // Перезагружаем рецепты
        } else {
            showModal('❌ Ошибка', data.message);
        }
    } catch (error) {
        console.error('Craft error:', error);
        showModal('❌ Ошибка', 'Не удалось выполнить крафт');
    }
}

/**
 * Использование предмета
 */
async function useItem(itemId) {
    try {
        const result = await apiRequest('/api/game/use-item', {
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
    }
}

/**
 * Загрузка списка боссов
 */
async function loadBosses() {
    try {
        const data = await apiRequest('/api/game/bosses');
        gameState.bosses = data.bosses;
        
        renderBosses(data.bosses);
    } catch (error) {
        console.error('Bosses error:', error);
    }
}

/**
 * Отрисовка боссов
 */
function renderBosses(bosses) {
    const list = document.getElementById('bosses-list');
    list.innerHTML = '';
    
    for (const boss of bosses) {
        const item = document.createElement('div');
        item.className = `boss-item ${boss.unlocked ? '' : 'locked'}`;
        
        item.innerHTML = `
            <div class="boss-icon">${boss.icon}</div>
            <div class="boss-info">
                <div class="boss-name">${boss.name}</div>
                <div class="boss-desc">${boss.description}</div>
                <div class="boss-reward">💰 ${boss.reward_coins} | ✨ ${boss.reward_experience} XP</div>
                ${!boss.unlocked ? `<div class="boss-keys">Ключи: ${boss.keys_owned}/${boss.keys_required}</div>` : ''}
            </div>
        `;
        
        // Клик по боссу
        item.addEventListener('click', () => {
            if (boss.unlocked) {
                startBossFight(boss);
            } else {
                showModal('🔒 Заблокировано', `Нужно ${boss.keys_required} ключей от предыдущего босса`);
            }
        });
        
        list.appendChild(item);
    }
}

/**
 * Начало боя с боссом
 */
function startBossFight(boss) {
    gameState.currentBoss = boss;
    
    document.getElementById('boss-name').textContent = boss.name;
    document.getElementById('boss-icon').textContent = boss.icon;
    document.getElementById('boss-health-text').textContent = 
        `${boss.health}/${boss.max_health}`;
    document.getElementById('boss-health-bar').style.width = '100%';
    document.getElementById('fight-log').innerHTML = '<p>Нажми "Атаковать" чтобы начать бой!</p>';
    
    showScreen('boss-fight');
}

/**
 * Атака босса (с защитой от двойного нажатия и проверкой энергии)
 */
async function attackBoss() {
    if (!gameState.currentBoss) return;
    
    // КРИТИЧЕСКИЙ БАГ #3: Блокировка двойного нажатия
    if (actionLocks.attackBoss) return;
    actionLocks.attackBoss = true;
    
    // КРИТИЧЕСКИЙ БАГ #10: Проверка энергии
    const status = gameState.player?.status;
    if (!status || status.energy < 1) {
        showModal('⚠️ Нет энергии', 'Подожди или восстанови за звёзды');
        actionLocks.attackBoss = false;
        return;
    }
    
    // Проверяем, может ли игрок атаковать (перелом руки)
    if (status.broken_arm) {
        showModal('⚠️ Невозможно атаковать', 'У вас сломана рука! Сначала вылечите перелом.');
        actionLocks.attackBoss = false;
        return;
    }
    
    const btn = document.getElementById('attack-boss-btn');
    btn.disabled = true;
    
    try {
        const result = await apiRequest('/api/game/attack-boss', {
            method: 'POST',
            body: { boss_id: gameState.currentBoss.id }
        });
        
        // Обновляем лог боя
        const log = document.getElementById('fight-log');
        
        if (result.success) {
            const damageText = document.createElement('p');
            damageText.className = 'damage';
            damageText.textContent = `⚔️ Нанёс ${result.damage_dealt} урона!`;
            log.appendChild(damageText);
            log.scrollTop = log.scrollHeight;
            
            // Обновляем HP босса
            const hpPercent = (result.boss_hp / result.boss_max_hp) * 100;
            document.getElementById('boss-health-bar').style.width = `${hpPercent}%`;
            document.getElementById('boss-health-text').textContent = 
                `${result.boss_hp}/${result.boss_max_hp}`;
            
            // Обновляем энергию игрока
            document.getElementById('energy-text').textContent = 
                `${result.player_energy}/${gameState.player.status.max_energy}`;
            document.getElementById('energy-bar').style.width = 
                `${(result.player_energy / gameState.player.status.max_energy) * 100}%`;
            
            // Проверка на перелом
            if (result.broken_bone) {
                showModal('🦴 Перелом!', result.broken_bone.message);
            }
            
            // Проверка на победу
            if (result.boss_defeated) {
                showModal('🏆 ПОБЕДА!', 
                    `Ты победил ${gameState.currentBoss.name}!\n\n` +
                    `Награда:\n💰 +${result.reward.coins} монет\n✨ +${result.reward.experience} XP\n` +
                    (result.reward.key ? `\n🔑 Получен ключ от ${result.reward.key.boss_name}!` : '')
                );
                
                // Загружаем новых боссов
                await loadBosses();
                
                setTimeout(() => {
                    showScreen('bosses');
                }, 2000);
            }
            
            // Обновляем профиль
            await loadProfile();
            
            playSound('attack');
        } else {
            showModal('⚠️ Внимание', result.message);
        }
        
    } catch (error) {
        console.error('Attack error:', error);
    } finally {
        btn.disabled = false;
        actionLocks.attackBoss = false;
    }
}

/**
 * ========== СИСТЕМА КЛАНОВ ==========
 */

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
        const data = await apiRequest('/api/game/clan');
        
        if (data.success && data.data.in_clan) {
            clanState.clan = data.data.clan;
            renderClanScreen(data.data);
        } else {
            renderNoClanScreen();
        }
    } catch (error) {
        console.error('Clan load error:', error);
    }
}

/**
 * Отрисовка экрана клана (игрок в клане)
 */
function renderClanScreen(data) {
    const content = document.getElementById('clan-content');
    const clan = data.clan;
    
    const roleEmoji = { leader: '👑', officer: '⭐', member: '👤' };
    
    content.innerHTML = `
        <div class="clan-card">
            <div class="clan-header">
                <div class="clan-icon">🏰</div>
                <div class="clan-title">
                    <h3>${clan.name}</h3>
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
                            <span class="member-name">${m.first_name}</span>
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
    const name = document.getElementById('clan-name-input').value.trim();
    const description = document.getElementById('clan-desc-input').value.trim();
    const isPublic = document.getElementById('clan-public-input').checked;
    
    if (!name || name.length < 3) {
        showModal('⚠️ Ошибка', 'Название клана должно быть от 3 символов');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/clan/create', {
            method: 'POST',
            body: { name, description, is_public: isPublic }
        });
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            document.getElementById('clan-name-input').value = '';
            document.getElementById('clan-desc-input').value = '';
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
    const list = document.getElementById('clans-list');
    
    if (!clans || clans.length === 0) {
        list.innerHTML = '<div class="empty-message">Нет доступных кланов</div>';
        return;
    }
    
    list.innerHTML = clans.map(clan => {
        return '<div class="clan-list-item" data-clan-id="' + clan.id + '">' +
            '<div class="clan-list-icon">🏰</div>' +
            '<div class="clan-list-info">' +
                '<div class="clan-list-name">' + clan.name + '</div>' +
                '<div class="clan-list-stats">👥 ' + (clan.member_count || 1) + ' | Уровень ' + clan.level + '</div>' +
            '</div>' +
            '<button class="join-btn" data-clan-id="' + clan.id + '">Вступить</button>' +
        '</div>';
    }).join('');
    
    list.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', () => joinClan(parseInt(btn.dataset.clanId)));
    });
}

/**
 * Вступление в клан
 */
async function joinClan(clanId) {
    try {
        const result = await apiRequest('/api/game/clan/join', {
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
        const result = await apiRequest('/api/game/clan/leave', {
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
        const data = await apiRequest('/api/game/clan/members');
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
    
    document.getElementById('modal-title').textContent = 'Участники клана';
    document.getElementById('modal-message').innerHTML = html;
    document.getElementById('modal').classList.add('active');
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
    
    if (donateAmount > gameState.player.coins) {
        showModal('⚠️ Ошибка', 'Недостаточно монет. У тебя: ' + (gameState.player.coins || 0));
        return;
    }
    
    donateToClan(donateAmount);
}

/**
 * Пожертвование в клан
 */
async function donateToClan(amount) {
    // Защитная проверка
    if (!gameState.player) {
        showModal('⚠️ Ошибка', 'Данные игрока не загружены');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/clan/donate', {
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
    
    let html = '<div class="clan-settings">';
    html += '<p>Код приглашения: <strong>' + clan.invite_code + '</strong></p>';
    html += '<p>Поделитесь кодом с друзьями!</p>';
    html += '</div>';
    
    document.getElementById('modal-title').textContent = 'Настройки клана';
    document.getElementById('modal-message').innerHTML = html;
    document.getElementById('modal').classList.add('active');
}

/**
 * Загрузка чата клана
 */
async function loadClanChat() {
    try {
        const data = await apiRequest('/api/game/clan/chat');
        if (data.success) renderClanChat(data.data.messages);
    } catch (error) {
        console.error('Load chat error:', error);
    }
}

/**
 * Отрисовка чата клана
 */
function renderClanChat(messages) {
    const container = document.getElementById('clan-chat-messages');
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="empty-message">Сообщений пока нет</div>';
        return;
    }
    
    container.innerHTML = messages.map(msg => {
        const time = new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        // Используем first_name если доступен, иначе username
        const playerName = msg.first_name || msg.username || 'Игрок';
        return '<div class="chat-message">' +
            '<div class="chat-header">' +
                '<span class="chat-author">' + playerName + '</span>' +
                '<span class="chat-level">[' + msg.level + ']</span>' +
                '<span class="chat-time">' + time + '</span>' +
            '</div>' +
            '<div class="chat-text">' + escapeHtml(msg.message) + '</div>' +
        '</div>';
    }).join('');
    
    container.scrollTop = container.scrollHeight;
}

/**
 * Отправка сообщения в чат
 */
async function sendClanMessage() {
    const input = document.getElementById('clan-message-input');
    const message = input.value.trim();
    
    if (!message) return;
    
    try {
        const result = await apiRequest('/api/game/clan/chat', {
            method: 'POST',
            body: { message }
        });
        
        if (result.success) {
            input.value = '';
            loadClanChat();
        }
    } catch (error) {
        console.error('Send message error:', error);
    }
}

/**
 * Восстановление энергии за Stars
 */
async function restoreEnergy() {
    const cost = 1; // 1 звезда за 10 энергии
    
    // Защитная проверка: игрок должен быть загружен
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
        const result = await apiRequest('/api/game/restore-energy', {
            method: 'POST',
            body: { amount: 10 }
        });
        
        if (result.success) {
            await loadProfile();
            showModal('✅ Успех', `Энергия восстановлена! (-${result.stars_spent} ⭐)`);
        }
    } catch (error) {
        console.error('Restore energy error:', error);
    }
}

/**
 * Просмотр рейтинга
 */
async function loadRating(type = 'players') {
    try {
        const data = await apiRequest(`/api/rating/${type}`);
        
        renderRating(data.rating, type);
    } catch (error) {
        console.error('Rating error:', error);
    }
}

/**
 * Отрисовка рейтинга
 */
function renderRating(items, type) {
    const list = document.getElementById('rating-list');
    list.innerHTML = '';
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rank = document.createElement('div');
        rank.className = 'rating-item';
        
        if (type === 'players') {
            rank.innerHTML = `
                <span class="rank rank-${i + 1}">#${i + 1}</span>
                <div class="info">
                    <div class="name">${item.first_name || 'Игрок'}</div>
                    <div class="stats">Уровень ${item.level} | ${item.bosses_killed} боссов</div>
                </div>
            `;
        } else {
            rank.innerHTML = `
                <span class="rank rank-${i + 1}">#${i + 1}</span>
                <div class="info">
                    <div class="name">${item.name}</div>
                    <div class="stats">Уровень ${item.level} | ${item.total_members} участников</div>
                </div>
            `;
        }
        
        list.appendChild(rank);
    }
}

/**
 * Запуск рекламы AdsGram
 */
async function watchAd() {
    if (!Adsgram) {
        showModal('⚠️ Реклама', 'Реклама недоступна');
        return;
    }
    
    try {
        await Adsgram.showRewarded({
            onStart: () => {
                console.log('Реклама началась');
            },
            onReward: () => {
                // Защитная проверка: игрок и статус должны быть загружены
                if (!gameState.player || !gameState.player.status) {
                    showModal('⚠️ Ошибка', 'Данные игрока не загружены');
                    return;
                }
                
                // Даём награду
                const status = gameState.player.status;
                const maxEnergy = status.max_energy || 100;
                const currentEnergy = status.energy || 0;
                status.energy = Math.min(maxEnergy, currentEnergy + 20);
                updateProfileUI(gameState.player);
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

/**
 * Загрузка базы игрока
 */
async function loadBase() {
    try {
        // Загружаем данные о базе
        const baseData = await apiRequest('/api/game/base');
        
        // Загружаем список доступных построек
        const buildingsData = await apiRequest('/api/game/base/buildings');
        
        // Отображаем бонусы базы
        renderBaseBonuses(baseData);
        
        // Отображаем постройки игрока
        renderPlayerBuildings(baseData.buildings);
        
        // Отображаем доступные постройки
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
    const availableList = document.getElementById('available-list');
    
    if (!buildings || buildings.length === 0) {
        availableList.innerHTML = '<p>Нет доступных построек</p>';
        return;
    }
    
    availableList.innerHTML = buildings.map(b => {
        const isBuilt = b.is_built;
        const canBuild = b.requirements?.has_required_building && 
                         (gameState.player?.level || 1) >= b.required_level;
        
        let statusClass = '';
        let statusText = '';
        let buttonDisabled = '';
        
        if (!b.requirements?.has_required_building) {
            statusClass = 'locked';
            statusText = `Требуется: ${b.requirements?.required_building}`;
            buttonDisabled = 'disabled';
        } else if ((gameState.player?.level || 1) < b.required_level) {
            statusClass = 'locked';
            statusText = `Требуется уровень: ${b.required_level}`;
            buttonDisabled = 'disabled';
        } else if (b.current_level >= b.max_level) {
            statusClass = 'maxed';
            statusText = 'Макс. уровень';
            buttonDisabled = 'disabled';
        } else if (isBuilt) {
            statusClass = 'upgradable';
            statusText = `Уровень ${b.current_level}/${b.max_level}`;
        } else {
            statusClass = 'available';
            statusText = 'Доступно';
        }
        
        return `
            <div class="available-building-item ${statusClass}" style="border-left: 4px solid ${b.color}">
                <div class="building-header">
                    <span class="building-icon">${b.icon}</span>
                    <span class="building-name">${b.name}</span>
                    ${b.current_level > 0 ? `<span class="building-level">Ур. ${b.current_level}</span>` : ''}
                </div>
                <div class="building-desc">${b.description || ''}</div>
                <div class="building-cost">
                    <span class="cost-coins">💰 ${b.upgrade_cost?.coins || 0}</span>
                    ${b.upgrade_cost?.resources ? Object.entries(b.upgrade_cost.resources).map(([k, v]) => 
                        `<span class="cost-resource">${k}: ${v}</span>`
                    ).join('') : ''}
                </div>
                <div class="building-status">${statusText}</div>
                <button class="build-btn" onclick="buildBuilding('${b.code}')" ${buttonDisabled}>
                    ${isBuilt ? 'Улучшить' : 'Построить'}
                </button>
            </div>
        `;
    }).join('');
    
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
    const availableList = document.getElementById('available-list');
    
    const filtered = type === 'all' 
        ? buildings 
        : buildings.filter(b => b.type === type);
    
    // Рендеринг отфильтрованных построек
    if (filtered.length === 0) {
        availableList.innerHTML = '<p>Нет построек этого типа</p>';
        return;
    }
    
    availableList.innerHTML = filtered.map(b => {
            const isBuilt = b.is_built;
            const canBuild = b.requirements?.has_required_building && 
                             (gameState.player?.level || 1) >= b.required_level;
            
            let statusClass = '';
            let statusText = '';
            let buttonDisabled = '';
            
            if (!b.requirements?.has_required_building) {
                statusClass = 'locked';
                statusText = `Требуется: ${b.requirements?.required_building}`;
                buttonDisabled = 'disabled';
            } else if ((gameState.player?.level || 1) < b.required_level) {
                statusClass = 'locked';
                statusText = `Требуется уровень: ${b.required_level}`;
                buttonDisabled = 'disabled';
            } else if (b.current_level >= b.max_level) {
                statusClass = 'maxed';
                statusText = 'Макс. уровень';
                buttonDisabled = 'disabled';
            } else if (isBuilt) {
                statusClass = 'upgradable';
                statusText = `Уровень ${b.current_level}/${b.max_level}`;
            } else {
                statusClass = 'available';
                statusText = 'Доступно';
            }
            
            return `
                <div class="available-building-item ${statusClass}" style="border-left: 4px solid ${b.color}">
                    <div class="building-header">
                        <span class="building-icon">${b.icon}</span>
                        <span class="building-name">${b.name}</span>
                        ${b.current_level > 0 ? `<span class="building-level">Ур. ${b.current_level}</span>` : ''}
                    </div>
                    <div class="building-desc">${b.description || ''}</div>
                    <div class="building-cost">
                        <span class="cost-coins">💰 ${b.upgrade_cost?.coins || 0}</span>
                    </div>
                    <div class="building-status">${statusText}</div>
                    <button class="build-btn" onclick="buildBuilding('${b.code}')" ${buttonDisabled}>
                        ${isBuilt ? 'Улучшить' : 'Построить'}
                    </button>
                </div>
            `;
        }).join('');
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
            // Обновляем базу
            loadBase();
            // Обновляем профиль
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

/**
 * Обновление отображения энергии
 */
function updateEnergyDisplay() {
    if (gameState.player) {
        loadProfile(); // Просто перезагружаем профиль
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
        
        if (result.died) {
            // Игрок умер
            showModal(
                result.reason === 'radiation' ? '☢️ Гибель' : '☠️ Гибель',
                result.message + '\n\nНапиши /start боту чтобы начать зановее'
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

/**
 * Лечение переломов
 */
async function healBrokenBones() {
    const status = gameState.player?.status;
    if (!status || status.broken_bones === 0) {
        showModal('ℹ️ Инфо', 'У вас нет переломов');
        return;
    }
    
    // Показываем меню выбора
    const healOptions = `Лечение перелома:
\n💊 Бинты (нужно ${status.broken_bones} шт.) - бесплатно, но нужно ждать
⭐ 50 Stars - мгновенно\n\nВыберите способ:`;
    
    // Пробуем лечение
    try {
        const result = await apiRequest('/api/game/status/heal', {
            method: 'POST',
            body: { type: 'bone', use_stars: false }
        });
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            await loadProfile();
        } else if (result.has_bandages === false && result.stars_price) {
            // Нет бинтов, предлагаем за Stars
            showModal('⚠️ Нет бинтов', result.message + '\n\nХотите лечить за Stars?');
        } else {
            showModal('⚠️ Внимание', result.message);
        }
    } catch (error) {
        console.error('Ошибка лечения:', error);
    }
}

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
            body: { type: 'infection', use_stars: false }
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

/**
 * Визуальный эффект при получении лута
 */
function showLootAnimation(item) {
    const container = document.getElementById('loading-screen') || document.body;
    
    // Создаём элемент анимации
    const lootEl = document.createElement('div');
    lootEl.className = 'loot-animation';
    lootEl.innerHTML = `
        <div class="loot-icon">${item.icon || '📦'}</div>
        <div class="loot-name">${item.name || 'Предмет'}</div>
    `;
    
    container.appendChild(lootEl);
    
    // Анимация
    lootEl.style.animation = 'slideUp 1s ease-out forwards';
    
    // Удаляем после анимации
    setTimeout(() => {
        lootEl.remove();
    }, 1000);
}

/**
 * Обновление отображения баланса игрока
 */
function updateBalanceDisplay(newBalance) {
    const balanceElements = document.querySelectorAll('.balance-value, #user-balance, .coins-display');
    balanceElements.forEach(el => {
        if (el) el.textContent = formatNumber(newBalance);
    });
    if (gameState) gameState.player.balance = newBalance;
}

/**
 * Загрузка данных магазина
 */
function loadShop() {
    return apiRequest('/api/game/shop');
}

// Функция openShop() перенесена в game-store.js

/**
 * Отрисовка локаций на карте
 */
function renderLocations(locations) {
    const container = document.getElementById('locations-grid');
    if (!container) return;
    container.innerHTML = locations.map(loc => `
        <div class="location-card" data-location-id="${loc.id}">
            <img src="${loc.image_url || ''}" alt="${loc.name}">
            <div class="location-name">${loc.name}</div>
            <div class="location-level">Уровень: ${loc.min_level || 1}</div>
        </div>
    `).join('');
}

/**
 * Загрузка списка заданий
 */
async function loadQuests() {
    try {
        const data = await apiRequest('/api/game/quests');
        return data;
    } catch (e) {
        console.error('Ошибка загрузки квестов:', e);
        return [];
    }
}

/**
 * Загрузка рейтинга игроков
 */
function loadRatings(type = 'score') {
    return apiRequest(`/api/rating/${type}`);
}

/**
 * Визуальный эффект при получении урона
 */
function showDamageEffect() {
    const app = document.getElementById('app');
    app.style.animation = 'damageFlash 0.3s';
    setTimeout(() => {
        app.style.animation = '';
    }, 300);
}

/**
 * Визуальный эффект при получении лечения
 */
function showHealEffect() {
    const app = document.getElementById('app');
    app.style.animation = 'healFlash 0.3s';
    setTimeout(() => {
        app.style.animation = '';
    }, 300);
}

/**
 * Звуковые эффекты (упрощённо)
 */
function playSound(type) {
    // В реальном приложении нужно использовать Audio API
    // Здесь просто вибрация для мобильных
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
        }
    }
}

/**
 * Обработчики событий
 */
document.addEventListener('DOMContentLoaded', () => {
    // Кнопки навигации
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showScreen(btn.dataset.screen);
        });
    });
    
    // Кнопка назад
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showScreen(btn.dataset.screen);
        });
    });
    
    // Кнопка поиска
    document.getElementById('search-btn').addEventListener('click', searchLoot);
    
    // Кнопка карты
    document.getElementById('map-btn').addEventListener('click', () => showScreen('map'));
    
    // Кнопка инвентаря
    document.getElementById('inventory-btn').addEventListener('click', () => showScreen('inventory'));
    
    // Кнопка боссов
    document.getElementById('bosses-btn').addEventListener('click', () => showScreen('bosses'));
    
    // Кнопка магазина
    document.getElementById('shop-btn').addEventListener('click', () => showScreen('shop'));
    
    // Кнопка рейтинга
    document.getElementById('rating-btn').addEventListener('click', () => showScreen('rating'));
    
    // Кнопка PvP
    document.getElementById('pvp-btn').addEventListener('click', () => showScreen('pvp-players'));
    
    // Кнопки лечения переломов и инфекций
    document.getElementById('heal-bones-btn').addEventListener('click', healBrokenBones);
    document.getElementById('heal-infections-btn').addEventListener('click', healInfections);
    
    // Кнопка присоединения к сезону
    document.getElementById('season-join-btn')?.addEventListener('click', joinSeason);
    
    // Кнопки PvP
    document.getElementById('pvp-refresh-btn')?.addEventListener('click', loadPVPGamePlayers);
    document.getElementById('pvp-stats-btn')?.addEventListener('click', () => showScreen('pvp-stats'));
    document.getElementById('pvp-attack-btn')?.addEventListener('click', attackPVPTarget);
    document.getElementById('pvp-claim-rewards-btn')?.addEventListener('click', claimPVPRewards);
    
    // Атака босса
    document.getElementById('attack-boss-btn').addEventListener('click', attackBoss);
    
    // Закрытие модального окна
    document.getElementById('modal-close').addEventListener('click', () => {
        document.getElementById('modal').classList.remove('active');
    });
    
    // Закрытие модального по клику вне
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') {
            document.getElementById('modal').classList.remove('active');
        }
    });
    
    // Табы рейтинга
    document.querySelectorAll('.rating-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.rating-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadRating(tab.dataset.tab);
        });
    });
    
    // Кнопка создания клана
    document.getElementById('create-clan-btn')?.addEventListener('click', createClan);
    
    // Кнопка поиска кланов
    document.getElementById('clans-search-btn')?.addEventListener('click', () => {
        const search = document.getElementById('clans-search-input').value;
        loadClansList(search);
    });
    
    // Enter в поиске кланов
    document.getElementById('clans-search-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadClansList(e.target.value);
        }
    });
    
    // Отправка сообщения в чат
    document.getElementById('clan-send-btn')?.addEventListener('click', sendClanMessage);
    document.getElementById('clan-message-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendClanMessage();
    });
    
    // Навигация на экран клана
    document.querySelector('[data-screen="clan"]')?.addEventListener('click', loadClan);
    document.querySelector('[data-screen="clan-chat"]')?.addEventListener('click', loadClanChat);
    document.querySelector('[data-screen="clans-list"]')?.addEventListener('click', () => loadClansList());

    // БАРАХОЛКА - Обработчики событий
    // Кнопка создания объявления
    document.getElementById('market-create-btn')?.addEventListener('click', () => showScreen('market-create'));

    // Поиск и фильтры
    let marketSearchTimeout;
    document.getElementById('market-search')?.addEventListener('input', (e) => {
        clearTimeout(marketSearchTimeout);
        marketSearchTimeout = setTimeout(() => loadMarketListings(), 500);
    });

    document.getElementById('market-type-filter')?.addEventListener('change', loadMarketListings);
    document.getElementById('market-sort-filter')?.addEventListener('change', loadMarketListings);

    // Табы барахолки
    document.querySelectorAll('.market-info-bar .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.market-info-bar .tab-btn').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');

            const tabId = btn.dataset.tab;
            document.querySelectorAll('.market-tab').forEach(tab => tab.classList.remove('active'));
            document.getElementById(`${tabId}-tab`)?.classList.add('active');

            if (tabId === 'market-my') loadMyListings();
            if (tabId === 'market-history') loadMarketHistory();
        });
    });

    // Кнопка создания объявления
    document.getElementById('market-submit-btn')?.addEventListener('click', createMarketListing);

    // Модальное окно покупки
    document.getElementById('market-buy-confirm')?.addEventListener('click', confirmBuyFromMarket);
    document.getElementById('market-buy-cancel')?.addEventListener('click', () => {
        document.getElementById('market-buy-modal').classList.remove('active');
    });

    // Обновление summary при изменении полей
    document.getElementById('market-quantity')?.addEventListener('input', updateMarketSummary);
    document.getElementById('market-price')?.addEventListener('input', updateMarketSummary);

    // Инициализация обработчиков навигации (кнопки меню, табы)
    initNavigationHandlers();

    // Запуск игры
    initGame();
});

// ========================================
// БАРАХОЛКА
// ========================================

// Текущая категория достижений
let currentAchievementCategory = null;

/**
 * Загрузка достижений
 */
async function loadAchievements() {
    try {
        const data = await apiRequest('/api/game/achievements/progress');
        
        if (data && data.progress) {
            renderAchievementsStats(data.stats);
            renderAchievementsCategories(data.categories);
            
            // Показываем все или выбранную категорию
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
        craft: '🔨 Крафт',
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
    await loadAchievements();
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
        const reward = typeof ach.reward === 'string' ? JSON.parse(ach.reward) : ach.reward;
        const rarityClass = `rarity-${ach.rarity || 'common'}`;
        
        html += `
            <div class="achievement-card ${ach.completed ? 'completed' : ''} ${rarityClass}">
                <div class="icon">${ach.icon || '🏆'}</div>
                <div class="info">
                    <div class="name">${ach.name}</div>
                    <div class="description">${ach.description}</div>
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
        const data = await apiRequest('/api/game/achievements/claim', 'POST', { achievement_id: achievementId });
        
        if (data.success) {
            alert(data.message);
            // Обновляем баланс
            updateBalanceDisplay(data.new_balance);
            // Перезагружаем достижения
            await loadAchievements();
        } else {
            alert(data.error || 'Ошибка получения награды');
        }
    } catch (error) {
        console.error('Ошибка получения награды:', error);
        alert('Ошибка получения награды');
    }
}

// ========================================

// Выбранный предмет для создания объявления
let marketSelectedItem = null;
let currentBuyListingId = null;

/**
 * Загрузка списка объявлений рынка
 */
async function loadMarketListings() {
    try {
        const search = document.getElementById('market-search')?.value || '';
        const type = document.getElementById('market-type-filter')?.value || '';
        const sort = document.getElementById('market-sort-filter')?.value || 'date';

        let url = '/api/game/market/listings?';
        if (search) url += `search=${encodeURIComponent(search)}&`;
        if (type) url += `type=${encodeURIComponent(type)}&`;
        url += `sort=${encodeURIComponent(sort)}`;

        const data = await apiRequest(url);
        renderMarketListings(data.listings);
    } catch (error) {
        console.error('Ошибка загрузки объявлений:', error);
    }
}

/**
 * Отображение списка объявлений
 */
function renderMarketListings(listings) {
    const container = document.getElementById('market-listings-list');
    
    if (!listings || listings.length === 0) {
        container.innerHTML = '<div class="empty-message">На рынке пока нет объявлений</div>';
        return;
    }

    container.innerHTML = listings.map(listing => {
        const item = listing.item;
        const rarityClass = `rarity-${item.rarity || 'common'}`;
        const expiresAt = new Date(listing.expires_at);
        const now = new Date();
        const hoursLeft = Math.max(0, Math.floor((expiresAt - now) / 3600000));

        return `
            <div class="market-listing-card ${rarityClass}" data-listing-id="${listing.id}">
                <div class="listing-item-icon">${item.icon || '📦'}</div>
                <div class="listing-item-info">
                    <div class="listing-item-name">${item.name}</div>
                    <div class="listing-item-meta">
                        <span class="quantity">x${listing.quantity}</span>
                        <span class="seller">Продавец: ${listing.seller?.name || 'Неизвестный'} (ур. ${listing.seller?.level || 1})</span>
                    </div>
                    <div class="listing-expiry">Осталось: ${hoursLeft}ч</div>
                </div>
                <div class="listing-price">
                    <div class="price-coins">${listing.total_price} 🪙</div>
                    ${listing.stars_price > 0 ? `<div class="price-stars">${listing.stars_price * listing.quantity} ⭐</div>` : ''}
                    <button class="buy-btn" data-listing-id="${listing.id}">Купить</button>
                </div>
            </div>
        `;
    }).join('');

    // Обработчики кнопок покупки
    container.querySelectorAll('.buy-btn').forEach(btn => {
        btn.addEventListener('click', () => openBuyModal(parseInt(btn.dataset.listingId)));
    });
}

/**
 * Открытие модального окна покупки
 */
async function openBuyModal(listingId) {
    try {
        // Находим объявление
        const data = await apiRequest('/api/game/market/listings');
        const listing = data.listings?.find(l => l.id === listingId);

        if (!listing) {
            showModal('Ошибка', 'Объявление не найдено');
            return;
        }

        currentBuyListingId = listingId;

        const item = listing.item;
        const modal = document.getElementById('market-buy-modal');
        const infoDiv = document.getElementById('market-buy-item-info');
        const summaryDiv = document.getElementById('market-buy-summary');

        infoDiv.innerHTML = `
            <div class="buy-item-display">
                <span class="item-icon">${item.icon || '📦'}</span>
                <span class="item-name">${item.name}</span>
                <span class="item-quantity">x${listing.quantity}</span>
            </div>
            <div class="seller-info">Продавец: ${listing.seller?.name} (ур. ${listing.seller?.level})</div>
        `;

        summaryDiv.innerHTML = `
            <div class="buy-summary-row">
                <span>Цена:</span>
                <span class="price">${listing.total_price} 🪙</span>
            </div>
            ${listing.stars_price > 0 ? `
            <div class="buy-summary-row">
                <span>Звёзды:</span>
                <span class="price">${listing.stars_price * listing.quantity} ⭐</span>
            </div>
            ` : ''}
            <div class="buy-summary-row commission">
                <span>Комиссия (5%):</span>
                <span>${Math.floor(listing.total_price * 0.05)} 🪙</span>
            </div>
        `;

        modal.classList.add('active');
    } catch (error) {
        console.error('Ошибка открытия модального окна:', error);
        showModal('Ошибка', 'Не удалось загрузить информацию об объявлении');
    }
}

/**
 * Подтверждение покупки
 */
async function confirmBuyFromMarket() {
    if (!currentBuyListingId) return;

    try {
        const result = await apiRequest('/api/game/market/buy', {
            method: 'POST',
            body: { listing_id: currentBuyListingId }
        });

        if (result.success) {
            document.getElementById('market-buy-modal').classList.remove('active');
            showModal('✅ Успех', result.message);
            playSound('loot');
            
            // Обновляем профиль
            await loadProfile();
            
            // Обновляем список
            loadMarketListings();
        } else {
            showModal('❌ Ошибка', result.message);
        }
    } catch (error) {
        console.error('Ошибка покупки:', error);
        showModal('Ошибка', 'Не удалось совершить покупку');
    } finally {
        currentBuyListingId = null;
    }
}

/**
 * Загрузка своих объявлений
 */
async function loadMyListings() {
    try {
        const data = await apiRequest('/api/game/market/my');
        
        // Обновляем информацию о лимитах
        const infoDiv = document.getElementById('market-my-info');
        infoDiv.innerHTML = `
            <div class="market-limits">
                <span>Лимит: ${data.limit}</span>
                <span>Активных: ${data.active_count}</span>
                <span>Свободно: ${data.remaining_slots}</span>
            </div>
        `;

        renderMyListings(data.listings);
    } catch (error) {
        console.error('Ошибка загрузки своих объявлений:', error);
    }
}

/**
 * Отображение своих объявлений
 */
function renderMyListings(listings) {
    const container = document.getElementById('market-my-list');

    if (!listings || listings.length === 0) {
        container.innerHTML = '<div class="empty-message">У вас пока нет объявлений</div>';
        return;
    }

    container.innerHTML = listings.map(listing => {
        const item = listing.item;
        const rarityClass = `rarity-${item.rarity || 'common'}`;
        const statusColors = {
            'active': '#4CAF50',
            'sold': '#2196F3',
            'cancelled': '#FF9800',
            'expired': '#9E9E9E'
        };
        const statusText = {
            'active': 'Активно',
            'sold': 'Продано',
            'cancelled': 'Отменено',
            'expired': 'Истекло'
        };

        return `
            <div class="market-listing-card my-listing ${rarityClass}">
                <div class="listing-status" style="background: ${statusColors[listing.status]}">${statusText[listing.status]}</div>
                <div class="listing-item-icon">${item.icon || '📦'}</div>
                <div class="listing-item-info">
                    <div class="listing-item-name">${item.name}</div>
                    <div class="listing-item-meta">
                        <span class="quantity">x${listing.quantity}</span>
                        <span class="price">${listing.total_price} 🪙</span>
                    </div>
                    <div class="listing-stats">
                        <span>Просмотров: ${listing.views}</span>
                        <span>Продлений: ${listing.times_renewed}/3</span>
                    </div>
                </div>
                ${listing.status === 'active' ? `
                <div class="listing-actions">
                    <button class="renew-btn" data-listing-id="${listing.id}">Продлить</button>
                    <button class="cancel-btn" data-listing-id="${listing.id}">Отменить</button>
                </div>
                ` : ''}
            </div>
        `;
    }).join('');

    // Обработчики кнопок
    container.querySelectorAll('.renew-btn').forEach(btn => {
        btn.addEventListener('click', () => renewListing(parseInt(btn.dataset.listingId)));
    });

    container.querySelectorAll('.cancel-listing-btn, .cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => cancelListing(parseInt(btn.dataset.listingId)));
    });
}

/**
 * Продление объявления
 */
async function renewListing(listingId) {
    const hours = prompt('На сколько часов продлить? (24, 72, 168)', '24');
    if (!hours) return;

    const durationMap = { '24': '24h', '72': '72h', '168': '7d' };
    const duration = durationMap[hours];

    if (!duration) {
        showModal('Ошибка', 'Неверный срок. Введите 24, 72 или 168');
        return;
    }

    try {
        const result = await apiRequest('/api/game/market/renew', {
            method: 'POST',
            body: { listing_id: listingId, duration }
        });

        if (result.success) {
            showModal('✅ Успех', result.message);
            loadMyListings();
        } else {
            showModal('❌ Ошибка', result.message);
        }
    } catch (error) {
        console.error('Ошибка продления:', error);
    }
}

/**
 * Отмена объявления
 */
async function cancelListing(listingId) {
    if (!confirm('Вы уверены, что хотите отменить объявление? Предметы будут возвращены в инвентарь.')) {
        return;
    }

    try {
        const result = await apiRequest('/api/game/market/cancel', {
            method: 'POST',
            body: { listing_id: listingId }
        });

        if (result.success) {
            showModal('✅ Успех', result.message);
            loadMyListings();
            loadProfile();
        } else {
            showModal('❌ Ошибка', result.message);
        }
    } catch (error) {
        console.error('Ошибка отмены:', error);
    }
}

/**
 * Загрузка истории сделок
 */
async function loadMarketHistory() {
    try {
        const data = await apiRequest('/api/game/market/history');
        
        // Обновляем статистику
        const statsDiv = document.getElementById('market-history-stats');
        statsDiv.innerHTML = `
            <div class="history-stats-grid">
                <div class="stat-box">
                    <span class="stat-label">Всего продано</span>
                    <span class="stat-value">${data.total_sales} 🪙</span>
                </div>
                <div class="stat-box">
                    <span class="stat-label">Всего куплено</span>
                    <span class="stat-value">${data.total_purchases} 🪙</span>
                </div>
                <div class="stat-box">
                    <span class="stat-label">Комиссия</span>
                    <span class="stat-value">${data.total_commission} 🪙</span>
                </div>
            </div>
        `;

        renderMarketHistory(data.all);
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
    }
}

/**
 * Отображение истории сделок
 */
function renderMarketHistory(history) {
    const container = document.getElementById('market-history-list');

    if (!history || history.length === 0) {
        container.innerHTML = '<div class="empty-message">История пуста</div>';
        return;
    }

    container.innerHTML = history.map(item => {
        const itemData = item.item;
        const isSale = item.transaction_type === 'sale';
        const date = new Date(item.created_at).toLocaleDateString('ru-RU');

        return `
            <div class="market-history-item ${isSale ? 'sale' : 'purchase'}">
                <div class="history-icon">${isSale ? '📤' : '📥'}</div>
                <div class="history-info">
                    <div class="history-item-name">${itemData.name} x${item.quantity}</div>
                    <div class="history-meta">
                        <span>${isSale ? 'Продано' : 'Куплено у'}: ${item.other_party.name}</span>
                        <span>${date}</span>
                    </div>
                </div>
                <div class="history-price ${isSale ? 'positive' : 'negative'}">
                    ${isSale ? '+' : '-'}${item.total_price} 🪙
                    ${isSale && item.commission ? `<span class="commission">(-${item.commission})</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Загрузка формы создания объявления
 */
async function loadMarketCreateForm() {
    try {
        const data = await apiRequest('/api/game/inventory');
        const items = data.items;
        
        const grid = document.getElementById('market-inventory-grid');
        
        if (!items || Object.keys(items).length === 0) {
            grid.innerHTML = '<div class="empty-message">Инвентарь пуст</div>';
            return;
        }

        // Получаем информацию о предметах
        const itemsInfo = await apiRequest('/api/game/items');
        const itemsMap = {};
        itemsInfo.items?.forEach(item => {
            itemsMap[item.id] = item;
        });

        grid.innerHTML = Object.entries(items).map(([itemId, quantity]) => {
            const itemInfo = itemsMap[itemId] || { id: itemId, name: 'Неизвестно', icon: '📦', rarity: 'common', type: 'resource' };
            const rarityClass = `rarity-${itemInfo.rarity || 'common'}`;

            return `
                <div class="market-inventory-slot ${rarityClass} ${marketSelectedItem?.id == itemId ? 'selected' : ''}" 
                     data-item-id="${itemId}" data-quantity="${quantity}">
                    <span class="item-icon">${itemInfo.icon || '📦'}</span>
                    <span class="item-quantity">x${quantity}</span>
                    <span class="item-name">${itemInfo.name}</span>
                </div>
            `;
        }).join('');

        // Обработчики выбора
        grid.querySelectorAll('.market-inventory-slot').forEach(slot => {
            slot.addEventListener('click', () => {
                const itemId = parseInt(slot.dataset.itemId);
                const quantity = parseInt(slot.dataset.quantity);
                const itemInfo = itemsMap[itemId];

                marketSelectedItem = {
                    id: itemId,
                    quantity: quantity,
                    info: itemInfo
                };

                // Обновляем UI
                grid.querySelectorAll('.market-inventory-slot').forEach(s => s.classList.remove('selected'));
                slot.classList.add('selected');

                // Обновляем отображение выбранного предмета
                const display = document.getElementById('market-selected-item');
                display.innerHTML = `
                    <span class="selected-icon">${itemInfo.icon || '📦'}</span>
                    <span class="selected-name">${itemInfo.name}</span>
                    <span class="selected-qty">x${quantity} в наличии</span>
                `;

                // Обновляем макс. количество
                const qtyInput = document.getElementById('market-quantity');
                qtyInput.max = quantity;
                qtyInput.value = Math.min(quantity, 1);

                updateMarketSummary();
            });
        });
    } catch (error) {
        console.error('Ошибка загрузки формы:', error);
    }
}

/**
 * Обновление итоговой суммы
 */
function updateMarketSummary() {
    const quantity = parseInt(document.getElementById('market-quantity')?.value || 0);
    const price = parseInt(document.getElementById('market-price')?.value || 0);
    const total = quantity * price;

    const summary = document.getElementById('market-create-summary');
    if (summary) {
        summary.innerHTML = `<span>Итого: ${total} монет</span>`;
    }
}

/**
 * Создание объявления
 */
async function createMarketListing() {
    if (!marketSelectedItem) {
        showModal('Ошибка', 'Выберите предмет из инвентаря');
        return;
    }

    const quantity = parseInt(document.getElementById('market-quantity')?.value || 1);
    const price = parseInt(document.getElementById('market-price')?.value || 0);
    const starsPrice = parseInt(document.getElementById('market-stars-price')?.value || 0);
    const duration = document.getElementById('market-duration')?.value || '24h';

    // КРИТИЧЕСКИЙ БАГ #7: Проверка на NaN и отрицательные значения
    if (isNaN(quantity) || isNaN(price) || quantity < 1 || quantity > (marketSelectedItem?.quantity || 0)) {
        showModal('Ошибка', 'Неверное количество');
        return;
    }

    if (isNaN(price) || price < 1) {
        showModal('Ошибка', 'Укажите цену');
        return;
    }

    try {
        const result = await apiRequest('/api/game/market/create', {
            method: 'POST',
            body: {
                item_id: marketSelectedItem.id,
                quantity: quantity,
                price: price,
                stars_price: starsPrice,
                duration: duration
            }
        });

        if (result.success) {
            showModal('✅ Успех', result.message);
            
            // Очищаем форму
            marketSelectedItem = null;
            document.getElementById('market-selected-item').innerHTML = '<span class="placeholder">Выберите предмет</span>';
            document.getElementById('market-quantity').value = 1;
            document.getElementById('market-price').value = '';
            document.getElementById('market-stars-price').value = 0;
            
            // Возвращаемся на экран барахолки
            showScreen('market');
            loadMarketListings();
            loadProfile();
        } else {
            showModal('❌ Ошибка', result.message);
        }
    } catch (error) {
        console.error('Ошибка создания объявления:', error);
        showModal('Ошибка', 'Не удалось создать объявление');
    }
}

/**
 * Загрузка списка игроков в PvP зоне
 */
async function loadPVPGamePlayers() {
    try {
        const result = await apiRequest('/api/game/pvp/players');
        
        const indicator = document.getElementById('pvp-zone-indicator');
        const list = document.getElementById('pvp-players-list');
        
        if (!result.isRedZone) {
            indicator.innerHTML = '<div class="pvp-zone-safe">🛡️ Безопасная зона - PvP недоступно</div>';
            list.innerHTML = '<div class="empty-message">Перейдите в локацию с опасностью 6+ для PvP</div>';
            return;
        }
        
        indicator.innerHTML = '<div class="pvp-zone-danger">⚠️ КРАСНАЯ ЗОНА - PvP РАЗРЕШЕНО!</div>';
        
        if (!result.players || result.players.length === 0) {
            list.innerHTML = '<div class="empty-message">Нет игроков для атаки</div>';
            return;
        }
        
        list.innerHTML = result.players.map(player => `
            <div class="pvp-player-item">
                <div class="pvp-player-info">
                    <div class="pvp-player-name">${player.username || 'Игрок'}</div>
                    <div class="pvp-player-stats">
                        <span>Уровень: ${player.level}</span>
                        <span>HP: ${player.health}/${player.maxHealth}</span>
                    </div>
                    <div class="pvp-player-pvp">
                        <span>Побед: ${player.pvpWins || 0}</span>
                        <span>Рейтинг: ${player.pvpRating || 1000}</span>
                        <span>Серия: ${player.pvpStreak || 0}</span>
                    </div>
                </div>
                <button class="pvp-attack-player-btn" onclick="startPVPFight(${player.id}, '${player.username || 'Игрок'}', ${player.level}, ${player.health}, ${player.maxHealth})">
                    ⚔️ Атаковать
                </button>
            </div>
        `).join('');
        
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
            body: { targetId: targetId }
        });
        
        if (result.success) {
            // Сохраняем данные боя
            gameState.pvpMatch = {
                matchId: result.matchId,
                targetId: targetId,
                targetName: targetName,
                targetLevel: targetLevel
            };
            
            // Обновляем UI боя
            document.getElementById('pvp-defender-name').textContent = targetName;
            document.getElementById('pvp-defender-level').textContent = `Уровень: ${targetLevel}`;
            document.getElementById('pvp-attacker-name').textContent = 'Вы';
            document.getElementById('pvp-attacker-level').textContent = `Уровень: ${gameState.player?.level || 1}`;
            
            updatePVPHealth('attacker', gameState.player?.health || 100, gameState.player?.maxHealth || 100);
            updatePVPHealth('defender', targetHealth, targetMaxHealth);
            
            document.getElementById('pvp-battle-log').innerHTML = `
                <p>⚔️ Бой начат против ${targetName}!</p>
                <p>Каждый удар тратит 1 энергию</p>
            `;
            
            // Показываем экран боя
            showScreen('pvp-fight');
            playSound('attack');
        } else {
            showModal('❌ Ошибка', result.error);
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
    if (!gameState.pvpMatch || !gameState.pvpMatch.matchId) {
        showModal('❌ Ошибка', 'Бой не найден');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/pvp/attack-hit', {
            method: 'POST',
            body: { matchId: gameState.pvpMatch.matchId }
        });
        
        if (result.success) {
            playSound('attack');
            
            if (result.battleEnded) {
                // Бой завершён
                handlePVPBattleEnd(result);
            } else {
                // Обновляем здоровье
                if (result.hit) {
                    updatePVPHealth('attacker', result.hit.yourHealth, gameState.player?.maxHealth || 100);
                    updatePVPHealth('defender', result.hit.targetHealth, result.hit.maxHealth);
                    
                    // Добавляем в лог
                    const log = document.getElementById('pvp-battle-log');
                    log.innerHTML += `<p>${result.message}</p>`;
                    log.scrollTop = log.scrollHeight;
                }
            }
            
            // Обновляем профиль (для обновления энергии)
            loadProfile();
            
        } else {
            showModal('❌ Ошибка', result.error);
        }
        
    } catch (error) {
        console.error('Ошибка атаки в PvP:', error);
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
    log.innerHTML += `<p class="battle-result">${result.message}</p>`;
    log.scrollTop = log.scrollHeight;
    
    // Скрываем кнопку атаки
    document.getElementById('pvp-attack-btn').style.display = 'none';
    
    // Показываем награды
    const rewardsDiv = document.getElementById('pvp-rewards');
    const rewardsContent = document.getElementById('pvp-rewards-content');
    
    if (result.winner && result.winner.id === gameState.player?.id) {
        // Победа
        rewardsContent.innerHTML = `
            <div class="reward-item">💰 +${result.rewards?.coinsStolen || 0} монет</div>
            <div class="reward-item">📦 +${result.rewards?.itemsStolen || 0} предметов</div>
            <div class="reward-item">⭐ +${result.rewards?.experienceGained || 0} опыта</div>
        `;
        playSound('loot');
    } else {
        // Поражение
        rewardsContent.innerHTML = `
            <div class="reward-item loss">Вы проиграли бой</div>
            <div class="reward-item loss">Телепортированы в безопасную зону</div>
        `;
    }
    
    rewardsDiv.style.display = 'block';
    
    // Очищаем данные боя
    gameState.pvpMatch = null;
    
    // Обновляем профиль
    loadProfile();
}

/**
 * Забрать награды PvP
 */
async function claimPVPRewards() {
    document.getElementById('pvp-rewards').style.display = 'none';
    document.getElementById('pvp-attack-btn').style.display = 'block';
    document.getElementById('pvp-battle-log').innerHTML = '<p>⚔️ Бой завершён!</p>';
    
    // Возвращаемся к списку игроков
    showScreen('pvp-players');
    loadPVPGamePlayers();
}

/**
 * Загрузка PvP статистики
 */
async function loadPVPStats() {
    try {
        const result = await apiRequest('/api/game/pvp/stats');
        
        if (result.success && result.stats) {
            const stats = result.stats;
            
            document.getElementById('pvp-rating-value').textContent = stats.rating || 1000;
            document.getElementById('pvp-wins').textContent = stats.wins || 0;
            document.getElementById('pvp-losses').textContent = stats.losses || 0;
            document.getElementById('pvp-streak').textContent = stats.streak || 0;
            document.getElementById('pvp-max-streak').textContent = stats.maxStreak || 0;
            document.getElementById('pvp-damage-dealt').textContent = stats.totalDamageDealt || 0;
            document.getElementById('pvp-damage-taken').textContent = stats.totalDamageTaken || 0;
            document.getElementById('pvp-coins-lost').textContent = stats.coinsStolenFromMe || 0;
            document.getElementById('pvp-items-lost').textContent = stats.itemsStolenFromMe || 0;
            
            // Кулдаун
            const cooldownDiv = document.getElementById('pvp-cooldown');
            if (result.cooldown && result.cooldown.active) {
                cooldownDiv.style.display = 'flex';
                const expiresAt = new Date(result.cooldown.expiresAt);
                const timerEl = document.getElementById('pvp-cooldown-timer');
                
                const updateTimer = () => {
                    const now = new Date();
                    const diff = expiresAt - now;
                    if (diff <= 0) {
                        cooldownDiv.style.display = 'none';
                        return;
                    }
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                };
                
                updateTimer();
                setInterval(updateTimer, 1000);
            } else {
                cooldownDiv.style.display = 'none';
            }
            
            // Последние бои
            const matchesList = document.getElementById('pvp-recent-matches-list');
            if (result.recentMatches && result.recentMatches.length > 0) {
                matchesList.innerHTML = result.recentMatches.map(m => {
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
        
    } catch (error) {
        console.error('Ошибка загрузки PvP статистики:', error);
    }
}

// ===========================================
// РЕФЕРАЛЬНАЯ СИСТЕМА
// ===========================================

/**
 * Загрузка реферального кода
 */
async function loadReferralCode() {
    try {
        const result = await apiRequest('/api/game/referral/code');
        
        if (result.success) {
            document.getElementById('referral-code').textContent = result.code;
            
            // Показываем/скрываем возможность изменить код
            const changeSection = document.getElementById('referral-change-section');
            if (result.can_change) {
                changeSection.style.display = 'block';
            } else {
                changeSection.style.display = 'none';
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
        const result = await apiRequest('/api/game/referral/stats');
        
        if (result.success) {
            document.getElementById('total-referrals').textContent = result.stats.total_referrals;
            document.getElementById('total-coins-earned').textContent = result.stats.total_coins_earned;
            document.getElementById('total-stars-earned').textContent = result.stats.total_stars_earned;
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
        const result = await apiRequest('/api/game/referral/list');
        
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
        } else {
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
 * Загрузка экрана сезонов
 */
async function loadSeasonsScreen() {
    await Promise.all([
        loadCurrentSeason(),
        loadSeasonEvents(),
        loadSeasonRating(),
        loadDailyTasks()
    ]);
    
    // Добавляем обработчики для вкладок рейтинга
    setupSeasonRatingTabs();
}

/**
 * Загрузка текущего сезона
 */
async function loadCurrentSeason() {
    try {
        const result = await apiRequest('/api/game/seasons/current');
        
        const seasonCurrent = document.getElementById('season-current');
        const seasonJoinSection = document.getElementById('season-join-section');
        
        if (!result.active) {
            seasonCurrent.innerHTML = `
                <div class="season-inactive">
                    <div class="season-icon">🎖️</div>
                    <h3>Сезон не активен</h3>
                    <p>${result.message || 'Ожидайте начала нового сезона!'}</p>
                </div>
            `;
            seasonJoinSection.style.display = 'none';
            return;
        }
        
        const season = result.season;
        const playerRank = result.player_rank;
        
        // Отображаем информацию о сезоне
        seasonCurrent.innerHTML = `
            <div class="season-info">
                <div class="season-header">
                    <h3>${season.name}</h3>
                    <span class="season-days">${season.days_left} дней осталось</span>
                </div>
                <p class="season-description">${season.description || ''}</p>
                ${playerRank ? `
                    <div class="season-rank-info">
                        <span class="rank-label">Твой ранг:</span>
                        <span class="rank-value">#${playerRank.rank}</span>
                        <span class="rank-points">${playerRank.points} очков</span>
                    </div>
                ` : ''}
            </div>
        `;
        
        // Показываем/скрываем кнопку присоединения
        seasonJoinSection.style.display = playerRank ? 'none' : 'block';
        
    } catch (error) {
        console.error('Ошибка загрузки сезона:', error);
    }
}

/**
 * Загрузка событий сезона
 */
async function loadSeasonEvents() {
    try {
        const result = await apiRequest('/api/game/seasons/events');
        
        const eventsList = document.getElementById('events-list');
        const modifiersList = document.getElementById('modifiers-list');
        
        if (!result.events || result.events.length === 0) {
            eventsList.innerHTML = '<p class="empty-message">Нет активных событий</p>';
            modifiersList.innerHTML = '<p class="empty-message">Нет активных бонусов</p>';
            return;
        }
        
        // Отображаем события
        eventsList.innerHTML = result.events.map(event => {
            const eventIcons = {
                'treasure_hunt': '💎',
                'double_exp': '✨',
                'pvp_tournament': '⚔️',
                'craft_marathon': '🔨',
                'radiation_storm': '☢️',
                'boss_invasion': '👹',
                'trade_festival': '🎉'
            };
            
            const icon = eventIcons[event.type] || '🎪';
            const modifiers = event.modifiers || {};
            const modText = Object.entries(modifiers)
                .filter(([k]) => k !== 'description')
                .map(([k, v]) => {
                    if (k.includes('multiplier') || k.includes('bonus')) {
                        return `${k}: x${v}`;
                    }
                    if (k.includes('discount') || k.includes('reduction')) {
                        return `${k}: -${Math.round(v * 100)}%`;
                    }
                    return `${k}: ${v}`;
                })
                .join(', ');
            
            return `
                <div class="event-card">
                    <div class="event-icon">${icon}</div>
                    <div class="event-info">
                        <h4>${event.name}</h4>
                        <p>${event.description || ''}</p>
                        <span class="event-modifiers">${modText}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        // Отображаем модификаторы
        const mods = result.active_modifiers || {};
        const activeMods = Object.entries(mods)
            .filter(([k, v]) => v !== 1 && v !== 0)
            .map(([k, v]) => {
                let value = v;
                if (k.includes('multiplier') || k.includes('bonus')) {
                    value = `x${v}`;
                } else if (k.includes('discount') || k.includes('reduction')) {
                    value = `-${Math.round(v * 100)}%`;
                }
                return { name: k, value };
            });
        
        if (activeMods.length === 0) {
            modifiersList.innerHTML = '<p class="empty-message">Нет активных бонусов</p>';
        } else {
            modifiersList.innerHTML = activeMods.map(mod => `
                <div class="modifier-item">
                    <span class="modifier-name">${mod.name.replace(/_/g, ' ')}</span>
                    <span class="modifier-value">${mod.value}</span>
                </div>
            `).join('');
        }
        
    } catch (error) {
        console.error('Ошибка загрузки событий:', error);
    }
}

/**
 * Загрузка рейтинга сезона
 */
async function loadSeasonRating() {
    try {
        const result = await apiRequest('/api/game/seasons/rating');
        
        const topRating = document.getElementById('season-top-rating');
        const myRating = document.getElementById('season-my-rating');
        
        if (!result.active) {
            topRating.innerHTML = '<p class="empty-message">Нет активного сезона</p>';
            myRating.innerHTML = '';
            return;
        }
        
        // Топ игроки
        if (result.rating && result.rating.length > 0) {
            topRating.innerHTML = result.rating.slice(0, 20).map((player, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                return `
                    <div class="rating-player">
                        <span class="rating-rank">${medal}</span>
                        <span class="rating-name">${player.username}</span>
                        <span class="rating-level">ур. ${player.level}</span>
                        <span class="rating-points">${player.points} оч.</span>
                    </div>
                `;
            }).join('');
        } else {
            topRating.innerHTML = '<p class="empty-message">Пока никто не участвует</p>';
        }
        
        // Моя позиция
        if (result.player_position) {
            const pos = result.player_position;
            myRating.innerHTML = `
                <div class="my-rank-card">
                    <div class="my-rank-position">#${pos.rank}</div>
                    <div class="my-rank-details">
                        <span>Твоё место среди ${pos.total} участников</span>
                        <span class="my-points">${pos.points} очков</span>
                    </div>
                </div>
            `;
        } else {
            myRating.innerHTML = '<p class="empty-message">Присоединись к сезону, чтобы участвовать в рейтинге</p>';
        }
        
    } catch (error) {
        console.error('Ошибка загрузки рейтинга:', error);
    }
}

/**
 * Загрузка ежедневных заданий
 */
async function loadDailyTasks() {
    try {
        const result = await apiRequest('/api/game/daily-tasks');
        
        const tasksProgress = document.getElementById('daily-tasks-progress');
        const tasksList = document.getElementById('daily-tasks-list');
        
        if (!result.tasks || result.tasks.length === 0) {
            tasksList.innerHTML = '<p class="empty-message">Нет доступных заданий</p>';
            return;
        }
        
        // Прогресс
        const progress = result.progress || { completed: 0, total: 0, percentage: 0 };
        tasksProgress.innerHTML = `
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress.percentage}%"></div>
            </div>
            <span class="progress-text">${progress.completed}/${progress.total} выполнено</span>
            ${result.event_bonus ? '<span class="event-badge">⚡ Бонус события!</span>' : ''}
        `;
        
        // Список заданий
        const taskIcons = {
            'kill_enemies': '💀',
            'collect_resources': '🪨',
            'craft_items': '🔨',
            'pvp_battles': '⚔️',
            'explore_locations': '🗺️',
            'trade_items': '💰',
            'boss_kills': '👹'
        };
        
        const taskNames = {
            'kill_enemies': 'Убить врагов',
            'collect_resources': 'Собрать ресурсы',
            'craft_items': 'Скрафтить предметы',
            'pvp_battles': 'PvP сражения',
            'explore_locations': 'Исследовать локации',
            'trade_items': 'Торговать',
            'boss_kills': 'Убить боссов'
        };
        
        tasksList.innerHTML = result.tasks.map(task => {
            const icon = taskIcons[task.type] || '📋';
            const name = taskNames[task.type] || task.type;
            const reward = task.reward || {};
            const progress = Math.min(100, Math.round((task.current / task.target) * 100));
            
            return `
                <div class="daily-task-card ${task.completed ? 'completed' : ''}">
                    <div class="task-icon">${icon}</div>
                    <div class="task-info">
                        <h4>${name}</h4>
                        <div class="task-progress">
                            <div class="task-progress-bar">
                                <div class="task-progress-fill" style="width: ${progress}%"></div>
                            </div>
                            <span>${task.current}/${task.target}</span>
                        </div>
                        <div class="task-reward">
                            ${reward.coins ? `<span>💰 ${reward.coins}</span>` : ''}
                            ${reward.exp ? `<span>✨ ${reward.exp}</span>` : ''}
                        </div>
                    </div>
                    ${task.completed ? `
                        <button class="claim-btn" onclick="claimDailyTask(${task.id})">
                            Получить
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Ошибка загрузки заданий:', error);
    }
}

/**
 * Настройка вкладок рейтинга
 */
function setupSeasonRatingTabs() {
    const tabs = document.querySelectorAll('.season-rating-tab');
    const topRating = document.getElementById('season-top-rating');
    const myRating = document.getElementById('season-my-rating');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            if (tab.dataset.tab === 'top') {
                topRating.style.display = 'block';
                myRating.style.display = 'none';
            } else {
                topRating.style.display = 'none';
                myRating.style.display = 'block';
            }
        });
    });
}

/**
 * Присоединение к сезону
 */
async function joinSeason() {
    try {
        const result = await apiRequest('/api/game/seasons/join', {
            method: 'POST'
        });
        
        if (result.success) {
            showModal('✅ Успех', result.message);
            loadCurrentSeason();
            loadSeasonRating();
        } else {
            showModal('❌ Ошибка', result.error);
        }
    } catch (error) {
        console.error('Ошибка присоединения к сезону:', error);
        showModal('❌ Ошибка', 'Не удалось присоединиться к сезону');
    }
}

/**
 * Получение награды за задание
 */
async function claimDailyTask(taskId) {
    try {
        const result = await apiRequest('/api/game/daily-tasks/claim', {
            method: 'POST',
            body: JSON.stringify({ task_id: taskId })
        });
        
        if (result.success) {
            showModal('✅ Награда получена!', 
                `${result.reward.coins ? `💰 ${result.reward.coins} ` : ''}` +
                `${result.reward.exp ? `✨ ${result.reward.exp} опыта` : ''}`);
            loadDailyTasks();
            loadCurrentSeason(); // Обновляем очки
        } else {
            showModal('❌ Ошибка', result.error);
        }
    } catch (error) {
        console.error('Ошибка получения награды:', error);
        showModal('❌ Ошибка', 'Не удалось получить награду');
    }
}

/**
 * Копирование реферального кода
 */
function copyReferralCode() {
    const code = document.getElementById('referral-code').textContent;
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
    const newCode = newCodeInput.value.trim().toUpperCase();
    
    if (!newCode) {
        showModal('❌ Ошибка', 'Введите новый код');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/referral/code', {
            method: 'PUT',
            body: JSON.stringify({ new_code: newCode })
        });
        
        if (result.success) {
            document.getElementById('referral-code').textContent = result.code;
            document.getElementById('referral-change-section').style.display = 'none';
            newCodeInput.value = '';
            showModal('✅ Успех', 'Реферальный код изменён!');
        } else {
            showModal('❌ Ошибка', result.error || 'Не удалось изменить код');
        }
    } catch (error) {
        console.error('Ошибка изменения реферального кода:', error);
        showModal('❌ Ошибка', 'Произошла ошибка');
    }
}

/**
 * Использование реферального кода
 */
async function useReferralCode() {
    const codeInput = document.getElementById('use-referral-code');
    const code = codeInput.value.trim().toUpperCase();
    
    if (!code) {
        showModal('❌ Ошибка', 'Введите реферальный код');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/referral/use', {
            method: 'POST',
            body: JSON.stringify({ code: code })
        });
        
        if (result.success) {
            showModal(
                '🎁 Бонус получен!',
                `Ты получил: +${result.bonus.coins} монет, +${result.bonus.energy} Energy!`
            );
            codeInput.value = '';
            // Обновляем профиль
            loadProfile();
        } else {
            showModal('❌ Ошибка', result.error || 'Не удалось использовать код');
        }
    } catch (error) {
        console.error('Ошибка использования реферального кода:', error);
        showModal('❌ Ошибка', 'Произошла ошибка');
    }
}

/**
 * Инициализация обработчиков реферальной системы
 */
function initReferralHandlers() {
    // Кнопка копирования кода
    document.getElementById('copy-referral-code')?.addEventListener('click', copyReferralCode);
    
    // Кнопка изменения кода
    document.getElementById('change-referral-code-btn')?.addEventListener('click', changeReferralCode);
    
    // Кнопка использования кода
    document.getElementById('use-referral-code-btn')?.addEventListener('click', useReferralCode);
}

// Добавляем вызов инициализации при загрузке
document.addEventListener('DOMContentLoaded', () => {
    initReferralHandlers();
});
