// 48=K9 1>52>9 <>4C;L (utils/combat.js)
// '8ABK5 @0AGQBK C@>=0/70I8BK/20@80F88 4;O bosses, pvp, <8@0.
// 028A8<>AB8: public/shared/equipment.js (G5@57 getGameHelpers/equipmentRules).
// AO 1>520O <0B5<0B8:0 4>;6=0 68BL 745AL, GB>1K B5AB8@>20BL 8 10;0=A8@>20BL 5Q
// 2 >4=>< <5AB5, 0 =5 4C1;8@>20BL ?> @>CB0<.

'use strict';

const equipmentRules = require('../public/shared/equipment.js');

// --- >=AB0=BK 10;0=A0 1>O ---
const BOSS_BASE_DAMAGE = 3;
const BOSS_DAMAGE_PER_LEVEL = 2;
const BOSS_COUNTER_BASE = 3;
const BOSS_COUNTER_PER_LEVEL = 3;
const DAMAGE_PER_KILL = 0.1;
const KILL_DECAY_FACTOR = 0.2;
const MAX_KILL_BONUS = 100; // ?>B>;>: 1>=CA0 >B <0AB5@AB20

// --- 0AB5@AB2> ---
function calculateDamageBonus(bossId, masteries, opts) {
    const damagePerKill = (opts && opts.damagePerKill) || DAMAGE_PER_KILL;
    const killDecayFactor = (opts && opts.killDecayFactor) || KILL_DECAY_FACTOR;
    const maxKillBonus = (opts && opts.maxKillBonus) || MAX_KILL_BONUS;

    const masteryMap = {};
    (masteries || []).forEach((m) => {
        masteryMap[m.boss_id] = m.kills || 0;
    });

    let bonus = 0;
    // :;04 ?@54K4CI8E 1>AA>2 (A 70BCE0=85<).
    for (let i = 1; i < bossId; i++) {
        const kills = masteryMap[i] || 0;
        if (kills <= 0) continue;
        const distance = bossId - i;
        bonus += kills * damagePerKill * Math.pow(killDecayFactor, distance);
    }
    // :;04 B5:CI53> 1>AA0.
    const currentKills = masteryMap[bossId] || 0;
    bonus += currentKills * damagePerKill;

    bonus = Math.floor(bonus);
    if (bonus > maxKillBonus) bonus = maxKillBonus;
    return bonus;
}

// --- #@>= 83@>:0 ?> 1>AAC ---
function calculateDamage(bossId, player, masteries, setBonuses, equipment) {
    const eq = equipment || (player && player.equipment) || {};
    const weaponDamage = equipmentRules.getWeaponDamageForContext(eq.weapon, equipmentRules.WEAPON_CONTEXTS.BOSS);
    const setDamage = (setBonuses && setBonuses.damage) || 0;
    const bonus = calculateDamageBonus(bossId, masteries || []);
    const levelDamage = Math.max(1, Math.floor(Number(player && player.level) || 1));
    const baseDamage = BOSS_BASE_DAMAGE + levelDamage * BOSS_DAMAGE_PER_LEVEL;
    return Math.max(1, Math.floor(weaponDamage + setDamage + bonus + baseDamage));
}

// --- >=B@-C@>= 1>AA0 ---
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


// ---  5M:A?>@B 87 equipment ---
const rollVarianceDamage = equipmentRules.rollVarianceDamage;
const calculateDefenseTotal = equipmentRules.calculateDefenseTotal;
const calculateLevelDefense = equipmentRules.calculateLevelDefense;
const applyDefenseReduction = equipmentRules.applyDefenseReduction;
const getWeaponDamageForContext = equipmentRules.getWeaponDamageForContext;
const getWeaponContextMultiplier = equipmentRules.getWeaponContextMultiplier;

module.exports = {
    // >=AB0=BK
    BOSS_BASE_DAMAGE,
    BOSS_DAMAGE_PER_LEVEL,
    BOSS_COUNTER_BASE,
    BOSS_COUNTER_PER_LEVEL,
    DAMAGE_PER_KILL,
    KILL_DECAY_FACTOR,
    MAX_KILL_BONUS,
    // '8ABK5 @0AGQBK
    calculateDamage,
    calculateDamageBonus,
    calculateBossCounterDamage,
    rollVarianceDamage,
    calculateDefenseTotal,
    calculateLevelDefense,
    applyDefenseReduction,
    getWeaponDamageForContext,
    getWeaponContextMultiplier,
    //  5M:A?>@B 4;O A>2<5AB8<>AB8
    equipmentRules
};
