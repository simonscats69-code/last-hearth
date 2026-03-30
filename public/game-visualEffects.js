/**
 * ============================================
 * ВИЗУАЛЬНЫЕ ЭФФЕКТЫ (Visual Effects)
 * ============================================
 * Объединяет:
 * - Система частиц (Particle System) - Canvas анимации
 * - Карта города (City Map) - Canvas отрисовка
 * 
 * Подключение: после game-core.js
 */



/**
 * Класс ParticleSystem - управление визуальными эффектами
 * Улучшенная версия с защитой от утечек памяти
 */
class ParticleSystem {
    constructor() {
        this.particles = [];
        this.canvas = null;
        this.ctx = null;
        this.animationId = null;
        this._resizeHandler = null;
        this._isDestroyed = false;
    }

    /**
     * Инициализация canvas для частиц
     */
    init() {
        if (this._isDestroyed) {
            console.warn('[ParticleSystem] Система уже уничтожена');
            return;
        }
        if (this.canvas) return;
        
        try {
            this.canvas = document.createElement('canvas');
            this.canvas.id = 'particle-canvas';
            this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
            document.body.appendChild(this.canvas);
            
            this.ctx = this.canvas.getContext('2d');
            this.resize();
            
            // Удаляем старый обработчик если есть
            if (this._resizeHandler) {
                window.removeEventListener('resize', this._resizeHandler);
            }
            // Сохраняем ссылку на обработчик
            this._resizeHandler = () => this.resize();
            window.addEventListener('resize', this._resizeHandler);
        } catch (e) {
            console.error('[ParticleSystem] Ошибка инициализации:', e);
        }
    }

    /**
     * Очистка всех ресурсов (предотвращение утечек памяти)
     */
    destroy() {
        this._isDestroyed = true;
        
        // Останавливаем анимацию
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Удаляем обработчик resize
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        
        // Очищаем canvas
        if (this.canvas) {
            try {
                this.ctx = null;
                this.canvas.remove();
                this.canvas = null;
            } catch (e) {
                console.warn('[ParticleSystem] Ошибка удаления canvas:', e);
            }
        }
        
        // Очищаем массив частиц
        this.particles = [];
    }

    /**
     * Изменение размера canvas при ресайзе окна
     */
    resize() {
        if (this._isDestroyed || !this.canvas) return;
        
        try {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        } catch (e) {
            console.warn('[ParticleSystem] Ошибка изменения размера:', e);
        }
    }

    /**
     * Создание эффекта конфetti
     * @param {number} count - количество частиц
     * @param {string[]} colors - цвета конфetti
     */
    confetti(count = 100, colors = ['#ff0', '#f0f', '#0ff', '#0f0', '#fa0']) {
        this.init();
        
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
                vx: (Math.random() - 0.5) * 20,
                vy: (Math.random() - 1) * 15 - 5,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: Math.random() * 8 + 4,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 10,
                life: 1,
                decay: 0.01 + Math.random() * 0.02,
                type: 'confetti'
            });
        }
        
        this.animate();
    }

    /**
     * Создание эффекта искр
     * @param {number} x - координата X
     * @param {number} y - координата Y
     * @param {number} count - количество искр
     */
    sparks(x, y, count = 20) {
        this.init();
        
        const colors = ['#ff0', '#fa0', '#f00', '#fff'];
        
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const speed = 3 + Math.random() * 5;
            
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: Math.random() * 4 + 2,
                life: 1,
                decay: 0.03 + Math.random() * 0.02,
                type: 'spark'
            });
        }
        
        if (!this.animationId) {
            this.animate();
        }
    }

    /**
     * Основной цикл анимации частиц
     */
    animate() {
        if (!this.ctx) return;
        
        // Очистка canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Обновление и отрисовка каждой частицы
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            
            // Обновление позиции
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.3; // Гравитация
            
            if (p.type === 'confetti') {
                p.rotation += p.rotationSpeed;
                p.vx *= 0.99;
            }
            
            // Затухание
            p.life -= p.decay;
            
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            
            // Отрисовка
            this.ctx.globalAlpha = p.life;
            this.ctx.fillStyle = p.color;
            
            if (p.type === 'confetti') {
                this.ctx.save();
                this.ctx.translate(p.x, p.y);
                this.ctx.rotate(p.rotation * Math.PI / 180);
                this.ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                this.ctx.restore();
            } else {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
        
        this.ctx.globalAlpha = 1;
        
        if (this.particles.length > 0) {
            this.animationId = requestAnimationFrame(() => this.animate());
        } else {
            this.animationId = null;
        }
    }
}

// Глобальный экземпляр
const particles = new ParticleSystem();

/**
 * Запуск эффекта конфetti (для побед и особых событий)
 * @param {number} count - количество частиц
 */
function showConfetti(count = 150) {
    particles.confetti(count);
}

/**
 * Запуск эффекта искр (для ударов и действий)
 * @param {number} x - координата X
 * @param {number} y - координата Y
 * @param {number} count - количество искр
 */
function showSparks(x, y, count = 15) {
    particles.sparks(x, y, count);
}




/**
 * Отрисовка локаций на Canvas карте
 */
function renderLocations() {
    const canvas = document.getElementById('city-map');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Очищаем canvas
    ctx.clearRect(0, 0, width, height);
    
    // Рисуем фон карты (постапокалиптический город)
    drawCityBackground(ctx, width, height);
    
    // Определяем позиции локаций на карте
    const locations = gameState.locations || [];
    const positions = calculateLocationPositions(locations.length, width, height);
    
    // Сохраняем позиции для кликов
    gameState.locationPositions = {};
    
    // Рисуем дороги между локациями
    drawRoads(ctx, positions);
    
    // Рисуем локации
    locations.forEach((loc, index) => {
        const pos = positions[index];
        gameState.locationPositions[loc.id] = { x: pos.x, y: pos.y, radius: 30 };
        drawLocation(ctx, loc, pos);
    });
    
    // Обработчик клика по карте
    canvas.onclick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        // Проверяем клик по локациям
        for (const loc of locations) {
            const pos = gameState.locationPositions[loc.id];
            if (!pos || pos.radius === undefined) continue;
            
            const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
            
            if (dist < pos.radius) {
                if (loc.unlocked) {
                    moveToLocation(loc.id);
                } else {
                    showModal('🔒 Заблокировано', `Нужен уровень ${loc.min_level} для входа`);
                }
                return;
            }
        }
    };
    
    // Обработчик движения мыши (подсветка)
    canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        let hoveredLoc = null;
        for (const loc of locations) {
            const pos = gameState.locationPositions[loc.id];
            if (!pos || pos.radius === undefined) continue;
            
            const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
            if (dist < pos.radius) {
                hoveredLoc = loc;
                break;
            }
        }
        
        // Обновляем информацию о локации
        const infoEl = document.querySelector('.map-location-name');
        if (infoEl && hoveredLoc) {
            infoEl.textContent = `${hoveredLoc.icon} ${hoveredLoc.name}`;
            const infoContainer = document.querySelector('.map-info');
            if (infoContainer && !infoContainer.querySelector('.map-location-info')) {
                const info = document.createElement('div');
                info.className = 'map-location-info';
                const fakePlayer = {
                    location: hoveredLoc,
                    equipment: gameState.player?.equipment || {}
                };
                const risk = typeof getCurrentZoneRiskProfile === 'function'
                    ? getCurrentZoneRiskProfile(fakePlayer)
                    : { label: 'Неизвестно' };
                info.textContent = `☢️ Радиация: ${hoveredLoc.radiation} | 🦠 Инфекция: ${hoveredLoc.infection || 0} | ${hoveredLoc.unlocked ? '✅' : '🔒'} ${risk.label}`;
                infoContainer.appendChild(info);
            }
        }
        
        // Перерисовываем с подсветкой
        redrawMap(hoveredLoc);
    };
    
    canvas.onmouseleave = () => {
        const infoContainer = document.querySelector('.map-info');
        const info = infoContainer?.querySelector('.map-location-info');
        if (info) info.remove();
        const infoEl = document.querySelector('.map-location-name');
        if (infoEl) infoEl.textContent = 'Выберите локацию';
        redrawMap(null);
    };
}

/**
 * Перерисовка карты с подсветкой
 * @param {Object} hoveredLoc - локация под курсором
 */
function redrawMap(hoveredLoc) {
    const canvas = document.getElementById('city-map');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    drawCityBackground(ctx, width, height);
    
    const locations = gameState.locations || [];
    const positions = calculateLocationPositions(locations.length, width, height);
    drawRoads(ctx, positions);
    
    locations.forEach((loc, index) => {
        const pos = positions[index];
        const isHovered = hoveredLoc && hoveredLoc.id === loc.id;
        drawLocation(ctx, loc, pos, isHovered);
    });
}

/**
 * Расчёт позиций локаций на карте
 * @param {number} count - количество локаций
 * @param {number} width - ширина canvas
 * @param {number} height - высота canvas
 * @returns {Array} массив позиций
 */
function calculateLocationPositions(count, width, height) {
    const positions = [];
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Располагаем локации от центра к краям по кругу
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const radius = 40 + (i * 35);
        positions.push({
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius
        });
    }
    
    return positions;
}

/**
 * Рисуем фон карты (постапокалиптический город)
 * @param {CanvasRenderingContext2D} ctx - контекст canvas
 * @param {number} width - ширина
 * @param {number} height - высота
 */
function drawCityBackground(ctx, width, height) {
    // Градиент неба
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, '#1a1a2e');
    skyGrad.addColorStop(0.5, '#16213e');
    skyGrad.addColorStop(1, '#0f0f23');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);
    
    // Звёзды
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let i = 0; i < 50; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height * 0.4;
        const size = Math.random() * 1.5;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Контуры зданий (силуэты)
    ctx.fillStyle = '#0a0a15';
    for (let i = 0; i < 15; i++) {
        const x = Math.random() * width;
        const w = 20 + Math.random() * 40;
        const h = 50 + Math.random() * 150;
        ctx.fillRect(x, height - h, w, h);
    }
    
    // Земля
    const groundGrad = ctx.createLinearGradient(0, height - 80, 0, height);
    groundGrad.addColorStop(0, '#1a1a1a');
    groundGrad.addColorStop(1, '#0d0d0d');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, height - 80, width, 80);
    
    // Радиационное свечение от центра
    const centerX = width / 2;
    const centerY = height / 2;
    const radGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 200);
    radGrad.addColorStop(0, 'rgba(0, 255, 0, 0.05)');
    radGrad.addColorStop(1, 'rgba(0, 255, 0, 0)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, width, height);
}

/**
 * Рисуем дороги между локациями
 * @param {CanvasRenderingContext2D} ctx - контекст canvas
 * @param {Array} positions - позиции локаций
 */
function drawRoads(ctx, positions) {
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 10]);
    
    for (let i = 0; i < positions.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(positions[i].x, positions[i].y);
        ctx.lineTo(positions[i + 1].x, positions[i + 1].y);
        ctx.stroke();
    }
    
    // Дорога от низа экрана к первой локации
    if (positions.length > 0) {
        ctx.beginPath();
        ctx.moveTo(ctx.canvas.width / 2, ctx.canvas.height - 30);
        ctx.lineTo(positions[0].x, positions[0].y);
        ctx.stroke();
    }
    
    ctx.setLineDash([]);
}

/**
 * Рисуем локацию на карте
 * @param {CanvasRenderingContext2D} ctx - контекст canvas
 * @param {Object} loc - данные локации
 * @param {Object} pos - позиция на карте
 * @param {boolean} isHovered - подсветка при наведении
 */
function drawLocation(ctx, loc, pos, isHovered = false) {
    const radius = isHovered ? 35 : 30;
    
    // Радиационное свечение
    const radGrad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius + 15);
    const glowColor = loc.unlocked ? 'rgba(74, 144, 217, 0.4)' : 'rgba(100, 100, 100, 0.3)';
    radGrad.addColorStop(0, glowColor);
    radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radGrad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius + 15, 0, Math.PI * 2);
    ctx.fill();
    
    // Основной круг
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    
    if (loc.unlocked) {
        const grad = ctx.createRadialGradient(pos.x - 10, pos.y - 10, 0, pos.x, pos.y, radius);
        grad.addColorStop(0, '#4a90d9');
        grad.addColorStop(1, '#2a5f9e');
        ctx.fillStyle = grad;
    } else {
        ctx.fillStyle = '#444';
    }
    ctx.fill();
    
    // Рамка
    ctx.strokeStyle = loc.unlocked ? '#6ab0ff' : '#666';
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.stroke();
    
    // Иконка
    ctx.font = isHovered ? '24px serif' : '20px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(loc.icon, pos.x, pos.y);
}




// Функции частиц
window.showConfetti = showConfetti;
window.showSparks = showSparks;
window.particles = particles;

// Функции карты
window.renderLocations = renderLocations;
window.redrawMap = redrawMap;
window.calculateLocationPositions = calculateLocationPositions;
window.drawCityBackground = drawCityBackground;
window.drawRoads = drawRoads;
window.drawLocation = drawLocation;
