/**
 * Опыт игрока и апгрейд уровня.
 *
 * Изменение опыта и уровня — только через addExperienceWithLevelUp;
 * обновление характеристик игрока — через UPDATE.
 */
const { query: defaultQuery } = require('./database');
// Валидация ID. Проверка через utils/validate.js, а не через serverApi.
// PlayerHelper.addExperience — через require 2=CB@8 PlayerHelper.addExperience),
// 8 25@E=5C@>2=52К9 8<?>@Б 40; 1K F8:;.
// utils/validate.js 7028А8<>AB59 =5 8<55Б, ?>MB><Б F8:;0 =5 1C45Б.
const { requireId } = require('../utils/validate');
const equipmentRules = require('../public/shared/equipment.js');

const ERR_PLAYER_NOT_FOUND = 'Игрок не найден';

function getExecutor(client) {
    return client ? client.query.bind(client) : defaultQuery;
}

function validateExperience(exp) {
    if (!Number.isFinite(exp) || exp <= 0) throw new Error('Опыт должен быть положительным числом');
}

// Связь с utils/log.js и utils/serverApi.js.
// log.js =5 ААК;05БАО =8 =0 serverApi, =8 =0 players.
async function updatePlayerExperience(playerId, exp, options = {}) {
    const { client = null, updateTimestamp = true } = options;
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    const result = await exec(
        `UPDATE players SET experience = COALESCE(experience,0) + $1 ${updateTimestamp ? ', updated_at = NOW()' : ''} WHERE id = $2 RETURNING level, experience, max_energy, max_health`,
        [exp, playerId]
    );
    if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
    return result.rows[0];
}

async function levelUpPlayer(playerId, client, levelsGained = 1, newExperience = 0) {
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);

    // Порог удачи при апгрейде: MAX_LUCK = 150
    const luckBonusPerLevel = 1;
    const luckBonus = levelsGained * luckBonusPerLevel;
    const maxLuck = equipmentRules.GAME_CONFIG.MAX_LUCK;

    const result = levelsGained <= 1
        ? await exec(
            `WITH updated AS (UPDATE players SET level = level + 1, experience = $2, max_energy = COALESCE(max_energy,0) + 1, max_health = COALESCE(max_health,0) + 1, boss_damage = COALESCE(boss_damage, 0) + 1, luck = LEAST($3, COALESCE(luck,0) + 1), energy = LEAST(COALESCE(energy,0) + 1, COALESCE(max_energy,0) + 1), health = LEAST(COALESCE(health,0) + 1, COALESCE(max_health,0) + 1), updated_at = NOW() WHERE id = $1 RETURNING *) SELECT * FROM updated`,
            [playerId, newExperience, maxLuck]
        )
        : await exec(
            `WITH updated AS (UPDATE players SET level = level + $1, experience = $2, max_energy = COALESCE(max_energy,0) + $1, max_health = COALESCE(max_health,0) + $1, boss_damage = COALESCE(boss_damage, 0) + $1, luck = LEAST($5, COALESCE(luck,0) + $3), energy = LEAST(COALESCE(energy,0) + $1, COALESCE(max_energy,0) + $1), health = LEAST(COALESCE(health,0) + 1, COALESCE(max_health,0) + 1), updated_at = NOW() WHERE id = $4 RETURNING *) SELECT * FROM updated`,
            [levelsGained, newExperience, luckBonus, playerId, maxLuck]
        );

    if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
    return result.rows[0];
}

async function lockPlayer(playerId, client, columns = '*') {
    if (!client) throw new Error('lockPlayer требует client');
    playerId = requireId(playerId, 'playerId');
    let cols = '*';
    if (columns && columns !== '*') {
        const parts = columns.split(',').map(c => c.trim()).filter(Boolean);
        if (!parts.length || !parts.every(p => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p))) {
            throw new Error('Некорректные колонки для lockPlayer');
        }
        cols = parts.join(', ');
    }
    const result = await client.query(`SELECT ${cols} FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    return result.rows[0];
}

async function addExperienceWithLevelUp(client, playerId, exp, getExpForLevel) {
    if (!client) throw new Error('addExperienceWithLevelUp требует client');
    playerId = requireId(playerId, 'playerId');
    validateExperience(exp);

    const lockedPlayer = await lockPlayer(playerId, client);
    if (!lockedPlayer) throw { message: ERR_PLAYER_NOT_FOUND, code: 'PLAYER_NOT_FOUND', statusCode: 404 };

    let newExperience = (lockedPlayer.experience || 0) + exp;
    let newLevel = lockedPlayer.level;
    let leveledUp = false;
    let totalLevelsGained = 0;

    while (newExperience >= getExpForLevel(newLevel) && totalLevelsGained < 100) {
        newExperience -= getExpForLevel(newLevel);
        newLevel++;
        leveledUp = true;
        totalLevelsGained++;
    }

    const logData = {
        action: leveledUp ? 'level_up' : 'add_experience',
        data: {
            old_level: lockedPlayer.level,
            new_level: newLevel,
            levels_gained: totalLevelsGained,
            exp_gained: exp,
            total_exp: newExperience,
            level: newLevel,
        },
    };

    if (leveledUp) {
        await levelUpPlayer(playerId, client, totalLevelsGained, newExperience);
    } else {
        await updatePlayerExperience(playerId, exp, { client, updateTimestamp: false });
    }

    return { level: newLevel, experience: newExperience, leveled_up: leveledUp, levels_gained: totalLevelsGained, exp_needed: getExpForLevel(newLevel), logData };
}

module.exports = {
    // Экспорт addExperienceWithLevelUp (utils/serverApi.js -> PlayerHelper.addExperience).
    addExperienceWithLevelUp,
    lockPlayer
};
