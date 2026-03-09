/**
 * DB Layer - Чистые запросы к PostgreSQL
 * Без бизнес-логики, только SQL
 */

const { query, queryOne } = require('./database');

/**
 * Получить игрока по ID
 */
async function getPlayerById(playerId) {
    return await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
}

/**
 * Получить игрока по Telegram ID
 */
async function getPlayerByTelegramId(telegramId) {
    return await queryOne('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
}

/**
 * Создать нового игрока
 */
async function createPlayer(telegramId, username, firstName, lastName) {
    return await queryOne(
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
    const result = await query(
        `UPDATE players SET inventory = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [JSON.stringify(inventory), playerId]
    );
    return result.rows[0];
}

/**
 * Обновить энергию (с RETURNING)
 */
async function updatePlayerEnergy(playerId, energyChange) {
    const result = await query(
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
 */
async function updatePlayerEnergyNoLevelUp(playerId, energyChange) {
    const result = await query(
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
    const result = await query(
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
    const result = await query(
        `UPDATE players SET total_actions = total_actions + 1, last_action_time = NOW() WHERE id = $1 RETURNING total_actions`,
        [playerId]
    );
    return result.rows[0];
}

/**
 * Обновить опыт и уровень (с RETURNING)
 */
async function updatePlayerExperience(playerId, exp) {
    const result = await query(
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
 */
async function updatePlayerExperienceNoLevelUp(playerId, exp) {
    const result = await query(
        `UPDATE players 
         SET experience = experience + $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING level, experience, max_energy, max_health`,
        [exp, playerId]
    );
    return result.rows[0];
}

/**
 * Повысить уровень игрока
 */
async function levelUpPlayer(playerId) {
    const result = await query(
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
 */
async function lockPlayer(playerId) {
    return await queryOne('SELECT * FROM players WHERE id = $1 FOR UPDATE', [playerId]);
}

/**
 * Логирование действия игрока
 */
async function logPlayerAction(playerId, action, metadata) {
    await query(
        `INSERT INTO player_logs (player_id, action, metadata, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [playerId, action, JSON.stringify(metadata)]
    );
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
    logPlayerAction
};
