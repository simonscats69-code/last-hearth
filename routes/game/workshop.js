/**
 * Мастерская: работа с инвентарем и экипировкой.
 *
 * Взаимодействие с инвентарём и экипировкой через общие хелперы (routes/game/bosses.js).
 * Ремонт, утилизация, улучшение и модификация предметов (POST-запросы).
 * Для хранения инвентаря используется отдельная таблица player_inventory (через syncInventoryToTable).
 */

const express = require('express');
const router = express.Router();
const { transaction, query } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { handleError, handleConnectionError, logger, notFound, fail, unauthorized } = require('../../utils/serverApi');
const { playerIdGuard, handleRouteError } = require('../../utils/routeHelpers');


// Ленивая загрузка helpers: utils/game-helpers.js — источник правды для equipmentRules/normalizeEquipment/normalizeInventory.
// @last-hearth/core (TS-типы) не используется, только game-helpers.
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../../utils/game-helpers');
    }
    return gameHelpers;
}

const helpers = getGameHelpers();
const { equipmentRules, normalizeEquipment, normalizeInventory } = helpers;

const VALID_SLOTS = equipmentRules.COMBAT_SLOTS;

function isValidSlot(slot) {
    if (typeof slot !== 'string') return false;
    return VALID_SLOTS.includes(slot);
}

/**
 * Загрузка данных о предметах по именам из списка items.
 * @returns {Promise<Map<string, object>>} имя -> данные предмета
 */
async function loadMaterials(client, names) {
    if (!Array.isArray(names) || names.length === 0) return new Map();
    const rows = await client.query(
        `SELECT id, name, type, category, rarity, icon, stackable, max_stack, stats
           FROM items WHERE name = ANY($1::text[])`,
        [names]
    );
    return new Map(rows.rows.map((row) => [row.name, row]));
}

/**
 * Описание слота для UI: название, прочность, стоимость ремонта.
 */
function describeSlot(slot, item) {
    if (!item) return null;

    const durability = equipmentRules.getDurabilityInfo(item);

    return {
        slot,
        item: {
            id: item.id ?? null,
            name: item.name || 'Неизвестно',
            icon: item.icon || '📦',
            rarity: item.rarity || 'common',
            category: item.category || item.type || null,
            stats: item.stats || {},
            set_id: item.set_id ?? null,
            price: Number(item.price || 0),
            upgrade_level: equipmentRules.getUpgradeLevel(item)
        },
        durability: {
            current: durability.current,
            max: durability.max,
            is_broken: durability.isBroken,
            percent: Math.round(durability.ratio * 100)
        },
        repair_cost: equipmentRules.calculateRepairCost(item),
        upgrade_cost: equipmentRules.calculateUpgradeCost(item),
        modifications: describeModifications(item)
    };
}

/**
 * Описание модификаций предмета для UI.
 *
 * Все items.modifications ключи проходят через getEffectiveStatValue.
 * Чтобы избежать дублирования, каждая модификация описывается один раз
 * со своим названием, иконкой и текущим уровнем.
 */
function describeModifications(item) {
    const list = [];
    for (const modification of Object.values(equipmentRules.MODIFICATIONS)) {
        if (!equipmentRules.isModificationApplicable(item, modification.key)) continue;

        list.push({
            key: modification.key,
            name: modification.name,
            icon: modification.icon,
            stat: modification.stat,
            per_level: modification.perLevel,
            level: equipmentRules.getModificationLevel(item, modification.key),
            max_level: equipmentRules.MAX_MODIFICATION_LEVEL,
            cost: equipmentRules.calculateModificationCost(item, modification.key)
        });
    }
    return list;
}

/**
 * Сводка материалов/боеприпасов в инвентаре.
 */
function summarizeMaterials(inventory) {
    const counts = {};
    for (const item of Array.isArray(inventory) ? inventory : []) {
        const category = String(item.category || item.type || '').toLowerCase();
        if (!['material', 'ammo'].includes(category)) continue;
        const name = item.name || 'Неизвестно';
        counts[name] = (counts[name] || 0) + Math.max(0, Number(item.quantity || 1));
    }
    return counts;
}

/**
 * GET /api/game/workshop — получение состояния мастерской, слотов и материалов.
 */
router.get('/', async (req, res) => {
    try {
        if (!playerIdGuard(req, res)) return;

        const playerResult = await query(
            'SELECT coins, equipment, inventory FROM players WHERE id = $1',
            [req.player.id]
        );
        const player = playerResult.rows[0] || null;

        if (!player) {
            return notFound(res, 'Игрок не найден', 'PLAYER_NOT_FOUND');
        }

        const equipment = normalizeEquipment(player.equipment);
        const slots = VALID_SLOTS
            .map((slot) => describeSlot(slot, equipment[slot]))
            .filter(Boolean);

        return res.json({
            success: true,
            coins: Number(player.coins || 0),
            max_upgrade_level: equipmentRules.MAX_UPGRADE_LEVEL,
            slots,
            materials: summarizeMaterials(normalizeInventory(player.inventory))
        });
    } catch (error) {
        return handleRouteError(res, error, 'workshop_view', req.playerId);
    }
});

/**
 * POST /api/game/workshop/repair — ремонт одного слота экипировки.
 * Броня и оружие: только для предметов с прочностью < max.
 * (calculateRepairCost из public/shared/equipment.js).
 */
router.post('/repair', async (req, res) => {
    if (!playerIdGuard(req, res)) return;
    try {
        const slot = String(req.body?.slot || '');
        if (!isValidSlot(slot)) {
            return fail(res, 'Неверный слот', 'INVALID_SLOT');
        }

        const result = await transaction(async (client) => {
            const player = await lockPlayer(req.player?.id, client, 'coins, equipment');

            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: 'В слоте нет предмета', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const cost = equipmentRules.calculateRepairCost(item);
            if (!Number.isFinite(cost) || cost <= 0) {
                throw { message: 'Предмет не сломан', code: 'NOT_BROKEN', statusCode: 400 };
            }
            if (Number(player.coins || 0) < cost) {
                throw {
                    message: `Недостаточно монет. Нужно ${cost}, есть ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const durability = equipmentRules.getDurabilityInfo(item);
            equipment[slot] = { ...item, durability: durability.max };

            await client.query(
                'UPDATE players SET coins = COALESCE(coins,0) - $1, equipment = $2::jsonb WHERE id = $3',
                [cost, JSON.stringify(equipment), req.player.id]
            );

            return {
                success: true,
                message: `${item.name || 'Неизвестно'} отремонтировано.`,
                slot,
                coins_spent: cost,
                coins_total: Number(player.coins || 0) - cost,
                durability: describeSlot(slot, equipment[slot]).durability
            };
        });

        return res.json(result);
    } catch (error) {
        if (['SLOT_EMPTY', 'NOT_BROKEN', 'INSUFFICIENT_COINS', 'PLAYER_NOT_FOUND'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        if (handleConnectionError(res, error)) return;
        return handleError(res, error, 'workshop_repair');
    }
});

/**
 * POST /api/game/workshop/repair-all — ремонт всех сломанных предметов экипировки.
 * Глобальная прочность: после ремонта durability становится max для всех вещей.
 */
router.post('/repair-all', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);

        const result = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'coins, equipment');
            if (!player) return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };

            const equipment = normalizeEquipment(player.equipment);
            const slots = Object.keys(equipment);
            if (slots.length === 0) {
                return { status: 400, body: { success: false, error: 'Нет экипировки для ремонта', code: 'NO_EQUIPMENT' } };
            }

            let totalCost = 0;
            const repairedSlots = [];
            for (const slot of slots) {
                const item = equipment[slot];
                if (!item) continue;
                const cost = equipmentRules.calculateRepairCost(item);
                if (cost > 0) {
                    totalCost += cost;
                    repairedSlots.push(slot);
                }
            }

            if (totalCost === 0) {
                return { status: 200, body: { success: true, data: { total_cost: 0, repaired: [], message: 'Нет предметов для ремонта' } } };
            }

            if (Number(player.coins || 0) < totalCost) {
                return { status: 400, body: { success: false, error: 'Недостаточно монет', code: 'NOT_ENOUGH_COINS', data: { total_cost: totalCost, coins: Number(player.coins || 0) } } };
            }

            for (const slot of repairedSlots) {
                const item = equipment[slot];
                const info = equipmentRules.getDurabilityInfo(item);
                item.durability = info.max;
                equipment[slot] = item;
            }

            await client.query(
                'UPDATE players SET coins = COALESCE(coins,0) - $1, equipment = $2::jsonb WHERE id = $3',
                [totalCost, JSON.stringify(equipment), playerId]
            );

            // Синхронизация инвентаря в отдельную таблицу player_inventory.
            await helpers.syncInventoryToTable(client, playerId, normalizeInventory(player.inventory));

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        total_cost: totalCost,
                        repaired: repairedSlots,
                        message: 'Отремонтировано ' + repairedSlots.length + ' предметов на ' + totalCost + ' монет'
                    }
                }
            };
        });

        res.status(result.status).json(result.body);
    } catch (error) {
        handleRouteError(res, error, 'workshop_repair_all', req.playerId);
    }
});

/**
 * POST /api/game/workshop/scrap-all — утилизация всех сломанных предметов экипировки в материалы.
 */
router.post('/scrap-all', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);

        const result = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'coins, inventory');
            if (!player) return { status: 404, body: { success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' } };

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, req.player?.id) || normalizeInventory(player.inventory);
            const toScrap = inventory.filter((item) => {
                if (!item || !equipmentRules.isEquipmentItem(item)) return false;
                const info = equipmentRules.getDurabilityInfo(item);
                return info.isBroken;
            });

            if (toScrap.length === 0) {
                return { status: 200, body: { success: true, data: { scrapped: 0, materials: {}, message: 'Нет сломанных предметов для утилизации' } } };
            }

            // Расчёт выпадающих материалов.
            const gainedMaterials = {};
            for (const item of toScrap) {
                const yield_ = equipmentRules.calculateScrapYield(item);
                for (const [mat, qty] of Object.entries(yield_)) {
                    gainedMaterials[mat] = (gainedMaterials[mat] || 0) + qty;
                }
            }

            // Оставшиеся предметы после удаления сломанных.
            const remaining = inventory.filter((item) => {
                if (!item || !equipmentRules.isEquipmentItem(item)) return true;
                const info = equipmentRules.getDurabilityInfo(item);
                return !info.isBroken;
            });

            // Проверка, хватит ли мест для новых материалов.
            // Считаем реальные слоты, которые добавятся (с учётом стакования),
            // а не количество имён материалов: иначе при большом количестве
            // разных материалов проверка завышалася.
            const projected = inventory.slice();
            for (const [mat, qty] of Object.entries(gainedMaterials)) {
                helpers.addItemToInventory(projected, { name: mat, type: 'resource', category: 'material', rarity: 'common', icon: '📦', quantity: qty, durability: 100, max_durability: 100 }, null);
            }

            const slotsNeeded = Math.max(0, projected.length - inventory.length);
            if (slotsNeeded > 0) {
                return { status: 400, body: { success: false, error: 'Инвентарь переполнен', code: 'INVENTORY_FULL' } };
            }

            // Добавление материалов в инвентарь.
            for (const [mat, qty] of Object.entries(gainedMaterials)) {
                helpers.addItemToInventory(remaining, { name: mat, type: 'resource', category: 'material', rarity: 'common', icon: '📦', quantity: qty, durability: 100, max_durability: 100 }, null);
            }

            await helpers.syncInventoryToTable(client, playerId, remaining);

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        scrapped: toScrap.length,
                        materials: gainedMaterials,
                        message: 'Утилизировано ' + toScrap.length + ' предметов'
                    }
                }
            };
        });

        res.status(result.status).json(result.body);
    } catch (error) {
        handleRouteError(res, error, 'workshop_scrap_all', req.playerId);
    }
});

/**
 * POST /api/game/workshop/upgrade — улучшение предмета на +1 уровень.
 * Требует монет и материалов. Максимальный уровень — equipmentRules.MAX_UPGRADE_LEVEL.
 */
router.post('/upgrade', async (req, res) => {
    if (!playerIdGuard(req, res)) return;
    try {
        const slot = String(req.body?.slot || '');
        if (!isValidSlot(slot)) {
            return fail(res, 'Неверный слот', 'INVALID_SLOT');
        }

        const result = await transaction(async (client) => {
            const player = await lockPlayer(req.player?.id, client, 'coins, equipment, inventory');

            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: 'В слоте нет предмета', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const cost = equipmentRules.calculateUpgradeCost(item);
            if (!cost || typeof cost !== 'object') {
                throw {
                    message: `Достигнут максимальный уровень улучшения: ${equipmentRules.MAX_UPGRADE_LEVEL}`,
                    code: 'MAX_UPGRADE_LEVEL',
                    statusCode: 400
                };
            }
            if (Number(player.coins || 0) < cost.coins) {
                throw {
                    message: `Недостаточно монет. Нужно ${cost.coins}, есть ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const materials = await loadMaterials(client, Object.keys(cost.materials || {}));
            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, req.player?.id) || normalizeInventory(player.inventory);

            // Проверка наличия материалов в инвентаре.
            for (const [name, required] of Object.entries(cost.materials || {})) {
                const material = materials.get(name);
                if (!material) {
                    logger.warn('[workshop] Предмет не найден в таблице items для материала', { name });
                    throw { message: `Предмет «${name}» не найден в базе`, code: 'MATERIAL_MISSING', statusCode: 500 };
                }

                const owned = inventory
                    .filter((entry) => Number(entry.id) === Number(material.id)
                        || (entry.id == null && String(entry.name || '').toLowerCase() === String(material.name || '').toLowerCase()))
                    .reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity || 1)), 0);

                if (owned < required) {
                    throw {
                        message: `Недостаточно предмета «${name}»: нужно ${required}, есть ${owned}`,
                        code: 'INSUFFICIENT_MATERIALS',
                        statusCode: 400,
                        material: name,
                        required,
                        owned
                    };
                }
            }

            // Списывание материалов из инвентаря.
            // Сначала по id, затем по имени: предметы с null-id (ручные,
            // после миграции) не игнорируются, иначе материал есть — но не списывается.
            for (const [name, required] of Object.entries(cost.materials || {})) {
                const material = materials.get(name);
                let left = required;
                for (let i = 0; i < inventory.length && left > 0; i++) {
                    const entry = inventory[i];
                    const matches = Number(entry.id) === Number(material.id)
                        || (entry.id == null && String(entry.name || '').toLowerCase() === String(material.name || '').toLowerCase());
                    if (!matches) continue;

                    const have = Math.max(0, Number(entry.quantity || 1));
                    const take = Math.min(have, left);
                    left -= take;
                    if (take >= have) {
                        inventory.splice(i, 1);
                        i--;
                    } else {
                        inventory[i] = { ...entry, quantity: have - take };
                    }
                }
            }

            equipment[slot] = {
                ...item,
                upgrade_level: cost.next_level,
                // Полная прочность после улучшения.
                durability: equipmentRules.getDurabilityInfo(item).max
            };

            await client.query(
                'UPDATE players SET coins = COALESCE(coins,0) - $1, equipment = $2::jsonb WHERE id = $3',
                [cost.coins, JSON.stringify(equipment), req.player.id]
            );

            // Синхронизация обновлённого инвентаря в отдельную таблицу player_inventory.
            await helpers.syncInventoryToTable(client, req.player.id, inventory);

            const upgraded = equipment[slot];
            return {
                success: true,
                message: `${item.name || 'Неизвестно'} улучшен до +${cost.next_level}`,
                slot,
                upgrade_level: cost.next_level,
                coins_spent: cost.coins,
                coins_total: Number(player.coins || 0) - cost.coins,
                materials_spent: cost.materials,
                damage: equipmentRules.getEffectiveStatValue(upgraded, ['damage']),
                defense: equipmentRules.getEffectiveStatValue(upgraded, ['defense'])
            };
        });

        return res.json(result);
    } catch (error) {
        const codes = ['SLOT_EMPTY', 'MAX_UPGRADE_LEVEL', 'INSUFFICIENT_COINS', 'INSUFFICIENT_MATERIALS', 'MATERIAL_MISSING', 'PLAYER_NOT_FOUND'];
        if (codes.includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        if (handleConnectionError(res, error)) return;
        return handleError(res, error, 'workshop_upgrade');
    }
});

/**
 * POST /api/game/workshop/modify — модификация предмета (заточка / броня).
 * body: { slot, modification: 'sharpening' | 'plating' }
 *
 * Уровень модификации ограничен MAX_MODIFICATION_LEVEL.
 * Материалы списываются по такому же принципу, что и в улучшении.
 */
router.post('/modify', async (req, res) => {
    if (!playerIdGuard(req, res)) return;
    try {
        const slot = String(req.body?.slot || '');
        const modification = String(req.body?.modification || '');

        if (!isValidSlot(slot)) {
            return fail(res, 'Неверный слот', 'INVALID_SLOT');
        }
        if (!Object.prototype.hasOwnProperty.call(equipmentRules.MODIFICATIONS, modification) || !equipmentRules.MODIFICATIONS[modification]) {
            return res.status(400).json({ success: false, error: 'Неверная модификация', code: 'INVALID_MODIFICATION' });
        }

        const result = await transaction(async (client) => {
            const player = await lockPlayer(req.player?.id, client, 'coins, equipment, inventory');

            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: 'В слоте нет предмета', code: 'SLOT_EMPTY', statusCode: 400 };
            }
            if (!equipmentRules.isModificationApplicable(item, modification)) {
                throw {
                    message: `Модификация «${equipmentRules.MODIFICATIONS[modification].name}» не применима к предмету`,
                    code: 'MODIFICATION_NOT_APPLICABLE',
                    statusCode: 400
                };
            }

            const cost = equipmentRules.calculateModificationCost(item, modification);
            if (!cost || typeof cost !== 'object') {
                throw {
                    message: `Достигнут максимальный уровень модификации: ${equipmentRules.MAX_MODIFICATION_LEVEL}`,
                    code: 'MAX_MODIFICATION_LEVEL',
                    statusCode: 400
                };
            }
            if (Number(player.coins || 0) < cost.coins) {
                throw {
                    message: `Недостаточно монет. Нужно ${cost.coins}, есть ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, req.player?.id) || normalizeInventory(player.inventory);
            const materials = await loadMaterials(client, Object.keys(cost.materials || {}));

            for (const [name, required] of Object.entries(cost.materials || {})) {
                const material = materials.get(name);
                if (!material) {
                    logger.warn('[workshop] Предмет не найден в таблице items для модификации', { name });
                    throw { message: `Предмет «${name}» не найден в базе`, code: 'MATERIAL_MISSING', statusCode: 500 };
                }

                const owned = inventory
                    .filter((entry) => Number(entry.id) === Number(material.id)
                        || (entry.id == null && String(entry.name || '').toLowerCase() === String(material.name || '').toLowerCase()))
                    .reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity || 1)), 0);

                if (owned < required) {
                    throw {
                        message: `Недостаточно предмета «${name}»: нужно ${required}, есть ${owned}`,
                        code: 'INSUFFICIENT_MATERIALS',
                        statusCode: 400,
                        material: name,
                        required,
                        owned
                    };
                }
            }

            // Списывание материалов из инвентаря.
            // Сначала по id, затем по имени: предметы с null-id (ручные,
            // после миграции) не игнорируются, иначе материал есть — но не списывается.
            for (const [name, required] of Object.entries(cost.materials || {})) {
                const material = materials.get(name);
                let left = required;
                for (let i = 0; i < inventory.length && left > 0; i++) {
                    const entry = inventory[i];
                    const matches = Number(entry.id) === Number(material.id)
                        || (entry.id == null && String(entry.name || '').toLowerCase() === String(material.name || '').toLowerCase());
                    if (!matches) continue;

                    const have = Math.max(0, Number(entry.quantity || 1));
                    const take = Math.min(have, left);
                    left -= take;
                    if (take >= have) {
                        inventory.splice(i, 1);
                        i--;
                    } else {
                        inventory[i] = { ...entry, quantity: have - take };
                    }
                }
            }

            const modifications = {
                ...(item.modifications && typeof item.modifications === 'object' ? item.modifications : {}),
                [modification]: cost.next_level
            };
            equipment[slot] = { ...item, modifications };

            await client.query(
                'UPDATE players SET coins = COALESCE(coins,0) - $1, equipment = $2::jsonb WHERE id = $3',
                [cost.coins, JSON.stringify(equipment), req.player.id]
            );

            // Синхронизация обновлённого инвентаря в отдельную таблицу player_inventory.
            await helpers.syncInventoryToTable(client, req.player.id, inventory);

            const modified = equipment[slot];
            return {
                success: true,
                message: `${item.name || 'Неизвестно'}: ${equipmentRules.MODIFICATIONS[modification].name} +${cost.next_level}`,
                slot,
                modification,
                level: cost.next_level,
                coins_spent: cost.coins,
                coins_total: Number(player.coins || 0) - cost.coins,
                materials_spent: cost.materials,
                damage: equipmentRules.getEffectiveStatValue(modified, ['damage']),
                defense: equipmentRules.getEffectiveStatValue(modified, ['defense'])
            };
        });

        return res.json(result);
    } catch (error) {
        const codes = [
            'SLOT_EMPTY', 'MODIFICATION_NOT_APPLICABLE', 'MAX_MODIFICATION_LEVEL',
            'INSUFFICIENT_COINS', 'INSUFFICIENT_MATERIALS', 'MATERIAL_MISSING', 'PLAYER_NOT_FOUND'
        ];
        if (codes.includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        if (handleConnectionError(res, error)) return;
        return handleError(res, error, 'workshop_modify');
    }
});

module.exports = router;


