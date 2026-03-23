/**
 * Локации и поиск лута
 * @module game/world
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const { DEBUFF_CONFIG, calculateDropChance, rollItemRarity, calculateDebuffModifiers, calculateRadiationDefense } = require('../../utils/gameConstants');
const { logger, withPlayerLock, safeJsonParse, handleError } = require('../../utils/serverApi');
const { normalizeInventory, normalizeRadiation } = require('../../utils/playerState');



// =============================================================================
// УТИЛИТЫ
// =============================================================================

const safeStringify = (value) => {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({});
    }
};

const safeParse = (value, fallback = {}) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        logger.error({ type: 'world_json_parse_error', value: typeof value, value_preview: String(value).substring(0, 100) });
        return fallback;
    }
};

function validateLocationId(locationId) {
    return Number.isInteger(locationId) && locationId > 0;
}



// =============================================================================
// ЛОКАЦИИ
// =============================================================================

/**
 * Поиск лута на локации
 * POST /world/search → POST /api/game/world/search
 */
router.post('/search', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const playerId = req.player.id;
        
        await client.query('BEGIN');
        
        try {
            const playerResult = await client.query(`
                SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE
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
            
            let radiationGain = 0;
            let radiationDefense = 0;
            let resultingRadiationLevel = normalizeRadiation(updatedPlayer.radiation).level;
            
            if (locationData.radiation > 0) {
                const baseRadiation = Math.ceil(locationData.radiation / 10);
                
                const equipment = safeJsonParse(updatedPlayer.equipment, {});
                radiationDefense = calculateRadiationDefense(equipment);
                
                const randomFactor = 0.7 + Math.random() * 0.6;
                radiationGain = Math.max(0, Math.ceil((baseRadiation - radiationDefense) * randomFactor));
                
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
                         WHERE telegram_id = $2`,
                        [JSON.stringify({
                            level: resultingRadiationLevel,
                            expires_at: expiresAt.toISOString(),
                            applied_at: now.toISOString()
                        }), playerId]
                    );
                }
            }
            
            const modifiers = calculateDebuffModifiers(updatedPlayer);
            const effectiveLuck = Math.max(1, Math.round((updatedPlayer.luck * modifiers.luck) * 10) / 10);
            
            const baseDropChance = calculateDropChance(effectiveLuck);
            const dropChance = Math.max(0.01, baseDropChance * modifiers.dropChance);
            const rolled = Math.random() * 100;
            
            let foundItem = null;
            let itemRarity = null;
            let expGained = 0;
            
            if (rolled <= dropChance) {
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
                    const inventory = normalizeInventory(updatedPlayer.inventory);
                    
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
                        WHERE telegram_id = $2
                    `, [JSON.stringify(inventory), playerId]);
                    
                    const expReward = Math.floor(5 + (itemRarity === 'common' ? 0 : itemRarity === 'uncommon' ? 2 : itemRarity === 'rare' ? 5 : itemRarity === 'epic' ? 8 : 10));
                    await client.query(`
                        UPDATE players 
                        SET experience = experience + $1
                        WHERE telegram_id = $2
                    `, [expReward, playerId]);
                    
                    expGained = expReward;
                }
            }
            
            const energyResult = await client.query(`
                UPDATE players 
                SET energy = energy - $1,
                    last_energy_update = NOW(),
                    total_actions = total_actions + 1
                WHERE telegram_id = $2
                RETURNING energy, max_energy, last_energy_update
            `, [energyCost, playerId]);
            
            const newEnergy = energyResult.rows[0].energy;
            const newMaxEnergy = energyResult.rows[0].max_energy;
            const lastEnergyUpdate = energyResult.rows[0].last_energy_update;
            
            let radiationEffect = null;
            let radiationDamage = 0;
            
            if (resultingRadiationLevel >= 10) {
                radiationEffect = 'critical';
                radiationDamage = 10;
            } else if (resultingRadiationLevel >= 5) {
                radiationEffect = 'danger';
                radiationDamage = DEBUFF_CONFIG.radiation.damagePerLevel || 2;
            } else if (radiationGain > 0) {
                radiationEffect = 'applied';
            }
            
            if (radiationDamage > 0) {
                await client.query(`
                    UPDATE players 
                    SET health = GREATEST(0, health - $1)
                    WHERE telegram_id = $2
                `, [radiationDamage, playerId]);
            }
            
            await client.query('COMMIT');
            
            logger.info(`[world] Поиск лута`, {
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
                rolled: rolled.toFixed(2),
                exp_gained: expGained
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
 * POST /world/move → POST /api/game/world/move
 */
router.post('/move', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { location_id } = req.body;
        const playerId = req.player.id;
        
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
        
        await client.query('BEGIN');
        
        try {
            const playerResult = await client.query(`
                SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE
            `, [playerId]);
            
            const player = playerResult.rows[0];
            
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
            
            await client.query(`
                UPDATE players 
                SET current_location_id = $1
                WHERE telegram_id = $2
            `, [location_id, playerId]);
            
            await client.query('COMMIT');
            
            logger.info(`[world] Перемещение`, {
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
 * Получение списка локаций
 * GET /api/game/locations (через алиас) или GET /api/game/world/locations
 */
router.get('/', async (req, res) => {
    try {
        const player = req.player;
        
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        
        const countResult = await query(`
            SELECT COUNT(*) as total FROM locations
        `);
        const totalLocations = parseInt(countResult.rows[0].total);
        
        const locations = await queryAll(`
            SELECT id, name, icon, color, radiation, danger_level,
                   min_luck as required_luck, description
            FROM locations
            ORDER BY min_luck ASC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
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



module.exports = router;