/**
 * DB Layer - Чистые запросы к PostgreSQL
 * Без бизнес-логики, только SQL
 * Поддержка транзакций через опциональный параметр client
 */

const { query: defaultQuery, queryOne: defaultQueryOne } = require('./database');

/**
 * Получить executor запроса (client для транзакции или default pool)
 */
function getExecutor(client) {
    return client || defaultQuery;
}

/**
 * Получить функцию queryOne (client для транзакции или default)
 */
function getQueryOneFunc(client) {
    return client 
        ? (sql, params) => client.query(sql, params).then(res => res.rows[0] || null)
        : defaultQueryOne;
}

/**
 * Получить игрока по ID
 * @param {number} playerId - ID игрока
 * @param {object} client - Опциональный клиент транзакции
 */
async function getPlayerById(playerId, client = null) {
    const queryOne = getQueryOneFunc(client);
    return await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
}

/**
 * Получить игрока по Telegram ID
 * @param {string} telegramId - Telegram ID
 * @param {object} client - Опциональный клиент транзакции
 */
async function getPlayerByTelegramId(telegramId, client = null) {
    const queryOne = getQueryOneFunc(client);
    return await queryOne('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
}

/**
 * Создать нового игрока
 */
async function createPlayer(telegramId, username, firstName, lastName) {
    return await defaultQuery(
        `INSERT INTO players (telegram_id, username, first_name, last_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING *`,
        [telegramId, username, firstName, lastName]
    );
}

/**
 * Обновить инвентарь
 */
async function updatePlayerInventory(playerId, inventory) {
    const result = await defaultQuery(
        `UPDATE players SET inventory = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [JSON.stringify(inventory), playerId]
    );
    return result.rows[0];
}

/**
 * Обновить энергию (с RETURNING)
 */
async function updatePlayerEnergy(playerId, energyChange) {
    const result = await defaultQuery(
        `UPDATE players 
         SET energy = LEAST(max_energy, GREATEST(0, energy + $1)), 
             updated_at = NOW() 
         WHERE id = $2 
         RETURNING energy, max_energy`,
        [energyChange, playerId]
    );
    return result.rows[0];
}

/**
 * Обновить энергию БЕЗ изменения updated_at (используется внутри транзакции)
 * @param {object} client - Клиент транзакции
 */
async function updatePlayerEnergyNoLevelUp(playerId, energyChange, client = null) {
    const exec = getExecutor(client);
    const result = await exec(
        `UPDATE players 
         SET energy = LEAST(max_energy, GREATEST(0, energy + $1))
         WHERE id = $2 
         RETURNING energy, max_energy`,
        [energyChange, playerId]
    );
    return result.rows[0];
}

/**
 * Обновить здоровье (с RETURNING)
 */
async function updatePlayerHealth(playerId, health) {
    const result = await defaultQuery(
        `UPDATE players 
         SET health = LEAST(max_health, GREATEST(0, $1)), 
             updated_at = NOW() 
         WHERE id = $2 
         RETURNING health, max_health`,
        [health, playerId]
    );
    return result.rows[0];
}

/**
 * Увеличить счётчик действий
 */
async function incrementPlayerActions(playerId) {
    const result = await defaultQuery(
        `UPDATE players SET total_actions = total_actions + 1, last_action_time = NOW() WHERE id = $1 RETURNING total_actions`,
        [playerId]
    );
    return result.rows[0];
}

/**
 * Обновить опыт и уровень (с RETURNING)
 */
async function updatePlayerExperience(playerId, exp) {
    const result = await defaultQuery(
        `UPDATE players 
         SET experience = experience + $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING level, experience, max_energy, max_health`,
        [exp, playerId]
    );
    return result.rows[0];
}

/**
 * Обновить опыт БЕЗ повышения уровня (используется внутри транзакции)
 * @param {object} client - Клиент транзакции
 */
async function updatePlayerExperienceNoLevelUp(playerId, exp, client = null) {
    const exec = getExecutor(client);
    const result = await exec(
        `UPDATE players 
         SET experience = experience + $1
         WHERE id = $2 
         RETURNING level, experience, max_energy, max_health`,
        [exp, playerId]
    );
    return result.rows[0];
}

/**
 * Повысить уровень игрока
 * @param {object} client - Клиент транзакции
 */
async function levelUpPlayer(playerId, client = null) {
    const exec = getExecutor(client);
    const result = await exec(
        `UPDATE players 
         SET level = level + 1,
             experience = 0,
             max_energy = max_energy + 5,
             max_health = max_health + 10,
             energy = max_energy + 5,
             health = max_health + 10,
             updated_at = NOW() 
         WHERE id = $1 
         RETURNING *`,
        [playerId]
    );
    return result.rows[0];
}

/**
 * Заблокировать строку игрока (FOR UPDATE)
 * @param {object} client - Клиент транзакции (ОБЯЗАТЕЛЕН для транзакции)
 */
async function lockPlayer(playerId, client) {
    if (!client) {
        throw new Error('lockPlayer требует client для транзакции');
    }
    return await client.query('SELECT * FROM players WHERE id = $1 FOR UPDATE', [playerId]).then(res => res.rows[0]);
}

/**
 * Логирование действия игрока
 * @param {object} client - Клиент транзакции
 */
async function logPlayerAction(playerId, action, metadata, client = null) {
    const exec = getExecutor(client);
    await exec(
        `INSERT INTO player_logs (player_id, action, metadata, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [playerId, action, JSON.stringify(metadata)]
    );
}

/**
 * Добавить опыт с проверкой level up (внутри транзакции)
 * @param {object} client - Клиент транзакции (ОБЯЗАТЕЛЕН)
 * @param {number} playerId - ID игрока
 * @param {number} exp - Количество опыта
 * @param {function} getExpForLevel - Функция для получения опыта на уровень
 */
async function addExperienceWithLevelUp(client, playerId, exp, getExpForLevel) {
    // Блокируем строку игрока
    const lockedPlayer = await lockPlayer(playerId, client);
    
    if (!lockedPlayer) {
        throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }
    
    // Добавляем опыт
    let newExperience = lockedPlayer.experience + exp;
    let newLevel = lockedPlayer.level;
    let leveledUp = false;
    
    // Проверяем нужен ли level up
    const expNeeded = getExpForLevel(lockedPlayer.level);
    
    if (newExperience >= expNeeded) {
        // Level up!
        newLevel = lockedPlayer.level + 1;
        newExperience = newExperience - expNeeded;
        
        // Обновляем с учётом level up
        await levelUpPlayer(playerId, client);
        leveledUp = true;
        
        await logPlayerAction(playerId, 'level_up', { 
            old_level: lockedPlayer.level, 
            new_level: newLevel,
            exp_gained: exp
        }, client);
    } else {
        // Просто обновляем опыт
        await updatePlayerExperienceNoLevelUp(playerId, exp, client);
        
        await logPlayerAction(playerId, 'add_experience', { 
            exp_gained: exp,
            total_exp: newExperience,
            level: newLevel
        }, client);
    }
    
    return { 
        level: newLevel, 
        experience: newExperience,
        leveled_up: leveledUp,
        exp_needed: getExpForLevel(newLevel)
    };
}

module.exports = {
    getPlayerById,
    getPlayerByTelegramId,
    createPlayer,
    updatePlayerInventory,
    updatePlayerEnergy,
    updatePlayerEnergyNoLevelUp,
    updatePlayerHealth,
    incrementPlayerActions,
    updatePlayerExperience,
    updatePlayerExperienceNoLevelUp,
    levelUpPlayer,
    lockPlayer,
    logPlayerAction,
    addExperienceWithLevelUp
};
