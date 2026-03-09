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
    // Уровни 1-10: линейно 200 за уровень
    if (level <= 10) {
        return level * 200;
    }
    // Плавно от 2000 + 500 за каждый уровень выше 10
    return 2000 + ((level - 10) * 500);
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
    BASE_DROP_CHANCE: 8,        // Базовый шанс дропа (%) - снижено для доната
    MAX_DROP_CHANCE: 60,         // Максимальный шанс дропа (%)
    BASE_CRAFT_SUCCESS: 50,      // Базовый шанс успешного крафта (%)
    MAX_CRAFT_SUCCESS: 95,       // Максимальный шанс крафта (%)

    // Множители удачи для дропа (монотонно убывающие, но гарантирующие рост)
    LUCK_MULTIPLIERS: [
        { min: 0, max: 10, multiplier: 0.5 },
        { min: 11, max: 30, multiplier: 0.45 },
        { min: 31, max: 50, multiplier: 0.4 },
        { min: 51, max: 70, multiplier: 0.35 },
        { min: 71, max: 90, multiplier: 0.32 },
        { min: 91, max: 100, multiplier: 0.30 },
        { min: 101, max: Infinity, multiplier: 0.28 }
    ],

    // Множители мастерства для крафта
    CRAFT_MULTIPLIERS: [
        { min: 1, max: 10, multiplier: 1.5 },
        { min: 11, max: 30, multiplier: 1.2 },
        { min: 31, max: 50, multiplier: 1.0 },
        { min: 51, max: 70, multiplier: 0.8 },
        { min: 71, max: 90, multiplier: 0.6 },
        { min: 91, max: Infinity, multiplier: 0.5 }
    ],

    // Штраф за редкость при крафте
    RARITY_CRAFT_PENALTIES: {
        common: 1.0,
        uncommon: 0.9,
        rare: 0.75,
        epic: 0.6,
        legendary: 0.4
    }
};

/**
 * Получить множитель удачи
 * @param {number} luck - Значение удачи игрока
 * @returns {number} Множитель
 */
function getLuckMultiplier(luck) {
    // Защита от отрицательной или нулевой удачи
    if (luck <= 0) return 0.5;
    
    for (const tier of GAME_CONFIG.LUCK_MULTIPLIERS) {
        if (luck >= tier.min && luck <= tier.max) {
            return tier.multiplier;
        }
    }
    return GAME_CONFIG.LUCK_MULTIPLIERS[GAME_CONFIG.LUCK_MULTIPLIERS.length - 1].multiplier;
}

/**
 * Получить множитель мастерства крафта
 * @param {number} crafting - Значение мастерства
 * @returns {number} Множитель
 */
function getCraftMultiplier(crafting) {
    for (const tier of GAME_CONFIG.CRAFT_MULTIPLIERS) {
        if (crafting >= tier.min && crafting <= tier.max) {
            return tier.multiplier;
        }
    }
    return GAME_CONFIG.CRAFT_MULTIPLIERS[GAME_CONFIG.CRAFT_MULTIPLIERS.length - 1].multiplier;
}

/**
 * Получить штраф за редкость предмета при крафте
 * @param {string} rarity - Редкость предмета
 * @returns {number} Множитель (0-1)
 */
function getRarityPenalty(rarity) {
    return GAME_CONFIG.RARITY_CRAFT_PENALTIES[rarity] || 1.0;
}

/**
 * Рассчитать шанс дропа (монотонно растущий)
 * @param {number} luck - Удача игрока
 * @returns {number} Шанс дропа в процентах
 */
function calculateDropChance(luck) {
    // Защита от отрицательной или нулевой удачи
    if (luck <= 0) return 4;
    
    // Простая формула без диапазонов — монотонный рост
    // luck 1 → 8.35%, 30 → 18.5%, 60 → 29%, 100 → 43%, 143+ → 60%
    const chance = 8 + luck * 0.35;
    return Math.min(GAME_CONFIG.MAX_DROP_CHANCE, Math.round(chance * 10) / 10);
}

/**
 * Рассчитать шанс успешного крафта
 * @param {number} crafting - Мастерство крафта
 * @param {string} rarity - Редкость предмета
 * @returns {number} Шанс в процентах
 */
function calculateCraftSuccess(crafting, rarity) {
    // Защита от отрицательного мастерства
    if (crafting <= 0) crafting = 1;
    
    // Базовый шанс по редкости (чем выше редкость, тем ниже базовый шанс)
    const rarityBaseChance = {
        common: 80,
        uncommon: 65,
        rare: 50,
        epic: 35,
        legendary: 20
    };
    
    const baseChance = rarityBaseChance[rarity] || 60;
    
    // Бонус мастерства: каждый 10 единиц мастерства дает +5% к шансу
    // Но с ограничением: чем выше редкость, тем меньше бонус
    const raritySkillBonus = {
        common: 0.8,
        uncommon: 0.6,
        rare: 0.45,
        epic: 0.3,
        legendary: 0.2
    };
    const skillBonus = (crafting / 10) * 5 * (raritySkillBonus[rarity] || 0.5);
    
    // Итоговый шанс
    const finalChance = baseChance + skillBonus;
    
    return Math.min(GAME_CONFIG.MAX_CRAFT_SUCCESS, Math.max(5, Math.round(finalChance)));
}

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
 * @returns {string} Редкость предмета
 */
function rollItemRarity(locationId) {
    const table = getLootTable(locationId);
    const roll = Math.random() * 100;
    let cumulative = 0;
    
    for (const [rarity, chance] of Object.entries(table)) {
        cumulative += chance;
        if (roll <= cumulative) {
            return rarity;
        }
    }
    return 'common';
}

/**
 * Определить, выпал ли предмет
 * @param {number} luck - Удача игрока
 * @returns {boolean} true если предмет найден
 */
function rollLootDrop(luck) {
    const dropChance = calculateDropChance(luck);
    const roll = Math.random() * 100;
    return roll <= dropChance;
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

module.exports = {
    GAME_CONFIG,
    LOOT_TABLES,
    EXP_FORMULA,
    ITEM_CATEGORIES,
    getExpForLevel,
    getTotalExpForLevel,
    getLuckMultiplier,
    getCraftMultiplier,
    getRarityPenalty,
    calculateDropChance,
    calculateCraftSuccess,
    getLootTable,
    rollItemRarity,
    rollLootDrop,
    getItemCategory
};
