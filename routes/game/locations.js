/**
 * Локации и поиск лута
 * Namespace: player, locations
 * 
 * Критерии продакшна:
 * - Транзакции и атомарность для операций записи
 * - Валидация входных данных
 * - Логирование действий игрока
 * - Единый формат ответов {success, data}
 * - Обратная совместимость (@deprecated)
 * - Централизованный namespace
 * - Единый обработчик ошибок
 * - Пагинация для списка локаций
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const playerHelper = require('../../utils/playerHelper');
const { calculateDropChance, rollItemRarity, rollLootDrop, getLootTable, calculateDebuffModifiers, calculateRadiationDefense } = require('../../utils/gameConstants');
const { logger } = require('../../utils/logger');
const { DebuffAPI } = require('./debuffs');

/**
 * Универсальный обработчик ошибок
 * @param {object} res - объект ответа Express
 * @param {Error} error - объект ошибки
 * @param {string} action - действие, в котором произошла ошибка
 */
function handleError(res, error, action = 'unknown') {
    logger.error(`[locations] ${action}`, {
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
            console.error('JSON.parse failed:', typeof value, value.substring(0, 100));
            logger.warn('[locations] Ошибка парсинга JSON', { value: value.substring(0, 100) });
            return fallback;
        }
    }
    
    return fallback;
}

/**
 * Валидация ID локации
 * @param {any} locationId - ID для валидации
 * @returns {boolean} результат валидации
 */
function validateLocationId(locationId) {
    return Number.isInteger(locationId) && locationId > 0;
}

/**
 * Валидация булева параметра
 * @param {any} value - значение для валидации
 * @returns {boolean} результат валидации
 */
function validateBoolean(value) {
    return typeof value === 'boolean';
}

/**
 * Поиск лута на локации
 */
router.post('/search', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { useLuckySearch = false } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        if (!validateBoolean(useLuckySearch)) {
            return res.status(400).json({
                success: false,
                error: 'Параметр useLuckySearch должен быть boolean',
                code: 'INVALID_LUCKY_SEARCH_TYPE'
            });
        }
        
        // Используем транзакцию для атомарности
        await client.query('BEGIN');
        
        try {
            // Обновляем энергию и получаем игрока с блокировкой
            await playerHelper.updateEnergy(playerId);
            
            const playerResult = await client.query(`
                SELECT * FROM players WHERE id = $1 FOR UPDATE
            `, [playerId]);
            
            const updatedPlayer = playerResult.rows[0];
            
            if (!updatedPlayer) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Игрок не найден',
                    code: 'PLAYER_NOT_FOUND'
                });
            }
            
            // Проверяем энергию
            const energyCost = useLuckySearch ? 2 : 1;
            if (updatedPlayer.energy < energyCost) {
                await client.query('ROLLBACK');
                return res.json({
                    success: false,
                    error: 'Недостаточно энергии',
                    code: 'INSUFFICIENT_ENERGY',
                    energy: updatedPlayer.energy,
                    max_energy: updatedPlayer.max_energy
                });
            }
            
            // Получаем данные локации
            const location = await client.query(`
                SELECT * FROM locations WHERE id = $1
            `, [updatedPlayer.current_location_id]);
            
            if (location.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Локация не найдена',
                    code: 'LOCATION_NOT_FOUND'
                });
            }
            
            const locationData = location.rows[0];
            
            // === СИСТЕМА ДЕБАФФОВ: Радиация от локации ===
            let radiationGain = 0;
            let radiationDefense = 0;
            let appliedRadiation = null;
            
            if (locationData.radiation > 0) {
                // Базовая радиация от локации
                const baseRadiation = Math.ceil(locationData.radiation / 10);
                
                // Защита от радиации из экипировки
                const equipment = safeJsonParse(updatedPlayer.equipment, {});
                radiationDefense = calculateRadiationDefense(equipment);
                
                // Итоговая радиация с случайностью (±30%)
                const randomFactor = 0.7 + Math.random() * 0.6;
                radiationGain = Math.max(0, Math.ceil((baseRadiation - radiationDefense) * randomFactor));
                
                // Применяем дебафф если есть радиация
                if (radiationGain > 0) {
                    try {
                        appliedRadiation = await DebuffAPI.apply(playerId, 'radiation', radiationGain, {
                            source: `location_${locationData.id}`
                        });
                    } catch (err) {
                        logger.warn(`[locations] Ошибка применения радиации: ${err.message}`);
                    }
                }
            }
            
            // Расчёт модификаторов от дебаффов
            const modifiers = calculateDebuffModifiers(updatedPlayer);
            
            // Вычисляем шанс дропа с учётом дебаффов
            const baseDropChance = calculateDropChance(updatedPlayer.luck, useLuckySearch);
            const dropChance = Math.max(0.01, baseDropChance * modifiers.dropChance);
            const rolled = Math.random() * 100;
            
            let foundItem = null;
            let itemRarity = null;
            
            if (rolled <= dropChance) {
                // Определяем редкость
                itemRarity = rollItemRarity(updatedPlayer.luck);
                
                // Получаем таблицу лута для локации
                const lootTable = getLootTable(locationData.id);
                
                // Бросаем предмет
                foundItem = rollLootDrop(lootTable, updatedPlayer.luck, itemRarity);
                
                if (foundItem) {
                    // Добавляем в инвентарь
                    const inventory = safeJsonParse(updatedPlayer.inventory, []);
                    inventory.push(foundItem);
                    
                    await client.query(`
                        UPDATE players 
                        SET inventory = $1, 
                            total_actions = total_actions + 1
                        WHERE id = $2
                    `, [JSON.stringify(inventory), playerId]);
                }
            }
            
            // Тратим энергию
            await client.query(`
                UPDATE players 
                SET energy = energy - $1,
                    last_energy_update = NOW()
                WHERE id = $2
            `, [energyCost, playerId]);
            
            // Проверяем последствия радиации
            let radiationEffect = null;
            if (newRadiation >= 100) {
                radiationEffect = 'critical';
                // Наносим урон от радиации
                await client.query(`
                    UPDATE players 
                    SET health = GREATEST(0, health - 10)
                    WHERE id = $1
                `, [playerId]);
            }
            
            await client.query('COMMIT');
            
            // Логируем действие
            logger.info(`[locations] Поиск лута`, {
                playerId,
                foundItem: foundItem?.name || null,
                useLuckySearch,
                locationId: locationData.id
            });
            
            res.json({
                success: foundItem !== null,
                data: foundItem ? {
                    found_item: {
                        name: foundItem.name,
                        rarity: itemRarity,
                        type: foundItem.type,
                        stats: foundItem.damage ? { damage: foundItem.damage } : 
                               foundItem.defense ? { defense: foundItem.defense } : null
                    }
                } : null,
                energy: {
                    current: updatedPlayer.energy - energyCost,
                    max: updatedPlayer.max_energy,
                    restored: 0
                },
                radiation: {
                    // Новый формат: уровень из JSONB или старое значение
                    level: appliedRadiation?.newLevel || 0,
                    gained: radiationGain,
                    defense: radiationDefense
                },
                location: {
                    name: locationData.name,
                    radiation: locationData.radiation
                },
                drop_chance: dropChance,
                rolled: rolled.toFixed(2)
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'location_search');
    } finally {
        client.release();
    }
});

/**
 * Перемещение между локациями
 */
router.post('/move', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { location_id } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        if (location_id === undefined || location_id === null) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID локации',
                code: 'MISSING_LOCATION_ID'
            });
        }
        
        if (!validateLocationId(location_id)) {
            return res.status(400).json({
                success: false,
                error: 'ID локации должен быть положительным целым числом',
                code: 'INVALID_LOCATION_ID'
            });
        }
        
        // Используем транзакцию для атомарности
        await client.query('BEGIN');
        
        try {
            // Получаем игрока с блокировкой
            const playerResult = await client.query(`
                SELECT * FROM players WHERE id = $1 FOR UPDATE
            `, [playerId]);
            
            const player = playerResult.rows[0];
            
            // Получаем целевую локацию
            const targetLocation = await client.query(`
                SELECT * FROM locations WHERE id = $1
            `, [location_id]);
            
            if (targetLocation.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Локация не найдена',
                    code: 'LOCATION_NOT_FOUND'
                });
            }
            
            const locationData = targetLocation.rows[0];
            
            // Проверяем требования удачи
            if (player.luck < locationData.required_luck) {
                await client.query('ROLLBACK');
                return res.json({
                    success: false,
                    error: `Нужно больше удачи (${locationData.required_luck}+)`,
                    code: 'INSUFFICIENT_LUCK',
                    required_luck: locationData.required_luck,
                    current_luck: player.luck
                });
            }
            
            // Перемещаем игрока
            await client.query(`
                UPDATE players 
                SET current_location_id = $1
                WHERE id = $2
            `, [location_id, playerId]);
            
            await client.query('COMMIT');
            
            // Логируем действие
            logger.info(`[locations] Перемещение`, {
                playerId,
                fromLocationId: player.current_location_id,
                toLocationId: location_id
            });
            
            res.json({
                success: true,
                data: {
                    location: {
                        id: locationData.id,
                        name: locationData.name,
                        radiation: locationData.radiation,
                        description: locationData.description
                    },
                    message: `Вы прибыли в ${locationData.name}`
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'location_move');
    } finally {
        client.release();
    }
});

/**
 * Получение списка локаций с пагинацией
 */
router.get('/locations', async (req, res) => {
    try {
        const player = req.player;
        
        // Пагинация: параметры limit и offset
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        
        // Получаем общее количество локаций
        const countResult = await query(`
            SELECT COUNT(*) as total FROM locations
        `);
        const totalLocations = parseInt(countResult.rows[0].total);
        
        // Получаем локации с пагинацией
        const locations = await queryAll(`
            SELECT DISTINCT ON (name) id, name, radiation, required_luck, description, is_red_zone
            FROM locations
            ORDER BY name, id ASC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        // Фильтруем по доступности
        const availableLocations = locations.map(loc => ({
            id: loc.id,
            name: loc.name,
            radiation: loc.radiation,
            required_luck: loc.required_luck,
            description: loc.description,
            is_red_zone: loc.is_red_zone,
            unlocked: player.luck >= loc.required_luck,
            current: loc.id === player.current_location_id
        }));
        
        // Единый формат ответа
        res.json({
            success: true,
            data: {
                locations: availableLocations,
                current_location_id: player.current_location_id,
                pagination: {
                    total: totalLocations,
                    limit: limit,
                    offset: offset,
                    has_more: offset + locations.length < totalLocations
                }
            }
        });
        
    } catch (error) {
        handleError(res, error, 'locations_list');
    }
});

/**
 * Получение списка локаций (устаревшая версия)
 * @deprecated Используйте GET /locations с единым форматом ответа
 */
router.get('/locations-legacy', async (req, res) => {
    try {
        const player = req.player;
        
        const locations = await queryAll(`
            SELECT id, name, radiation, required_luck, description, is_red_zone
            FROM locations
            ORDER BY required_luck ASC
        `);
        
        // Фильтруем по доступности
        const availableLocations = locations.map(loc => ({
            id: loc.id,
            name: loc.name,
            radiation: loc.radiation,
            required_luck: loc.required_luck,
            description: loc.description,
            is_red_zone: loc.is_red_zone,
            unlocked: player.luck >= loc.required_luck,
            current: loc.id === player.current_location_id
        }));
        
        res.json({
            locations: availableLocations,
            current_location_id: player.current_location_id
        });
        
    } catch (error) {
        console.error('Ошибка /locations:', error);
        res.status(500).json({ error: 'Ошибка получения локаций' });
    }
});

module.exports = router;
