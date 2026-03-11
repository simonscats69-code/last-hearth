/**
 * game-ui.js - Интерфейс и обработчики событий
 * Обработчики DOM, фильтры, модальные окна, PvP, рынок, достижения, сезоны, рефералы
 * 
 * Подключение: после game-systems.js
 * Зависимости: все функции из game-core.js и game-systems.js
 */

// ============================================================================
// ФИЛЬТРЫ ИНВЕНТАРЯ
// ============================================================================

// Глобальные переменные для фильтрации и сортировки инвентаря
let currentInventoryFilter = 'all';
let currentInventorySort = 'id';
let inventoryControlsInitialized = false;

/**
 * Инициализация обработчиков кнопок фильтрации и сортировки
 */
function initInventoryControls() {
    if (inventoryControlsInitialized) return;
    inventoryControlsInitialized = true;

    // Кнопки фильтров
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentInventoryFilter = btn.dataset.filter;
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

// ============================================================================
// ДОСТИЖЕНИЯ
// ============================================================================

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
        let reward;
        try {
            reward = typeof ach.reward === 'string' ? JSON.parse(ach.reward) : ach.reward;
        } catch(e) {
            console.error('JSON.parse reward failed:', ach.reward);
            reward = ach.reward;
        }
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
        const data = await apiRequest('/api/game/achievements/claim', {
            method: 'POST',
            body: { achievement_id: achievementId }
        });
        
        if (data.success) {
            alert(data.message);
            updateBalanceDisplay(data.new_balance);
            await loadAchievements();
        } else {
            alert(data.error || 'Ошибка получения награды');
        }
    } catch (error) {
        console.error('Ошибка получения награды:', error);
        alert('Ошибка получения награды');
    }
}

// ============================================================================
// РЫНОК (БАРАХОЛКА)
// ============================================================================

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
    const container = getEl('market-listings-list');
    if (!container) return;

    renderList(
        container,
        listings,
        (listing) => {
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
                            <span class="seller">Продавец: ${escapeHtml(listing.seller?.name) || 'Неизвестный'} (ур. ${listing.seller?.level || 1})</span>
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
        },
        '<div class="empty-message">На рынке пока нет объявлений</div>'
    );

    container.querySelectorAll('.buy-btn').forEach(btn => {
        btn.addEventListener('click', () => openBuyModal(parseInt(btn.dataset.listingId)));
    });
}

/**
 * Открытие модального окна покупки
 */
async function openBuyModal(listingId) {
    try {
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

        if (!modal || !infoDiv || !summaryDiv) return;

        infoDiv.innerHTML = `
            <div class="buy-item-display">
                <span class="item-icon">${item.icon || '📦'}</span>
                <span class="item-name">${item.name}</span>
                <span class="item-quantity">x${listing.quantity}</span>
            </div>
            <div class="seller-info">Продавец: ${escapeHtml(listing.seller?.name)} (ур. ${listing.seller?.level})</div>
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

        const modal = document.getElementById('market-buy-modal');
        if (modal) modal.classList.remove('active');

        if (result.success) {
            showModal('✅ Успех', result.message);
            playSound('loot');
            await loadProfile();
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
        
        const infoDiv = document.getElementById('market-my-info');
        if (infoDiv) {
            infoDiv.innerHTML = `
                <div class="market-limits">
                    <span>Лимит: ${data.limit}</span>
                    <span>Активных: ${data.active_count}</span>
                    <span>Свободно: ${data.remaining_slots}</span>
                </div>
            `;
        }

        renderMyListings(data.listings);
    } catch (error) {
        console.error('Ошибка загрузки своих объявлений:', error);
    }
}

/**
 * Отображение своих объявлений
 */
function renderMyListings(listings) {
    const container = getEl('market-my-list');
    if (!container) return;

    renderList(
        container,
        listings,
        (listing) => {
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
        },
        '<div class="empty-message">У вас пока нет объявлений</div>'
    );

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
        
        const statsDiv = document.getElementById('market-history-stats');
        if (statsDiv) {
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
        }

        renderMarketHistory(data.all);
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
    }
}

/**
 * Отображение истории сделок
 */
function renderMarketHistory(history) {
    const container = getEl('market-history-list');
    if (!container) return;

    renderList(
        container,
        history,
        (item) => {
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
        },
        '<div class="empty-message">История пуста</div>'
    );
}

/**
 * Загрузка формы создания объявления
 */
async function loadMarketCreateForm() {
    try {
        const data = await apiRequest('/api/game/inventory');
        const items = data.items;
        
        const grid = document.getElementById('market-inventory-grid');
        if (!grid) return;
        
        if (!items || Object.keys(items).length === 0) {
            grid.innerHTML = '<div class="empty-message">Инвентарь пуст</div>';
            return;
        }

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

                grid.querySelectorAll('.market-inventory-slot').forEach(s => s.classList.remove('selected'));
                slot.classList.add('selected');

                const display = document.getElementById('market-selected-item');
                if (display) {
                    display.innerHTML = `
                        <span class="selected-icon">${itemInfo.icon || '📦'}</span>
                        <span class="selected-name">${itemInfo.name}</span>
                        <span class="selected-qty">x${quantity} в наличии</span>
                    `;
                }

                const qtyInput = document.getElementById('market-quantity');
                if (qtyInput) {
                    qtyInput.max = quantity;
                    qtyInput.value = Math.min(quantity, 1);
                }

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

    const MAX_PRICE = 1000000000;
    const MAX_QUANTITY = 1000;
    
    const quantity = parseInt(document.getElementById('market-quantity')?.value || 1);
    const price = parseInt(document.getElementById('market-price')?.value || 0);
    const starsPrice = parseInt(document.getElementById('market-stars-price')?.value || 0);
    const duration = document.getElementById('market-duration')?.value || '24h';

    if (isNaN(quantity) || quantity < 1 || quantity > Math.min(MAX_QUANTITY, marketSelectedItem?.quantity || 0)) {
        showModal('Ошибка', `Количество должно быть от 1 до ${Math.min(MAX_QUANTITY, marketSelectedItem?.quantity || 0)}`);
        return;
    }

    if (isNaN(price) || price < 1 || price > MAX_PRICE) {
        showModal('Ошибка', `Цена должна быть от 1 до ${MAX_PRICE.toLocaleString()}`);
        return;
    }

    if (!isNaN(starsPrice) && starsPrice < 0 || starsPrice > 10000) {
        showModal('Ошибка', 'Цена в звёздах должна быть от 0 до 10000');
        return;
    }

    if (!lockAction('marketCreate')) return;
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
            
            marketSelectedItem = null;
            const marketSelectedItemEl = document.getElementById('market-selected-item');
            if (marketSelectedItemEl) {
                marketSelectedItemEl.innerHTML = '<span class="placeholder">Выберите предмет</span>';
            }
            const marketQuantityEl = document.getElementById('market-quantity');
            if (marketQuantityEl) marketQuantityEl.value = 1;
            const marketPriceEl = document.getElementById('market-price');
            if (marketPriceEl) marketPriceEl.value = '';
            const marketStarsPriceEl = document.getElementById('market-stars-price');
            if (marketStarsPriceEl) marketStarsPriceEl.value = 0;
            
            showScreen('market');
            loadMarketListings();
            loadProfile();
        } else {
            showModal('❌ Ошибка', result.message);
        }
    } catch (error) {
        console.error('Ошибка создания объявления:', error);
        showModal('Ошибка', 'Не удалось создать объявление');
    } finally {
        unlockAction('marketCreate');
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
        
        const indicator = document.getElementById('pvp-zone-indicator');
        const list = document.getElementById('pvp-players-list');
        if (!indicator || !list) return;
        
        if (result.available === false) {
            indicator.innerHTML = `<div class="pvp-zone-safe">🛡️ ${result.message || 'PvP недоступно'}</div>`;
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
                    <div class="pvp-player-name">${escapeHtml(player.username) || 'Игрок'}</div>
                    <div class="pvp-player-stats">
                        <span>Уровень: ${player.level}</span>
                        <span>HP: ${player.health}/${player.max_health}</span>
                    </div>
                    <div class="pvp-player-pvp">
                        <span>Побед: ${player.pvpWins || 0}</span>
                        <span>Рейтинг: ${player.pvpRating || 1000}</span>
                        <span>Серия: ${player.pvpStreak || 0}</span>
                    </div>
                </div>
                <button class="pvp-attack-player-btn" onclick="startPVPFight(${player.id}, '${escapeHtml(player.username) || 'Игрок'}', ${player.level}, ${player.health}, ${player.max_health})">
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
            body: { target_id: targetId }
        });
        
        if (result.success) {
            gameState.pvpMatch = {
                battleId: result.battle_id,
                targetId: targetId,
                targetName: targetName,
                targetLevel: targetLevel
            };
            
            const defenderName = document.getElementById('pvp-defender-name');
            const defenderLevel = document.getElementById('pvp-defender-level');
            const attackerName = document.getElementById('pvp-attender-name');
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
                    <p>⚔️ Бой начат против ${targetName}!</p>
                    <p>Каждый удар тратит 1 энергию</p>
                `;
            }
            
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
    if (!gameState.pvpMatch || !gameState.pvpMatch.battleId) {
        showModal('❌ Ошибка', 'Бой не найден');
        return;
    }
    
    try {
        const result = await apiRequest('/api/game/pvp/attack-hit', {
            method: 'POST',
            body: { battle_id: gameState.pvpMatch.battleId }
        });
        
        if (result.success) {
            playSound('attack');
            
            if (result.battleEnded) {
                handlePVPBattleEnd(result);
            } else {
                if (result.hit) {
                    updatePVPHealth(
                        'attacker',
                        result.hit.yourHealth,
                        gameState.player?.status?.max_health || 100
                    );
                    updatePVPHealth('defender', result.hit.targetHealth, result.hit.maxHealth);
                    
                    const log = document.getElementById('pvp-battle-log');
                    if (log) {
                        log.innerHTML += `<p>${result.message}</p>`;
                        log.scrollTop = log.scrollHeight;
                    }
                }
            }
            
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
    if (log) {
        log.innerHTML += `<p class="battle-result">${result.message}</p>`;
        log.scrollTop = log.scrollHeight;
    }
    
    const attackBtn = document.getElementById('pvp-attack-btn');
    if (attackBtn) attackBtn.style.display = 'none';
    
    const rewardsDiv = document.getElementById('pvp-rewards');
    const rewardsContent = document.getElementById('pvp-rewards-content');
    
    if (result.winner && result.winner.id === gameState.player?.id) {
        if (rewardsContent) {
            rewardsContent.innerHTML = `
                <div class="reward-item">💰 +${result.rewards?.coinsStolen || 0} монет</div>
                <div class="reward-item">📦 +${result.rewards?.itemsStolen || 0} предметов</div>
                <div class="reward-item">⭐ +${result.rewards?.experienceGained || 0} опыта</div>
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
    
    loadProfile();
}

/**
 * Забрать награды PvP
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
        
        if (result.success && result.stats) {
            const stats = result.stats;
            
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
            if (result.cooldown && result.cooldown.active && cooldownDiv) {
                cooldownDiv.style.display = 'flex';
                const expiresAt = new Date(result.cooldown.expiresAt);
                const timerEl = document.getElementById('pvp-cooldown-timer');
                
                const updateTimer = () => {
                    const now = new Date();
                    const diff = expiresAt - now;
                    if (diff <= 0) {
                        cooldownDiv.style.display = 'none';
                        if (window.pvpCooldownTimerId) {
                            clearInterval(window.pvpCooldownTimerId);
                            window.pvpCooldownTimerId = null;
                        }
                        return;
                    }
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    if (timerEl) timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                };
                
                updateTimer();
                if (window.pvpCooldownTimerId) clearInterval(window.pvpCooldownTimerId);
                window.pvpCooldownTimerId = setInterval(updateTimer, 1000);
            } else if (cooldownDiv) {
                cooldownDiv.style.display = 'none';
                if (window.pvpCooldownTimerId) {
                    clearInterval(window.pvpCooldownTimerId);
                    window.pvpCooldownTimerId = null;
                }
            }
            
            // Последние бои
            const matchesList = document.getElementById('pvp-recent-matches-list');
            if (matchesList) {
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
            
        }
        
    } catch (error) {
        console.error('Ошибка загрузки PvP статистики:', error);
    }
}

// ============================================================================
// СЕЗОНЫ
// ============================================================================

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
            if (seasonCurrent) {
                seasonCurrent.innerHTML = `
                    <div class="season-inactive">
                        <div class="season-icon">🎖️</div>
                        <h3>Сезон не активен</h3>
                        <p>${result.message || 'Ожидайте начала нового сезона!'}</p>
                    </div>
                `;
            }
            if (seasonJoinSection) seasonJoinSection.style.display = 'none';
            return;
        }
        
        const season = result.season;
        const playerRank = result.player_rank;
        
        if (seasonCurrent) {
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
        }
        
        if (seasonJoinSection) {
            seasonJoinSection.style.display = playerRank ? 'none' : 'block';
        }
        
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
            if (eventsList) eventsList.innerHTML = '<p class="empty-message">Нет активных событий</p>';
            if (modifiersList) modifiersList.innerHTML = '<p class="empty-message">Нет активных бонусов</p>';
            return;
        }
        
        if (eventsList) {
            const eventIcons = {
                'treasure_hunt': '💎',
                'double_exp': '✨',
                'pvp_tournament': '⚔️',
                'craft_marathon': '🔨',
                'radiation_storm': '☢️',
                'boss_invasion': '👹',
                'trade_festival': '🎉'
            };
            
            eventsList.innerHTML = result.events.map(event => {
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
        }
        
        if (modifiersList) {
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
            if (topRating) topRating.innerHTML = '<p class="empty-message">Нет активного сезона</p>';
            if (myRating) myRating.innerHTML = '';
            return;
        }
        
        if (topRating) {
            if (result.rating && result.rating.length > 0) {
                topRating.innerHTML = result.rating.slice(0, 20).map((player, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                    return `
                        <div class="rating-player">
                        <span class="rating-rank">${medal}</span>
                        <span class="rating-name">${escapeHtml(player.username)}</span>
                            <span class="rating-level">ур. ${player.level}</span>
                            <span class="rating-points">${player.points} оч.</span>
                        </div>
                    `;
                }).join('');
            } else {
                topRating.innerHTML = '<p class="empty-message">Пока никто не участвует</p>';
            }
        }
        
        if (myRating && result.player_position) {
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
        } else if (myRating) {
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
            if (tasksList) tasksList.innerHTML = '<p class="empty-message">Нет доступных заданий</p>';
            return;
        }
        
        if (tasksProgress) {
            const progress = result.progress || { completed: 0, total: 0, percentage: 0 };
            tasksProgress.innerHTML = `
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress.percentage}%"></div>
                </div>
                <span class="progress-text">${progress.completed}/${progress.total} выполнено</span>
                ${result.event_bonus ? '<span class="event-badge">⚡ Бонус события!</span>' : ''}
            `;
        }
        
        if (tasksList) {
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
        }
        
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
                if (topRating) topRating.style.display = 'block';
                if (myRating) myRating.style.display = 'none';
            } else {
                if (topRating) topRating.style.display = 'none';
                if (myRating) myRating.style.display = 'block';
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
            body: { task_id: taskId }
        });
        
        if (result.success) {
            showModal('✅ Награда получена!', 
                `${result.reward.coins ? `💰 ${result.reward.coins} ` : ''}` +
                `${result.reward.exp ? `✨ ${result.reward.exp} опыта` : ''}`);
            loadDailyTasks();
            loadCurrentSeason();
        } else {
            showModal('❌ Ошибка', result.error);
        }
    } catch (error) {
        console.error('Ошибка получения награды:', error);
        showModal('❌ Ошибка', 'Не удалось получить награду');
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
        const result = await apiRequest('/api/game/referral/code');
        
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
        const result = await apiRequest('/api/game/referral/stats');
        
        if (result.success) {
            setElementText('total-referrals', result.stats.total_referrals);
            setElementText('total-coins-earned', result.stats.total_coins_earned);
            setElementText('total-stars-earned', result.stats.total_stars_earned);
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
    if (!lockAction('referral')) return;
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
    
    try {
        const result = await apiRequest('/api/game/referral/code', {
            method: 'PUT',
            body: { new_code: newCode }
        });
        
        if (result.success) {
            const codeEl = document.getElementById('referral-code');
            const changeSection = document.getElementById('referral-change-section');
            if (codeEl) codeEl.textContent = result.code;
            if (changeSection) changeSection.style.display = 'none';
            if (newCodeInput) newCodeInput.value = '';
            showModal('✅ Успех', 'Реферальный код изменён!');
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
    if (!lockAction('referral')) return;
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
    
    try {
        const result = await apiRequest('/api/game/referral/use', {
            method: 'POST',
            body: { code: code }
        });
        
        if (result.success) {
            showModal(
                '🎁 Бонус получен!',
                `Ты получил: +${result.bonus.coins} монет, +${result.bonus.energy} Energy!`
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
    // Навигация
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showScreen(btn.dataset.screen);
        });
    });
    
    // Кнопки назад
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showScreen(btn.dataset.screen);
        });
    });
    
    // Основные кнопки
    document.getElementById('search-btn')?.addEventListener('click', searchLoot);
    document.getElementById('map-btn')?.addEventListener('click', () => showScreen('map'));
    document.getElementById('inventory-btn')?.addEventListener('click', () => showScreen('inventory'));
    document.getElementById('bosses-btn')?.addEventListener('click', () => showScreen('bosses'));
    document.getElementById('shop-btn')?.addEventListener('click', () => showScreen('shop'));
    document.getElementById('rating-btn')?.addEventListener('click', () => showScreen('rating'));
    document.getElementById('pvp-btn')?.addEventListener('click', () => showScreen('pvp-players'));
    
    // Лечение инфекций
    document.getElementById('heal-infections-btn')?.addEventListener('click', healInfections);
    
    // Сезоны
    document.getElementById('season-join-btn')?.addEventListener('click', joinSeason);
    
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
    
    // Рынок
    document.getElementById('market-create-btn')?.addEventListener('click', () => showScreen('market-create'));
    document.getElementById('market-submit-btn')?.addEventListener('click', createMarketListing);
    document.getElementById('market-buy-confirm')?.addEventListener('click', confirmBuyFromMarket);
    document.getElementById('market-buy-cancel')?.addEventListener('click', () => {
        document.getElementById('market-buy-modal')?.classList.remove('active');
    });
    document.getElementById('market-quantity')?.addEventListener('input', updateMarketSummary);
    document.getElementById('market-price')?.addEventListener('input', updateMarketSummary);
    
    // Поиск на рынке с debounce
    let marketSearchTimeout;
    document.getElementById('market-search')?.addEventListener('input', (e) => {
        clearTimeout(marketSearchTimeout);
        marketSearchTimeout = setTimeout(() => loadMarketListings(), 500);
    });
    document.getElementById('market-type-filter')?.addEventListener('change', loadMarketListings);
    document.getElementById('market-sort-filter')?.addEventListener('change', loadMarketListings);
    
    // Табы
    document.querySelectorAll('.rating-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.rating-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadRating(tab.dataset.tab);
        });
    });
    
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
    
    // Инициализация
    initGame();
    initReferralHandlers();
    
    // Инициализация навигации из game-screens.js
    if (typeof initNavigationHandlers === 'function') {
        initNavigationHandlers();
    }
    
    // Обработчик меню "Ещё"
    const moreMenuBtn = document.getElementById('more-menu-btn');
    const moreMenu = document.getElementById('more-menu');
    if (moreMenuBtn && moreMenu) {
        moreMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            moreMenu.style.display = moreMenu.style.display === 'none' ? 'block' : 'none';
        });
        
        // Закрыть меню при клике вне его
        document.addEventListener('click', (e) => {
            if (!moreMenuBtn.contains(e.target) && !moreMenu.contains(e.target)) {
                moreMenu.style.display = 'none';
            }
        });
        
        // Обработчики для пунктов меню
        moreMenu.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                const screen = item.dataset.screen;
                if (screen && typeof showScreen === 'function') {
                    showScreen(screen);
                }
                moreMenu.style.display = 'none';
            });
        });
    }
});

// ============================================================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================================================

window.currentInventoryFilter = currentInventoryFilter;
window.currentInventorySort = currentInventorySort;
window.inventoryControlsInitialized = inventoryControlsInitialized;
window.initInventoryControls = initInventoryControls;
window.currentAchievementCategory = currentAchievementCategory;
window.marketSelectedItem = marketSelectedItem;
window.currentBuyListingId = currentBuyListingId;
window.loadAchievements = loadAchievements;
window.renderAchievementsStats = renderAchievementsStats;
window.renderAchievementsCategories = renderAchievementsCategories;
window.filterAchievements = filterAchievements;
window.renderAchievementsList = renderAchievementsList;
window.claimAchievement = claimAchievement;
window.loadMarketListings = loadMarketListings;
window.renderMarketListings = renderMarketListings;
window.openBuyModal = openBuyModal;
window.confirmBuyFromMarket = confirmBuyFromMarket;
window.loadMyListings = loadMyListings;
window.renderMyListings = renderMyListings;
window.renewListing = renewListing;
window.cancelListing = cancelListing;
window.loadMarketHistory = loadMarketHistory;
window.renderMarketHistory = renderMarketHistory;
window.loadMarketCreateForm = loadMarketCreateForm;
window.updateMarketSummary = updateMarketSummary;
window.createMarketListing = createMarketListing;
window.loadPVPGamePlayers = loadPVPGamePlayers;
window.startPVPFight = startPVPFight;
window.attackPVPTarget = attackPVPTarget;
window.updatePVPHealth = updatePVPHealth;
window.handlePVPBattleEnd = handlePVPBattleEnd;
window.claimPVPRewards = claimPVPRewards;
window.loadPVPStats = loadPVPStats;
window.loadSeasonsScreen = loadSeasonsScreen;
window.loadCurrentSeason = loadCurrentSeason;
window.loadSeasonEvents = loadSeasonEvents;
window.loadSeasonRating = loadSeasonRating;
window.loadDailyTasks = loadDailyTasks;
window.setupSeasonRatingTabs = setupSeasonRatingTabs;
window.joinSeason = joinSeason;
window.claimDailyTask = claimDailyTask;
window.loadReferralCode = loadReferralCode;
window.loadReferralStats = loadReferralStats;
window.loadReferralsList = loadReferralsList;
window.loadReferralScreen = loadReferralScreen;
window.copyReferralCode = copyReferralCode;
window.changeReferralCode = changeReferralCode;
window.useReferralCode = useReferralCode;
window.initReferralHandlers = initReferralHandlers;
