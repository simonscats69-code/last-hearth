/**
 * Утилиты для работы с игроками
 * @deprecated Используйте новые методы из namespace PlayerHelper
 */
const { queryOne, query } = require('../db/database');
const { logger } = require('./logger');

// =============================================================================
// Утилиты
// =============================================================================

/**
 * Централизованный обработчик ошибок
 * @param {Error} error - Объект ошибки
 * @param {string} context - Контекст ошибки
 */
function handleError(error, context) {
    const code = error.code || 'UNKNOWN_ERROR';
    const message = error.message || 'Внутренняя ошибка сервера';
    
    logger.error(`[PlayerHelper:${context}] Ошибка: ${message}`, {
        code,
        stack: error.stack
    });
    
    return {
        success: false,
        error: message,
        code
    };
}

/**
 * Safe JSON parse с fallback
 */
function safeJsonParse(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

/**
 * Транзакция с автocommit/rollback
 */
const tx = async (fn) => {
    await query('BEGIN');
    try {
        const result = await fn();
        await query('COMMIT');
        return result;
    } catch (e) {
        await query('ROLLBACK');
        throw e;
    }
};

// =============================================================================
// Валидация
// =============================================================================

/**
 * Валидация ID игрока
 */
function validatePlayerId(playerId) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { 
            message: 'Некорректный ID игрока', 
            code: 'INVALID_PLAYER_ID',
            statusCode: 400 
        };
    }
}

/**
 * Логирование действия игрока в player_logs
 * @param {number} playerId - ID игрока
 * @param {string} action - Действие
 * @param {object} metadata - JSON метаданные
 */
async function logPlayerAction(playerId, action, metadata = {}) {
    try {
        await query(
            `INSERT INTO player_logs (player_id, action, metadata, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, JSON.stringify(metadata)]
        );
    } catch (err) {
        logger.warn(`Не удалось залогировать действие ${action} для игрока ${playerId}: ${err.message}`);
    }
}

// =============================================================================
// Основные функции
// =============================================================================

/**
 * Получить игрока по Telegram ID
 * @param {string} telegramId - ID пользователя Telegram
 * @returns {Promise<object|null>}
 * @deprecated Используйте PlayerHelper.getByTelegramId()
 */
async function getPlayerByTelegramId(telegramId) {
    // Валидация
    if (!telegramId || isNaN(Number(telegramId))) {
        throw { message: 'Некорректный telegramId', code: 'INVALID_TELEGRAM_ID', statusCode: 400 };
    }
    return await queryOne('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
}

/**
 * Получить игрока по ID
 * @param {number} playerId - ID игрока в базе данных
 * @returns {Promise<object|null>}
 * @deprecated Используйте PlayerHelper.getById()
 */
async function getPlayerById(playerId) {
    validatePlayerId(playerId);
    return await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
}

/**
 * Обновить инвентарь игрока (с транзакцией)
 * @param {number} playerId - ID игрока
 * @param {object} inventory - Новый инвентарь
 * @returns {Promise<object>}
 * @deprecated Используйте PlayerHelper.updateInventory()
 */
async function updatePlayerInventory(playerId, inventory) {
    validatePlayerId(playerId);
    
    if (!inventory || typeof inventory !== 'object') {
        throw { message: 'Инвентарь должен быть объектом', code: 'INVALID_INVENTORY', statusCode: 400 };
    }
    
    return await query('UPDATE players SET inventory = $1 WHERE id = $2', [JSON.stringify(inventory), playerId]);
}

/**
 * Обновить энергию игрока (с транзакцией и блокировкой)
 * @param {number} playerId - ID игрока
 * @param {number} energyChange - Изменение энергии (+/-)
 * @returns {Promise<object>}
 * @deprecated Используйте PlayerHelper.updateEnergy()
 */
async function updatePlayerEnergy(playerId, energyChange) {
    validatePlayerId(playerId);
    
    if (!Number.isInteger(energyChange)) {
        throw { message: 'energyChange должен быть целым числом', code: 'INVALID_ENERGY_CHANGE', statusCode: 400 };
    }
    
    return await tx(async () => {
        // Блокируем строку игрока
        const lockResult = await query('SELECT energy, max_energy FROM players WHERE id = $1 FOR UPDATE', [playerId]);
        
        if (!lockResult.rows.length) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }
        
        const newEnergy = Math.max(0, Math.min(lockResult.rows[0].max_energy, lockResult.rows[0].energy + energyChange));
        
        await query('UPDATE players SET energy = $1 WHERE id = $2', [newEnergy, playerId]);
        
        await logPlayerAction(playerId, 'update_energy', { change: energyChange, new_value: newEnergy });
        
        return { success: true, energy: newEnergy };
    });
}

/**
 * Обновить здоровье игрока (с транзакцией и блокировкой)
 * @param {number} playerId - ID игрока
 * @param {number} health - Новое значение здоровья
 * @returns {Promise<object>}
 * @deprecated Используйте PlayerHelper.updateHealth()
 */
async function updatePlayerHealth(playerId, health) {
    validatePlayerId(playerId);
    
    if (!Number.isInteger(health) || health < 0) {
        throw { message: 'health должен быть неотрицательным числом', code: 'INVALID_HEALTH', statusCode: 400 };
    }
    
    return await tx(async () => {
        const lockResult = await query('SELECT health, max_health FROM players WHERE id = $1 FOR UPDATE', [playerId]);
        
        if (!lockResult.rows.length) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }
        
        const newHealth = Math.max(0, Math.min(lockResult.rows[0].max_health, health));
        
        await query('UPDATE players SET health = $1 WHERE id = $2', [newHealth, playerId]);
        
        await logPlayerAction(playerId, 'update_health', { new_value: newHealth });
        
        return { success: true, health: newHealth };
    });
}

/**
 * Увеличить счётчик действий
 * @param {number} playerId - ID игрока
 * @returns {Promise}
 * @deprecated Используйте PlayerHelper.incrementActions()
 */
async function incrementPlayerActions(playerId) {
    validatePlayerId(playerId);
    return await query('UPDATE players SET total_actions = total_actions + 1, last_action_time = NOW() WHERE id = $1', [playerId]);
}

/**
 * Обновить энергию (с учётом регенерации)
 * @param {number} playerId - ID игрока
 * @returns {Promise<number>} Количество восстановленной энергии
 * @deprecated Используйте PlayerHelper.regenerateEnergy()
 */
async function updateEnergy(playerId) {
    validatePlayerId(playerId);
    
    return await tx(async () => {
        const lockResult = await query(
            'SELECT energy, max_energy, last_energy_update FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!lockResult.rows.length) {
            return 0;
        }
        
        const player = lockResult.rows[0];
        const now = new Date();
        const lastUpdate = new Date(player.last_energy_update);
        const minutesPassed = Math.floor((now - lastUpdate) / 60000);
        
        // 1 энергия каждые 3 минуты
        const energyRestored = Math.floor(minutesPassed / 3);

        if (energyRestored > 0 && player.energy < player.max_energy) {
            const actualRestored = Math.min(energyRestored, player.max_energy - player.energy);
            
            await query(`
                UPDATE players 
                SET energy = LEAST(max_energy, energy + $1),
                    last_energy_update = NOW()
                WHERE id = $2
            `, [actualRestored, playerId]);

            await logPlayerAction(playerId, 'regenerate_energy', { restored: actualRestored });
            
            return actualRestored;
        }

        return 0;
    });
}

/**
 * Добавить опыт игроку
 * @param {number} playerId - ID игрока
 * @param {number} exp - Количество опыта
 * @returns {Promise<object>} Обновлённые данные игрока
 * @deprecated Используйте PlayerHelper.addExperience()
 */
async function addExperience(playerId, exp) {
    validatePlayerId(playerId);
    
    if (!Number.isInteger(exp) || exp <= 0) {
        throw { message: 'exp должен быть положительным числом', code: 'INVALID_EXP', statusCode: 400 };
    }
    
    return await tx(async () => {
        const lockResult = await query(
            'SELECT level, experience, max_energy, max_health FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!lockResult.rows.length) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }
        
        const player = lockResult.rows[0];
        const { getExpForLevel } = require('./gameConstants');
        const expNeeded = getExpForLevel(player.level);
        
        let newExp = player.experience + exp;
        let newLevel = player.level;
        let newMaxEnergy = player.max_energy;
        let newMaxHealth = player.max_health;
        
        // Проверяем повышение уровня
        if (newExp >= expNeeded) {
            newLevel = player.level + 1;
            newExp = newExp - expNeeded;
            
            // Увеличиваем максимальную энергию и здоровье
            newMaxEnergy = Math.min(150, 50 + Math.floor(newLevel / 10) * 5);
            newMaxHealth = Math.min(200, 100 + Math.floor(newLevel / 5) * 10);
            
            await query(`
                UPDATE players 
                SET experience = $1, level = $2, max_energy = $3, health = $4
                WHERE id = $5
            `, [newExp, newLevel, newMaxEnergy, newMaxHealth, playerId]);
            
            await logPlayerAction(playerId, 'level_up', { new_level: newLevel });
        } else {
            await query(`
                UPDATE players SET experience = $1 WHERE id = $2
            `, [newExp, playerId]);
        }
        
        return {
            success: true,
            level: newLevel,
            experience: newExp,
            leveled_up: newLevel > player.level
        };
    });
}

// =============================================================================
// Namespace: PlayerHelper (новый программный интерфейс)
// =============================================================================

const PlayerHelper = {
    /**
     * Получить игрока по Telegram ID
     * @param {string} telegramId - ID пользователя Telegram
     */
    async getByTelegramId(telegramId) {
        if (!telegramId || isNaN(Number(telegramId))) {
            throw { message: 'Некорректный telegramId', code: 'INVALID_TELEGRAM_ID', statusCode: 400 };
        }
        return await queryOne('SELECT * FROM players WHERE telegram_id = $1', [telegramId]);
    },
    
    /**
     * Получить игрока по ID
     * @param {number} playerId - ID игрока
     */
    async getById(playerId) {
        validatePlayerId(playerId);
        return await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
    },
    
    /**
     * Обновить инвентарь
     * @param {number} playerId - ID игрока
     * @param {object} inventory - Инвентарь
     */
    async updateInventory(playerId, inventory) {
        validatePlayerId(playerId);
        if (!inventory || typeof inventory !== 'object') {
            throw { message: 'Инвентарь должен быть объектом', code: 'INVALID_INVENTORY', statusCode: 400 };
        }
        return await query('UPDATE players SET inventory = $1 WHERE id = $2', [JSON.stringify(inventory), playerId]);
    },
    
    /**
     * Обновить энергию
     * @param {number} playerId - ID игрока
     * @param {number} energyChange - Изменение
     */
    async updateEnergy(playerId, energyChange) {
        return await updatePlayerEnergy(playerId, energyChange);
    },
    
    /**
     * Обновить здоровье
     * @param {number} playerId - ID игрока
     * @param {number} health - Здоровье
     */
    async updateHealth(playerId, health) {
        return await updatePlayerHealth(playerId, health);
    },
    
    /**
     * Увеличить счётчик действий
     * @param {number} playerId - ID игрока
     */
    async incrementActions(playerId) {
        return await incrementPlayerActions(playerId);
    },
    
    /**
     * Регенерировать энергию
     * @param {number} playerId - ID игрока
     */
    async regenerateEnergy(playerId) {
        return await updateEnergy(playerId);
    },
    
    /**
     * Добавить опыт
     * @param {number} playerId - ID игрока
     * @param {number} exp - Опыт
     */
    async addExperience(playerId, exp) {
        return await addExperience(playerId, exp);
    }
};

module.exports = {
    getPlayerByTelegramId,
    getPlayerById,
    updatePlayerInventory,
    updatePlayerEnergy,
    updatePlayerHealth,
    incrementPlayerActions,
    updateEnergy,
    addExperience,
    // Namespace
    PlayerHelper
};
