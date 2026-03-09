/**
 * Service Layer - Бизнес-логика игроков
 * Использует DB Layer и содержит правила игры
 */

const db = require('../db/playerQueries');
const { getExpForLevel } = require('../utils/gameConstants');
const { logger } = require('../utils/logger');

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
    if (!inventory || typeof inventory !== 'object') {
        throw { message: 'Инвентарь должен быть объектом', code: 'INVALID_INVENTORY', statusCode: 400 };
    }
    
    const result = await db.updatePlayerInventory(playerId, inventory);
    await db.logPlayerAction(playerId, 'update_inventory', { inventory_size: Object.keys(inventory).length });
    
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
    
    const result = await db.updatePlayerHealth(playerId, health);
    
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
 * Восстанавливает энергию по времени (1 единица каждые 3 минуты)
 * @param {number} playerId - ID игрока
 * @returns {Promise<object>} Результат с количеством восстановленной энергии
 */
async function regenerateEnergy(playerId) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    
    const { tx } = require('../db/database');
    
    return await tx(async () => {
        // Блокируем строку игрока
        const lockedPlayer = await db.lockPlayer(playerId);
        
        if (!lockedPlayer) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }
        
        const now = new Date();
        const lastUpdate = new Date(lockedPlayer.last_energy_regen || lockedPlayer.updated_at);
        const minutesPassed = Math.floor((now - lastUpdate) / 60000);
        
        // 1 энергия каждые 3 минуты
        const energyRestored = Math.floor(minutesPassed / 3);
        
        if (energyRestored > 0 && lockedPlayer.energy < lockedPlayer.max_energy) {
            const actualRestored = Math.min(energyRestored, lockedPlayer.max_energy - lockedPlayer.energy);
            
            await db.updatePlayerEnergyNoLevelUp(playerId, actualRestored);
            
            await db.logPlayerAction(playerId, 'regenerate_energy', { restored: actualRestored });
            
            return { success: true, energy_restored: actualRestored };
        }
        
        return { success: true, energy_restored: 0 };
    });
}

/**
 * Добавить опыт и проверить повышение уровня
 * Бизнес-логика: проверка на level up
 * Использует транзакцию с блокировкой для избежания race condition
 */
async function addExperience(playerId, exp) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { message: 'Некорректный ID игрока', code: 'INVALID_PLAYER_ID', statusCode: 400 };
    }
    if (!Number.isInteger(exp) || exp <= 0) {
        throw { message: 'exp должен быть положительным числом', code: 'INVALID_EXP', statusCode: 400 };
    }
    
    // Используем транзакцию с блокировкой строки игрока
    const { tx } = require('../db/database');
    
    const result = await tx(async () => {
        // Блокируем строку игрока
        const lockedPlayer = await db.lockPlayer(playerId);
        
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
            await db.levelUpPlayer(playerId);
            leveledUp = true;
            
            await db.logPlayerAction(playerId, 'level_up', { 
                old_level: lockedPlayer.level, 
                new_level: newLevel,
                exp_gained: exp
            });
            
            logger.info(`Игрок ${playerId} повысил уровень до ${newLevel}!`);
        } else {
            // Просто обновляем опыт
            await db.updatePlayerExperienceNoLevelUp(playerId, exp);
            
            await db.logPlayerAction(playerId, 'add_experience', { 
                exp_gained: exp,
                total_exp: newExperience,
                level: newLevel
            });
        }
        
        return { 
            level: newLevel, 
            experience: newExperience,
            leveled_up: leveledUp,
            exp_needed: getExpForLevel(newLevel)
        };
    });
    
    return { 
        success: true, 
        ...result
    };
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
