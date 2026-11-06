/**
 * 1J548=Q==K9 <>4C;L 83@>2KE E5;?5@>2
 * 1J548=O5B DC=:F88 @01>BK A A>AB>O=85< 83@>:0 8 A8AB5<C 4>AB865=89
 * 
 * 1J548=Q==K5 <>4C;8:
 * - playerState.js (=>@<0;870F8O A>AB>O=8O 83@>:0)
 * - achievements.js (A8AB5<0 4>AB865=89)
 */

const { query, transaction } = require('../db/database');
// 48= 8<?>@B 2<5AB> 42CE: 8 logger, 8 safeJsonParse 15@CBAO 87 B>3> 65
// <>4C;O. 20 >B45;L=KE require >4=>3> D09;0 2K3;O4OB <5;:>9 157>184=>9
// ?@024>9, ?>:0 >4=064K =5 ?>O28BAO B@5BLO AB@>:0, 27OB0O =5 >BBC40.
const { logger, safeJsonParse, logPlayerAction } = require('./serverApi');
const { normalizeRadiationLevel } = require('./gameConstants');
const equipmentRules = require('../public/shared/equipment.js');

// ==========================================
// $#& !!"//   (87 playerState.js)
// ==========================================

/**
 * >@<0;870F8O 8=25=B0@O
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function deepClone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(deepClone);
    if (!isPlainObject(value)) return value;
    const out = {};
    for (const key of Object.keys(value)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        out[key] = deepClone(value[key]);
    }
    return out;
}


function toFiniteNumber(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return n;
}

const VALID_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary']);

function normalizeInventoryItem(raw) {
    if (!isPlainObject(raw)) return null;
    const copy = deepClone(raw);

    // id: 20;84=K9 safe-integer 8;8 null (=5 ?@82>48< null/undefined : 0)
    if (copy.id !== null && copy.id !== undefined) {
        const idNum = Number(copy.id);
        copy.id = Number.isSafeInteger(idNum) ? idNum : null;
    } else {
        copy.id = null;
    }

    // quantity: ?>;>68B5;L=>5 F5;>5, 8=0G5 1
    const q = Number(copy.quantity);
    copy.quantity = (Number.isFinite(q) && Number.isInteger(q) && q > 0) ? q : 1;

    // rarity: 87 8725AB=>3> =01>@0, 8=0G5 common
    if (typeof copy.rarity !== 'string' || !VALID_RARITIES.has(copy.rarity)) {
        copy.rarity = 'common';
    }

    // upgrade_level: =5>B@8F0B5;L=>5 F5;>5
    const ul = Number(copy.upgrade_level);
    copy.upgrade_level = (Number.isFinite(ul) && Number.isInteger(ul) && ul >= 0) ? ul : 0;

    // durability / max_durability: =5>B@8F0B5;L=K5 :>=5G=K5 G8A;0
    copy.durability = toFiniteNumber(copy.durability, 0);
    if (copy.durability < 0) copy.durability = 0;
    copy.max_durability = toFiniteNumber(copy.max_durability, equipmentRules.BASE_DURABILITY || 500);
    if (copy.max_durability < 1) copy.max_durability = 100;
    if (copy.durability > copy.max_durability) copy.durability = copy.max_durability;

    // stats / modifications: plain object 8;8 {}
    copy.stats = isPlainObject(copy.stats) ? deepClone(copy.stats) : {};
    copy.modifications = isPlainObject(copy.modifications) ? deepClone(copy.modifications) : {};

    // name/type/category/icon/slot: AB@>:8
    if (typeof copy.name !== 'string') copy.name = String(copy.name ?? '@54<5B');
    if (typeof copy.type !== 'string') copy.type = String(copy.type ?? 'misc');
    if (typeof copy.category !== 'string') copy.category = String(copy.category ?? copy.type);
    if (typeof copy.icon !== 'string') copy.icon = String(copy.icon ?? '=ж');
    if (copy.slot !== null && copy.slot !== undefined && typeof copy.slot !== 'string') {
        copy.slot = String(copy.slot);
    }

    // G8A;>2K5 AB0BK: ?@825AB8 : :>=5G=K< G8A;0<
    for (const key of Object.keys(copy.stats)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            delete copy.stats[key];
            continue;
        }
        const v = Number(copy.stats[key]);
        if (!Number.isFinite(v)) {
            delete copy.stats[key];
        } else {
            copy.stats[key] = v;
        }
    }

    return copy;
}

function normalizeInventory(value) {
    const parsed = safeJsonParse(value, []);

    if (Array.isArray(parsed)) {
        return parsed.map(normalizeInventoryItem).filter(Boolean);
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // A;8 >1J5:B 8<55B ?@87=0:8 ?@54<5B0 (id/name/type)  >15@=CBL 2 <0AA82
        if (isPlainObject(parsed) && (parsed.id !== undefined || parsed.name !== undefined || parsed.type !== undefined)) {
            const item = normalizeInventoryItem(parsed);
            return item ? [item] : [];
        }
        return Object.values(parsed).map(normalizeInventoryItem).filter(Boolean);
    }

    return [];
}

/**
 * 1I0O =>@<0;870F8O: ;N1>9 JSON 2 G8ABK9 >1J5:B (=5 <0AA82, =5 null).
 */
function normalizePlainObject(value) {
    const parsed = safeJsonParse(value, {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // 0I8B0 >B ?@>B>B8?=>3> 703@O7=5=8O: :>?8@C5< B>;L:> A>1AB25==K5 157>?0A=K5 :;NG8
    const out = Object.create(null);
    for (const key of Object.keys(parsed)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        out[key] = parsed[key];
    }
    return out;
}

/**
 * >@<0;870F8O stats ?@54<5B0
 */
function normalizeItemStats(value) {
    const obj = normalizePlainObject(value);
    if (!isPlainObject(obj)) return {};
    const out = {};
    for (const key of Object.keys(obj)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const v = Number(obj[key]);
        if (Number.isFinite(v)) out[key] = v;
    }
    return out;
}

/**
 * >AB@>8BL C=8D8F8@>20==K9 ?@54<5B 8=25=B0@O
 */
function createInventoryItem(item, options = {}) {
    const opts = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};

    const stats = normalizeItemStats(opts.stats !== undefined ? opts.stats : source.stats);
    const durability = toFiniteNumber(opts.durability ?? source.durability ?? (equipmentRules.BASE_DURABILITY || 500), (equipmentRules.BASE_DURABILITY || 500));
    const maxDurability = toFiniteNumber(opts.max_durability ?? source.max_durability ?? (equipmentRules.BASE_DURABILITY || 500), (equipmentRules.BASE_DURABILITY || 500));
    const rawModifications = opts.modifications ?? source.modifications ?? {};
    const modifications = isPlainObject(rawModifications) ? deepClone(rawModifications) : {};

    const safeId = (v) => {
        const n = Number(v);
        return Number.isSafeInteger(n) ? n : null;
    };

    return {
        id: (opts.id !== undefined ? safeId(opts.id) : (source.id !== undefined ? safeId(source.id) : null)),
        name: String(opts.name ?? source.name ?? '@54<5B'),
        type: String(opts.type ?? source.type ?? 'misc'),
        category: String(opts.category ?? source.category ?? opts.type ?? source.type ?? 'misc'),
        rarity: VALID_RARITIES.has(opts.rarity ?? source.rarity) ? (opts.rarity ?? source.rarity) : 'common',
        icon: String(opts.icon ?? source.icon ?? '=ж'),
        slot: (opts.slot ?? source.slot) == null ? null : String(opts.slot ?? source.slot),
        stats,
        damage: toFiniteNumber(opts.damage ?? source.damage ?? stats.damage ?? 0, 0),
        defense: toFiniteNumber(opts.defense ?? source.defense ?? stats.defense ?? 0, 0),
        heal: toFiniteNumber(opts.heal ?? source.heal ?? stats.health ?? stats.health_restore ?? 0, 0),
        rad_removal: toFiniteNumber(opts.rad_removal ?? source.rad_removal ?? stats.radiation_cure ?? 0, 0),
        contamination_resist: toFiniteNumber(
            opts.contamination_resist ?? source.contamination_resist
            ?? opts.radiation_resist ?? source.radiation_resist
            ?? opts.infection_resist ?? source.infection_resist
            ?? stats.radiation_resist ?? stats.infection_resist ?? 0, 0),
        radiation_resist: toFiniteNumber(opts.radiation_resist ?? source.radiation_resist ?? stats.radiation_resist ?? 0, 0),
        durability: Math.max(0, Math.min(durability, maxDurability)),
        max_durability: Math.max(1, maxDurability),
        quantity: (() => { const q = Number(opts.quantity ?? source.quantity ?? 1); return Number.isFinite(q) && Number.isInteger(q) && q > 0 ? q : 1; })(),
        upgrade_level: (() => { const u = Number(opts.upgrade_level ?? source.upgrade_level ?? 0); return Number.isFinite(u) && Number.isInteger(u) && u >= 0 ? u : 0; })(),
        modifications
    };
}

/**
 * >@<0;870F8O @0480F88
 */
function normalizeRadiation(value) {
    const parsed = safeJsonParse(value, { level: 0 });

    if (typeof parsed === 'number') {
        return {
            level: parsed,
            expires_at: null,
            applied_at: null
        };
    }

    if (parsed && typeof parsed === 'object') {
        return {
            level: Number(parsed.level || 0),
            expires_at: parsed.expires_at || null,
            applied_at: parsed.applied_at || null
        };
    }

    return {
        level: 0,
        expires_at: null,
        applied_at: null
    };
}

/**
 * >@<0;870F8O 0:B82=KE 10DD>2 83@>:0
 */
function normalizePlayerBuffs(value) {
    return normalizePlainObject(value);
}

/**
 * @54<5BK, :>B>@K5 =5;L7O ?@>40BL.
 * ;NG8 1>AA>2  20;NB0 ?@>3@5AA88: 8E =5;L7O >1@0B8BL 2 <>=5BK,
 * 8=0G5 <>6=> 1K;> 1K 15A:>=5G=> D0@<8BL <>=5BK, ?>:C?0O :;NG8 ?> :@C3C.
 */
const NON_SELLABLE_TYPES = new Set(['key', 'quest', 'currency', 'material']);

/** >;O >B F5=K 2 <03078=5, :>B>@CN 83@>: ?>;CG05B ?@8 ?@>4065 (548=K9 8AB>G=8:: equipment.js) */
const SELL_RATE = equipmentRules.SELL_RATE;
const SELL_FLOOR_BY_RARITY = equipmentRules.SELL_FLOOR_BY_RARITY || {};

/**
 * >AG8B0BL F5=C ?@>4068 >4=>3> ?@54<5B0.
 * &5=0 15@QBAO 87 B01;8FK items ?> id (=5 87 JSON 8=25=B0@O), ?>MB><C
 * ?>445;0BL AB>8<>ABL =0 :;85=B5 =52>7<>6=>.
 * @param {object|null} dbItem - AB@>:0 87 B01;8FK items
 * @param {object} inventoryItem - ?@54<5B 87 8=25=B0@O
 * @returns {number} F5=0 70 >4=C HBC:C
 */
function calculateSellPrice(dbItem, inventoryItem) {
    if (!dbItem) return 0;
    if (NON_SELLABLE_TYPES.has(String(dbItem.type || inventoryItem?.type || ''))) return 0;

    const shopPrice = Number(dbItem.price || 0);
    if (shopPrice > 0) {
        return Math.max(1, Math.floor(shopPrice * SELL_RATE));
    }

    const rarity = String(dbItem.rarity || inventoryItem?.rarity || 'common');
    return SELL_FLOOR_BY_RARITY[rarity] || SELL_FLOOR_BY_RARITY.common;
}

/**
 * >1028BL ?@54<5B 2 8=25=B0@L A CGQB>< AB0:>20=8O.
 *
 * 57 MB>3> ?>:C?:0 10 O1;>: A>74020;0 10 A;>B>2 (8 C?8@0;0AL 2
 * ;8<8B 2 100), E>BO 2 B01;8F5 items 5ABL stackable/max_stack.
 * !B0:CNBAO B>;L:> ?@54<5BK A >48=0:>2K<8 id, rarity 8 =C;52K<
 * upgrade_level  GB>1K =5 A<5H820BL 0?3@5965==K5 M:75<?;O@K.
 * @param {Array} inventory - B5:CI89 8=25=B0@L (<CB8@C5BAO)
 * @param {object} newItem - =>2K9 ?@54<5B 87 createInventoryItem()
 * @param {object|null} dbItem - AB@>:0 87 B01;8FK items (4;O stackable/max_stack)
 * @returns {number} A:>;L:> ?@54<5B>2 @50;L=> 4>102;5=> =>2K<8 A;>B0<8
 */
/**
 * "8?K ?@54<5B>2, :>B>@K5 =5;L7O A:;04K20BL 2 AB5:.
 * @>25@ONBAO 2<5AB5 A> A;>B><: :>;>=:0 items.slot nullable,
 * 8 C G0AB8 >@C68O >=0 ?CAB0O  157 ?@>25@:8 B8?0 420 >48=0:>2KE
 * <5G0 A;8;8AL 1K 2 >48= A;>B.
 *
 * 01>@ ?>2B>@O5B A;>BK equipment.js (COMBAT_SLOTS) ?;NA 'equipment' 
 * ;530A8-7=0G5=85 type C ?@54<5B>2, A>E@0=Q==KE 4> ?>O2;5=8O A;>B>2.
 * !;>B 'head' 87 :0=>=0 C40;Q= (1K; 0;80A>< 'helmet'), 2<5AB> =53> 'face'.
 */
const EQUIPMENT_TYPES = new Set([
    'weapon', 'armor', 'helmet', 'face', 'body',
    'hands', 'legs', 'boots', 'accessory', 'equipment'
]);

function addItemToInventory(inventory, newItem, dbItem) {
    if (!Array.isArray(inventory)) return 0;
    if (!newItem || typeof newItem !== 'object' || Array.isArray(newItem)) return 0;

    const item = deepClone(newItem);

    const type = String(item.type || dbItem?.type || '').toLowerCase();
    const category = String(item.category || dbItem?.category || type).toLowerCase();

    const isEquipment = Boolean(item.slot || dbItem?.slot)
        || EQUIPMENT_TYPES.has(type)
        || EQUIPMENT_TYPES.has(category);

    // stackable: O2=0O ?@>25@:0 falsy-7=0G5=89 (2:;NG0O null)
    const stackable = dbItem
        ? (dbItem.stackable !== false && dbItem.stackable !== 0 && dbItem.stackable !== '0'
           && dbItem.stackable !== 'false' && dbItem.stackable !== null)
        : true;

    // maxStack: :>=5G=>5 F5;>5 >= 1, A :0?>< 10000
    const rawMax = Number(dbItem?.max_stack ?? 99);
    const maxStack = (Number.isFinite(rawMax) && rawMax >= 1) ? Math.min(Math.floor(rawMax), 10000) : 99;

    const rawQty = Number(item.quantity);
    const quantity = (Number.isFinite(rawQty) && Number.isInteger(rawQty) && rawQty > 0) ? rawQty : 1;

    // id: 20;84=K9 safe-integer 8;8 null
    const newItemId = (item.id !== null && item.id !== undefined) ? (Number.isSafeInteger(Number(item.id)) ? Number(item.id) : null) : null;

    let remaining = quantity;

    // 57>?0A=>5 3;C1>:>5 A@02=5=85 157 JSON.stringify (70I8B0 >B F8:;>2/BigInt)
    const deepEqual = (a, b) => {
        if (a === b) return true;
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        const ka = Object.keys(a).sort();
        const kb = Object.keys(b).sort();
        if (ka.length !== kb.length) return false;
        for (let i = 0; i < ka.length; i++) {
            if (ka[i] !== kb[i]) return false;
            if (!deepEqual(a[ka[i]], b[kb[i]])) return false;
        }
        return true;
    };

    if (stackable && !isEquipment && type !== 'key' && Number(item.upgrade_level || 0) === 0 && newItemId !== null) {
        for (let i = 0; i < inventory.length && remaining > 0; i++) {
            const existing = inventory[i];
            if (!existing || typeof existing !== 'object' || Array.isArray(existing)) continue;
            const existingId = (existing.id !== null && existing.id !== undefined) ? (Number.isSafeInteger(Number(existing.id)) ? Number(existing.id) : null) : null;
            if (existingId !== newItemId) continue;
            if (existing.rarity !== item.rarity) continue;
            if (Number(existing.upgrade_level || 0) !== 0) continue;
            // 5 AB0:0BL ?@54<5BK A @07=>9 ?@>G=>ABLN/<>48D8:0F8O<8/AB0B0<8
            if (Number(existing.durability || 0) !== Number(item.durability || 0)) continue;
            if (Number(existing.max_durability || 0) !== Number(item.max_durability || 0)) continue;
            if (!deepEqual(existing.modifications || null, item.modifications || null)) continue;
            if (!deepEqual(existing.stats || null, item.stats || null)) continue;

            const currentQty = Math.max(0, Number.isFinite(Number(existing.quantity)) ? Number(existing.quantity) : 0);
            if (currentQty >= maxStack) continue;

            const toAdd = Math.min(maxStack - currentQty, remaining);
            inventory[i] = { ...existing, quantity: currentQty + toAdd };
            remaining -= toAdd;
        }
    }

    // 'B> =5 2;57;> 2 AB5:8  =>2K<8 A;>B0<8.
    let slotsAdded = 0;
    let iterations = 0;
    const MAX_ITERATIONS = 10000;
    while (remaining > 0 && iterations < MAX_ITERATIONS) {
        const chunk = Math.min(maxStack, remaining);
        inventory.push({ ...item, quantity: chunk });
        remaining -= chunk;
        slotsAdded++;
        iterations++;
    }

    return slotsAdded;
}

/**
 * >;CG8BL B>;L:> 0:B82=K5 10DDK 83@>:0
 */
function getActiveBuffs(value, now = Date.now()) {
    const buffs = normalizePlayerBuffs(value);
    const active = {};

    for (const [effect, buffData] of Object.entries(buffs)) {
        if (!buffData || typeof buffData !== 'object') continue;

        const expiresAtRaw = buffData.expires_at || buffData.expiresAt || buffData.expires;
        if (!expiresAtRaw) continue;

        const expiresAt = typeof expiresAtRaw === 'number'
            ? expiresAtRaw
            : new Date(expiresAtRaw).getTime();

        if (Number.isFinite(expiresAt) && expiresAt > now) {
            active[effect] = {
                ...buffData,
                expires_at: expiresAt
            };
        }
    }

    return active;
}

/**
 * >AB@>5=85 >1J5:B0 AB0BCA0 83@>:0.
 *
 * 48= 4510DD  radiation. =D5:F88 >1J548=5=K A @0480F859, ?>MB><C
 * AC<<0@=K9 C@>25=L 7>=K E@0=8BAO B>;L:> 2 players.radiation, 0 ?>;O
 * infections / infections_list 87 >B25B0 C1@0=K.
 */
function buildPlayerStatus(player) {
    const radiation = normalizeRadiation(player.radiation);

    return {
        health: Number(player.health || 0),
        max_health: Number(player.max_health || 0),
        radiation: radiation.level,
        fatigue: 0,
        energy: Number(player.energy || 0),
        max_energy: Number(player.max_energy || 0),
        last_energy_update: player.last_energy_update || null
    };
}

/**
 * 5@5AGQB M=5@388 =0 >A=>25 @50;L=> ?@>H54H53> 2@5<5=8.
 *  A1@0AK205B B09<5@ ?@8 B@0B5  @535= 84QB =5?@5@K2=>.
 * @param {object} client - :;85=B  (B@0=70:F8O)
 * @param {object} player - >1J5:B 83@>:0 (<CB8@C5B energy/last_energy_update)
 * @returns {object} B>B 65 player A >1=>2;Q==>9 M=5@3859
 */
async function recalcEnergy(client, player) {
    const now = Date.now();
    if (!player.last_energy_update) {
        await client.query('UPDATE players SET last_energy_update = $1 WHERE id = $2', [new Date(now).toISOString(), player.id]);
        player.last_energy_update = new Date(now).toISOString();
        return player;
    }
    const last = new Date(player.last_energy_update).getTime();
    if (!Number.isFinite(last)) return player;

    // A;8 <5B:0 2 1C4CI5<  =5 @535=8@C5<, => A428305< <5B:C =0 now,
    // GB>1K =5 «70<>@06820BL» @535= =02A5340.
    if (last > now) {
        await client.query('UPDATE players SET last_energy_update = $1 WHERE id = $2', [new Date(now).toISOString(), player.id]);
        player.last_energy_update = new Date(now).toISOString();
        return player;
    }

    const elapsedMs = Math.max(0, now - last);
    // 1 M=5@38O 70 8=B5@20; 87 >1I53> D09;0 ?@028; (60 c)
    const regen = Math.floor(elapsedMs / equipmentRules.ENERGY_REGEN_INTERVAL_MS);
    if (regen <= 0) return player;

    const currentEnergy = Number(player.energy || 0);
    const maxEnergy = Number(player.max_energy || 50);
    const newEnergy = Math.min(maxEnergy, currentEnergy + regen);

    if (newEnergy === currentEnergy) {
        // 3@>: C65 =0 <0:A8<C<5: @535=8@>20BL =5G53>, => /+ 42830BL
        // last_energy_update. =0G5 <5B:0 «70ABK205B» =0 <><5=B 70?>;=5=8O,
        // 0 ?>B>< ;N1>9 @0AE>4 (?>8A:/0B0:0) <3=>25==> 2>72@0I05BAO =0 :;85=B5:
        // getEffectivePlayerStatus() 4>G8BK205B @535= A ?@>H54H53> 2@5<5=8.
        await client.query(
            'UPDATE players SET last_energy_update = $1 WHERE id = $2',
            [new Date(now).toISOString(), player.id]
        );
        player.last_energy_update = new Date(now).toISOString();
        return player;
    }

    // !428305< <5B:C =0 D0:B8G5A:8 2>AAB0=>2;5==>5 2@5<O
    const newLast = new Date(last + regen * equipmentRules.ENERGY_REGEN_INTERVAL_MS).toISOString();
    await client.query(
        `UPDATE players SET energy = $1, last_energy_update = $2 WHERE id = $3`,
        [newEnergy, newLast, player.id]
    );
    player.energy = newEnergy;
    player.last_energy_update = newLast;
    return player;
}
/**
 * 0AA82=>5 2>AAB0=>2;5=85 74>@>2LO  ?> @50;L=> ?@>H54H5<C 2@5<5=8.
 *
 * @028;>: +1 HP 70 90 A5:C=4, 157 >3@0=8G5=89  @535= <>65B 25@=CBL
 * 74>@>2L5 4> 100% <0:A8<C<0. ?B5G:8 2 1>N >AB0NBAO =C6=K 4;O A@>G=>3>
 * ;5G5=8O, 0 @535= 2>AAB0=02;8205B <564C 1>O<8.
 *
 * 5B:0 last_hp_regen 428305BAO @>2=> =0 2>AAB0=>2;5==>5 2@5<O (:0:
 * last_energy_update C M=5@388), 8=0G5 =54>1@0==>5 2@5<O B5@O;>AL 1K.
 *
 * @param {object} client :;85=B  (B@0=70:F8O 8;8 ?C;)
 * @param {object} player >1J5:B 83@>:0 (<CB8@C5BAO)
 * @returns {Promise<number>} A:>;L:> HP 2>AAB0=>2;5=>
 */
async function regenerateHealth(client, player) {
    const maxHealth = Math.max(100, Number(player.max_health) || 100);
    const cap = Math.floor(maxHealth * (equipmentRules.HEALTH_REGEN_CAP_RATIO || 1.0));
    const effectiveMax = Math.max(1, cap);
    const current = Math.max(0, Number(player.health) || 0);

    const regenerable = Math.max(0, effectiveMax - current);
    const nowStamp = new Date().toISOString();

    if (regenerable <= 0) {
        // @8 ?>;=>< 74>@>2L5 <5B:C 2AQ @02=> 428305<: 8=0G5 >=0 «70ABK=5B»
        // 8 ?@8 A;54CNI5< C@>=5 =0:>?8BAO 2@5<O A ?@>H;>3> @070.
        await client.query('UPDATE players SET last_hp_regen = $1 WHERE id = $2', [nowStamp, player.id]);
        player.last_hp_regen = nowStamp;
        return 0;
    }

    const last = player.last_hp_regen ? new Date(player.last_hp_regen).getTime() : NaN;
    const now = Date.now();

    if (!Number.isFinite(last)) {
        // 5@2K9 70?CA:: B>;L:> AB028< <5B:C, =8G53> =5 =0G8A;O5<.
        await client.query('UPDATE players SET last_hp_regen = $1 WHERE id = $2', [nowStamp, player.id]);
        player.last_hp_regen = nowStamp;
        return 0;
    }

    const steps = Math.floor((now - last) / equipmentRules.HEALTH_REGEN_INTERVAL_MS);
    if (steps <= 0) return 0;

    const restored = Math.min(steps, regenerable);
    const newHealth = current + restored;
    // 5B:C 428305< =0 D0:B8G5A:8 =0G8A;5==>5 2@5<O: 5A;8 74>@>2L5 C65
    // ?>;=>5, «;8H=55» 2@5<O =5 4>;6=> =0:0?;820BLAO.
    const consumedMs = restored * equipmentRules.HEALTH_REGEN_INTERVAL_MS;
    const newLast = new Date(last + Math.max(consumedMs, 0)).toISOString();

    await client.query(
        'UPDATE players SET health = $1, last_hp_regen = $2 WHERE id = $3',
        [newHealth, newLast, player.id]
    );

    player.health = newHealth;
    player.last_hp_regen = newLast;
    return restored;
}


/**
 * >@<0;870F8O M:8?8@>2:8 A 20;840F859 A;>B>2.
 *
 * !;>BK 15@Q< 87 public/shared/equipment.js  B>3> 65 D09;0, GB> G8B05B
 * 1@0C75@: @0AE>645=85 A?8A:>2 >7=0G0;> 1K ?@54<5BK, :>B>@K5 A5@25@
 * AG8B05B «=045BK<8», 0 1>9 =5 CG8BK205B.
 *
 * : =57=0:><K5 A;>BK !% /, 0 =5 2K1@0AK205<.  0=LH5 DC=:F8O
 * >AB02;O;0 B>;L:> COMBAT_SLOTS, 8 2AQ >AB0;L=>5 <>;G0 B5@O;>AL. -B>
 * AB8@0;> ?@54<5BK: 2K7K20NI89 :>4 (unequip, PvP, <0AB5@A:0O) ?@028B
 * ?>;CG5==K9 >1J5:B 8 ?8H5B 53> >1@0B=> 2 players.equipment, ?>MB><C
 * ?@54<5B 2 A;>BC, :>B>@>3> =5B 2 B5:CI5< A?8A:5, 8AG570; 87  =02A5340.
 * <5==> B0: ?@>?0;0 @<59A:0O :0A:0: A;>B 'head' C1@0;8 87 :0=>=0, 0
 * 83@0 45@60;0 :0A:C 2 equipment.head.
 *
 * 58725AB=K9 A;>B =5 CG0AB2C5B =8 2 70I8B5, =8 2 87=>A5 (2A5 @0AGQBK
 * 84CB ?> COMBAT_SLOTS), => ?@54<5B >AB0QBAO 682K< 8 ?5@568205B A<5=C
 * :0B0;>30  53> <>6=> 1C45B A=OBL 8;8 ?5@5=5AB8 <83@0F859.
 */
function normalizeEquipment(raw) {
    const eq = safeJsonParse(raw, {});

    if (!isPlainObject(eq)) return {};

    const out = Object.create(null);
    for (const slot of Object.keys(eq)) {
        if (slot === '__proto__' || slot === 'constructor' || slot === 'prototype') continue;
        const item = eq[slot];
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const normalized = normalizeInventoryItem(item);
        if (normalized) out[slot] = normalized;
    }
    return out;
}

// ==========================================
// !"+, !  !'"'   !!
// ==========================================

// 1I85 ?@028;0 ?@54<5B>2 682CB 2 public/shared/equipment.js  >BBC40 65
// 15@Q< ?@>G=>ABL, 0?3@594 8 1>=CAK A5B>2, GB>1K A5@25@ 8 :;85=B AG8B0;8
// >48=0:>2>.

/**
 * >=CAK A5B>2 ?> =045B>9 M:8?8@>2:5.
 * @param {object} equipment M:8?8@>2:0 83@>:0
 * @returns {Promise<Record<string, number>>}
 */
/**
 * >=CAK =045BKE A5B>2 ?@54<5B>2.
 *
 * @param {Object} equipment - M:8?8@>2:0 83@>:0 (JSON 87 players.equipment)
 * @param {Object} [client] - :;85=B 0:B82=>9 B@0=70:F88. A5 ?@>40:H=-2K7>2K
 *   84CB 2=CB@8 transaction()/withClient() 8 ?5@540NB 53>: 8=0G5 3;>10;L=K9
 *   query() 15@QB ", A>548=5=85 87 ?C;0, 8 ?>:0 B@0=70:F8O 45@68B
 *   FOR UPDATE =0 AB@>:5 83@>:0, C45@6820NBAO 420 A>548=5=8O (?C; max 20).
 * @returns {Promise<Object>} 1>=CAK A5B>2
 */
async function getSetBonuses(equipment, client) {
    // $>;;1M: =0 3;>10;L=K9 query 4;O read-only AF5=0@852 157 B@0=70:F88.
    const queryFn = client && typeof client.query === 'function' ? client.query.bind(client) : query;
    const sets = await queryFn('SELECT id, bonus_2, bonus_3, bonus_4 FROM item_sets ORDER BY id');
    return equipmentRules.calculateSetBonuses(equipment, (sets.rows || []).map((row) => ({
        id: row.id,
        bonus_2: safeJsonParse(row.bonus_2, {}),
        bonus_3: safeJsonParse(row.bonus_3, {}),
        bonus_4: safeJsonParse(row.bonus_4, {})
    })));
}

/**
 * 7=>A M:8?8@>2:8 ?> A;>B0< 8 70?8AL @57C;LB0B0.
 *
 * 7=>A A8<<5B@8G5=: 1 548=8F0 70 C40@, A;><0==K9 ?@54<5B B5@O5B 1>=CAK,
 * => >AB0QBAO 2 8=25=B0@5 8 G8=8BAO 2 <0AB5@A:>9.
 *
 * @param {object} client :;85=B  (B@0=70:F8O)
 * @param {number} playerId
 * @param {object} equipment M:8?8@>2:0 (<CB8@C5BAO)
 * @param {string[]} slots :0:85 A;>BK 87=0H820BL
 * @returns {string[]} A?8A>: A;>B>2, 345 ?@54<5B A;><0;AO (4;O >B25B0 :;85=BC)
 */
function wearEquipmentSlots(equipment, slots) {
    if (!equipment || !Array.isArray(slots) || slots.length === 0) return [];

    const broken = [];
    for (const slot of slots) {
        const item = equipment[slot];
        if (!item) continue;
        equipment[slot] = equipmentRules.wearEquipment(item, 1);
        if (equipmentRules.getDurabilityInfo(equipment[slot]).isBroken) {
            broken.push(slot);
        }
    }
    return broken;
}

/**
 * >?>;=8BL unique_items =>2K<8 id ?@54<5B>2.
 *
 * >;5 G8B0NB 4>AB865=8O «>;;5:F8>=5@»/«%@0=8B5;L» (10 8 25 C=8:0;L=KE
 * ?@54<5B>2), => =5 >1=>2;O; =8:B>  ?@>3@5AA =02A5340 >AB020;AO 0.
 *
 * @param {object} client :;85=B 
 * @param {number} playerId
 * @param {Iterable<number|string>} itemIds
 */
async function trackCollectedItems(client, playerId, itemIds) {
    const ids = [...new Set(Array.from(itemIds || []).map(Number).filter(Number.isFinite))];
    if (ids.length === 0) return;

    await client.query(`
        UPDATE players
           SET unique_items = (
                   SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
                      FROM jsonb_array_elements(
                          COALESCE(unique_items, '[]'::jsonb) || $2::jsonb
                      ) AS value
               )
         WHERE id = $1
    `, [playerId, JSON.stringify(ids)]);
}

/**
 * @>3@5AA 5654=52=>3> 7040=8O.
 *
 * >;O current_value/completed 2 daily_tasks 1K;8, => 8E =5 <5=O; =8 >48=
 * >1@01>BG8:: 7040=8O ?>:07K20;8AL, => =5 2K?>;=O;8AL. task_type A>2?0405B A
 * B5<8, GB> 2K40QB routes/api.js: search / boss_damage / collect_items.
 *
 * @param {object} client :;85=B 
 * @param {number} playerId
 * @param {string} taskType
 * @param {number} amount =0 A:>;L:> C25;8G8BL ?@>3@5AA
 * @returns {Promise<number>} =>2>5 7=0G5=85 current_value (0  7040=89 =5B)
 */
const DAILY_TASK_TYPES = [
    { type: 'search', target: (level) => Math.max(3, Math.floor(level / 5) + 3), reward: { coins: 50, xp: 20 }, difficulty: 'easy' },
    { type: 'boss_damage', target: (level) => 100 * level, reward: { coins: 100, xp: 50 }, difficulty: 'medium' },
    { type: 'collect_items', target: (level) => Math.max(5, Math.floor(level / 3) + 5), reward: { coins: 75, xp: 30 }, difficulty: 'easy' },
    { type: 'pvp_wins', target: () => 1, reward: { coins: 150, xp: 75 }, difficulty: 'hard' },
    { type: 'locations_visited', target: (level) => Math.max(2, Math.floor(level / 10) + 2), reward: { coins: 60, xp: 25 }, difficulty: 'easy' },
    { type: 'boss_kill', target: () => 1, reward: { coins: 200, xp: 100 }, difficulty: 'hard' },
];

async function progressDailyTask(client, playerId, taskType, amount) {
    const delta = Math.max(0, Math.round(Number(amount) || 0));
    if (delta === 0) return { updated: 0, completed: [], total_progress: 0 };

    // 5=5@0F8O 7040=89 =0 45=L, 5A;8 8E =5B
    const existing = await client.query(
        `SELECT id FROM daily_tasks WHERE player_id = $1 AND expires_at > NOW()`,
        [playerId]
    );
    if (existing.rows.length === 0) {
        // 5=5@8@C5< 3 7040=8O
        const player = await client.query('SELECT level FROM players WHERE id = $1', [playerId]);
        const level = Number(player.rows[0]?.level) || 1;
        const types = DAILY_TASK_TYPES || [];
        const picked = [];
        const pool = [...types];
        while (picked.length < 3 && pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
        }
        const expiresAt = new Date();
        expiresAt.setHours(24, 0, 0, 0);
        for (const t of picked) {
            const target = t.target(level);
            const reward = { ...t.reward };
            await client.query(`
                INSERT INTO daily_tasks (player_id, task_type, target_value, current_value, reward, expires_at, completed, claimed, difficulty, status, created_at)
                VALUES ($1, $2, $3, 0, $4::jsonb, $5, false, false, $6, 'active', NOW())
                ON CONFLICT (player_id, task_type, expires_at) DO NOTHING
            `, [playerId, t.type, target, JSON.stringify(reward), expiresAt, t.difficulty]);
        }
    }

    const result = await client.query(`
        UPDATE daily_tasks
           SET current_value = LEAST(target_value, current_value + $3),
               completed = (LEAST(target_value, current_value + $3) >= target_value)
         WHERE player_id = $1
           AND task_type = $2
           AND completed = false
           AND expires_at > NOW()
        RETURNING id, current_value, target_value, completed, reward
    `, [playerId, taskType, delta]);

    const completed = result.rows.filter((r) => r.completed);
    const totalProgress = result.rows.reduce((sum, r) => sum + (r.current_value || 0), 0);

    return { updated: result.rows.length, completed, total_progress: totalProgress };
}

const CONTRACT_TYPES = [
    { type: 'hunt', target: (level) => Math.max(1, Math.floor(level / 10) + 1), reward: { coins: 200, xp: 100 }, difficulty: 'hard', reputation: 10, targetType: 'boss_kill' },
    { type: 'rescue', target: (level) => Math.max(1, Math.floor(level / 5) + 1), reward: { coins: 150, xp: 75 }, difficulty: 'medium', reputation: 8, targetType: 'boss_damage' },
    { type: 'rat_hunt', target: () => 10, reward: { coins: 50, xp: 20 }, difficulty: 'easy', reputation: 5, targetType: 'rat_kill' },
    { type: 'scout', target: (level) => Math.max(2, Math.floor(level / 10) + 2), reward: { coins: 60, xp: 25 }, difficulty: 'easy', reputation: 3, targetType: 'locations_visited' },
    { type: 'gather', target: (level) => Math.max(5, Math.floor(level / 3) + 5), reward: { coins: 75, xp: 30 }, difficulty: 'easy', reputation: 4, targetType: 'collect_items' },
];

async function progressContract(client, playerId, targetType, amount) {
    const delta = Math.max(0, Math.round(Number(amount) || 0));
    if (delta === 0) return { updated: 0, completed: [] };

    const result = await client.query(
        "UPDATE survivor_contracts SET current_value = LEAST(target_value, current_value + $3), completed = (LEAST(target_value, current_value + $3) >= target_value) WHERE player_id = $1 AND target_type = $2 AND completed = false AND claimed = false AND expires_at > NOW() RETURNING id, current_value, target_value, completed, reward",
        [playerId, targetType, delta]
    );

    const completed = result.rows.filter((r) => r.completed);
    return { updated: result.rows.length, completed };
}

// ==========================================
// !!" !" (87 achievements.js)
// ==========================================

/**
 * >;CG8BL B5:CI55 7=0G5=85 4;O ?@>25@:8 4>AB865=8O
 */
function getAchievementCurrentValue(condition, player, runtimeContext) {
    switch (condition.type) {
        case 'level':
            return player.level || 1;
        case 'days_played':
            return player.days_played || 1;
        case 'bosses_killed':
        case 'boss_kills':
        case 'first_boss_kill':
            return runtimeContext?.totalBossesKilled || player.bosses_killed || 0;
        case 'single_boss_kills':
            return runtimeContext?.maxSingleBossKills || 0;
        case 'all_bosses_killed':
            return runtimeContext?.defeatedBosses || 0;
        case 'pvp_wins':
            return player.pvp_wins || 0;
        case 'unique_items':
            return Array.isArray(player.unique_items) ? player.unique_items.length : 0;
        case 'locations_visited':
            return Array.isArray(player.locations_visited) ? player.locations_visited.length : 0;
        case 'radiation_level':
            return normalizeRadiationLevel(player.radiation) || 0;
        case 'in_clan':
            return player.clan_id ? 1 : 0;
        case 'clan_leader':
            return player.clan_role === 'leader' ? 1 : 0;
        case 'clans_joined':
            return player.clans_joined || 0;
        case 'loot':
        case 'items_collected':
            return player.items_collected || 0;
        case 'streak':
            return player.daily_streak || 0;
        default:
            return 0;
    }
}

/**
 * >;CG8BL F5;52>5 7=0G5=85 4;O 4>AB865=8O
 */
function getAchievementTargetValue(condition, runtimeContext) {
    if (condition.type === 'all_bosses_killed') {
        return Math.max(1, runtimeContext?.totalBosses || 0);
    }
    if (condition.type === 'first_boss_kill') {
        return 1;
    }
    if (condition.type === 'in_clan' || condition.type === 'clan_leader') {
        return 1;
    }
    return Number(condition.count || condition.value || 0);
}

/**
 * >;CG8BL :>=B5:AB 4;O 4>AB865=89 (40==K5 87 )
 */
async function getAchievementRuntimeContext(client, playerId) {
    const fn = client
        ? (sql, params) => client.query(sql, params).then(r => r.rows[0])
        : (sql, params) => query(sql, params).then(r => r.rows[0]);

    const row = await fn(`
        SELECT
            (SELECT COUNT(*) FROM bosses) AS total_bosses,
            (SELECT COUNT(DISTINCT boss_id) FROM boss_mastery WHERE player_id = $1 AND kills > 0) AS defeated_bosses,
            (SELECT COALESCE(MAX(kills), 0) FROM boss_mastery WHERE player_id = $1) AS max_single_boss_kills,
            (SELECT COALESCE(SUM(kills), 0) FROM boss_mastery WHERE player_id = $1) AS total_bosses_killed
    `, [playerId]);

    return {
        totalBosses: Number(row?.total_bosses || 0),
        defeatedBosses: Number(row?.defeated_bosses || 0),
        maxSingleBossKills: Number(row?.max_single_boss_kills || 0),
        totalBossesKilled: Number(row?.total_bosses_killed || 0)
    };
}

/**
 * @>25@8BL 8 2K40BL 4>AB865=8O 83@>:C (=0 >A=>25 B01;8FK achievements)
 * @param {number} playerId - ID 83@>:0
 * @param {object} client - >?F8>=0;L=K9 :;85=B  4;O B@0=70:F89
 */
async function checkAchievements(playerId, client = null) {
    try {
        const fn = client
            ? (sql, params) => client.query(sql, params)
            : (sql, params) => query(sql, params);

        // >;CG05< 2A5 4>AB865=8O 87 B01;8FK
        const achResult = await fn('SELECT * FROM achievements ORDER BY id', []);
        const achievements = achResult.rows || [];

        if (!achievements.length) return [];

        // >;CG05< C65 2K40==K5 4>AB865=8O
        const ownedResult = await fn(
            'SELECT achievement_id FROM player_achievements WHERE player_id = $1 AND completed = true',
            [playerId]
        );
        const owned = new Set(ownedResult.rows?.map(r => r.achievement_id) || []);

        // >;CG05< 40==K5 83@>:0
        const playerResult = await fn(
            `SELECT level, bosses_killed, pvp_wins, items_collected,
                    daily_streak, unique_items, locations_visited,
                    clan_id, clan_role, clans_joined,
                    radiation
             FROM players WHERE id = $1`,
            [playerId]
        );
        const player = playerResult.rows?.[0];
        if (!player) return [];

        // >;CG05< :>=B5:AB 4;O 4>AB865=89
        const runtimeContext = await getAchievementRuntimeContext(client, playerId);

        const newAchievements = [];

        for (const ach of achievements) {
            if (owned.has(ach.id)) continue;

            const condition = safeJsonParse(ach.condition, {});
            if (!condition.type) continue;

            const currentValue = getAchievementCurrentValue(condition, player, runtimeContext);
            const targetValue = getAchievementTargetValue(condition, runtimeContext);

            if (currentValue >= targetValue) {
                // K40Q< 4>AB865=85  8A?>;L7C5< ?5@540==K9 client 8;8 transaction()
                const wasInserted = client
                    ? await insertAchievement(client, playerId, ach, currentValue)
                    : await transaction(async (txClient) => {
                        return await insertAchievement(txClient, playerId, ach, currentValue);
                    });

                if (wasInserted) {
                    const reward = safeJsonParse(ach.reward, {});
                    newAchievements.push({
                        id: ach.id,
                        name: ach.name,
                        description: ach.description,
                        reward: reward
                    });
                }
            }
        }

        return newAchievements;
    } catch (err) {
        logger.error({ type: 'check_achievements_error', message: err.message, stack: err.stack });
        return [];
    }
}

/**
 * ><5B8BL 4>AB865=85 2K?>;=5==K< (2 B@0=70:F88).
 *
 * : =03@04C 745AL  2K40Q<. 48=AB25==K9 8AB>G=8: 2K40G8  M=4?>8=B
 * claim (:=>?:0 «>;CG8BL» 2 UI); 5A;8 2K40BL 5Q 5IQ 8 745AL, 83@>: ?>;CG8B
 * 42>9=CN =03@04C 70 :064>5 4>AB865=85.
 */
async function insertAchievement(client, playerId, ach, progressValue) {
    const reward = safeJsonParse(ach.reward, {});

    // AB02;O5< 8;8 >1=>2;O5< 4>AB865=85. ON CONFLICT  B@>305B
    // reward_claimed: C65 ?>;CG5==0O =03@040 >AB0QBAO ?>;CG5==>9.
    const insertResult = await client.query(
        `INSERT INTO player_achievements (player_id, achievement_id, progress_value, completed, completed_at, reward_claimed)
         VALUES ($1, $2, $3, true, NOW(), false)
         ON CONFLICT (player_id, achievement_id)
         DO UPDATE SET completed = true, completed_at = NOW(), progress_value = $3
         RETURNING id`,
        [playerId, ach.id, progressValue]
    );

    if (insertResult.rowCount === 0) return false;

    logger.info({
        type: 'achievement_unlocked',
        playerId,
        achievement: ach.name,
        reward_available: reward
    });

    return true;
}

/**
 * >;CG8BL 2A5 4>AB865=8O 83@>:0
 */
async function getPlayerAchievements(playerId) {
    try {
        const result = await query(`
            SELECT a.id, a.name, a.description, a.category, a.icon, a.rarity,
                   a.condition, a.reward,
                   pa.completed, pa.completed_at, pa.reward_claimed, pa.progress_value
            FROM achievements a
            LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
            ORDER BY a.category, a.id
        `, [playerId]);

        return (result.rows || []).map(row => ({
            id: row.id,
            key: String(row.id),
            name: row.name,
            desc: row.description,
            type: row.category,
            category: row.category,
            icon: row.icon,
            rarity: row.rarity,
            req: safeJsonParse(row.condition, {}).count || 0,
            reward: safeJsonParse(row.reward, {}).stars || 0,
            obtained: row.completed || false,
            rewarded_at: row.completed_at,
            reward_claimed: row.reward_claimed || false,
            progress_value: row.progress_value || 0
        }));
    } catch (err) {
        logger.error({ type: 'get_achievements_error', message: err.message });
        return [];
    }
}

/**
 * >;CG8BL ?@>3@5AA 83@>:0 ?> 2A5< B8?0< 4>AB865=89
 */
async function getPlayerProgress(playerId) {
    try {
        const playerResult = await query(
            `SELECT level, bosses_killed, pvp_wins, items_collected,
                    daily_streak, radiation
             FROM players WHERE id = $1`,
            [playerId]
        );

        if (!playerResult.rows.length) return null;

const p = playerResult.rows[0];
    let runtimeContext = { totalBossesKilled: 0 };
    try {
        runtimeContext = await getAchievementRuntimeContext(null, playerId);
    } catch (_) { /* fallback */ }

        const progress = {
            level: { current: p.level, achievements: [] },
            boss: { current: runtimeContext.totalBossesKilled || p.bosses_killed || 0, achievements: [] },
            pvp: { current: p.pvp_wins || 0, achievements: [] },
            loot: { current: p.items_collected || 0, achievements: [] },
            streak: { current: p.daily_streak || 0, achievements: [] }
        };

        // 0?>;=O5< ?@>3@5AA ?> :064><C B8?C
        const achievementsResult = await query('SELECT * FROM achievements ORDER BY id');
        const achievements = achievementsResult.rows || [];

        for (const ach of achievements) {
            const condition = safeJsonParse(ach.condition, {});
            const type = condition.type || '';
            const category = ach.category || '';

            // ?@545;O5< B8? ?@>3@5AA0
            let progressType = null;
            if (type === 'level') progressType = 'level';
            else if (type.includes('boss')) progressType = 'boss';
            else if (type === 'pvp_wins') progressType = 'pvp';
            else if (type === 'loot' || type === 'items_collected') progressType = 'loot';
            else if (type === 'streak') progressType = 'streak';
            else if (category && progress[category]) progressType = category;

            if (progressType && progress[progressType]) {
                const targetValue = getAchievementTargetValue(condition, runtimeContext);
                progress[progressType].achievements.push({
                    id: ach.id,
                    name: ach.name,
                    req: targetValue,
                    current: progress[progressType].current,
                    completed: progress[progressType].current >= targetValue
                });
            }
        }

        return progress;
    } catch (err) {
        logger.error({ type: 'get_progress_error', message: err.message });
        return null;
    }
}

/**
 * 0G8A;8BL 20;NBC (<>=5BK 8/8;8 72Q74K) 83@>:C.
 * A?>;L7C5BAO 4;O =03@04 70 4>AB865=8O, 1>=CAK 8 B.4.
 *
 * @param {object} client - :;85=B  (B@0=70:F8O)
 * @param {number} playerId - ID 83@>:0
 * @param {object} reward - >1J5:B =03@04K { coins?: number, stars?: number }
 * @param {boolean} touchUpdatedAt - >1=>2;OBL ;8 updated_at (?> C<>;G0=8N false)
 * @returns {Promise<void>}
 */
async function grantCurrencyReward(client, playerId, reward, touchUpdatedAt = false) {
    if (!reward || typeof reward !== 'object') {
        return;
    }
    
    const coins = Math.max(0, Math.floor(Number(reward.coins) || 0));
    const stars = Math.max(0, Math.floor(Number(reward.stars) || 0));
    
    if (coins === 0 && stars === 0) {
        return; // 5B =03@04  =5 45;05< 70?@>A
    }
    
    const updates = [];
    const params = [playerId];
    let paramIdx = 2;
    
    if (coins > 0) {
        updates.push(`coins = coins + $${paramIdx++}`);
        params.push(coins);
    }
    
    if (stars > 0) {
        updates.push(`stars = stars + $${paramIdx++}`);
        params.push(stars);
    }
    
    if (touchUpdatedAt) {
        updates.push('updated_at = NOW()');
    }
    
    if (updates.length > 0) {
        await client.query(
            `UPDATE players SET ${updates.join(', ')} WHERE id = $1`,
            params
        );
    }
}

/**
 * >;CG8BL =03@04C 70 4>AB865=85.
 * @>25@O5B, GB> 4>AB865=85 2K?>;=5=> 8 =03@040 =5 ?>;CG5=0, 70B5< 2K405B =03@04C.
 *
 * @param {number} playerId - ID 83@>:0
 * @param {number} achievementId - ID 4>AB865=8O
 * @returns {Promise<{success: boolean, message: string, new_balance: {coins: number, stars: number}}>}
 */
async function claimAchievementReward(playerId, achievementId) {
    return await transaction(async (client) => {
        // >;CG05< 4>AB865=85 8 ?@>3@5AA 83@>:0
        const achResult = await client.query(`
            SELECT a.id, a.name, a.reward, a.category,
                   pa.completed, pa.reward_claimed
            FROM achievements a
            LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
            WHERE a.id = $2
        `, [playerId, achievementId]);

        if (!achResult.rows.length) {
            throw { message: '>AB865=85 =5 =0945=>', code: 'ACHIEVEMENT_NOT_FOUND', statusCode: 404 };
        }

        const ach = achResult.rows[0];

        if (!ach.completed) {
            throw { message: '>AB865=85 5IQ =5 2K?>;=5=>', code: 'NOT_COMPLETED', statusCode: 400 };
        }

        // P0-2: ?@02> =0 =03@04C 7018@05BAO " , 0 =5 «?@>G8B0;8->1=>28;8».
        //
        // > 8A?@02;5=8O ?@>25@:0 reward_claimed 8 ?><5B:0 1K;8 @07=K<8
        // >?5@0F8O<8: 420 ?0@0;;5;L=KE POST /achievements/claim G8B0;8
        // reward_claimed = false >10, >10 =0G8A;O;8 20;NBC, >10 ?8A0;8
        // reward_claimed = true. 064K9 ?0@0;;5;L=K9 70?@>A = +N <>=5B.
        //
        // UPDATE ... AND reward_claimed = false A0< 15@QB 1;>:8@>2:C AB@>:8:
        // 2B>@>9 70?@>A 64QB, 0 ?>A;5 COMMIT ?5@2>3> ?5@5?@>25@O5B CA;>285
        // C65 ?> =>2>9 25@A88 AB@>:8 8 ?>;CG05B 0 rows. RETURNING-AB@>:0 8
        // 5ABL ?@87=0: «O deed winner».
        //
        // ><5B:0 84QB  =0G8A;5=8O, => 2 B>9 65 B@0=70:F88: 5A;8
        // grantCurrencyReward C?04QB, ROLLBACK 25@=QB reward_claimed = false
        // 8 83@>: A<>65B 701@0BL =03@04C ?>2B>@=>.
        const claimed = await client.query(`
            UPDATE player_achievements
               SET reward_claimed = true, claimed_at = NOW()
             WHERE player_id = $1
               AND achievement_id = $2
               AND completed = true
               AND reward_claimed = false
             RETURNING achievement_id
        `, [playerId, achievementId]);

        if (claimed.rows.length === 0) {
            // 0?8AL =5 >1=>28;0AL. @8G8=0  ;81> 3>=:0 (4@C3>9 70?@>A 701@0;
            // ?5@2K<), ;81> A>AB>O=85 87<5=8;>AL <564C SELECT 8 UPDATE.
            // 5@5G8BK205<, GB>1K >B40BL 83@>:C B>G=CN ?@8G8=C.
            const current = await client.query(`
                SELECT completed, reward_claimed
                  FROM player_achievements
                 WHERE player_id = $1 AND achievement_id = $2
            `, [playerId, achievementId]);

            if (!current.rows[0]) {
                throw { message: '@>3@5AA ?> 4>AB865=8N =5 =0945=', code: 'ACHIEVEMENT_NOT_FOUND', statusCode: 404 };
            }
            if (!current.rows[0].completed) {
                throw { message: '>AB865=85 5IQ =5 2K?>;=5=>', code: 'NOT_COMPLETED', statusCode: 400 };
            }
            throw { message: '03@040 C65 ?>;CG5=0', code: 'ALREADY_CLAIMED', statusCode: 400 };
        }

        // 0@A8< =03@04C
        const reward = safeJsonParse(ach.reward, {});
        const coins = Math.max(0, Math.floor(Number(reward.coins) || 0));
        const stars = Math.max(0, Math.floor(Number(reward.stars) || 0));

        // K405< =03@04C
        if (coins > 0 || stars > 0) {
            await grantCurrencyReward(client, playerId, { coins, stars }, false);
        }

        // >38@C5<
        await logPlayerAction(playerId, 'claim_achievement', {
            achievement_id: achievementId,
            coins,
            stars
        }, client);

        // >72@0I05< =>2K9 10;0=A
        const balanceResult = await client.query(
            'SELECT coins, stars FROM players WHERE id = $1',
            [playerId]
        );

        return {
            message: `03@040 70 «${ach.name}» ?>;CG5=0${coins > 0 ? ` (+${coins} >™)` : ''}${stars > 0 ? ` (+${stars} P)` : ''}`,
            new_balance: {
                coins: Number(balanceResult.rows[0]?.coins || 0),
                stars: Number(balanceResult.rows[0]?.stars || 0)
            }
        };
    });
}

/**
 * =8F80;878@>20BL B01;8FC 4>AB865=89.
 * P2-12: 548=K9 8AB>G=8: 4>AB865=89  seed 2 schema.js (22 70?8A8:
 * survival, bosses, pvp, exploration, social, collection, daily).
 * $C=:F8O A0<0 =8G53> =5 2AB02;O5B, B>;L:> AG8B05B 70?8A8 8 ?@54C?@56405B,
 * 5A;8 B01;8F0 ?CAB0. AB02;5=0 4;O >1@0B=>9 A>2<5AB8<>AB8 2K7>2>2.
 */
async function initAchievementsTable() {
    const countResult = await query('SELECT COUNT(*) as cnt FROM achievements');
    const count = Number(countResult.rows[0]?.cnt || 0);

    if (count === 0) {
        logger.warn('[achievements] B01;8F0 achievements ?CAB0  >68405BAO =0?>;=5=85 G5@57 db/schema.js (<83@0F88). !B0@K9 =01>@ =5 2AB02;O5BAO 2> 871560=85 4C1;59.');
    }
    return count;
}

// ==========================================
// -! "
// ==========================================

/**
 * #<5=LH8BL :>;8G5AB2> ?@54<5B0 2 8=25=B0@5 =0 1 (A CGQB>< AB0:>2).
 * A?>;L7C5BAO 2<5AB> @CG=>3> splice/quantity-- 2> 2A5E <5AB0E.
 *
 * @param {Array} inventory - <0AA82 ?@54<5B>2 8=25=B0@O (C65 =>@<0;87>20==K9)
 * @param {number} itemIndex - 8=45:A ?@54<5B0 2 <0AA825
 * @returns {Object} { updatedInventory, item, quantityLeft }
 *   - updatedInventory: =>2K9 <0AA82 8=25=B0@O (:>?8O, =5 <CB8@C5B >@838=0;)
 *   - item: ?@54<5B, :>B>@K9 1K; ?>B@51;Q=
 *   - quantityLeft: :>;8G5AB2> ?@54<5B>2, >AB02H8EAO ?>A;5 ?>B@51;5=8O
 */
function consumeInventoryItem(inventory, itemIndex) {
    const item = inventory[itemIndex];
    if (!item) {
        return { updatedInventory: inventory, item: null, quantityLeft: 0 };
    }
    
    const rawQty = Number(item.quantity);
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
        return { updatedInventory: inventory, item: null, quantityLeft: 0 };
    }
    const currentQty = rawQty;
    const remainingQty = currentQty - 1;
    
    // !>740Q< :>?8N 8=25=B0@O (8<<CB015;L=>)
    const updatedInventory = [...inventory];
    
    if (remainingQty > 0) {
        updatedInventory[itemIndex] = { ...item, quantity: remainingQty };
    } else {
        updatedInventory.splice(itemIndex, 1);
    }
    
    return { updatedInventory, item, quantityLeft: remainingQty };
}

// !8=E@>=870F8O 8=25=B0@O 87 JSONB 2 =>@<0;87>20==CN B01;8FC player_inventory.
// K7K205BAO ?>A;5 <CB0F89 8=25=B0@O 4;O ?>445@60=8O 0:BC0;L=>AB8 =>2>9 B01;8FK.
// 'B5=85 8=25=B0@O 87 =>@<0;87>20==>9 B01;8FK player_inventory.
// >72@0I05B <0AA82 ?@54<5B>2 (A fallback =0 JSONB, 5A;8 B01;8F0 ?CAB0).
async function loadInventoryFromTable(client, playerId) {
    if (!client || !playerId) return null;
    try {
        const result = await client.query(
            'SELECT pi.item_id, pi.quantity, pi.durability, pi.max_durability, pi.upgrade_level, pi.modifications, pi.stats, i.name, i.type, i.category, i.rarity, i.icon, i.slot, i.price, i.ammo_type, i.max_stack, i.stackable, i.set_id FROM player_inventory pi JOIN items i ON i.id = pi.item_id WHERE pi.player_id = $1',
            [playerId]
        );
        if (result.rows.length === 0) return null; // fallback to JSONB
        return result.rows.map((row) => ({
            id: row.item_id,
            name: row.name,
            type: row.type,
            category: row.category,
            rarity: row.rarity,
            icon: row.icon,
            slot: row.slot,
            price: row.price,
            ammo_type: row.ammo_type,
            max_stack: row.max_stack,
            stackable: row.stackable,
            set_id: row.set_id,
            quantity: Number(row.quantity) || 0,
            durability: Number(row.durability) || 100,
            max_durability: Number(row.max_durability) || 100,
            upgrade_level: Number(row.upgrade_level) || 0,
            modifications: safeJsonParse(row.modifications, {}),
            stats: safeJsonParse(row.stats, {})
        }));
    } catch (e) {
        return null; // fallback to JSONB
    }
}

// 0?8AL 8=25=B0@O 2 >15 A8AB5<K (JSONB + player_inventory).
async function saveInventoryBoth(client, playerId, inventory) {
    if (!client || !playerId || !Array.isArray(inventory)) return;
    // JSONB
    await client.query('UPDATE players SET inventory = $1::jsonb WHERE id = $2', [JSON.stringify(inventory), playerId]);
    // player_inventory
    await syncInventoryToTable(client, playerId, inventory);
}

async function syncInventoryToTable(client, playerId, inventory) {
    if (!client || !playerId || !Array.isArray(inventory)) return;
    try {
        // G8I05< AB0@K5 70?8A8
        await client.query('DELETE FROM player_inventory WHERE player_id = $1', [playerId]);
        // AB02;O5< 0:BC0;L=K5
        for (const item of inventory) {
            if (!item || typeof item !== 'object') continue;
            const itemId = Number.isSafeInteger(Number(item.id)) ? Number(item.id) : null;
            if (itemId === null) continue;
            const qty = Math.max(0, Number(item.quantity) || 0);
            if (qty <= 0) continue;
            await client.query(
                `INSERT INTO player_inventory (player_id, item_id, quantity, durability, max_durability, upgrade_level, modifications, stats)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
                ON CONFLICT (player_id, item_id, upgrade_level, durability) DO UPDATE SET
                    quantity = player_inventory.quantity + EXCLUDED.quantity,
                    modifications = EXCLUDED.modifications,
                    stats = EXCLUDED.stats
            `, [
                playerId, itemId, qty,
                Number(item.durability) || 100,
                Number(item.max_durability) || 100,
                Number(item.upgrade_level) || 0,
                JSON.stringify(item.modifications || {}),
                JSON.stringify(item.stats || {})
            ]);
        }
    } catch (e) {
        // 5 @>=O5< >A=>2=>9 ?>B>:
    }
}

module.exports = {
    // $C=:F88 A>AB>O=8O 83@>:0.
    //
    // normalizeItemStats, normalizePlayerBuffs 8 SELL_RATE 745AL =5
    // M:A?>@B8@CNBAO: >=8 8A?>;L7CNBAO B>;L:> 2=CB@8 D09;0, 0 @0=LH5
    // CE>48;8 =0@C6C 2<5AB5 A >AB0;L=K<8. !?8A>: M:A?>@B>2 4>;65=
    // >B25G0BL =0 2>?@>A «GB> 7>2CB 4@C385 <>4C;8»  8=0G5 <Q@B2K5 8<5=0
    // <0A:8@CNB =0AB>OI85 4C1;8 (A<. 8AB>@8N ITEM_CATEGORIES 2
    // gameConstants.js).
    safeJsonParse,
    normalizeInventory,
    syncInventoryToTable,
    loadInventoryFromTable,
    saveInventoryBoth,
    createInventoryItem,
    normalizeRadiation,
    getActiveBuffs,
    buildPlayerStatus,
    recalcEnergy,
    regenerateHealth,
    normalizeEquipment,
    calculateSellPrice,
    addItemToInventory,

    // @028;0 ?@54<5B>2 8 AGQBG8:8 ?@>3@5AA0
    equipmentRules,
    getSetBonuses,
    wearEquipmentSlots,
    trackCollectedItems,
    progressDailyTask,
    progressContract,
    CONTRACT_TYPES,
    consumeInventoryItem,
    
    // 0;NB0
    grantCurrencyReward,
    
    // $C=:F88 4>AB865=89 (achievements.js)
    getAchievementCurrentValue,
    getAchievementTargetValue,
    getAchievementRuntimeContext,
    checkAchievements,
    getPlayerAchievements,
    getPlayerProgress,
    claimAchievementReward,
    initAchievementsTable
};
