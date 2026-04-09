/**
 * Service Layer - Бизнес-логика игроков
 * Использует DB Layer и содержит правила игры
 */

const db = require('./db/players');
const { getExpForLevel } = require('./utils/gameConstants');
const { transaction: tx } = require('./db/database');

// Используем локальный логгер, чтобы не создавать циклическую зависимость
// между сервисом игроков и серверными утилитами.
const logger = {
    info: (...args) => console.info(...args)
};

/**
 * Получить игрока по ID
 */
async function getById(playerId) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    return await db.getPlayerById(playerId);
}

/**
 * Получить игрока по Telegram ID
 */
async function getByTelegramId(telegramId) {
    if (!telegramId || isNaN(Number(telegramId))) {
        throw { message: 'Некорректный telegramId', code: 'INVALID_TELEGRAM_ID', statusCode: 400 };
    }
    return await db.getPlayerByTelegramId(telegramId);
}

/**
 * Обновить инвентарь
 */
async function updateInventory(playerId, inventory) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    if ((!Array.isArray(inventory) && (!inventory || typeof inventory !== 'object')) || inventory === null) {
        throw { message: 'Инвентарь должен быть массивом или объектом', code: 'INVALID_INVENTORY', statusCode: 400 };
    }
    
    const result = await db.updatePlayerInventory(playerId, inventory);
    const inventorySize = Array.isArray(inventory) ? inventory.length : Object.keys(inventory).length;
    await db.logPlayerAction(playerId, 'update_inventory', { inventory_size: inventorySize });
    
    return result;
}

/**
 * Обновить энергию
 * Проверяет лимиты, логирует изменение
 */
async function updateEnergy(playerId, energyChange) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    
    const result = await db.updatePlayerEnergy(playerId, energyChange);
    
    if (!result) {
        throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }
    
    await db.logPlayerAction(playerId, 'update_energy', { 
        change: energyChange, 
        new_energy: result.energy,
        max_energy: result.max_energy
    });
    
    logger.info(`Игрок ${playerId}: энергия ${result.energy}/${result.max_energy}`);
    
    return { 
        success: true, 
        energy: result.energy, 
        max_energy: result.max_energy 
    };
}

/**
 * Обновить здоровье
 * Проверяет лимиты, логирует изменение
 */
async function updateHealth(playerId, health) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    if (!Number.isInteger(health) || health < 0) {
        throw { message: 'health должен быть неотрицательным числом', code: 'INVALID_HEALTH', statusCode: 400 };
    }
    
    const result = await db.setPlayerHealth(playerId, health, { useReturning: true });
    
    if (!result) {
        throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }
    
    await db.logPlayerAction(playerId, 'update_health', { 
        new_health: result.health,
        max_health: result.max_health
    });
    
    logger.info(`Игрок ${playerId}: здоровье ${result.health}/${result.max_health}`);
    
    return { 
        success: true, 
        health: result.health, 
        max_health: result.max_health 
    };
}

/**
 * Увеличить счётчик действий
 */
async function incrementActions(playerId) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    
    return await db.incrementPlayerActions(playerId);
}

/**
 * Регенерировать энергию
 * Восстанавливает энергию по времени (1 единица каждую минуту)
 * @param {number} playerId - ID игрока
 * @returns {Promise<object>} Результат с количеством восстановленной энергии
 */
async function regenerateEnergy(playerId) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    
    return await tx(async (client) => {
        // Блокируем строку игрока
        const lockedPlayer = await db.lockPlayer(playerId, client);
        
        if (!lockedPlayer) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }
        
        const now = new Date();
        const lastUpdateRaw = lockedPlayer.last_energy_update || lockedPlayer.updated_at;
        // Проверяем что дата валидна
        const lastUpdate = lastUpdateRaw ? new Date(lastUpdateRaw) : new Date();
        
        // Если дата всё ещё невалидна, используем текущее время
        if (isNaN(lastUpdate.getTime())) {
            lastUpdate.setTime(now.getTime());
        }
        
        const minutesPassed = Math.floor((now - lastUpdate) / 60000);
        
        // 1 энергия каждую минуту
        const energyRestored = minutesPassed;
        
        if (energyRestored > 0 && lockedPlayer.energy < lockedPlayer.max_energy) {
            const actualRestored = Math.min(energyRestored, lockedPlayer.max_energy - lockedPlayer.energy);
            
            await db.updatePlayerEnergy(playerId, actualRestored, { client, updateTimestamp: true });
            
            await db.logPlayerAction(playerId, 'regenerate_energy', { restored: actualRestored }, client);
            
            return { success: true, energy_restored: actualRestored };
        }
        
        return { success: true, energy_restored: 0 };
    });
}

/**
 * Добавить опыт и проверить повышение уровня
 * Бизнес-логика: проверка на level up
 * Использует транзакцию с блокировкой для избежания race condition
 * @param {number} playerId - ID игрока
 * @param {number} exp - Количество опыта
 * @param {object} client - Опциональный клиент транзакции (для использования внутри внешней транзакции)
 */
async function addExperience(playerId, exp, client = null) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    if (!Number.isInteger(exp) || exp <= 0) {
        throw { message: 'exp должен быть положительным числом', code: 'INVALID_EXP', statusCode: 400 };
    }
    
    // Если передан client, используем его (для внешней транзакции)
    if (client) {
        const result = await db.addExperienceWithLevelUp(client, playerId, exp, getExpForLevel);
        return { success: true, ...result };
    }
    
    // Иначе создаём свою транзакцию (обратная совместимость)
    const result = await tx(async (txClient) => {
        return await db.addExperienceWithLevelUp(txClient, playerId, exp, getExpForLevel);
    });
    
    return { success: true, ...result };
}

module.exports = {
    getById,
    getByTelegramId,
    updateInventory,
    updateEnergy,
    updateHealth,
    incrementActions,
    addExperience,
    regenerateEnergy
};
