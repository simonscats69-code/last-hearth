/**
 * Локации и поиск лута
 * @module game/world
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryAll, describeError } = require('../../db/database');
const {
    DEBUFF_CONFIG,
    calculateDropChance,
    rollItemRarity,
    calculateDebuffModifiers,
    calculateLocationRiskProfile
} = require('../../utils/gameConstants');
const { logger, safeJsonParse, handleError } = require('../../utils/serverApi');
const { normalizeInventory, normalizeRadiation, getActiveBuffs, createInventoryItem, recalcEnergy, normalizeEquipment, addItemToInventory } = require('../../utils/game-helpers');
const { DebuffAPI } = require('./debuffs');

// Кэш пула предметов по rarity:type для быстрого случайного выбора (P2-9)
const lootPoolCache = {};
let lootCacheReady = false;

// Модуль загружается ДО initDatabase(), поэтому первая сборка кэша может
// упасть (БД ещё не подключена). Повторяем с растущей задержкой, иначе
// пул лута остаётся пустым на весь цикл работы сервера.
const LOOT_CACHE_MAX_ATTEMPTS = 10;
let lootCacheAttempts = 0;

async function buildLootCache() {
    try {
        const rows = await queryAll(`SELECT id, rarity, type FROM items WHERE type != 'key'`);
        for (const r of rows) {
            const key = `${r.rarity}:${r.type}`;
            if (!lootPoolCache[key]) lootPoolCache[key] = [];
            lootPoolCache[key].push(r.id);
        }
        lootCacheReady = true;
        lootCacheAttempts = 0;
        logger.info('[world] loot pool cache built', { size: rows.length });
    } catch (err) {
        lootCacheAttempts++;
        logger.error('[world] loot cache build failed', {
            attempt: lootCacheAttempts,
            error: describeError(err)
        });
        if (lootCacheAttempts < LOOT_CACHE_MAX_ATTEMPTS) {
            const delay = Math.min(5000 * Math.pow(2, lootCacheAttempts - 1), 60000);
            setTimeout(buildLootCache, delay);
        } else {
            logger.error('[world] loot cache: превышено число попыток, кэш лута пуст');
        }
    }
}

// Строим кэш при загрузке модуля
buildLootCache();

const MAX_INVENTORY_SLOTS = 100;

// =============================================================================
// УТИЛИТЫ
// =============================================================================

function validateLocationId(locationId) {
    return Number.isInteger(locationId) && locationId > 0;
}

function getLootTypePool(locationId) {
    const normalizedLocationId = Number(locationId || 1);

    if (normalizedLocationId <= 1) {
        return ['food', 'medicine', 'resource', 'weapon'];
    }

    if (normalizedLocationId <= 3) {
        return ['food', 'medicine', 'resource', 'weapon', 'armor'];
    }

    if (normalizedLocationId <= 5) {
        return ['weapon', 'armor', 'medicine', 'resource', 'food'];
    }

    return ['weapon', 'armor', 'medicine', 'resource', 'food'];
}

async function getRandomLootItem(client, rarity, locationId) {
    // P2-9: используем кэш пула ID вместо ORDER BY random() на всей таблице
    if (lootCacheReady) {
        const preferredTypes = getLootTypePool(locationId);
        const candidates = [];
        for (const t of preferredTypes) {
            const pool = lootPoolCache[`${rarity}:${t}`];
            if (pool && pool.length) candidates.push(...pool);
        }
        const pool = candidates.length ? candidates : (lootPoolCache[`${rarity}:weapon`] || []);
        if (pool.length) {
            const randId = pool[Math.floor(Math.random() * pool.length)];
            const res = await client.query(
                `SELECT id, name, type, category, rarity, icon, slot, durability, stats,
                        COALESCE((stats->>'damage')::integer, 0) AS damage,
                        COALESCE((stats->>'defense')::integer, 0) AS defense
                 FROM items WHERE id = $1`,
                [randId]
            );
            return res.rows[0] || null;
        }
    }

    // Fallback на случай, если кэш ещё не готов
    const preferredTypes = getLootTypePool(locationId);
    const baseSelect = `
        SELECT
            id,
            name,
            type,
            category,
            rarity,
            icon,
            slot,
            durability,
            stats,
            COALESCE((stats->>'damage')::integer, 0) AS damage,
            COALESCE((stats->>'defense')::integer, 0) AS defense
        FROM items
        WHERE rarity = $1
          AND type != 'key'
    `;

    const preferredResult = await client.query(
        `${baseSelect}
          AND type = ANY($2::text[])
        ORDER BY random()
        LIMIT 1`,
        [rarity, preferredTypes]
    );

    if (preferredResult.rows[0]) {
        return preferredResult.rows[0];
    }

    const fallbackResult = await client.query(
        `${baseSelect}
        ORDER BY random()
        LIMIT 1`,
        [rarity]
    );

    return fallbackResult.rows[0] || null;
}

function buildInventoryItem(item, rarity) {
    return createInventoryItem({
        ...item,
        stats: safeJsonParse(item?.stats, {})
    }, {
        rarity,
        quantity: 1,
        upgrade_level: 0,
        modifications: {}
    });
}

// =============================================================================
// УНИВЕРСАЛЬНЫЙ ОБРАБОТЧИК СПИСКА ЛОКАЦИЙ
// =============================================================================

/**
 * Получение списка локаций
 * GET /api/game/locations (через алиас из index.js)
 * GET /api/game/world/locations
 */
async function handleLocationsList(req, res) {
    logger.info('[world] GET /locations вызван', { playerId: req.player?.id, query: req.query });
    try {
        const player = req.player;
        
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        
        const countResult = await query(`
            SELECT COUNT(*) as total FROM locations
        `);
        const totalLocations = parseInt(countResult.rows[0].total);
        
        const locations = await queryAll(`
            SELECT id, name, icon, color, radiation, infection, danger_level,
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
            infection: loc.infection || 0,
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
            }
        });
        
    } catch (error) {
        handleError(res, error, 'locations_list');
    }
}

// Оба маршрута используют один обработчик
router.get('/', handleLocationsList);
router.get('/locations', handleLocationsList);

// =============================================================================
// ПОИСК ЛУТА
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
        
        // SELECT с явным списком полей вместо SELECT *
        const playerResult = await client.query(`
            SELECT id, energy, max_energy, current_location_id, radiation, inventory, 
                   equipment, luck, health, level, experience, buffs
            FROM players WHERE id = $1 FOR UPDATE
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
        
        // P0-2: запрет поиска при нулевом здоровье
        if (Number(updatedPlayer.health || 0) <= 0) {
            await client.query('ROLLBACK');
            return res.json({
                success: false,
                error: 'Вы истощены. Сначала восстановите здоровье.',
                code: 'NO_HEALTH',
                health: 0,
                max_health: updatedPlayer.max_health
            });
        }

        // P0-1: пересчитываем энергию по реальному времени (не сбрасывая таймер)
        await recalcEnergy(client, updatedPlayer);

        const activeBuffs = getActiveBuffs(updatedPlayer.buffs);
        const energyCost = activeBuffs.free_energy ? 0 : 1;
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
            SELECT id, name, radiation, infection FROM locations WHERE id = $1
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
        
        if (locationData.radiation > 0 && !activeBuffs.no_radiation) {
            // P1-7: используем уже посчитанное давление радиации (с учётом защиты)
            const randomFactor = 0.7 + Math.random() * 0.6;
            radiationGain = Math.max(0, Math.ceil(riskProfile.radiationPressure * randomFactor));
            
            if (radiationGain > 0) {
                const currentRadiation = normalizeRadiation(updatedPlayer.radiation);
                const radiationConfig = DEBUFF_CONFIG.radiation;
                const now = new Date();
                const expiresAt = new Date(
                    now.getTime() + radiationConfig.baseDurationMs + (radiationGain - 1) * radiationConfig.durationPerLevelMs
                );
                
                resultingRadiationLevel = Math.min(radiationConfig.maxLevel, currentRadiation.level + radiationGain);
                
                await client.query(
                    `UPDATE players SET radiation = $1::jsonb WHERE id = $2`,
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
                    // Передаём client текущей транзакции, чтобы не открывать
                    // вложенную транзакцию с блокировкой той же строки игрока
                    await DebuffAPI.apply(playerId, 'zombie_infection', infectionGain, {
                        source: locationData.name,
                        locationId: locationData.id,
                        client
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
        let itemsCollected = 0;
        let inventoryUpdate = null;
        
        if (rolled <= dropChance) {
            // P1-8: ключевые шансы привязаны к boss_id (без хрупкого LIKE по имени)
            const keyChances = [
                { bossId: 2, chance: 2.5 },
                { bossId: 3, chance: 1.25 },
                { bossId: 4, chance: 0.625 },
                { bossId: 5, chance: 0.3125 },
                { bossId: 6, chance: 0.15625 },
                { bossId: 7, chance: 0.078125 },
                { bossId: 8, chance: 0.0390625 },
                { bossId: 9, chance: 0.01953125 },
                { bossId: 10, chance: 0.009765625 }
            ].map((key) => ({
                ...key,
                chance: Math.round((key.chance * riskProfile.keyChanceMultiplier) * 100000) / 100000
            }));
            
            const keyRoll = Math.random() * 100;
            
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
                const keyResult = await client.query(`
                    SELECT i.id, i.name, i.type, i.rarity, i.icon
                    FROM items i
                    JOIN bosses b ON b.required_key_id = i.id
                    WHERE b.id = $1
                    LIMIT 1
                `, [foundKey.bossId]);
                
                foundItem = keyResult.rows[0] ? {
                    ...keyResult.rows[0],
                    damage: 0,
                    defense: 0
                } : null;
                itemRarity = foundItem?.rarity || 'epic';
            } else {
                itemRarity = rollItemRarity(locationData.id, riskAdjustedLuck);

                foundItem = await getRandomLootItem(client, itemRarity, locationData.id);
            }
            
            if (foundItem) {
                const inventory = normalizeInventory(updatedPlayer.inventory);

                // P2-10: лимит слотов инвентаря
                if (inventory.length >= MAX_INVENTORY_SLOTS) {
                    await client.query('ROLLBACK');
                    return res.json({
                        success: false,
                        // Раньше здесь было «Продайте лишнее», но функции продажи
                        // в игре нет — игрока уводили в несуществующее действие.
                        error: `Инвентарь переполнен (макс. ${MAX_INVENTORY_SLOTS} слотов). Используй расходники или экипируй лишнее.`,
                        code: 'INVENTORY_FULL'
                    });
                }

                const newItem = buildInventoryItem(foundItem, itemRarity);

                // Стакование: однотипные предметы складываются в один слот.
                // Раньше каждый дроп занимал отдельный слот, поэтому 100 слотов
                // забивались быстрее, чем игрок успевал их разбирать.
                addItemToInventory(inventory, newItem, foundItem);
                itemsCollected += 1;

                // Бафф x2 к добыче дублирует обычный предмет, но не ключ.
                if (activeBuffs.loot_x2 && newItem.type !== 'key') {
                    addItemToInventory(inventory, { ...newItem }, foundItem);
                    itemsCollected += 1;
                }

                inventoryUpdate = JSON.stringify(inventory);
                
                // P0-3: XP с бонусом локации и комбо за серию действий
                const rarityExp = itemRarity === 'common' ? 0 : itemRarity === 'uncommon' ? 3 : itemRarity === 'rare' ? 7 : itemRarity === 'epic' ? 11 : 15;
                const locBonus = 1 + (locationData.id - 1) * 0.15;
                const comboBonus = (updatedPlayer.total_actions + 1) % 10 === 0 ? 1.5 : 1;
                const baseExpReward = Math.floor(6 + rarityExp) * locBonus * comboBonus;
                expGained = Math.max(1, Math.floor(baseExpReward * riskProfile.expMultiplier));

                if (activeBuffs.exp_x2) {
                    expGained *= 2;
                }
            }
        }
        
        // Вычисляем урон от радиации
        let radiationEffect = null;
        let radiationDamage = 0;
        
        if (resultingRadiationLevel >= 10) {
            radiationEffect = 'critical';
            radiationDamage = 10;
        } else if (resultingRadiationLevel >= 5) {
            radiationEffect = 'danger';
            // P1-7: используем константу напрямую (без || 2)
            radiationDamage = DEBUFF_CONFIG.radiation.damagePerLevel;
        } else if (radiationGain > 0) {
            radiationEffect = 'applied';
        }
        
        // Строим UPDATE динамически с правильными позициями параметров
        // P0-1: НЕ трогаем last_energy_update — реген идёт от реального времени
        const setParts = [
            'energy = energy - $1',
            'total_actions = total_actions + 1',
            'health = GREATEST(0, health - $2)'
        ];
        const params = [energyCost, radiationDamage];
        
        if (inventoryUpdate) {
            params.push(inventoryUpdate);
            setParts.push(`inventory = $${params.length}`);
        }
        if (expGained > 0) {
            params.push(expGained);
            setParts.push(`experience = experience + $${params.length}`);
        }
        if (itemsCollected > 0) {
            params.push(itemsCollected);
            setParts.push(`items_collected = COALESCE(items_collected, 0) + $${params.length}`);
        }
        
        params.push(playerId);
        const updateSql = `UPDATE players SET ${setParts.join(', ')} WHERE id = $${params.length} RETURNING energy, max_energy, last_energy_update`;
        
        const energyResult = await client.query(updateSql, params);
        
        const newEnergy = energyResult.rows[0].energy;
        const newMaxEnergy = energyResult.rows[0].max_energy;
        const lastEnergyUpdate = energyResult.rows[0].last_energy_update;
        
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
        handleError(res, error, 'location_search');
    } finally {
        client.release();
    }
});

// =============================================================================
// ПЕРЕМЕЩЕНИЕ МЕЖДУ ЛОКАЦИЯМИ
// =============================================================================

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
        
        // SELECT с явным списком полей вместо SELECT *
        const playerResult = await client.query(`
            SELECT id, level, current_location_id FROM players WHERE id = $1 FOR UPDATE
        `, [playerId]);
        
        const player = playerResult.rows[0];
        
        // Проверяем существование игрока
        if (!player) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Игрок не найден',
                code: 'PLAYER_NOT_FOUND'
            });
        }
        
        const targetLocation = await client.query(`
            SELECT id, name, radiation, infection, description, min_level, danger_level, icon
            FROM locations WHERE id = $1
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
        
        const requiredLevel = locationData.min_level || 1;
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
            UPDATE players SET current_location_id = $1 WHERE id = $2
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
                    icon: locationData.icon || '🏠',
                    radiation: locationData.radiation,
                    infection: locationData.infection || 0,
                    danger_level: locationData.danger_level || 1,
                    description: locationData.description
                },
                message: `Вы прибыли в ${locationData.name}`
            }
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        handleError(res, error, 'location_move');
    } finally {
        client.release();
    }
});

module.exports = router;
