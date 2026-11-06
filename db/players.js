/**
 * 0?@>AK :  4;O 83@>:>2.
 *
 *  ?@>5:B5 8A?>;L7C5BAO B>;L:> addExperienceWithLevelUp; >AB0;L=K5
 * >?5@0F88 (A>740=85 83@>:0, >1=>2;5=85 8=25=B0@O 8 M:8?8@>2:8) 45;0NB
 * @>CBK A2>8<8 UPDATE.
 */
const { query: defaultQuery } = require('./database');
// 1I0O 20;840F8O ID. <?>@B8@C5BAO 87 utils/validate.js, 0  87
// serverApi: B>B ;5=82> B@51C5B MB>B 65 D09; (require 2=CB@8
// PlayerHelper.addExperience), 8 25@E=5C@>2=52K9 8<?>@B 40; 1K F8:;.
// utils/validate.js 7028A8<>AB59 =5 8<55B, ?>MB><C F8:;0 =5 1C45B.
const { requireId } = require('../utils/validate');
const equipmentRules = require('../public/shared/equipment.js');

const ERR_PLAYER_NOT_FOUND = '3@>: =5 =0945=';

function getExecutor(client) {
    return client ? client.query.bind(client) : defaultQuery;
}

function validateExperience(exp) {
    if (!Number.isFinite(exp) || exp <= 0) throw new Error('?KB 4>;65= 1KBL ?>;>68B5;L=K<');
}

// >38@>20=85 15@Q< 87 utils/log.js, 0  87 utils/serverApi.js.
//  0=LH5 745AL AB>O; 8<?>@B serverApi, 0 B>B 3@C78; MB>B 65 D09;
// ;5=82> (require 2=CB@8 PlayerHelper.addExperience)  ?>;CG0;AO F8:;
// db/players.js <-> utils/serverApi.js, C45@68205<K9 B>;L:> B5<, GB>
// >10 8<?>@B0 =5 2K?>;=O;8AL =0 25@E=5< C@>2=5. "5?5@L F8:;0 =5B:
// log.js =5 AAK;05BAO =8 =0 serverApi, =8 =0 players.

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
    
    // $>@<C;0 ?@>:0G:8 C40G8: :064K9 C@>25=L 40QB +1 : C40G5
    // ! >3@0=8G5=85< MAX_LUCK = 150
    const luckBonusPerLevel = 1;
    const luckBonus = levelsGained * luckBonusPerLevel;
    const maxLuck = equipmentRules.GAME_CONFIG.MAX_LUCK;
    
    const result = levelsGained <= 1
        ? await exec(
            `WITH updated AS (UPDATE players SET level = level + 1, experience = $2, max_energy = COALESCE(max_energy,0) + 1, max_health = COALESCE(max_health,0) + 1, boss_damage = COALESCE(boss_damage, 0) + 1, luck = LEAST($3, COALESCE(luck,0) + 1), energy = LEAST(COALESCE(energy,0) + 1, COALESCE(max_energy,0) + 1), health = LEAST(COALESCE(health,0) + 1, COALESCE(max_health,0) + 1), updated_at = NOW() WHERE id = $1 RETURNING *) SELECT * FROM updated`,
            [playerId, newExperience, maxLuck]
        )
        : await exec(
            `WITH updated AS (UPDATE players SET level = level + $1, experience = $2, max_energy = COALESCE(max_energy,0) + $1, max_health = COALESCE(max_health,0) + $1, boss_damage = COALESCE(boss_damage, 0) + $1, luck = LEAST($5, COALESCE(luck,0) + $3), energy = LEAST(COALESCE(energy,0) + $1, COALESCE(max_energy,0) + $1), health = LEAST(COALESCE(health,0) + $1, COALESCE(max_health,0) + $1), updated_at = NOW() WHERE id = $4 RETURNING *) SELECT * FROM updated`,
            [levelsGained, newExperience, luckBonus, playerId, maxLuck]
        );
    
    if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
    return result.rows[0];
}

async function lockPlayer(playerId, client, columns = '*') {
    if (!client) throw new Error('lockPlayer B@51C5B client');
    playerId = requireId(playerId, 'playerId');
    let cols = '*';
    if (columns && columns !== '*') {
        const parts = columns.split(',').map(c => c.trim()).filter(Boolean);
        if (!parts.length || !parts.every(p => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p))) {
            throw new Error('54>?CAB8<K5 8<5=0 :>;>=>: 2 lockPlayer');
        }
        cols = parts.join(', ');
    }
    const result = await client.query(`SELECT ${cols} FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    return result.rows[0];
}

async function addExperienceWithLevelUp(client, playerId, exp, getExpForLevel) {
    if (!client) throw new Error('addExperienceWithLevelUp B@51C5B client');
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
    // 7 2A53> <>4C;O 8A?>;L7C5BAO B>;L:> addExperienceWithLevelUp
    // (utils/serverApi.js -> PlayerHelper.addExperience).
    addExperienceWithLevelUp,
    lockPlayer
};
