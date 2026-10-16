'use strict';

// Иконки брони и одежды. Используют общие формы из kit.js
// (torso/glove/boot/pants/dome), чтобы набор выглядел единым.

const { PALETTE: P, shade } = require('../draw');
const { torso, pants, glove, boot, dome, star } = require('./kit');

const LEATHER = [104, 72, 46];
const MILITARY = [86, 96, 64];
const STALKER = [76, 84, 74];
const MEDICAL = [186, 182, 168];

module.exports = {
    /** Кожаная куртка. */
    'arm-jacket'(c) {
        torso(c, LEATHER, { collar: true, zipper: true });
        // потёртости на локтях
        c.fillEllipse(15, 40, 3, 4, shade(LEATHER, 0.08), 0.7);
        c.fillEllipse(49, 40, 3, 4, shade(LEATHER, 0.08), 0.7);
    },

    /** Бронежилет: пластины + молния. */
    'arm-vest'(c) {
        torso(c, MILITARY, { zipper: true, trim: P.warning });
        // плиты
        c.fillRect(18, 26, 12, 10, shade(MILITARY, 0.06));
        c.fillRect(34, 26, 12, 10, shade(MILITARY, 0.06));
        c.fillRect(18, 38, 28, 8, shade(MILITARY, 0.04));
        // кевлар-полосы
        for (let i = 0; i < 3; i++) c.drawLine(19, 28 + i * 4, 29, 28 + i * 4, 1, shade(MILITARY, -0.12), 0.7);
    },

    /** Армейская каска. */
    'arm-helmet'(c) {
        dome(c, 32, 36, 20, 18, MILITARY);                      // купол
        c.fillRect(12, 36, 40, 4, shade(MILITARY, -0.1));       // тень снизу
        c.fillEllipse(32, 38, 21, 5, shade(MILITARY, -0.06));   // козырёк
        c.drawLine(18, 42, 26, 50, 2, P.cloth, 0.8);            // ремешки
        c.drawLine(46, 42, 38, 50, 2, P.cloth, 0.8);
        star(c, 32, 26, 5, 2, shade(MILITARY, 0.2));            // маркировка
        c.drawLine(22, 22, 30, 18, 1, shade(MILITARY, 0.15), 0.8); // царапина
    },

    /** Перчатки (военные/медицинские/сталкерские — параметр цвета). */
    'arm-gloves'(c) {
        glove(c, MILITARY, { cuff: shade(MILITARY, -0.16) });
        c.fillRect(25, 24, 14, 6, shade(MILITARY, 0.07));       // защитная пластина
    },

    /** Ботинки. */
    'arm-boots'(c) {
        boot(c, shade(LEATHER, 0.02));
        c.fillRect(18, 12, 16, 4, shade(LEATHER, 0.06));        // берцы
    },

    /** Джинсы/штаны. */
    'arm-pants'(c) {
        pants(c, [66, 78, 96], { belt: shade(LEATHER, -0.05), patch: [56, 66, 82] });
    },

    /** Противогаз: маска с фильтром. */
    'arm-gasmask'(c) {
        c.fillEllipse(32, 30, 14, 15, shade(MILITARY, -0.04));  // корпус маски
        c.fillCircle(26, 28, 5.5, P.dark);                      // очки
        c.fillCircle(38, 28, 5.5, P.dark);
        c.fillCircle(26, 28, 4, P.cold, 0.75);
        c.fillCircle(38, 28, 4, P.cold, 0.75);
        c.fillCircle(24.5, 26.5, 1.4, shade(P.cold, 0.4), 0.8); // блики
        c.fillCircle(36.5, 26.5, 1.4, shade(P.cold, 0.4), 0.8);
        c.fillRect(26, 42, 12, 10, P.steelDark);                // фильтр
        c.fillEllipse(32, 52, 6, 3, shade(P.steelDark, -0.08));
        for (let i = 0; i < 3; i++) c.fillRect(28, 44 + i * 3, 8, 1.5, P.dark, 0.7);
        c.drawLine(19, 24, 14, 32, 2, P.cloth, 0.8);            // лямки
        c.drawLine(45, 24, 50, 32, 2, P.cloth, 0.8);
    },

    /** Медицинский халат. */
    'arm-labcoat'(c) {
        torso(c, MEDICAL, { collar: true, zipper: true });
        // красный крест на груди
        c.fillRect(37, 28, 8, 2.6, P.blood);
        c.fillRect(39.7, 25.5, 2.6, 8, P.blood);
        // карман с ручкой
        c.fillRect(17, 40, 8, 7, shade(MEDICAL, -0.08));
        c.fillRect(20, 38, 1.4, 4, P.cold, 0.8);
    },

    /** Медицинский рюкзак. */
    'arm-medbag'(c) {
        c.fillRoundRect(16, 20, 32, 34, 6, MILITARY);           // корпус
        c.fillRoundRect(16, 20, 32, 12, 5, shade(MILITARY, 0.05)); // клапан
        c.fillRect(16, 30, 32, 3, shade(MILITARY, -0.1));
        c.fillRect(24, 29, 4, 5, P.steelDark);                  // застёжки
        c.fillRect(36, 29, 4, 5, P.steelDark);
        c.fillRoundRect(42, 36, 10, 14, 3, shade(MILITARY, -0.06)); // боковой карман
        c.fillRect(28, 38, 10, 3, P.blood);                     // крест
        c.fillRect(31.5, 34.5, 3, 10, P.blood);
        c.strokeCircle(32, 20, 7, 2.4, shade(MILITARY, -0.1));  // ручка
    },

    /** Сталкерский плащ с капюшоном. */
    'arm-coat'(c) {
        c.fillPolygon([[20, 24], [44, 24], [52, 56], [12, 56]], STALKER); // полы
        dome(c, 32, 26, 13, 12, shade(STALKER, -0.05));        // капюшон
        c.fillEllipse(32, 26, 9, 7, P.dark, 0.85);              // тень лица
        c.fillPolygon([[22, 44], [26, 50], [21, 52]], shade(STALKER, 0.1)); // рваные края
        c.fillPolygon([[44, 48], [48, 44], [49, 52]], shade(STALKER, 0.1));
        c.fillRect(36, 34, 7, 5, shade(STALKER, 0.12));         // нашивка
        c.drawLine(36, 36.5, 43, 36.5, 1, shade(STALKER, -0.14));
        c.fillRect(17, 42, 30, 4, shade(LEATHER, -0.03));       // пояс
        c.fillRect(29, 41, 6, 6, P.steelDark);
    },

    /** Сталкерский пояс с компасом. */
    'arm-belt'(c) {
        c.fillRect(10, 28, 44, 8, shade(LEATHER, -0.02));       // ремень
        for (let i = 0; i < 5; i++) c.fillCircle(14 + i * 9, 32, 1.2, shade(LEATHER, -0.18));
        c.fillRoundRect(26, 26, 12, 12, 2, P.steelDark);        // пряжка
        c.fillRect(30, 29, 4, 6, P.bgDark);
        c.fillRoundRect(42, 36, 10, 12, 2, shade(LEATHER, -0.06)); // подсумок
        c.fillRect(42, 36, 10, 3, shade(LEATHER, -0.12));
        c.fillCircle(18, 44, 8, P.steelDark);                   // компас
        c.fillCircle(18, 44, 6, P.bone);
        c.fillPolygon([[18, 40], [19.5, 44.5], [18, 44], [16.5, 44.5]], P.blood);
        c.fillCircle(18, 44, 1, P.dark);
    },

    /** Бандитская бандана (лицо). */
    'arm-bandana'(c) {
        c.fillEllipse(32, 30, 13, 14, P.skin);                  // лицо
        c.fillEllipse(32, 30, 13, 14, shade(P.dark, 0.02), 0.35);
        c.fillCircle(26, 26, 2.6, P.dark);                      // глаза
        c.fillCircle(38, 26, 2.6, P.dark);
        c.fillPolygon([[19, 32], [45, 32], [42, 46], [32, 50], [22, 46]], P.blood); // бандана
        c.fillCircle(46, 34, 3.4, P.blood);                     // узел
        c.fillPolygon([[48, 36], [56, 42], [52, 44], [46, 38]], P.blood);
        c.fillCircle(26, 40, 1.6, shade(P.blood, -0.25));       // узор
        c.fillCircle(32, 42, 1.6, shade(P.blood, -0.25));
        c.fillCircle(38, 40, 1.6, shade(P.blood, -0.25));
        c.fillRect(19, 15, 26, 5, shade(P.blood, -0.05));       // повязка на лбу
    },

    /** Экзо-костюм: механический торс с сервоприводами. */
    'arm-exo'(c) {
        torso(c, P.steelDark, { trim: P.warning });
        c.fillCircle(15, 24, 5, P.steel);                       // сервомоторы
        c.fillCircle(49, 24, 5, P.steel);
        c.fillCircle(15, 24, 2, P.dark);
        c.fillCircle(49, 24, 2, P.dark);
        c.fillRect(20, 26, 10, 9, shade(P.steelDark, 0.07));    // пластины
        c.fillRect(34, 26, 10, 9, shade(P.steelDark, 0.07));
        c.fillRect(22, 38, 20, 10, shade(P.steelDark, 0.04));
        c.fillCircle(32, 42, 4, P.toxicDeep);                   // энергоядро
        c.fillCircle(32, 42, 2.4, P.toxic);
        c.drawLine(14, 30, 16, 48, 2.5, P.steel, 0.8);          // гидравлика
        c.drawLine(50, 30, 48, 48, 2.5, P.steel, 0.8);
    },

    /** Броня стражей: тяжёлый доспех с короной. */
    'arm-guard'(c) {
        torso(c, shade(P.steel, 0.06), { trim: P.warning });
        c.fillCircle(14, 24, 6, shade(P.steel, -0.05));         // наплечники
        c.fillCircle(50, 24, 6, shade(P.steel, -0.05));
        c.fillPolygon([[24, 26], [40, 26], [42, 40], [32, 46], [22, 40]], shade(P.steel, 0.12)); // нагрудник
        c.fillPolygon([[26, 36], [26, 30], [29, 33], [32, 28], [35, 33], [38, 30], [38, 36]], P.warning); // корона
        c.fillRect(26, 36, 12, 2, P.warning);
        for (let i = 0; i < 4; i++) c.fillCircle(15 + i * 11.5, 50, 1.3, shade(P.steel, 0.25)); // заклёпки
        c.fillRect(14, 50, 36, 4, shade(P.steel, -0.14));
    },
};

