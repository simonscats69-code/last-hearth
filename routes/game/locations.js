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
const { DEBUFF_CONFIG, calculateDropChance, rollItemRarity, calculateDebuffModifiers, calculateRadiationDefense } = require('../../utils/gameConstants');
const { logger, safeJsonParse, PlayerHelper: playerHelper, handleError } = require('../../utils/serverApi');
const { normalizeInventory, normalizeRadiation } = require('../../utils/playerState');

// handleError импортируется из utils/serverApi

/**
 * Safe JSON parsing с fallback
 * Теперь импортируется из utils/jsonHelper.js
 */
// safeJsonParse теперь импортируется

/**
 * Валидация ID локации
 * @param {any} locationId - ID для валидации
 * @returns {boolean} результат валидации
 */
function validateLocationId(locationId) {
    return Number.isInteger(locationId) && locationId > 0;
}



/**
 * Поиск лута на локации
 */
router.post('/search', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const playerId = req.player.id;
        
        // Используем транзакцию для атомарности
        await client.query('BEGIN');
        
        try {
            // Получаем игрока с блокировкой
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
            const energyCost = 1;
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
            let resultingRadiationLevel = normalizeRadiation(updatedPlayer.radiation).level;
            
            if (locationData.radiation > 0) {
                // Базовая радиация от локации
                const baseRadiation = Math.ceil(locationData.radiation / 10);
                
                // Защита от радиации из экипировки
                const equipment = safeJsonParse(updatedPlayer.equipment, {});
                radiationDefense = calculateRadiationDefense(equipment);
                
                // Итоговая радиация с случайностью (±30%)
                const randomFactor = 0.7 + Math.random() * 0.6;
                radiationGain = Math.max(0, Math.ceil((baseRadiation - radiationDefense) * randomFactor));
                
                // Применяем радиацию в рамках той же транзакции поиска,
                // чтобы состояние игрока оставалось атомарным.
                if (radiationGain > 0) {
                    const currentRadiation = normalizeRadiation(updatedPlayer.radiation);
                    const radiationConfig = DEBUFF_CONFIG.radiation;
                    const now = new Date();
                    const expiresAt = new Date(
                        now.getTime() + radiationConfig.baseDurationMs + (radiationGain - 1) * radiationConfig.durationPerLevelMs
                    );

                    resultingRadiationLevel = Math.min(radiationConfig.maxLevel, currentRadiation.level + radiationGain);

                    await client.query(
                        `UPDATE players
                         SET radiation = $1::jsonb
                         WHERE id = $2`,
                        [JSON.stringify({
                            level: resultingRadiationLevel,
                            expires_at: expiresAt.toISOString(),
                            applied_at: now.toISOString()
                        }), playerId]
                    );
                }
            }
            
            // Расчёт модификаторов от дебаффов
            const modifiers = calculateDebuffModifiers(updatedPlayer);
            const effectiveLuck = Math.max(1, Math.round((updatedPlayer.luck * modifiers.luck) * 10) / 10);
            
            // Вычисляем шанс дропа с учётом дебаффов
            const baseDropChance = calculateDropChance(effectiveLuck);
            const dropChance = Math.max(0.01, baseDropChance * modifiers.dropChance);
            const rolled = Math.random() * 100;
            
            let foundItem = null;
            let itemRarity = null;
            
            if (rolled <= dropChance) {
                // Определяем редкость
                itemRarity = rollItemRarity(locationData.id);

                const itemResult = await client.query(`
                    SELECT
                        id,
                        name,
                        type,
                        rarity,
                        icon,
                        COALESCE((stats->>'damage')::integer, 0) AS damage,
                        COALESCE((stats->>'defense')::integer, 0) AS defense
                    FROM items
                    WHERE rarity = $1
                      AND type != 'key'
                    LIMIT 1 OFFSET floor(random() * (
                        SELECT COUNT(*) FROM items WHERE rarity = $1 AND type != 'key'
                    ))::integer
                `, [itemRarity]);

                foundItem = itemResult.rows[0] || null;
                
                if (foundItem) {
                    // Добавляем в инвентарь. Старые данные могут лежать как объект,
                    // поэтому приводим всё к единому массивному формату.
                    const inventory = normalizeInventory(updatedPlayer.inventory);
                    
                    // Создаём объект предмета
                    const newItem = {
                        id: foundItem.id,
                        name: foundItem.name,
                        type: foundItem.type || 'misc',
                        rarity: itemRarity,
                        damage: foundItem.damage || 0,
                        defense: foundItem.defense || 0,
                        upgrade_level: 0,
                        modifications: {}
                    };
                    
                    inventory.push(newItem);
                    
                    await client.query(`
                        UPDATE players 
                        SET inventory = $1
                        WHERE id = $2
                    `, [JSON.stringify(inventory), playerId]);
                }
            }
            
            // Тратим энергию и фиксируем действие вне зависимости от результата поиска.
            const energyResult = await client.query(`
                UPDATE players 
                SET energy = energy - $1,
                    last_energy_update = NOW(),
                    total_actions = total_actions + 1
                WHERE id = $2
                RETURNING energy, max_energy, last_energy_update
            `, [energyCost, playerId]);
            
            const newEnergy = energyResult.rows[0].energy;
            const newMaxEnergy = energyResult.rows[0].max_energy;
            const lastEnergyUpdate = energyResult.rows[0].last_energy_update;
            
            // Проверяем последствия радиации
            let radiationEffect = null;
            if (resultingRadiationLevel >= DEBUFF_CONFIG.radiation.maxLevel) {
                radiationEffect = 'critical';
                // Наносим урон от радиации
                await client.query(`
                    UPDATE players 
                    SET health = GREATEST(0, health - 10)
                    WHERE id = $1
                `, [playerId]);
            } else if (resultingRadiationLevel >= 5) {
                radiationEffect = 'danger';
            } else if (radiationGain > 0) {
                radiationEffect = 'applied';
            }
            
            await client.query('COMMIT');
            
            // Логируем действие
            logger.info(`[locations] Поиск лута`, {
                playerId,
                foundItem: foundItem?.name || null,
                effectiveLuck,
                dropChance,
                locationId: locationData.id
            });
            
            res.json({
                success: true,
                search_performed: true,
                found_item: foundItem ? {
                    name: foundItem.name,
                    rarity: itemRarity,
                    type: foundItem.type,
                    icon: foundItem.icon,
                    stats: foundItem.damage ? { damage: foundItem.damage } : 
                           foundItem.defense ? { defense: foundItem.defense } : null
                } : null,
                energy: {
                    current: newEnergy,
                    max: newMaxEnergy,
                    restored: 0,
                    last_update: lastEnergyUpdate
                },
                radiation: {
                    level: resultingRadiationLevel,
                    gained: radiationGain,
                    defense: radiationDefense,
                    effect: radiationEffect
                },
                location: {
                    name: locationData.name,
                    radiation: locationData.radiation
                },
                effective_luck: effectiveLuck,
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
            const requiredLuck = locationData.min_luck || locationData.required_luck || 0;
            if (player.luck < requiredLuck) {
                await client.query('ROLLBACK');
                return res.json({
                    success: false,
                    error: `Нужно больше удачи (${requiredLuck}+)`,
                    code: 'INSUFFICIENT_LUCK',
                    required_luck: requiredLuck,
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
 * Путь: / (корень внутри роутера, который подключается с namespace /locations)
 */
router.get('/', async (req, res) => {
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
            SELECT id, name, icon, color, radiation, danger_level,
                   min_luck as required_luck, description
            FROM locations
            ORDER BY min_luck ASC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        // Фильтруем по доступности
        const availableLocations = locations.map(loc => ({
            id: loc.id,
            name: loc.name,
            icon: loc.icon,
            color: loc.color,
            radiation: loc.radiation,
            danger_level: loc.danger_level,
            required_luck: loc.required_luck,
            min_luck: loc.required_luck,
            description: loc.description,
            unlocked: player.luck >= loc.required_luck,
            current: loc.id === player.current_location_id
        }));
        
        // Единый формат ответа
        res.json({
            success: true,
            locations: availableLocations,
            current_location_id: player.current_location_id,
            pagination: {
                total: totalLocations,
                limit: limit,
                offset: offset,
                has_more: offset + locations.length < totalLocations
            },
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
 * @deprecated Используйте GET /locations
 * Путь: /legacy (внутри роутера)
 */
router.get('/legacy', async (req, res) => {
    try {
        const player = req.player;
        
        const locations = await queryAll(`
            SELECT id, name, radiation, min_luck as required_luck, description, is_red_zone
            FROM locations
            ORDER BY min_luck ASC
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
        handleError(res, error, 'locations_list_legacy');
    }
});

module.exports = router;
