/**
 * Локации и поиск лута
 * @module game/world
 */

const express = require('express');
const router = express.Router();
// Раньше обработчики поиска и перемещения сами брали соединение из пула
// и вручную писали BEGIN/COMMIT/ROLLBACK. Теперь это делает
// transaction() — он же и освобождает соединение в finally.
// См. пояснение в POST /world/search.
const { query, queryAll, describeError, transaction } = require('../../db/database');
const {
    DEBUFF_CONFIG,
    calculateDropChance,
    rollItemRarity,
    calculateDebuffModifiers,
    calculateLocationRiskProfile
} = require('../../utils/gameConstants');
const { logger, safeJsonParse, handleError } = require('../../utils/serverApi');
const { normalizeInventory, normalizeRadiation, getActiveBuffs, createInventoryItem, recalcEnergy, regenerateHealth, addItemToInventory, equipmentRules, trackCollectedItems, progressDailyTask } = require('../../utils/game-helpers');
const { DebuffAPI } = require('./debuffs');
const { lootPoolCache, getLootCacheReady, buildLootCache, getLootTypePool, getRandomLootItemFromPool } = require('../../utils/lootCache');
const crypto = require('crypto');

// Лимит слотов инвентаря — из public/shared/equipment.js, того же файла,
// который читает браузер.
const MAX_INVENTORY_SLOTS = require('../../public/shared/equipment.js').MAX_INVENTORY_SLOTS;

// =============================================================================
// УТИЛИТЫ
// =============================================================================

function validateLocationId(locationId) {
    return Number.isInteger(locationId) && locationId > 0;
}

async function getRandomLootItem(client, rarity, locationId) {
    // P2-9: используем кэш пула ID вместо ORDER BY random() на всей таблице
    if (getLootCacheReady()) {
        const itemId = getRandomLootItemFromPool(rarity, locationId);
        if (itemId) {
            const result = await client.query(
                `SELECT id, name, type, category, rarity, icon, slot, durability, stats,
                        COALESCE((stats->>'damage')::integer, 0) AS damage,
                        COALESCE((stats->>'defense')::integer, 0) AS defense
                 FROM items WHERE id = $1`,
                [itemId]
            );
            if (result.rows[0]) {
                return createInventoryItem(result.rows[0], { quantity: 1 });
            }
        }
    }
    
    // Fallback: прямой запрос если кэш не готов
    const types = getLootTypePool(locationId);
    const result = await client.query(
        `SELECT id, name, type, category, rarity, icon, slot, durability, stats,
                COALESCE((stats->>'damage')::integer, 0) AS damage,
                COALESCE((stats->>'defense')::integer, 0) AS defense
         FROM items 
         WHERE rarity = $1 AND type = ANY($2::text[]) AND type != 'key'
         ORDER BY random() LIMIT 1`,
        [rarity, types]
    );
    if (result.rows[0]) {
        return createInventoryItem(result.rows[0], { quantity: 1 });
    }
    return null;
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

/**
 * Шансы выпадения ключей боссов из поиска.
 *
 * Источник данных — bosses.key_drop_chance (проценты от дропа) вместе с
 * именем/иконкой ключевого предмета. Множитель риска локации сохраняем:
 * чем опаснее зона, тем выше шанс сорвать ключ.
 *
 * @param {object} client клиент БД (транзакция)
 * @returns {Promise<Array<{bossId:number,chance:number,name:string,icon:string,rarity:string,bossName:string}>>}
 */
async function getBossKeyChances(client) {
    const result = await client.query(`
        SELECT b.id AS boss_id, b.name AS boss_name, b.key_drop_chance,
               k.name AS key_name, k.icon AS key_icon, k.rarity AS key_rarity
          FROM bosses b
          JOIN items k ON k.id = b.required_key_id
         WHERE b.key_drop_chance > 0
           AND b.required_key_id IS NOT NULL
         ORDER BY b.id
    `);

    return result.rows.map((row) => ({
        bossId: row.boss_id,
        bossName: row.boss_name,
        name: row.key_name,
        icon: row.key_icon,
        rarity: row.key_rarity,
        chance: Math.round(Number(row.key_drop_chance) * 100000) / 100000
    }));
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
    const playerId = req.player.id;

    // Раньше здесь вручную бралось соединение, а ветки отказа («нет
    // игрока», «нет здоровья», «нет энергии», «локация не найдена»,
    // «инвентарь полон») каждая вызывала ROLLBACK и отвечала прямо из
    // try. С transaction() тело возвращает результат, а HTTP-ответ
    // отправляется один раз ПОСЛЕ завершения транзакции. Это чинит
    // реальный дефект прежней записи: res.json стоял уже после COMMIT,
    // и если он бросал исключение, catch выполнял ROLLBACK по закрытой
    // транзакции.
    try {
        const outcome = await transaction(async (client) => {
            // SELECT с явным списком полей вместо SELECT *. Два поля обязательны:
            // total_actions — для comboBonus по (total_actions+1) % 10, иначе
            // комбо-бонус не даётся никогда;
            // max_health и last_hp_regen — для regenerateHealth(): без максимума
            // regenerable всегда 0, хелпер уходит в ветку «на потолке» и пишет
            // last_hp_regen = NOW(), то есть поиск не лечит И обнуляет
            // накопленное время регена.
            const playerResult = await client.query(`
                SELECT id, energy, max_energy, current_location_id, radiation, inventory,
                       equipment, luck, health, max_health, last_hp_regen, level, experience,
                       buffs, total_actions
                FROM players WHERE id = $1 FOR UPDATE
            `, [playerId]);

            const updatedPlayer = playerResult.rows[0];

            if (!updatedPlayer) {
                return {
                    status: 404,
                    body: {
                        success: false,
                        error: 'Игрок не найден',
                        code: 'PLAYER_NOT_FOUND'
                    }
                };
            }

            // P0-2: запрет поиска при нулевом здоровье
            if (Number(updatedPlayer.health || 0) <= 0) {
                return {
                    status: 200,
                    body: {
                        success: false,
                        error: 'Вы истощены. Сначала восстановите здоровье.',
                        code: 'NO_HEALTH',
                        health: 0,
                        max_health: updatedPlayer.max_health
                    }
                };
            }

            // P0-1: пересчитываем энергию по реальному времени (не сбрасывая таймер)
            await recalcEnergy(client, updatedPlayer);
            // То же для здоровья: медленный реген после боя. Без него игрок,
            // израсходовавший все аптечки, оставался с 1 HP навсегда.
            await regenerateHealth(client, updatedPlayer);

            const activeBuffs = getActiveBuffs(updatedPlayer.buffs);
            const energyCost = activeBuffs.free_energy ? 0 : 1;
            if (updatedPlayer.energy < energyCost) {
                return {
                    status: 200,
                    body: {
                        success: false,
                        error: 'Недостаточно энергии',
                        code: 'INSUFFICIENT_ENERGY',
                        energy: Math.max(0, updatedPlayer.energy),
                        max_energy: updatedPlayer.max_energy
                    }
                };
            }

            const location = await client.query(`
                SELECT id, name, radiation, infection FROM locations WHERE id = $1
            `, [updatedPlayer.current_location_id]);

            if (location.rows.length === 0) {
                return {
                    status: 404,
                    body: {
                        success: false,
                        error: 'Локация не найдена',
                        code: 'LOCATION_NOT_FOUND'
                    }
                };
            }

            const locationData = location.rows[0];
            const equipment = safeJsonParse(updatedPlayer.equipment, {});
            const riskProfile = calculateLocationRiskProfile(locationData, equipment);
        
        let radiationGain = 0;
        const radiationDefense = riskProfile.radiationDefense;
        let resultingRadiationLevel = normalizeRadiation(updatedPlayer.radiation).level;
        
        if (locationData.radiation > 0 && !activeBuffs.no_radiation) {
            // P1-7: используем уже посчитанное давление радиации (с учётом защиты)
            const randomFactor = 0.7 + crypto.randomInt(600) / 1000;
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
            const randomFactor = 0.7 + crypto.randomInt(600) / 1000;
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
        // Удача от экипировки (например, Сталкерского пояса) слотом accessory.
        const equipmentLuckBonus = equipmentRules.calculateEquipmentLuckBonus(equipment);
        const effectiveLuck = Math.max(1, Math.round((updatedPlayer.luck * modifiers.luck + equipmentLuckBonus) * 10) / 10);
        const riskAdjustedLuck = Math.max(1, Math.round((effectiveLuck + riskProfile.rarityLuckBonus) * 10) / 10);
        const baseDropChance = calculateDropChance(effectiveLuck);
        const dropChance = Math.min(95, Math.max(0.01, baseDropChance * modifiers.dropChance * riskProfile.rewardMultiplier));
        const rolled = crypto.randomInt(10000) / 100;
        
        let foundItem = null;
        let foundKeyInfo = null;
        let itemRarity = null;
        let expGained = 0;
        let itemsCollected = 0;
        let inventoryUpdate = null;
        
        if (rolled <= dropChance) {
            // Ключи боссов. Шансы берём из bosses.key_drop_chance (в процентах
            // от дропа), а предмет — джойном items -> bosses по
            // required_key_id: без этого джойна ключ не находится вовсе,
            // энергия тратится, а лут не выпадает.
            //
            // Ключ НЕ попадает в инвентарь: он хранится в boss_keys (валюта
            // прогрессии), поэтому за него не тратится слот из 100.
            const keyChanceRows = await getBossKeyChances(client);
            const keyRoll = crypto.randomInt(10000) / 100;

            let foundKey = null;
            let cumulativeKeyChance = 0;

            for (const key of keyChanceRows) {
                cumulativeKeyChance += key.chance;
                if (keyRoll < cumulativeKeyChance) {
                    foundKey = key;
                    break;
                }
            }

            if (foundKey) {
                // Ключ «Ключ от X» открывает бой с X, а хранится он под
                // владельцем предыдущего босса: boss_keys.boss_id = X - 1.
                const ownerBossId = Math.max(1, foundKey.bossId - 1);
                await client.query(`
                    INSERT INTO boss_keys (player_id, boss_id, quantity)
                    VALUES ($1, $2, 1)
                    ON CONFLICT (player_id, boss_id)
                    DO UPDATE SET quantity = boss_keys.quantity + 1
                `, [playerId, ownerBossId]);

                foundKeyInfo = {
                    name: foundKey.name,
                    icon: foundKey.icon || '🗝️',
                    rarity: foundKey.rarity || 'epic',
                    boss_id: foundKey.bossId,
                    boss_name: foundKey.bossName
                };
            } else {
                itemRarity = rollItemRarity(locationData.id, riskAdjustedLuck);

                foundItem = await getRandomLootItem(client, itemRarity, locationData.id);
            }
            
            if (foundItem) {
                const inventory = normalizeInventory(updatedPlayer.inventory);

                // P2-10: лимит слотов инвентаря
                if (inventory.length >= MAX_INVENTORY_SLOTS) {
                    return {
                        status: 200,
                        body: {
                            success: false,
                            // Функции продажи в игре нет, поэтому предлагать её здесь нельзя.
                            error: `Инвентарь переполнен (макс. ${MAX_INVENTORY_SLOTS} слотов). Используй расходники или экипируй лишнее.`,
                            code: 'INVENTORY_FULL'
                        }
                    };
                }

                const newItem = buildInventoryItem(foundItem, itemRarity);

                // Стакование: однотипные предметы складываются в один слот, иначе
                // 100 слотов забиваются быстрее, чем игрок успевает их разбирать.
                addItemToInventory(inventory, newItem, foundItem);
                itemsCollected += 1;

                // Бафф x2 к добыче дублирует обычный предмет, но не ключ.
                if (activeBuffs.loot_x2 && newItem.type !== 'key') {
                    addItemToInventory(inventory, { ...newItem }, foundItem);
                    itemsCollected += 1;
                }

                // Лимит слотов перепроверяем ПОСЛЕ обоих добавлений.
                // Проверка выше (до лота) не защищала: при 99 слотах и
                // нестакуемом предмете бафф x2 добавлял ещё два слота и
                // инвентарь становился 101 — лимит 100 молча превышался.
                if (inventory.length > MAX_INVENTORY_SLOTS) {
                    return {
                        status: 200,
                        body: {
                            success: false,
                            error: `Инвентарь переполнен (макс. ${MAX_INVENTORY_SLOTS} слотов). Используй расходники или экипируй лишнее.`,
                            code: 'INVENTORY_FULL'
                        }
                    };
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
        // GREATEST(0, ...) — страховка от гонки: колонка под CHECK (energy >= 0),
        // та же логика, что в бою с боссом, PvP и колесе.
        const setParts = [
            'energy = GREATEST(0, energy - $1)',
            // COALESCE: у старых записей счётчик мог быть NULL, и счётчик
            // действий навечно замирал в NULL вместо роста.
            'total_actions = COALESCE(total_actions, 0) + 1',
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

        // Счётчики прогресса: без них достижения «Коллекционер»/«Ежедневная
        // победа» и ежедневные задания остаются на нуле при любых действиях.
        if (foundItem?.id) {
            await trackCollectedItems(client, playerId, [foundItem.id]);
        }
        await progressDailyTask(client, playerId, 'search', 1);
        if (itemsCollected > 0) {
            await progressDailyTask(client, playerId, 'collect_items', itemsCollected);
        }

        // Успешный исход: собираем тело ответа и отдаём его наружу, а
        // транзакция коммитится сама. Ответ уходит из transaction()
        // ниже — уже после COMMIT, как и раньше, но без ручного COMMIT.
        return {
            status: 200,
            body: {
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
                // Ключ босса в инвентарь не попадает (хранится в boss_keys),
                // поэтому клиенту нужен отдельный сигнал, чтобы показать находку.
                found_key: foundKeyInfo,
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
            },
            // Данные для лога: нужны только при успешном поиске.
            log: {
                foundItemName: foundItem?.name || null,
                effectiveLuck,
                dropChance,
                locationId: locationData.id
            }
        };
    });

        // Логируем только при выполненном поиске — в ветках отказа лота не было.
        if (outcome.log) {
            logger.info(`[world] Поиск лута`, {
                playerId,
                foundItem: outcome.log.foundItemName,
                effectiveLuck: outcome.log.effectiveLuck,
                dropChance: outcome.log.dropChance,
                locationId: outcome.log.locationId
            });
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        // ROLLBACK выполняет transaction(). Вручную он был нужен только
        // из-за ручного же BEGIN, а теперь ещё и мешал: res.json стоял
        // уже после COMMIT, и его исключение приводило к откату
        // закрытой транзакции.
        handleError(res, error, 'location_search');
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
    // Валидация выполняется ДО открытия транзакции, как и раньше: BEGIN
    // в прежней записи стоял после этих проверок. Заодно уходит лишнее
    // занятие соединения из пула на время валидации.
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

    try {
        // Как и в /search: тело транзакции возвращает результат, ответ
        // уходит после COMMIT, ROLLBACK делает transaction().
        const outcome = await transaction(async (client) => {
            // SELECT с явным списком полей вместо SELECT *
            const playerResult = await client.query(`
                SELECT id, level, current_location_id FROM players WHERE id = $1 FOR UPDATE
            `, [playerId]);

            const player = playerResult.rows[0];

            // Проверяем существование игрока
            if (!player) {
                return {
                    status: 404,
                    body: {
                        success: false,
                        error: 'Игрок не найден',
                        code: 'PLAYER_NOT_FOUND'
                    }
                };
            }

            const targetLocation = await client.query(`
                SELECT id, name, radiation, infection, description, min_level, danger_level, icon
                FROM locations WHERE id = $1
            `, [location_id]);

            if (targetLocation.rows.length === 0) {
                return {
                    status: 404,
                    body: {
                        success: false,
                        error: 'Локация не найдена',
                        code: 'LOCATION_NOT_FOUND'
                    }
                };
            }

            const locationData = targetLocation.rows[0];

            const requiredLevel = locationData.min_level || 1;
            if (player.level < requiredLevel) {
                return {
                    status: 200,
                    body: {
                        success: false,
                        error: `Нужен уровень ${requiredLevel}+`,
                        code: 'INSUFFICIENT_LEVEL',
                        required_level: requiredLevel,
                        current_level: player.level
                    }
                };
            }

            await client.query(`
                UPDATE players
                   SET current_location_id = $1,
                       -- locations_visited читает достижение «Путешественник»
                       -- (3 локации) и «Искатель» (7). Хранит объекты {id, name}.
                       locations_visited = (
                           SELECT COALESCE(jsonb_agg(DISTINCT visited_obj), '[]'::jsonb)
                             FROM jsonb_array_elements(
                                 COALESCE(locations_visited, '[]'::jsonb)
                                 || jsonb_build_array(jsonb_build_object('id', $1, 'name', (SELECT name FROM locations WHERE id = $1)))
                             ) AS visited_obj
                       )
                 WHERE id = $2
            `, [location_id, playerId]);

            return {
                status: 200,
                body: {
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
                },
                log: {
                    fromLocationId: player.current_location_id,
                    toLocationId: location_id
                }
            };
        });

        if (outcome.log) {
            logger.info(`[world] Перемещение`, {
                playerId,
                fromLocationId: outcome.log.fromLocationId,
                toLocationId: outcome.log.toLocationId
            });
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        handleError(res, error, 'location_move');
    }
});

module.exports = router;
