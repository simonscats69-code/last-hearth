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

    // -------------------------------------------------------------------------
    // ТИРЫ РИСКА ЛОКАЦИЙ — общие границы клиента и сервера
    //
    // Раньше таблица тиров жила только в utils/gameConstants.js, а клиент в
    // getCurrentZoneRiskProfile() вёл собственные пороги (2/5/8 вместо 1/4/7).
    // Игрок видел «Стабильно» ровно там, где сервер уже начислял множители
    // риска за лут, опыт и шанс ключа. Теперь обе стороны берут границы отсюда.
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
     * Лимит слотов инвентаря.
     * Сервер отклоняет добычу при переполнении, клиент рисует полоску
     * заполнения — оба берут значение отсюда, иначе разъедутся.
     */
    const MAX_INVENTORY_SLOTS = 100;

    // -------------------------------------------------------------------------
    // ПРОЧНОСТЬ, УЛУЧШЕНИЯ, РАЗБОР И СЕТЫ — общие правила клиента и сервера
    //
    // Раньше items.durability / upgrade_level / max_upgrade_level / set_id были
    // мёртвыми колонками: снаряжение хранило их, но ни бой, ни экономика их не
    // читали. Вся арифметика ниже живёт в этом файле, потому что её обязаны
    // считать одинаково сервер (урон, защита, цена ремонта) и браузер
    // (подписи «прочность 12/50», «апгрейд +3», «разобрать → материалы»).
    // -------------------------------------------------------------------------

    /** Максимальный уровень улучшения предмета */
    const MAX_UPGRADE_LEVEL = 10;

    /** Прибавка к урону/защите за каждый уровень улучшения (8%) */
    const UPGRADE_BONUS_PER_LEVEL = 0.08;

    /** Порядок редкостей от обычной к легендарной */
    const RARITY_ORDER = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);
/**
     * Формула опыта до следующего уровня — ОБЩАЯ для клиента и сервера.
     *
     * Раньше она была продублирована: своя копия в utils/gameConstants.js для
     * начисления опыта и вторая в public/game.js для полоски опыта. Любая
     * правка одной из них рассинхронизировала начисление опыта с его
     * отображением. Теперь обе стороны берут формулу отсюда.
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

    /* ================= ЭНЕРГИЯ =================
     *
     * +1 энергия за ENERGY_REGEN_INTERVAL_MS. Раньше интервал был зашит
     * четыре раза (сервер recalcEnergy, клиентские CONSTANTS,
     * getTimeToNextEnergy и тик статуса) — смена баланса требовала помнить
     * о каждой копии, а расхождение видно только по секундомеру игрока.
     */
    const ENERGY_REGEN_INTERVAL_MS = 60 * 1000;

    /* ================= ОЗДОРОВЛЕНИЕ И ЛЕЧЕНИЕ =================
     *
     * Раньше здоровье росло ТОЛЬКО от предметов: кончились аптечки — игрок
     * застревал, а в бою с боссом нужно было вручную лезть в инвентарь.
     *
     * Теперь три слоя:
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
     * Пустое значение (null/undefined/'') — это «настройка не задана»,
     * а не ноль: Number(null) === 0 проходил проверку isFinite и молча
     * зажимался в минимум 10%, пока интерфейс в том же случае показывал
     * дефолтные 35% (Number(x) || DEFAULT_AUTO_HEAL_THRESHOLD в player.js
     * и game.js). Сервер лечился по 10%, игрок видел 35% — то же
     * расхождение UI/БД, что и у P0-2.
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
        // stack не указан вовсе — считаем, что предмета хватает (1 шт).
        // Но ЯВНЫЙ 0 — пустой стек: раньше `stack || 1` превращал ноль
        // в единицу, и автолечение выбирало предмет, которого у игрока нет
        // (та же ловушка `||`, что и в P1-5 со стаками инвентаря).
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
 * Раньше слот брался как `item.slot || item.type || 'accessory'`, и любой
 * предмет без слота (еда, расходники, старые записи инвентаря) попадал в
 * слот типа своего типа — например «food». Такой слот не участвует ни в
 * защите, ни в износе: предмет молча исчезал из инвентаря и не давал бонусов.
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
     * Модификации снаряжения.
     *
     * Раньше колонка items.modifications была мёртвой: бой её не читал, а
     * тратить на неё было нечего. Теперь это второй, параллельный апгрейду
     * трек развития: «Заточка» добавляет плоский урон оружию, «Облицовка» —
     * плоскую защиту броне. Плоский, а не процентный бонус: апгрейд уже даёт
     * +8% за уровень, иначе модификация просто удваивала бы его эффект.
     *
     * Материалы различаются по типу: у оружия — металл/провода, у брони —
     * ткань и дерево. Так в игре задействуются материалы, которые после
     * удаления крафта остались без применения (Ткань, Древесина, Провода).
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
        common: 20,
        uncommon: 80,
        rare: 300,
        epic: 2500,
        legendary: 12000
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
     * @returns {{current:number,max:number,isBroken:boolean,ratio:number}}
     */
    function getDurabilityInfo(item) {
        const maxRaw = Number(item && (item.max_durability || item.durability));
        const max = Math.max(1, Math.round(Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 100));

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
     * @param {number} baseDamage базовый урон
     * @param {number} variancePercent разброс в процентах (0 — без разброса)
     * @returns {number} фактический урон
     */
    function rollVarianceDamage(baseDamage, variancePercent) {
        const base = Math.max(0, Number(baseDamage) || 0);
        const variance = Math.max(0, Math.min(100, Number(variancePercent) || 0));
        if (variance === 0 || base === 0) return Math.max(1, Math.round(base));

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
     */
    function wearEquipment(item, amount = 1) {
        if (!isEquipmentItem(item)) return item;

        const info = getDurabilityInfo(item);
        const wear = Math.max(0, Math.round(Number(amount) || 0));

        return {
            ...item,
            durability: Math.max(0, info.current - wear),
            max_durability: info.max
        };
    }

    /**
     * Цена ремонта: половина стоимости предмета за полный износ.
     * @returns {number} монеты (0 — ремонт не нужен)
     */
    function calculateRepairCost(item) {
        const info = getDurabilityInfo(item);
        const missing = info.max - info.current;
        if (missing <= 0) return 0;

        const rarity = normalizeRarity(item && item.rarity);
        const basePrice = Number(item && item.price) || BASE_PRICE_BY_RARITY[rarity];
        return Math.max(1, Math.ceil((missing / info.max) * basePrice * 0.5));
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
        const coins = Math.max(20, Math.round(basePrice * 0.6 * (level + 1)));

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