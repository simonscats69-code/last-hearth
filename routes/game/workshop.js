/**
 * 0AB5@A:0O: @5<>=B 8 C;CGH5=85 A=0@O65=8O.
 * 
 * @>G=>ABL 8 C@>25=L C;CGH5=8O 87=0H820NBAO 2 1>N (routes/game/bosses.js).
 * 45AL: ?>G8=8BL, C;CGH8BL, CAB0=>28BL <>48D8:0F8N (70B>G:0/>1;8F>2:0).
 * -B> 40QB A<KA; <0B5@80;0<, @048 :>B>@KE 8<55B A<KA; D0@<8BL ;CB.
 */

const express = require('express');
const router = express.Router();
const { transaction, query } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { handleError, handleConnectionError, logger, notFound, fail, unauthorized } = require('../../utils/serverApi');
const { playerIdGuard, handleRouteError } = require('../../utils/routeHelpers');
const { setPlayerInventory } = require('../../db/playerRepository');

// 5=820O 703@C7:0 helpers: utils/game-helpers.js  548=AB25==K9 8AB>G=8:
// ?@024K 4;O equipmentRules/normalizeEquipment/normalizeInventory.
// @last-hearth/core (TS-<>4C;L) =5 M:A?>@B8@C5B MB8 DC=:F88.
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
 *  07@5H8BL 8<5=0 <0B5@80;>2 2 AB@>:8 :0B0;>30 items.
 * @returns {Promise<Map<string, object>>} 8<O -> AB@>:0 items
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

/** ?8A0=85 >4=>3> A;>B0 4;O UI: ?@>G=>ABL, F5=0 @5<>=B0, F5=0 C;CGH5=8O */
function describeSlot(slot, item) {
    if (!item) return null;

    const durability = equipmentRules.getDurabilityInfo(item);

    return {
        slot,
        item: {
            id: item.id ?? null,
            name: item.name || '@54<5B',
            icon: item.icon || '=пїЅ',
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
 * >48D8:0F88 ?@54<5B0 4;O UI.
 *
 * >;>=:0 items.modifications 1K;0 <Q@B2>9  B5?5@L 5Q G8B05B 1>9
 * (getEffectiveStatValue) 8 MB0 ?0=5;L. >72@0I05< B>;L:> ?@8<5=8<K5
 * ?@54<5BC <>48D8:0F88, GB>1K :=>?:8 =5 ?@54;030;8 пїЅ0B>G:CпїЅ 1@>=5.
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

/** !:>;L:> <0B5@80;>2 (material/ammo) ;568B 2 8=25=B0@5 */
function summarizeMaterials(inventory) {
    const counts = {};
    for (const item of Array.isArray(inventory) ? inventory : []) {
        const category = String(item.category || item.type || '').toLowerCase();
        if (!['material', 'ammo'].includes(category)) continue;
        const name = item.name || '@54<5B';
        counts[name] = (counts[name] || 0) + Math.max(0, Number(item.quantity || 1));
    }
    return counts;
}

/**
 * GET /api/game/workshop  GB> =045B>, A:>;L:> AB>8B ?>G8=:0 8 0?3@594.
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
            return notFound(res, '3@>: =5 =0945=', 'PLAYER_NOT_FOUND');
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
 * POST /api/game/workshop/repair  2>AAB0=>28BL ?@>G=>ABL A;>B0.
 * !B>8<>ABL: ?>;>28=0 F5=K ?@54<5B0 70 ?>;=K9 87=>A
 * (calculateRepairCost 2 public/shared/equipment.js).
 */
router.post('/repair', async (req, res) => {
    if (!playerIdGuard(req, res)) return;
    try {
        const slot = String(req.body?.slot || '');
        if (!isValidSlot(slot)) {
            return fail(res, '#:068B5 :>@@5:B=K9 A;>B', 'INVALID_SLOT');
        }

        const result = await transaction(async (client) => {
            const player = await lockPlayer(req.player?.id, client, 'coins, equipment');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: ' MB>< A;>B5 =8G53> =5B', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const cost = equipmentRules.calculateRepairCost(item);
            if (!Number.isFinite(cost) || cost <= 0) {
                throw { message: '@54<5B =5 87=>H5=', code: 'NOT_BROKEN', statusCode: 400 };
            }
            if (Number(player.coins || 0) < cost) {
                throw {
                    message: `54>AB0B>G=> <>=5B. C6=> ${cost}, C 20A ${player.coins}`,
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
                message: `${item.name || '@54<5B'} >B@5<>=B8@>20=`,
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
 * POST /api/game/workshop/repair-all  ?>G8=8BL 2A5 A;><0==K5/87=>H5==K5 ?@54<5BK M:8?8@>2:8.
 * !G8B05B >1ICN AB>8<>ABL 8 2>AAB0=02;8205B durability 4> max 4;O 2A5E A;>B>2.
 */
router.post('/repair-all', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);

        const result = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'coins, equipment');
            if (!player) return { status: 404, body: { success: false, error: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND' } };

            const equipment = normalizeEquipment(player.equipment);
            const slots = Object.keys(equipment);
            if (slots.length === 0) {
                return { status: 400, body: { success: false, error: '5B M:8?8@>2:8 4;O @5<>=B0', code: 'NO_EQUIPMENT' } };
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
                return { status: 200, body: { success: true, data: { total_cost: 0, repaired: [], message: 'AQ C65 2 8450;L=>< A>AB>O=88' } } };
            }

            if (Number(player.coins || 0) < totalCost) {
                return { status: 400, body: { success: false, error: '54>AB0B>G=> <>=5B', code: 'NOT_ENOUGH_COINS', data: { total_cost: totalCost, coins: Number(player.coins || 0) } } };
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

            // !8=E@>=870F8O 8=25=B0@O 2 =>@<0;87>20==CN B01;8FC
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, normalizeInventory(player.inventory));
            } catch (_) { /* ignore */ }

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        total_cost: totalCost,
                        repaired: repairedSlots,
                        message: '>G8=5=> ' + repairedSlots.length + ' ?@54<5B>2 70 ' + totalCost + ' <>=5B'
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
 * POST /api/game/workshop/upgrade  +1 C@>25=L C;CGH5=8O.
 * 064K9 C@>25=L 40QB +8% : C@>=C/70I8B5, <0:A8<C< 10.
 * &5=0: <>=5BK + <0B5@80; ?> @54:>AB8 (+ ?0B@>=K 4;O AB@5;:>2>3> >@C68O).
 */
/**
 * POST /api/game/workshop/scrap-all  @07>1@0BL 2A5 A;><0==K5 ?@54<5BK 2 8=25=B0@5.
 */
router.post('/scrap-all', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);

        const result = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'coins, inventory');
            if (!player) return { status: 404, body: { success: false, error: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND' } };

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, req.player?.id) || normalizeInventory(player.inventory);
            const toScrap = inventory.filter((item) => {
                if (!item || !equipmentRules.isEquipmentItem(item)) return false;
                const info = equipmentRules.getDurabilityInfo(item);
                return info.isBroken;
            });

            if (toScrap.length === 0) {
                return { status: 200, body: { success: true, data: { scrapped: 0, materials: {}, message: '5B A;><0==KE ?@54<5B>2' } } };
            }

            // !G8B05< ?>;CG05<K5 <0B5@80;K
            const gainedMaterials = {};
            for (const item of toScrap) {
                const yield_ = equipmentRules.calculateScrapYield(item);
                for (const [mat, qty] of Object.entries(yield_)) {
                    gainedMaterials[mat] = (gainedMaterials[mat] || 0) + qty;
                }
            }

            // #40;O5< A;><0==K5 ?@54<5BK 87 8=25=B0@O
            const remaining = inventory.filter((item) => {
                if (!item || !equipmentRules.isEquipmentItem(item)) return true;
                const info = equipmentRules.getDurabilityInfo(item);
                return !info.isBroken;
            });

            // @>25@O5<, GB> 4>102;5=85 <0B5@80;>2 =5 ?@52KA8B ;8<8B A;>B>2
            const MAX_SLOTS = 100;
            const materialCount = Object.keys(gainedMaterials).length;
            if (remaining.length + materialCount > MAX_SLOTS) {
                return { status: 400, body: { success: false, error: '=25=B0@L ?5@5?>;=5=', code: 'INVENTORY_FULL' } };
            }

            // >102;O5< <0B5@80;K
            for (const [mat, qty] of Object.entries(gainedMaterials)) {
                helpers.addItemToInventory(remaining, { name: mat, type: 'resource', category: 'material', rarity: 'common', icon: '=пїЅ', quantity: qty, durability: 100, max_durability: 100 }, null);
            }

            await setPlayerInventory(req.player?.id, remaining, client, { jsonb: false });

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        scrapped: toScrap.length,
                        materials: gainedMaterials,
                        message: ' 07>1@0=> ' + toScrap.length + ' ?@54<5B>2'
                    }
                }
            };
        });

        res.status(result.status).json(result.body);
    } catch (error) {
        handleRouteError(res, error, 'workshop_scrap_all', req.playerId);
    }
});

router.post('/upgrade', async (req, res) => {
    if (!playerIdGuard(req, res)) return;
    try {
        const slot = String(req.body?.slot || '');
        if (!isValidSlot(slot)) {
            return fail(res, '#:068B5 :>@@5:B=K9 A;>B', 'INVALID_SLOT');
        }

        const result = await transaction(async (client) => {
            const player = await lockPlayer(req.player?.id, client, 'coins, equipment, inventory');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: ' MB>< A;>B5 =8G53> =5B', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const cost = equipmentRules.calculateUpgradeCost(item);
            if (!cost || typeof cost !== 'object') {
                throw {
                    message: `0:A8<0;L=K9 C@>25=L C;CGH5=8O: ${equipmentRules.MAX_UPGRADE_LEVEL}`,
                    code: 'MAX_UPGRADE_LEVEL',
                    statusCode: 400
                };
            }
            if (Number(player.coins || 0) < cost.coins) {
                throw {
                    message: `54>AB0B>G=> <>=5B. C6=> ${cost.coins}, C 20A ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const materials = await loadMaterials(client, Object.keys(cost.materials || {}));
            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, req.player?.id) || normalizeInventory(player.inventory);

            // !=0G0;0 ?@>25@O5< 25AL A?8A>:: =5;L7O A?8A0BL G0ABL <0B5@80;>2
            // 8 C?0ABL =0 =5E20B:5 A;54CNI53>.
            for (const [name, required] of Object.entries(cost.materials || {})) {
                const material = materials.get(name);
                if (!material) {
                    logger.warn('[workshop] 0B5@80; C;CGH5=8O >BACBAB2C5B 2 :0B0;>35', { name });
                    throw { message: `0B5@80; пїЅ${name}пїЅ =54>ABC?5=`, code: 'MATERIAL_MISSING', statusCode: 500 };
                }

                const owned = inventory
                    .filter((entry) => Number(entry.id) === Number(material.id))
                    .reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity || 1)), 0);

                if (owned < required) {
                    throw {
                        message: `5 E20B05B <0B5@80;0 пїЅ${name}пїЅ: =C6=> ${required}, 5ABL ${owned}`,
                        code: 'INSUFFICIENT_MATERIALS',
                        statusCode: 400,
                        material: name,
                        required,
                        owned
                    };
                }
            }

            for (const [name, required] of Object.entries(cost.materials || {})) {
                const material = materials.get(name);
                let left = required;
                for (let i = 0; i < inventory.length && left > 0; i++) {
                    if (Number(inventory[i].id) !== Number(material.id)) continue;

                    const have = Math.max(0, Number(inventory[i].quantity || 1));
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
                // #;CGH8;8  ?@>G=>ABL 2>AAB0=02;8205BAO ?>;=>ABLN.
                durability: equipmentRules.getDurabilityInfo(item).max
            };

            await client.query(
                'UPDATE players SET coins = COALESCE(coins,0) - $1, equipment = $2::jsonb, inventory = $3::jsonb WHERE id = $4',
                [cost.coins, JSON.stringify(equipment), JSON.stringify(inventory), req.player.id]
            );

            const upgraded = equipment[slot];
            return {
                success: true,
                message: `${item.name || '@54<5B'} C;CGH5= 4> +${cost.next_level}`,
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
 * POST /api/game/workshop/modify  CAB0=>28BL <>48D8:0F8N =0 A;>B.
 * body: { slot, modification: 'sharpening' | 'plating' }
 *
 * >48D8:0F8O 40QB ! 1>=CA (0B>G:0 +4 C@>=0 70 C@>25=L, 1;8F>2:0
 * +3 70I8BK), <0:A8<C< 3 C@>2=O. 0B5@80;K: C >@C68O  <5B0;; 8 ?@>2>40,
 * C 1@>=8  45@52>, B:0=L 8 ?;0AB8:.
 */
router.post('/modify', async (req, res) => {
    if (!playerIdGuard(req, res)) return;
    try {
        const slot = String(req.body?.slot || '');
        const modification = String(req.body?.modification || '');

        if (!isValidSlot(slot)) {
            return fail(res, '#:068B5 :>@@5:B=K9 A;>B', 'INVALID_SLOT');
        }
        if (!Object.prototype.hasOwnProperty.call(equipmentRules.MODIFICATIONS, modification) || !equipmentRules.MODIFICATIONS[modification]) {
            return res.status(400).json({ success: false, error: '58725AB=0O <>48D8:0F8O', code: 'INVALID_MODIFICATION' });
        }

        const result = await transaction(async (client) => {
            const player = await lockPlayer(req.player?.id, client, 'coins, equipment, inventory');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: ' MB>< A;>B5 =8G53> =5B', code: 'SLOT_EMPTY', statusCode: 400 };
            }
            if (!equipmentRules.isModificationApplicable(item, modification)) {
                throw {
                    message: `пїЅ${equipmentRules.MODIFICATIONS[modification].name}пїЅ =5 ?>4E>48B MB><C ?@54<5BC`,
                    code: 'MODIFICATION_NOT_APPLICABLE',
                    statusCode: 400
                };
            }

            const cost = equipmentRules.calculateModificationCost(item, modification);
            if (!cost || typeof cost !== 'object') {
                throw {
                    message: `0:A8<0;L=K9 C@>25=L <>48D8:0F88: ${equipmentRules.MAX_MODIFICATION_LEVEL}`,
                    code: 'MAX_MODIFICATION_LEVEL',
                    statusCode: 400
                };
            }
            if (Number(player.coins || 0) < cost.coins) {
                throw {
                    message: `54>AB0B>G=> <>=5B. C6=> ${cost.coins}, C 20A ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, req.player?.id) || normalizeInventory(player.inventory);
            const materials = await loadMaterials(client, Object.keys(cost.materials || {}));

            for (const [name, required] of Object.entries(cost.materials || {})) {
                const material = materials.get(name);
                if (!material) {
                    logger.warn('[workshop] 0B5@80; <>48D8:0F88 >BACBAB2C5B 2 :0B0;>35', { name });
                    throw { message: `0B5@80; пїЅ${name}пїЅ =54>ABC?5=`, code: 'MATERIAL_MISSING', statusCode: 500 };
                }

                const owned = inventory
                    .filter((entry) => Number(entry.id) === Number(material.id))
                    .reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity || 1)), 0);

                if (owned < required) {
                    throw {
                        message: `5 E20B05B <0B5@80;0 пїЅ${name}пїЅ: =C6=> ${required}, 5ABL ${owned}`,
                        code: 'INSUFFICIENT_MATERIALS',
                        statusCode: 400,
                        material: name,
                        required,
                        owned
                    };
                }
            }

// !?8AK205< <0B5@80;K ?0G:0<8 (?@>25@:0 2KH5 30@0=B8@C5B, GB> E20B8B).
            for (const [name, required] of Object.entries(cost.materials || {})) {
                const material = materials.get(name);
                let left = required;
                for (let i = 0; i < inventory.length && left > 0; i++) {
                    if (Number(inventory[i].id) !== Number(material.id)) continue;

                    const have = Math.max(0, Number(inventory[i].quantity || 1));
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
                'UPDATE players SET coins = COALESCE(coins,0) - $1, equipment = $2::jsonb, inventory = $3::jsonb WHERE id = $4',
                [cost.coins, JSON.stringify(equipment), JSON.stringify(inventory), req.player.id]
            );

            const modified = equipment[slot];
            return {
                success: true,
                message: `${item.name || '@54<5B'}: ${equipmentRules.MODIFICATIONS[modification].name} +${cost.next_level}`,
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

