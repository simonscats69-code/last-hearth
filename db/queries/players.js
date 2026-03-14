/**
 * Запросы для работы с игроками
 * @module players
 */

const { query, queryOne, queryAll } = require('../database');

// Транзакции
const tx = async (fn) => {
    await query('BEGIN');
    try {
        const r = await fn();
        await query('COMMIT');
        return r;
    } catch (e) {
        await query('ROLLBACK');
        throw e;
    }
};

/**
 * Централизованная обработка ошибок
 * @param {Error} error 
 * @param {string} context 
 */
function handleError(error, context) {
    logger.error(`[${context}] error:`, error.message);
    // Можно добавить отправку в Sentry или другой сервис
    // if (process.env.SENTRY_DSN) captureException(error);
}

/**
 * Сериализация JSON с защитой от ошибок
 * @param {any} field 
 * @returns {string}
 */
function serializeJSONField(field) {
    if (!field) return '{}';
    try {
        return JSON.stringify(field);
    } catch {
        return '{}';
    }
}

/**
 * Валидация ID
 * @param {number} id 
 * @param {string} name 
 */
function validateId(id, name = 'id') {
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`Неверный ${name}`);
    }
}

/**
 * Валидация строки
 * @param {string} str 
 * @param {string} name 
 * @param {number} maxLength 
 */
function validateString(str, name, maxLength = 50) {
    if (typeof str !== 'string' || !str.trim()) {
        throw new Error(`Неверное поле ${name}`);
    }
    if (str.length > maxLength) {
        throw new Error(`${name} слишком длинное (макс. ${maxLength})`);
    }
}

/**
 * Логирование действий игрока
 * @param {number} playerId 
 * @param {string} action 
 * @param {object} meta 
 */
async function logPlayerAction(playerId, action, meta = {}) {
    try {
        await query(
            'INSERT INTO player_logs (player_id, action, metadata, created_at) VALUES ($1, $2, $3, NOW())',
            [playerId, action, serializeJSONField(meta)]
        );
    } catch (err) {
        handleError(err, 'logPlayerAction');
    }
}

/**
 * === ИГРОКИ ===
 */

/**
 * Создание нового игрока
 * @param {number} telegramId 
 * @param {string|null} username 
 * @param {string|null} firstName 
 * @returns {Promise<{id: number, referralCode: string}>}
 */
async function createPlayer(telegramId, username, firstName) {
    try {
        validateId(telegramId, 'telegramId');
        if (username) validateString(username, 'username', 50);
        if (firstName) validateString(firstName, 'firstName', 50);
        
        const referralCode = 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const result = await query(`
            INSERT INTO players (telegram_id, username, first_name, referral_code, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id
        `, [telegramId, username || null, firstName || null, referralCode]);
        
        const data = { id: result.rows[0].id, referralCode };
        await logPlayerAction(data.id, 'player_created', { telegramId });
        
        return data;
    } catch (err) {
        handleError(err, 'createPlayer');
        throw new Error('Не удалось создать игрока');
    }
}

/**
 * Получить игрока по Telegram ID
 * @param {number} telegramId 
 * @returns {Promise<object|null>}
 */
async function getPlayerByTelegramId(telegramId) {
    validateId(telegramId, 'telegramId');
    return await queryOne('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
}

/**
 * Получить игрока по ID
 * @param {number} playerId 
 * @returns {Promise<object|null>}
 */
async function getPlayerById(playerId) {
    validateId(playerId, 'playerId');
    return await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
}

/**
 * === СТАТУС ===
 */

/**
 * Обновить местоположение игрока
 * @param {number} playerId 
 * @param {number} locationId 
 * @returns {Promise<{success: boolean}>}
 */
async function updatePlayerLocation(playerId, locationId) {
    validateId(playerId, 'playerId');
    validateId(locationId, 'locationId');
    
    await query(
        'UPDATE players SET current_location_id = $1 WHERE id = $2',
        [locationId, playerId]
    );
    
    await logPlayerAction(playerId, 'location_changed', { locationId });
    return { success: true };
}

/**
 * Обновить энергию игрока (с транзакцией и защитой от превышения max_energy)
 * @param {number} playerId 
 * @param {number} energy 
 * @returns {Promise<{success: boolean, energy: number, max_energy: number}>}
 */
async function updatePlayerEnergy(playerId, energy) {
    validateId(playerId, 'playerId');
    
    return await tx(async () => {
        const player = await queryOne(
            'SELECT energy, max_energy FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!player) throw new Error('Игрок не найден');
        
        const newEnergy = Math.min(energy, player.max_energy);
        
        await query(
            'UPDATE players SET energy = $1, last_energy_update = NOW() WHERE id = $2',
            [newEnergy, playerId]
        );
        
        await logPlayerAction(playerId, 'energy_updated', { energy: newEnergy, max: player.max_energy });
        
        return { success: true, energy: newEnergy, max_energy: player.max_energy };
    });
}

/**
 * Обновить здоровье игрока
 * @param {number} playerId 
 * @param {number} health 
 * @returns {Promise<{success: boolean}>}
 */
async function updatePlayerHealth(playerId, health) {
    validateId(playerId, 'playerId');
    
    await query(
        'UPDATE players SET health = $1 WHERE id = $2',
        [health, playerId]
    );
    
    await logPlayerAction(playerId, 'health_updated', { health });
    return { success: true };
}

/**
 * === ВАЛЮТА ===
 */

/**
 * Добавить монеты игроку (с транзакцией)
 * @param {number} playerId 
 * @param {number} amount 
 * @returns {Promise<{success: boolean, coins: number}>}
 */
async function addCoins(playerId, amount) {
    validateId(playerId, 'playerId');
    
    return await tx(async () => {
        const player = await queryOne(
            'SELECT coins FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!player) throw new Error('Игрок не найден');
        
        await query(
            'UPDATE players SET coins = coins + $1 WHERE id = $2',
            [amount, playerId]
        );
        
        const updated = await queryOne('SELECT coins FROM players WHERE id = $1', [playerId]);
        
        await logPlayerAction(playerId, 'coins_added', { amount, newCoins: updated.coins });
        
        return { success: true, coins: updated.coins };
    });
}

/**
 * Добавить Stars игроку (с транзакцией)
 * @param {number} playerId 
 * @param {number} amount 
 * @returns {Promise<{success: boolean, stars: number}>}
 */
async function addStars(playerId, amount) {
    validateId(playerId, 'playerId');
    
    return await tx(async () => {
        const player = await queryOne(
            'SELECT stars FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!player) throw new Error('Игрок не найден');
        
        await query(
            'UPDATE players SET stars = stars + $1 WHERE id = $2',
            [amount, playerId]
        );
        
        const updated = await queryOne('SELECT stars FROM players WHERE id = $1', [playerId]);
        
        await logPlayerAction(playerId, 'stars_added', { amount, newStars: updated.stars });
        
        return { success: true, stars: updated.stars };
    });
}

/**
 * === ИНВЕНТАРЬ ===
 */

/**
 * Обновить инвентарь
 * @param {number} playerId 
 * @param {object} inventory 
 * @returns {Promise<{success: boolean}>}
 */
async function updateInventory(playerId, inventory) {
    validateId(playerId, 'playerId');
    
    await query(
        'UPDATE players SET inventory = $1 WHERE id = $2',
        [serializeJSONField(inventory), playerId]
    );
    
    await logPlayerAction(playerId, 'inventory_updated', { itemCount: inventory?.length || 0 });
    return { success: true };
}

/**
 * Обновить экипировку
 * @param {number} playerId 
 * @param {object} equipment 
 * @returns {Promise<{success: boolean}>}
 */
async function updateEquipment(playerId, equipment) {
    validateId(playerId, 'playerId');
    
    await query(
        'UPDATE players SET equipment = $1 WHERE id = $2',
        [serializeJSONField(equipment), playerId]
    );
    
    await logPlayerAction(playerId, 'equipment_updated', { equipment });
    return { success: true };
}

/**
 * === КЛАНЫ ===
 */

/**
 * Получить игроков по клану (с пагинацией)
 * @param {number} clanId 
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<{success: boolean, players: object[], total: number}>}
 */
async function getPlayersByClan(clanId, limit = 50, offset = 0) {
    validateId(clanId, 'clanId');
    
    const players = await queryAll(
        'SELECT * FROM players WHERE clan_id = $1 ORDER BY clan_donated DESC LIMIT $2 OFFSET $3',
        [clanId, limit, offset]
    );
    
    const count = await queryOne(
        'SELECT COUNT(*) as total FROM players WHERE clan_id = $1',
        [clanId]
    );
    
    return { success: true, players, total: parseInt(count.total) };
}

/**
 * Установить клан игроку
 * @param {number} playerId 
 * @param {number|null} clanId 
 * @param {string|null} role 
 * @returns {Promise<{success: boolean}>}
 */
async function setPlayerClan(playerId, clanId, role) {
    validateId(playerId, 'playerId');
    if (clanId !== null) validateId(clanId, 'clanId');
    if (role) validateString(role, 'role', 20);
    
    await query(
        'UPDATE players SET clan_id = $1, clan_role = $2 WHERE id = $3',
        [clanId, role, playerId]
    );
    
    await logPlayerAction(playerId, 'clan_changed', { clanId, role });
    return { success: true };
}

/**
 * Удалить игрока из клана
 * @param {number} playerId 
 * @returns {Promise<{success: boolean}>}
 */
async function removePlayerFromClan(playerId) {
    validateId(playerId, 'playerId');
    
    await query(
        'UPDATE players SET clan_id = NULL, clan_role = NULL WHERE id = $1',
        [playerId]
    );
    
    await logPlayerAction(playerId, 'clan_left', {});
    return { success: true };
}

/**
 * === РЕЙТИНГИ ===
 */

/**
 * Получить топ игроков по уровню (с пагинацией)
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<{success: boolean, players: object[]}>}
 */
async function getTopPlayers(limit = 10, offset = 0) {
    const players = await queryAll(
        'SELECT id, telegram_id, username, first_name, level, experience FROM players ORDER BY level DESC, experience DESC LIMIT $1 OFFSET $2',
        [limit, offset]
    );
    
    return { success: true, players };
}

/**
 * Получить всех игроков (для админки с пагинацией)
 * @param {number} limit 
 * @param {number} offset 
 * @returns {Promise<{success: boolean, players: object[]}>}
 */
async function getAllPlayers(limit = 100, offset = 0) {
    const players = await queryAll(
        'SELECT id, telegram_id, username, first_name, level, coins, stars FROM players ORDER BY level DESC LIMIT $1 OFFSET $2',
        [limit, offset]
    );
    
    return { success: true, players };
}

/**
 * === ЭКСПОРТ ===
 */
module.exports = {
    // Игроки
    player: {
        /** @deprecated */
        create: createPlayer,
        getById: getPlayerById,
        getByTelegram: getPlayerByTelegramId,
        getAll: getAllPlayers,
        getTop: getTopPlayers
    },
    // Статус
    status: {
        updateLocation: updatePlayerLocation,
        updateEnergy: updatePlayerEnergy,
        updateHealth: updatePlayerHealth
    },
    // Валюта
    currency: {
        addCoins,
        addStars
    },
    // Инвентарь
    inventory: {
        update: updateInventory,
        updateEquipment
    },
    // Кланы
    clans: {
        set: setPlayerClan,
        remove: removePlayerFromClan,
        getByClan: getPlayersByClan
    },
    // Достижения (заготовка для будущего)
    achievements: {
        // addAchievement,
        // getPlayerAchievements,
        // getAllAchievements
    },
    // Квесты (заготовка для будущего)
    quests: {
        // addQuestProgress,
        // getPlayerQuests,
        // completeQuest
    },
    // Битвы (заготовка для будущего)
    battle: {
        // attackPlayer,
        // attackBoss,
        // getBattleHistory
    },
    // Утилиты
    utils: {
        handleError,
        validateId,
        validateString,
        serializeJSONField,
        logPlayerAction
    },
    // Обратная совместимость
    createPlayer,
    getPlayerByTelegramId,
    getPlayerById,
    updatePlayerLocation,
    updatePlayerEnergy,
    updatePlayerHealth,
    addCoins,
    addStars,
    updateInventory,
    updateEquipment,
    getAllPlayers,
    getPlayersByClan,
    getTopPlayers,
    setPlayerClan,
    removePlayerFromClan
};
