/**
 * ============================================
 * АНИМАЦИИ (Animations)
 * ============================================
 * Управление CSS анимациями и визуальными эффектами
 */

// Список доступных анимаций
const ANIMATIONS = {
    FADE_IN: 'fadeIn',
    SLIDE_UP: 'slideUp',
    SLIDE_DOWN: 'slideDown',
    PULSE: 'pulse',
    BOUNCE: 'bounce',
    GLOW: 'glow',
    SHAKE: 'shake',
    DAMAGE_FLASH: 'damageFlash',
    HEAL_FLASH: 'healFlash',
    SPIN: 'spin'
};

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
        setTimeout(onComplete, duration);
    }
}

/**
 * Визуальный эффект при получении лута
 * @param {Object} item - данные предмета
 */
function showLootAnimation(item) {
    const app = document.getElementById('app');
    
    // Создаём элемент анимации
    const lootEl = document.createElement('div');
    lootEl.className = 'loot-animation';
    lootEl.innerHTML = `
        <div class="loot-icon">${item.icon || '📦'}</div>
        <div class="loot-name">${item.name || 'Предмет'}</div>
    `;
    
    app.appendChild(lootEl);
    
    // Анимация
    lootEl.style.animation = 'slideUp 1s ease-out forwards';
    
    // Удаляем после анимации
    setTimeout(() => {
        lootEl.remove();
    }, 1000);
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
    
    if (!modal) return;
    
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
    
    // Обработчик закрытия
    modalClose.onclick = () => hideModal();
    
    // Закрытие по клику вне окна
    modal.onclick = (e) => {
        if (e.target === modal) hideModal();
    };
}

/**
 * Скрыть модальное окно
 */
function hideModal() {
    const modal = document.getElementById('modal');
    if (modal) {
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
    const container = document.getElementById('notification-container');
    if (!container) {
        // Создаём контейнер если нет
        const newContainer = document.createElement('div');
        newContainer.id = 'notification-container';
        newContainer.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;';
        document.body.appendChild(newContainer);
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
    
    document.getElementById('notification-container').appendChild(notification);
    
    // Удаляем после duration
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, duration);
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
 * @param {string} originalText - оригинальный текст
 */
function setButtonLoading(button, originalText) {
    if (!button) return;
    
    button.classList.add('loading');
    button.dataset.originalText = originalText || button.textContent;
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
