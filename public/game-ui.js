/**
 * game-ui.js - Интерфейс и обработчики событий
 * Обработчики DOM, фильтры, модальные окна, PvP, достижения, рефералы
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
        const data = await apiRequest('/api/achievements/progress');
        
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
    
    // Фильтруем уже загруженные данные вместо перезагрузки
    const data = await apiRequest('/api/achievements/progress');
    
    if (data && data.progress) {
        renderAchievementsStats(data.stats);
        renderAchievementsCategories(data.categories);
        
        if (currentAchievementCategory) {
            renderAchievementsList(data.progress.filter(a => a.category === currentAchievementCategory));
        } else {
            renderAchievementsList(data.progress);
        }
    }
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
                    <div class="name">${escapeHtml(ach.name || '')}</div>
                    <div class="description">${escapeHtml(ach.description || '')}</div>
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
                        <span>Побед: ${player.pvp_wins || 0}</span>
                        <span>Рейтинг: ${player.pvp_rating || 1000}</span>
                        <span>Серия: ${player.pvp_streak || 0}</span>
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
                <div class="reward-item">💰 +${result.rewards?.coins || 0} монет</div>
                <div class="reward-item">📦 ${result.rewards?.item ? 'Получен предмет' : 'Без предмета'}</div>
                <div class="reward-item">⭐ +50 опыта</div>
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
        const result = await apiRequest('/api/game/player/referral/list');
        
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
        const result = await apiRequest('/api/game/player/referral/code', {
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
        const result = await apiRequest('/api/game/player/referral/use', {
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
    // Нижняя навигация
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const screen = btn.dataset.screen;
            if (screen && typeof showScreen === 'function') {
                showScreen(screen);
            }
        });
    });

    // Основные кнопки
    document.getElementById('search-btn')?.addEventListener('click', () => searchLoot());
    document.getElementById('map-btn')?.addEventListener('click', () => showScreen('map'));
    document.getElementById('inventory-btn')?.addEventListener('click', () => showScreen('inventory'));
    document.getElementById('bosses-btn')?.addEventListener('click', () => showScreen('bosses'));
    document.getElementById('shop-btn')?.addEventListener('click', () => showScreen('shop'));
    document.getElementById('rating-btn')?.addEventListener('click', () => showScreen('rating'));
    document.getElementById('pvp-btn')?.addEventListener('click', () => showScreen('pvp-players'));
    
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
    
    // Инициализация - ждём загрузки всех модулей
    function startGame() {
        // Проверяем, что экранный слой загружен
        if (typeof showScreen !== 'function') {
            console.warn('Экранный слой не загружен, ожидаем...');
            setTimeout(startGame, 100);
            return;
        }
        
        initGame();
        initReferralHandlers();
        
        // Инициализация навигации из game-core.js
        if (typeof initNavigationHandlers === 'function') {
            initNavigationHandlers();
        }
    }
    
    // Запускаем игру после полной загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startGame);
    } else {
        startGame();
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
window.loadAchievements = loadAchievements;
window.renderAchievementsStats = renderAchievementsStats;
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
