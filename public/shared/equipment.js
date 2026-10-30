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
 * Инфекции объединены с радиацией: раньше это были ДВА дебаффа с двумя
 * колонками (players.radiation и players.infections), двумя типами
 * (DEBUFF_TYPES.RADIATION / INFECTION), двумя конфигами и двумя формулами
 * начисления. Теперь одно «заражение» — players.radiation. Ключи сопротивления
 * и лечения с обоих типов сходятся в одну защиту, поэтому старая экипировка
 * (Противогаз, Медицинские перчатки, броня Врача) продолжает работать без
 * миграции данных.
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
     *
     * Одно физическое место = одно имя слота. Раньше здесь стояли и 'helmet',
     * и 'head' (а также 'armor' и 'body'): два имени на одно место означали,
     * что calculateDefenseTotal складывал защиту ОБОИХ слотов, и игрок мог
     * надеть каску (helmet) и противогаз (head) одновременно, получив защиту
     * двух головных предметов. Теперь:
     *   helmet — шлемы и каски;
     *   face   — маски, противогазы, банданы (защита лица);
     *   armor  — бронежилеты;
     *   body   — куртки, плащи, костюмы.
     * Слот 'head' удалён: он был алиасом 'helmet'.
     */
    const EQUIPMENT_SLOTS = Object.freeze([
        'armor', 'helmet', 'face', 'body', 'hands', 'legs', 'boots', 'accessory'
    ]);

    /**
     * Ключи сопротивления зоне. Инфекции объединены с радиацией, поэтому
     * infection_* и radiation_* дают одну и ту же защиту: старые предметы
     * с infection_resist не потерялись, а новых «отдельных» характеристик
     * больше нет.
     */
    const CONTAMINATION_KEYS = Object.freeze([
        'radiation_resist', 'radiation_resistance', 'radiationDefense',
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
     * Защита от заражения зоной из экипировки, в очках.
     *
     * Одна функция вместо прежних calculateRadiationDefense и
     * calculateInfectionDefense: инфекции объединены с радиацией, поэтому
     * все ключи сопротивления (radiation_* и infection_*) сходятся в одну
     * защиту.
     *
     * @param {object|null} equipment
     * @returns {number}
     */
    /**
     * Сколько очков угрозы даёт «сырое» значение зоны (10 -> 1 очко).
     * Зеркало normalizeResistanceToThreatPoints, но с округлением ВВЕРХ:
     * локация округляется «в плюс», чтобы игрок видел худший случай.
     *
     * @param {number} rawLevel
     * @returns {number}
     */
    function normalizeThreatLevelToPoints(rawLevel) {
        return Math.max(0, Math.ceil(Number(rawLevel || 0) / 10));
    }

    /**
     * Суммарная угроза локации: радиация и инфекция дают одно «заражение».
     *
     * Раньше это были две независимые величины с двумя формулами
     * начисления в world.js; теперь общее число, из которого и получается
     * уровень радиации. Локации хранят radiation и infection по отдельности
     * (это данные мира), но в бою/начислении они одно.
     *
     * @param {object} location {radiation, infection}
     * @returns {number}
     */
    function calculateLocationContaminationThreat(location) {
        if (!location || typeof location !== 'object') return 0;
        const radiation = normalizeThreatLevelToPoints(location.radiation);
        const infection = normalizeThreatLevelToPoints(location.infection);
        return radiation + infection;
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
     * С какого уровня заражение начинает отнимать здоровье.
     *
     * Единственное место, где задан этот порог. Раньше «5» было вписано
     * руками в routes/game/status.js и routes/game/debuffs.js — при смене
     * баланса одно из двух мест легко забывалось, и урон в разных экранах
     * расходился.
     */
    const CONTAMINATION_DAMAGE_FROM_LEVEL = 5;

    /**
     * Тиры риска по давлению заражения локации.
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
    /**
     * Формула опыта до следующего уровня.
     * Мягкая экспонента: 400 * level^1.25 — растёт плавнее, чем линейная,
     * но всё ещё требует всё больше фарма на высоких уровнях.
     *
     * @param {number} level текущий уровень
     * @returns {number} сколько опыта нужно до следующего уровня
     */
    function getExpForLevel(level) {
        const lvl = Math.max(1, Number(level) || 1);
        return Math.round(400 * Math.pow(lvl, 1.25));
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
    /* ================= БРОНЯ И ЗАЩИТА =================
     *
     * Защита снижает долю входящего урона (см. applyDefenseReduction):
     * reduction = defense/(defense+100) * 100 — без потолка, защита может
     * снижать урон до 100% (полное поглощение).
     */

    /** Потолок снижения брони: убран. Защита может снижать урон до 100%. */
    // const DEFENSE_CAP_PERCENT = 60;

    /** Сколько защиты даёт каждый новый уровень игрока */
    const DEFENSE_PER_PLAYER_LEVEL = 3;

    /**
     * Защита, накопленная уровнями (без экипировки).
     * Каждый новый уровень даёт +3: считается от уровня, а не хранится
     * колонкой — сохранённое значение разъехалось бы с уровнем при правке
     * админкой или при создании игрока сразу с уровнем.
     * @param {number} playerLevel текущий уровень игрока
     * @returns {number} защита за уровни
     */
    function calculateLevelDefense(playerLevel) {
        const level = Math.max(1, Math.floor(Number(playerLevel) || 1));
        return (level - 1) * DEFENSE_PER_PLAYER_LEVEL;
    }

    /** +1 энергия за столько миллисекунд. Тот же интервал у сервере (recalcEnergy). */
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
    const CLAN_CREATE_COST = 100000;

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
        const luckNum = Number.isFinite(luck) ? luck : 0;
        if (luckNum <= 0) return GAME_CONFIG.BASE_DROP_CHANCE || 5;
        const chance = (GAME_CONFIG.BASE_DROP_CHANCE || 5) + (luckNum * 0.4);
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
        const luckNum = Number.isFinite(luck) ? luck : 0;
        const levelNum = Number.isFinite(playerLevel) ? Math.max(1, Math.floor(playerLevel)) : 1;
        
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
        const luckMultiplier = 1 + (luckNum * 0.01);
        const levelMultiplier = 1 + (levelNum * 0.05);
        
        const amount = Math.floor(BASE_COIN_AMOUNT * riskMultiplier * luckMultiplier * levelMultiplier);
        const finalAmount = Math.min(MAX_COIN_AMOUNT, Math.max(1, amount));
        
        return { amount: finalAmount };
    }

    /* ================= ОЗДОРОВЛЕНИЕ И ЛЕЧЕНИЕ =================
     *
     * Три слоя лечения:
     *   1) пассивное восстановление — медленное, до полного здоровья;
     *   2) автолечение — расходует самый экономный предмет из инвентаря;
     *   3) ручное лечение — кнопки прямо на главном экране.
     *
     * Баланс: реген доводит до полного здоровья, поэтому аптечки в бою
     * нужны только для срочного лечения во время боя; реген восстанавливает
     * между боями.
     */

    /** +1 HP за столько миллисекунд */
    const HEALTH_REGEN_INTERVAL_MS = 90 * 1000;
const HEALTH_REGEN_CAP_RATIO = 0.6;

/** Потолок регенерации HP (60% от максимума) */
    function getHealthRegenCap(maxHealth) {
        return Math.max(0, Math.round((Number(maxHealth) || 0) * HEALTH_REGEN_CAP_RATIO));
    }

/** Сколько HP можно восстановить регеном */
    function getRegenerableHealth(currentHealth, maxHealth) {
        const cap = getHealthRegenCap(maxHealth);
        const missing = Math.max(0, (Number(maxHealth) || 0) - (Number(currentHealth) || 0));
        return Math.max(0, Math.min(cap, missing));
    }

    /** Порог автолечения по умолчанию, % от максимума */

    /** Границы настройки порога автолечения */

    /** Регенерация здоровья без ограничений — реген может вернуть до 100% максимума. */

    /**
     * Определить слот экипировки для предмета.
     *
     * Предмет без слота (например еда) обязан вернуть null: слот типа
     * item.type не участвует ни в защите, ни в износе.
     *
     * Порядок: явный слот каталога -> category (для брони это и есть слот:
     * armor/helmet/face/body/hands/legs/boots/accessory). Возвращает null,
     * если слот неизвестен: вызывающий код обязан отказать, а не гадать.
     *
     * Про item.type здесь был ХАК: «у брочки type может быть 'armor', это
     * валидный слот». Он ломал ровно то, что должен был чинить. type='armor'
     * стоит у ВСЕЙ брони — касок, масок, жилетов, перчаток, ботинок, — это
     * тип предмета, а не место на теле. Из-за фоллбэка на type предмет, чей
     * slot и category устарели (Противогаз со старым slot='head'), попадал в
     * слот 'armor' и вытеснял оттуда бронежилет. Единственное однозначное
     * соответствие тип -> слот в схеме это 'weapon' (type='weapon', slot
     * 'weapon'), его и оставляем.
     *
     * @param {object} item предмет инвентаря или экипировки
     * @returns {string|null} валидный слот или null
     */
function resolveEquipmentSlot(item) {
    if (!item || typeof item !== 'object') return null;

    const candidates = [
        item.slot,
        item.category,
        // Только 'weapon' — единственный тип, который одновременно и слот.
        item.type === 'weapon' ? 'weapon' : null
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
        const maxRaw = Number(item && (item.max_durability !== undefined ? item.max_durability : item.durability));
        const max = Math.max(1, Math.round(Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 500));

        // Полей прочности нет вообще (расходник, валюта, пустой объект) —
        // предмет условно «бесконечен»: не ломается и не изнашивается.
        const hasDurabilityData = Boolean(item && (item.durability !== undefined || item.max_durability !== undefined));
        if (!hasDurabilityData) {
            return { current: max, max, isBroken: false, ratio: 1 };
        }

        // Поля прочности ЕСТЬ — показываем их честно, независимо от
        // isEquipmentItem.
        //
        // Раньше здесь стояло `if (!isEquipmentItem(item)) return {current: max...}`,
        // то есть для предмета без type/slot функция ВСЕГДА возвращала
        // «целый». Объект с durability: 0, но без type/slot (предмет из старого
        // сохранения, собранный вручную, или пришедший по API без этих полей)
        // выглядел полностью исправным: панель не показывала «сломано»,
        // calculateRepairCost считал ремонт ненужным, wearEquipment не
        // уменьшал износ. Экипировка из БД всегда имеет type и slot, поэтому
        // на живых данных поведение не меняется — исправляется только ложь.
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
     * Состояние прочности для UI: CSS-класс и подпись.
     *
     * Пороги раньше были размазаны по двум местам с разными числами:
     * карточка предмета в «Вещах» (25/60) и слот в бою (20/50). Один и тот
     * же предмет при 22% прочности в бою читался как «Износ», а в карточке —
     * как «Почти сломано».
     *
     * Here — единственный источник: ключ используется и как CSS-класс,
     * и для выбора подписи вызвавшим кодом.
     *
     * @param {number} percent оставшаяся прочность в процентах (0..100)
     * @returns {{state: 'broken'|'critical'|'low'|'ok'}} ключ состояния
     */
    function getDurabilityState(percent) {
        const ratio = Math.max(0, Math.min(100, Number(percent) || 0));
        if (ratio <= 0) return { state: 'broken' };
        if (ratio <= 25) return { state: 'critical' };
        if (ratio <= 60) return { state: 'low' };
        return { state: 'ok' };
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
        if (!item || typeof item !== 'object') return null;
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
        const baseRaw = Number(baseDamage);
        const base = Number.isFinite(baseRaw) ? Math.max(0, baseRaw) : 0;
        const varianceRaw = Number(variancePercent);
        const variance = Number.isFinite(varianceRaw) ? Math.max(0, Math.min(100, varianceRaw)) : 0;
        if (base === 0) return 0;
        if (variance === 0) return Math.max(1, Math.round(base));

        const factor = 1 - variance / 100 + Math.random() * (2 * variance / 100);
        return Math.max(1, Math.floor(base * factor));
    }

    /* ================= УРОН ОРУЖИЯ ПО КОНТЕКСТУ БОЯ =================
     *
     * Оружие с полем stats.boss_bonus бьёт сильнее боссов, а с полем
     * stats.pvp_bonus — сильнее в PvP. Раньше это правило жило ДВЕЖДЫ:
     *   - routes/game/bosses.js: getWeaponContextMultiplier() читал
     *     boss_bonus, но НЕ применял stats.variance;
     *   - db/pvp.js: инлайном читало pvp_bonus и применяло variance.
     *
     * Из-за этого одно и то же оружие вело себя по-разному: дробовик с
     * разбросом ±25% давал случайный урон в PvP и детерминированный
     * против боссов, а формула «1 + percent/100» была скопирована в оба
     * файла и могла разъехаться при правке баланса.
     */

    /**
     * Контексты боя, в которых оружие получает бонус.
     */
    const WEAPON_CONTEXTS = Object.freeze({ BOSS: 'boss', PVP: 'pvp' });

    /**
     * Множитель бонуса оружия для контекста: 1.4 при boss_bonus = 40.
     *
     * Процент ограничен 100: иначе «+500%» превращало бы оружие в
     * одноударное убийство любого босса.
     *
     * @param {object|null} item оружие из экипировки
     * @param {'boss'|'pvp'} context контекст боя
     * @returns {number} множитель, 1 — если бонуса нет
     */
    function getWeaponContextMultiplier(item, context) {
        if (!item || typeof item !== 'object') return 1;

        const stats = (item.stats && typeof item.stats === 'object') ? item.stats : {};
        const key = context === WEAPON_CONTEXTS.BOSS ? 'boss_bonus' : 'pvp_bonus';
        const percent = Number(stats[key]) || 0;
        if (percent <= 0) return 1;

        return 1 + Math.min(100, percent) / 100;
    }

    /**
     * Итоговый урон оружия: бонус за контекст боя, затем разброс.
     *
     * Разброс применяется ТОЛЬКО к урону оружия, не к базовому урону
     * бойца: ±25% от всего урона ломали бы весь расчёт.
     *
     * Сумма бонуса и разброса одинакова для боя с боссом и PvP — раньше
     * боссовый путь игнорировал stats.variance, и дробовик стрелял
     * «всегда в цель» против боссов.
     *
     * @param {object|null} item оружие из экипировки
     * @param {'boss'|'pvp'} context контекст боя
     * @returns {number} урон оружия
     */
    function getWeaponDamageForContext(item, context) {
        const base = getEffectiveStatValue(item, ['damage']);
        if (base <= 0) return 0;

        const stats = (item.stats && typeof item.stats === 'object') ? item.stats : {};
        const bonus = getWeaponContextMultiplier(item, context);
        return rollVarianceDamage(base * bonus, Number(stats.variance) || 0);
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
        for (const slot of EQUIPMENT_SLOTS) {
            total += getEffectiveStatValue(equipment[slot], DEFENSE_KEYS);
        }
        return total;
    }

    /** Суммарная прибавка к удаче из экипировки (влияет на шанс находки) */
    function calculateEquipmentLuckBonus(equipment) {
        if (!equipment) return 0;
        let total = 0;
        for (const slot of EQUIPMENT_SLOTS) {
            total += getEffectiveStatValue(equipment[slot], LUCK_KEYS);
        }
        return total;
    }

    /**
     * Снижение входящего урона защитой.
     *
     * Убран Math.max(1, ...) — функция может вернуть 0. Пол урона решает
     * вызывающая сторона: в PvP гарантирован минимум 1 (см. db/pvp.js),
     * а ответный удар босса идёт БЕЗ пола. Иначе почти добитый босс с сырым
     * уроном 0 всё равно бил бы на 1 — ровно это ломало договорённость «чем
     * сильнее побит босс, тем слабее он бьёт».
     *
     * @param {number} damage входящий урон
     * @param {number} defense защита
     * @returns {number} итоговый урон (не меньше 0)
     */
    function applyDefenseReduction(damage, defense) {
        const incomingRaw = Number(damage);
        const defenseRaw = Number(defense);
        const incoming = Number.isFinite(incomingRaw) ? Math.max(0, Math.round(incomingRaw)) : 0;
        const defenseTotal = Number.isFinite(defenseRaw) ? Math.max(0, Math.floor(defenseRaw)) : 0;
        if (defenseTotal <= 0) return incoming;

        const reduction = (defenseTotal / (defenseTotal + 100)) * 100;
        return Math.max(0, Math.floor(incoming * (1 - reduction / 100)));
    }

    /**
     * Износ предмета: возвращает НОВЫЙ объект (исходный не мутируется).
     * Прочность не уходит в минус: при нуле предмет «сломан» — бонусов не даёт
     * (см. getEffectiveStatValue), но остаётся в инвентаре, его можно починить.
     * 
     * Износ за удар: GAME_CONFIG.WEAR_PER_HIT = 0.5 единицы
     * (1 единица за 2 удара).
     */
    function wearEquipment(item, amount = 1) {
        if (!isEquipmentItem(item)) return { ...item };

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
        if (!item || typeof item !== 'object') return 0;
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
        if (!item || typeof item !== 'object') return null;
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
            const setId = Number(item.set_id !== undefined && item.set_id !== null ? item.set_id : (item.stats && item.stats.set_id !== undefined ? item.stats.set_id : 0));
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
            if (!set || typeof set !== 'object') continue;
            const count = counts[Number(set.id)] || 0;
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

    /* ================= БАЛАНС ПОИСКА ЛУТА =================
     *
     * Опыт за поиск, бонусы редкости, комбо и локации — единый источник
     * для клиента и сервера (routes/game/world.js).
     */

    /** Базовый опыт за находку до множителей локации, комбо и риска. */
    const SEARCH_BASE_XP = 15;

    /** Бонус опыта по редкости. common не даёт прибавки. */
    const SEARCH_RARITY_XP = Object.freeze({
        common: 0,
        uncommon: 3,
        rare: 7,
        epic: 11,
        legendary: 15
    });

    /** Каждый N-й поиск даёт комбо-бонус. */
    const SEARCH_COMBO_EVERY = 10;

    /** Множитель комбо на юбилейном действии. */
    const SEARCH_COMBO_MULTIPLIER = 1.5;

    /* ================= КЛАНЫ ================= */

    /** Максимальная сумма одного пожертвования в казну клана (монет). */
    const MAX_DONATION_COINS = 1000000;

    /* ================= ЕЖЕДНЕВНЫЙ БОНУС ================= */

    /** Интервал между ежедневными бонусами (24 часа). */
    const DAILY_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

    /** Лимит серии ежедневных бонусов. */
    const DAILY_BONUS_STREAK_LIMIT = 7;

    /** Базовая награда за первый день. */
    const DAILY_BONUS_BASE_COINS = 25;

    /** Прирост монет за каждый следующий день серии. */
    const DAILY_BONUS_COINS_PER_DAY = 25;

    /** Каждый N-й день серии даёт звезду. */
    const DAILY_BONUS_STAR_EVERY = 3;

    /* ================= БОССЫ ================= */

    /** Базовый урон игрока по боссу. */
    const BOSS_BASE_DAMAGE = 3;

    /** Прибавка урона за каждый уровень игрока при атаке босса. */
    const BOSS_DAMAGE_PER_LEVEL = 2;

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
    CONTAMINATION_KEYS,
    DEFENSE_KEYS,
    LUCK_KEYS,
    MAX_INVENTORY_SLOTS,
    RISK_TIERS,
    RISK_PREPARED_MAX_SCORE,
    CONTAMINATION_DAMAGE_FROM_LEVEL,
    getRiskTierByScore,
    getExpForLevel,
    getTotalExpForLevel,
    HEALTH_REGEN_INTERVAL_MS,
HEALTH_REGEN_CAP_RATIO,
getHealthRegenCap,
getRegenerableHealth,
    ENERGY_REGEN_INTERVAL_MS,
    ENERGY_PURCHASE_STARS_COST,
    ENERGY_PER_PURCHASE,
    CLAN_CREATE_COST,
    CLAN_DESCRIPTION_MAX,
    CLAN_NAME_MAX,
    WHEEL_PRIZES,
    WHEEL_FREE_SPIN_COOLDOWN_MS,
    DEFENSE_PER_PLAYER_LEVEL,
    calculateLevelDefense,
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
    calculateLocationContaminationThreat,
    normalizeRarity,
    getUpgradeLevel,
    getUpgradeMultiplier,
    isEquipmentItem,
    getDurabilityInfo,
    getDurabilityState,
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
    WEAPON_CONTEXTS,
    getWeaponContextMultiplier,
    getWeaponDamageForContext,
    collectSetPieceCounts,
    calculateSetBonuses,
    // Поиск лута
    SEARCH_BASE_XP,
    SEARCH_RARITY_XP,
    SEARCH_COMBO_EVERY,
    SEARCH_COMBO_MULTIPLIER,
    // Кланы
    MAX_DONATION_COINS,
    // Ежедневный бонус
    DAILY_BONUS_COOLDOWN_MS,
    DAILY_BONUS_STREAK_LIMIT,
    DAILY_BONUS_BASE_COINS,
    DAILY_BONUS_COINS_PER_DAY,
    DAILY_BONUS_STAR_EVERY,
    // Боссы
    BOSS_BASE_DAMAGE,
    BOSS_DAMAGE_PER_LEVEL,
    };
}));
