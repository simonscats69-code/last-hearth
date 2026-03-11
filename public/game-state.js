/**
 * ============================================
 * СОСТОЯНИЕ ИГРЫ (Game State)
 * ============================================
 * Управление глобальным состоянием игры
 */

// Глобальное состояние игры
const gameState = {
    // Данные игрока
    player: null,
    
    // Инвентарь
    inventory: {},
    
    // Текущая локация
    currentLocation: null,
    
    // Доступные локации
    locations: [],
    
    // Локации для рейтинга (map)
    locationPositions: {},
    
    // Рецепты крафта
    recipes: [],
    
    // Боссы
    bosses: [],
    
    // Текущий босс
    currentBoss: null,
    
    // Достижения
    achievements: [],
    
    // Задания
    quests: [],
    
    // Данные клана
    clan: null,
    
    // Активные баффы
    buffs: {},
    
    // Монеты и звёзды
    coins: 0,
    stars: 0,
    
    // Текущий экран
    currentScreen: 'main',
    
    // Активные рейды
    activeRaids: [],
    
    // Данные сезона
    seasonData: null,
    
    // Стрик входа (дней)
    loginStreak: 0,
    
    // Последний вход
    lastLogin: null,
    
    // Активные дебаффы
    debuffs: {
        radiation: {
            level: 0,
            expiresAt: null,
            active: false
        },
        infections: []
    },
    
    // Модификаторы от дебаффов
    modifiers: {
        damage: 1.0,
        luck: 1.0,
        searchTime: 1.0,
        dropChance: 1.0,
        endurance: 1.0
    }
};

/**
 * Инициализация состояния игры
 */
function initGameState() {
    // Сброс состояния
    gameState.player = null;
    gameState.inventory = {};
    gameState.currentLocation = null;
    gameState.locations = [];
    gameState.locationPositions = {};
    gameState.recipes = [];
    gameState.bosses = [];
    gameState.currentBoss = null;
    gameState.achievements = [];
    gameState.quests = [];
    gameState.clan = null;
    gameState.buffs = {};
    gameState.coins = 0;
    gameState.stars = 0;
    gameState.activeRaids = [];
    gameState.seasonData = null;
}

/**
 * Обновление состояния игрока
 * @param {Object} playerData - данные игрока
 */
function updatePlayerState(playerData) {
    gameState.player = playerData;
    
    // Обновляем отображение
    updateProfileUI();
}

/**
 * Обновление UI на основе состояния
 */
function updateUI() {
    if (!gameState.player) return;
    
    // Обновляем никнейм
    const nameEl = document.getElementById('player-name');
    if (nameEl) nameEl.textContent = gameState.player.name || 'Игрок';
    
    // Обновляем уровень
    const levelEl = document.getElementById('player-level');
    if (levelEl) levelEl.textContent = gameState.player.level || 1;
    
    // Обновляем монеты
    const coinsEl = document.getElementById('player-coins');
    if (coinsEl) coinsEl.textContent = gameState.player.coins || 0;
    
    // Обновляем звёзды
    const starsEl = document.getElementById('player-stars');
    if (starsEl) starsEl.textContent = gameState.player.stars || 0;
    
    // Обновляем энергию
    const energyEl = document.getElementById('player-energy');
    if (energyEl && gameState.player.energy !== undefined) {
        energyEl.textContent = gameState.player.energy;
        const maxEnergy = gameState.player.max_energy || 100;
        energyEl.style.width = `${(gameState.player.energy / maxEnergy) * 100}%`;
    }
    
    // Обновляем HP
    const hpEl = document.getElementById('player-hp');
    if (hpEl && gameState.player.hp !== undefined) {
        hpEl.textContent = gameState.player.hp;
        const maxHp = gameState.player.max_hp || 100;
        hpEl.style.width = `${(gameState.player.hp / maxHp) * 100}%`;
    }
    
    // Обновляем радиацию (теперь это уровень 0-10 из JSONB)
    const radEl = document.getElementById('player-radiation');
    if (radEl && gameState.player.radiation !== undefined) {
        // radiation может быть числом (новый формат) или объектом
        let radValue = gameState.player.radiation;
        if (typeof radValue === 'object' && radValue !== null) {
            radValue = radValue.level || 0;
        }
        radEl.textContent = radValue;
    }
    
    // Обновляем статы
    updateStatsUI();
}

/**
 * Обновление UI статов
 */
function updateStatsUI() {
    if (!gameState.player?.stats) return;
    
    const stats = gameState.player.stats;
    
    // Сила
    const strEl = document.getElementById('stat-strength');
    if (strEl) strEl.textContent = stats.strength || 1;
    
    // Выносливость
    const endEl = document.getElementById('stat-endurance');
    if (endEl) endEl.textContent = stats.endurance || 1;
    
    // Ловкость
    const agiEl = document.getElementById('stat-agility');
    if (agiEl) agiEl.textContent = stats.agility || 1;
    
    // Интеллект
    const intEl = document.getElementById('stat-intelligence');
    if (intEl) intEl.textContent = stats.intelligence || 1;
    
    // Удача
    const luckEl = document.getElementById('stat-luck');
    if (luckEl) luckEl.textContent = stats.luck || 1;
}

/**
 * Проверка и обновление стрика входа
 */
function checkLoginStreak() {
    const now = new Date();
    const last = gameState.lastLogin ? new Date(gameState.lastLogin) : null;
    
    if (!last) {
        // Первый вход
        gameState.loginStreak = 1;
    } else {
        const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            // Подряд
            gameState.loginStreak++;
        } else if (diffDays > 1) {
            // Стрик сброшен
            gameState.loginStreak = 1;
        }
        // diffDays === 0 - тот же день, ничего не меняем
    }
    
    gameState.lastLogin = now.toISOString();
    saveGameState();
    
    return gameState.loginStreak;
}

/**
 * Получение награды за стрик
 * @returns {Object} награда
 */
function getStreakReward() {
    const streak = gameState.loginStreak || 1;
    
    // Награда растёт со стриком
    const rewards = {
        1: { coins: 10, stars: 0 },
        2: { coins: 25, stars: 0 },
        3: { coins: 50, stars: 0 },
        4: { coins: 75, stars: 0 },
        5: { coins: 100, stars: 1 },
        6: { coins: 150, stars: 1 },
        7: { coins: 200, stars: 2 }
    };
    
    return rewards[Math.min(streak, 7)];
}

/**
 * Обновить дебаффы из ответа сервера
 * @param {Object} debuffsData - данные дебаффов от сервера
 */
function updateDebuffs(debuffsData) {
    if (!debuffsData) return;
    
    gameState.debuffs = {
        radiation: {
            level: debuffsData.radiation?.level || 0,
            expiresAt: debuffsData.radiation?.expires_at,
            active: (debuffsData.radiation?.level || 0) > 0
        },
        infections: debuffsData.infections || []
    };
    
    gameState.modifiers = debuffsData.modifiers || {
        damage: 1.0,
        luck: 1.0,
        searchTime: 1.0,
        dropChance: 1.0,
        endurance: 1.0
    };
    
    renderDebuffsPanel();
}

/**
 * Проверить есть ли активные дебаффы
 * @returns {boolean}
 */
function hasActiveDebuffs() {
    return gameState.debuffs.radiation.level > 0 || 
           gameState.debuffs.infections.length > 0;
}

/**
 * Форматировать оставшееся время дебаффа
 * @param {string|null} expiresAt - timestamp истечения
 * @returns {string}
 */
function formatTimeRemaining(expiresAt) {
    if (!expiresAt) return '';
    
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires - now;
    
    if (diff <= 0) return 'истёк';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
        return `${hours}ч ${minutes}м`;
    }
    return `${minutes}м`;
}

/**
 * Отобразить панель дебаффов
 */
function renderDebuffsPanel() {
    const panel = document.getElementById('debuffs-panel');
    if (!panel) return;
    
    if (!hasActiveDebuffs()) {
        panel.classList.add('hidden');
        return;
    }
    
    panel.classList.remove('hidden');
    
    // Обновляем радиацию
    const radLevel = gameState.debuffs.radiation.level;
    const radBar = document.getElementById('debuff-radiation-bar');
    const radTimer = document.getElementById('debuff-radiation-timer');
    const radPanel = document.getElementById('debuff-radiation-panel');
    
    if (radPanel) {
        if (radLevel > 0) {
            radPanel.classList.remove('hidden');
            if (radBar) radBar.style.width = `${radLevel * 10}%`;
            if (radTimer) radTimer.textContent = formatTimeRemaining(gameState.debuffs.radiation.expiresAt);
        } else {
            radPanel.classList.add('hidden');
        }
    }
    
    // Обновляем инфекции
    const totalInfection = gameState.debuffs.infections.reduce((sum, i) => sum + (i.level || 0), 0);
    const infBar = document.getElementById('debuff-infection-bar');
    const infTimer = document.getElementById('debuff-infection-timer');
    const infPanel = document.getElementById('debuff-infection-panel');
    
    if (infPanel) {
        if (totalInfection > 0) {
            infPanel.classList.remove('hidden');
            if (infBar) infBar.style.width = `${totalInfection * 10}%`;
            
            // Находим максимальное время истечения
            const maxExpires = gameState.debuffs.infections.reduce((max, i) => {
                if (!i.expires_at) return max;
                const exp = new Date(i.expires_at);
                return exp > max ? exp : max;
            }, new Date(0));
            
            if (infTimer && maxExpires > new Date()) {
                infTimer.textContent = formatTimeRemaining(maxExpires.toISOString());
            }
        } else {
            infPanel.classList.add('hidden');
        }
    }
}
