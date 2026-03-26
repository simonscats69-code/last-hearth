/**
 * Локации и поиск лута
 * @module game/world
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const {
    DEBUFF_CONFIG,
    calculateDropChance,
    rollItemRarity,
    calculateDebuffModifiers,
    calculateLocationRiskProfile
} = require('../../utils/gameConstants');
const { logger, withPlayerLock, safeJsonParse, handleError } = require('../../utils/serverApi');
const { normalizeInventory, normalizeRadiation } = require('../../utils/playerState');
const { DebuffAPI } = require('./debuffs');



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
    logger.info('[world] POST /search вызван', { playerId: req.player?.id, body: req.body, headers: Object.keys(req.headers) });
    const client = await pool.connect();
    
    try {
        const playerId = req.player.id;
        
        await client.query('BEGIN');
        
        try {
            // Используем внутренний id игрока, а не telegram_id
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
            
            const energyCost = 1;
            if (updatedPlayer.energy < energyCost) {
                await client.query('ROLLBACK');
                return res.json({
                    success: false,
                    error: 'Недостаточно энергии',
                    code: 'INSUFFICIENT_ENERGY',
                    energy: Math.max(0, updatedPlayer.energy),
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
            const equipment = safeJsonParse(updatedPlayer.equipment, {});
            const riskProfile = calculateLocationRiskProfile(locationData, equipment);
            
            let radiationGain = 0;
            const radiationDefense = riskProfile.radiationDefense;
            let resultingRadiationLevel = normalizeRadiation(updatedPlayer.radiation).level;
            
            if (locationData.radiation > 0) {
                const baseRadiation = Math.ceil(locationData.radiation / 10);

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
                         WHERE id = $2`,
                        [JSON.stringify({
                            level: resultingRadiationLevel,
                            expires_at: expiresAt.toISOString(),
                            applied_at: now.toISOString()
                        }), playerId]
                    );
                }
            }
            
            // Применяем инфекцию
            let infectionGain = 0;
            const infectionDefense = riskProfile.infectionDefense;
            
            if (locationData.infection && locationData.infection > 0) {
                const baseInfection = Math.ceil(locationData.infection / 10);

                const randomFactor = 0.7 + Math.random() * 0.6;
                infectionGain = Math.max(0, Math.ceil((baseInfection - infectionDefense) * randomFactor));
                
                if (infectionGain > 0) {
                    try {
                        await DebuffAPI.apply(playerId, 'zombie_infection', infectionGain, {
                            source: locationData.name,
                            locationId: locationData.id
                        });
                    } catch (err) {
                        logger.error('Ошибка применения инфекции', { playerId, error: err.message });
                    }
                }
            }
            
            const modifiers = calculateDebuffModifiers(updatedPlayer);
            const effectiveLuck = Math.max(1, Math.round((updatedPlayer.luck * modifiers.luck) * 10) / 10);
            const riskAdjustedLuck = Math.max(1, Math.round((effectiveLuck + riskProfile.rarityLuckBonus) * 10) / 10);
            const baseDropChance = calculateDropChance(effectiveLuck);
            const dropChance = Math.min(95, Math.max(0.01, baseDropChance * modifiers.dropChance * riskProfile.rewardMultiplier));
            const rolled = Math.random() * 100;
            
            let foundItem = null;
            let itemRarity = null;
            let expGained = 0;
            
            if (rolled <= dropChance) {
                // Новая система дропа:
                // - босс 2: 2%, босс 3: 1%, босс 4: 0.5%, босс 5: 0.25%...
                // - остальное: оружие
                
                // Ключевые шансы от общего дропа
                const keyChances = [
                    { bossLevel: 2, chance: 2.5, name: 'Бездомного психа' },
                    { bossLevel: 3, chance: 1.25, name: 'Медведя-мутанта' },
                    { bossLevel: 4, chance: 0.625, name: 'Военного дрона' },
                    { bossLevel: 5, chance: 0.3125, name: 'Главаря мародёров' },
                    { bossLevel: 6, chance: 0.15625, name: 'Биологического ужаса' },
                    { bossLevel: 7, chance: 0.078125, name: 'Офицера-нежить' },
                    { bossLevel: 8, chance: 0.0390625, name: 'Гигантского монстра' },
                    { bossLevel: 9, chance: 0.01953125, name: 'Профессора безумия' },
                    { bossLevel: 10, chance: 0.009765625, name: 'Последнего стража' }
                ].map((key) => ({
                    ...key,
                    chance: Math.round((key.chance * riskProfile.keyChanceMultiplier) * 100000) / 100000
                }));
                
                // Отдельный бросок для определения типа предмета (ключ или оружие)
                const keyRoll = Math.random() * 100;
                const totalKeyChance = keyChances.reduce((sum, k) => sum + k.chance, 0);
                
                // Проверяем, выпал ли ключ
                let foundKey = null;
                let cumulativeKeyChance = 0;
                
                for (const key of keyChances) {
                    cumulativeKeyChance += key.chance;
                    if (keyRoll < cumulativeKeyChance) {
                        foundKey = key;
                        break;
                    }
                }
                
                if (foundKey) {
                    // Дроп ключа для босса
                    const keyResult = await client.query(`
                        SELECT id, name, type, rarity, icon
                        FROM items 
                        WHERE type = 'key' AND name LIKE '%' || $1 || '%'
                        LIMIT 1
                    `, [foundKey.name]);
                    
                    foundItem = keyResult.rows[0] ? {
                        ...keyResult.rows[0],
                        damage: 0,
                        defense: 0
                    } : null;
                    itemRarity = foundItem?.rarity || 'epic';
                } else {
                    // Дроп оружия (всё остальное от дропа)
                    itemRarity = rollItemRarity(locationData.id, riskAdjustedLuck);

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
                          AND type = 'weapon'
                        LIMIT 1 OFFSET floor(random() * (
                            SELECT COUNT(*) FROM items WHERE rarity = $1 AND type = 'weapon'
                        ))::integer
                    `, [itemRarity]);

                    foundItem = itemResult.rows[0] || null;
                }
                
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
                        WHERE id = $2
                    `, [JSON.stringify(inventory), playerId]);
                    
                    const baseExpReward = Math.floor(6 + (itemRarity === 'common' ? 0 : itemRarity === 'uncommon' ? 3 : itemRarity === 'rare' ? 7 : itemRarity === 'epic' ? 11 : 15));
                    const expReward = Math.max(1, Math.floor(baseExpReward * riskProfile.expMultiplier));
                    await client.query(`
                        UPDATE players 
                        SET experience = experience + $1
                        WHERE id = $2
                    `, [expReward, playerId]);
                    
                    expGained = expReward;
                }
            }
            
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
                    WHERE id = $2
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
                infection: {
                    gained: infectionGain,
                    defense: infectionDefense
                },
                risk_profile: {
                    tier: riskProfile.tier,
                    label: riskProfile.label,
                    score: riskProfile.riskScore,
                    reward_multiplier: riskProfile.rewardMultiplier,
                    key_chance_multiplier: riskProfile.keyChanceMultiplier,
                    rarity_luck_bonus: riskProfile.rarityLuckBonus,
                    is_prepared: riskProfile.isPrepared
                },
                location: {
                    name: locationData.name,
                    radiation: locationData.radiation,
                    infection: locationData.infection || 0
                },
                effective_luck: effectiveLuck,
                risk_adjusted_luck: riskAdjustedLuck,
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
                SELECT * FROM players WHERE id = $1 FOR UPDATE
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
            
            const requiredLevel = locationData.min_level || locationData.required_level || 1;
            if (player.level < requiredLevel) {
                await client.query('ROLLBACK');
                return res.json({
                    success: false,
                    error: `Нужен уровень ${requiredLevel}+`,
                    code: 'INSUFFICIENT_LEVEL',
                    required_level: requiredLevel,
                    current_level: player.level
                });
            }
            
            await client.query(`
                UPDATE players 
                SET current_location_id = $1
                WHERE id = $2
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
 * GET /api/game/locations (через алиас из index.js)
 * GET /api/game/world/locations
 */
router.get('/locations', async (req, res) => {
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
                   min_level as required_level, description
            FROM locations
            ORDER BY min_level ASC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        const availableLocations = locations.map(loc => ({
            id: loc.id,
            name: loc.name,
            icon: loc.icon,
            color: loc.color,
            radiation: loc.radiation,
            danger_level: loc.danger_level,
            required_level: loc.required_level,
            min_level: loc.required_level,
            description: loc.description,
            unlocked: player.level >= loc.required_level,
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
