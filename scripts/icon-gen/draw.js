'use strict';

// Растровый «холст» для процедурной генерации иконок.
//
// Стиль постапокалипсиса задаётся здесь, а не в каждой иконке:
//  - тёмная пыльная подложка с виньеткой (кадр «запылённый видоискатель»);
//  - приглушённая палитра: ржавчина, бетон, старая сталь, кислотный
//    радиационный акцент;
//  - зерно/царапины поверх — иконка не выглядит «векторно-чипом».
//
// Всё рисуется в RGBA-буфере вручную: никаких canvas/sharp — см. png.js.

/** Палитра постапокалипсиса. */
const PALETTE = {
    bgDark:      [26, 24, 20],      // почти чёрный тёплый
    bgMid:       [44, 40, 33],      // пыльный бетон
    bgLight:     [66, 61, 50],
    rust:        [140, 78, 40],     // ржавый железный
    rustDeep:    [96, 52, 28],
    steel:       [148, 152, 158],   // старая сталь
    steelDark:   [92, 96, 104],
    bone:        [206, 198, 176],   // кость/ткань
    toxic:       [146, 204, 66],    // кислотно-зелёный акцент
    toxicDeep:   [92, 140, 40],
    blood:       [150, 44, 36],
    warning:     [224, 168, 56],    // оранжевый «внимание»
    cold:        [96, 140, 170],    // холодный синий (вода, техника)
    skin:        [176, 142, 110],
    cloth:       [110, 104, 84],    // хаки-ткань
    dark:        [14, 13, 11],
};

/** Осветлить (f>0) или затемнить (f<0) цвет на f*255 по каждому каналу. */
function shade(rgb, f) {
    const adj = (v) => Math.max(0, Math.min(255, Math.round(v + f * 255)));
    return [adj(rgb[0]), adj(rgb[1]), adj(rgb[2])];
}

/** Детерминированный PRNG (mulberry32): одна и та же иконка всегда
 *  байт-в-байт одинакова, иначе git-диффы будут непредсказуемыми. */
function makeRandom(seed) {
    let a = seed >>> 0;
    return function random() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class Canvas {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = Buffer.alloc(width * height * 4);
    }

    /** Наложение одного пикселя с альфой (source-over). */
    blend(x, y, rgb, alpha = 1) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
        const i = (y * this.width + x) * 4;
        const a = Math.min(1, alpha);
        const da = this.data[i + 3] / 255;
        const outA = a + da * (1 - a);
        if (outA <= 0) return;
        for (let c = 0; c < 3; c++) {
            const sc = rgb[c] / 255;
            const dc = this.data[i + c] / 255;
            this.data[i + c] = Math.round(255 * (sc * a + dc * da * (1 - a)) / outA);
        }
        this.data[i + 3] = Math.round(255 * outA);
    }

    /** Прямоугольник. */
    fillRect(x, y, w, h, rgb, alpha = 1) {
        const x0 = Math.round(x), y0 = Math.round(y);
        const x1 = Math.round(x + w), y1 = Math.round(y + h);
        for (let yy = y0; yy < y1; yy++) {
            for (let xx = x0; xx < x1; xx++) this.blend(xx, yy, rgb, alpha);
        }
    }

    /** Закруглённый прямоугольник (скругление radius по всем углам). */
    fillRoundRect(x, y, w, h, radius, rgb, alpha = 1) {
        const r = Math.min(radius, w / 2, h / 2);
        for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy++) {
            for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx++) {
                const px = xx + 0.5, py = yy + 0.5;
                // расстояние до «сердцевины» прямоугольника
                const cx = Math.max(x + r, Math.min(px, x + w - r));
                const cy = Math.max(y + r, Math.min(py, y + h - r));
                const dx = px - cx, dy = py - cy;
                if (dx * dx + dy * dy <= r * r) this.blend(xx, yy, rgb, alpha);
            }
        }
    }

    /** Окружность (заливка). */
    fillCircle(cx, cy, radius, rgb, alpha = 1) {
        const r2 = radius * radius;
        const x0 = Math.floor(cx - radius), x1 = Math.ceil(cx + radius);
        const y0 = Math.floor(cy - radius), y1 = Math.ceil(cy + radius);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                if (dx * dx + dy * dy <= r2) this.blend(x, y, rgb, alpha);
            }
        }
    }

    /** Кольцо/обводка окружности толщиной stroke. */
    strokeCircle(cx, cy, radius, stroke, rgb, alpha = 1) {
        const outer = (radius + stroke / 2) ** 2;
        const inner = Math.max(0, radius - stroke / 2) ** 2;
        for (let y = Math.floor(cy - radius - stroke); y <= Math.ceil(cy + radius + stroke); y++) {
            for (let x = Math.floor(cx - radius - stroke); x <= Math.ceil(cx + radius + stroke); x++) {
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                const d2 = dx * dx + dy * dy;
                if (d2 <= outer && d2 >= inner) this.blend(x, y, rgb, alpha);
            }
        }
    }

    /** Эллипс (заливка). */
    fillEllipse(cx, cy, rx, ry, rgb, alpha = 1) {
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
                const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
                if (dx * dx + dy * dy <= 1) this.blend(x, y, rgb, alpha);
            }
        }
    }

    /** Толстая линия (segment с круглыми концами). */
    drawLine(x0, y0, x1, y1, thickness, rgb, alpha = 1) {
        const dx = x1 - x0, dy = y1 - y0;
        const len2 = dx * dx + dy * dy || 1;
        const r = thickness / 2;
        const minX = Math.floor(Math.min(x0, x1) - r), maxX = Math.ceil(Math.max(x0, x1) + r);
        const minY = Math.floor(Math.min(y0, y1) - r), maxY = Math.ceil(Math.max(y0, y1) + r);
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5, py = y + 0.5;
                let t = ((px - x0) * dx + (py - y0) * dy) / len2;
                t = Math.max(0, Math.min(1, t));
                const qx = px - (x0 + t * dx), qy = py - (y0 + t * dy);
                if (qx * qx + qy * qy <= r * r) this.blend(x, y, rgb, alpha);
            }
        }
    }

    /** Многоугольник (заливка правилом чётности по scanline). */
    fillPolygon(points, rgb, alpha = 1) {
        let minY = Infinity, maxY = -Infinity;
        for (const [, y] of points) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
            const sy = y + 0.5;
            const xs = [];
            for (let i = 0; i < points.length; i++) {
                const [x1, y1] = points[i];
                const [x2, y2] = points[(i + 1) % points.length];
                if ((y1 <= sy && y2 > sy) || (y2 <= sy && y1 > sy)) {
                    xs.push(x1 + ((sy - y1) / (y2 - y1)) * (x2 - x1));
                }
            }
            xs.sort((a, b) => a - b);
            for (let i = 0; i + 1 < xs.length; i += 2) {
                for (let x = Math.ceil(xs[i]); x < xs[i + 1]; x++) {
                    this.blend(x, y, rgb, alpha);
                }
            }
        }
    }

    /** Готовый буфер для png.js. */
    toPNG() {
        // eslint-disable-next-line global-require
        return require('./png').encodePNG(this.width, this.height, this.data);
    }
}

/**
 * Фон-кадр иконки: тёмная пыльная плашка со скруглением, лёгким
 * радиальным светом сверху-слева и виньеткой по краям. Возвращает
 * детерминированный генератор, чтобы иконка получила предсказуемое зерно.
 */
function drawFrame(canvas, seed = 1) {
    const w = canvas.width;
    const pad = Math.max(1, Math.round(w * 0.02));
    const cx = w / 2, cy = w / 2;
    const random = makeRandom(seed * 7919 + 13);

    canvas.fillRoundRect(pad, pad, w - pad * 2, w - pad * 2, w * 0.16, PALETTE.bgMid);

    // мягкий световой пятен сверху-слева
    const lightR = w * 0.8;
    for (let y = pad; y < w - pad; y++) {
        for (let x = pad; x < w - pad; x++) {
            const dx = (x - w * 0.32) / lightR;
            const dy = (y - w * 0.28) / lightR;
            const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) * 0.35;
            if (glow > 0) canvas.blend(x, y, PALETTE.bgLight, glow);
            // виньетка по краям плашки
            const ex = Math.min(x - pad, w - 1 - pad - x) / (w / 2);
            const ey = Math.min(y - pad, w - 1 - pad - y) / (w / 2);
            const edge = Math.min(ex, ey);
            if (edge < 0.35) canvas.blend(x, y, PALETTE.dark, (0.35 - edge) * 1.3);
        }
    }

    // рамка «под старину»
    canvas.strokeCircle(cx, cy, (w - pad * 2 - 2) / 2, 1.5, shade(PALETTE.bgLight, 0.06), 0.5);

    // мусорная крапина — пыль на стекле
    for (let i = 0; i < w * 1.5; i++) {
        const x = pad + random() * (w - pad * 2);
        const y = pad + random() * (w - pad * 2);
        const bright = random() > 0.5;
        canvas.blend(x | 0, y | 0, bright ? PALETTE.bgLight : PALETTE.dark, 0.10 + random() * 0.12);
    }

    return random;
}

/** Итоговое зерно + диагональные царапины поверх всей иконки. */
function applyGrain(canvas, random, intensity = 0.05) {
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const n = (random() - 0.5) * 2 * intensity;
            if (n >= 0) canvas.blend(x, y, [255, 255, 255], n);
            else canvas.blend(x, y, [0, 0, 0], -n);
        }
    }
    for (let s = 0; s < 4; s++) {
        const x0 = random() * canvas.width;
        const y0 = random() * canvas.height;
        const len = 6 + random() * 14;
        const angle = -0.6 + random() * 1.2;
        canvas.drawLine(
            x0, y0,
            x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len,
            1, PALETTE.bgLight, 0.10 + random() * 0.10
        );
    }
}

module.exports = { Canvas, PALETTE, shade, makeRandom, drawFrame, applyGrain };


