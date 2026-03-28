/**
 * ============================================
 * АНИМАЦИИ (Animations)
 * ============================================
 * Управление CSS анимациями и визуальными эффектами
 */

/**
 * Применение анимации к элементу
 * @param {HTMLElement} element - DOM элемент
 * @param {string} animationName - название анимации
 * @param {number} duration - длительность в мс
 * @param {Function} onComplete - колбэк по завершении
 */
function animateElement(element, animationName, duration = 1000, onComplete = null) {
    if (!element) return;
    
    element.style.animation = `${animationName} ${duration}ms ease-out`;
    
    if (onComplete) {
        element.addEventListener('animationend', onComplete, { once: true });
    }
}

/**
 * Визуальный эффект вспышки (урон/лечение)
 * @param {string} type - тип эффекта ('damage' или 'heal')
 */
function showFlashEffect(type = 'damage') {
    const app = document.getElementById('app');
    if (!app) return;
    
    const animation = type === 'heal' ? 'healFlash' : 'damageFlash';
    app.style.animation = `${animation} 0.3s`;
    setTimeout(() => {
        app.style.animation = '';
    }, 300);
}

// Алиасы для обратной совместимости
function showHealEffect() { showFlashEffect('heal'); }

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
    
    // Устанавливаем класс типа
    modal.className = 'modal';
    if (type === 'success') modal.classList.add('modal-success');
    else if (type === 'error') modal.classList.add('modal-error');
    else modal.classList.add('modal-info');
    
    // Показываем модальное окно с анимацией
    modal.style.display = 'flex';
    modal.style.animation = 'fadeIn 0.3s ease-out';
    
    // Обработчик закрытия (сначала удаляем старый)
    modalClose.onclick = null;
    modalClose.onclick = () => hideModal();
    
    // Закрытие по клику вне окна (сначала удаляем старый)
    modal.onclick = null;
    modal.onclick = (e) => {
        if (e.target === modal) hideModal();
    };
}

/**
 * Скрыть модальное окно
 */
function hideModal() {
    const modal = document.getElementById('modal');
    const modalClose = document.getElementById('modal-close');
    
    // Очищаем обработчики при закрытии
    if (modalClose) modalClose.onclick = null;
    if (modal) {
        modal.onclick = null;
        modal.style.animation = 'fadeOut 0.2s ease-out';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    }
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
        container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        padding: 12px 20px;
        border-radius: 8px;
        background: ${type === 'success' ? '#4a9' : type === 'error' ? '#a44' : '#48a'};
        color: white;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    
    container.appendChild(notification);
    
    // Удаляем после duration
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease-out';
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
    lootEl.innerHTML = `
        <div class="loot-icon">${item.icon || '📦'}</div>
        <div class="loot-name">${item.name || 'Предмет'}</div>
    `;

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
    const app = document.getElementById('app');
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
 */
function updateBalanceDisplay(newCoins) {
    if (newCoins && typeof newCoins === 'object') {
        const coins = Number(newCoins.coins ?? 0);
        const stars = Number(newCoins.stars ?? 0);

        updateBalanceDisplay(coins);

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

    const balanceElements = document.querySelectorAll('.balance-value, #user-balance, .coins-display');
    balanceElements.forEach(el => {
        if (el) el.textContent = formatNumber(newCoins);
    });
    if (gameState?.player) gameState.player.coins = newCoins;
}

/**
 * Анимация кнопки при клике
 * @param {HTMLElement} button - кнопка
 */
function animateButtonClick(button) {
    if (!button) return;
    
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
        button.style.transform = '';
    }, 100);
}

/**
 * Добавить эффект загрузки на кнопку
 * @param {HTMLElement} button - кнопка
 */
function setButtonLoading(button) {
    if (!button) return;
    
    button.classList.add('loading');
    button.dataset.originalText = button.textContent;
    button.textContent = '⏳ Загрузка...';
    button.disabled = true;
}

/**
 * Убрать эффект загрузки с кнопки
 * @param {HTMLElement} button - кнопка
 */
function clearButtonLoading(button) {
    if (!button) return;
    
    button.classList.remove('loading');
    button.textContent = button.dataset.originalText || 'Готово';
    button.disabled = false;
}

/**
 * Плавное появление элемента
 * @param {HTMLElement} element - элемент
 * @param {number} delay - задержка в мс
 */
function fadeInElement(element, delay = 0) {
    if (!element) return;
    
    element.style.opacity = '0';
    element.style.transition = 'opacity 0.5s ease-out';
    
    setTimeout(() => {
        element.style.opacity = '1';
    }, delay);
}

/**
 * Плавное исчезновение элемента
 * @param {HTMLElement} element - элемент
 * @param {Function} onComplete - колбэк
 */
function fadeOutElement(element, onComplete = null) {
    if (!element) return;
    
    element.style.transition = 'opacity 0.3s ease-out';
    element.style.opacity = '0';
    
    setTimeout(() => {
        if (onComplete) onComplete();
    }, 300);
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
 * Анимация прогресс-бара мастерства
 * @param {HTMLElement} container - контейнер для бара
 * @param {number} percent - процент заполнения
 */
function animateMasteryBar(container, percent) {
    if (!container) return;
    
    const fill = container.querySelector('.mastery-progress-fill');
    if (fill) {
        fill.style.transition = 'width 0.5s ease-out';
        fill.style.width = `${percent}%`;
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
window.showBossDeathParticles = showBossDeathParticles;
window.animateMasteryBar = animateMasteryBar;
window.showVictoryFlash = showVictoryFlash;
window.showKeyAnimation = showKeyAnimation;
window.showRewardCelebration = showRewardCelebration;
window.showBossVictorySummary = showBossVictorySummary;
window.showKeyRewardCelebration = showKeyRewardCelebration;
window.showLocationUnlockCelebration = showLocationUnlockCelebration;
window.showLootAnimation = showLootAnimation;
window.showDamageEffect = showDamageEffect;
window.playSound = playSound;
window.updateBalanceDisplay = updateBalanceDisplay;
