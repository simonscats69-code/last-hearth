/**
 * Профиль игрока
 * Namespace: player, status, currency
 * 
 * Критерии продакшна:
 * - Транзакции и атомарность для операций записи
 * - Валидация входных данных
 * - Логирование действий игрока
 * - Единый формат ответов {success, data}
 * - Обратная совместимость (@deprecated)
 * - Централизованный namespace
 * - Единый обработчик ошибок
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll } = require('../../db/database');
const { getExpForLevel, getTotalExpForLevel } = require('../../utils/gameConstants');
const { logger } = require('../../utils/logger');

/**
 * Универсальный обработчик ошибок
 * @param {object} res - объект ответа Express
 * @param {Error} error - объект ошибки
 * @param {string} action - действие, в котором произошла ошибка
 */
function handleError(res, error, action = 'unknown') {
    logger.error(`[profile] ${action}`, {
        error: error.message,
        stack: error.stack
    });
    
    return res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        code: 'INTERNAL_ERROR'
    });
}

/**
 * Safe JSON parsing с fallback
 * @param {any} value - значение для парсинга
 * @param {object} fallback - значение по умолчанию
 * @returns {object} распарсенный объект
 */
function safeJsonParse(value, fallback = {}) {
    if (value === null || value === undefined) {
        return fallback;
    }
    
    if (typeof value === 'object') {
        return value;
    }
    
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (e) {
            logger.warn('[profile] Ошибка парсинга JSON', { value: value.substring(0, 100) });
            return fallback;
        }
    }
    
    return fallback;
}

/**
 * Валидация Telegram ID
 * @param {any} telegramId - ID для валидации
 * @returns {boolean} результат валидации
 */
function validateTelegramId(telegramId) {
    return Number.isInteger(telegramId) && telegramId > 0;
}

/**
 * Получение профиля игрока
 */
router.get('/profile', async (req, res) => {
    try {
        const telegramId = req.player.telegram_id;
        
        // Валидация входных данных
        if (!validateTelegramId(telegramId)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный Telegram ID',
                code: 'INVALID_TELEGRAM_ID'
            });
        }
        
        // Получаем профиль игрока
        const player = await queryOne(`
            SELECT p.*, l.name as location_name, l.radiation as location_radiation
            FROM players p
            LEFT JOIN locations l ON p.current_location_id = l.id
            WHERE p.telegram_id = $1
        `, [telegramId]);

        if (!player) {
            return res.status(404).json({
                success: false,
                error: 'Игрок не найден',
                code: 'PLAYER_NOT_FOUND'
            });
        }

        // Получаем ключи боссов
        const keys = await queryAll(`
            SELECT bk.boss_id, b.name as boss_name, bk.quantity
            FROM boss_keys bk
            JOIN bosses b ON bk.boss_id = b.id
            WHERE bk.player_id = $1
        `, [player.id]);
        
        // Защита от деления на 0
        const expNeeded = getExpForLevel(player.level) || 1;
        const expPercent = Math.min(100, Math.floor((player.experience / expNeeded) * 100));
        const totalExpForNext = getTotalExpForLevel(player.level) + expNeeded;

        // Safe JSON parsing для infections
        const infectionsList = safeJsonParse(player.infections, []);
        
        // Safe JSON parsing для inventory и equipment
        const inventory = safeJsonParse(player.inventory, []);
        const equipment = safeJsonParse(player.equipment, {});
        const base = safeJsonParse(player.base, {});

        // Логируем действие
        logger.info(`[profile] Просмотр профиля`, {
            playerId: player.id,
            level: player.level,
            location_id: player.current_location_id
        });

        // Единый формат ответа
        res.json({
            success: true,
            data: {
                id: player.id,
                telegram_id: player.telegram_id,
                username: player.username,
                first_name: player.first_name,
                level: player.level,
                experience: player.experience,
                experience_current: Math.max(0, player.experience),
                // Прогресс опыта для долгосрочной игры
                exp_progress: {
                    current: player.experience,
                    needed: expNeeded,
                    total_for_next_level: totalExpForNext,
                    percent: expPercent
                },
                stats: {
                    strength: player.strength,
                    endurance: player.endurance,
                    agility: player.agility,
                    intelligence: player.intelligence,
                    luck: player.luck,
                    crafting: player.crafting || 1
                },
                status: {
                    health: player.health,
                    max_health: player.max_health,
                    hunger: player.hunger,
                    thirst: player.thirst,
                    radiation: player.radiation,
                    fatigue: player.fatigue,
                    energy: player.energy,
                    max_energy: player.max_energy,
                    broken_bones: player.broken_bones,
                    broken_leg: player.broken_leg,
                    broken_arm: player.broken_arm,
                    infections: player.infection_count,
                    infections_list: infectionsList
                },
                location: {
                    id: player.current_location_id,
                    name: player.location_name,
                    radiation: player.location_radiation
                },
                inventory: inventory,
                equipment: equipment,
                coins: player.coins,
                stars: player.stars,
                base: base,
                boss_keys: keys,
                stats_ext: {
                    total_actions: player.total_actions,
                    bosses_killed: player.bosses_killed,
                    days_played: player.days_played
                }
            }
        });
        
    } catch (error) {
        handleError(res, error, 'profile_view');
    }
});

/**
 * Получение профиля игрока (устаревшая версия)
 * @deprecated Используйте GET /profile с единым форматом ответа
 */
router.get('/profile-legacy', async (req, res) => {
    try {
        const player = await queryOne(`
            SELECT p.*, l.name as location_name, l.radiation as location_radiation
            FROM players p
            LEFT JOIN locations l ON p.current_location_id = l.id
            WHERE p.telegram_id = $1
        `, [req.player.telegram_id]);

        if (!player) {
            return res.status(404).json({ error: 'Игрок не найден' });
        }

        // Получаем ключи боссов
        const keys = await queryAll(`
            SELECT bk.boss_id, b.name as boss_name, bk.quantity
            FROM boss_keys bk
            JOIN bosses b ON bk.boss_id = b.id
            WHERE bk.player_id = $1
        `, [player.id]);

        // Защита от деления на 0
        const expNeeded = getExpForLevel(player.level) || 1;
        const expPercent = Math.min(100, Math.floor((player.experience / expNeeded) * 100));
        const totalExpForNext = getTotalExpForLevel(player.level) + expNeeded;

        // Парсим infections если это строка
        let infectionsList = [];
        if (player.infections) {
            if (typeof player.infections === 'string') {
                try { infectionsList = JSON.parse(player.infections); } catch(e) { infectionsList = []; }
            } else {
                infectionsList = player.infections;
            }
        }

        res.json({
            id: player.id,
            telegram_id: player.telegram_id,
            username: player.username,
            first_name: player.first_name,
            level: player.level,
            experience: player.experience,
            experience_current: Math.max(0, player.experience),
            exp_progress: {
                current: player.experience,
                needed: expNeeded,
                total_for_next_level: totalExpForNext,
                percent: expPercent
            },
            stats: {
                strength: player.strength,
                endurance: player.endurance,
                agility: player.agility,
                intelligence: player.intelligence,
                luck: player.luck,
                crafting: player.crafting || 1
            },
            status: {
                health: player.health,
                max_health: player.max_health,
                hunger: player.hunger,
                thirst: player.thirst,
                radiation: player.radiation,
                fatigue: player.fatigue,
                energy: player.energy,
                max_energy: player.max_energy,
                broken_bones: player.broken_bones,
                broken_leg: player.broken_leg,
                broken_arm: player.broken_arm,
                infections: player.infection_count,
                infections_list: infectionsList
            },
            location: {
                id: player.current_location_id,
                name: player.location_name,
                radiation: player.location_radiation
            },
            inventory: player.inventory,
            equipment: player.equipment,
            coins: player.coins,
            stars: player.stars,
            base: player.base,
            boss_keys: keys,
            stats_ext: {
                total_actions: player.total_actions,
                bosses_killed: player.bosses_killed,
                days_played: player.days_played
            }
        });
    } catch (error) {
        logger.error('Ошибка /profile-legacy:', error);
        res.status(500).json({ error: 'Ошибка получения профиля' });
    }
});

module.exports = router;
