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
        
        // Загружаем профиль с обработкой ошибок
        try {
            await loadProfile();
        } catch (profileError) {
            console.error('[initGame] Ошибка загрузки профиля:', profileError);
            // Продолжаем - профиль может быть загружен позже
        }
        
        // Загружаем локации с обработкой ошибок
        try {
            await loadLocations();
        } catch (locationsError) {
            console.error('[initGame] Ошибка загрузки локаций:', locationsError);
            // Продолжаем - локации могут быть загружены позже
        }

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
        } else if (error.message && (error.message.includes('network') || error.message.includes('fetch'))) {
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
    const data = response?.data || response;
    
    if (!data || typeof data !== 'object') {
        console.error('Неверный формат ответа профиля:', response);
        return;
    }
    
    // Гарантируем наличие объекта статуса
    if (!data.status || typeof data.status !== 'object') {
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

// Ссылка на константу интервала энергии из game-core.js
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

// Исправленная функция - теперь только уровень влияет на дроп
function updateDropChanceDisplay() {
    const luck = gameState.player?.stats?.luck || gameState.player?.luck || 1;
    const dropChance = Math.min(60, 10 + (luck * 0.4));
    const dropChanceEl = document.getElementById('player-drop-chance');
    if (dropChanceEl) {
        dropChanceEl.textContent = `${Math.round(dropChance * 10) / 10}%`;
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

function updateMainProgressCards(player) {
    const expProgress = player.exp_progress || { current: 0, needed: 0 };
    const remainingXp = Math.max(0, Number(expProgress.needed || 0) - Number(expProgress.current || 0));
    const nextLevelValue = document.getElementById('next-level-value');
    const nextLevelDesc = document.getElementById('next-level-desc');
    if (nextLevelValue) nextLevelValue.textContent = `${remainingXp} XP`;
    if (nextLevelDesc) nextLevelDesc.textContent = `До уровня ${(player.level || 1) + 1}`;

    const bossInsight = getBossInsight();
    const nextBossValue = document.getElementById('next-boss-value');
    const nextBossDesc = document.getElementById('next-boss-desc');
    if (nextBossValue) nextBossValue.textContent = bossInsight.value;
    if (nextBossDesc) nextBossDesc.textContent = bossInsight.desc;

    const rewardInsight = getAchievementInsight();
    const nextRewardValue = document.getElementById('next-reward-value');
    const nextRewardDesc = document.getElementById('next-reward-desc');
    if (nextRewardValue) nextRewardValue.textContent = rewardInsight.value;
    if (nextRewardDesc) nextRewardDesc.textContent = rewardInsight.desc;
}

function updateMainBonuses(player) {
    updateDropChanceDisplay();

    const strength = Number(player.stats?.strength || player.strength || 1);
    const weaponDamage = Number(player.equipment?.weapon?.damage || 0);
    const damagePreviewEl = document.getElementById('player-damage-preview');
    if (damagePreviewEl) {
        damagePreviewEl.textContent = `+${strength + weaponDamage}`;
    }

    const status = player.status || {};
    const survivalPreviewEl = document.getElementById('player-survival-preview');
    if (survivalPreviewEl) {
        if ((status.radiation || 0) >= 5 || (status.infections || 0) > 0) {
            survivalPreviewEl.textContent = 'Риск';
        } else if ((status.health || 0) <= ((status.max_health || 100) * 0.5)) {
            survivalPreviewEl.textContent = 'Низкое HP';
        } else {
            survivalPreviewEl.textContent = 'Стабильно';
        }
    }
}

function updateRiskSummary(player) {
    const status = player.status || {};
    const health = Number(status.health || 0);
    const maxHealth = Math.max(1, Number(status.max_health || 100));
    const healthPercent = Math.round((health / maxHealth) * 100);
    const radiation = Number(status.radiation || 0);
    const infections = Number(status.infections || 0);

    const card = document.getElementById('risk-summary-card');
    const levelEl = document.getElementById('risk-summary-level');
    const textEl = document.getElementById('risk-summary-text');
    const actionEl = document.getElementById('risk-summary-action');

    let risk = 'safe';
    let level = 'Стабильно';
    let text = 'Пока всё под контролем — можно безопасно продолжать вылазку.';
    let action = 'Ищи лут';

    if (health <= 0 || radiation >= 8 || infections >= 3) {
        risk = 'danger';
        level = 'Критическое состояние';
        text = 'Есть высокий шанс сорвать прогресс. Сначала стабилизируй персонажа.';
        action = 'Срочно лечиться';
    } else if (healthPercent <= 50 || radiation >= 5 || infections > 0) {
        risk = 'warning';
        level = 'Повышенный риск';
        text = 'Можно играть дальше, но дебаффы и низкое здоровье уже заметно мешают.';
        action = 'Купить расходники';
    }

    if (card) card.dataset.risk = risk;
    if (levelEl) levelEl.textContent = level;
    if (textEl) textEl.textContent = text;
    if (actionEl) actionEl.textContent = action;
}

function setQuickEntryBadge(id, text) {
    const badge = document.getElementById(id);
    if (!badge) return;

    if (!text) {
        badge.style.display = 'none';
        badge.textContent = '';
        return;
    }

    badge.style.display = 'inline-flex';
    badge.textContent = text;
}

function updateQuickEntryBadges(player) {
    const bossInsight = getBossInsight();
    const rewardInsight = getAchievementInsight();
    const locationDanger = Number(player.location?.danger_level || 1);
    const status = player.status || {};

    setQuickEntryBadge('bosses-badge', bossInsight.available ? 'доступно' : 'цель');
    setQuickEntryBadge('shop-badge', ((status.radiation || 0) >= 5 || (status.infections || 0) > 0 || (status.health || 0) <= ((status.max_health || 100) * 0.5)) ? 'нужно' : 'запасы');
    setQuickEntryBadge('rating-badge', rewardInsight.desc.includes('готова') ? 'награда' : 'топы');
    setQuickEntryBadge('pvp-badge', locationDanger >= 6 ? 'опасно' : 'закрыто');
}

function updateMainScreenInsights(player) {
    if (!player) return;

    updateMainRecommendationUI(player);
    updateMainProgressCards(player);
    updateMainBonuses(player);
    updateRiskSummary(player);
    updateQuickEntryBadges(player);
}

function handleMainGuidanceAction(action) {
    switch (action) {
        case 'search':
            document.getElementById('search-btn')?.click();
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
    const mainStars = document.getElementById('main-stars-value');
    const mainCoins = document.getElementById('main-coins-value');
    if (invStars) invStars.textContent = player.stars || 0;
    if (invCoins) invCoins.textContent = player.coins || 0;
    if (mainStars) mainStars.textContent = player.stars || 0;
    if (mainCoins) mainCoins.textContent = player.coins || 0;
    
    // Обновляем отображение переломов и инфекций
    updateConditionsUI(status);
    updateMainScreenInsights(player);
    refreshMainScreenInsights().catch(error => {
        console.debug('Не удалось обновить инсайты главного экрана:', error);
    });
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
 */
async function searchLoot() {
    // Блокировка двойного нажатия
    if (actionLocks.searchLoot) return;
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
            
            // Обновляем профиль после получения XP
            if (result.exp_gained !== undefined) {
                await loadProfile();
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
                errorMsg = `Недостаточно энергии! Требуется: 1, у вас: ${result.energy || 0}`;
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
            showScreen('main');
            showModal('✅ Успех', result.message || result.data?.message);
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
// ИСПОЛЬЗОВАНИЕ ПРЕДМЕТОВ
// ============================================================================

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
        const response = await apiRequest('/api/game/inventory');
        const data = response.data || response;
        const inventoryItems = Array.isArray(data.inventory) ? data.inventory : [];

        gameState.inventory = inventoryItems;
        
        // Обновляем статистику
        const invCoins = document.getElementById('inv-coins');
        const invStars = document.getElementById('inv-stars');
        if (invCoins) invCoins.textContent = gameState.player?.coins || 0;
        if (invStars) invStars.textContent = gameState.player?.stars || 0;
        
        // Применяем фильтр и сортировку
        renderInventoryWithFilters(inventoryItems);
        
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
    
    const normalizedItems = Array.isArray(items) ? items : [];

    for (const item of normalizedItems) {
        const slot = document.createElement('div');
        slot.className = `inventory-slot item-rarity rarity-${item.rarity || 'common'}`;
        slot.innerHTML = `
            <span class="item-icon">${item.icon || '📦'}</span>
            <span class="item-count">${item.count || 1}</span>
        `;
        
        // Обработчик клика - использовать предмет
        slot.addEventListener('click', () => useItem(item.index));
        
        grid.appendChild(slot);
    }
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
            const category = getItemCategory(item.id);
            return category === currentInventoryFilter;
        });
    }
    
    // Сортировка предметов
    const sortKey = typeof currentInventorySort !== 'undefined' ? currentInventorySort : 'id';
    filteredItems.sort((a, b) => {
        switch (sortKey) {
            case 'name':
                return (a.name || '').localeCompare(b.name || '');
            case 'rarity':
                const rarityOrder = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
                const rA = rarityOrder[a.rarity] || 0;
                const rB = rarityOrder[b.rarity] || 0;
                return rB - rA;
            case 'count':
                return (b.count || 1) - (a.count || 1);
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
    try {
        const response = await apiRequest('/api/game/bosses');
        const data = response?.data || response;

        gameState.bosses = Array.isArray(data?.bosses) ? data.bosses : [];
        gameState.raids = Array.isArray(data?.raids) ? data.raids : [];
        gameState.raidsParticipating = data?.participating_boss_ids || [];
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
        renderBosses([]);
    }
}

function renderBossesInfo(info) {
    const container = document.getElementById('bosses-info');
    if (!container) return;

    if (!info) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="bosses-info-card">
            <div><strong>Соло:</strong> ${info.solo || ''}</div>
            <div><strong>Прокачка:</strong> ${info.mastery || ''}</div>
            <div><strong>Массовый бой:</strong> ${info.raids || ''}</div>
        </div>
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

// Обработчик переключателя режима боссов
document.getElementById('boss-mode-switch')?.addEventListener('change', function() {
    switchBossesTab(this.checked ? 'mass' : 'solo');
});

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
            <p>1 удар = 1 энергия. Бой длится 8 часов.</p>
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
        attackSingleBtn.textContent = '⚔️ Атаковать (1 ⚡)';
    }
    
    // Скрываем прогресс
    if (progressContainer) progressContainer.style.display = 'none';
    const attackMultiBtn = document.getElementById('attack-boss-multiple-btn');
    if (attackMultiBtn) attackMultiBtn.style.display = 'none';
    
    // Добавляем обработчики кнопок если ещё не добавлены
    if (attackSingleBtn && !attackSingleBtn.hasAttribute('data-handler')) {
        attackSingleBtn.setAttribute('data-handler', 'true');
        attackSingleBtn.addEventListener('click', attackBoss);
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
    
    const updateTimer = () => {
        const now = Date.now();
        const remaining = gameState.bossFightEndTime - now;
        
        if (remaining <= 0) {
            timerText.textContent = 'Время вышло!';
            timerText.style.color = 'var(--accent-red)';
            return;
        }
        
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        timerText.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };
    
    updateTimer();
    if (window.bossFightTimerId) clearInterval(window.bossFightTimerId);
    window.bossFightTimerId = setInterval(updateTimer, 1000);
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
        item.className = 'weapon-item';
        item.dataset.index = weapon.index;
        
        item.innerHTML = `
            <span class="weapon-icon">${weapon.icon}</span>
            <div class="weapon-info">
                <div class="weapon-name">${weapon.name}</div>
                <div class="weapon-damage">Урон: +${weapon.damage}</div>
            </div>
            <span class="weapon-rarity ${weapon.rarity}">${weapon.rarity}</span>
        `;
        
        item.addEventListener('click', () => attackWithWeapon(weapon.index));
        list.appendChild(item);
    }
}

/**
 * Атака босса с использованием оружия из инвентаря
 */
async function attackWithWeapon(itemIndex) {
    if (!gameState.currentBoss) return;
    
    if (actionLocks.attackBoss) return;
    actionLocks.attackBoss = true;
    
    const status = gameState.player?.status;
    if (!status || status.energy < 1) {
        showModal('⚠️ Нет энергии', 'Подожди пока восстановится или купи за звёзды');
        actionLocks.attackBoss = false;
        return;
    }
    
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
                damageText.innerHTML = `<span class="hit">⚔️</span> Использовал <strong>${result.data.weapon_used}</strong>! Нанёс <strong>${result.data.damage}</strong> урона!`;
                log.appendChild(damageText);
                log.scrollTop = log.scrollHeight;
            }
            
            const hpPercent = Math.max(0, Math.min(100, (result.data.boss_hp / result.data.boss_max_hp) * 100));
            const bossHealthBar = document.getElementById('boss-health-bar');
            const bossHealthText = document.getElementById('boss-health-text');
            if (bossHealthBar) bossHealthBar.style.width = `${hpPercent}%`;
            if (bossHealthText) bossHealthText.textContent = `${result.data.boss_hp}/${result.data.boss_max_hp}`;
            
            syncPlayerEnergyState(result.data.energy, gameState.player?.status?.max_energy);
            refreshPlayerEnergyUI();
            
            if (result.data.killed) {
                showModal('🎉 Победа!', `Босс повержён! Награда: ${result.data.rewards.coins} монет, ${result.data.rewards.experience} опыта`);
                await loadBosses();
                showScreen('bosses');
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
            const hpPercent = Math.max(0, Math.min(100, (result.boss_hp / result.boss_max_hp) * 100));
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
            ${clan.description ? `<p class="clan-description">${escapeHtml(clan.description)}</p>` : ''}
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
            return '<div class="clan-list-item" data-clan-id="' + escapeHtml(clan.id) + '">' +
                '<div class="clan-list-icon">🏰</div>' +
                '<div class="clan-list-info">' +
                    '<div class="clan-list-name">' + escapeHtml(clan.name) + '</div>' +
                    '<div class="clan-list-stats">👥 ' + (clan.member_count || 1) + ' | Уровень ' + escapeHtml(clan.level) + '</div>' +
                '</div>' +
                '<button class="join-btn" data-clan-id="' + escapeHtml(clan.id) + '">Вступить</button>' +
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
        const result = await apiRequest('/api/game/player/buy-energy', {
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
window.restoreEnergy = restoreEnergy;
window.loadRating = loadRating;
window.renderRating = renderRating;
window.watchAd = watchAd;
window.healInfections = healInfections;
window.showLootAnimation = showLootAnimation;
window.showDamageEffect = showDamageEffect;
window.playSound = playSound;
window.updateBalanceDisplay = updateBalanceDisplay;
