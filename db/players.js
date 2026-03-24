/**
 * Объединённый модуль запросов к базе данных для игроков
 */

const { query: defaultQuery, queryOne: defaultQueryOne, queryAll, pool } = require('./database');
const { randomBytes } = require('crypto');

const CURRENCY_FIELDS = Object.freeze({
    coins: 'coins',
    stars: 'stars'
});

const ERR_PLAYER_NOT_FOUND = 'Игрок не найден';
const TX_TIMEOUT_MS = 5000;

function validateId(id, name = 'id') {
    const num = Number(id);
    if (!Number.isInteger(num) || num <= 0) throw new Error(`Неверный ${name}`);
    return num;
}

function validateString(str, name, maxLength = 50) {
    if (typeof str !== 'string') throw new Error(`Неверное поле ${name}`);
    str = str.trim();
    if (!str) throw new Error(`Неверное поле ${name}`);
    if (str.length > maxLength) throw new Error(`${name} слишком длинное`);
    return str;
}

function validateAmount(amount) {
    if (!Number.isFinite(amount)) throw new Error('Неверное количество');
}

function validateExperience(exp) {
    if (exp <= 0) throw new Error('Опыт должен быть положительным');
}

function normalizeLimit(limit, max = 100) {
    const num = Number(limit);
    if (!Number.isInteger(num) || num <= 0) return 10;
    return Math.min(num, max);
}

function serializeJSONField(field) {
    try { return JSON.stringify(field ?? {}); } catch { return '{}'; }
}

function getExecutor(client) {
    return client ? client.query.bind(client) : defaultQuery;
}

function getQueryOneFunc(client) {
    return client 
        ? (sql, params) => client.query(sql, params).then(res => res.rows[0] || null)
        : defaultQueryOne;
}

const tx = async (fn, retries = 2) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = ${TX_TIMEOUT_MS}`);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        if (retries > 0 && err.code === '40P01') return tx(fn, retries - 1);
        throw err;
    } finally {
        client.release();
    }
};

async function logPlayerAction(playerId, action, meta = {}, client = null) {
    const exec = getExecutor(client);
    try {
        await exec('INSERT INTO player_logs (player_id, action, metadata, created_at) VALUES ($1, $2, $3, NOW())',
            [playerId, action, serializeJSONField(meta)]);
    } catch (err) {
        // Логирование ошибок в консоль для диагностики, но не блокируем основной поток
        console.error(`Ошибка логирования действия игрока ${playerId}: ${action}`, err.message);
    }
}

async function getPlayerById(playerId, client = null) {
    return getQueryOneFunc(client)('SELECT * FROM players WHERE id = $1', [validateId(playerId, 'playerId')]);
}

async function getPlayerByTelegramId(telegramId, client = null) {
    return getQueryOneFunc(client)('SELECT * FROM players WHERE telegram_id = $1', [validateId(telegramId, 'telegramId')]);
}

async function createPlayer(telegramId, username, firstName, lastName) {
    telegramId = validateId(telegramId, 'telegramId');
    if (username) validateString(username, 'username', 50);
    if (firstName) validateString(firstName, 'firstName', 50);
    
    const referralCode = 'REF' + randomBytes(4).toString('hex').toUpperCase();
    const result = await defaultQuery(
        `INSERT INTO players (telegram_id, username, first_name, last_name, referral_code, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (telegram_id) DO NOTHING RETURNING id`,
        [telegramId, username || null, firstName || null, lastName || null, referralCode]
    );
    
    if (result.rows[0]) {
        await logPlayerAction(result.rows[0].id, 'player_created', { telegramId });
        return { id: result.rows[0].id, referralCode };
    }
    const existing = await getPlayerByTelegramId(telegramId);
    return { id: existing.id, referralCode: existing.referral_code };
}

async function getAllPlayers(limit = 100, offset = 0) {
    limit = normalizeLimit(limit, 100);
    offset = Math.max(0, Number(offset) || 0);
    return { success: true, players: await queryAll(
        'SELECT id, telegram_id, username, first_name, level, coins, stars FROM players ORDER BY level DESC LIMIT $1 OFFSET $2',
        [limit, offset]
    )};
}

async function getTopPlayers(limit = 10, offset = 0) {
    limit = normalizeLimit(limit, 100);
    offset = Math.max(0, Number(offset) || 0);
    return { success: true, players: await queryAll(
        'SELECT id, telegram_id, username, first_name, level, experience FROM players ORDER BY level DESC, experience DESC LIMIT $1 OFFSET $2',
        [limit, offset]
    )};
}

async function updatePlayerLocation(playerId, locationId) {
    playerId = validateId(playerId, 'playerId');
    locationId = validateId(locationId, 'locationId');
    const result = await defaultQuery('UPDATE players SET current_location_id = $1 WHERE id = $2', [locationId, playerId]);
    if (result.rowCount === 0) throw new Error(ERR_PLAYER_NOT_FOUND);
    await logPlayerAction(playerId, 'location_changed', { locationId });
    return { success: true };
}

async function updatePlayerEnergy(playerId, energyChange, options = {}) {
    const { client = null, useTransaction = false, updateTimestamp = true } = options;
    playerId = validateId(playerId, 'playerId');
    const timestampClause = updateTimestamp ? ', last_energy_update = NOW()' : '';
    
    const process = async (txClient) => {
        const exec = getExecutor(txClient || client);
        const result = await exec(
            `UPDATE players SET energy = LEAST(max_energy, GREATEST(0, energy + $1)) ${timestampClause} WHERE id = $2 RETURNING energy, max_energy`,
            [energyChange, playerId]
        );
        if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
        return { success: true, energy: result.rows[0].energy, max_energy: result.rows[0].max_energy };
    };
    
    return useTransaction ? tx(process) : process(client);
}

async function setPlayerHealth(playerId, newHealth, options = {}) {
    // Устанавливает абсолютное значение здоровья (не дельту)
    // Для изменения здоровья на дельту используйте updatePlayerEnergy с отрицательным значением
    const { useReturning = false } = options;
    playerId = validateId(playerId, 'playerId');
    const returningClause = useReturning ? 'RETURNING health, max_health' : '';
    const result = await defaultQuery(
        `UPDATE players SET health = LEAST(max_health, GREATEST(0, $1)), updated_at = NOW() WHERE id = $2 ${returningClause}`,
        [newHealth, playerId]
    );
    if (result.rowCount === 0) throw new Error(ERR_PLAYER_NOT_FOUND);
    await logPlayerAction(playerId, 'health_updated', { health: newHealth });
    return useReturning ? { success: true, ...result.rows[0] } : { success: true };
}

async function incrementPlayerActions(playerId) {
    playerId = validateId(playerId, 'playerId');
    const result = await defaultQuery(
        'UPDATE players SET total_actions = total_actions + 1, last_action_time = NOW() WHERE id = $1 RETURNING total_actions',
        [playerId]
    );
    if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
    return result.rows[0];
}

async function addCurrency(playerId, field, amount) {
    playerId = validateId(playerId, 'playerId');
    validateAmount(amount);
    const column = CURRENCY_FIELDS[field];
    if (!column) throw new Error('Недопустимое поле валюты');
    
    return tx(async (client) => {
        const result = await client.query(
            `UPDATE players SET ${column} = GREATEST(0, ${column} + $1) WHERE id = $2 RETURNING ${column}`,
            [amount, playerId]
        );
        if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
        const newValue = result.rows[0][column];
        await logPlayerAction(playerId, `${column}_added`, { amount, newValue }, client);
        return { success: true, [column]: newValue };
    });
}

async function addCoins(playerId, amount) { return addCurrency(playerId, 'coins', amount); }
async function addStars(playerId, amount) { return addCurrency(playerId, 'stars', amount); }

async function updateInventory(playerId, inventory) {
    playerId = validateId(playerId, 'playerId');
    const itemCount = Array.isArray(inventory) ? inventory.length : Object.keys(inventory || {}).length;
    const result = await defaultQuery('UPDATE players SET inventory = $1 WHERE id = $2', [serializeJSONField(inventory), playerId]);
    if (result.rowCount === 0) throw new Error(ERR_PLAYER_NOT_FOUND);
    await logPlayerAction(playerId, 'inventory_updated', { itemCount });
    return { success: true };
}

async function updateEquipment(playerId, equipment) {
    playerId = validateId(playerId, 'playerId');
    const result = await defaultQuery('UPDATE players SET equipment = $1 WHERE id = $2', [serializeJSONField(equipment), playerId]);
    if (result.rowCount === 0) throw new Error(ERR_PLAYER_NOT_FOUND);
    await logPlayerAction(playerId, 'equipment_updated', { equipment });
    return { success: true };
}

async function updatePlayerExperience(playerId, exp, options = {}) {
    const { client = null, updateTimestamp = true } = options;
    playerId = validateId(playerId, 'playerId');
    const exec = getExecutor(client);
    const result = await exec(
        `UPDATE players SET experience = experience + $1 ${updateTimestamp ? ', updated_at = NOW()' : ''} WHERE id = $2 RETURNING level, experience, max_energy, max_health`,
        [exp, playerId]
    );
    if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
    return result.rows[0];
}

async function levelUpPlayer(playerId, client, levelsGained = 1, newExperience = 0) {
    playerId = validateId(playerId, 'playerId');
    const exec = getExecutor(client);
    
    // Формула прокачки удачи: каждый уровень даёт +1 к удаче
    // С ограничением MAX_LUCK = 150
    const luckBonusPerLevel = 1;
    const luckBonus = levelsGained * luckBonusPerLevel;
    
    // Исправлено: LEAST(energy + bonus, max_energy + bonus) вместо LEAST(max_energy + bonus, max_energy + bonus)
    // Теперь при level-up восстанавливается текущее значение + бонус, с ограничением max
    // Также добавлена прокачка удачи с ограничением MAX_LUCK = 150
    const result = levelsGained <= 1
        ? await exec(
            `WITH updated AS (UPDATE players SET level = level + 1, experience = 0, max_energy = max_energy + 1, max_health = max_health + 1, boss_damage = COALESCE(boss_damage, 0) + 1, luck = LEAST(149, luck + 1), energy = LEAST(energy + 1, max_energy + 1), health = LEAST(health + 1, max_health + 1), updated_at = NOW() WHERE id = $1 RETURNING *) SELECT * FROM updated`,
            [playerId]
        )
        : await exec(
            `WITH updated AS (UPDATE players SET level = level + $1, experience = $2, max_energy = max_energy + ($1 * 1), max_health = max_health + ($1 * 1), boss_damage = COALESCE(boss_damage, 0) + $1, luck = LEAST(149, luck + $3), energy = LEAST(energy + ($1 * 1), max_energy + ($1 * 1)), health = LEAST(health + ($1 * 1), max_health + ($1 * 1)), updated_at = NOW() WHERE id = $4 RETURNING *) SELECT * FROM updated`,
            [levelsGained, newExperience, luckBonus, playerId]
        );
    
    if (!result.rows[0]) throw new Error(ERR_PLAYER_NOT_FOUND);
    return result.rows[0];
}

async function lockPlayer(playerId, client) {
    if (!client) throw new Error('lockPlayer требует client');
    playerId = validateId(playerId, 'playerId');
    const result = await client.query('SELECT * FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    return result.rows[0];
}

async function addExperienceWithLevelUp(client, playerId, exp, getExpForLevel) {
    if (!client) throw new Error('addExperienceWithLevelUp требует client');
    playerId = validateId(playerId, 'playerId');
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
        // levelUpPlayer устанавливает experience = newExperience напрямую
        await levelUpPlayer(playerId, client, totalLevelsGained, newExperience);
        await logPlayerAction(playerId, 'level_up', { old_level: lockedPlayer.level, new_level: newLevel, levels_gained: totalLevelsGained, exp_gained: exp }, client);
    } else {
        // Упрощено: при !leveledUp цикл while не выполнился ни разу,
        // значит newExperience = lockedPlayer.experience + exp, т.е. delta === exp
        await updatePlayerExperience(playerId, exp, { client, updateTimestamp: false });
        await logPlayerAction(playerId, 'add_experience', { exp_gained: exp, total_exp: newExperience, level: newLevel }, client);
    }
    
    return { level: newLevel, experience: newExperience, leveled_up: leveledUp, levels_gained: totalLevelsGained, exp_needed: getExpForLevel(newLevel) };
}

async function getPlayersByClan(clanId, limit = 50, offset = 0) {
    clanId = validateId(clanId, 'clanId');
    limit = normalizeLimit(limit, 100);
    offset = Math.max(0, Number(offset) || 0);
    
    // COUNT(*) OVER() — простой и эффективный способ получить total без второго запроса
    const players = await queryAll(
        'SELECT *, COUNT(*) OVER() as total FROM players WHERE clan_id = $1 ORDER BY clan_donated DESC LIMIT $2 OFFSET $3',
        [clanId, limit, offset]
    );
    const total = players.length > 0 ? parseInt(players[0].total) : 0;
    return { success: true, players: players.map(p => { const { total: _, ...player } = p; return player; }), total };
}

async function setPlayerClan(playerId, clanId, role) {
    playerId = validateId(playerId, 'playerId');
    if (clanId !== null) clanId = validateId(clanId, 'clanId');
    if (role) validateString(role, 'role', 20);
    const result = await defaultQuery('UPDATE players SET clan_id = $1, clan_role = $2 WHERE id = $3', [clanId, role, playerId]);
    if (result.rowCount === 0) throw new Error(ERR_PLAYER_NOT_FOUND);
    await logPlayerAction(playerId, 'clan_changed', { clanId, role });
    return { success: true };
}

async function removePlayerFromClan(playerId) {
    playerId = validateId(playerId, 'playerId');
    const result = await defaultQuery('UPDATE players SET clan_id = NULL, clan_role = NULL WHERE id = $1', [playerId]);
    if (result.rowCount === 0) throw new Error(ERR_PLAYER_NOT_FOUND);
    await logPlayerAction(playerId, 'clan_left', {});
    return { success: true };
}

module.exports = {
    // Транзакции и утилиты
    tx,
    validateId,
    validateString,
    logPlayerAction,
    
    // Игроки
    createPlayer,
    getPlayerById,
    getPlayerByTelegramId,
    getAllPlayers,
    getTopPlayers,
    
    // Статус игрока
    updatePlayerLocation,
    updatePlayerEnergy,
    setPlayerHealth,
    incrementPlayerActions,
    
    // Валюты
    addCurrency,
    addCoins,
    addStars,
    
    // Инвентарь
    updateInventory,
    updatePlayerInventory: updateInventory,  // Alias для обратной совместимости
    updateEquipment,
    
    // Опыт
    updatePlayerExperience,
    addExperienceWithLevelUp,
    levelUpPlayer,
    lockPlayer,
    
    // Кланы
    getPlayersByClan,
    setPlayerClan,
    removePlayerFromClan
};
