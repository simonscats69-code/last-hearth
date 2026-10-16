'use strict';

// Прочие иконки: локации карты, награды, валюта, сундук.

const { PALETTE: P, shade } = require('../draw');
const { star, dome, radiation } = require('./kit');

const WOOD = [112, 78, 46];
const COIN = [212, 178, 76];

module.exports = {
    /** Дом/убежище (Спальный район, главное убежище). */
    'loc-home'(c) {
        c.fillPolygon([[32, 12], [56, 32], [8, 32]], shade(P.rust, -0.05)); // крыша
        c.fillRect(13, 32, 38, 22, [96, 88, 72]);               // стены
        c.fillRect(28, 40, 9, 14, shade(WOOD, -0.1));           // дверь
        c.fillCircle(35, 47, 1, P.warning);
        c.fillRect(17, 36, 8, 8, P.cold, 0.7);                  // заколоченное окно
        c.drawLine(17, 36, 25, 44, 2, shade(WOOD, -0.15));
        c.drawLine(25, 36, 17, 44, 2, shade(WOOD, -0.15));
        c.fillRect(44, 16, 6, 12, P.rust);                      // труба
        c.fillCircle(47, 12, 2, P.bgLight, 0.5);                // дым
        c.fillCircle(50, 8, 1.6, P.bgLight, 0.35);
    },

    /** Рынок: палатка с товаром. */
    'loc-market'(c) {
        c.fillPolygon([[32, 12], [56, 30], [8, 30]], P.cloth);  // тент
        c.fillRect(10, 30, 44, 4, shade(WOOD, -0.05));          // стойка
        c.fillRect(12, 34, 3, 18, shade(WOOD, -0.12));
        c.fillRect(49, 34, 3, 18, shade(WOOD, -0.12));
        c.fillRect(18, 40, 28, 12, shade(WOOD, 0.04));          // ящик
        c.fillRect(18, 40, 28, 2, shade(WOOD, 0.12));
        c.fillCircle(26, 46, 3, P.warning, 0.85);               // товар
        c.fillCircle(38, 46, 3, P.blood, 0.8);
    },

    /** Больница: здание с крестом. */
    'loc-hospital'(c) {
        const HOSP = [122, 118, 104];
        c.fillRect(12, 16, 40, 40, HOSP);                       // корпус
        c.fillRect(12, 16, 40, 4, shade(HOSP, 0.1));
        for (let r = 0; r < 3; r++) {                           // окна, часть выбита
            for (let i = 0; i < 4; i++) {
                const x = 15 + i * 9.5, y = 24 + r * 9;
                if ((r + i) % 3 === 0) c.fillRect(x, y, 6, 6, P.dark, 0.85);
                else c.fillRect(x, y, 6, 6, P.cold, 0.55);
            }
        }
        c.fillRect(26, 40, 12, 4, P.blood);                     // крест
        c.fillRect(30, 36, 4, 12, P.blood);
        c.fillRect(28, 50, 8, 6, P.dark, 0.8);                  // дверь
    },

    /** Промзона: трубы с дымом. */
    'loc-industry'(c) {
        const FAC = [88, 84, 74];
        c.fillRect(8, 34, 30, 22, FAC);                         // цех
        c.fillPolygon([[8, 34], [14, 28], [20, 34], [26, 28], [32, 34]], FAC); // зубцы
        c.fillRect(40, 20, 7, 36, P.rust);                      // трубы
        c.fillRect(49, 26, 6, 30, shade(P.rust, -0.08));
        c.fillRect(39, 18, 9, 3, shade(P.rust, 0.1));
        c.fillCircle(43, 13, 3.4, P.bgLight, 0.5);              // дым
        c.fillCircle(48, 8, 2.6, P.bgLight, 0.35);
        c.fillCircle(52, 18, 3, P.bgLight, 0.45);
        c.fillRect(12, 40, 7, 8, P.dark, 0.8);                  // проёмы
        c.fillRect(23, 40, 7, 8, P.dark, 0.8);
        c.fillEllipse(24, 56, 14, 3, P.toxicDeep, 0.8);         // хим-лужа
    },

    /** Центр города: руины небоскрёбов. */
    'loc-city'(c) {
        const B = [74, 72, 66];
        c.fillRect(8, 28, 12, 28, shade(B, -0.05));             // дальний план
        c.fillRect(42, 24, 14, 32, shade(B, -0.05));
        c.fillPolygon([[22, 56], [22, 18], [26, 22], [30, 16], [34, 24], [38, 20], [38, 56]], B); // разрушенный
        for (let r = 0; r < 4; r++) {                           // выбитые окна
            for (let i = 0; i < 3; i++) {
                if ((r * 3 + i) % 4 !== 0) c.fillRect(24 + i * 5, 26 + r * 7, 3, 4, P.dark, 0.8);
            }
        }
        c.drawLine(30, 16, 32, 34, 1.4, P.dark, 0.7);           // трещина
        c.drawLine(32, 34, 28, 48, 1.4, P.dark, 0.7);
        c.drawLine(48, 24, 48, 14, 1.6, P.steelDark);           // мачта
        c.fillCircle(48, 13, 1.6, P.blood, 0.9);
    },

    /** Военная база: штаб с колючкой. */
    'loc-base'(c) {
        const CAMP = [92, 96, 84];
        dome(c, 30, 44, 20, 14, CAMP);                          // ангар-купол
        c.fillRect(10, 44, 40, 12, CAMP);
        c.fillRect(26, 44, 10, 12, P.dark, 0.85);               // ворота
        c.strokeCircle(18, 20, 5, 1, P.steelDark, 0.8);         // колючка
        c.strokeCircle(32, 16, 5, 1, P.steelDark, 0.8);
        c.strokeCircle(46, 20, 5, 1, P.steelDark, 0.8);
        c.drawLine(12, 20, 52, 20, 1, P.steelDark, 0.7);
        star(c, 30, 36, 6, 2.5, P.blood, 0.9);                  // звезда
        c.drawLine(52, 44, 52, 26, 2, P.steelDark);             // мачта
        c.fillCircle(52, 25, 1.8, P.warning, 0.9);
    },

    /** Бункер: тяжёлая дверь-люк. */
    'loc-bunker'(c) {
        c.fillCircle(32, 32, 22, shade(P.steelDark, -0.08));    // рама
        c.fillCircle(32, 32, 19, P.steelDark);
        c.fillCircle(32, 32, 15, shade(P.steel, -0.1));         // дверь
        c.drawLine(20, 32, 44, 32, 3, shade(P.steel, 0.1));     // колесо-спицы
        c.drawLine(32, 20, 32, 44, 3, shade(P.steel, 0.1));
        c.drawLine(23.5, 23.5, 40.5, 40.5, 2.4, shade(P.steel, 0.1));
        c.drawLine(40.5, 23.5, 23.5, 40.5, 2.4, shade(P.steel, 0.1));
        c.fillCircle(32, 32, 4.5, shade(P.steel, -0.2));
        c.fillCircle(32, 32, 2, P.warning, 0.9);
        for (let i = 0; i < 8; i++) {                           // болты
            const a = (i / 8) * Math.PI * 2;
            c.fillCircle(32 + Math.cos(a) * 19, 32 + Math.sin(a) * 19, 1.8, shade(P.steel, 0.2));
        }
        radiation(c, 32, 52, 4.5, P.toxic, 0.9);                // метка
    },

    /** Монета. */
    'ui-coin'(c) {
        const COIN = [212, 178, 76];
        c.fillCircle(32, 32, 16, shade(COIN, -0.1));
        c.fillCircle(32, 32, 14, COIN);
        c.fillCircle(32, 32, 10.5, shade(COIN, 0.12));
        c.fillRect(28.5, 25, 3, 14, shade(COIN, -0.28));        // «H» — Last Hearth
        c.fillRect(34.5, 25, 3, 14, shade(COIN, -0.28));
        c.fillRect(28.5, 30.5, 9, 3, shade(COIN, -0.28));
        c.fillEllipse(26, 24, 5, 3, [255, 255, 255], 0.28);     // блик
    },

    /** Звезда (валюта/награда). */
    'ui-star'(c) {
        const COIN = [212, 178, 76];
        c.fillEllipse(32, 50, 14, 3, P.dark, 0.4);              // тень
        star(c, 32, 30, 18, 8, COIN);
        star(c, 32, 30, 11, 4.6, shade(COIN, 0.18));
        c.fillCircle(32, 30, 2.4, shade(COIN, 0.35));
    },

    /** Жетон-медаль для достижений. */
    'ui-badge'(c) {
        // ленты
        c.fillPolygon([[22, 10], [30, 10], [34, 26], [26, 26]], P.blood);
        c.fillPolygon([[34, 10], [42, 10], [38, 26], [30, 26]], shade(P.blood, -0.15));
        // медальон
        c.fillCircle(32, 38, 14, shade(COIN_DARK(), -0.1));
        c.fillCircle(32, 38, 12, COIN_DARK());
        c.fillCircle(32, 38, 9, shade(COIN_DARK(), 0.12));
        star(c, 32, 38, 6.5, 2.8, shade(COIN_DARK(), -0.25));
        c.fillEllipse(27, 33, 4, 2.4, [255, 255, 255], 0.25);   // блик
    },

    /** Сундук/ящик с добычей. */
    'ui-box'(c) {
        const CRATE = [110, 84, 54];
        c.fillRect(12, 24, 40, 26, CRATE);                      // корпус
        c.fillRect(12, 24, 40, 5, shade(CRATE, 0.1));           // крышка
        // металлические полосы
        c.fillRect(12, 33, 40, 3, P.steelDark);
        c.fillRect(20, 24, 3, 26, P.steelDark);
        c.fillRect(41, 24, 3, 26, P.steelDark);
        // замок
        c.fillRoundRect(28, 36, 8, 8, 1.5, P.warning);
        c.fillCircle(32, 40, 1.6, P.dark);
        // заклёпки
        c.fillCircle(15, 27, 1, shade(P.steel, 0.2));
        c.fillCircle(49, 27, 1, shade(P.steel, 0.2));
    },

    /** Факел/пламя для достижений и эффектов. */
    'ui-flame'(c) {
        // внешнее пламя
        c.fillPolygon([[32, 10], [40, 24], [44, 34], [42, 46], [22, 46], [20, 34], [24, 24]], P.rust);
        // сердцевина
        c.fillPolygon([[32, 22], [37, 32], [38, 40], [26, 40], [27, 32]], P.warning);
        c.fillPolygon([[32, 32], [35, 38], [30, 40]], shade(P.warning, 0.3));
        // головешки
        c.fillRect(22, 46, 20, 4, shade(WOOD_BURN(), -0.05));
        c.fillRect(24, 50, 16, 3, WOOD_BURN());
    },
};

// Локальные цвета, вынесенные в функции, чтобы не плодить константы в теле
// иконок (пайлер файла выше уже использует WOOD).
function COIN_DARK() {
    return [190, 158, 70];
}
function WOOD_BURN() {
    return [70, 52, 36];
}


