/**
 * Утилиты для работы с игроками
 * Делегирует бизнес-логику в Service Layer
 */

const playerService = require('../services/playerService');

// Делегируем все методы в service
const PlayerHelper = {
    /**
     * Получить игрока по Telegram ID
     * @param {string} telegramId - ID пользователя Telegram
     */
    async getByTelegramId(telegramId) {
        return await playerService.getByTelegramId(telegramId);
    },
    
    /**
     * Получить игрока по ID
     * @param {number} playerId - ID игрока
     */
    async getById(playerId) {
        return await playerService.getById(playerId);
    },
    
    /**
     * Обновить инвентарь
     * @param {number} playerId - ID игрока
     * @param {object} inventory - Инвентарь
     */
    async updateInventory(playerId, inventory) {
        return await playerService.updateInventory(playerId, inventory);
    },
    
    /**
     * Обновить энергию
     * @param {number} playerId - ID игрока
     * @param {number} energyChange - Изменение
     */
    async updateEnergy(playerId, energyChange) {
        return await playerService.updateEnergy(playerId, energyChange);
    },
    
    /**
     * Обновить здоровье
     * @param {number} playerId - ID игрока
     * @param {number} health - Здоровье
     */
    async updateHealth(playerId, health) {
        return await playerService.updateHealth(playerId, health);
    },
    
    /**
     * Увеличить счётчик действий
     * @param {number} playerId - ID игрока
     */
    async incrementActions(playerId) {
        return await playerService.incrementActions(playerId);
    },
    
    /**
     * Регенерировать энергию (восстанавливает энергию по времени)
     * Восстанавливает 1 единицу энергии каждые 3 минуты
     * @param {number} playerId - ID игрока
     * @returns {Promise<number>} Количество восстановленной энергии
     */
    async regenerateEnergy(playerId) {
        // Используем playerService который вызывает scheduler
        // Планировщик восстанавливает энергию автоматически каждую минуту
        // Этот метод для обратной совместимости
        return await playerService.regenerateEnergy(playerId);
    },
    
    /**
     * Добавить опыт
     * @param {number} playerId - ID игрока
     * @param {number} exp - Опыт
     * @param {object} client - Опциональный клиент транзакции
     */
    async addExperience(playerId, exp, client = null) {
        return await playerService.addExperience(playerId, exp, client);
    }
};

module.exports = PlayerHelper;
