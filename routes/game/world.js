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
const { lockPlayer } = require('../../db/players');
const {
    DEBUFF_CONFIG,
    calculateDropChance,
    rollItemRarity,
    calculateDebuffModifiers,
    calculateLocationRiskProfile,
    calculateRadiationDamage
} = require('../../utils/gameConstants');
const { logger, safeJsonParse, handleError, unauthorized } = require('../../utils/serverApi');

// Ленивая загрузка helpers: utils/game-helpers.js — единственный источник
// функций состояния игрока. Он тянет db/database, поэтому импорт ленивый
// (иначе цикл загрузки модулей). Общий загрузчик — utils/getGameHelpers.js.
const { getGameHelpers } = require('../../utils/getGameHelpers');

// Экспортируемые функции через getGameHelpers()
const helpers = getGameHelpers();
const { normalizeInventory, normalizeRadiation, normalizeEquipment, getActiveBuffs, createInventoryItem, recalcEnergy, regenerateHealth, addItemToInventory, equipmentRules, trackCollectedItems, progressDailyTask } = helpers;
const { lootPoolCache, getLootCacheReady, buildLootCache, getLootTypePool, getRandomLootItemFromPool } = require('../../utils/lootCache');
const crypto = require('crypto');
// Один require на файл правил: раньше путь '../../public/shared/equipment.js'
// фигурировал дважды (отдельно для calculateCoinDrop, отдельно для
// MAX_INVENTORY_SLOTS). Node кэширует модуль, поэтому это было безвредно,
// но выглядело как два разных источника одних и тех же правил.
const equipmentShared = require('../../public/shared/equipment.js');
const {
    calculateCoinDrop,
    MAX_INVENTORY_SLOTS,
    SEARCH_BASE_XP,
    SEARCH_RARITY_XP,
    SEARCH_COMBO_EVERY,
    SEARCH_COMBO_MULTIPLIER
} = equipmentShared;

// =============================================================================
// УТИЛИТЫ
// =============================================================================

// --- Баланс опыта за поиск берётся из equipment.js (единый источник правды) --

function validateLocationId(locationId) {
    const num = Number(locationId);
    return Number.isSafeInteger(num) && num > 0;
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


/**
 * Шансы выпадения ключей боссов из поиска.
 *
 * Источник данных — bosses.key_drop_chance (проценты от дропа) вместе с
 * именем/иконкой ключевого предмета. Множитель риска локации сохраняем:
 * чем опаснее зона, тем выше шанс сорвать ключ.
 *
 * ОГРАНИЧЕНИЕ: ключи выпадают ТОЛЬКО для следующего босса в последовательности.
 * Игрок не может получить ключ от босса N+2, пока не разблокировал N+1.
 * Это обеспечивает строгую последовательность прогрессии.
 *
 * @param {object} client клиент БД (транзакция)
 * @param {number} playerId ID игрока
 * @returns {Promise<Array<{bossId:number,chance:number,name:string,icon:string,rarity:string,bossName:string}>>}
 */
async function getBossKeyChances(client, playerId) {
    // Определяем следующий босса, которого нужно открыть.
    // Ищем максимальный boss_id в boss_keys, где у игрока есть ключи,
    // плюс 1. Если ключей нет — следующий босс = 2 (первый с ключом).
    //
    // Три отдельных запроса (прогресс -> максимум боссов -> ключ) заменены
    // одним: в нём макс. босс считается подзапросом, а ключ — джойном к нему.
    // Один roundtrip вместо трёх на КАЖДОМ вызове поиска лута.
    const result = await client.query(`
        WITH next_boss AS (
            SELECT LEAST(
                (SELECT COALESCE(MAX(boss_id), 1) + 1 FROM boss_keys
                  WHERE player_id = $1 AND quantity > 0),
                (SELECT COALESCE(MAX(id), 2) FROM bosses)
            ) AS boss_id
        )
        SELECT b.id AS boss_id, b.name AS boss_name, b.key_drop_chance,
               k.name AS key_name, k.icon AS key_icon, k.rarity AS key_rarity
          FROM bosses b
          JOIN items k ON k.id = b.required_key_id
          JOIN next_boss nb ON nb.boss_id = b.id
         WHERE b.key_drop_chance > 0
           AND b.required_key_id IS NOT NULL
    `, [playerId]);

    if (result.rows.length === 0) {
        return []; // Ключ для этого босса не существует или шанс 0
    }

    const row = result.rows[0];
    return [{
        bossId: row.boss_id,
        bossName: row.boss_name,
        name: row.key_name,
        icon: row.key_icon,
        rarity: row.key_rarity,
        chance: Math.round(Number(row.key_drop_chance) * 100000) / 100000
    }];
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

        if (!player) {
            return unauthorized(res);
        }

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        
        const countResult = await query(`
            SELECT COUNT(*) as total FROM locations
        `);
        const totalLocations = parseInt(countResult.rows[0]?.total || 0, 10);
        
        const locations = await queryAll(`
            SELECT id, name, icon, color, radiation, danger_level,
                   min_level as required_level, description,
                   loot_table, exhaustion, is_available
            FROM locations
            ORDER BY min_level ASC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        const availableLocations = locations.map(loc => {
            // Строим превью лута для клиента: типы предметов, шансы редкостей,
            // примерные предметы и информацию о ключе босса.
            const lootTable = loc.loot_table && typeof loc.loot_table === 'object' && !Array.isArray(loc.loot_table) && Object.keys(loc.loot_table).length > 0
                ? loc.loot_table
                : null;
            const preferredTypes = getLootTypePool(loc.id);
            const rarityChances = lootTable || {};
            const exhaustionLevel = Number(loc.exhaustion || 0);

            return {
                id: loc.id,
                name: loc.name,
                icon: loc.icon,
                color: loc.color,
                radiation: loc.radiation,
                danger_level: loc.danger_level,
                required_level: loc.required_level,
                min_level: loc.required_level,
                description: loc.description,
                is_available: loc.is_available,
                unlocked: Number(player.level || 0) >= Number(loc.required_level || 0),
                current: loc.id === player.current_location_id,
                loot_preview: {
                    types: preferredTypes,
                    rarity_chances: rarityChances,
                    exhaustion: exhaustionLevel,
                    exhaustion_penalty: Math.round(Math.min(0.5, exhaustionLevel / 200) * 100)
                }
            };
        });
        
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
    // Фильтруем чувствительные заголовки перед логированием
    const safeHeaderKeys = Object.keys(req.headers).filter(k => !['authorization', 'cookie', 'x-init-data'].includes(k.toLowerCase()));
    logger.info('[world] POST /search вызван', { playerId: req.player?.id, body: req.body, headers: safeHeaderKeys });

    if (!req.player) {
        return unauthorized(res);
    }
    if (!req.player?.id) return unauthorized(res);
    const playerId = req.player?.id;

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
            const updatedPlayer = await lockPlayer(playerId, client, 'id, energy, max_energy, current_location_id, radiation, inventory, equipment, luck, health, max_health, last_hp_regen, level, experience, buffs, total_actions, last_energy_update, empty_searches_streak');

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
                    status: 400,
                    body: {
                        success: false,
                        error: 'Вы истощены. Сначала восстановите здоровье.',
                        code: 'NO_HEALTH',
                        health: 0,
                        max_health: updatedPlayer.max_health
                    }
                };
            }

            const activeBuffs = getActiveBuffs(updatedPlayer.buffs);

            // Запрос локации вынесен ПЕРЕД проверкой энергии: сначала убеждаемся,
            // что зона доступна и игрок соответствует уровню, и только потом
            // считаем стоимость действия.
            if (!updatedPlayer.current_location_id) {
                throw {
                    message: 'Локация не найдена',
                    code: 'LOCATION_NOT_FOUND',
                    statusCode: 404
                };
            }

            const location = await client.query(`
                SELECT id, name, radiation, is_available, min_level, loot_table FROM locations WHERE id = $1
            `, [updatedPlayer.current_location_id]);

            if (location.rows.length === 0) {
                throw {
                    message: 'Локация не найдена',
                    code: 'LOCATION_NOT_FOUND',
                    statusCode: 404
                };
            }

            const locationData = location.rows[0];

            if (!locationData.is_available) {
                return {
                    status: 403,
                    body: {
                        success: false,
                        error: 'Эта локация сейчас недоступна для исследований',
                        code: 'LOCATION_UNAVAILABLE'
                    }
                };
            }

            if (Number(updatedPlayer.level || 1) < Number(locationData.min_level || 1)) {
                return {
                    status: 403,
                    body: {
                        success: false,
                        error: `Для исследований в этой зоне нужен уровень ${locationData.min_level}+`,
                        code: 'INSUFFICIENT_LEVEL',
                        required_level: Number(locationData.min_level),
                        current_level: Number(updatedPlayer.level || 1)
                    }
                };
            }

            // P0-1: пересчитываем энергию по реальному времени (не сбрасывая таймер)
            await recalcEnergy(client, updatedPlayer);
            // То же для здоровья: медленный реген после боя. Без него игрок,
            // израсходовавший все аптечки, оставался с 1 HP навсегда.
            await regenerateHealth(client, updatedPlayer);

            // Валидация экипировки через normalizeEquipment: гарантирует чистую
            // структуру слотов перед расчётом защиты и риска.
            const equipment = normalizeEquipment(updatedPlayer.equipment);
            const riskProfile = calculateLocationRiskProfile(locationData, equipment);

            // Дифференцированная стоимость поиска по типу зоны.
            // Безопасные зоны дешевле, опасные — стоят больше энергии.
            const ENERGY_COST_BY_TIER = {
                safe: 1,
                warning: 1,
                danger: 2,
                deadly: 3
            };
            const energyCost = activeBuffs.free_energy ? 0 : (ENERGY_COST_BY_TIER[riskProfile.tier] || 1);
            if (Number(updatedPlayer.energy || 0) < energyCost) {
                throw {
                    message: 'Недостаточно энергии',
                    code: 'INSUFFICIENT_ENERGY',
                    statusCode: 400,
                    energy: Math.max(0, updatedPlayer.energy),
                    max_energy: updatedPlayer.max_energy
                };
            }
        
        // Заражение зоной считается unified: radiation + любые угрозы зоны.
        let radiationGain = 0;
        let radiationExpiresAt = null;
        const contaminationDefense = riskProfile.contaminationDefense;
        let resultingRadiationLevel = normalizeRadiation(updatedPlayer.radiation).level;
        const existingRadiation = normalizeRadiation(updatedPlayer.radiation);
        
        if (riskProfile.contaminationThreat > 0 && !activeBuffs.no_radiation) {
            // P1-7: используем уже посчитанное давление (с учётом защиты)
            const randomFactor = 0.7 + crypto.randomInt(600) / 1000;
            radiationGain = Math.max(0, Math.ceil(riskProfile.contaminationPressure * randomFactor));
            
            if (radiationGain > 0) {
                const radiationConfig = DEBUFF_CONFIG.radiation;
                const now = new Date();
                const expiresAt = new Date(
                    now.getTime() + radiationConfig.baseDurationMs + (radiationGain - 1) * radiationConfig.durationPerLevelMs
                );
                radiationExpiresAt = expiresAt.toISOString();
                
                resultingRadiationLevel = Math.min(radiationConfig.maxLevel, existingRadiation.level + radiationGain);
                
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
        
        // Если радиация не накапливалась в этом поиске, но уже была активна,
        // берём expires_at из существующих данных, чтобы клиент видел срок действия.
        if (!radiationExpiresAt && resultingRadiationLevel > 0 && existingRadiation.expires_at && new Date(existingRadiation.expires_at) > now) {
            radiationExpiresAt = existingRadiation.expires_at;
        }

        updatedPlayer.radiation = { level: resultingRadiationLevel, expires_at: radiationExpiresAt || null };

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
        let coinDrop = null;
        let lootRolled = false;
        
        // Pity timer: после PITY_THRESHOLD подряд пустых поисков следующая
        // вылазка гарантированно даёт предмет редкостью не ниже uncommon.
        const PITY_THRESHOLD = 10;
        const emptyStreak = Number(updatedPlayer.empty_searches_streak || 0);
        const pityActive = emptyStreak >= PITY_THRESHOLD;
        
        // Учёт истощения зоны: чем выше exhaustion, тем ниже шанс редкого лута.
        const locationExhaustion = Number(locationData.exhaustion || 0);
        const exhaustionPenalty = Math.min(0.5, locationExhaustion / 200); // до -50% шанса
        const adjustedDropChance = Math.max(0.01, dropChance * (1 - exhaustionPenalty));
        
        if (rolled <= adjustedDropChance) {
            // Ключи боссов. Шансы берём из bosses.key_drop_chance (в процентах
            // от дропа), а предмет — джойном items -> bosses по
            // required_key_id: без этого джойна ключ не находится вовсе,
            // энергия тратится, а лут не выпадает.
            //
            // Ключи выпадают ТОЛЬКО для следующего босса в последовательности.
            // getBossKeyChances теперь принимает playerId и возвращает ключ
            // только для следующего босса в прогрессии игрока.
            const keyChanceRows = await getBossKeyChances(client, playerId);
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
                lootRolled = true;
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
                // Pity timer: если активен, принудительно выбираем редкость не ниже uncommon.
                let forcedRarity = null;
                if (pityActive) {
                    forcedRarity = 'uncommon';
                }
                itemRarity = rollItemRarity(locationData.id, riskAdjustedLuck, locationData.loot_table, forcedRarity);

                foundItem = await getRandomLootItem(client, itemRarity, locationData.id);
            }
            
            if (foundItem) {
                lootRolled = true;
                const inventory = normalizeInventory(updatedPlayer.inventory);

                // Проверяем место в инвентаре перед добавлением предмета.
                // Если инвентарь полон, не пытаемся добавить — выбрасываем
                // ошибку сразу, чтобы не мутировать инвентарь впустую.
                if (inventory.length >= MAX_INVENTORY_SLOTS) {
                    throw {
                        message: `Инвентарь переполнен (макс. ${MAX_INVENTORY_SLOTS} слотов). Используй расходники или экипируй лишнее.`,
                        code: 'INVENTORY_FULL',
                        statusCode: 400
                    };
                }

                const newItem = createInventoryItem({
                    ...foundItem,
                    stats: safeJsonParse(foundItem?.stats, {})
                }, {
                    rarity: itemRarity,
                    quantity: 1,
                    upgrade_level: 0,
                    modifications: {}
                });

                // Стакование: однотипные предметы складываются в один слот, иначе
                // 100 слотов забиваются быстрее, чем игрок успевает их разбирать.
                addItemToInventory(inventory, newItem, foundItem);
                itemsCollected += 1;

                // Бафф x2 к добыче дублирует обычный предмет, но не ключ.
                // Проверяем место в инвентаре ДО добавления второго экземпляра,
                // чтобы бафф не вызвал полный откат транзакции из-за переполнения.
                if (activeBuffs.loot_x2 && newItem.type !== 'key') {
                    const wouldExceed = inventory.length >= MAX_INVENTORY_SLOTS;
                    if (!wouldExceed) {
                        addItemToInventory(inventory, { ...newItem }, foundItem);
                        itemsCollected += 1;
                        // trackCollectedItems для дубля loot_x2 — иначе
                        // достижение «Коллекционер» не учитывает второй экземпляр.
                        if (foundItem?.id) {
                            await trackCollectedItems(client, playerId, [foundItem.id]);
                        }
                    }
                }

                // Проверка лимита слотов ПОСЛЕ всех добавлений (включая loot_x2).
                if (inventory.length > MAX_INVENTORY_SLOTS) {
                    throw {
                        message: `Инвентарь переполнен (макс. ${MAX_INVENTORY_SLOTS} слотов). Используй расходники или экипируй лишнее.`,
                        code: 'INVENTORY_FULL',
                        statusCode: 400
                    };
                }

                inventoryUpdate = JSON.stringify(inventory);
                
                // Опыт: базовый + бонус редкости, домножается на бонус
                // локации и на комбо за серию действий.
                // Бонус локации растёт нелинейно: каждая следующая зона
                // даёт пропорционально больше опыта за риск.
                const rarityExp = SEARCH_RARITY_XP[itemRarity] ?? 0;
                const locBonus = Math.pow(1.2, locationData.id - 1);
                const comboBonus = (Number(updatedPlayer.total_actions || 0) + 1) % SEARCH_COMBO_EVERY === 0 ? SEARCH_COMBO_MULTIPLIER : 1;
                const baseExpReward = Math.floor(SEARCH_BASE_XP + rarityExp) * locBonus * comboBonus;
                expGained = Math.max(1, Math.floor(baseExpReward * riskProfile.expMultiplier));

                if (activeBuffs.exp_x2) {
                    expGained *= 2;
                }
            }
        }

        // Выпадение монет при поиске — независимо от выпадения лута/ключа.
        // 30% шанс, зависит от риска, удачи, уровня.
        try {
            const playerLuck = updatedPlayer.luck || 0;
            const playerLevel = updatedPlayer.level || 1;
            const riskTier = riskProfile.tier;
            const coinDropResult = calculateCoinDrop({
                riskTier: riskTier,
                luck: playerLuck,
                playerLevel: playerLevel
            });
            if (coinDropResult) {
                coinDrop = coinDropResult.amount;
            }
        } catch (err) {
            logger.warn('Ошибка расчёта выпадения монет', { error: err.message });
        }

        // Вычисляем урон от радиации ВНЕ блока лута: здоровье теряется при
        // любом поиске, даже если лут не выпал. Значение уходит в setParts как $2.
        let radiationEffect = null;
        let radiationDamage = 0;

        if (resultingRadiationLevel >= 10) {
            radiationEffect = 'critical';
            radiationDamage = calculateRadiationDamage(resultingRadiationLevel, DEBUFF_CONFIG.radiation.damagePerLevel);
        } else if (resultingRadiationLevel >= 5) {
            radiationEffect = 'danger';
            radiationDamage = calculateRadiationDamage(resultingRadiationLevel, DEBUFF_CONFIG.radiation.damagePerLevel);
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

        // Монеты из поиска (если выпали)
        if (coinDrop) {
            params.push(coinDrop);
            setParts.push(`coins = COALESCE(coins, 0) + $${params.length}`);
        }
        
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
        const updateSql = `UPDATE players SET ${setParts.join(', ')} WHERE id = $${params.length} RETURNING energy, max_energy, last_energy_update, coins, health`;
        
        const energyResult = await client.query(updateSql, params);

        if (!energyResult.rows[0]) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        const newEnergy = energyResult.rows[0].energy;
        const newMaxEnergy = energyResult.rows[0].max_energy;
        const lastEnergyUpdate = energyResult.rows[0].last_energy_update;
        const newHealth = energyResult.rows[0].health;

        // Проверка смерти от радиации: если здоровье упало до 0, игрок погиб.
        if (newHealth <= 0) {
            return {
                status: 200,
                body: {
                    success: false,
                    error: 'Вы погибли от радиации в этой зоне. Нужно восстановить здоровье.',
                    code: 'PLAYER_DEAD_FROM_RADIATION',
                    health: 0,
                    max_health: updatedPlayer.max_health,
                    radiation: {
                        level: resultingRadiationLevel,
                        gained: radiationGain,
                        expires_at: radiationExpiresAt,
                        defense: contaminationDefense,
                        effect: radiationEffect
                    },
                    search_performed: true
                }
            };
        }

        // Обновление истощения локации: каждый поиск увеличивает exhaustion.
        // Истощение снижает шансы редкого лута, восстанавливается со временем.
        await client.query(
            `UPDATE locations SET exhaustion = LEAST(100, exhaustion + 5) WHERE id = $1`,
            [locationData.id]
        );

        // Pity timer: сбрасываем при находке предмета или ключа, иначе инкрементируем.
        const newStreak = (foundItem || foundKeyInfo) ? 0 : (emptyStreak + 1);
        await client.query(
            `UPDATE players SET empty_searches_streak = $1 WHERE id = $2`,
            [newStreak, playerId]
        );

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
                    last_update: lastEnergyUpdate,
                    coins: Number(energyResult.rows[0].coins || 0)
                },
                // Заражение зоной — одно. Инфекции объединены с радиацией,
                // поэтому отдельный блок infection больше не отдаётся:
                // весь «урон зоне» считается в radiation.
                radiation: {
                    level: resultingRadiationLevel,
                    gained: radiationGain,
                    expires_at: radiationExpiresAt,
                    defense: contaminationDefense,
                    effect: radiationEffect
                },
                risk_profile: {
                    tier: riskProfile.tier,
                    label: riskProfile.label,
                    score: riskProfile.riskScore,
                    contamination_threat: riskProfile.contaminationThreat,
                    contamination_defense: riskProfile.contaminationDefense,
                    contamination_pressure: riskProfile.contaminationPressure,
                    reward_multiplier: riskProfile.rewardMultiplier,
                    key_chance_multiplier: riskProfile.keyChanceMultiplier,
                    rarity_luck_bonus: riskProfile.rarityLuckBonus,
                    is_prepared: riskProfile.isPrepared
                },
                location: {
                    name: locationData.name,
                    // Данные мира, по ним клиент рисует карточку локации.
                    radiation: locationData.radiation,
                    exhaustion: locationData.exhaustion,
                    is_available: locationData.is_available
                },
                effective_luck: effectiveLuck,
                risk_adjusted_luck: riskAdjustedLuck,
                drop_chance: adjustedDropChance,
                rolled: rolled.toFixed(2),
                loot_rolled: lootRolled,
                pity_active: pityActive,
                exp_gained: expGained,
                coin_drop: coinDrop
            },
            // Данные для лога: нужны только при успешном поиске.
            log: {
                foundItemName: foundItem?.name || null,
                effectiveLuck,
                dropChance,
                locationId: locationData.id,
                coinDrop: coinDrop || null
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
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'Некорректное тело запроса',
            code: 'INVALID_REQUEST_BODY'
        });
    }
    const { location_id } = req.body;

    if (!req.player) {
        return unauthorized(res);
    }
    if (!req.player?.id) return unauthorized(res);
    const playerId = req.player?.id;
    const locationIdNum = Number(location_id);

    if (location_id === undefined || location_id === null) {
        return res.status(400).json({
            success: false,
            error: 'Укажите ID локации',
            code: 'MISSING_LOCATION_ID'
        });
    }

    if (!validateLocationId(locationIdNum)) {
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
            const player = await lockPlayer(playerId, client, 'id, level, current_location_id, energy, last_energy_update');

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

            await recalcEnergy(client, player);

            const targetLocation = await client.query(`
                SELECT id, name, radiation, description, min_level, danger_level, icon, is_available
                FROM locations WHERE id = $1
            `, [locationIdNum]);

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

            if (!locationData.is_available) {
                return {
                    status: 403,
                    body: {
                        success: false,
                        error: 'Эта локация сейчас недоступна для перехода',
                        code: 'LOCATION_UNAVAILABLE'
                    }
                };
            }

            const requiredLevel = Number(locationData.min_level || 1);
            if (Number(player.level || 0) < requiredLevel) {
                return {
                    status: 403,
                    body: {
                        success: false,
                        error: `Нужен уровень ${requiredLevel}+`,
                        code: 'INSUFFICIENT_LEVEL',
                        required_level: requiredLevel,
                        current_level: player.level
                    }
                };
            }

            // Перемещение стоит 1 энергии
            if (Number(player.energy || 0) < 1) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Недостаточно энергии для перемещения',
                        code: 'INSUFFICIENT_ENERGY',
                        energy: Number(player.energy || 0)
                    }
                };
            }

            await client.query(`
                UPDATE players
                   SET current_location_id = $1,
                       updated_at = NOW(),
                       energy = GREATEST(0, energy - 1),
                       -- locations_visited читает достижение «Путешественник»
                       -- (3 локации) и «Искатель» (7). Хранит объекты {id, name}.
                        locations_visited = (
                            SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
                              FROM jsonb_array_elements(
                                  COALESCE(locations_visited, '[]'::jsonb)
                                   || jsonb_build_array(jsonb_build_object('id', $1::integer, 'name', $3::text)))
                              AS t(value)
                        )
                 WHERE id = $2
           `, [locationIdNum, playerId, locationData.name]);

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
                            danger_level: locationData.danger_level || 1,
                            description: locationData.description
                        },
                        message: `Вы прибыли в ${locationData.name}`
                    }
                },
                log: {
                    fromLocationId: player.current_location_id,
                    toLocationId: locationIdNum
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

