/**
 * Мастерская: ремонт и улучшение снаряжения.
 *
 * До этого прочность и уровень улучшения были мёртвыми колонками items:
 * износ не происходил, а upgrade_level/max_upgrade_level/modifications никто
 * не читал. Теперь снаряжение изнашивается в бою (routes/game/bosses.js),
 * а здесь его можно починить и прокачать — это и даёт смысл материалам,
 * ради которых имеет смысл фармить лут.
 *
 * GET  /workshop          — состояние экипировки с ценами ремонта/улучшения
 *                         и списком доступных модификаций
 * POST /workshop/repair   — починить слот
 * POST /workshop/upgrade  — улучшить слот на 1 уровень
 * POST /workshop/modify   — установить модификацию (заточка/облицовка)
 */

const express = require('express');
const router = express.Router();
const { transaction: tx } = require('../../db/database');
const { handleError, logger } = require('../../utils/serverApi');
const { equipmentRules, normalizeEquipment, normalizeInventory } = require('../../utils/game-helpers');

const VALID_SLOTS = equipmentRules.COMBAT_SLOTS;

function isValidSlot(slot) {
    return VALID_SLOTS.includes(String(slot));
}

/**
 * Разрешить имена материалов в строки каталога items.
 * @returns {Promise<Map<string, object>>} имя -> строка items
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

/** Описание одного слота для UI: прочность, цена ремонта, цена улучшения */
function describeSlot(slot, item) {
    if (!item) return null;

    const durability = equipmentRules.getDurabilityInfo(item);

    return {
        slot,
        item: {
            id: item.id ?? null,
            name: item.name || 'Предмет',
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
 * Модификации предмета для UI.
 *
 * Колонка items.modifications была мёртвой — теперь её читает бой
 * (getEffectiveStatValue) и эта панель. Возвращаем только применимые
 * предмету модификации, чтобы кнопки не предлагали «Заточку» броне.
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

/** Сколько материалов (material/ammo) лежит в инвентаре */
function summarizeMaterials(inventory) {
    const counts = {};
    for (const item of Array.isArray(inventory) ? inventory : []) {
        const category = String(item.category || item.type || '').toLowerCase();
        if (!['material', 'ammo'].includes(category)) continue;
        const name = item.name || 'Предмет';
        counts[name] = (counts[name] || 0) + Math.max(1, Number(item.quantity || 1));
    }
    return counts;
}

/**
 * GET /api/game/workshop — что надето, сколько стоит починка и апгрейд.
 */
router.get('/', async (req, res) => {
    try {
        const player = await tx(async (client) => {
            const result = await client.query(
                'SELECT coins, equipment, inventory FROM players WHERE id = $1',
                [req.player.id]
            );
            return result.rows[0] || null;
        });

        if (!player) {
            return res.status(404).json({ success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' });
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
            materials: summarizeMaterials(player.inventory)
        });
    } catch (error) {
        return handleError(res, error, 'workshop_view');
    }
});
/**
 * POST /api/game/workshop/repair — восстановить прочность слота.
 * Стоимость: половина цены предмета за полный износ
 * (calculateRepairCost в public/shared/equipment.js).
 */
router.post('/repair', async (req, res) => {
    try {
        const slot = String(req.body?.slot || '');
        if (!isValidSlot(slot)) {
            return res.status(400).json({ success: false, error: 'Укажите корректный слот', code: 'INVALID_SLOT' });
        }

        const result = await tx(async (client) => {
            const playerResult = await client.query(
                'SELECT coins, equipment FROM players WHERE id = $1 FOR UPDATE',
                [req.player.id]
            );
            const player = playerResult.rows[0];
            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: 'В этом слоте ничего нет', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const cost = equipmentRules.calculateRepairCost(item);
            if (cost <= 0) {
                throw { message: 'Предмет не изношен', code: 'NOT_BROKEN', statusCode: 400 };
            }
            if (Number(player.coins || 0) < cost) {
                throw {
                    message: `Недостаточно монет. Нужно ${cost}, у вас ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const durability = equipmentRules.getDurabilityInfo(item);
            equipment[slot] = { ...item, durability: durability.max };

            await client.query(
                'UPDATE players SET coins = coins - $1, equipment = $2::jsonb WHERE id = $3',
                [cost, JSON.stringify(equipment), req.player.id]
            );

            return {
                success: true,
                message: `${item.name || 'Предмет'} отремонтирован`,
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
        return handleError(res, error, 'workshop_repair');
    }
});
/**
 * POST /api/game/workshop/upgrade — +1 уровень улучшения.
 * Каждый уровень даёт +8% к урону/защите, максимум 10.
 * Цена: монеты + материал по редкости (+ патроны для стрелкового оружия).
 */
router.post('/upgrade', async (req, res) => {
    try {
        const slot = String(req.body?.slot || '');
        if (!isValidSlot(slot)) {
            return res.status(400).json({ success: false, error: 'Укажите корректный слот', code: 'INVALID_SLOT' });
        }

        const result = await tx(async (client) => {
            const playerResult = await client.query(
                'SELECT coins, equipment, inventory FROM players WHERE id = $1 FOR UPDATE',
                [req.player.id]
            );
            const player = playerResult.rows[0];
            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: 'В этом слоте ничего нет', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const cost = equipmentRules.calculateUpgradeCost(item);
            if (!cost) {
                throw {
                    message: `Максимальный уровень улучшения: ${equipmentRules.MAX_UPGRADE_LEVEL}`,
                    code: 'MAX_UPGRADE_LEVEL',
                    statusCode: 400
                };
            }
            if (Number(player.coins || 0) < cost.coins) {
                throw {
                    message: `Недостаточно монет. Нужно ${cost.coins}, у вас ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const materials = await loadMaterials(client, Object.keys(cost.materials));
            const inventory = normalizeInventory(player.inventory);

            // Сначала проверяем весь список: нельзя списать часть материалов
            // и упасть на нехватке следующего.
            for (const [name, required] of Object.entries(cost.materials)) {
                const material = materials.get(name);
                if (!material) {
                    logger.warn('[workshop] Материал улучшения отсутствует в каталоге', { name });
                    throw { message: `Материал «${name}» недоступен`, code: 'MATERIAL_MISSING', statusCode: 500 };
                }

                const owned = inventory
                    .filter((entry) => entry.id === material.id)
                    .reduce((sum, entry) => sum + Math.max(1, Number(entry.quantity || 1)), 0);

                if (owned < required) {
                    throw {
                        message: `Не хватает материала «${name}»: нужно ${required}, есть ${owned}`,
                        code: 'INSUFFICIENT_MATERIALS',
                        statusCode: 400,
                        material: name,
                        required,
                        owned
                    };
                }
            }

            for (const [name, required] of Object.entries(cost.materials)) {
                const material = materials.get(name);
                let left = required;
                for (let i = 0; i < inventory.length && left > 0; i++) {
                    if (inventory[i].id !== material.id) continue;

                    const have = Math.max(1, Number(inventory[i].quantity || 1));
                    const take = Math.min(have, left);
                    left -= take;
                    if (take >= have) {
                        inventory.splice(i, 1);
                        i--;
                    } else {
                        inventory[i] = { ...inventory[i], quantity: have - take };
                    }
                }
            }

            equipment[slot] = {
                ...item,
                upgrade_level: cost.next_level,
                // Улучшили — прочность восстанавливается полностью.
                durability: equipmentRules.getDurabilityInfo(item).max
            };

            await client.query(
                'UPDATE players SET coins = coins - $1, equipment = $2::jsonb, inventory = $3 WHERE id = $4',
                [cost.coins, JSON.stringify(equipment), JSON.stringify(inventory), req.player.id]
            );

            const upgraded = equipment[slot];
            return {
                success: true,
                message: `${item.name || 'Предмет'} улучшен до +${cost.next_level}`,
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
        return handleError(res, error, 'workshop_upgrade');
    }
});

/**
 * POST /api/game/workshop/modify — установить модификацию на слот.
 * body: { slot, modification: 'sharpening' | 'plating' }
 *
 * Модификация даёт ПЛОСКИЙ бонус (Заточка +4 урона за уровень, Облицовка
 * +3 защиты), максимум 3 уровня. Материалы: у оружия — металл и провода,
 * у брони — дерево, ткань и пластик.
 */
router.post('/modify', async (req, res) => {
    try {
        const slot = String(req.body?.slot || '');
        const modification = String(req.body?.modification || '');

        if (!isValidSlot(slot)) {
            return res.status(400).json({ success: false, error: 'Укажите корректный слот', code: 'INVALID_SLOT' });
        }
        if (!equipmentRules.MODIFICATIONS[modification]) {
            return res.status(400).json({ success: false, error: 'Неизвестная модификация', code: 'INVALID_MODIFICATION' });
        }

        const result = await tx(async (client) => {
            const playerResult = await client.query(
                'SELECT coins, equipment, inventory FROM players WHERE id = $1 FOR UPDATE',
                [req.player.id]
            );
            const player = playerResult.rows[0];
            if (!player) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: 'В этом слоте ничего нет', code: 'SLOT_EMPTY', statusCode: 400 };
            }
            if (!equipmentRules.isModificationApplicable(item, modification)) {
                throw {
                    message: `«${equipmentRules.MODIFICATIONS[modification].name}» не подходит этому предмету`,
                    code: 'MODIFICATION_NOT_APPLICABLE',
                    statusCode: 400
                };
            }

            const cost = equipmentRules.calculateModificationCost(item, modification);
            if (!cost) {
                throw {
                    message: `Максимальный уровень модификации: ${equipmentRules.MAX_MODIFICATION_LEVEL}`,
                    code: 'MAX_MODIFICATION_LEVEL',
                    statusCode: 400
                };
            }
            if (Number(player.coins || 0) < cost.coins) {
                throw {
                    message: `Недостаточно монет. Нужно ${cost.coins}, у вас ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const inventory = normalizeInventory(player.inventory);
            const materials = await loadMaterials(client, Object.keys(cost.materials));

            for (const [name, required] of Object.entries(cost.materials)) {
                const material = materials.get(name);
                if (!material) {
                    logger.warn('[workshop] Материал модификации отсутствует в каталоге', { name });
                    throw { message: `Материал «${name}» недоступен`, code: 'MATERIAL_MISSING', statusCode: 500 };
                }

                const owned = inventory
                    .filter((entry) => entry.id === material.id)
                    .reduce((sum, entry) => sum + Math.max(1, Number(entry.quantity || 1)), 0);

                if (owned < required) {
                    throw {
                        message: `Не хватает материала «${name}»: нужно ${required}, есть ${owned}`,
                        code: 'INSUFFICIENT_MATERIALS',
                        statusCode: 400,
                        material: name,
                        required,
                        owned
                    };
                }
            }

// Списываем материалы пачками (проверка выше гарантирует, что хватит).
            for (const [name, required] of Object.entries(cost.materials)) {
                const material = materials.get(name);
                let left = required;
                for (let i = 0; i < inventory.length && left > 0; i++) {
                    if (inventory[i].id !== material.id) continue;

                    const have = Math.max(1, Number(inventory[i].quantity || 1));
                    const take = Math.min(have, left);
                    left -= take;
                    if (take >= have) {
                        inventory.splice(i, 1);
                        i--;
                    } else {
                        inventory[i] = { ...inventory[i], quantity: have - take };
                    }
                }
            }

            const modifications = {
                ...(item.modifications && typeof item.modifications === 'object' ? item.modifications : {}),
                [modification]: cost.next_level
            };
            equipment[slot] = { ...item, modifications };

            await client.query(
                'UPDATE players SET coins = coins - $1, equipment = $2::jsonb, inventory = $3 WHERE id = $4',
                [cost.coins, JSON.stringify(equipment), JSON.stringify(inventory), req.player.id]
            );

            const modified = equipment[slot];
            return {
                success: true,
                message: `${item.name || 'Предмет'}: ${equipmentRules.MODIFICATIONS[modification].name} +${cost.next_level}`,
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
        return handleError(res, error, 'workshop_modify');
    }
});

module.exports = router;