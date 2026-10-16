'use strict';

// Иконки боссов: узнаваемые силуэты в постапок-палитре.
// Каждая функция рисует «содержимое» поверх готовой подложки (drawFrame).

const { PALETTE: P, shade } = require('../draw');
const { star } = require('./kit');

// Локальная палитра тварей
const FUR = [104, 88, 70];
const MUTANT = [120, 150, 60];

module.exports = {
    /** Крысиный король: крыса с короной и светящимися глазами. */
    'boss-rat'(c, random) {
        // хвост
        c.drawLine(14, 50, 22, 44, 3, shade(FUR, -0.1));
        c.drawLine(22, 44, 20, 36, 2.5, shade(FUR, -0.1));
        // тело — сгорбленная масса
        c.fillEllipse(32, 40, 17, 12, FUR);
        // голова с мордой влево
        c.fillEllipse(22, 30, 11, 9, FUR);
        c.fillPolygon([[13, 30], [7, 33], [13, 35]], shade(FUR, 0.03)); // нос
        // уши
        c.fillCircle(24, 21, 5, shade(FUR, -0.05));
        c.fillCircle(24, 21, 3, P.blood);
        // глаз — радиоактивный
        c.fillCircle(18, 29, 2.2, P.toxic);
        // зубы
        c.fillRect(8, 34, 2, 3, P.bone);
        c.fillRect(11, 34, 2, 3, P.bone);
        // корона
        c.fillPolygon([[17, 18], [20, 12], [24, 17], [27, 11], [31, 18]], P.warning);
        c.fillRect(17, 17, 14, 3, P.warning);
        // нарост на спине (мутация)
        c.fillEllipse(40, 31, 6, 5, MUTANT, 0.85);
        c.fillCircle(40, 30, 2, P.toxic, 0.9);
        return random;
    },

    /** Бездомный псих: рваный капюшон и нож. */
    'boss-psych'(c) {
        // рука с ножом (справа внизу)
        c.drawLine(44, 46, 52, 54, 5, P.skin);
        c.fillPolygon([[40, 42], [50, 52], [46, 56], [36, 46]], P.steelDark); // рукоять
        c.fillPolygon([[46, 42], [57, 30], [54, 26], [42, 39]], P.steel);      // клинок
        c.drawLine(46, 41, 56, 30, 1, shade(P.steel, 0.35));                   // режущая кромка
        // капюшон
        c.fillPolygon([[18, 54], [14, 30], [22, 16], [34, 13], [43, 22], [44, 44], [38, 54]], P.cloth);
        // лицо в тени
        c.fillEllipse(29, 28, 8, 9, shade(P.dark, 0.03));
        // безумные глаза
        c.fillCircle(25, 27, 2.4, P.bone);
        c.fillCircle(33, 27, 2.4, P.bone);
        c.fillCircle(25, 27, 1.2, P.blood);
        c.fillCircle(33, 27, 1.2, P.blood);
        // оскал
        c.fillRect(24, 34, 11, 2, P.bone, 0.9);
        c.drawLine(26, 34, 26, 36, 1, P.dark, 0.6);
        c.drawLine(30, 34, 30, 36, 1, P.dark, 0.6);
        c.drawLine(33, 34, 33, 36, 1, P.dark, 0.6);
    },

    /** Медведь-мутант: голова с клыками и наростами. */
    'boss-bear'(c) {
        // уши
        c.fillCircle(19, 20, 6, FUR);
        c.fillCircle(45, 20, 6, FUR);
        // голова
        c.fillEllipse(32, 32, 16, 15, FUR);
        // морда
        c.fillEllipse(32, 40, 9, 7, shade(FUR, 0.07));
        c.fillEllipse(32, 36, 3, 2.2, P.dark);              // нос
        // глаза — свечение мутации
        c.fillCircle(25, 28, 2.4, P.toxic);
        c.fillCircle(39, 28, 2.4, P.toxic);
        // клыки
        c.fillPolygon([[27, 44], [29, 44], [28, 49]], P.bone);
        c.fillPolygon([[35, 44], [37, 44], [36, 49]], P.bone);
        // шрам через глаз
        c.drawLine(41, 20, 37, 33, 1.6, P.blood, 0.85);
        // нарост на щеке
        c.fillCircle(45, 36, 4, MUTANT, 0.9);
        c.fillCircle(45, 36, 1.5, P.toxic);
    },

    /** Военный дрон: квадрокоптер с «глазом»-камерой. */
    'boss-drone'(c) {
        // рама
        c.drawLine(18, 24, 46, 24, 3, P.steelDark);
        // моторы с лопастями
        for (const mx of [16, 48]) {
            c.fillCircle(mx, 22, 5, P.steelDark);
            c.fillCircle(mx, 22, 2, P.bgDark);
            c.drawLine(mx - 9, 21, mx + 9, 21, 1.6, P.steel, 0.85);
            c.drawLine(mx, 14, mx, 20, 1.2, P.steel, 0.6);
        }
        // корпус
        c.fillRoundRect(22, 20, 20, 14, 4, P.steelDark);
        c.fillRoundRect(24, 22, 16, 4, 2, shade(P.steelDark, -0.08));
        // оптика — красный глаз
        c.fillCircle(32, 31, 4.5, P.bgDark);
        c.fillCircle(32, 31, 3, P.blood);
        c.fillCircle(33, 30, 1, shade(P.blood, 0.5));
        // подвесное орудие
        c.fillRect(30, 34, 4, 7, P.steelDark);
        c.fillRect(29, 40, 6, 4, P.steelDark);
        // антенна
        c.drawLine(40, 20, 44, 13, 1.4, P.steel);
        c.fillCircle(44, 13, 1.6, P.warning);
        // предупредительная полоса
        for (let i = 0; i < 4; i++) {
            c.fillRect(23 + i * 5, 37, 3, 3, i % 2 ? P.warning : P.dark, 0.8);
        }
    },

    /** Главарь мародёров: череп с банданой. */
    'boss-raider'(c) {
        // череп
        c.fillEllipse(32, 30, 14, 13, P.bone);
        c.fillRect(25, 38, 14, 8, P.bone);                    // челюсть
        // глазницы
        c.fillCircle(26, 30, 4, P.dark);
        c.fillCircle(38, 30, 4, P.dark);
        // свечение в глазницах
        c.fillCircle(26, 30, 1.8, P.warning, 0.9);
        c.fillCircle(38, 30, 1.8, P.warning, 0.9);
        // носовой треугольник
        c.fillPolygon([[32, 33], [30, 37], [34, 37]], P.dark);
        // зубы
        for (let i = 0; i < 5; i++) c.fillRect(26 + i * 2.7, 40, 1.6, 5, shade(P.bone, -0.12));
        // бандана
        c.fillRect(18, 18, 28, 6, P.blood);
        c.fillPolygon([[46, 21], [56, 26], [52, 28], [46, 25]], P.blood); // хвост банданы
        c.fillCircle(27, 21, 1.2, shade(P.blood, -0.25));
        c.fillCircle(37, 21, 1.2, shade(P.blood, -0.25));
    },

    /** Биологический ужас: масляная капля с щупальцами и глазами. */
    'boss-bio'(c, random) {
        const MUT = [92, 120, 56];
        // щупальца
        c.drawLine(18, 46, 8, 54, 4, MUT);
        c.drawLine(46, 46, 56, 54, 4, MUT);
        c.drawLine(32, 48, 32, 58, 4.5, MUT);
        c.drawLine(22, 44, 14, 50, 3, MUT);
        c.drawLine(42, 44, 50, 50, 3, MUT);
        // тело — неровная капля
        c.fillEllipse(32, 32, 17, 15, MUTANT);
        c.fillCircle(20, 24, 6, MUTANT);
        c.fillCircle(44, 25, 5, MUTANT);
        c.fillCircle(38, 19, 6, MUTANT);
        // блик
        c.fillEllipse(25, 25, 5, 3, shade(MUTANT, 0.18), 0.7);
        // глаза — куча разного размера
        c.fillCircle(26, 31, 4, P.bone);
        c.fillCircle(26, 31, 2, P.dark);
        c.fillCircle(39, 29, 3, P.bone);
        c.fillCircle(39, 29, 1.4, P.dark);
        c.fillCircle(33, 39, 2.4, P.bone);
        c.fillCircle(33, 39, 1, P.dark);
        c.fillCircle(18, 36, 2, P.bone);
        c.fillCircle(18, 36, 0.9, P.dark);
        // язвы
        c.fillCircle(42, 38, 2.6, P.blood, 0.85);
        c.fillCircle(24, 42, 2, P.blood, 0.85);
        void random;
    },

    /** Офицер-нежить: каска, мёртвое лицо, погоны. */
    'boss-officer'(c) {
        const DEAD = [126, 138, 104];
        // кепка/фуражка
        c.fillRect(17, 15, 30, 7, P.cloth);
        c.fillRect(15, 21, 34, 3, shade(P.cloth, -0.12));
        star(c, 32, 18.5, 4, 1.7, P.blood);
        // лицо
        c.fillEllipse(32, 33, 11, 11, DEAD);
        // провалы глаз
        c.fillCircle(27, 32, 3, P.dark);
        c.fillCircle(37, 32, 3, P.dark);
        c.fillCircle(27, 32, 1.2, P.toxic, 0.9);
        c.fillCircle(37, 32, 1.2, P.toxic, 0.9);
        // рот-провал
        c.fillEllipse(32, 41, 5, 3, P.dark);
        c.fillRect(29, 39.5, 1.5, 2.5, P.bone, 0.8);
        c.fillRect(33, 39.5, 1.5, 2.5, P.bone, 0.8);
        // погоны внизу
        c.fillRect(14, 48, 36, 8, shade(P.cloth, -0.05));
        c.fillRect(16, 48, 8, 3, P.warning);
        c.fillRect(40, 48, 8, 3, P.warning);
        // орден — черепушка
        c.fillCircle(24, 52, 2, P.bone);
    },

    /** Гигантский монстр: рептилья с шипами. */
    'boss-monster'(c) {
        const SCALE = [86, 108, 62];
        // хвост
        c.drawLine(10, 50, 20, 42, 5, SCALE);
        // тело
        c.fillEllipse(34, 40, 15, 11, SCALE);
        // шипы на спине
        for (let i = 0; i < 4; i++) {
            const bx = 22 + i * 8;
            c.fillPolygon([[bx, 32 - i], [bx + 3, 22 - i * 1.5], [bx + 6, 32 - i]], shade(SCALE, 0.1));
        }
        // голова
        c.fillEllipse(44, 27, 11, 8, SCALE);
        c.fillPolygon([[53, 24], [62, 26], [53, 31]], SCALE);   // морда
        // челюсть
        c.fillPolygon([[46, 32], [60, 29], [58, 33], [47, 35]], shade(SCALE, -0.08));
        for (let i = 0; i < 4; i++) c.fillRect(49 + i * 3, 30.5, 1.4, 2.5, P.bone);
        // глаз
        c.fillCircle(46, 24, 2.4, P.warning);
        c.fillCircle(46, 24, 1.1, P.dark);
        // ноги
        c.fillRect(26, 47, 6, 9, SCALE);
        c.fillRect(38, 47, 6, 9, SCALE);
        c.fillRect(25, 54, 8, 3, shade(SCALE, -0.1));
        c.fillRect(37, 54, 8, 3, shade(SCALE, -0.1));
    },

    /** Профессор безумия: защитные очки и пробирка. */
    'boss-professor'(c) {
        const COAT = [196, 192, 176];
        // халат
        c.fillPolygon([[16, 56], [20, 40], [44, 40], [48, 56]], COAT);
        c.drawLine(32, 41, 32, 56, 1.5, shade(COAT, -0.18));
        // галстук/загрязнение
        c.fillRect(28, 42, 3, 8, P.toxic, 0.6);
        // голова
        c.fillEllipse(32, 28, 10, 11, P.skin);
        // дикие волосы
        for (let i = 0; i < 6; i++) {
            const a = -2.4 + i * 0.4;
            c.drawLine(32 + Math.cos(a) * 8, 24 + Math.sin(a) * 8,
                32 + Math.cos(a) * 15, 24 + Math.sin(a) * 15, 2, shade(P.bone, -0.05));
        }
        // очки — тёмные линзы с зелёным бликом
        c.fillCircle(27, 27, 4.5, P.dark);
        c.fillCircle(37, 27, 4.5, P.dark);
        c.fillCircle(27, 27, 3, P.toxicDeep, 0.8);
        c.fillCircle(37, 27, 3, P.toxicDeep, 0.8);
        c.drawLine(31.5, 27, 32.5, 27, 1.5, P.dark);
        // оскал
        c.fillRect(27, 34, 10, 2, P.bone, 0.9);
        // пробирка в руке
        c.fillRect(44, 44, 5, 13, shade(P.cold, 0.3), 0.8);
        c.fillRect(44, 50, 5, 7, P.toxic, 0.95);
        c.fillRect(43, 43, 7, 2.5, P.steelDark);
    },

    /** Последний страж: рыцарь-бункерщик со щитом. */
    'boss-warden'(c) {
        // щит за спиной
        c.fillPolygon([[32, 8], [52, 16], [48, 42], [32, 54]], shade(P.steelDark, -0.06));
        c.fillPolygon([[32, 12], [48, 18], [45, 40], [32, 50]], P.steelDark);
        star(c, 39, 30, 8, 3.4, P.warning);
        // корпус в доспехе
        c.fillRoundRect(12, 22, 26, 32, 5, P.steel);
        c.fillRect(12, 30, 26, 3, shade(P.steel, -0.15));     // сегменты
        c.fillRect(12, 38, 26, 3, shade(P.steel, -0.15));
        c.fillRect(12, 46, 26, 3, shade(P.steel, -0.15));
        // шлем с прорезью
        c.fillRoundRect(16, 10, 18, 16, 6, shade(P.steel, 0.05));
        c.fillRect(20, 17, 10, 3, P.dark);
        c.fillCircle(22, 18.5, 1, P.toxic);
        c.fillCircle(28, 18.5, 1, P.toxic);
        // заклёпки
        for (let i = 0; i < 3; i++) c.fillCircle(15, 26 + i * 8, 1.2, shade(P.steel, 0.2));
    },
};


