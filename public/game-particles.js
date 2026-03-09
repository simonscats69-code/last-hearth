/**
 * ============================================
 * СИСТЕМА ЧАСТИЦ (Particle System)
 * ============================================
 * Отвечает за визуальные эффекты:
 * - Конфetti при победах
 * - Искры при ударах
 * - Другие визуальные эффекты
 */

/**
 * Класс ParticleSystem - управление визуальными эффектами
 */
class ParticleSystem {
    constructor() {
        this.particles = [];
        this.canvas = null;
        this.ctx = null;
        this.animationId = null;
    }

    /**
     * Инициализация canvas для частиц
     */
    init() {
        if (this.canvas) return;
        
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'particle-canvas';
        this.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(this.canvas);
        
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        
        window.addEventListener('resize', () => this.resize());
    }

    /**
     * Изменение размера canvas при ресайзе окна
     */
    resize() {
        if (this.canvas) {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
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
