'use strict';

// Дополнительные кисти для высокодетализированных иконок боссов (256×256).
// Используются только bosses-hi.js — текстуры шерсти, чешуи, металла, подсветка.

const { PALETTE: P, shade } = require('../draw');

/** Шерстяная текстура: короткие штрихи-random в заданной области. */
function fur(c, x, y, w, h, base, random, opts = {}) {
    const { density = 0.02, length = 3 } = opts;
    for (let i = 0; i < w * h * density; i++) {
        const px = x + random() * w;
        const py = y + random() * h;
        const angle = random() * Math.PI * 2;
        const len = 1 + random() * length;
        c.drawLine(px, py, px + Math.cos(angle) * len, py + Math.sin(angle) * len, 1.5, shade(base, -0.15 + random() * 0.3), 0.8);
    }
}

/** Чешуя: перекрывающиеся эллипсы-чешуйки. */
function scales(c, cx, cy, rx, ry, base, random, opts = {}) {
    const { rows = 4, cols = 6, overlap = 0.35 } = opts;
    for (let r = 0; r < rows; r++) {
        const oy = cy - ry + (r / Math.max(1, rows - 1)) * ry * 2;
        for (let cc = 0; cc < cols; cc++) {
            const ox = cx - rx + (cc / Math.max(1, cols - 1)) * rx * 2;
            const dy = (r % 2 === 0) ? rx * 0.35 : 0;
            c.fillEllipse(ox + dy, oy, rx * 0.5, ry * 0.55, shade(base, -0.08 + random() * 0.16));
        }
    }
}

/** Ржавые потёки и сколы на металле. */
function rustStreaks(c, x, y, w, h, base, random) {
    const n = Math.round(w * h * 0.0015);
    for (let i = 0; i < n; i++) {
        const px = x + random() * w;
        const py = y + random() * h;
        const len = 4 + random() * 16;
        const angle = -0.4 + random() * 0.8;
        c.drawLine(px, py, px + Math.cos(angle) * len, py + Math.sin(angle) * len, 2, P.rust, 0.55 + random() * 0.3);
    }
    for (let i = 0; i < Math.round(n * 0.4); i++) {
        c.fillCircle(x + random() * w, y + random() * h, 2 + random() * 3, shade(P.rustDeep, -0.1), 0.8);
    }
}

/** Свечение вокруг объекта (радиальный градиент вручную). */
function glow(c, cx, cy, radius, color, alpha = 0.35) {
    const step = Math.max(2, radius / 12);
    for (let r = radius; r > 0; r -= step) {
        c.fillCircle(cx, cy, r, color, alpha * (1 - r / radius));
    }
}

/** Рваный край/щель. */
function tear(c, x0, y0, x1, y1, thickness, color, random) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(4, Math.round(len / 10));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = x0 + dx * t + (random() - 0.5) * 6;
        const py = y0 + dy * t + (random() - 0.5) * 6;
        c.fillCircle(px, py, thickness * (0.6 + random() * 0.8), color, 0.9);
    }
}

module.exports = { fur, scales, rustStreaks, glow, tear };
