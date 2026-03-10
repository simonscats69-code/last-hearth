/**
 * ============================================
 * КАРТА ГОРОДА (City Map)
 * ============================================
 * Canvas-отрисовка интерактивной карты города
 * с локациями и визуальными эффектами
 */

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
            const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
            
            if (dist < pos.radius) {
                if (loc.unlocked) {
                    moveToLocation(loc.id);
                } else {
                    showModal('🔒 Заблокировано', `Нужно ${loc.min_luck} удачи для входа`);
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
                info.innerHTML = `☢️ Радиация: ${hoveredLoc.radiation} | ${hoveredLoc.unlocked ? '✅ Доступно' : '🔒 Требуется ' + hoveredLoc.min_luck + ' удачи'}`;
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
 *} pos - пози @param {Objectция на карте
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
