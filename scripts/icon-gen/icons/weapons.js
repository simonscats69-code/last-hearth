'use strict';

// Иконки оружия: каждый ствол нарисован «по профилю», в постапок-палитре
// (ржавая сталь, примитивная деревянная ложа, патроны с латунью).

const { PALETTE: P, shade } = require('../draw');

const WOOD = [112, 78, 46];
const RUSTED = [120, 96, 74];
const BRASS = [176, 140, 62];

module.exports = {
    /** Нож: клинок + обмотанная рукоять. */
    'wpn-knife'(c) {
        // клинок вправо-вверх
        c.fillPolygon([[14, 50], [40, 22], [45, 16], [43, 24], [20, 52]], P.steel);
        c.drawLine(18, 49, 42, 20, 1.4, shade(P.steel, 0.3));   // фаска
        // обух тёмный
        c.fillPolygon([[40, 22], [45, 16], [43, 24]], shade(P.steel, -0.12));
        // рукоять
        c.fillRoundRect(6, 44, 14, 12, 3, RUSTED);
        for (let i = 0; i < 3; i++) c.drawLine(8 + i * 4, 45, 8 + i * 4, 55, 1.4, shade(RUSTED, -0.15));
        // гарда
        c.fillRect(17, 42, 4, 13, P.steelDark);
        // пятно крови на острие
        c.fillCircle(43, 19, 1.8, P.blood, 0.8);
    },

    /** Бита с гвоздями. */
    'wpn-bat'(c) {
        // тело биты по диагонали
        c.drawLine(16, 50, 42, 20, 5, WOOD);
        c.drawLine(42, 20, 48, 14, 9, WOOD);                    // утолщение
        c.drawLine(44, 17, 47, 14, 1.5, shade(WOOD, 0.12));     // блик
        // обмотка рукояти
        c.drawLine(12, 54, 20, 46, 6, shade(WOOD, -0.2));
        for (let i = 0; i < 3; i++) c.drawLine(12 + i * 3, 55 - i * 3, 16 + i * 3, 51 - i * 3, 1, P.dark, 0.7);
        // гвозди
        const nails = [[44, 18], [46, 22], [42, 24], [48, 16]];
        for (const [nx, ny] of nails) {
            c.drawLine(nx, ny, nx + 3, ny - 3, 1.6, P.steel);
            c.fillCircle(nx, ny, 1.2, P.steel);
        }
        // ржавые потёки
        c.fillCircle(30, 36, 1.5, P.rust, 0.7);
        c.fillCircle(24, 42, 1.2, P.rust, 0.6);
    },

    /** Пистолет ( Makarov ): профиль ствола влево. */
    'wpn-pistol'(c) {
        // затвор
        c.fillRoundRect(14, 24, 34, 9, 2, P.steelDark);
        c.fillRect(14, 31, 34, 3, shade(P.steelDark, -0.08));
        // ствол-выступ
        c.fillRect(10, 26, 5, 5, P.steelDark);
        c.fillCircle(11, 28.5, 1.4, P.dark);
        // рукоять
        c.fillPolygon([[24, 34], [38, 34], [42, 54], [28, 54]], RUSTED);
        for (let i = 0; i < 4; i++) c.drawLine(28 + i * 3, 38 + i * 3.5, 32 + i * 3, 42 + i * 3.5, 1.2, shade(RUSTED, -0.15));
        // спусковая скоба
        c.drawLine(22, 34, 22, 40, 2, P.steelDark);
        c.drawLine(22, 40, 28, 42, 2, P.steelDark);
        // курок и мушка
        c.fillPolygon([[46, 24], [50, 22], [50, 26]], shade(P.steelDark, -0.1));
        c.fillRect(16, 22, 2, 3, shade(P.steelDark, 0.1));
        // патрон в патроннике — видна латунь
        c.fillRect(40, 26, 4, 3, BRASS, 0.9);
    },

    /** Пистолет ТТ: вытянутый затвор, другой силуэт. */
    'wpn-pistol-tt'(c) {
        c.fillRoundRect(10, 22, 40, 8, 2, shade(P.steelDark, 0.05));   // длинный затвор
        c.fillRect(8, 24, 4, 4, shade(P.steelDark, 0.05));
        // эrgonomic рукоять — косая
        c.fillPolygon([[32, 30], [45, 30], [49, 54], [37, 54]], shade(WOOD, 0.05));
        c.drawLine(38, 36, 42, 50, 1.4, shade(WOOD, -0.12));
        // скоба
        c.drawLine(27, 30, 27, 38, 2, P.steelDark);
        c.drawLine(27, 38, 34, 40, 2, P.steelDark);
        // выбрасыватель
        c.fillRect(30, 23.5, 6, 2, shade(P.steelDark, -0.12));
        // блик по затвору
        c.drawLine(13, 23.5, 47, 23.5, 1, shade(P.steel, 0.25), 0.7);
    },

    /** Обрез: два ствола напополам, рваный приклад. */
    'wpn-sawed'(c) {
        // стволы (два коротких, влево)
        c.fillRect(8, 24, 26, 5, P.steelDark);
        c.fillRect(8, 31, 26, 5, P.steelDark);
        c.fillCircle(9, 26.5, 1.6, P.dark);
        c.fillCircle(9, 33.5, 1.6, P.dark);
        // цевьё
        c.fillRect(30, 22, 10, 16, WOOD);
        for (let i = 0; i < 3; i++) c.drawLine(32 + i * 3, 23, 32 + i * 3, 37, 1, shade(WOOD, -0.15));
        // рукоять-обрез приклада
        c.fillPolygon([[40, 26], [52, 30], [50, 42], [40, 38]], WOOD);
        // спусковая скоба
        c.drawLine(42, 38, 40, 45, 2, P.steelDark);
        // рваный срез приклада — дёрганый край
        for (let i = 0; i < 3; i++) {
            c.fillPolygon([[50 + i, 30 + i * 4], [54 + i, 32 + i * 4], [50 + i, 34 + i * 4]], shade(WOOD, -0.05));
        }
    },

    /** Топор. */
    'wpn-axe'(c) {
        // топорище
        c.drawLine(20, 54, 38, 18, 5, WOOD);
        c.drawLine(21, 53, 38, 19, 1.2, shade(WOOD, 0.1));
        // обмотка внизу
        c.drawLine(18, 55, 24, 49, 6.5, shade(WOOD, -0.2));
        // топорище-голова: полукруглая колющая часть влево
        c.fillPolygon([[34, 14], [46, 12], [48, 28], [36, 30], [24, 30], [20, 22], [30, 16]], P.steel);
        // режущая кромка — светлая
        c.fillPolygon([[24, 30], [20, 22], [18, 26], [23, 33]], shade(P.steel, 0.3));
        c.fillPolygon([[34, 14], [30, 16], [28, 12], [33, 11]], shade(P.steel, 0.2));
        // ржавые пятна
        c.fillCircle(40, 20, 2.4, P.rust, 0.75);
        c.fillCircle(36, 26, 1.8, P.rust, 0.6);
        // крепление
        c.fillRect(36, 14, 4, 14, shade(WOOD, 0.03));
    },

    /** Автомат (АК-подобный): изогнутый магазин, деревянное цевьё. */
    'wpn-assault'(c) {
        // ствол
        c.fillRect(44, 27, 12, 4, P.steelDark);
        c.fillRect(52, 25, 4, 8, shade(P.steelDark, -0.06));    // дульный тормоз
        // корпус/затвор
        c.fillRoundRect(20, 25, 26, 8, 1.5, P.steelDark);
        // цевьё дерево
        c.fillRect(40, 27, 8, 5, WOOD);
        // приклад
        c.fillPolygon([[20, 26], [8, 30], [8, 38], [20, 33]], WOOD);
        // изогнутый магазин
        c.fillPolygon([[26, 33], [36, 33], [38, 44], [34, 50], [26, 48], [28, 42]], shade(P.steelDark, 0.04));
        c.drawLine(29, 36, 31, 46, 1.2, shade(P.steelDark, -0.12), 0.8);
        // пистолетная рукоять
        c.fillPolygon([[21, 33], [27, 33], [25, 44], [19, 44]], RUSTED);
        // мушка и целик
        c.fillRect(44, 23, 2, 4, shade(P.steelDark, 0.12));
        c.fillRect(26, 22, 3, 4, shade(P.steelDark, 0.12));
        // рычажок
        c.fillRect(24, 31, 4, 2, shade(P.steelDark, -0.14));
    },

    /** Винтовка Мосина: длинная, с прямым прикладом. */
    'wpn-mosin'(c) {
        // ствол — длинный
        c.fillRect(40, 28, 20, 3, P.steelDark);
        // целик
        c.fillRect(56, 25, 2, 4, shade(P.steelDark, 0.1));
        // затвор с рукояткой
        c.fillRoundRect(30, 26, 12, 6, 1, P.steel);
        c.drawLine(36, 32, 38, 37, 2.5, P.steel);               // рукоятка затвора
        c.fillCircle(38, 38, 2, shade(P.steel, -0.05));
        // корпус/ложе
        c.fillRect(14, 27, 18, 6, WOOD);
        // приклад
        c.fillPolygon([[14, 28], [4, 32], [4, 44], [16, 42], [16, 33]], WOOD);
        // цевьё вниз
        c.fillRect(40, 31, 8, 4, WOOD);
        // магазин снизу
        c.fillRect(26, 33, 7, 6, shade(P.steelDark, 0.03));
        // ремень
        c.drawLine(8, 30, 44, 24, 1.5, P.cloth, 0.7);
    },

    /** Дробовик: широкий ствол, помпа. */
    'wpn-shotgun'(c) {
        // ствол
        c.fillRect(38, 26, 22, 5, P.steelDark);
        c.fillRect(58, 25, 4, 7, shade(P.steelDark, -0.08));
        // трубчатый магазин
        c.fillRect(38, 32, 18, 3, shade(P.steelDark, 0.05));
        // помпа — деревянная
        c.fillRect(40, 31, 10, 6, WOOD);
        for (let i = 0; i < 4; i++) c.fillRect(41 + i * 2.4, 32, 1, 4, shade(WOOD, -0.18));
        // ствольная коробка
        c.fillRoundRect(24, 25, 16, 9, 1.5, P.steelDark);
        // приклад
        c.fillPolygon([[24, 26], [10, 30], [10, 40], [26, 34]], WOOD);
        // рукоять
        c.fillPolygon([[22, 34], [28, 34], [26, 44], [20, 44]], RUSTED);
        // патрон у окна
        c.fillCircle(30, 29, 1.8, BRASS, 0.9);
    },

    /** Снайперская винтовка: с оптикой. */
    'wpn-sniper'(c) {
        // ствол
        c.fillRect(42, 29, 18, 3, P.steelDark);
        c.fillRect(58, 28, 3, 5, shade(P.steelDark, -0.08));
        // оптика
        c.fillRect(28, 18, 20, 6, P.steel);
        c.fillCircle(29, 21, 3, shade(P.steel, -0.1));
        c.fillCircle(47, 21, 3.4, shade(P.steel, -0.1));
        c.fillCircle(47, 21, 2, P.cold, 0.85);                 // линза
        c.fillRect(32, 24, 3, 4, P.steelDark);                  // кронштейн 1
        c.fillRect(42, 24, 3, 4, P.steelDark);                  // кронштейн 2
        // ствольная коробка
        c.fillRoundRect(22, 27, 22, 8, 1.5, shade(P.steelDark, 0.03));
        // приклад с щекоподъёмником
        c.fillPolygon([[22, 28], [6, 32], [6, 42], [24, 36]], WOOD);
        c.fillPolygon([[10, 28], [16, 27], [16, 31], [10, 32]], shade(WOOD, 0.06));
        // сошки
        c.drawLine(46, 33, 42, 46, 2, P.steelDark);
        c.drawLine(46, 33, 50, 46, 2, P.steelDark);
        // рукоять
        c.fillPolygon([[20, 35], [26, 35], [24, 45], [18, 45]], RUSTED);
    },

    /** Пулемёт: тяжёлый, с лентой патронов. */
    'wpn-machinegun'(c) {
        // ствол с вентиляцией
        c.fillRect(40, 26, 20, 6, P.steelDark);
        for (let i = 0; i < 4; i++) c.fillRect(44 + i * 4, 27, 2, 4, P.dark, 0.7);
        // короб
        c.fillRoundRect(18, 24, 24, 10, 2, shade(P.steelDark, 0.04));
        // лента патронов снизу
        for (let i = 0; i < 4; i++) {
            c.fillRect(22 + i * 5, 34, 3.4, 6, BRASS);
            c.fillPolygon([[22 + i * 5, 34], [23.7 + i * 5, 31], [25.4 + i * 5, 34]], BRASS);
        }
        c.drawLine(22, 36, 39, 36, 1.4, P.steelDark, 0.8);     // соединитель ленты
        // короб-корпус вниз
        c.fillRect(20, 40, 16, 12, shade(P.steelDark, -0.04));
        c.fillRect(22, 42, 12, 2, shade(P.steelDark, -0.12));
        // приклад и рукоять
        c.fillPolygon([[18, 25], [8, 28], [8, 36], [18, 33]], RUSTED);
        c.fillPolygon([[16, 34], [22, 34], [20, 42], [14, 42]], shade(P.steelDark, -0.06));
        // сошки спереди
        c.drawLine(54, 32, 50, 44, 2, P.steelDark);
        c.drawLine(54, 32, 58, 44, 2, P.steelDark);
    },

    /** Реактивная пушка: труба с гранатой в стволе. */
    'wpn-rpg'(c) {
        // труба по диагонали
        c.drawLine(12, 48, 46, 20, 9, shade(P.cloth, -0.06));
        c.drawLine(14, 46, 44, 21, 2, shade(P.cloth, 0.1), 0.6);   // блик
        // расширенное сопло
        c.fillPolygon([[44, 16], [54, 14], [56, 24], [46, 26]], shade(P.cloth, -0.1));
        // граната в стволе
        c.fillPolygon([[48, 12], [58, 8], [54, 4]], P.rust);
        c.fillCircle(56, 9, 3.4, P.rust);
        c.fillCircle(57, 8, 1.2, shade(P.rust, 0.2));
        // пистолетная рукоять и приклад
        c.fillPolygon([[24, 38], [30, 36], [28, 48], [22, 48]], RUSTED);
        c.fillRect(18, 33, 10, 5, shade(P.cloth, -0.12));
        // оптика
        c.fillRect(30, 26, 9, 4, P.steelDark);
        c.fillCircle(39.5, 28, 1.6, P.cold, 0.8);
        // предупредительная полоса
        c.fillRect(30, 31, 6, 3, P.warning, 0.85);
    },
};

