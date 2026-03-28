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
    renderShopCategory('buffs');
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
        
        return `
            <div class="shop-item" data-item-id="${item.id}">
                <div class="shop-item-icon">${item.icon}</div>
                <div class="shop-item-info">
                    <div class="shop-item-name">${item.name}</div>
                    <div class="shop-item-desc">${item.desc}</div>
                </div>
                <div class="shop-item-price">${priceText}</div>
                <button class="shop-buy-btn" ${item.price === 0 && item.currency !== 'free' ? 'disabled' : ''}>
                    ${item.type === 'game' ? 'Играть' : 'Купить'}
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
            // Применяем эффект баффа
            if (category === 'buffs') {
                applyBuff(item);
            }
            
            // Обновляем валюту из правильных полей ответа
            if (result.balance !== undefined) {
                player.balance = result.balance;
            }
            if (result.coins !== undefined) {
                player.coins = result.coins;
            }
            // Для совместимости со старым API
            if (result.new_stars !== undefined) {
                player.stars = result.new_stars;
            }
            if (result.new_coins !== undefined) {
                player.coins = result.new_coins;
            }
            
            showModal('✅ Успешно!', `Куплено: ${item.name}`);
            showConfetti();
        }
    } catch (error) {
        showModal('❌ Ошибка', 'Не удалось совершить покупку');
    }
}

/**
 * Применение баффа
 * @param {Object} buff - данные баффа
 */
function applyBuff(buff) {
    gameState.buffs = gameState.buffs || {};
    gameState.buffs[buff.effect] = {
        expires: Date.now() + (buff.duration * 1000)
    };
    
    showNotification(`⚡ ${buff.name} активирован!`, 'success');
    
    // Запускаем таймер окончания
    setTimeout(() => {
        delete gameState.buffs[buff.effect];
        showNotification(`⏰ ${buff.name} закончился`, 'info');
    }, buff.duration * 1000);
}

/**
 * Проверка активных баффов
 */
function checkActiveBuffs() {
    if (!gameState.buffs) return;
    
    const now = Date.now();
    for (const [effect, data] of Object.entries(gameState.buffs)) {
        if (data.expires && now >= data.expires) {
            delete gameState.buffs[effect];
        }
    }
}

/**
 * Проверка баффа
 * @param {string} effect - эффект
 * @returns {boolean} активен ли бафф
 */
function hasBuff(effect) {
    return gameState.buffs?.[effect] !== undefined;
}

// ============================================
// КОЛЕСО УДАЧИ
// ============================================

const WHEEL_PRIZES = [
    { type: 'coins', value: 10, text: '10 монет' },
    { type: 'coins', value: 25, text: '25 монет' },
    { type: 'coins', value: 50, text: '50 монет' },
    { type: 'coins', value: 100, text: '100 монет' },
    { type: 'multiplier', value: 2, text: 'x2 к монетам' },
    { type: 'energy', value: 20, text: '20 энергии' },
];

/**
 * Открытие колеса удачи
 */
function openWheel() {
    showScreen('wheel');
}

/**
 * Бесплатное вращение колеса
 */
async function spinWheelFree() {
    try {
        const response = await gameApi.post('/game/wheel/spin', { is_paid: false });
        
        if (!response.success) {
            if (response.code === 'COOLDOWN' && response.next_free_spin) {
                const minutes = Math.ceil(response.next_free_spin / 60000);
                showModal('⏳ Подождите', `Следующее бесплатное вращение через ${minutes} мин.`, 'info');
            } else {
                showModal('❌ Ошибка', response.error || 'Не удалось крутить колесо', 'error');
            }
            return;
        }
        
        // Анимация с призом от сервера
        spinWheelAnimation(response.data.prize, false);
        
    } catch (error) {
        console.error('Ошибка вращения колеса:', error);
        showModal('❌ Ошибка', 'Не удалось связаться с сервером', 'error');
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
    
    try {
        const response = await gameApi.post('/game/wheel/spin', { is_paid: true });
        
        if (!response.success) {
            showModal('❌ Ошибка', response.error || 'Не удалось крутить колесо', 'error');
            return;
        }
        
        // Анимация с призом от сервера
        spinWheelAnimation(response.data.prize, true);
        
    } catch (error) {
        console.error('Ошибка вращения колеса:', error);
        showModal('❌ Ошибка', 'Не удалось связаться с сервером', 'error');
    }
}

/**
 * Анимация колеса
 * @param {object} prize - приз от сервера
 * @param {boolean} isPaid - платное вращение
 */
function spinWheelAnimation(prize, isPaid) {
    const wheel = document.getElementById('wheel');
    
    // Анимация
    const rotations = 5 + Math.random() * 5;
    const prizeIndex = WHEEL_PRIZES.findIndex(p => p.type === prize.type && p.value === prize.value);
    const finalAngle = rotations * 360 + (360 / WHEEL_PRIZES.length) * (prizeIndex >= 0 ? prizeIndex : 0);
    
    wheel.style.transition = 'transform 3s ease-out';
    wheel.style.transform = `rotate(${finalAngle}deg)`;
    
    setTimeout(() => {
        // Выдача приза
        const player = gameState.player;
        
        if (prize.type === 'coins') {
            showModal('🎉 Выигрыш!', `Выпало: ${prize.text}`, 'success');
        } else if (prize.type === 'multiplier') {
            showModal('🎉 Удвоение!', `Множитель x${prize.value}!`, 'success');
        } else if (prize.type === 'energy') {
            showModal('⚡ Энергия!', `+${prize.value} энергии!`, 'success');
        }
        
        showConfetti(80);
        
        // Обновляем данные игрока после вращения
        // Вызываем status/check для получения актуальных данных
        gameApi.post('/game/status/check', {}).catch(e => console.error('Failed to update player:', e));
        
        // Сброс колеса
        setTimeout(() => {
            wheel.style.transition = 'none';
            wheel.style.transform = 'rotate(0deg)';
        }, 2000);
        
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
            container.innerHTML = '<div class="error">Ошибка загрузки товаров</div>';
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
        const rarityClass = item.rarity || 'common';
        const prepTag = item.stats?.radiation_cure || item.stats?.infection_cure || item.stats?.radiation_resist || item.stats?.infection_resist
            ? '<div class="shop-item-role">Подготовка к опасной зоне</div>'
            : '';
        return `
            <div class="shop-item-card ${rarityClass}" data-item-id="${item.id}">
                <div class="shop-item-icon">${item.icon || '📦'}</div>
                <div class="shop-item-info">
                    <div class="shop-item-name">${escapeHtml(item.name)}</div>
                    <div class="shop-item-desc">${escapeHtml(item.description || '')}</div>
                    ${prepTag}
                    <div class="shop-item-stats">
                        ${renderItemStats(item.stats)}
                    </div>
                </div>
                <div class="shop-item-buy">
                    <div class="shop-item-price">💰 ${formatNumber(item.price || 0)}</div>
                    <button class="buy-btn" onclick="buyCoinItem(${item.id})">Купить</button>
                </div>
            </div>
        `;
    }).join('');
    
    // Обработчики категорий
    document.querySelectorAll('.shop-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
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
    if (stats.damage) statLines.push(`⚔️ Урон: +${stats.damage}`);
    if (stats.defense) statLines.push(`🛡️ Защита: +${stats.defense}`);
    if (stats.health) statLines.push(`❤️ Здоровье: +${stats.health}`);
    if (stats.energy) statLines.push(`⚡ Энергия: +${stats.energy}`);
    if (stats.radiation_cure) statLines.push(`☢️ Лечение радиации: ${stats.radiation_cure}`);
    if (stats.infection_cure) statLines.push(`🦠 Лечение инфекции: ${stats.infection_cure}`);
    if (stats.radiation_resist) statLines.push(`🛡️ Защита от радиации: ${stats.radiation_resist}`);
    if (stats.infection_resist) statLines.push(`🧪 Защита от инфекции: ${stats.infection_resist}`);
    return statLines.join('<br>');
}

async function buyCoinItem(itemId) {
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
    
    try {
        const response = await gameApi.post('/game/items/buy', { 
            item_id: itemId,
            currency: 'coins'
        });
        
        if (response.success) {
            showModal('✅ Успешно', `Вы купили ${item.name}!`);
            
            // Обновляем баланс
            if (gameState.player) {
                gameState.player.coins = (gameState.player.coins || 0) - price;
                const balanceEl = document.getElementById('shop-coins-balance');
                if (balanceEl) {
                    balanceEl.textContent = formatNumber(gameState.player.coins);
                }
            }
            
            // Перезагружаем инвентарь
            if (typeof loadInventory === 'function') {
                loadInventory();
            }
        } else {
            showModal('❌ Ошибка', response.error || 'Не удалось купить предмет');
        }
    } catch (error) {
        console.error('Ошибка покупки:', error);
        showModal('❌ Ошибка', 'Не удалось купить предмет');
    }
}

// Экспорт функции openShop в window для использования в других модулях
window.openShop = openShop;
window.loadCoinShop = loadCoinShop;
window.buyCoinItem = buyCoinItem;
