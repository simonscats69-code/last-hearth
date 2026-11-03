// Единый боевой модуль (utils/combat.js)
// Чистые расчёты урона/защиты/вариации для bosses, pvp, мира.
// Зависимости: public/shared/equipment.js (через getGameHelpers/equipmentRules).
// Вся боевая математика должна жить здесь, чтобы тестировать и балансировать её
// в одном месте, а не дублировать по роутам.

'use strict';

const equipmentRules = require('../public/shared/equipment.js');

// --- Константы баланса боя ---
const BOSS_BASE_DAMAGE = 3;
const BOSS_DAMAGE_PER_LEVEL = 2;
const BOSS_COUNTER_BASE = 3;
const BOSS_COUNTER_PER_LEVEL = 3;
const DAMAGE_PER_KILL = 0.1;
const KILL_DECAY_FACTOR = 0.2;
const MAX_KILL_BONUS = 100; // потолок бонуса от мастерства

// --- Мастерство ---
function calculateDamageBonus(bossId, masteries, opts) {
    const damagePerKill = (opts && opts.damagePerKill) || DAMAGE_PER_KILL;
    const killDecayFactor = (opts && opts.killDecayFactor) || KILL_DECAY_FACTOR;
    const maxKillBonus = (opts && opts.maxKillBonus) || MAX_KILL_BONUS;

    const masteryMap = {};
    (masteries || []).forEach((m) => {
        masteryMap[m.boss_id] = m.kills || 0;
    });

    let bonus = 0;
    // Вклад предыдущих боссов (с затуханием).
    for (let i = 1; i < bossId; i++) {
        const kills = masteryMap[i] || 0;
        if (kills <= 0) continue;
        const distance = bossId - i;
        bonus += kills * damagePerKill * Math.pow(killDecayFactor, distance);
    }
    // Вклад текущего босса.
    const currentKills = masteryMap[bossId] || 0;
    bonus += currentKills * damagePerKill;

    bonus = Math.floor(bonus);
    if (bonus > maxKillBonus) bonus = maxKillBonus;
    return bonus;
}

// --- Урон игрока по боссу ---
function calculateDamage(bossId, player, masteries, setBonuses, equipment) {
    const eq = equipment || (player && player.equipment) || {};
    const weaponDamage = equipmentRules.getWeaponDamageForContext(eq, equipmentRules.WEAPON_CONTEXTS.BOSS);
    const setDamage = (setBonuses && setBonuses.damage) || 0;
    const bonus = calculateDamageBonus(bossId, masteries || []);
    const levelDamage = Math.max(1, Math.floor(Number(player && player.level) || 1));
    const baseDamage = BOSS_BASE_DAMAGE + levelDamage * BOSS_DAMAGE_PER_LEVEL;
    return Math.max(1, Math.floor(weaponDamage + setDamage + bonus + baseDamage));
}

// --- Контр-урон босса ---
function calculateBossCounterDamage(boss, equipment, options) {
    options = options || {};
    const { currentHealth, playerLevel, setDefense } = options;

    const bossLevel = Math.max(1, Math.floor(Number(boss && boss.level) || 1));
    const bossMaxHealth = Math.max(1, Number(boss && boss.max_health) || 1);

    const peak = BOSS_COUNTER_BASE + bossLevel * BOSS_COUNTER_PER_LEVEL;
    const ratio = (currentHealth !== undefined && currentHealth !== null)
        ? Math.max(0, Math.min(1, Number(currentHealth) / bossMaxHealth))
        : 1;
    const raw = Math.round(peak * ratio);
    if (raw <= 0) return 0;

    const equipmentDefense = equipmentRules.calculateDefenseTotal(equipment || {});
    const levelDefense = equipmentRules.calculateLevelDefense(playerLevel || 1);
    const defense = equipmentDefense + levelDefense + (Number(setDefense) || 0);
    return equipmentRules.applyDefenseReduction(raw, defense);
}

// --- Урон в PvP ---
function calculatePVPDamage(attacker, defender) {
    // Делегируем в db/pvp.js логику, но экспортируем точку входа.
    // Реальная реализация остаётся в db/pvp.js (использует equipmentRules).
    // Этот модуль реэкспортирует для единообразия.
    return null; // placeholder — см. db/pvp.js
}

// --- Реэкспорт из equipment ---
const rollVarianceDamage = equipmentRules.rollVarianceDamage;
const calculateDefenseTotal = equipmentRules.calculateDefenseTotal;
const calculateLevelDefense = equipmentRules.calculateLevelDefense;
const applyDefenseReduction = equipmentRules.applyDefenseReduction;
const getWeaponDamageForContext = equipmentRules.getWeaponDamageForContext;
const getWeaponContextMultiplier = equipmentRules.getWeaponContextMultiplier;

module.exports = {
    // Константы
    BOSS_BASE_DAMAGE,
    BOSS_DAMAGE_PER_LEVEL,
    BOSS_COUNTER_BASE,
    BOSS_COUNTER_PER_LEVEL,
    DAMAGE_PER_KILL,
    KILL_DECAY_FACTOR,
    MAX_KILL_BONUS,
    // Чистые расчёты
    calculateDamage,
    calculateDamageBonus,
    calculateBossCounterDamage,
    rollVarianceDamage,
    calculateDefenseTotal,
    calculateLevelDefense,
    applyDefenseReduction,
    getWeaponDamageForContext,
    getWeaponContextMultiplier,
    // Реэкспорт для совместимости
    equipmentRules
};
