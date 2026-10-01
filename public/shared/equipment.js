/**
 * Общие правила экипировки — единый источник для клиента и сервера.
 *
 * Файл живёт в public/, потому что его читают обе стороны:
 *  - сервер:  require('../public/shared/equipment.js')
 *  - браузер: <script src="shared/equipment.js"> -> window.EquipmentShared
 *
 * Раньше эта логика была продублирована побайтово в public/game.js
 * (calculatePlayerPreparation) и utils/gameConstants.js
 * (calculateRadiationDefense / calculateInfectionDefense). Копии разъезжались
 * незаметно: клиент показывал игроку одну защиту, а сервер начислял другую.
 *
 * Шаблон UMD — сознательно, без сборщика: Node берёт module.exports,
 * браузер — глобальную переменную. Никакой трансляции.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();          // Node (сервер и jest)
    } else {
        root.EquipmentShared = factory();    // браузер
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Слоты экипировки, которые участвуют в расчёте защиты.
     * Раньше этот список был продублирован в трёх местах.
     */
    const EQUIPMENT_SLOTS = Object.freeze([
        'armor', 'helmet', 'body', 'head', 'hands', 'legs', 'boots', 'accessory'
    ]);

    /**
     * Синонимы полей сопротивления. Предмет может хранить стат и на верхнем
     * уровне, и в объекте stats — проверяем оба, в этом же порядке.
     */
    const RADIATION_KEYS = Object.freeze([
        'radiation_resist', 'radiation_resistance', 'radiationDefense'
    ]);
    const INFECTION_KEYS = Object.freeze([
        'infection_resist', 'infection_resistance', 'infectionDefense'
    ]);

    /**
     * Достать числовой стат из предмета по списку возможных полей.
     * Возвращает первое положительное число; 0 — если стата нет.
     *
     * @param {object|null} item предмет экипировки
     * @param {readonly string[]} keys возможные имена поля
     * @returns {number}
     */
    function getEquipmentStatValue(item, keys) {
        if (!item || typeof item !== 'object') return 0;

        for (const key of keys) {
            const directValue = Number(item[key]);
            if (Number.isFinite(directValue) && directValue > 0) {
                return directValue;
            }
        }

        const stats = item.stats && typeof item.stats === 'object' ? item.stats : null;
        if (!stats) return 0;

        for (const key of keys) {
            const statValue = Number(stats[key]);
            if (Number.isFinite(statValue) && statValue > 0) {
                return statValue;
            }
        }

        return 0;
    }

    /**
     * Сумма сопротивления по всем слотам экипировки (сырое число, без /10).
     *
     * @param {object|null} equipment экипировка игрока
     * @param {readonly string[]} keys  поля сопротивления
     * @returns {number}
     */
    function sumEquipmentResistance(equipment, keys) {
        if (!equipment) return 0;
        let total = 0;
        for (const slot of EQUIPMENT_SLOTS) {
            total += getEquipmentStatValue(equipment[slot], keys);
        }
        return total;
    }

    /**
     * Сырое сопротивление -> очки защиты (делим на 10, округляем, не даём минус).
     * Единая формула: клиент и сервер обязаны считать одинаково.
     *
     * @param {number} totalResistance
     * @returns {number}
     */
    function normalizeResistanceToThreatPoints(totalResistance) {
        return Math.max(0, Math.round(Number(totalResistance || 0) / 10));
    }

    /**
     * Защита от радиации из экипировки, в очках.
     * @param {object|null} equipment
     * @returns {number}
     */
    function calculateRadiationDefense(equipment) {
        return normalizeResistanceToThreatPoints(
            sumEquipmentResistance(equipment, RADIATION_KEYS)
        );
    }

    /**
     * Защита от инфекций из экипировки, в очках.
     * @param {object|null} equipment
     * @returns {number}
     */
    function calculateInfectionDefense(equipment) {
        return normalizeResistanceToThreatPoints(
            sumEquipmentResistance(equipment, INFECTION_KEYS)
        );
    }

    /**
     * Сырой уровень угрозы (значение локации) -> очки угрозы.
     *
     * Зеркало normalizeResistanceToThreatPoints, но с округлением вверх:
     * локация округляется «в плюс», чтобы игрок видел худший случай.
     * Формула была продублирована в game.js и gameConstants.js.
     *
     * @param {number} rawLevel
     * @returns {number}
     */
    function normalizeThreatLevelToPoints(rawLevel) {
        return Math.max(0, Math.ceil(Number(rawLevel || 0) / 10));
    }

    /**
     * Лимит слотов инвентаря.
     * Сервер отклоняет добычу при переполнении, клиент рисует полоску
     * заполнения — оба берут значение отсюда, иначе разъедутся.
     */
    const MAX_INVENTORY_SLOTS = 100;

    return {
        EQUIPMENT_SLOTS,
        RADIATION_KEYS,
        INFECTION_KEYS,
        MAX_INVENTORY_SLOTS,
        getEquipmentStatValue,
        sumEquipmentResistance,
        normalizeResistanceToThreatPoints,
        normalizeThreatLevelToPoints,
        calculateRadiationDefense,
        calculateInfectionDefense
    };
}));