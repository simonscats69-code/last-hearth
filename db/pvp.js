/**
 * Модуль PvP системы — слой доступа к данным и чистые боевые формулы.
 * Функции доступа к БД используются продакшн-кодом (routes/game/pvp.js).
 */

const { query, queryOne } = require('./database');
// Правила предметов (прочность/апгрейд/защита) — те же, что в бою с боссами,
// иначе PvP и боссы считались бы по разным правилам.
const equipmentRules = require('../public/shared/equipment.js');

/**
 * Проверка, защищён ли игрок от PvP (уровень < 5)
 * @param {number} playerId - ID игрока
 * @param {object} client - опциональный клиент БД для использования внутри транзакции
 * @returns {Promise<boolean>} true если защищён
 */
async function isProtectedFromPVP(playerId, client = null) {
    const exec = client
        ? (sql, params) => client.query(sql, params).then(r => r.rows[0])
        : (sql, params) => queryOne(sql, params);
    const player = await exec(
        'SELECT level FROM players WHERE id = $1',
        [playerId]
    );
    return player && player.level < 5;
}

/**
 * Получение активного PvP кулдауна игрока
 * @param {number} playerId - ID игрока
 * @returns {Promise<object|null>} Информация о кулдауне или null
 */
async function getPVPCooldown(playerId) {
    return await queryOne(
        `SELECT * FROM pvp_cooldowns
         WHERE player_id = $1 AND expires_at > NOW()
         ORDER BY expires_at DESC LIMIT 1`,
        [playerId]
    );
}

/**
 * Установка PvP кулдауна игроку
 * @param {number} playerId - ID игрока
 * @param {number} minutes - Длительность в минутах (1-10080)
 * @param {string} type - Тип кулдауна
 * @param {string} reason - Причина
 * @param {object} client - Опциональный клиент БД для использования внутри транзакции
 */
async function setPVPCooldown(playerId, minutes, type = 'pvp_battle', reason = 'После PvP боя', client = null) {
    // Валидация minutes (диапазон 1-10080)
    const validatedMinutes = parseInt(minutes);
    if (!Number.isInteger(validatedMinutes) || validatedMinutes <= 0 || validatedMinutes > 10080) {
        throw new Error('Недопустимое значение minutes (должно быть 1-10080)');
    }

    const executeQuery = client
        ? (sql, params) => client.query(sql, params)
        : query;

    await executeQuery(
        `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at, reason)
         VALUES ($1, $2, NOW() + make_interval(mins => $3), $4)
         ON CONFLICT (player_id, cooldown_type)
         DO UPDATE SET expires_at = NOW() + make_interval(mins => $3), reason = $4`,
        [playerId, type, validatedMinutes, reason]
    );
}

/**
 * Создание нового PvP матча (вызывается ВНУТРИ транзакции роута)
 * @param {number} attackerId - ID атакующего
 * @param {number} defenderId - ID защищающегося
 * @param {number} locationId - ID локации
 * @param {object} client - клиент БД транзакции
 * @returns {Promise<object>} Созданный матч
 */
async function createPVPMatch(attackerId, defenderId, locationId, client = null) {
    const executeQuery = client
        ? (sql, params) => client.query(sql, params).then(r => r.rows[0] ?? null)
        : (sql, params) => queryOne(sql, params);

    const match = await executeQuery(
        `INSERT INTO pvp_battles (attacker_id, defender_id, location_id, started_at, status)
         VALUES ($1, $2, $3, NOW(), 'active')
         RETURNING *`,
        [attackerId, defenderId, locationId]
    );

    // Устанавливаем кулдаун обоим игрокам (в той же транзакции)
    await setPVPCooldown(attackerId, 5, 'pvp_battle', 'Участие в PvP бое', client);
    await setPVPCooldown(defenderId, 5, 'pvp_battle', 'Участие в PvP бое', client);

    return match;
}

// ==========================================
// ЧИСТЫЕ БОЕВЫЕ ФОРМУЛЫ (без обращения к БД)
// ==========================================

/**
 * Расчёт базового урона в PvP (детерминированный, без уклонения)
 *
 * Формула: сила*2 + ловкость*0.8 + оружие, поправка на разницу уровней ±1% за
 * уровень, снижение выносливостью защитника (soft cap 60%), затем защита
 * брони (applyDefenseReduction) — минимум 1 урон.
 *
 * @param {object} attacker - атакующий ({ strength, agility, level, equipment, set_damage })
 * @param {object} defender - защищающийся ({ endurance, level, equipment })
 * @returns {{damage: number}} объект с итоговым уроном
 */
function calculatePVPDamage(attacker, defender) {
    const a = attacker || {};
    const d = defender || {};

    let damage = Number(a.strength || 0) * 2 + Number(a.agility || 0) * 0.8;

    const aEq = a.equipment && typeof a.equipment === 'object' ? a.equipment : {};
    const dEq = d.equipment && typeof d.equipment === 'object' ? d.equipment : {};

    // Урон оружия с учётом прочности и уровня улучшения (0 у сломанного).
    //
    // Дальний бой даёт +25% урона в PvP (stats.pvp_bonus), а разброс
    // (stats.variance у дробовика и реактивной пушки) применяется только к
    // урону ОРУЖИЯ: разброс от всего урона бойца ломал бы расчёт.
    const weapon = aEq.weapon;
    const weaponBase = equipmentRules.getEffectiveStatValue(weapon, ['damage']);
    const pvpBonus = 1 + Math.min(100, Number(weapon && weapon.stats && weapon.stats.pvp_bonus) || 0) / 100;
    damage += equipmentRules.rollVarianceDamage(weaponBase * pvpBonus, Number(weapon && weapon.stats && weapon.stats.variance) || 0);

    // Бонус сета атакующего (+15 урона за 4 части «Бандитского сета»).
    damage += Number(a.set_damage || 0);

    // Влияние уровня: ±1% за разницу уровней
    damage *= 1 + (Number(a.level || 1) - Number(d.level || 1)) * 0.01;

    // Защита от выносливости (soft cap 60%)
    const endurance = Number(d.endurance || 0);
    const defenseReduction = Math.min(60, endurance / (endurance + 60) * 60);
    damage = Math.floor(damage * (1 - defenseReduction / 100));

    // Защита снаряжения защитника (мягкий предел 60%)
    return { damage: equipmentRules.applyDefenseReduction(damage, equipmentRules.calculateDefenseTotal(dEq)) };
}

/**
 * Расчёт количества монет, которые можно украсть у проигравшего
 * @param {number} coins - монеты проигравшего
 * @returns {number} количество украденных монет (10%, максимум 10000)
 */
function calculateCoinsToSteal(coins) {
    // Number(x || 0) НЕ защищает от мусора: 'abc' истинно, поэтому
    // Number('abc') === NaN, а Math.max(0, NaN) === NaN — и NaN уехал бы в
    // UPDATE coins = coins - $1. Проверяем результат преобразования.
    const parsed = Number(coins);
    const safeCoins = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    return Math.min(Math.floor(safeCoins * 0.1), 10000);
}

/**
 * Расчёт опыта за победу в PvP
 * @param {number} winnerLevel - уровень победителя
 * @param {number} loserLevel - уровень проигравшего
 * @returns {number} количество опыта (база 50 + 5 за каждый уровень разницы)
 */
function calculatePVPRewardExperience(winnerLevel, loserLevel) {
    const diff = Math.abs(Number(winnerLevel || 1) - Number(loserLevel || 1));
    return 50 + diff * 5;
}

/**
 * Выбор случайных предметов для кражи из инвентаря
 * @param {Array} inventory - инвентарь проигравшего
 * @param {number} maxItems - максимум предметов
 * @returns {Array} массив украденных предметов
 */
function getRandomItemsToSteal(inventory, maxItems = 1) {
    if (!Array.isArray(inventory) || inventory.length === 0) return [];

    const available = inventory.filter(item => item && Number(item.quantity || 0) > 0);
    const shuffled = [...available];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, Math.max(0, Number(maxItems) || 0));
}

module.exports = {
    // Доступ к данным
    isProtectedFromPVP,
    getPVPCooldown,
    setPVPCooldown,
    createPVPMatch,

    // Чистые формулы
    calculatePVPDamage,
    calculateCoinsToSteal,
    calculatePVPRewardExperience,
    getRandomItemsToSteal
};
