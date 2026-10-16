'use strict';

// Иконки расходников: еда в консервных банках, вода, спирт, медикаменты.
// Общие детали — из kit.js (canister, syringe, medCross).

const { PALETTE: P, shade } = require('../draw');
const { canister, syringe, medCross, radiation } = require('./kit');

const TIN = [128, 130, 128];
const LABEL_RED = [150, 60, 48];

module.exports = {
    /** Консервы: банка с потёртой этикеткой. */
    'food-canned'(c) {
        canister(c, LABEL_RED, { x: 18, y: 14, w: 28, h: 38 });
        // вмятина и ржавчина
        c.fillEllipse(24, 44, 3, 2, shade(TIN, -0.15), 0.7);
        c.fillCircle(40, 20, 2.4, P.rust, 0.65);
    },

    /** Бутылка воды. */
    'food-water'(c) {
        // горлышко и пробка
        c.fillRect(28, 10, 8, 6, shade(P.cold, 0.35));
        c.fillRect(27, 8, 10, 4, P.cold);
        // корпус бутылки
        c.fillRoundRect(22, 16, 20, 38, 6, shade(P.cold, 0.28), 0.85);
        c.fillRect(22, 28, 20, 4, shade(P.cold, 0.2));          // «плечи»
        // вода внутри
        c.fillRect(23, 32, 18, 21, P.cold);
        c.fillEllipse(32, 32, 9, 2.5, shade(P.cold, 0.15));
        // блик
        c.drawLine(26, 20, 26, 50, 2, shade(P.cold, 0.5), 0.5);
        // пыль на бутылке
        c.fillCircle(38, 44, 2, shade(TIN, -0.1), 0.35);
    },

    /** Медицинский спирт: бутылочка с крестом. */
    'food-alcohol'(c) {
        c.fillRect(28, 8, 8, 6, shade(P.bone, 0.05));           // горлышко
        c.fillRect(27, 6, 10, 4, P.steelDark);                  // крышка
        c.fillRoundRect(20, 14, 24, 40, 5, shade(P.bone, 0.02), 0.9); // флакон
        c.fillRect(21, 30, 22, 16, shade(P.bone, 0.1));         // жидкость
        medCross(c, 32, 38, 9, P.blood);
        // блик
        c.drawLine(24, 18, 24, 50, 2, [255, 255, 255], 0.25);
    },

    /** Снеки: сухой паёк-пачка. */
    'food-snack'(c) {
        // пачка
        c.fillRoundRect(16, 18, 32, 28, 3, [150, 132, 96]);
        c.fillRect(16, 18, 32, 6, shade([150, 132, 96], -0.1)); // верхний клапан
        // зубчатый срез упаковки
        for (let i = 0; i < 6; i++) {
            c.fillPolygon([[16 + i * 5.4, 18], [18.7 + i * 5.4, 15], [21.4 + i * 5.4, 18]], shade([150, 132, 96], 0.05));
        }
        // «печать» — горох/паттерн
        c.fillCircle(26, 32, 4, shade([150, 132, 96], 0.14));
        c.fillCircle(38, 36, 3.2, shade([150, 132, 96], 0.14));
        c.fillCircle(34, 28, 2.6, shade([150, 132, 96], 0.14));
        // полоса-маркировка
        c.fillRect(18, 40, 28, 4, P.warning, 0.8);
    },

    /** Энергетик: жестяной стакан с молнией. */
    'food-energy'(c) {
        canister(c, P.toxicDeep, { x: 20, y: 12, w: 24, h: 40, bolt: true });
        // конденсат/блик
        c.drawLine(24, 18, 24, 46, 2, shade(P.steel, 0.25), 0.5);
    },

    /** Бинт: свёрнутый ролик. */
    'food-bandage'(c) {
        // внешний свёрток
        c.fillCircle(30, 32, 16, P.bone);
        // витки
        for (let i = 0; i < 3; i++) {
            c.strokeCircle(30, 32, 11 - i * 3.6, 1.6, shade(P.bone, -0.1), 0.85);
        }
        // центральное отверстие
        c.fillCircle(30, 32, 3.4, shade(P.bone, -0.28));
        // свободный конец ленты
        c.fillPolygon([[42, 40], [54, 48], [50, 53], [38, 45]], P.bone);
        c.drawLine(40, 43, 52, 50, 1, shade(P.bone, -0.12), 0.7);
        // пятно крови — постапок
        c.fillCircle(36, 26, 3, P.blood, 0.55);
    },

    /** Аптечка/витамины: жестяной кейс с крестом. */
    'food-medkit'(c) {
        c.fillRoundRect(12, 20, 40, 28, 4, P.bone);             // кейс
        c.fillRect(12, 30, 40, 2, shade(P.bone, -0.14));        // разъём крышки
        c.fillRect(26, 16, 12, 6, shade(P.bone, -0.08));        // ручка
        c.fillRoundRect(26, 16, 12, 6, 2, shade(P.steelDark, 0.05));
        medCross(c, 32, 41, 13, P.blood);
        // защёлки
        c.fillRect(16, 29, 4, 5, P.steelDark);
        c.fillRect(44, 29, 4, 5, P.steelDark);
        // царапины
        c.drawLine(15, 45, 24, 45, 1, shade(P.bone, -0.2), 0.6);
    },

    /** Антидот/Реаниматор: шприц с зелёной/красной жидкостью. */
    'med-syringe'(c) {
        syringe(c, P.toxic);
        // капля на игле
        c.fillCircle(54, 10, 1.6, P.toxic, 0.9);
    },

    /** Реаниматор: большой шприц с красным реагентом. */
    'med-reviver'(c) {
        syringe(c, P.blood, { thick: 10, barrel: [[14, 50], [42, 22]] });
        // искра-молния сверху — «реанимация»
        c.fillPolygon([[50, 8], [54, 4], [53, 9], [58, 8]], P.warning);
    },

    /** Антирадин: жёлтая таблетка с радиационным знаком. */
    'med-antirad'(c) {
        // таблетка
        c.fillCircle(32, 32, 17, P.warning);
        c.fillCircle(32, 32, 17, shade(P.warning, 0.25), 0.35);   // верхний блик
        c.strokeCircle(32, 32, 17, 1.4, shade(P.warning, -0.2));
        // риска
        c.drawLine(20, 24, 44, 24, 1.2, shade(P.warning, -0.15), 0.6);
        radiation(c, 32, 32, 10, P.dark, 0.88);
    },

    /** Нано-аптечка: кейс с технологичным крестом. */
    'med-nano'(c) {
        c.fillRoundRect(12, 20, 40, 28, 4, shade(P.steel, -0.05));  // металлический кейс
        c.fillRect(12, 30, 40, 2, shade(P.steel, -0.2));
        c.fillRect(26, 16, 12, 6, P.steelDark);                     // ручка
        medCross(c, 32, 41, 13, P.toxic);                           // светящийся крест
        // «нано-россыпь» — частицы
        for (let i = 0; i < 6; i++) {
            c.fillCircle(17 + i * 6, 24 + (i % 2) * 3, 1, P.toxic, 0.55);
        }
        c.fillRect(16, 29, 4, 5, shade(P.steel, -0.15));            // защёлки
        c.fillRect(44, 29, 4, 5, shade(P.steel, -0.15));
    },

    /** Радиа-кур: щит с радиационным знаком. */
    'med-radiashield'(c) {
        // щит
        c.fillPolygon([[32, 8], [52, 16], [50, 40], [32, 56], [14, 40], [12, 16]], shade(P.steel, 0.02));
        c.fillPolygon([[32, 12], [48, 18], [46, 38], [32, 51], [18, 38], [16, 18]], shade(P.steelDark, 0.06));
        // радиационный знак в центре
        radiation(c, 32, 32, 12, P.toxic);
        // блик по кромке
        c.drawLine(16, 18, 32, 12, 1.4, shade(P.steel, 0.3), 0.7);
    },

    /** Стимулятор: ампула с кислотной жидкостью. */
    'med-stim'(c) {
        // ампула — колба с сужением
        c.fillPolygon([[26, 16], [38, 16], [38, 28], [35, 34], [35, 50], [29, 50], [29, 34], [26, 28]], shade(P.cold, 0.3), 0.75);
        c.fillRect(27, 10, 10, 6, shade(P.cold, 0.35));             // горлышко
        c.fillRect(26, 8, 12, 3, P.steel);                          // обламанный верх
        // жидкость
        c.fillRect(29, 36, 6, 14, P.toxic);
        c.fillEllipse(32, 36, 3, 1.6, shade(P.toxic, 0.2));
        // блик
        c.drawLine(30, 20, 30, 32, 1.6, [255, 255, 255], 0.35);
        // искры энергии вокруг
        c.fillCircle(44, 22, 1.4, P.warning, 0.8);
        c.fillCircle(20, 28, 1.2, P.warning, 0.7);
        c.fillCircle(42, 44, 1.2, P.warning, 0.7);
    },

    /** Сыворотка мутанта: колба с ДНК-спиралью. */
    'med-serum'(c) {
        // колба-мешок
        c.fillEllipse(32, 38, 13, 15, shade(P.toxicDeep, 0.02), 0.92);
        c.fillRect(28, 12, 8, 14, shade(P.toxicDeep, 0.02), 0.92);   // горло
        c.fillRect(27, 9, 10, 4, P.steelDark);                        // пробка
        // ДНК-спираль внутри
        for (let i = 0; i < 6; i++) {
            const y = 28 + i * 4;
            const off = Math.sin(i * 1.1) * 6;
            c.fillCircle(32 + off, y, 1.8, P.toxic, 0.9);
            c.fillCircle(32 - off, y, 1.8, shade(P.toxic, -0.2), 0.9);
            c.drawLine(32 + off, y, 32 - off, y, 0.8, P.bone, 0.4);
        }
        // пузырьки
        c.fillCircle(27, 44, 1.6, shade(P.toxic, 0.3), 0.7);
        c.fillCircle(38, 42, 1.2, shade(P.toxic, 0.3), 0.6);
    },

    /** Нейроимплант: чип с «ножками» и молнией. */
    'med-implant'(c) {
        // корпус чипа
        c.fillRoundRect(18, 18, 28, 28, 3, P.dark);
        c.fillRoundRect(21, 21, 22, 22, 2, shade(P.toxicDeep, -0.1));
        // микросхема-сердцевина
        c.fillRoundRect(26, 26, 12, 12, 1.5, P.bgDark);
        c.fillPolygon([[34, 27], [30, 33], [33, 33], [29, 37]], P.warning); // молния
        // ножки
        for (let i = 0; i < 4; i++) {
            c.fillRect(12, 22 + i * 6, 6, 2.4, P.steel);
            c.fillRect(46, 22 + i * 6, 6, 2.4, P.steel);
        }
        // трассы
        c.drawLine(21, 24, 26, 24, 1, P.toxicDeep, 0.8);
        c.drawLine(21, 40, 26, 40, 1, P.toxicDeep, 0.8);
        c.drawLine(38, 24, 43, 24, 1, P.toxicDeep, 0.8);
        c.drawLine(38, 40, 43, 40, 1, P.toxicDeep, 0.8);
    },
};

