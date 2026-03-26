/**
 * Константы и формулы игры
 * Централизованное хранилище игровой логики
 */

// Формулы опыта
const EXP_FORMULA = {
    LOW_LEVEL_EXP: 200,      // Опыт для уровней 1-10
    LOW_LEVEL_CAP: 10,       // Порог перехода на экспоненту
    EXPONENT: 2.2,           // Показатель степени для формулы
    BASE_MULTIPLIER: 150
};

/**
 * Расчёт опыта для уровня (долгосрочная игра)
 * Формула: линейная после 10 уровня
 * @param {number} level - Уровень игрока
 * @returns {number} Опыт для следующего уровня
 */
function getExpForLevel(level) {
    // Линейная формула: level * 500 XP за уровень
    // Пример: 1→2 нужно 500, 2→3 нужно 1000, 10→11 нужно 5000
    return level * 500;
}

/**
 * Расчёт общего опыта для уровня
 * @param {number} level - Уровень игрока
 * @returns {number} Общий опыт для достижения уровня
 */
function getTotalExpForLevel(level) {
    let total = 0;
    for (let i = 1; i < level; i++) {
        total += getExpForLevel(i);
    }
    return total;
}

const GAME_CONFIG = {
    // Базовые настройки
    BASE_DROP_CHANCE: 8,        // Базовый шанс дропа (%)
    MAX_DROP_CHANCE: 60,         // Максимальный шанс дропа (%)
    MAX_LUCK: 150,               // Максимальная удача игрока
    // УДАЛЕНО: константы крафта (BASE_CRAFT_SUCCESS, MAX_CRAFT_SUCCESS, RARITY_CRAFT_PENALTIES)
};

const RISK_TIERS = [
    {
        key: 'safe',
        label: 'Стабильно',
        maxScore: 1,
        rewardMultiplier: 1,
        keyChanceMultiplier: 1,
        rarityLuckBonus: 0,
        expMultiplier: 1
    },
    {
        key: 'warning',
        label: 'Риск',
        maxScore: 4,
        rewardMultiplier: 1.12,
        keyChanceMultiplier: 1.35,
        rarityLuckBonus: 6,
        expMultiplier: 1.18
    },
    {
        key: 'danger',
        label: 'Опасно',
        maxScore: 7,
        rewardMultiplier: 1.28,
        keyChanceMultiplier: 1.75,
        rarityLuckBonus: 12,
        expMultiplier: 1.4
    },
    {
        key: 'deadly',
        label: 'Смертельно',
        maxScore: Number.POSITIVE_INFINITY,
        rewardMultiplier: 1.5,
        keyChanceMultiplier: 2.25,
        rarityLuckBonus: 18,
        expMultiplier: 1.7
    }
];

/**
 * Рассчитать шанс дропа (монотонно растущий)
 * @param {number} luck - Удача игрока
 * @returns {number} Шанс дропа в процентах
 */
function calculateDropChance(luck) {
    // Защита от отрицательной или нулевой удачи
    if (luck <= 0) return 5;

    // Единая формула поиска: только удача игрока влияет на шанс находки.
    // luck 1 → 10.4%, 30 → 22%, 60 → 34%, 100 → 50%, 125+ → 60%
    const chance = 10 + (luck * 0.4);
    return Math.min(GAME_CONFIG.MAX_DROP_CHANCE, Math.round(chance * 10) / 10);
}

// УДАЛЕНО: функция calculateCraftSuccess() - система крафта удалена

// Таблицы лута по локациям
const LOOT_TABLES = {
    1: { common: 100, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
    2: { common: 65, uncommon: 28, rare: 6, epic: 1, legendary: 0 },
    3: { common: 50, uncommon: 35, rare: 12, epic: 3, legendary: 0 },
    4: { common: 35, uncommon: 35, rare: 22, epic: 7, legendary: 1 },
    5: { common: 25, uncommon: 30, rare: 30, epic: 12, legendary: 3 },
    6: { common: 15, uncommon: 25, rare: 35, epic: 20, legendary: 5 },
    7: { common: 10, uncommon: 20, rare: 35, epic: 25, legendary: 10 }
};

/**
 * Получить таблицу лута для локации
 * @param {number} locationId - ID локации
 * @returns {object} Таблица вероятностей
 */
function getLootTable(locationId) {
    return LOOT_TABLES[locationId] || LOOT_TABLES[1];
}

/**
 * Определить редкость выпавшего предмета
 * @param {number} locationId - ID локации
 * @param {number} luck - Удача игрока (влияет на шанс редкости)
 * @returns {string} Редкость предмета
 */
function rollItemRarity(locationId, luck = 1) {
    const table = getLootTable(locationId);
    const roll = Math.random() * 100;
    
    // Бонус удачи к редкости: каждый пункт удачи даёт +0.1% к редким предметам
    // max бонус = 15% (при luck = 150)
    const luckBonus = Math.min(15, luck * 0.1);
    
    // Модифицируем таблицу с учётом удачи
    const modifiedTable = { ...table };
    
    // Распределяем бонус удачи: чем выше редкость, тем больший бонус
    if (luck > 10) {
        // legendary: полный бонус
        modifiedTable.legendary = Math.min(25, (modifiedTable.legendary || 0) + luckBonus);
        // epic: 80% от бонуса
        modifiedTable.epic = Math.min(40, (modifiedTable.epic || 0) + (luckBonus * 0.8));
        // rare: 50% от бонуса
        modifiedTable.rare = Math.min(50, (modifiedTable.rare || 0) + (luckBonus * 0.5));
        // uncommon: 20% от бонуса
        modifiedTable.uncommon = Math.min(50, (modifiedTable.uncommon || 0) + (luckBonus * 0.2));
        // common: уменьшаем на сумму добавленного
        const addedBonus = (luckBonus * 0.1) + (luckBonus * 0.08) + (luckBonus * 0.05) + (luckBonus * 0.02);
        modifiedTable.common = Math.max(0, (modifiedTable.common || 0) - addedBonus);
    }
    
    let cumulative = 0;
    for (const [rarity, chance] of Object.entries(modifiedTable)) {
        cumulative += chance;
        if (roll <= cumulative) {
            return rarity;
        }
    }
    return 'common';
}

/**
 * Определить, выпал ли предмет
 * @param {Array|Object} lootTable - Таблица лута для локации (массив предметов или объект вероятностей)
 * @param {number} luck - Удача игрока
 * @param {string} itemRarity - Редкость предмета
 * @returns {Object|null} Найденный предмет или null
 */
function rollLootDrop(lootTable, luck, itemRarity) {
    const dropChance = calculateDropChance(luck);
    const roll = Math.random() * 100;
    
    if (roll > dropChance) {
        return null;
    }
    
    // Если lootTable - объект (таблица вероятностей), возвращаем null
    // Предметы должны выбираться из БД отдельно
    if (!Array.isArray(lootTable)) {
        return null;
    }
    
    // Фильтруем таблицу лута по редкости
    const filteredItems = lootTable.filter(item => item.rarity === itemRarity);
    
    if (filteredItems.length === 0) {
        return null;
    }
    
    // Случайный предмет из отфильтрованных
    return filteredItems[Math.floor(Math.random() * filteredItems.length)];
}

// Категории предметов
const ITEM_CATEGORIES = {
    food: { min: 1, max: 5, name: 'Еда' },
    medicine: { min: 6, max: 10, name: 'Медикаменты' },
    weapon: { min: 11, max: 16, name: 'Оружие' },
    armor: { min: 17, max: 20, name: 'Броня' },
    resource: { min: 21, max: 28, name: 'Ресурсы' },
    key: { min: 29, max: 29, name: 'Ключи' }
};

/**
 * Получить категорию предмета
 * @param {number|string} itemId - ID предмета
 * @returns {string}
 */
function getItemCategory(itemId) {
    const id = parseInt(itemId);
    
    for (const [category, range] of Object.entries(ITEM_CATEGORIES)) {
        if (id >= range.min && id <= range.max) {
            return category;
        }
    }
    return 'unknown';
}



// Типы дебаффов
const DEBUFF_TYPES = {
    RADIATION: 'radiation',
    INFECTION: 'zombie_infection'
};

// Конфигурация дебаффов
const DEBUFF_CONFIG = {
    // Радиация
    radiation: {
        baseDurationMs: 4 * 60 * 60 * 1000,  // 4 часа в мс
        durationPerLevelMs: 90 * 60 * 1000,  // +1.5 часа за уровень
        maxLevel: 10,
        minLevel: 1,
        damagePerLevel: 1,  // урон здоровью в час при level >= 5
        regenRateMs: 30 * 60 * 1000  // естественное снижение каждые 30 мин
    },
    // Инфекция
    infection: {
        baseDurationMs: 8 * 60 * 60 * 1000,  // 8 часов
        durationPerLevelMs: 3 * 60 * 60 * 1000,  // +3 часа за уровень
        maxLevel: 10,
        minLevel: 1,
        damagePerLevel: 2,  // урон здоровью в час
        regenRateMs: 60 * 60 * 1000  // естественное снижение каждый час
    }
};

// Множители влияния на статы (за каждый уровень дебаффа)
const DEBUFF_EFFECTS = {
    // Радиация: сильно бьёт по удаче и дропу
    radiation: {
        strength: -0.02,      // -2% к урону за уровень
        luck: -0.04,          // -4% к удаче за уровень
        dropChance: -0.04    // -4% к шансу дропа за уровень
    },
    // Инфекция: сильно бьёт по силе и выносливости
    infection: {
        strength: -0.04,      // -4% к урону за уровень
        endurance: -0.03,    // -3% к выносливости за уровень
        dropChance: -0.02    // -2% к шансу дропа за уровень
    }
};

// Предметы для лечения дебаффов
const DEBUFF_CURES = {
    // Радиация
    antirad: {
        radiationReduction: 4,
        itemId: 'antirad',
        name: 'Антирад'
    },
    medkit: {
        radiationReduction: 2,
        itemId: 'medkit',
        name: 'Аптечка'
    },
    // Инфекция
    antibiotic: {
        infectionReduction: 2,
        itemId: 'antibiotic',
        name: 'Антибиотики'
    },
    injection: {
        infectionReduction: 3,
        itemId: 'injection',
        name: 'Укол'
    }
};

/**
 * Получить влияние дебаффа на характеристики
 * @param {string} type - тип дебаффа
 * @returns {object} влияние на статы
 */
function getDebuffEffect(type) {
    return DEBUFF_EFFECTS[type] || {
        strength: 0,
        luck: 0,
        dropChance: 0,
        endurance: 0
    };
}

/**
 * Рассчитать модификаторы от дебаффов
 * @param {object} player - объект игрока
 * @returns {object} модификаторы (множители)
 */
function calculateDebuffModifiers(player) {
    // Парсим дебаффы (могут быть JSON строкой или объектом)
    let radiation = { level: 0 };
    let infections = [];
    
    if (player.radiation) {
        if (typeof player.radiation === 'string') {
            try {
                radiation = JSON.parse(player.radiation);
            } catch {
                radiation = { level: 0 };
            }
        } else {
            radiation = player.radiation || { level: 0 };
        }
    }
    
    if (player.infections) {
        if (typeof player.infections === 'string') {
            try {
                infections = JSON.parse(player.infections);
            } catch {
                infections = [];
            }
        } else {
            infections = player.infections || [];
        }
    }
    
    const radLevel = radiation.level || 0;
    const infLevel = infections.reduce((sum, i) => sum + (i.level || 0), 0);
    
    // Базовые множители (1.0 = без изменений)
    const modifiers = {
        damage: 1.0,
        luck: 1.0,
        dropChance: 1.0,
        endurance: 1.0
    };
    
    // Применяем влияние радиации
    if (radLevel > 0) {
        const effect = DEBUFF_EFFECTS.radiation;
        modifiers.damage += radLevel * effect.strength;
        modifiers.luck += radLevel * effect.luck;
        modifiers.dropChance += radLevel * effect.dropChance;
    }
    
    // Применяем влияние инфекций
    if (infLevel > 0) {
        const effect = DEBUFF_EFFECTS.infection;
        modifiers.damage += infLevel * effect.strength;
        modifiers.endurance += infLevel * effect.endurance;
        modifiers.dropChance += infLevel * effect.dropChance;
    }
    
    // Ограничиваем минимальные значения
    modifiers.damage = Math.max(0.1, modifiers.damage);
    modifiers.luck = Math.max(0.1, modifiers.luck);
    modifiers.dropChance = Math.max(0.01, modifiers.dropChance);
    modifiers.endurance = Math.max(0.1, modifiers.endurance);
    
    return modifiers;
}

function getDebuffTier(level) {
    if (level >= 8) return 'critical';
    if (level >= 5) return 'danger';
    if (level >= 3) return 'warning';
    if (level > 0) return 'active';
    return 'safe';
}

function getEquipmentResistanceValue(item, keys) {
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

function normalizeResistanceToThreatPoints(totalResistance) {
    return Math.max(0, Math.round(Number(totalResistance || 0) / 10));
}

/**
 * Рассчитать защиту от радиации из экипировки
 * @param {object} equipment - экипировка игрока
 * @returns {number} защита от радиации
 */
function calculateRadiationDefense(equipment) {
    if (!equipment) return 0;

    let defense = 0;
    const slots = ['armor', 'helmet', 'body', 'head', 'hands', 'legs', 'boots', 'accessory'];
    const keys = ['radiation_resist', 'radiation_resistance', 'radiationDefense'];

    for (const slot of slots) {
        defense += getEquipmentResistanceValue(equipment[slot], keys);
    }

    return normalizeResistanceToThreatPoints(defense);
}

function calculateInfectionDefense(equipment) {
    if (!equipment) return 0;

    let defense = 0;
    const slots = ['armor', 'helmet', 'body', 'head', 'hands', 'legs', 'boots', 'accessory'];
    const keys = ['infection_resist', 'infection_resistance', 'infectionDefense'];

    for (const slot of slots) {
        defense += getEquipmentResistanceValue(equipment[slot], keys);
    }

    return normalizeResistanceToThreatPoints(defense);
}

function getRiskTierByScore(score) {
    return RISK_TIERS.find((tier) => score <= tier.maxScore) || RISK_TIERS[RISK_TIERS.length - 1];
}

function calculateLocationRiskProfile(location = {}, equipment = {}) {
    const radiationThreat = Math.max(0, Math.ceil(Number(location.radiation || 0) / 10));
    const infectionThreat = Math.max(0, Math.ceil(Number(location.infection || 0) / 10));
    const radiationDefense = calculateRadiationDefense(equipment);
    const infectionDefense = calculateInfectionDefense(equipment);

    const radiationPressure = Math.max(0, radiationThreat - radiationDefense);
    const infectionPressure = Math.max(0, infectionThreat - infectionDefense);
    const riskScore = radiationPressure + infectionPressure;
    const tier = getRiskTierByScore(riskScore);

    return {
        tier: tier.key,
        label: tier.label,
        riskScore,
        radiationThreat,
        infectionThreat,
        radiationDefense,
        infectionDefense,
        radiationPressure,
        infectionPressure,
        rewardMultiplier: tier.rewardMultiplier,
        keyChanceMultiplier: tier.keyChanceMultiplier,
        rarityLuckBonus: tier.rarityLuckBonus,
        expMultiplier: tier.expMultiplier,
        isPrepared: riskScore <= 2
    };
}

module.exports = {
    GAME_CONFIG,
    RISK_TIERS,
    LOOT_TABLES,
    EXP_FORMULA,
    ITEM_CATEGORIES,
    // Дебаффы
    DEBUFF_TYPES,
    DEBUFF_CONFIG,
    DEBUFF_EFFECTS,
    DEBUFF_CURES,
    // Экспорт функций
    getExpForLevel,
    getTotalExpForLevel,
    calculateDropChance,
    // УДАЛЕНО: calculateCraftSuccess - система крафта удалена
    getLootTable,
    rollItemRarity,
    rollLootDrop,
    getItemCategory,
    // Дебаффы
    getDebuffEffect,
    getDebuffTier,
    calculateDebuffModifiers,
    calculateRadiationDefense,
    calculateInfectionDefense,
    calculateLocationRiskProfile
};
