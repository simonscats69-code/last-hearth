/**
 * Запросы к БД для игроков.
 *
 * В проекте используется только addExperienceWithLevelUp; остальные
 * операции (создание игрока, обновление инвентаря и экипировки) делают
 * роуты своими UPDATE.
 */
const { query: defaultQuery } = require('./database');
// Общая валидация ID. Импортируется из utils/validate.js, а НЕ из
// serverApi: тот лениво требует этот же файл (require внутри
// PlayerHelper.addExperience), и верхнеуровневый импорт дал бы цикл.
// utils/validate.js зависимостей не имеет, поэтому цикла не будет.
const { requireId } = require('../utils/validate');

const ERR_PLAYER_NOT_FOUND = 'Игрок не найден';

function getExecutor(client) {
    return client ? client.query.bind(client) : defaultQuery;
}

function validateExperience(exp) {
    if (!Number.isFinite(exp) || exp <= 0) throw new Error('Опыт должен быть положительным');
}

// Логирование берём из utils/log.js, а НЕ из utils/serverApi.js.
// Раньше здесь стоял импорт serverApi, а тот грузил этот же файл
// лениво (require внутри PlayerHelper.addExperience) — получался цикл
// db/players.js <-> utils/serverApi.js, удерживаемый только тем, что
// оба импорта не выполнялись на верхнем уровне. Теперь цикла нет:
// log.js не ссылается ни на serverApi, ни на players.
const { logPlayerAction } = require('../utils/log');

async function updatePlayerExperience(playerId, exp, options = {}) {
    const { client = null, updateTimestamp = true } = options;
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    const result = await exec(
        `UPDATE players SET experience = experience + $1 ${updateTimestamp ? ', updated_at = NOW()' : ''} WHERE id = $2 RETURNING level, experience, max_energy, max_health`,
        [exp, playerId]
    );
    if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
    return result.rows[0];
}

async function levelUpPlayer(playerId, client, levelsGained = 1, newExperience = 0) {
    playerId = requireId(playerId, 'playerId');
    const exec = getExecutor(client);
    
    // Формула прокачки удачи: каждый уровень даёт +1 к удаче
    // С ограничением MAX_LUCK = 150
    const luckBonusPerLevel = 1;
    const luckBonus = levelsGained * luckBonusPerLevel;
    
    const result = levelsGained <= 1
        ? await exec(
            `WITH updated AS (UPDATE players SET level = level + 1, experience = $2, max_energy = max_energy + 1, max_health = max_health + 1, boss_damage = COALESCE(boss_damage, 0) + 1, luck = LEAST(150, luck + 1), energy = LEAST(energy + 1, max_energy + 1), health = LEAST(health + 1, max_health + 1), updated_at = NOW() WHERE id = $1 RETURNING *) SELECT * FROM updated`,
            [playerId, newExperience]
        )
        : await exec(
            `WITH updated AS (UPDATE players SET level = level + $1, experience = $2, max_energy = max_energy + ($1 * 1), max_health = max_health + ($1 * 1), boss_damage = COALESCE(boss_damage, 0) + $1, luck = LEAST(150, luck + $3), energy = LEAST(energy + ($1 * 1), max_energy + ($1 * 1)), health = LEAST(health + ($1 * 1), max_health + ($1 * 1)), updated_at = NOW() WHERE id = $4 RETURNING *) SELECT * FROM updated`,
            [levelsGained, newExperience, luckBonus, playerId]
        );
    
    if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
    return result.rows[0];
}

async function lockPlayer(playerId, client) {
    if (!client) throw new Error('lockPlayer требует client');
    playerId = requireId(playerId, 'playerId');
    const result = await client.query('SELECT * FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    return result.rows[0];
}

async function addExperienceWithLevelUp(client, playerId, exp, getExpForLevel) {
    if (!client) throw new Error('addExperienceWithLevelUp требует client');
    playerId = requireId(playerId, 'playerId');
    validateExperience(exp);
    
    const lockedPlayer = await lockPlayer(playerId, client);
    if (!lockedPlayer) throw { message: ERR_PLAYER_NOT_FOUND, code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    
    let newExperience = lockedPlayer.experience + exp;
    let newLevel = lockedPlayer.level;
    let leveledUp = false;
    let totalLevelsGained = 0;
    
    while (newExperience >= getExpForLevel(newLevel)) {
        newExperience -= getExpForLevel(newLevel);
        newLevel++;
        leveledUp = true;
        totalLevelsGained++;
    }
    
    if (leveledUp) {
        await levelUpPlayer(playerId, client, totalLevelsGained, newExperience);
        await logPlayerAction(playerId, 'level_up', { old_level: lockedPlayer.level, new_level: newLevel, levels_gained: totalLevelsGained, exp_gained: exp }, client);
    } else {
        await updatePlayerExperience(playerId, exp, { client, updateTimestamp: false });
        await logPlayerAction(playerId, 'add_experience', { exp_gained: exp, total_exp: newExperience, level: newLevel }, client);
    }
    
    return { level: newLevel, experience: newExperience, leveled_up: leveledUp, levels_gained: totalLevelsGained, exp_needed: getExpForLevel(newLevel) };
}

module.exports = {
    // Из всего модуля используется только addExperienceWithLevelUp
    // (utils/serverApi.js -> PlayerHelper.addExperience).
    addExperienceWithLevelUp
};
