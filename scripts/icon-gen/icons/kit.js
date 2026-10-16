'use strict';

// Общие рисовальные «детали» для групп иконок: купол шлема, торс брони,
// шприц, звезда и т.д. Чтобы не копировать одни и те же полигоны в каждой
// иконке, здесь собираются переиспользуемые формы.

const { PALETTE: P, shade } = require('../draw');

/** Звезда (5 лучей) — эмблемы, награды, прицел. */
function star(c, cx, cy, outer, inner, rgb, alpha = 1) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    c.fillPolygon(pts, rgb, alpha);
}

/** Полуэллиптический купол (шлем, бункерный люк) с основанием на cy. */
function dome(c, cx, cy, rx, ry, rgb, alpha = 1) {
    const pts = [];
    for (let a = 180; a >= 0; a -= 8) {
        const r = (a * Math.PI) / 180;
        pts.push([cx + rx * Math.cos(r), cy - ry * Math.sin(r)]);
    }
    pts.push([cx + rx, cy], [cx - rx, cy]);
    c.fillPolygon(pts, rgb, alpha);
}

/**
 * Торс брони/куртки: кокон с плечами. opts:
 *  - collar: воротник-лапели; zipper: молния по центру;
 *  - trim: цвет окантовки; emblem: 'cross' | 'star' | null; hem: длина.
 */
function torso(c, color, opts = {}) {
    const { collar = false, zipper = false, trim = null, emblem = null, hem = 52 } = opts;
    const body = [[16, 18], [48, 18], [54, 28], [51, hem], [13, hem], [10, 28]];
    c.fillPolygon(body, color);
    c.fillRect(12, 18, 11, 5, shade(color, -0.08));   // погоны
    c.fillRect(41, 18, 11, 5, shade(color, -0.08));
    if (zipper) c.drawLine(32, 20, 32, hem - 1, 1.5, shade(color, -0.28));
    if (trim) {
        c.drawLine(16, 18, 10, 28, 1.5, trim, 0.9);
        c.drawLine(48, 18, 54, 28, 1.5, trim, 0.9);
        c.drawLine(13, hem, 51, hem, 1.5, trim, 0.9);
    }
    if (collar) {
        c.fillPolygon([[26, 18], [32, 28], [38, 18]], shade(color, -0.15));
        c.fillPolygon([[24, 18], [32, 26], [32, 18]], shade(color, -0.05));
        c.fillPolygon([[40, 18], [32, 26], [32, 18]], shade(color, -0.05));
    }
    if (emblem === 'cross') {
        c.fillRect(27, 30, 10, 3, P.blood);
        c.fillRect(30.5, 26.5, 3, 10, P.blood);
    } else if (emblem === 'star') {
        star(c, 32, 34, 7, 3, P.warning);
    }
}

/** Штаны/брюки (две ноги + пояс). */
function pants(c, color, opts = {}) {
    const { belt = null, patch = null } = opts;
    c.fillRect(16, 14, 32, 8, shade(color, -0.06));           // пояс
    c.fillRect(17, 21, 13, 33, color);                        // левая нога
    c.fillRect(34, 21, 13, 33, color);                        // правая нога
    c.fillRect(30, 21, 4, 14, shade(color, -0.1));            // шаг
    if (belt) c.fillRect(16, 14, 32, 3, belt);
    if (patch) {
        c.fillRect(19, 30, 9, 8, patch);                      // накладка
        c.drawLine(19, 30, 28, 30, 1, shade(patch, -0.2));
    }
    c.drawLine(23, 24, 23, 53, 1, shade(color, -0.18), 0.7);  // строчки
    c.drawLine(40, 24, 40, 53, 1, shade(color, -0.18), 0.7);
}

/** Перчатка (вид спереди). */
function glove(c, color, opts = {}) {
    const { cuff = null } = opts;
    c.fillRoundRect(20, 22, 24, 24, 8, color);                // ладонь
    c.fillRoundRect(13, 27, 9, 14, 4, shade(color, -0.05));   // большой палец
    c.fillRect(22, 45, 20, 8, cuff || shade(color, -0.12));   // манжета
    for (let i = 1; i < 4; i++) {
        c.drawLine(20 + i * 6, 22, 20 + i * 6, 34, 1, shade(color, -0.22), 0.8);
    }
    c.drawLine(24, 47, 40, 47, 1, shade(cuff || color, 0.1), 0.7);
}

/** Ботинок (вид сбоку, носок вправо). */
function boot(c, color, opts = {}) {
    const { sole = P.dark } = opts;
    c.fillRect(18, 12, 16, 26, color);                        // голенище
    c.fillPolygon([[18, 36], [46, 38], [49, 45], [18, 47]], color);
    c.fillRect(16, 46, 34, 5, sole);                          // подошва
    for (let i = 0; i < 4; i++) {                             // шнуровка
        c.drawLine(21, 16 + i * 5, 31, 18 + i * 5, 1.2, shade(color, -0.3));
        c.drawLine(31, 16 + i * 5, 21, 18 + i * 5, 1.2, shade(color, -0.3));
    }
}

/**
 * Шприц по диагонали (из левого нижнего в правый верхний).
 * liquid — цвет жидкости в стекле.
 */
function syringe(c, liquid, opts = {}) {
    const { needleTo = [54, 10], barrel = [[16, 48], [44, 20]], thick = 8 } = opts;
    const [x0, y0] = barrel[0];
    const [x1, y1] = barrel[1];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len; // нормаль к оси шприца
    const h = thick / 2;
    // корпус — полупрозрачное стекло
    c.fillPolygon([
        [x0 + nx * h, y0 + ny * h], [x1 + nx * h, y1 + ny * h],
        [x1 - nx * h, y1 - ny * h], [x0 - nx * h, y0 - ny * h],
    ], shade(P.cold, 0.25), 0.55);
    // жидкость — ближе к игле
    const fill = 0.35;
    const lx = x1 + (x0 - x1) * fill, ly = y1 + (y0 - y1) * fill;
    c.drawLine(lx, ly, x1, y1, thick - 3.5, liquid, 0.95);
    // поршень и манжетка
    const px = x0 + (x1 - x0) * 0.12, py = y0 + (y1 - y0) * 0.12;
    c.drawLine(px, py, x0, y0, thick, P.steelDark);
    c.drawLine(x0, y0, x0 - 5, y0 + 5, 4, P.steel);
    // игла
    c.drawLine(x1, y1, needleTo[0], needleTo[1], 2, P.steel);
    // риски на стекле
    for (let i = 1; i <= 3; i++) {
        const t = 0.4 + i * 0.13;
        const sx = x0 + (x1 - x0) * t, sy = y0 + (y1 - y0) * t;
        c.drawLine(sx + nx * (h - 1), sy + ny * (h - 1), sx + nx * 1.5, sy + ny * 1.5, 1, P.dark, 0.7);
    }
}

/** Цилиндрическая банка (консервы/энергетик): label — цвет этикетки. */
function canister(c, label, opts = {}) {
    const { x = 20, y = 16, w = 24, h = 34, bolt = false, skull = false } = opts;
    c.fillRect(x, y, w, h, P.steelDark);
    c.fillEllipse(x + w / 2, y + 3.5, w / 2, 4, P.steel);     // крышка
    c.fillRect(x, y + h * 0.3, w, h * 0.42, label);           // этикетка
    c.fillEllipse(x + w / 2, y + h - 3, w / 2, 4, shade(P.steelDark, -0.1));
    c.drawLine(x + 3, y + h * 0.3, x + 3, y + h * 0.72, 1, shade(label, -0.2), 0.8);
    c.drawLine(x + w - 3, y + h * 0.3, x + w - 3, y + h * 0.72, 1, shade(label, -0.2), 0.8);
    if (bolt) star(c, x + w / 2, y + h * 0.51, 6.5, 2.8, shade(label, 0.45));
    if (skull) {
        c.fillEllipse(x + w / 2, y + h * 0.47, 6, 5, shade(label, 0.4));
        c.fillCircle(x + w / 2 - 2.5, y + h * 0.46, 1.6, P.dark);
        c.fillCircle(x + w / 2 + 2.5, y + h * 0.46, 1.6, P.dark);
        c.fillRect(x + w / 2 - 3, y + h * 0.53, 6, 2.5, shade(label, 0.4));
    }
}

/** Шестерня (сломанная — с трещинами, если broken). */
function gear(c, cx, cy, radius, rgb, opts = {}) {
    const { teeth = 8, hole = 0.38, broken = false } = opts;
    c.strokeCircle(cx, cy, radius, radius * 0.42, rgb);
    for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        const tx = cx + Math.cos(a) * (radius + 3);
        const ty = cy + Math.sin(a) * (radius + 3);
        c.fillCircle(tx, ty, radius * 0.22, rgb);
    }
    c.fillCircle(cx, cy, radius * hole, P.bgDark, 0.95);
    if (broken) {
        c.drawLine(cx - 4, cy - radius - 4, cx + 5, cy + radius + 4, 2.5, P.bgDark, 0.9);
        c.drawLine(cx - radius - 4, cy + 3, cx + radius + 4, cy - 5, 2, P.bgDark, 0.75);
    }
}

/** Алмаз/кристалл (гранёный, с бликом). */
function gem(c, rgb, opts = {}) {
    const { cx = 32, cy = 34, rx = 17, ry = 22, glow = null } = opts;
    if (glow) c.fillEllipse(cx, cy, rx + 7, ry + 5, glow, 0.22);
    c.fillPolygon([
        [cx - rx, cy - ry * 0.5], [cx - rx * 0.6, cy - ry], [cx + rx * 0.6, cy - ry],
        [cx + rx, cy - ry * 0.5], [cx, cy + ry],
    ], rgb);
    // грани — разные оттенки для объёма
    c.fillPolygon([[cx - rx, cy - ry * 0.5], [cx - rx * 0.6, cy - ry], [cx, cy + ry]], shade(rgb, -0.16));
    c.fillPolygon([[cx + rx * 0.6, cy - ry], [cx + rx, cy - ry * 0.5], [cx, cy + ry]], shade(rgb, 0.14));
    c.drawLine(cx - rx * 0.6, cy - ry, cx + rx * 0.6, cy - ry, 1.5, shade(rgb, 0.3), 0.9);
    c.drawLine(cx - rx * 0.6, cy - ry, cx, cy - ry * 0.5, 1, shade(rgb, 0.25), 0.7);
}

/** Радиационный символ «трилистник». */
function radiation(c, cx, cy, r, rgb, alpha = 1) {
    c.fillCircle(cx, cy, r * 0.26, rgb, alpha);
    for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        const spread = 0.62;
        const pts = [[cx, cy]];
        const steps = 8;
        for (let s = 0; s <= steps; s++) {
            const a = a0 - spread + (2 * spread * s) / steps;
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        c.fillPolygon(pts, rgb, alpha);
    }
}

/** Красный крест (медицинские иконки). */
function medCross(c, cx, cy, size, rgb) {
    const t = Math.max(3, size * 0.34);
    c.fillRect(cx - size / 2, cy - t / 2, size, t, rgb);
    c.fillRect(cx - t / 2, cy - size / 2, t, size, rgb);
}

module.exports = { star, dome, torso, pants, glove, boot, syringe, canister, gear, gem, radiation, medCross };


