/**
 * Общие правила предметов, энергии и здоровья — единый источник для
 * клиента и сервера.
 *
 * Имя файла осталось прежним (equipment.js), хотя правил стало больше:
 * здесь уже лежат интервалы регена энергии и здоровья, пороги
 * автолечения, цена покупки энергии. Переименование сломало бы
 * window.EquipmentShared в разметке и require() в 20+ местах сервера —
 * имя менять только вместе с обоими.
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
     * Зеркало normalizeResistanceToThreatPoints, но с округлением ВВЕРХ:
     * локация округляется «в плюс», чтобы игрок видел худший случай.
     *
     * @param {number} rawLevel
     * @returns {number}
     */
    function normalizeThreatLevelToPoints(rawLevel) {
        return Math.max(0, Math.ceil(Number(rawLevel || 0) / 10));
    }

    // -------------------------------------------------------------------------
    // ТИРЫ РИСКА ЛОКАЦИЙ — общие границы клиента и сервера
    //
    // Пороги обязаны совпадать с сервером: игрок видит подпись тира отсюда,
    // а сервер по тем же границам начисляет множители за лут, опыт и ключи.
    // -------------------------------------------------------------------------

    /** Давление угроз не выше этого значения — зона считается освоенной */
    const RISK_PREPARED_MAX_SCORE = 2;

    /**
     * Тиры риска по сумме давления угроз (радиация + инфекции).
     * maxScore — верхняя граница тира: первый подходящий тир и есть ответ.
     * Множители применяет сервер, подписи показывает клиент — строки одни.
     */
    const RISK_TIERS = Object.freeze([
        Object.freeze({
            key: 'safe', label: 'Стабильно', maxScore: 1,
            rewardMultiplier: 1, keyChanceMultiplier: 1, rarityLuckBonus: 0, expMultiplier: 1
        }),
        Object.freeze({
            key: 'warning', label: 'Риск', maxScore: 4,
            rewardMultiplier: 1.12, keyChanceMultiplier: 1.35, rarityLuckBonus: 6, expMultiplier: 1.18
        }),
        Object.freeze({
            key: 'danger', label: 'Опасно', maxScore: 7,
            rewardMultiplier: 1.28, keyChanceMultiplier: 1.75, rarityLuckBonus: 12, expMultiplier: 1.4
        }),
        Object.freeze({
            key: 'deadly', label: 'Смертельно', maxScore: Infinity,
            rewardMultiplier: 1.5, keyChanceMultiplier: 2.25, rarityLuckBonus: 18, expMultiplier: 1.7
        })
    ]);

    /**
     * Тир риска по сумме давления угроз.
     *
     * Нечисловой score считается нулевым: клиент спрашивает тир до загрузки
     * статуса, и «Смертельно» из NaN было бы неверным сообщением игроку.
     *
     * @param {number} score давление угроз (радиация + инфекции)
     * @returns {object} тир из RISK_TIERS
     */
    function getRiskTierByScore(score) {
        const value = Number(score);
        const safeScore = Number.isFinite(value) ? Math.max(0, value) : 0;
        return RISK_TIERS.find((tier) => safeScore <= tier.maxScore) || RISK_TIERS[RISK_TIERS.length - 1];
    }

    /**
     * Лимит слотов инвентаря. Сервер отклоняет добычу при переполнении,
     * клиент рисует полоску заполнения — оба берут значение отсюда.
     */
    const MAX_INVENTORY_SLOTS = 100;

    // -------------------------------------------------------------------------
    // ПРОЧНОСТЬ, УЛУЧШЕНИЯ, РАЗБОР И СЕТЫ — общие правила клиента и сервера
    //
    // Вся арифметика ниже обязана считаться одинаково на сервере (урон,
    // защита, цена ремонта) и в браузере (подписи «прочность 12/50»,
    // «апгрейд +3», «разобрать → материалы»).
    // -------------------------------------------------------------------------

    /** Максимальный уровень улучшения предмета */
    const MAX_UPGRADE_LEVEL = 10;

    /** Прибавка к урону/защите за каждый уровень улучшения (8%) */
    const UPGRADE_BONUS_PER_LEVEL = 0.08;

    /** Порядок редкостей от обычной к легендарной */
    const RARITY_ORDER = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);

    /** Множители базовой цены по типу предмета */
    const PRICE_MULTIPLIER_BY_TYPE = Object.freeze({
        weapon_melee: 1.0,
        weapon_ranged: 1.3,
        weapon_legendary: 2.5,
        armor_body: 1.2,
        armor_head: 0.8,
        armor_hands: 0.6,
        armor_legs: 0.7,
        armor_boots: 0.6,
        armor_accessory: 0.5,
        medicine: 0.8,
        resource: 0.4,
ammo: 0.3,
        food: 1.0,
        key: 0,
        consumable: 1.0
    });
/**
 * Формула опыта до следующего уровня.
     * Начисление (сервер) и полоска опыта (клиент) обязаны считать одно и то же.
     *
     * @param {number} level текущий уровень
     * @returns {number} сколько опыта нужно до следующего уровня
     */
    function getExpForLevel(level) {
        const lvl = Math.max(1, Number(level) || 1);
        return Math.round(500 * lvl * (1 + lvl / 25));
    }

    /** Общий опыт, необходимый для достижения уровня */
    function getTotalExpForLevel(level) {
        let total = 0;
        for (let i = 1; i < Math.max(1, Number(level) || 1); i++) {
            total += getExpForLevel(i);
        }
        return total;
    }

    /** +1 энергия за столько миллисекунд. Тот же интервал у сервера (recalcEnergy). */
    const ENERGY_REGEN_INTERVAL_MS = 60 * 1000;

    /* ================= ПОКУПКА ЭНЕРГИИ =================
     *
     * Раньше цена и объём были записаны дважды: `const STARS_COST = 5`
     * в public/game.js и `const STARS_COST = 5` + ENERGY_PER_PURCHASE в
     * routes/game/player.js. Клиент по своей копии решал, хватает ли
     * звёзд, и показывал «Нужно 5 ⭐», а сервер по своей списывал.
     * Поднять цену на сервере — и клиент продолжал бы предлагать покупку,
     * которую сервер отклоняет с INSUFFICIENT_STARS.
     *
     * Теперь обе стороны берут числа отсюда.
     */

    /** Сколько звёзд стоит одна покупка энергии */
    const ENERGY_PURCHASE_STARS_COST = 5;

    /** Сколько энергии даёт одна покупка (обрезается по max_energy) */
    const ENERGY_PER_PURCHASE = 25;

    /** Цена создания клана. Была захардкожена в 4 местах routes/game/clans.js. */
    const CLAN_CREATE_COST = 1000;

    /** Максимальная длина описания клана. */
    const CLAN_DESCRIPTION_MAX = 200;

    /** Максимамая длина имени клана. */
    const CLAN_NAME_MAX = 30;

    /* ================= КОЛЕСО УДАЧИ =================
     *
     * Раньше список призов жил двумя копиями: с весами в
     * routes/game/minigames.js (сервер решает, что выпало) и без весов в
     * public/game.js (клиент рисовал секторы). Копии расходились молча:
     * анимация подсвечивала сектор, который сервер уже не выдаёт.
     *
     * Теперь источник один. Сервер берёт весь объект (ему нужен weight),
     * клиент — тот же список для отрисовки до первого ответа сервера.
     * После ответа сервера клиент перезаписывает свой список актуальным.
     */
    const WHEEL_PRIZES = Object.freeze([
        { type: 'coins', value: 10, text: '10 монет', weight: 20 },
        { type: 'coins', value: 25, text: '25 монет', weight: 15 },
        { type: 'coins', value: 50, text: '50 монет', weight: 10 },
        { type: 'coins', value: 100, text: '100 монет', weight: 5 },
        { type: 'multiplier', value: 2, text: 'x2 к монетам', weight: 3 },
        { type: 'energy', value: 20, text: '20 энергии', weight: 12 }
    ]);

    /** Кулдаун бесплатного вращения (24 часа). */
    const WHEEL_FREE_SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

    /* ================= ИГРОВАЯ КОНФИГУРАЦИЯ =================
     *
     * Единый источник конфигурации для клиента и сервера.
     * Все числовые константы игрового баланса собраны здесь,
     * чтобы избежать расхождений между клиентом и сервером.
     */
    const GAME_CONFIG = Object.freeze({
        // Шанс дропа
        BASE_DROP_CHANCE: 8,
        MAX_DROP_CHANCE: 60,
        MAX_LUCK: 150,

        // Регенерация
        ENERGY_REGEN_INTERVAL_MS: 60 * 1000,
        HEALTH_REGEN_INTERVAL_MS: 90 * 1000,
        HEALTH_REGEN_CAP_RATIO: 0.6,
        DEFAULT_AUTO_HEAL_THRESHOLD: 35,
        AUTO_HEAL_THRESHOLD_MIN: 10,
        AUTO_HEAL_THRESHOLD_MAX: 90,

        // Износ и ремонт
        WEAR_PER_HIT: 0.5,
        REPAIR_COST_MULTIPLIER: 0.4,
        UPGRADE_COST_MULTIPLIER: 0.8,
        BASE_DURABILITY: 500,

        // Цены
        BASE_PRICE_BY_RARITY: {
            common: 50,
            uncommon: 200,
            rare: 800,
            epic: 5000,
            legendary: 50000
        },

        // Дроп монет
        COIN_DROP_CHANCE: 30,
        BASE_COIN_AMOUNT: 50,
        MAX_COIN_AMOUNT: 500,
        RISK_MULTIPLIERS: {
            safe: 1.0,
            warning: 1.5,
            danger: 2.0,
            deadly: 3.0
        }
    });

    function calculateDropChance(luck) {
        if (luck <= 0) return 5;
        const chance = 10 + (luck * 0.4);
        return Math.min(GAME_CONFIG.MAX_DROP_CHANCE, Math.round(chance * 10) / 10);
    }

    /**
     * Расчёт выпадения монет при поиске лута.
     * 
     * Формула:
     * - Базовый шанс дропа монет: 30%
     * - Базовая сумма: 50 монет
     * - Множитель за риск зоны: safe=1.0, warning=1.5, danger=2.0, deadly=3.0
     * - Множитель за удачу: 1 + luck * 0.01
     * - Максимум: 500 монет за один поиск
     * 
     * @param {object} options { riskTier: string, luck: number, playerLevel: number }
     * @returns {object|null} { amount: number } или null если монеты не выпали
     */
    function calculateCoinDrop(options = {}) {
        const { riskTier = 'safe', luck = 0, playerLevel = 1 } = options;
        
        const COIN_DROP_CHANCE = GAME_CONFIG.COIN_DROP_CHANCE;
        const BASE_COIN_AMOUNT = GAME_CONFIG.BASE_COIN_AMOUNT;
        const MAX_COIN_AMOUNT = GAME_CONFIG.MAX_COIN_AMOUNT;
        
        // Проверка шанса
        const roll = Math.random() * 100;
        if (roll > COIN_DROP_CHANCE) {
            return null;
        }
        
        // Множители
        const riskMultiplier = GAME_CONFIG.RISK_MULTIPLIERS[riskTier] || 1.0;
        const luckMultiplier = 1 + (luck * 0.01);
        const levelMultiplier = 1 + (playerLevel * 0.05);
        
        const amount = Math.floor(BASE_COIN_AMOUNT * riskMultiplier * luckMultiplier * levelMultiplier);
        const finalAmount = Math.min(MAX_COIN_AMOUNT, Math.max(1, amount));
        
        return { amount: finalAmount };
    }

    /* ================= ОЗДОРОВЛЕНИЕ И ЛЕЧЕНИЕ =================
     *
     * Три слоя лечения:
     *   1) пассивное восстановление — медленное, до «безопасного» потолка;
     *   2) автолечение — расходует самый экономный предмет из инвентаря;
     *   3) ручное лечение — кнопки прямо на главном экране.
     *
     * Баланс: реген НЕ доводит до полного здоровья, поэтому аптечки в бою
     * по-прежнему нужны; реген и предметы закрывают разные ситуации.
     */

    /** +1 HP за столько миллисекунд */
    const HEALTH_REGEN_INTERVAL_MS = 90 * 1000;

    /** Потолок регена: 60% от максимума (при 100 HP это 60 HP) */
    const HEALTH_REGEN_CAP_RATIO = 0.6;

    /** Порог автолечения по умолчанию, % от максимума */
    const DEFAULT_AUTO_HEAL_THRESHOLD = 35;

    /** Границы настройки порога автолечения */
    const AUTO_HEAL_THRESHOLD_MIN = 10;
    const AUTO_HEAL_THRESHOLD_MAX = 90;

    /** Потолок здоровья для пассивного регена */
    function getHealthRegenCap(maxHealth) {
        const max = Math.max(1, Number(maxHealth) || 1);
        return Math.max(1, Math.floor(max * HEALTH_REGEN_CAP_RATIO));
    }

    /** Сколько HP можно восстановить бесплатно (не выше потолка регена) */
    function getRegenerableHealth(health, maxHealth) {
        return Math.max(0, getHealthRegenCap(maxHealth) - Math.max(0, Number(health) || 0));
    }

    /**
     * Порог здоровья, ниже которого срабатывает автолечение.
     *
     * Пустое значение (null/undefined/'') — это «настройка не задана», а не
     * ноль: Number(null) === 0 проходит проверку isFinite и молча зажимается
     * в минимум 10%, тогда как интерфейс в том же случае показывает дефолтные
     * 35%. Сервер лечился по 10%, игрок видел 35% — расхождение UI и БД.
     *
     * @param {number} maxHealth максимум здоровья
     * @param {number} [threshold] пользовательский порог в процентах
     * @returns {number} HP, ниже которых нужно лечиться
     */
    function getAutoHealThreshold(maxHealth, threshold) {
        const isBlank = threshold === null || threshold === undefined
            || (typeof threshold === 'string' && threshold.trim() === '');
        const value = isBlank ? NaN : Number(threshold);
        const percent = Number.isFinite(value)
            ? Math.min(AUTO_HEAL_THRESHOLD_MAX, Math.max(AUTO_HEAL_THRESHOLD_MIN, value))
            : DEFAULT_AUTO_HEAL_THRESHOLD;
        return Math.max(1, Math.floor((Math.max(1, Number(maxHealth) || 1) * percent) / 100));
    }

    /**
     * Выбрать предмет для автолечения.
     *
     * Правило одно и предсказуемое: берём предмет с максимальной
     * эффективностью (HP за монету), а при равенстве — меньший по силе.
     *
     * Звёздные предметы (stars_price) автолечение не трогает, пока в
     * инвентаре есть хоть одно обычное лекарство. Причина: эффективность
     * в монетах у Нано-аптечки выше, чем у Аптечки, и без этого правила
     * автолечение первым делом съедало бы дорогие награды за звёзды.
     * Дорогие вещи остаются на «чёрный день».
     *
     * Раньше здесь был дополнительный фильтр «поднимает ли выше порога»:
     * на низком здоровье он выбирал Нано-аптечку вместо трёх бинтов, то
     * есть автолечение съедало дорогие награды игрока. Фильтр убран.
     *
     * @param {Array} items кандидаты: {id, name, heal, price, stack, stars_price}
     * @param {object} options { health, maxHealth, threshold }
     * @returns {object|null} выбранный предмет или null
     */
    function selectHealItem(items, options = {}) {
        // stack не указан — считаем, что предмета хватает (1 шт).
        // ЯВНЫЙ 0 — пустой стак: `stack || 1` превратил бы ноль в единицу,
        // и автолечение выбрало бы предмет, которого у игрока нет.
        const hasStock = (item) => {
            if (item.stack === undefined || item.stack === null || item.stack === '') return true;
            return Number(item.stack) > 0;
        };
        const usable = (Array.isArray(items) ? items : [])
            .filter((item) => item && Number(item.heal) > 0 && hasStock(item));

        const regular = usable.filter((item) => !Number(item.stars_price));
        const pool = regular.length > 0 ? regular : usable;

        if (pool.length === 0) return null;

        const health = Math.max(0, Number(options.health) || 0);
        const maxHealth = Math.max(1, Number(options.maxHealth) || 1);

        // Эффективность = HP за 1 монету.
        const efficiencyOf = (item) => {
            const price = Number(item.price);
            if (!Number.isFinite(price) || price <= 0) return 0.5;
            return Number(item.heal) / price;
        };

        const sorted = [...pool].sort((a, b) => {
            const byEfficiency = efficiencyOf(b) - efficiencyOf(a);
            if (Math.abs(byEfficiency) > 1e-9) return byEfficiency;
            return Number(a.heal) - Number(b.heal);
        });

        const best = sorted[0];
        return { ...best, covers: health + Number(best.heal) >= maxHealth };
    }

    /**
 * Определить слот экипировки для предмета.
 *
 * Предмет без слота (например еда) обязан вернуть null: слот типа
 * item.type не участвует ни в защите, ни в износе.
 *
 * Порядок: явный слот каталога -> category (для брони это и есть слот:
 * body/head/hands/legs) -> type. Возвращает null, если слот неизвестен:
 * вызывающий код обязан отказать, а не гадать.
 *
 * @param {object} item предмет инвентаря или экипировки
 * @returns {string|null} валидный слот или null
 */
function resolveEquipmentSlot(item) {
    if (!item || typeof item !== 'object') return null;

    const candidates = [
        item.slot,
        item.category,
        // Хирургически: у брочки type может быть 'armor', это валидный слот.
        item.type
    ];

    for (const candidate of candidates) {
        const slot = String(candidate || '').toLowerCase();
        if (COMBAT_SLOTS.includes(slot)) return slot;
    }
    return null;
}

/** Слоты, участвующие в бою (броня + оружие) */
    const COMBAT_SLOTS = Object.freeze(EQUIPMENT_SLOTS.concat(['weapon']));

    /** Поля «защиты» предмета (берётся первое найденное) */
    const DEFENSE_KEYS = Object.freeze(['defense', 'armor', 'protection']);

    /** Поля «удачи» предмета */
    const LUCK_KEYS = Object.freeze(['luck', 'luck_bonus']);

    /**
     * Материал для улучшения по редкости.
     * Имена совпадают с items.name — сервер резолвит их в id через таблицу.
     */
    const UPGRADE_MATERIAL_BY_RARITY = Object.freeze({
        common: 'Металлолом',
        uncommon: 'Пластик',
        rare: 'Электроника',
        epic: 'Титан',
        legendary: 'Кристалл силы'
    });

    /** Материалы, которые даёт разбор предмета (по редкости) */
    const SCRAP_YIELD_BY_RARITY = Object.freeze({
        common: { 'Металлолом': 2, 'Древесина': 1 },
        uncommon: { 'Пластик': 2, 'Металлолом': 2 },
        rare: { 'Электроника': 2, 'Провода': 1, 'Пластик': 1 },
        epic: { 'Титан': 2, 'Электроника': 1 },
        legendary: { 'Кристалл силы': 2, 'Титан': 1 }
    });

    /** Патроны — дополнительный материал для улучшения стрелкового оружия */
    const AMMO_ITEM_NAME = 'Патроны';

    /** Реактивные гранаты — материал для улучшения реактивной пушки */
    const ROCKET_ITEM_NAME = 'Реактивные гранаты';

    /** Максимальный уровень одной модификации */
    const MAX_MODIFICATION_LEVEL = 3;

    /**
     * Модификации снаряжения — второй, параллельный апгрейду трек развития:
     * «Заточка» добавляет плоский урон оружию, «Облицовка» — плоскую защиту
     * броне. Бонус плоский, а не процентный: апгрейд уже даёт +8% за уровень,
     * иначе модификация просто удваивала бы его эффект.
     *
     * Материалы различаются по типу: у оружия — металл/провода, у брони —
     * ткань и дерево.
     */
    const MODIFICATIONS = Object.freeze({
        sharpening: {
            key: 'sharpening',
            name: 'Заточка',
            stat: 'damage',
            perLevel: 4,
            appliesTo: 'weapon',
            icon: '⚔️',
            materials: {
                common: 'Металлолом',
                uncommon: 'Пластик',
                rare: 'Провода',
                epic: 'Электроника',
                legendary: 'Титан'
            }
        },
        plating: {
            key: 'plating',
            name: 'Облицовка',
            stat: 'defense',
            perLevel: 3,
            appliesTo: 'armor',
            icon: '🛡️',
            materials: {
                common: 'Древесина',
                uncommon: 'Ткань',
                rare: 'Пластик',
                epic: 'Провода',
                legendary: 'Электроника'
            }
        }
    });

    /** Какой стат улучшает какая модификация */
    const MODIFICATION_BY_STAT = Object.freeze({ damage: 'sharpening', defense: 'plating' });

    /** Базовая цена ремонта/улучшения, если у предмета price = 0 */
    const BASE_PRICE_BY_RARITY = Object.freeze({
        common: 50,
        uncommon: 200,
        rare: 800,
        epic: 5000,
        legendary: 50000
    });

    /** Привести редкость к известному значению */
    function normalizeRarity(rarity) {
        const value = String(rarity || '').toLowerCase();
        return RARITY_ORDER.includes(value) ? value : 'common';
    }

    /** Привести уровень улучшения к диапазону 0..MAX_UPGRADE_LEVEL */
    function getUpgradeLevel(item) {
        const raw = Number(item && item.upgrade_level);
        if (!Number.isFinite(raw)) return 0;
        return Math.min(MAX_UPGRADE_LEVEL, Math.max(0, Math.round(raw)));
    }

    /** Множитель характеристик за улучшения */
    function getUpgradeMultiplier(item) {
        return 1 + getUpgradeLevel(item) * UPGRADE_BONUS_PER_LEVEL;
    }

    /**
     * Снаряжение ли это (участвует в прочности, ремонте и разборе).
     * Проверяем и по типу, и по наличию слота: у части оружия slot = null.
     */
    function isEquipmentItem(item) {
        if (!item || typeof item !== 'object') return false;
        const type = String(item.type || '').toLowerCase();
        if (type === 'weapon' || type === 'armor') return true;
        return Boolean(item.slot);
    }

    /**
     * Текущая и максимальная прочность предмета.
     * Старые записи инвентаря не знали про durability: отсутствующее значение
     * трактуем как «предмет ещё не изнашивался» (то есть максимум).
     * Базовая прочность по умолчанию: 500 (было 100).
     * @returns {{current:number,max:number,isBroken:boolean,ratio:number}}
     */
    function getDurabilityInfo(item) {
        const maxRaw = Number(item && (item.max_durability || item.durability));
        const max = Math.max(1, Math.round(Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 500));

        if (!isEquipmentItem(item)) {
            return { current: max, max, isBroken: false, ratio: 1 };
        }

        const raw = Number(item && item.durability);
        const current = Number.isFinite(raw)
            ? Math.min(max, Math.max(0, Math.round(raw)))
            : max;

        return {
            current,
            max,
            isBroken: current <= 0,
            ratio: max > 0 ? current / max : 0
        };
    }

    /**
     * Уровень модификации предмета.
     * Значение хранится в item.modifications[key] как число (уровень 1..3).
     */
    function getModificationLevel(item, key) {
        const all = (item && item.modifications && typeof item.modifications === 'object')
            ? item.modifications
            : {};
        const raw = Number(all[key]);
        if (!Number.isFinite(raw)) return 0;
        return Math.min(MAX_MODIFICATION_LEVEL, Math.max(0, Math.round(raw)));
    }

    /** Плоская прибавка от модификаций к конкретному стату */
    function getModificationBonus(item, stat) {
        const modification = MODIFICATIONS[MODIFICATION_BY_STAT[stat]];
        if (!modification) return 0;
        return getModificationLevel(item, modification.key) * modification.perLevel;
    }

    /**
     * Стоимость следующего уровня модификации.
     * @returns {{coins:number,materials:Record<string,number>}|null}
     */
    function calculateModificationCost(item, key) {
        const modification = MODIFICATIONS[key];
        if (!modification) return null;

        const level = getModificationLevel(item, key);
        if (level >= MAX_MODIFICATION_LEVEL) return null;

        const rarity = normalizeRarity(item && item.rarity);
        const basePrice = Number(item && item.price) || BASE_PRICE_BY_RARITY[rarity];
        const coins = Math.max(15, Math.round(basePrice * 0.25 * (level + 1)));
        const material = modification.materials[rarity];

        return {
            level,
            next_level: level + 1,
            coins,
            materials: material ? { [material]: 1 + level } : {}
        };
    }

    /** Подходит ли модификация этому предмету (по типу снаряжения) */
    function isModificationApplicable(item, key) {
        const modification = MODIFICATIONS[key];
        if (!modification || !isEquipmentItem(item)) return false;

        const type = String(item.type || '').toLowerCase();
        if (modification.appliesTo === 'weapon') return type === 'weapon';
        if (modification.appliesTo === 'armor') return type === 'armor';
        return true;
    }

    /**
     * Разброс урона (дробовик, реактивная пушка).
     *
     * Задаётся полем stats.variance в процентах: −N%…+N% от базового урона,
     * минимум 1. Чистая по аргументам функция, но использует Math.random —
     * вызывается только на сервере в момент атаки.
     *
     * Нулевой базовый урон даёт 0, а не 1: «минимум 1» — это страховка от
     * нулевого РЕЗУЛЬТАТА удара, а не от отсутствия оружия. Раньше боец без
     * оружия в PvP получал 29 урона вместо 28 — фантомный урон из ничего.
     *
     * @param {number} baseDamage базовый урон
     * @param {number} variancePercent разброс в процентах (0 — без разброса)
     * @returns {number} фактический урон
     */
    function rollVarianceDamage(baseDamage, variancePercent) {
        const base = Math.max(0, Number(baseDamage) || 0);
        const variance = Math.max(0, Math.min(100, Number(variancePercent) || 0));
        if (base === 0) return 0;
        if (variance === 0) return Math.max(1, Math.round(base));

        const factor = 1 - variance / 100 + Math.random() * (2 * variance / 100);
        return Math.max(1, Math.floor(base * factor));
    }

    /**
     * Значение характеристики с учётом улучшений, модификаций и прочности.
     * Сломанный предмет не даёт бонусов, пока его не отремонтируют.
     * @returns {number} целое число (урон/защита в игре целочисленные)
     */
    function getEffectiveStatValue(item, keys) {
        const base = getEquipmentStatValue(item, keys);
        if (base <= 0) return 0;
        if (isEquipmentItem(item) && getDurabilityInfo(item).isBroken) return 0;

        const upgraded = base * getUpgradeMultiplier(item);

        // Модификации добавляются плоским бонусом к первому подходящему стату
        // из keys (обычно это либо 'damage', либо 'defense').
        let bonus = 0;
        for (const key of keys) {
            bonus += getModificationBonus(item, key);
        }

        return Math.max(0, Math.round(upgraded + bonus));
    }

    /** Суммарная защита экипировки с учётом улучшений и прочности */
    function calculateDefenseTotal(equipment) {
        if (!equipment) return 0;
        let total = 0;
        for (const slot of COMBAT_SLOTS) {
            total += getEffectiveStatValue(equipment[slot], DEFENSE_KEYS);
        }
        return total;
    }

    /** Суммарная прибавка к удаче из экипировки (влияет на шанс находки) */
    function calculateEquipmentLuckBonus(equipment) {
        if (!equipment) return 0;
        let total = 0;
        for (const slot of COMBAT_SLOTS) {
            total += getEffectiveStatValue(equipment[slot], LUCK_KEYS);
        }
        return total;
    }

    /**
     * Снижение входящего урона защитой.
     * Мягкий предел: 5 защиты ≈ 3%, 35 ≈ 15%, 100 ≈ 31%; к 60% кривая только
     * приближается — броня не может обнулить урон.
     * @param {number} damage входящий урон
     * @param {number} defense суммарная защита
     * @returns {number} урон не меньше 1
     */
    function applyDefenseReduction(damage, defense) {
        const incoming = Math.max(0, Number(damage) || 0);
        const defenseTotal = Math.max(0, Number(defense) || 0);
        if (defenseTotal <= 0) return Math.max(1, Math.round(incoming));

        const reduction = Math.min(60, (defenseTotal / (defenseTotal + 100)) * 60);
        return Math.max(1, Math.floor(incoming * (1 - reduction / 100)));
    }

    /**
     * Износ предмета: возвращает НОВЫЙ объект (исходный не мутируется).
     * Прочность не уходит в минус: при нуле предмет «сломан» — бонусов не даёт
     * (см. getEffectiveStatValue), но остаётся в инвентаре, его можно починить.
     * 
     * Износ за удар: 0.2 единицы (1 единица за 5 ударов).
     */
    function wearEquipment(item, amount = 1) {
        if (!isEquipmentItem(item)) return item;

        const info = getDurabilityInfo(item);
        const wear = Math.max(0, Math.round(Number(amount) * GAME_CONFIG.WEAR_PER_HIT));

        return {
            ...item,
            durability: Math.max(0, info.current - wear),
            max_durability: info.max
        };
    }

/**
     * Цена ремонта: 40% стоимости предмета за полный износ.
     * @returns {number} монеты (0 — ремонт не нужен)
     */
    function calculateRepairCost(item) {
        const info = getDurabilityInfo(item);
        const missing = info.max - info.current;
        if (missing <= 0) return 0;

        const rarity = normalizeRarity(item && item.rarity);
        const basePrice = Number(item && item.price) || BASE_PRICE_BY_RARITY[rarity];
        return Math.max(1, Math.ceil((missing / info.max) * basePrice * GAME_CONFIG.REPAIR_COST_MULTIPLIER));
    }

    /**
     * Стоимость следующего улучшения.
     * @returns {{level:number,next_level:number,coins:number,materials:Record<string,number>}|null}
     */
    function calculateUpgradeCost(item) {
        const level = getUpgradeLevel(item);
        if (level >= MAX_UPGRADE_LEVEL) return null;

        const rarity = normalizeRarity(item && item.rarity);
        const basePrice = Number(item && item.price) || BASE_PRICE_BY_RARITY[rarity];
        const coins = Math.max(20, Math.round(basePrice * GAME_CONFIG.UPGRADE_COST_MULTIPLIER * (level + 1)));

        const materials = {};
        const primary = UPGRADE_MATERIAL_BY_RARITY[rarity];
        if (primary) materials[primary] = 1 + Math.floor(level / 2);

        // Боеприпасы для улучшения: у реактивной пушки — гранаты,
        // у остального стрелкового оружия — патроны.
        const ammoType = String(item.ammo_type || '').toLowerCase();
        if (ammoType === 'rockets') {
            materials[ROCKET_ITEM_NAME] = (materials[ROCKET_ITEM_NAME] || 0) + (level + 1);
        } else if (ammoType === 'ammo' || String((item && item.category) || '').toLowerCase() === 'ranged') {
            materials[AMMO_ITEM_NAME] = (materials[AMMO_ITEM_NAME] || 0) + (level + 1);
        }

        return { level, next_level: level + 1, coins, materials };
    }

    /**
     * Что даёт разбор предмета (материалы по редкости).
     * @param {object} item предмет инвентаря
     * @param {number} quantity сколько единиц разбираем
     * @returns {Record<string, number>} имя материала -> количество
     */
    function calculateScrapYield(item, quantity = 1) {
        if (!isEquipmentItem(item)) return {};

        const rarity = normalizeRarity(item && item.rarity);
        const yieldMap = SCRAP_YIELD_BY_RARITY[rarity] || SCRAP_YIELD_BY_RARITY.common;
        const factor = Math.max(1, Math.min(5, Math.round(Number(quantity) || 1)));

        const result = {};
        for (const [name, count] of Object.entries(yieldMap)) {
            result[name] = count * factor;
        }
        return result;
    }

    /**
     * Сколько предметов каждого сета надето (сет берём из items.set_id).
     * @returns {Record<number, number>} set_id -> количество
     */
    function collectSetPieceCounts(equipment) {
        const counts = {};
        if (!equipment) return counts;

        for (const slot of COMBAT_SLOTS) {
            const item = equipment[slot];
            if (!item) continue;
            const setId = Number(item.set_id || (item.stats && item.stats.set_id) || 0);
            if (!setId) continue;
            counts[setId] = (counts[setId] || 0) + 1;
        }
        return counts;
    }

    /**
     * Бонусы сетов от надетых предметов.
     * Уровень бонуса = число надетых предметов сета (2, 3 или 4).
     * @param {object} equipment экипировка игрока
     * @param {Array} sets строки item_sets (с bonus_2/bonus_3/bonus_4)
     * @returns {Record<string, number>} суммарные бонусы
     */
    function calculateSetBonuses(equipment, sets) {
        const totals = {};
        if (!Array.isArray(sets) || sets.length === 0) return totals;

        const counts = collectSetPieceCounts(equipment);
        for (const set of sets) {
            const count = counts[Number(set && set.id)] || 0;
            if (count < 2) continue;

            const tier = count >= 4 ? 4 : (count === 3 ? 3 : 2);
            const bonus = set[`bonus_${tier}`];
            if (!bonus || typeof bonus !== 'object') continue;

            for (const [key, value] of Object.entries(bonus)) {
                const numeric = Number(value);
                if (Number.isFinite(numeric)) {
                    totals[key] = (totals[key] || 0) + numeric;
                }
            }
        }
        return totals;
    }

    /* ================= МАГАЗИН ЗА ЗВЁЗДЫ =================
     *
     * Каталог покупок жил в двух копиях: BUFFS_CONFIG/COSMETICS_CONFIG на
     * сервере (routes/game/minigames.js) и SHOP_ITEMS в клиенте. Цены
     * совпадали — пока совпадали. Любая правка одной стороны показывала бы
     * игроку одну цену и списывала другую, а проверка баланса в клиенте
     * (`player.stars < item.price`) отказала бы при достаточном числе звёзд.
     *
     * Правило простое: цену, эффект и длительность знает только эта таблица.
     * Колесо удачи устроено так же — клиент берёт призы из ответа сервера.
     */
    const STAR_SHOP_ITEMS = Object.freeze([
        // Баффы
        Object.freeze({ id: 'buff_loot_1h', name: 'x2 Добыча', desc: 'Удвоенный лут на 1 час', icon: '📦', price: 5, category: 'buffs', duration: 3600, effect: 'loot_x2' }),
        Object.freeze({ id: 'buff_energy_1h', name: 'Бесплатная энергия', desc: 'Энергия не тратится 1 час', icon: '⚡', price: 3, category: 'buffs', duration: 3600, effect: 'free_energy' }),
        Object.freeze({ id: 'buff_radiation_1h', name: 'Анти-rad', desc: 'Защита от радиации 1 час', icon: '☢️', price: 2, category: 'buffs', duration: 3600, effect: 'no_radiation' }),
        Object.freeze({ id: 'buff_exp_1h', name: 'x2 Опыт', desc: 'Удвоенный опыт 1 час', icon: '⬆️', price: 4, category: 'buffs', duration: 3600, effect: 'exp_x2' }),
        Object.freeze({ id: 'buff_loot_daily', name: 'x2 Добыча (24ч)', desc: 'Удвоенный лут на 24 часа', icon: '📦', price: 20, category: 'buffs', duration: 86400, effect: 'loot_x2' }),
        // Косметика
        Object.freeze({ id: 'cosm_glow_gold', name: 'Золотое свечение', desc: 'Золотое свечение вокруг профиля', icon: '✨', price: 50, category: 'cosmetics', type: 'effect', effect: 'glow_gold' }),
        Object.freeze({ id: 'cosm_glow_blue', name: 'Синее свечение', desc: 'Синее свечение вокруг профиля', icon: '💠', price: 30, category: 'cosmetics', type: 'effect', effect: 'glow_blue' }),
        Object.freeze({ id: 'cosm_frame_elite', name: 'Элитная рамка', desc: 'Особая рамка профиля', icon: '🖼️', price: 100, category: 'cosmetics', type: 'frame', effect: 'frame_elite' }),
        Object.freeze({ id: 'cosm_title_veteran', name: 'Звание: Ветеран', desc: 'Звание под ником', icon: '🎖️', price: 25, category: 'cosmetics', type: 'title', effect: 'title_veteran' }),
        Object.freeze({ id: 'cosm_particles_fire', name: 'Огненные частицы', desc: 'Огненные частицы при действиях', icon: '🔥', price: 40, category: 'cosmetics', type: 'particles', effect: 'particles_fire' })
    ]);

    /**
     * Товар магазина за звёзды по id.
     * @param {string} id идентификатор товара
     * @returns {object|null}
     */
    function getStarShopItem(id) {
        if (!id) return null;
        return STAR_SHOP_ITEMS.find((item) => item.id === id) || null;
    }

    /**
     * Товары одной категории ('buffs'/'cosmetics') в порядке каталога.
     * @param {string} category
     * @returns {Array<object>}
     */
    function getStarShopItemsByCategory(category) {
        return STAR_SHOP_ITEMS.filter((item) => item.category === category);
    }

    return {
        STAR_SHOP_ITEMS,
        getStarShopItem,
        getStarShopItemsByCategory,
        EQUIPMENT_SLOTS,
        COMBAT_SLOTS,
        resolveEquipmentSlot,
        RADIATION_KEYS,
        INFECTION_KEYS,
        DEFENSE_KEYS,
        LUCK_KEYS,
        MAX_INVENTORY_SLOTS,
        RISK_TIERS,
        RISK_PREPARED_MAX_SCORE,
        getRiskTierByScore,
        getExpForLevel,
        getTotalExpForLevel,
        HEALTH_REGEN_INTERVAL_MS,
        ENERGY_REGEN_INTERVAL_MS,
        ENERGY_PURCHASE_STARS_COST,
        ENERGY_PER_PURCHASE,
        CLAN_CREATE_COST,
        CLAN_DESCRIPTION_MAX,
        CLAN_NAME_MAX,
        WHEEL_PRIZES,
        WHEEL_FREE_SPIN_COOLDOWN_MS,
        HEALTH_REGEN_CAP_RATIO,
        DEFAULT_AUTO_HEAL_THRESHOLD,
        AUTO_HEAL_THRESHOLD_MIN,
        AUTO_HEAL_THRESHOLD_MAX,
        getHealthRegenCap,
        getRegenerableHealth,
        getAutoHealThreshold,
        selectHealItem,
        MAX_UPGRADE_LEVEL,
        UPGRADE_BONUS_PER_LEVEL,
        RARITY_ORDER,
        UPGRADE_MATERIAL_BY_RARITY,
        SCRAP_YIELD_BY_RARITY,
        BASE_PRICE_BY_RARITY,
        AMMO_ITEM_NAME,
        ROCKET_ITEM_NAME,
        MODIFICATIONS,
        MODIFICATION_BY_STAT,
        MAX_MODIFICATION_LEVEL,
        GAME_CONFIG,
        calculateDropChance,
        calculateCoinDrop,
        getEquipmentStatValue,
        sumEquipmentResistance,
        normalizeResistanceToThreatPoints,
        normalizeThreatLevelToPoints,
        calculateRadiationDefense,
        calculateInfectionDefense,
        normalizeRarity,
        getUpgradeLevel,
        getUpgradeMultiplier,
        isEquipmentItem,
        getDurabilityInfo,
        getEffectiveStatValue,
        calculateDefenseTotal,
        calculateEquipmentLuckBonus,
        applyDefenseReduction,
        wearEquipment,
        PRICE_MULTIPLIER_BY_TYPE,
        calculateRepairCost,
        calculateUpgradeCost,
        calculateScrapYield,
        getModificationLevel,
        getModificationBonus,
        calculateModificationCost,
        isModificationApplicable,
        rollVarianceDamage,
        collectSetPieceCounts,
        calculateSetBonuses
    };
}));
