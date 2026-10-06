/**
 * Константы и формулы игры
 * Централизованное хранилище игровой логики
 */

// Правила предметов и формула опыта живут в public/shared/equipment.js —
// том же файле, что читает браузер, поэтому там не может быть require().
// Здесь реэкспорт для существующего кода.
// Имя НЕ equipment: в calculateLocationRiskProfile() есть параметр с таким
// именем и он перекрывает модуль — обращение equipment.normalize... падало бы.
const sharedEquipment = require('../public/shared/equipment.js');

// Тиры риска — тоже оттуда: клиент рисует подпись по этим границам, а
// сервер по ним же начисляет множители за лут, опыт и шанс ключа.
// Сам RISK_TIERS не нужен здесь: используется только getRiskTierByScore.
const { RISK_PREPARED_MAX_SCORE, getRiskTierByScore } = sharedEquipment;

// Формула опыта (getTotalExpForLevel) читается только клиентом —
// на сервере никогда не понадобилась.
const { getExpForLevel } = sharedEquipment;

// Шанс дропа — тоже из общего файла.
const { calculateDropChance } = sharedEquipment;

const GAME_CONFIG = {
    // Базовые настройки
    BASE_DROP_CHANCE: 8,        // Базовый шанс дропа (%)
    MAX_DROP_CHANCE: 60,         // Максимальный шанс дропа (%)
    MAX_LUCK: 150,               // Максимальная удача игрока
};

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

    const modifiedTable = { ...table };

    // Распределяем бонус удачи: чем выше редкость, тем больший бонус.
    // Инвариант: сумма таблицы всегда ровно 100, иначе кумулятивная сумма
    // достигнет 100 раньше последней редкости — и legendary станет
    // недостижимым (чем выше удача, тем реже самый редкий дроп).
    // Поэтому бонус берётся из common, а если common не хватает — доли
    // пропорционально урезаются. COMMON_FLOOR_PERCENT нужен, чтобы обычные
    // предметы не исчезли совсем при максимальной удаче.
    if (luck > 10) {
        // Потолок бонуса для каждой редкости
        const BONUS_CAPS = { legendary: 25, epic: 40, rare: 50, uncommon: 50 };
        // Доля luckBonus, достающаяся редкости
        const BONUS_SHARES = { legendary: 1, epic: 0.8, rare: 0.5, uncommon: 0.2 };
        const BONUS_ORDER = ['legendary', 'epic', 'rare', 'uncommon'];
        // Минимум, который common обязан сохранить при любой удаче
        const COMMON_FLOOR_PERCENT = 1;

        const baseCommon = Math.max(0, Number(table.common) || 0);
        const spendable = Math.max(0, baseCommon - COMMON_FLOOR_PERCENT);
        const planned = {};
        let plannedTotal = 0;

        for (const rarity of BONUS_ORDER) {
            const current = Math.max(0, Number(table[rarity]) || 0);
            const target = Math.min(BONUS_CAPS[rarity], current + luckBonus * BONUS_SHARES[rarity]);
            planned[rarity] = Math.max(0, target - current);
            plannedTotal += planned[rarity];
        }

        // Сколько common реально можно отдать: если не хватает, режем все
        // доли пропорционально — сумма таблицы обязана остаться 100.
        const scale = plannedTotal > spendable && plannedTotal > 0
            ? spendable / plannedTotal
            : 1;

        for (const rarity of BONUS_ORDER) {
            const current = Math.max(0, Number(table[rarity]) || 0);
            modifiedTable[rarity] = current + planned[rarity] * scale;
        }
        modifiedTable.common = baseCommon - plannedTotal * scale;
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

// Удалены rollLootDrop и getItemCategory/ITEM_CATEGORIES.
// getItemCategory определяла категорию ПО ДИАПАЗОНАМ ID (1-5 еда, 6-10
// медицина, 11-16 оружие...). Этот подход уже удалён с клиента:
// стоило добавить предмет с id=103 — и он молча попадал в 'unknown' и
// исчезал из фильтра инвентаря. Оставлять такую же копию на сервере
// опасно: любой, кто возьмёт функцию из общего файла, снова получит
// предметы, которые «не существуют».
//
// rollLootDrop выбирала предмет из переданного массива. Такого массива
// в проекте нет: лут берётся из кэша пула в routes/game/world.js
// (getRandomLootItem), где учитываются тип локации и риск.

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
 * Рассчитать модификаторы от дебаффов
 * @param {object} player - объект игрока
 * @returns {object} модификаторы (множители)
 */
function calculateDebuffModifiers(player) {
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
    
    const modifiers = {
        damage: 1.0,
        luck: 1.0,
        dropChance: 1.0,
        endurance: 1.0
    };
    
    if (radLevel > 0) {
        const effect = DEBUFF_EFFECTS.radiation;
        modifiers.damage += radLevel * effect.strength;
        modifiers.luck += radLevel * effect.luck;
        modifiers.dropChance += radLevel * effect.dropChance;
    }
    
    if (infLevel > 0) {
        const effect = DEBUFF_EFFECTS.infection;
        modifiers.damage += infLevel * effect.strength;
        modifiers.endurance += infLevel * effect.endurance;
        modifiers.dropChance += infLevel * effect.dropChance;
    }
    
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

/**
 * Рассчитать защиту от радиации из экипировки
 * @param {object} equipmentMap - экипировка игрока
 * @returns {number} защита от радиации
 */
function calculateRadiationDefense(equipmentMap) {
    return sharedEquipment.calculateRadiationDefense(equipmentMap);
}

function calculateInfectionDefense(equipmentMap) {
    return sharedEquipment.calculateInfectionDefense(equipmentMap);
}

// getRiskTierByScore берётся из общего файла правил выше.

function calculateLocationRiskProfile(location = {}, equipment = {}) {
    const radiationThreat = sharedEquipment.normalizeThreatLevelToPoints(location.radiation);
    const infectionThreat = sharedEquipment.normalizeThreatLevelToPoints(location.infection);
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
        // Порог «освоено» — из общего файла правил.
        isPrepared: riskScore <= RISK_PREPARED_MAX_SCORE
    };
}

/**
 * Что уходит наружу.
 *
 * Правило: наружу выходит то, что зовут другие модули. Внутренние
 * таблицы (LOOT_TABLES, DEBUFF_EFFECTS) и обёртки над
 * public/shared/equipment.js остаются здесь как реализация.
 */
module.exports = {
    // Дебаффы — читают debuffs.js, status.js, world.js
    DEBUFF_TYPES,
    DEBUFF_CONFIG,
    DEBUFF_CURES,
    getDebuffTier,
    calculateDebuffModifiers,

    // Опыт — читает utils/serverApi.js (PlayerHelper.addExperience)
    getExpForLevel,

    // Лут — читает routes/game/world.js
    calculateDropChance,
    rollItemRarity,

    // Риск локации — читает routes/game/world.js
    calculateLocationRiskProfile
};
