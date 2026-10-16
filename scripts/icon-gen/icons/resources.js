'use strict';

// Иконки ресурсов, боеприпасов, ключей и разного хлама постапокалипсиса.

const { PALETTE: P, shade } = require('../draw');
const { gear, gem, radiation } = require('./kit');

const BRASS = [176, 140, 62];
const WOOD = [112, 78, 46];

module.exports = {
    /** Металлолом: сломанная шестерня. */
    'res-scrap'(c) {
        gear(c, 28, 32, 13, P.steelDark, { broken: true });
        gear(c, 44, 42, 8, shade(P.steelDark, 0.08), { teeth: 6, broken: true });
        // стружка
        c.drawLine(14, 48, 20, 44, 1.4, P.steel, 0.6);
        c.drawLine(48, 20, 52, 24, 1.4, P.steel, 0.6);
    },

    /** Древесина: бревно с торцом. */
    'res-wood'(c) {
        c.fillRect(10, 22, 42, 20, WOOD);                        // тело
        c.fillRect(10, 22, 42, 3, shade(WOOD, 0.08));            // верхняя грань
        c.fillEllipse(52, 32, 6, 10, shade(WOOD, 0.12));         // торец
        c.strokeCircle(52, 32, 6.5, 1.2, shade(WOOD, -0.05));
        c.strokeCircle(52, 32, 4, 1, shade(WOOD, -0.12));        // годовые кольца
        c.fillCircle(52, 32, 1.4, shade(WOOD, -0.2));
        c.drawLine(16, 30, 34, 30, 1, shade(WOOD, -0.15), 0.7);  // трещины
        c.fillCircle(26, 36, 2, shade(WOOD, -0.2));              // сучок
        c.drawLine(20, 22, 22, 15, 1.6, P.steelDark);            // торчащий гвоздь
        c.fillCircle(22, 15, 1.2, P.steelDark);
    },

    /** Пластик: обломки панелей. */
    'res-plastic'(c) {
        const PL = [142, 132, 110];
        c.fillPolygon([[14, 40], [26, 20], [38, 30], [24, 46]], PL);
        c.fillPolygon([[38, 24], [50, 18], [52, 34], [42, 36]], shade(PL, 0.07));
        c.fillPolygon([[30, 46], [46, 40], [48, 50], [34, 54]], shade(PL, -0.08));
        c.drawLine(20, 32, 32, 38, 1, shade(PL, -0.2), 0.7);     // линии излома
        c.drawLine(42, 26, 46, 30, 1, shade(PL, -0.2), 0.7);
        c.fillCircle(30, 30, 2, P.bgDark, 0.75);                 // отверстия
        c.fillCircle(44, 46, 2, P.bgDark, 0.75);
    },

    /** Ткань: лоскут с нашивкой. */
    'res-cloth'(c) {
        const CLOTH = [104, 98, 78];
        c.fillPolygon([[12, 20], [52, 16], [54, 48], [14, 52]], CLOTH);
        for (let i = 0; i < 4; i++) {                            // рваный край
            c.fillPolygon([[52, 16 + i * 8], [58, 20 + i * 8], [54, 24 + i * 8]], CLOTH);
        }
        c.fillRect(20, 28, 16, 14, shade(CLOTH, 0.1));           // нашивка
        for (let i = 0; i < 3; i++) {                            // строчки
            c.drawLine(21, 31 + i * 4, 35, 31 + i * 4, 1, shade(CLOTH, -0.2), 0.8);
        }
        c.drawLine(14, 24, 10, 20, 1, shade(CLOTH, 0.2), 0.7);   // нитки
        c.drawLine(40, 50, 44, 54, 1, shade(CLOTH, 0.2), 0.7);
    },

    /** Провода: катушка с оголёнными жилами. */
    'res-wire'(c) {
        c.fillRoundRect(18, 24, 28, 20, 4, shade(WOOD, -0.03));  // катушка
        c.fillRect(18, 24, 28, 3, shade(WOOD, 0.1));
        for (let i = 0; i < 5; i++) c.drawLine(20, 29 + i * 3.4, 44, 29 + i * 3.4, 2.4, P.rust);
        c.drawLine(18, 30, 8, 22, 2, P.blood);                   // провода
        c.drawLine(46, 36, 56, 42, 2, P.cold);
        c.drawLine(8, 22, 6, 18, 2, P.blood);
        c.drawLine(56, 42, 59, 40, 1.4, BRASS, 0.9);             // оголённые жилы
        c.drawLine(6, 18, 4, 16, 1.4, BRASS, 0.9);
    },

    /** Электроника: плата с микросхемой. */
    'res-electronics'(c) {
        const PCB = [56, 88, 62];
        c.fillRoundRect(12, 18, 40, 30, 2, PCB);
        c.fillRoundRect(22, 26, 16, 14, 1.5, P.dark);            // микросхема
        for (let i = 0; i < 4; i++) {                            // ножки
            c.fillRect(19, 28 + i * 3.4, 3, 1.6, P.steel);
            c.fillRect(38, 28 + i * 3.4, 3, 1.6, P.steel);
        }
        c.fillRect(16, 40, 5, 7, shade(P.steelDark, 0.06));      // конденсаторы
        c.fillRect(41, 22, 5, 7, shade(P.steelDark, 0.06));
        c.drawLine(14, 22, 44, 22, 1, BRASS, 0.8);               // трассы
        c.drawLine(14, 45, 30, 45, 1, BRASS, 0.8);
        c.drawLine(30, 45, 30, 24, 1, BRASS, 0.7);
        c.fillCircle(16, 22, 1.4, BRASS);
        c.fillCircle(44, 45, 1.4, BRASS);
    },

    /** Титан: слиток. */
    'res-titan'(c) {
        c.fillPolygon([[14, 42], [50, 42], [46, 26], [18, 26]], shade(P.steel, 0.12));
        c.fillPolygon([[14, 42], [50, 42], [52, 48], [12, 48]], shade(P.steel, -0.02));
        c.fillPolygon([[18, 26], [46, 26], [44, 22], [20, 22]], shade(P.steel, 0.22));
        c.drawLine(22, 28, 42, 28, 1.4, [255, 255, 255], 0.4);   // блик
        c.fillRect(26, 32, 12, 5, shade(P.steel, -0.12));        // клеймо
        c.fillRect(28, 33.5, 8, 2, shade(P.steel, -0.28));
    },

    /** Кристалл силы: светящийся гранёный осколок. */
    'res-crystal'(c) {
        gem(c, P.toxic, { glow: P.toxic });
        // внутренние трещины
        c.drawLine(32, 14, 28, 40, 1, shade(P.toxic, 0.35), 0.7);
        c.drawLine(32, 14, 38, 38, 1, shade(P.toxic, -0.25), 0.6);
        // искры
        c.fillCircle(18, 20, 1.2, P.toxic, 0.8);
        c.fillCircle(46, 18, 1.2, P.toxic, 0.8);
        c.fillCircle(48, 44, 1, P.toxic, 0.7);
    },

    /** Химикаты: колба с реагентом. */
    'res-chemicals'(c) {
        c.fillPolygon([[26, 14], [38, 14], [38, 28], [50, 50], [14, 50], [26, 28]], shade(P.cold, 0.3), 0.7);
        c.fillRect(27, 10, 10, 4, shade(P.cold, 0.35));
        c.fillRect(26, 8, 12, 3, P.steelDark);
        c.fillPolygon([[28, 36], [36, 36], [46, 48], [18, 48]], [96, 150, 60], 0.9); // жидкость
        c.fillEllipse(32, 36, 4, 1.6, [120, 175, 80], 0.9);
        c.fillCircle(28, 43, 2, [130, 190, 90], 0.7);           // пузыри
        c.fillCircle(36, 45, 1.5, [130, 190, 90], 0.6);
        c.fillCircle(32, 40, 1.2, [130, 190, 90], 0.6);
        c.drawLine(29, 18, 29, 30, 1.6, [255, 255, 255], 0.35); // блик
    },

    /** Уран: брусок с радиационным свечением. */
    'res-uranium'(c) {
        c.fillEllipse(32, 34, 20, 18, P.toxic, 0.18);           // свечение
        c.fillPolygon([[18, 42], [46, 42], [44, 22], [20, 22]], P.toxicDeep);
        c.fillPolygon([[18, 42], [46, 42], [48, 46], [16, 46]], shade(P.toxicDeep, -0.1));
        c.fillPolygon([[20, 22], [44, 22], [42, 18], [22, 18]], shade(P.toxicDeep, 0.12));
        c.drawLine(19, 32, 45, 32, 1, shade(P.toxicDeep, -0.2), 0.8); // сегменты
        radiation(c, 32, 30, 8, shade(P.toxic, 0.25), 0.95);
        for (let i = 0; i < 8; i++) {                           // предупредительная лента
            c.fillRect(12 + i * 5.4, 50, 3, 4, i % 2 ? P.warning : P.dark, 0.85);
        }
    },

    /** Патроны: связка гильз. */
    'res-ammo'(c) {
        const BRASS = [176, 140, 62];
        for (let i = 0; i < 3; i++) {
            const x = 18 + i * 12;
            c.fillRect(x, 24, 8, 22, BRASS);                     // гильза
            c.fillPolygon([[x, 24], [x + 4, 16], [x + 8, 24]], shade(BRASS, 0.1)); // пуля
            c.fillRect(x, 43, 8, 3, shade(BRASS, -0.15));        // выточка
            c.drawLine(x + 1.5, 26, x + 1.5, 42, 1, shade(BRASS, 0.25), 0.6);
        }
        c.fillRect(16, 32, 34, 4, shade(P.rust, -0.05), 0.9);    // связывающая лента
    },

    /** Реактивные гранаты/ракеты. */
    'res-rockets'(c) {
        c.fillPolygon([[18, 46], [28, 38], [40, 18], [46, 22], [30, 42], [22, 50]], P.rust);
        c.fillCircle(43, 19, 5, P.rust);
        c.fillPolygon([[46, 14], [54, 10], [50, 18]], shade(P.rust, 0.1));   // наконечник
        c.fillPolygon([[22, 42], [14, 40], [16, 48]], shade(P.rust, -0.1));  // стабилизаторы
        c.fillPolygon([[26, 46], [20, 52], [28, 52]], shade(P.rust, -0.1));
        c.drawLine(33, 32, 37, 26, 3, P.warning, 0.9);           // полоса
    },

    /** Ключ боссов: старинный ключ с черепом на голове. */
    'res-key'(c) {
        c.drawLine(16, 44, 46, 22, 4.4, P.warning);              // стержень
        c.fillRect(40, 26, 4, 8, P.warning);                     // бородка
        c.fillRect(46, 22, 4, 8, P.warning);
        c.fillCircle(18, 44, 8, P.warning);                      // голова-кольцо
        c.fillCircle(18, 44, 4.4, P.bgDark, 0.95);
        c.fillEllipse(18, 42.5, 2.6, 2.2, shade(P.warning, 0.2)); // черепушка
        c.fillCircle(17, 42.5, 0.7, P.dark);
        c.fillCircle(19, 42.5, 0.7, P.dark);
        c.fillCircle(32, 32, 1.6, P.toxicDeep, 0.5);             // патина
    },
};

