'use strict';

// Боссы 256x256. Координаты — ПРЯМЫЕ пиксели 0..256, без множителя:
// fillEllipse(cx,cy,RX,RY) и fillCircle(x,y,R) берут РАДИУСЫ.
// Фигуры занимают 80-90% кадра (поля ~20px).

const { PALETTE: P, shade } = require('../draw');
const { star } = require('./kit');
const { fur, scales, rustStreaks, glow, tear } = require('./boss-brushes');

const FUR = [104, 88, 70];
const MUT = [120, 150, 60];

module.exports = {
    /** Крысиный король: огромная крыса с короной. */
    'boss-rat'(c, random) {
        c.fillEllipse(128, 222, 92, 18, P.dark, 0.35);
        c.drawLine(36, 208, 82, 172, 11, shade(FUR, -0.15));
        c.drawLine(82, 172, 74, 138, 9, shade(FUR, -0.15));
        c.fillEllipse(134, 168, 86, 62, FUR);
        fur(c, 58, 112, 152, 112, FUR, random, { density: 0.012, length: 7 });
        c.fillEllipse(98, 102, 62, 54, FUR);
        fur(c, 44, 56, 108, 88, FUR, random, { density: 0.014, length: 6 });
        c.fillPolygon([[50, 96], [28, 106], [50, 118]], shade(FUR, 0.05));
        c.fillCircle(80, 108, 4, P.dark);
        c.fillCircle(96, 54, 24, shade(FUR, -0.05));
        c.fillCircle(96, 54, 14, P.blood);
        c.fillCircle(140, 58, 18, shade(FUR, -0.05));
        c.fillCircle(140, 58, 10, P.blood);
        glow(c, 78, 96, 20, P.toxic, 0.5);
        c.fillCircle(78, 96, 11, P.toxic);
        c.fillCircle(80, 94, 5, P.bone);
        c.fillCircle(120, 94, 8, P.toxic);
        c.fillCircle(121, 93, 3, P.bone);
        c.fillRect(32, 116, 10, 16, P.bone);
        c.fillRect(46, 116, 10, 16, P.bone);
        c.drawLine(32, 124, 62, 124, 2, P.dark, 0.5);
        c.fillPolygon([[66, 52], [82, 20], [99, 48], [116, 18], [132, 50]], P.warning);
        c.fillRect(66, 46, 66, 15, P.warning);
        c.fillRect(66, 46, 66, 4, shade(P.warning, 0.2));
        c.fillCircle(82, 20, 4, P.blood);
        c.fillCircle(116, 18, 4, P.blood);
        c.fillEllipse(196, 132, 30, 26, MUT, 0.95);
        fur(c, 170, 108, 52, 48, MUT, random, { density: 0.012, length: 5 });
        c.fillCircle(196, 128, 11, P.toxic, 0.95);
        glow(c, 196, 128, 22, P.toxic, 0.4);
    },

    /** Бездомный псих: капюшон + огромный нож. */
    'boss-psych'(c, random) {
        c.drawLine(172, 190, 214, 224, 24, P.skin);
        c.fillPolygon([[156, 168], [202, 214], [184, 232], [138, 186]], P.steelDark);
        c.fillRect(168, 178, 18, 14, shade(P.steelDark, -0.15));
        c.fillPolygon([[186, 170], [240, 112], [226, 98], [172, 156]], P.steel);
        c.drawLine(188, 164, 234, 112, 5, shade(P.steel, 0.35));
        c.fillCircle(222, 128, 5, P.blood, 0.85);
        c.fillCircle(228, 148, 3, P.blood, 0.7);
        c.fillPolygon([[48, 232], [32, 118], [66, 52], [128, 32], [186, 66], [196, 170], [168, 232]], P.cloth);
        c.fillPolygon([[48, 232], [32, 118], [52, 80], [60, 130], [56, 200], [60, 232]], shade(P.cloth, -0.12));
        c.fillPolygon([[196, 170], [186, 66], [172, 100], [180, 160], [168, 232]], shade(P.cloth, -0.12));
        c.fillEllipse(116, 118, 40, 46, shade(P.dark, 0.04));
        glow(c, 98, 110, 18, P.bone, 0.45);
        c.fillCircle(98, 110, 12, P.bone);
        c.fillCircle(98, 110, 6, P.blood);
        c.fillCircle(98, 110, 2, P.dark);
        glow(c, 136, 110, 18, P.bone, 0.45);
        c.fillCircle(136, 110, 12, P.bone);
        c.fillCircle(136, 110, 6, P.blood);
        c.fillCircle(136, 110, 2, P.dark);
        c.drawLine(98, 122, 94, 142, 4, P.blood, 0.7);
        c.drawLine(136, 122, 140, 142, 4, P.blood, 0.7);
        c.fillRect(92, 148, 52, 12, P.bone, 0.95);
        for (let i = 0; i < 5; i++) c.drawLine(100 + i * 10, 148, 100 + i * 10, 160, 4, P.dark, 0.7);
        tear(c, 36, 100, 60, 190, 4, P.cloth, random);
        tear(c, 192, 90, 200, 150, 4, P.cloth, random);
        fur(c, 60, 60, 120, 60, P.cloth, random, { density: 0.008, length: 5 });
    },

    /** Медведь-мутант: морда на весь кадр. */
    'boss-bear'(c, random) {
        c.fillEllipse(128, 224, 92, 18, P.dark, 0.35);
        c.fillCircle(48, 62, 30, FUR);
        c.fillCircle(48, 62, 15, shade(FUR, -0.12));
        c.fillCircle(208, 62, 30, FUR);
        c.fillCircle(208, 62, 15, shade(FUR, -0.12));
        fur(c, 22, 36, 52, 48, FUR, random, { density: 0.015, length: 9 });
        fur(c, 182, 36, 52, 48, FUR, random, { density: 0.015, length: 9 });
        c.fillEllipse(128, 138, 88, 82, FUR);
        fur(c, 50, 66, 156, 140, FUR, random, { density: 0.012, length: 8 });
        c.fillEllipse(128, 180, 52, 40, shade(FUR, 0.1));
        c.fillEllipse(128, 158, 20, 13, P.dark);
        c.fillCircle(121, 155, 4, shade(P.dark, 0.3));
        c.drawLine(128, 171, 128, 182, 4, P.dark, 0.8);
        glow(c, 88, 118, 22, P.toxic, 0.55);
        c.fillCircle(88, 118, 13, P.toxic);
        c.fillCircle(90, 116, 6, P.bone);
        c.fillCircle(89, 117, 3, P.dark);
        glow(c, 168, 118, 22, P.toxic, 0.55);
        c.fillCircle(168, 118, 13, P.toxic);
        c.fillCircle(170, 116, 6, P.bone);
        c.fillCircle(169, 117, 3, P.dark);
        c.fillPolygon([[100, 196], [116, 196], [108, 224]], P.bone);
        c.fillPolygon([[140, 196], [156, 196], [148, 224]], P.bone);
        c.fillRect(116, 192, 24, 8, P.dark, 0.85);
        c.drawLine(182, 66, 158, 140, 9, P.blood, 0.9);
        c.drawLine(182, 66, 158, 140, 3, shade(P.blood, -0.2), 0.9);
        c.fillCircle(200, 164, 24, MUT, 0.95);
        c.fillCircle(200, 164, 10, P.toxic);
        glow(c, 200, 164, 26, P.toxic, 0.4);
    },

    /** Военный дрон: квадрокоптер на весь кадр. */
    'boss-drone'(c, random) {
        c.fillEllipse(128, 214, 100, 16, P.dark, 0.35);
        // лучи рамы
        c.drawLine(52, 96, 120, 130, 15, P.steelDark);
        c.drawLine(204, 96, 136, 130, 15, P.steelDark);
        c.drawLine(52, 96, 204, 96, 13, P.steelDark);
        rustStreaks(c, 40, 80, 176, 30, P.steelDark, random);
        // моторы — крупные
        for (const mx of [44, 212]) {
            c.fillCircle(mx, 88, 26, P.steelDark);
            c.fillCircle(mx, 88, 18, shade(P.steelDark, 0.1));
            c.fillCircle(mx, 88, 9, P.bgDark);
            c.drawLine(mx - 52, 80, mx + 52, 80, 6, P.steel, 0.85);
            c.drawLine(mx - 52, 92, mx + 52, 92, 4, shade(P.steel, -0.1), 0.6);
            c.fillEllipse(mx, 88, 52, 7, shade(P.steelDark, -0.1), 0.5);
            c.fillCircle(mx, 88, 3, P.warning);
        }
        // корпус — широкий
        c.fillRoundRect(72, 96, 112, 76, 22, P.steelDark);
        c.fillRoundRect(84, 106, 88, 22, 11, shade(P.steelDark, 0.08));
        c.drawLine(72, 130, 184, 130, 3, shade(P.steelDark, -0.2), 0.7);
        // красная оптика — большая
        glow(c, 128, 148, 30, P.blood, 0.4);
        c.fillCircle(128, 148, 24, P.bgDark);
        c.fillCircle(128, 148, 17, P.blood);
        c.fillCircle(134, 142, 6, shade(P.blood, 0.5));
        // подвес
        c.fillRect(116, 172, 24, 24, P.steelDark);
        c.fillRect(108, 192, 40, 20, P.steelDark);
        c.fillRect(108, 192, 40, 5, shade(P.steelDark, 0.1));
        // антенна
        c.drawLine(172, 96, 192, 56, 7, P.steel);
        c.fillCircle(194, 52, 9, P.warning);
        glow(c, 194, 52, 16, P.warning, 0.35);
        // предупреждение
        for (let i = 0; i < 5; i++) c.fillRect(80 + i * 20, 176, 14, 14, i % 2 ? P.warning : P.dark, 0.9);
    },

    /** Главарь мародёров: череп на весь кадр. */
    'boss-raider'(c, random) {
        c.fillEllipse(128, 222, 80, 16, P.dark, 0.35);
        // череп — огромный
        c.fillEllipse(128, 132, 74, 70, P.bone);
        c.fillRect(86, 172, 84, 48, P.bone);
        c.fillRect(86, 204, 84, 16, shade(P.bone, -0.08));
        // трещины
        c.drawLine(128, 66, 128, 110, 3, shade(P.bone, -0.2), 0.7);
        c.drawLine(100, 80, 116, 100, 2, shade(P.bone, -0.2), 0.6);
        // глазницы — глубокие
        c.fillCircle(94, 128, 22, P.dark);
        c.fillCircle(162, 128, 22, P.dark);
        glow(c, 94, 128, 26, P.warning, 0.35);
        glow(c, 162, 128, 26, P.warning, 0.35);
        c.fillCircle(94, 128, 10, P.warning, 0.95);
        c.fillCircle(162, 128, 10, P.warning, 0.95);
        c.fillCircle(94, 128, 4, P.dark);
        c.fillCircle(162, 128, 4, P.dark);
        // нос
        c.fillPolygon([[128, 144], [118, 164], [138, 164]], P.dark);
        // зубы — крупные
        for (let i = 0; i < 6; i++) {
            c.fillRect(90 + i * 13, 180, 9, 30, shade(P.bone, -0.1));
            c.drawLine(90 + i * 13, 180, 90 + i * 13, 210, 2, P.dark, 0.5);
        }
        c.drawLine(88, 180, 168, 180, 3, P.dark, 0.6);
        // бандана
        c.fillRect(54, 58, 148, 34, P.blood);
        c.fillRect(54, 58, 148, 8, shade(P.blood, 0.15));
        c.fillPolygon([[202, 68], [240, 92], [222, 102], [202, 88]], P.blood);
        c.fillPolygon([[54, 70], [24, 96], [40, 104], [54, 88]], P.blood);
        c.fillCircle(100, 75, 6, shade(P.blood, -0.25));
        c.fillCircle(156, 75, 6, shade(P.blood, -0.25));
        rustStreaks(c, 70, 100, 116, 60, P.bone, random);
    },

    /** Биологический ужас: капля со щупальцами на весь кадр. */
    'boss-bio'(c, random) {
        // щупальца вниз
        for (let i = 0; i < 6; i++) {
            const bx = 48 + i * 32;
            c.drawLine(bx, 150, bx - 14 + (i % 3) * 14, 228, 17 - (i % 2) * 4, MUT);
            c.fillCircle(bx - 14 + (i % 3) * 14, 228, 9, shade(MUT, -0.1));
            for (let s = 0; s < 3; s++) c.fillCircle(bx - s * 3, 170 + s * 20, 3, shade(MUT, 0.15));
        }
        // боковые щупальца
        c.drawLine(52, 120, 18, 170, 15, MUT);
        c.drawLine(204, 120, 238, 170, 15, MUT);
        c.fillCircle(18, 170, 9, shade(MUT, -0.1));
        c.fillCircle(238, 170, 9, shade(MUT, -0.1));
        // тело-капля — большое
        c.fillEllipse(128, 108, 84, 76, MUT);
        fur(c, 54, 42, 148, 128, MUT, random, { density: 0.01, length: 6 });
        c.fillEllipse(128, 130, 60, 50, shade(MUT, 0.08));
        // главный глаз — огромный
        glow(c, 128, 100, 34, P.warning, 0.4);
        c.fillCircle(128, 100, 28, P.bone);
        c.fillCircle(128, 100, 18, P.warning);
        c.fillCircle(128, 100, 9, P.dark);
        c.fillCircle(133, 94, 4, P.bone);
        // малые глаза
        const eyes = [[78, 80, 11], [178, 80, 11], [66, 130, 9], [190, 130, 9], [100, 150, 8], [156, 150, 8]];
        for (const [ex, ey, er] of eyes) {
            c.fillCircle(ex, ey, er, P.bone);
            c.fillCircle(ex, ey, er * 0.55, P.blood);
            c.fillCircle(ex, ey, er * 0.25, P.dark);
        }
        // язвы со свечением
        const sores = [[90, 60, 8], [166, 62, 8], [150, 140, 7]];
        for (const [sx, sy, sr] of sores) {
            c.fillCircle(sx, sy, sr, P.toxic, 0.9);
            glow(c, sx, sy, sr + 8, P.toxic, 0.35);
        }
        // пасть
        c.fillEllipse(128, 168, 26, 12, P.dark, 0.9);
        for (let i = 0; i < 4; i++) c.fillRect(110 + i * 10, 160, 5, 12, P.bone);
    },

    /** Офицер-нежить: фуражка + мёртвое лицо. */
    'boss-officer'(c) {
        c.fillEllipse(128, 224, 84, 16, P.dark, 0.35);
        // плечи шинели
        c.fillPolygon([[40, 232], [52, 168], [204, 168], [216, 232]], shade(P.cloth, -0.08));
        c.fillRect(52, 168, 152, 12, shade(P.cloth, -0.15));
        // воротник
        c.fillPolygon([[96, 168], [128, 200], [160, 168]], shade(P.cloth, -0.2));
        // лицо — большое
        c.fillEllipse(128, 118, 58, 62, P.skin);
        c.fillEllipse(128, 118, 58, 62, P.dark, 0.25); // мертвенная бледность
        // провалы глаз
        c.fillEllipse(102, 112, 18, 22, P.dark);
        c.fillEllipse(154, 112, 18, 22, P.dark);
        glow(c, 102, 112, 14, P.toxic, 0.4);
        glow(c, 154, 112, 14, P.toxic, 0.4);
        c.fillCircle(102, 112, 7, P.toxic);
        c.fillCircle(154, 112, 7, P.toxic);
        // скулы и рот
        c.drawLine(100, 150, 156, 150, 5, P.dark, 0.8);
        c.drawLine(110, 132, 98, 148, 3, shade(P.skin, -0.2), 0.6);
        c.drawLine(146, 132, 158, 148, 3, shade(P.skin, -0.2), 0.6);
        // фуражка — широкая
        c.fillEllipse(128, 62, 78, 20, P.dark);
        c.fillRect(54, 40, 148, 26, P.dark);
        c.fillRect(54, 60, 148, 8, shade(P.blood, -0.1));
        c.fillRect(54, 40, 148, 6, shade(P.dark, 0.15));
        star(c, 128, 53, 14, 6, P.warning);
        c.fillCircle(128, 53, 3, P.blood);
        // кокарда-блик
        c.fillCircle(124, 50, 3, shade(P.warning, 0.4));
        // погоны
        c.fillRect(48, 176, 44, 14, P.warning);
        c.fillRect(164, 176, 44, 14, P.warning);
        c.fillRect(48, 176, 44, 4, shade(P.warning, 0.2));
        c.fillRect(164, 176, 44, 4, shade(P.warning, 0.2));
        // орден-череп
        c.fillCircle(88, 210, 10, P.bone);
        c.fillCircle(84, 208, 3, P.dark);
        c.fillCircle(92, 208, 3, P.dark);
    },

    /** Гигантский монстр: рептилия с шипами. */
    'boss-monster'(c) {
        const SCALE = [86, 108, 62];
        const BELLY = [150, 162, 110];
        c.fillEllipse(128, 228, 84, 14, P.dark, 0.35); // тень
        // хвост влево — толстый, с шипом на конце
        c.drawLine(40, 190, 86, 160, 26, SCALE);
        c.fillPolygon([[40, 190], [14, 200], [36, 208]], shade(SCALE, -0.1));
        // ноги — колонны с когтями
        c.fillRect(86, 176, 34, 48, SCALE);
        c.fillRect(140, 176, 34, 48, SCALE);
        c.fillRect(78, 216, 50, 14, shade(SCALE, -0.12));
        c.fillRect(132, 216, 50, 14, shade(SCALE, -0.12));
        for (let t = 0; t < 3; t++) {
            c.fillPolygon([[86 + t * 14, 230], [92 + t * 14, 220], [98 + t * 14, 230]], P.bone);
            c.fillPolygon([[138 + t * 14, 230], [144 + t * 14, 220], [150 + t * 14, 230]], P.bone);
        }
        // тело — вертикальная масса
        c.fillEllipse(130, 148, 66, 58, SCALE);
        // светлое брюхо с сегментами
        c.fillEllipse(130, 166, 44, 42, BELLY);
        for (let i = 0; i < 4; i++) c.drawLine(92, 140 + i * 16, 168, 140 + i * 16, 3, shade(BELLY, -0.15), 0.7);
        // шипы вдоль спины слева — 4 крупных, костяные с тёмной окантовкой
        const spikes = [[58, 130], [52, 100], [58, 70], [74, 44]];
        for (const [sx, sy] of spikes) {
            c.fillPolygon([[sx - 2, sy + 28], [sx + 13, sy - 16], [sx + 28, sy + 28]], shade(SCALE, -0.2));
            c.fillPolygon([[sx, sy + 24], [sx + 13, sy - 10], [sx + 26, sy + 24]], P.bone);
            c.drawLine(sx + 13, sy - 10, sx + 13, sy + 24, 2, shade(P.bone, -0.2), 0.6);
        }
        // голова — сверху справа, с мордой
        c.fillEllipse(168, 78, 46, 36, SCALE);
        c.fillPolygon([[204, 60], [240, 72], [206, 90]], SCALE); // морда
        c.fillCircle(228, 74, 4, P.dark); // ноздря
        // нижняя челюсть открыта
        c.fillPolygon([[172, 100], [236, 88], [228, 108], [178, 116]], shade(SCALE, -0.12));
        for (let i = 0; i < 5; i++) {
            c.fillRect(184 + i * 10, 94, 6, 14, P.bone); // верхние зубы
            c.fillRect(186 + i * 10, 108, 5, 9, P.bone); // нижние зубы
        }
        c.fillEllipse(204, 112, 16, 6, P.blood, 0.8); // пасть
        // глаз со свечением — крупный
        glow(c, 168, 68, 24, P.warning, 0.45);
        c.fillCircle(168, 68, 16, P.warning);
        c.fillCircle(168, 68, 8, P.dark);
        c.fillCircle(171, 65, 3, P.bone);
        // шрамы на теле
        c.drawLine(100, 130, 116, 160, 3, shade(SCALE, -0.25), 0.8);
        c.drawLine(150, 150, 160, 176, 3, shade(SCALE, -0.25), 0.8);
    },

    /** Профессор безумия: очки + пробирка. */
    'boss-professor'(c) {
        const COAT = [196, 192, 176];
        c.fillEllipse(128, 228, 76, 14, P.dark, 0.35);
        // халат — широкий
        c.fillPolygon([[52, 232], [72, 156], [184, 156], [204, 232]], COAT);
        c.fillPolygon([[52, 232], [72, 156], [88, 156], [80, 232]], shade(COAT, -0.1));
        c.fillPolygon([[204, 232], [184, 156], [168, 156], [176, 232]], shade(COAT, -0.1));
        c.drawLine(128, 160, 128, 232, 6, shade(COAT, -0.18));
        // загрязнение
        c.fillRect(104, 164, 16, 40, P.toxic, 0.65);
        c.fillCircle(112, 204, 6, P.toxic, 0.65);
        // карман
        c.fillRect(152, 190, 28, 20, shade(COAT, -0.12));
        // голова — крупная
        c.fillEllipse(128, 108, 48, 52, P.skin);
        // уши
        c.fillCircle(80, 108, 10, shade(P.skin, -0.08));
        c.fillCircle(176, 108, 10, shade(P.skin, -0.08));
        // дикие волосы
        for (let i = 0; i < 8; i++) {
            const a = -2.6 + i * 0.35;
            c.drawLine(128 + Math.cos(a) * 40, 92 + Math.sin(a) * 40,
                128 + Math.cos(a) * 72, 92 + Math.sin(a) * 72, 10, shade(P.bone, -0.05));
        }
        // очки — огромные линзы
        c.fillCircle(106, 104, 24, P.dark);
        c.fillCircle(150, 104, 24, P.dark);
        c.fillCircle(106, 104, 17, P.toxicDeep, 0.9);
        c.fillCircle(150, 104, 17, P.toxicDeep, 0.9);
        c.fillCircle(100, 98, 6, shade(P.toxic, 0.3), 0.8);
        c.fillCircle(144, 98, 6, shade(P.toxic, 0.3), 0.8);
        c.drawLine(128, 104, 130, 104, 8, P.dark);
        c.drawLine(82, 100, 62, 94, 6, P.dark);
        c.drawLine(174, 100, 194, 94, 6, P.dark);
        // оскал
        c.fillRect(104, 140, 48, 12, P.bone, 0.95);
        c.drawLine(112, 140, 112, 152, 3, P.dark, 0.6);
        c.drawLine(124, 140, 124, 152, 3, P.dark, 0.6);
        c.drawLine(136, 140, 136, 152, 3, P.dark, 0.6);
        c.drawLine(146, 140, 146, 152, 3, P.dark, 0.6);
        // пробирка в руке
        c.fillRect(192, 176, 26, 56, shade(P.cold, 0.3), 0.9);
        c.fillRect(192, 202, 26, 30, P.toxic, 0.95);
        c.fillRect(188, 170, 34, 12, P.steelDark);
        glow(c, 205, 212, 22, P.toxic, 0.4);
        c.drawLine(184, 200, 192, 190, 12, P.skin);
    },

    /** Последний страж: доспех + щит. */
    'boss-warden'(c, random) {
        c.fillEllipse(128, 226, 88, 15, P.dark, 0.35);
        // щит за спиной — большой
        c.fillPolygon([[140, 28], [228, 64], [210, 180], [140, 232]], shade(P.steelDark, -0.06));
        c.fillPolygon([[140, 46], [210, 74], [196, 170], [140, 212]], P.steelDark);
        c.fillPolygon([[140, 46], [210, 74], [196, 170], [140, 212]], P.dark, 0.15);
        star(c, 176, 128, 36, 16, P.warning);
        star(c, 176, 128, 20, 9, shade(P.warning, 0.2));
        c.drawLine(140, 46, 140, 212, 4, shade(P.steelDark, 0.15), 0.6);
        rustStreaks(c, 140, 50, 80, 160, P.steelDark, random);
        // корпус в доспехе
        c.fillRoundRect(36, 96, 120, 130, 26, P.steel);
        c.fillRoundRect(36, 96, 120, 40, 20, shade(P.steel, 0.08));
        c.fillRect(36, 132, 120, 14, shade(P.steel, -0.15));
        c.fillRect(36, 162, 120, 14, shade(P.steel, -0.15));
        c.fillRect(36, 192, 120, 14, shade(P.steel, -0.15));
        c.drawLine(96, 100, 96, 226, 3, shade(P.steel, -0.2), 0.5);
        // наплечники
        c.fillEllipse(40, 100, 26, 20, shade(P.steel, 0.1));
        c.fillEllipse(152, 100, 26, 20, shade(P.steel, 0.1));
        // шлем с прорезью
        c.fillRoundRect(52, 34, 88, 80, 32, shade(P.steel, 0.05));
        c.fillRoundRect(52, 34, 88, 30, 15, shade(P.steel, 0.12));
        c.fillRect(70, 68, 54, 18, P.dark);
        glow(c, 82, 77, 14, P.toxic, 0.4);
        glow(c, 112, 77, 14, P.toxic, 0.4);
        c.fillCircle(82, 77, 7, P.toxic);
        c.fillCircle(112, 77, 7, P.toxic);
        c.fillCircle(83, 76, 3, P.bone);
        c.fillCircle(113, 76, 3, P.bone);
        // заклёпки
        for (let i = 0; i < 4; i++) {
            c.fillCircle(50, 116 + i * 30, 7, shade(P.steel, 0.25));
            c.fillCircle(50, 116 + i * 30, 3, shade(P.steel, -0.1));
        }
    },
};
