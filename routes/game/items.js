/**
 * 0@H@CBK 4;O @01>BK A 8=25=B0@Q< 8 ?@54<5B0<8
 * GET /api/game/items  A?8A>: ?@54<5B>2 2 <03078=5
 * GET /api/game/inventory  8=25=B0@L 83@>:0
 * POST /api/game/items/buy  ?>:C?:0 ?@54<5B0
 */

const express = require('express');
const router = express.Router();
const { queryOne, queryAll, transaction } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { safeJsonParse, handleError, logPlayerAction, notFound, fail, requireItemId } = require('../../utils/serverApi');
const { playerIdGuard } = require('../../utils/routeHelpers');
const { parseEquipment } = require('../../utils/normalizePlayerJson');
const { setPlayerInventory } = require('../../db/playerRepository');
// validateQuantity: 548=0O ?@>25@:0 :>;8G5AB20 4;O /buy 8 /buy-stars.
// validateItemIndex: 548=0O ?@>25@:0 8=45:A0 ?@54<5B0 2 8=25=B0@5.
const { validateQuantity, validateItemIndex } = require('../../utils/validate');

// 5=820O 703@C7:0 helpers: utils/game-helpers.js  548=AB25==K9 8AB>G=8:
// DC=:F89 A>AB>O=8O 83@>:0. = BO=5B db/database, ?>MB><C 8<?>@B ;5=82K9
// (8=0G5 F8:; 703@C7:8 <>4C;59).
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../../utils/game-helpers');
    }
    return gameHelpers;
}

// -:A?>@B8@C5<K5 DC=:F88 G5@57 getGameHelpers()
const helpers = getGameHelpers();

// <?>@B8@C5<K5 DC=:F88
// normalizeInfections C1@0=: 8=D5:F88 >1J548=5=K A @0480F859,
// ;5G8BAO >4=> ?>;5 players.radiation.
const { normalizeInventory, normalizeEquipment, createInventoryItem, normalizeRadiation, calculateSellPrice, addItemToInventory, equipmentRules, getSetBonuses, trackCollectedItems, consumeInventoryItem } = helpers;

/**
 * 8<8B A;>B>2 8=25=B0@O.
 *
 * 5@QBAO 87 public/shared/equipment.js  B>3> 65 D09;0, GB> G8B05B :;85=B.
 *  0AE>645=85 7=0G5=89 >7=0G0;> 1K ;81> ?5@5?>;=5=85 8=25=B0@O, ;81>
 * 25G=CN 1;>:8@>2:C 4>1KG8.
 */
const MAX_INVENTORY_SLOTS = require('../../public/shared/equipment.js').MAX_INVENTORY_SLOTS;

/**
 * >;CG8BL A?8A>: ?@54<5B>2 2 <03078=5
 * GET /items/shop (>A=>2=>9), GET /items (>1@0B=0O A>2<5AB8<>ABL)
 */
router.get(['/shop', '/items'], async (req, res) => {
    try {
        const items = await queryAll(`
            SELECT id, name, description, type, category, rarity, 
                   price, stars_price, icon, slot, stats, stackable
            FROM items 
            WHERE price > 0 OR stars_price > 0
            ORDER BY rarity, type, name
        `);

        res.json({
            success: true,
            items: items.map(item => ({
                ...item,
                stats: safeJsonParse(item.stats, {})
            }))
        });
    } catch (error) {
        handleError(res, error, 'items_list');
    }
});

/**
 * >;CG8BL 8=25=B0@L 83@>:0
 * GET /api/game/inventory (G5@57 0;80A /inventory), GET /inventory (>1@0B=0O A>2<5AB8<>ABL)
 */
router.get(['/', '/inventory'], async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

        const player = await queryOne(
            'SELECT inventory, equipment FROM players WHERE id = $1',
            [playerId]
        );

        if (!player) {
            return notFound(res, '3@>: =5 =0945=', 'PLAYER_NOT_FOUND');
        }

        const inventory = normalizeInventory(player.inventory);
        const equipment = normalizeEquipment(player.equipment);

        // &5=K ?@>4068 AG8B05< ?> B01;8F5 items, 0 =5 15@Q< 87 JSON 8=25=B0@O.
        // 4=8< 70?@>A>< =0 2A5 id, GB>1K =5 45;0BL N+1.
        const ids = [...new Set(inventory.map(i => Number(i.id)).filter(id => Number.isInteger(id) && id > 0))];
        const catalog = new Map();
        if (ids.length > 0) {
            const rows = await queryAll(
                'SELECT id, type, rarity, price FROM items WHERE id = ANY($1::int[])',
                [ids]
            );
            for (const row of rows) catalog.set(row.id, row);
        }

        const items = inventory.map(item => ({
            ...item,
            sell_price: calculateSellPrice(catalog.get(item.id) || null, item)
        }));

        res.json({
            success: true,
            inventory: items,
            equipment
        });
    } catch (error) {
        handleError(res, error, 'inventory_view');
    }
});

/**
 * C?8BL ?@54<5B 70 <>=5BK
 * POST /items/buy
 */
router.post('/buy', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

        // P1-5: quantity 20;848@C5BAO  0@8D<5B8:8.
        //
        // K;>: Math.max(1, Math.min(99, Number(req.body?.quantity || 1))).
        // @8 quantity = {} 8;8 "abc" Number() -> NaN, Math.min/max c NaN B>65
        // 40NB NaN. 0;LH5 totalPrice = price * NaN -> NaN, 8 ?@>25@:0
        // `player.coins < NaN` 2A5340 ;>6=0  >?;0B0 <>;G0 «?@>E>48;0»,
        // 0 UPDATE CE>48; A NaN 2 :>;>=:C.
        const qtyCheck = validateQuantity(req.body?.quantity);
        if (!qtyCheck.ok) {
            return res.status(400).json({ success: false, error: qtyCheck.error, code: qtyCheck.code });
        }
        const quantity = qtyCheck.value;

        // itemId B>65 F5;>5: @0=LH5 `!itemId || itemId <= 0` ?@>?CA:0;> 2.5.
        const itemId = Number(req.body?.item_id);

        if (!requireItemId(res, itemId)) return;

        const result = await transaction(async (client) => {
            const item = await client.query(
                'SELECT * FROM items WHERE id = $1 AND price > 0',
                [itemId]
            );

            if (!item.rows[0]) {
                throw { message: '@54<5B =5 =0945= 8;8 =5 ?@>40QBAO', code: 'ITEM_NOT_FOUND', statusCode: 404 };
            }

            const shopItem = item.rows[0];
            const totalPrice = shopItem.price * quantity;

            const player = await lockPlayer(playerId, client, 'coins, inventory');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            if (Number(player.coins || 0) < totalPrice) {
                throw {
                    message: `54>AB0B>G=> <>=5B. "@51C5BAO: ${totalPrice}, C 20A: ${player.coins}`,
                    code: 'INSUFFICIENT_COINS',
                    statusCode: 400
                };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);

            const newItem = createInventoryItem(shopItem, { quantity });
            const addedAsNewSlots = addItemToInventory(inventory, newItem, shopItem);

            // 8<8B A;>B>2. @>25@O5< ! AB0:>20=8O: 5A;8 ?@54<5B 2;57
            // 2 ACI5AB2CNI89 AB5:, =>2K9 A;>B =5 A>740QBAO 8 ;8<8B =5 B@>305<.
            if (addedAsNewSlots > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                throw {
                    message: `=25=B0@L ?5@5?>;=5= (<0:A. ${MAX_INVENTORY_SLOTS} A;>B>2).`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            await client.query(
                'UPDATE players SET coins = COALESCE(coins,0) - $1, inventory = $2, items_collected = COALESCE(items_collected, 0) + $4 WHERE id = $3',
                [totalPrice, JSON.stringify(inventory), playerId, quantity]
            );

            // !8=E@>=870F8O 8=25=B0@O
            try {
                const { syncInventoryToTable } = require('../../utils/game-helpers');
                if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
            } catch (_) { /* ignore */ }

            // P2: ?>:C?:0 B>65 84QB 2 C=8:0;L=K9 collection-tracker, 8=0G5
            // 4>AB865=85 «>;;5:F8>=5@» AG8B0;> B>;L:> ;CB>< 8 72Q74=K<
            // <03078=><, 0 :C?;5==K5 ?@54<5BK 2 =53> =5 ?>?040;8.
            // K7>2 157>?0A5=: ?CAB>9/=520;84=K9 id DC=:F8O A0<0 >BD8;LB@C5B.
            await trackCollectedItems(client, playerId, [shopItem.id]);

            await logPlayerAction(playerId, 'item_bought', {
                item_id: itemId,
                item_name: shopItem.name,
                quantity,
                price: totalPrice
            }, client);

            return {
                success: true,
                item: {
                    id: shopItem.id,
                    name: shopItem.name,
                    icon: shopItem.icon || '=ж',
                    quantity
                },
                coins_spent: totalPrice,
                coins_remaining: Number(player.coins || 0) - totalPrice
            };
        });

        res.json(result);
    } catch (error) {
        // 3@>2K5 :>4K >H81>: ;>28< 745AL 8 >B40Q< :0: 4xx. AQ >AB0;L=>5 
        // 2 handleError -> 500 A >1I8< B5:AB><, 8 :;85=B ?>:07K205B
        // «>H81:0 A5@25@0» 2<5AB> «=54>AB0B>G=> <>=5B» 8;8 «8=25=B0@L ?>;>=».
        if (['INSUFFICIENT_COINS', 'ITEM_NOT_FOUND', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_buy');
    }
});

/**
 * POST /items/use  8A?>;L7>20BL/M:8?8@>20BL ?@54<5B
 */
router.post(['/use', '/use-item'], async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;
        const itemIndex = Number(req.body?.item_index);
        const equip = Boolean(req.body?.equip);

        const itemIndexCheck = validateItemIndex(itemIndex);
        if (!itemIndexCheck.ok) {
            return fail(res, itemIndexCheck.error, itemIndexCheck.code);
        }

        const result = await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'inventory, equipment, health, max_health, radiation');

            if (!playerRow) throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(playerRow.inventory);

            if (itemIndex >= inventory.length) {
                throw { message: '@54<5B =5 =0945= 2 8=25=B0@5', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            if (!item || typeof item !== 'object') {
                throw { message: '@54<5B =5 =0945= 2 8=25=B0@5', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            if (equip) {
                // !;>B >?@545;O5B 548=AB25==K9 8AB>G=8: ?@028;
                // (public/shared/equipment.js). !;>B B8?0 item.type (=0?@8<5@
                // «food» C 54K) =5 CG0AB2C5B =8 2 70I8B5, =8 2 87=>A5: ?@54<5B
                // 8AG57 1K 87 8=25=B0@O 8 <>;G0 =5 40; 1K 1>=CA>2.
                const slot = equipmentRules.resolveEquipmentSlot(item);
                if (!slot) {
                    throw {
                        message: `«${item.name || '@54<5B'}» =5;L7O =045BL  C =53> =5B A;>B0 M:8?8@>2:8`,
                        code: 'NOT_EQUIPMENT',
                        statusCode: 400
                    };
                }

                const equipment = normalizeEquipment(playerRow.equipment);
                const oldItem = equipment[slot] || null;

                // !=0@O65=85 =5 AB0:05BAO: 5A;8 2 A;>B5 ?@54<5B C65 ;568B,
                // AB0@K9 2>72@0I05BAO 2 8=25=B0@L >B45;L=>9 70?8ALN.
                inventory.splice(itemIndex, 1);
                equipment[slot] = item;
                if (oldItem) {
                    if (inventory.length >= MAX_INVENTORY_SLOTS) {
                        throw { message: `=25=B0@L ?5@5?>;=5= (<0:A. ${MAX_INVENTORY_SLOTS} A;>B>2).`, code: 'INVENTORY_FULL', statusCode: 400 };
                    }
                    inventory.push(oldItem);
                }

                await client.query(
                    'UPDATE players SET equipment = $1, inventory = $2 WHERE id = $3',
                    [JSON.stringify(equipment), JSON.stringify(inventory), playerId]
                );

                // !8=E@>=870F8O 8=25=B0@O
                try {
                    const { syncInventoryToTable } = require('../../utils/game-helpers');
                    if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
                } catch (_) { /* ignore */ }

                return {
                    success: true,
                    message: 'Предмет использован',
                    item: { id: item.id, name: item.name },
                    log: { action: 'item_equip', playerId, data: { slot, item_id: item.id } }
                };
            }

            //  0AE>4=K9 ?@54<5B
            const stats = item.stats || {};
            const updates = [];
            const params = [playerId];
            const playerRadiation = normalizeRadiation(playerRow.radiation);

            // >=CAK A5B>2: heal_bonus (?@>F5=B : ;5G5=8N) 8 energy_bonus
            // (?;>A:0O ?@8102:0 : M=5@388). 57 =8E 548F8=A:89 A5B 1K;
            // ?@>AB> =01>@>< 4>@>38E 25I59 157 ?@58<CI5AB20.
            const setBonuses = await getSetBonuses(parseEquipment(playerRow.equipment), client);

            if (stats.healing || stats.health) {
                const baseHeal = Number(stats.healing || stats.health || 0);
                const healPercent = Number(stats.heal_bonus || 0) + Number(setBonuses.heal_bonus || 0);
                const healAmount = Math.max(1, Math.round(baseHeal * (1 + healPercent / 100)));
                const curHealth = Number(playerRow.health || 0);
                const maxHealth = Number(playerRow.max_health || 100);
                const newHealth = Math.min(maxHealth, curHealth + healAmount);
                updates.push(`health = $${params.length + 1}`);
                params.push(newHealth);
            }

            // 40/2>40 2>AAB0=02;820NB M=5@38N (AB0@B>2K9 8=25=B0@L A>45@68B stats.energy)
            if (stats.energy) {
                const energyAmount = Number(stats.energy) + Number(setBonuses.energy_bonus || 0);
                if (energyAmount > 0) {
                    updates.push(`energy = LEAST(COALESCE(max_energy,0), COALESCE(energy,0) + $${params.length + 1})`);
                    params.push(energyAmount);
                }
            }

            if (stats.radiation_cure || stats.infection_cure) {
                // 0@065=85 ;5G8B >4=> «@0480F8>==>5» ?>;5: 8=D5:F88 >1J548=5=K
                // A @0480F859, ?>MB><C 0=B8@04, 0=B84>B 8 A?8@B M:2820;5=B=K.
                // @56=OO 25B:0 4;O infection_cure ?8A0;0 2 players.infections
                // >B45;L=K< <0AA82><.
                const cureAmount = Number(stats.radiation_cure || stats.infection_cure || 0);
                const curRad = playerRadiation.level;
                const newRad = Math.max(0, curRad - cureAmount);
                // radiation  JSONB-:>;>=:0 ({ level, expires_at, applied_at }).
                // >;>5 G8A;> AN40 ?8A0BL =5;L7O: Postgres >B25B8B
                // "column radiation is of type jsonb but expression is of type
                // integer" 8 ;N1>5 8A?>;L7>20=85 0=B8@040 C?04QB A 500.
                const radPayload = JSON.stringify({
                    level: newRad,
                    expires_at: newRad > 0 ? playerRadiation.expires_at : null,
                    applied_at: newRad > 0 ? playerRadiation.applied_at : null
                });
                updates.push(`radiation = $${params.length + 1}::jsonb`);
                params.push(radPayload);
            }

            if (updates.length > 0) {
                //  0AE>4=8: <>65B ;560BL AB>?:>9 (quantity > 1): MDD5:B ?@8<5=O5BAO >48=
                // @07, 0 87 AB5:0 CE>48B @>2=> >4=0 HBC:0.
                const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, itemIndex);

                await client.query(
                    `UPDATE players SET ${updates.join(', ')}, inventory = $${params.length + 1} WHERE id = $1`,
                    [...params, JSON.stringify(updatedInventory)]
                );

                return {
                    success: true,
                    message: 'Предмет использован',
                    item: { id: item.id, name: item.name },
                    quantity_left: quantityLeft,
                    log: { action: 'item_use', playerId, data: { item_id: item.id, item_name: item.name } }
                };
            }

            // Расходники без статов (консервы и т.п.) всё равно расходуются.
            if (item.type === 'food' || item.type === 'consumable') {
                const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, itemIndex);
                await client.query(
                    'UPDATE players SET inventory = $1 WHERE id = $2',
                    [JSON.stringify(updatedInventory), playerId]
                );
                try {
                    const { syncInventoryToTable } = require('../../utils/game-helpers');
                    if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, updatedInventory);
                } catch (_) { /* ignore */ }
                return {
                    success: true,
                    message: 'Предмет использован',
                    item: { id: item.id, name: item.name },
                    quantity_left: quantityLeft,
                    log: { action: 'item_use', playerId, data: { item_id: item.id, item_name: item.name } }
                };
            }

            return { success: false, message: 'Этот предмет нельзя использовать' };
        });

        // >38@C5< ! :><<8B0 B@0=70:F88
        if (result.log) {
            await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
        }

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'NOT_EQUIPMENT', 'INVENTORY_FULL'].includes(error.code)) {
            // statusCode <>65B >BACBAB2>20BL  res.status(undefined) 40; 1K
            // =520;84=K9 HTTP-:>4. $>;;1M: 404 A>>B25BAB2C5B A<KA;C >H81:8.
            const status = Number(error.statusCode) || 404;
            return res.status(status).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_use');
    }
});

/**
 * POST /items/sell  ?@>40BL ?@54<5B 70 <>=5BK
 *
 * 0:@K205B ?5B;N M:>=><8:8: @0=LH5 ?@54<5BK <>6=> 1K;> B>;L:> B@0B8BL,
 * 0 ?@8 70?>;=5=88 100 A;>B>2 83@0 ?@54;030;0 «?@>40BL ;8H=55» 
 * DC=:F88 ?@>4068 =5 ACI5AB2>20;>.
 */
router.post('/sell', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;
        const itemIndex = Number(req.body?.item_index);

        const itemIndexCheck = validateItemIndex(itemIndex);
        if (!itemIndexCheck.ok) {
            return fail(res, itemIndexCheck.error, itemIndexCheck.code);
        }

        const result = await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'inventory, coins');

            if (!playerRow) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(playerRow.inventory);

            if (itemIndex >= inventory.length) {
                throw { message: '@54<5B =5 =0945= 2 8=25=B0@5', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            if (!item || typeof item !== 'object') {
                throw { message: '@54<5B =5 =0945= 2 8=25=B0@5', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }
            // 8=0G5 F5=C <>6=> 1K;> 1K ?>445;0BL =0 :;85=B5.
            const dbItemResult = await client.query(
                'SELECT id, name, type, rarity, price, stackable FROM items WHERE id = $1',
                [item.id]
            );
            const dbItem = dbItemResult.rows[0] || null;

            const unitPrice = calculateSellPrice(dbItem, item);
            if (unitPrice <= 0) {
                throw {
                    message: '-B>B ?@54<5B =5;L7O ?@>40BL',
                    code: 'ITEM_NOT_SELLABLE',
                    statusCode: 400
                };
            }

            // 0 >4=C >?5@0F8N ?@>40Q< 25AL AB5:  MB> >A>7=0==>:
            // A;>B 70=8<05B <5AB>, 0 <>=5BK :><?0:B=55. ;85=B <>65B
            // ?>?@>A8BL quantity: 1, GB>1K ?@>40BL >4=C HBC:C 87 AB5:0.
            const stackQuantity = Math.max(1, Number(item.quantity || 1));
            const requestedQuantity = Number(req.body?.quantity);
            const soldQuantity = (Number.isInteger(requestedQuantity) && requestedQuantity > 0)
                ? Math.min(stackQuantity, requestedQuantity)
                : stackQuantity;
            const earned = unitPrice * soldQuantity;

            if (soldQuantity >= stackQuantity) {
                inventory.splice(itemIndex, 1);
            } else {
                inventory[itemIndex] = { ...item, quantity: stackQuantity - soldQuantity };
            }

            const newCoins = Number(playerRow.coins || 0) + earned;

            await client.query(
                'UPDATE players SET coins = $1, inventory = $2 WHERE id = $3',
                [newCoins, JSON.stringify(inventory), playerId]
            );

            await logPlayerAction(playerId, 'item_sell', {
                item_id: item.id,
                item_name: item.name,
                quantity: soldQuantity,
                price_earned: earned
            }, client);

            return {
                success: true,
                message: `@>40=>: ${item.name} Ч${soldQuantity}`,
                item: { id: item.id, name: item.name, icon: item.icon || '=ж', rarity: item.rarity },
                quantity_sold: soldQuantity,
                unit_price: unitPrice,
                coins_earned: earned,
                coins_total: newCoins
            };
        });

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'ITEM_NOT_SELLABLE'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_sell');
    }
});

/**
 *  07>1@0BL ?@54<5B =0 <0B5@80;K (POST /items/drop).
 *
 * 0:@K205B BC?8: A ;8<8B>< 8=25=B0@O: @0=LH5 ?@54<5B <>6=> 1K;> B>;L:>
 * ?@>40BL 70 35% F5=K 8;8 8A?>;L7>20BL, ?>MB><C 100 A;>B>2 701820;8AL
 * 8A?>@G5==K< A=0@O65=85< 8 =5=C6=K<8 @0AE>4=8:0<8, :>B>@K5 =5:C40 1K;> 45BL.
 *
 * !=0@O65=85 40QB <0B5@80;K ?> @54:>AB8 (calculateScrapYield), >AB0;L=K5
 * ?@54<5BK ?@>AB> 2K1@0AK20NBAO: «@0718@0BL» 54C 15AA<KA;5==>.
 */
router.post('/drop', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;
        const itemIndex = Number(req.body?.item_index);

        const itemIndexCheck = validateItemIndex(itemIndex);
        if (!itemIndexCheck.ok) {
            return fail(res, itemIndexCheck.error, itemIndexCheck.code);
        }

        const result = await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'inventory');

            if (!playerRow) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(playerRow.inventory);
            if (itemIndex >= inventory.length) {
                throw { message: '@54<5B =5 =0945= 2 8=25=B0@5', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const item = inventory[itemIndex];

            if (!item || typeof item !== 'object') {
                throw { message: '@54<5B =5 =0945= 2 8=25=B0@5', code: 'ITEM_NOT_IN_INVENTORY', statusCode: 400 };
            }

            const stackQuantity = Math.max(1, Number(item.quantity || 1));
            const requested = Number(req.body?.quantity);
            const dropQuantity = (Number.isInteger(requested) && requested > 0)
                ? Math.min(stackQuantity, requested)
                : stackQuantity;

            // 5AB <>65B =5 E20B8BL. C6=>5 AG8B05<  C40;5=8O ?@54<5B0, 8 ?@8
            // =5E20B:5 <5AB 1@>A05< >H81:C: B@0=70:F8O >B:0BK205BAO, 8 83@>:
            // =8G53> =5 B5@O5B.
            //
            // dropQuantity, 0 =5 6QAB:0O 1: calculateScrapYield(item, quantity)
            // <0AHB018@C5B 2KE>4 (factor = 1..5 >B quantity). ! 548=8F59 @071>@
            // AB>?:8 87 50 :>=A5@2>2 C40;O; 50 ?@54<5B>2 8 =0G8A;O; <0B5@80;K
            // 70 >48=  >AB0;L=K5 <>;G0 C=8GB>60;8AL.
            const scrapYield = equipmentRules.calculateScrapYield(item, dropQuantity);
            const materialNames = Object.keys(scrapYield);
            let materials = [];
            if (materialNames.length > 0) {
                const materialResult = await client.query(
                    'SELECT id, name, type, category, rarity, icon, stats, stackable, max_stack FROM items WHERE name = ANY($1::text[])',
                    [materialNames]
                );
                materials = materialResult.rows;
                if (materials.length === 0 || materials.length < materialNames.length) {
                    throw {
                        message: '0B5@80;K @071>@0 =54>ABC?=K',
                        code: 'MATERIAL_MISSING',
                        statusCode: 400
                    };
                }
            }

            // 5AB <>65B =5 E20B8BL: AG8B05< MB>  C40;5=8O ?@54<5B0.
            if (materials.length > 0) {
                const projected = inventory.slice();
                for (const material of materials) {
                    const quantity = Number(scrapYield[material.name] || 0);
                    if (quantity <= 0) continue;
                    addItemToInventory(
                        projected,
                        createInventoryItem({ ...material, stats: safeJsonParse(material.stats, {}) }, { quantity }),
                        material
                    );
                }

                const slotsNeeded = Math.max(0, projected.length - inventory.length);
                const freesSlot = dropQuantity >= stackQuantity;
                const freeSlots = MAX_INVENTORY_SLOTS - inventory.length + (freesSlot ? 1 : 0);
                if (slotsNeeded > freeSlots) {
                    throw {
                        message: `C6=> A2>1>4=KE A;>B>2: ${slotsNeeded}, 4>ABC?=>: ${freeSlots}. @>409 8;8 @0715@8 GB>-=81C4L.`,
                        code: 'INVENTORY_FULL',
                        statusCode: 400
                    };
                }
            }

            if (dropQuantity >= stackQuantity) {
                inventory.splice(itemIndex, 1);
            } else {
                inventory[itemIndex] = { ...item, quantity: stackQuantity - dropQuantity };
            }

            const granted = [];
            for (const material of materials) {
                const quantity = Number(scrapYield[material.name] || 0);
                if (quantity <= 0) continue;

                addItemToInventory(
                    inventory,
                    createInventoryItem({ ...material, stats: safeJsonParse(material.stats, {}) }, { quantity }),
                    material
                );
                granted.push({ id: material.id, name: material.name, quantity, icon: material.icon || '=ж' });
            }

            await setPlayerInventory(playerId, inventory, client, { jsonb: false });

            await logPlayerAction(playerId, 'item_drop', {
                item_id: item.id,
                item_name: item.name,
                quantity: dropQuantity,
                materials: granted
            }, client);

            return {
                success: true,
                message: ` 07>1@0=>: ${item.name}`,
                item: { id: item.id, name: item.name, icon: item.icon || '=ж' },
                quantity_dropped: dropQuantity,
                materials: granted
            };
        });

        res.json(result);
    } catch (error) {
        if (['ITEM_NOT_IN_INVENTORY', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL', 'MATERIAL_MISSING'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_drop');
    }
});

/**
 * POST /items/unequip  A=OBL ?@54<5B 87 A;>B0 2 8=25=B0@L.
 * body: { slot }
 *
 * !=OB85 >BACBAB2>20;> 2>>1I5: A;>B <>6=> 1K;> B>;L:> ", 4@C38<
 * ?@54<5B><. A;8 83@>: =045; =5 B>B :0A:C, 25@=CBL ?@54K4CI89 C65 =5;L7O,
 * 0 A5B/1>=CA >B =5C40G=>3> ?@54<5B0 <>65B <5H0BL 4> :>=F0 A5AA88.
 */
router.post('/unequip', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;
        const slot = String(req.body?.slot || '');

        const result = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'equipment, inventory');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            const equipment = normalizeEquipment(player.equipment);
            const item = equipment[slot];
            if (!item) {
                throw { message: ' MB>< A;>B5 =8G53> =5B', code: 'SLOT_EMPTY', statusCode: 400 };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);
            if (inventory.length >= MAX_INVENTORY_SLOTS) {
                throw {
                    message: `=25=B0@L ?>;>= (<0:A. ${MAX_INVENTORY_SLOTS}). @>409 8;8 @0715@8 GB>-=81C4L.`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            // !=0@O65=85 =5 AB0:C5BAO, ?>MB><C 2>72@0I05< 53> >B45;L=>9 70?8ALN.
            inventory.push(item);
            delete equipment[slot];

            await client.query(
                'UPDATE players SET equipment = $1::jsonb, inventory = $2 WHERE id = $3',
                [JSON.stringify(equipment), JSON.stringify(inventory), playerId]
            );

            await logPlayerAction(playerId, 'item_unequip', {
                slot,
                item_id: item.id ?? null,
                item_name: item.name || null
            }, client);

            return {
                success: true,
                message: `${item.name || '@54<5B'} A=OB`,
                slot,
                item: { id: item.id ?? null, name: item.name || '@54<5B', icon: item.icon || '=ж' },
                inventory_slots: inventory.length
            };
        });

        res.json(result);
    } catch (error) {
        if (['SLOT_EMPTY', 'PLAYER_NOT_FOUND', 'INVENTORY_FULL'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_unequip');
    }
});

/**
 * POST /items/buy-stars  :C?8BL ?@54<5B 70 72Q74K (POST /items/buy-stars).
 *
 * 2Q74K 2K40NBAO 70 4>AB865=8O 8 5654=52=K5 7040=8O, 0 B@0B8BL 8E 1K;>
 * =5345: :>;>=:0 items.stars_price G8B0;0AL B>;L:> 28B@8=>9 <03078=0.
 */
router.post('/buy-stars', async (req, res) => {
    try {
        const playerId = playerIdGuard(req, res);
        if (!playerId) return;

        // P1-5: B0 65 20;840F8O :>;8G5AB20, GB> 8 2 /buy  A<. :><<5=B0@89 B0<.
        const qtyCheck = validateQuantity(req.body?.quantity);
        if (!qtyCheck.ok) {
            return res.status(400).json({ success: false, error: qtyCheck.error, code: qtyCheck.code });
        }
        const quantity = qtyCheck.value;

        const itemId = Number(req.body?.item_id);

        if (!requireItemId(res, itemId)) return;

        const result = await transaction(async (client) => {
            const shopItem = await client.query(
                'SELECT * FROM items WHERE id = $1 AND stars_price > 0',
                [itemId]
            );
            if (!shopItem.rows[0]) {
                throw { message: '@54<5B =5 =0945= 8;8 =5 ?@>40QBAO 70 72Q74K', code: 'ITEM_NOT_FOUND', statusCode: 404 };
            }

            const shopItemRow = shopItem.rows[0];
            const totalStars = Number(shopItemRow.stars_price) * quantity;

            const player = await lockPlayer(playerId, client, 'stars, inventory');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            if (Number(player.stars || 0) < totalStars) {
                throw {
                    message: `54>AB0B>G=> 72Q74. C6=>: ${totalStars}, C 20A: ${player.stars}`,
                    code: 'INSUFFICIENT_STARS',
                    statusCode: 400
                };
            }

            const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(player.inventory);
            const newItem = createInventoryItem(shopItemRow, { quantity });
            const addedAsNewSlots = addItemToInventory(inventory, newItem, shopItemRow);

            if (addedAsNewSlots > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                throw {
                    message: `=25=B0@L ?5@5?>;=5= (<0:A. ${MAX_INVENTORY_SLOTS} A;>B>2).`,
                    code: 'INVENTORY_FULL',
                    statusCode: 400
                };
            }

            await client.query(
                'UPDATE players SET stars = GREATEST(0, COALESCE(stars,0) - $1), inventory = $2, items_collected = COALESCE(items_collected, 0) + $4 WHERE id = $3',
                [totalStars, JSON.stringify(inventory), playerId, quantity]
            );

            await trackCollectedItems(client, playerId, [shopItemRow.id]);
            await logPlayerAction(playerId, 'item_bought_stars', {
                item_id: itemId,
                item_name: shopItemRow.name,
                quantity,
                stars_spent: totalStars
            }, client);

            return {
                success: true,
                message: `C?;5=> 70 72Q74K: ${shopItemRow.name} Ч${quantity}`,
                item: { id: shopItemRow.id, name: shopItemRow.name, icon: shopItemRow.icon || '=ж', quantity },
                stars_spent: totalStars,
                stars_total: Number(player.stars || 0) - totalStars
            };
        });

        res.json(result);
    } catch (error) {
        if (['INSUFFICIENT_STARS', 'ITEM_NOT_FOUND', 'INVENTORY_FULL', 'PLAYER_NOT_FOUND'].includes(error.code)) {
            return res.status(error.statusCode || 400).json({
                success: false,
                error: error.message,
                code: error.code
            });
        }
        handleError(res, error, 'item_buy_stars');
    }
});

module.exports = router;


