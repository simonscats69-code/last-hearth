/**
 * Р›РѕРєР°С†РёРё Рё РїРѕРёСЃРє Р»СѓС‚Р°
 * @module game/world
 */

const express = require('express');
const router = express.Router();
// Р Р°РЅСЊС€Рµ РѕР±СЂР°Р±РѕС‚С‡РёРєРё РїРѕРёСЃРєР° Рё РїРµСЂРµРјРµС‰РµРЅРёСЏ СЃР°РјРё Р±СЂР°Р»Рё СЃРѕРµРґРёРЅРµРЅРёРµ РёР· РїСѓР»Р°
// Рё РІСЂСѓС‡РЅСѓСЋ РїРёСЃР°Р»Рё BEGIN/COMMIT/ROLLBACK. РўРµРїРµСЂСЊ СЌС‚Рѕ РґРµР»Р°РµС‚
// transaction() вЂ” РѕРЅ Р¶Рµ Рё РѕСЃРІРѕР±РѕР¶РґР°РµС‚ СЃРѕРµРґРёРЅРµРЅРёРµ РІ finally.
// РЎРј. РїРѕСЏСЃРЅРµРЅРёРµ РІ POST /world/search.
const { query, queryAll, transaction } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const {
    DEBUFF_CONFIG,
    calculateDropChance,
    rollItemRarity,
    calculateDebuffModifiers,
    calculateLocationRiskProfile,
    calculateRadiationDamage
} = require('../../utils/gameConstants');
const { logger, safeJsonParse, unauthorized } = require('../../utils/serverApi');
const { playerIdGuard, handleRouteError } = require('../../utils/routeHelpers');
const { setPlayerRadiation } = require('../../db/playerRepository');

// Р›РµРЅРёРІР°СЏ Р·Р°РіСЂСѓР·РєР° helpers: utils/game-helpers.js вЂ” РµРґРёРЅСЃС‚РІРµРЅРЅС‹Р№ РёСЃС‚РѕС‡РЅРёРє
// С„СѓРЅРєС†РёР№ СЃРѕСЃС‚РѕСЏРЅРёСЏ РёРіСЂРѕРєР°. РћРЅ С‚СЏРЅРµС‚ db/database, РїРѕСЌС‚РѕРјСѓ РёРјРїРѕСЂС‚ Р»РµРЅРёРІС‹Р№
// (РёРЅР°С‡Рµ С†РёРєР» Р·Р°РіСЂСѓР·РєРё РјРѕРґСѓР»РµР№). РћР±С‰РёР№ Р·Р°РіСЂСѓР·С‡РёРє вЂ” utils/getGameHelpers.js.
const { getGameHelpers } = require('../../utils/getGameHelpers');

// Р­РєСЃРїРѕСЂС‚РёСЂСѓРµРјС‹Рµ С„СѓРЅРєС†РёРё С‡РµСЂРµР· getGameHelpers()
const helpers = getGameHelpers();
const { normalizeInventory, normalizeRadiation, normalizeEquipment, getActiveBuffs, createInventoryItem, recalcEnergy, regenerateHealth, addItemToInventory, equipmentRules, trackCollectedItems, progressDailyTask } = helpers;
const { getLootCacheReady, getLootTypePool, getRandomLootItemFromPool } = require('../../utils/lootCache');
const crypto = require('crypto');
// РћРґРёРЅ require РЅР° С„Р°Р№Р» РїСЂР°РІРёР»: СЂР°РЅСЊС€Рµ РїСѓС‚СЊ '../../public/shared/equipment.js'
// С„РёРіСѓСЂРёСЂРѕРІР°Р» РґРІР°Р¶РґС‹ (РѕС‚РґРµР»СЊРЅРѕ РґР»СЏ calculateCoinDrop, РѕС‚РґРµР»СЊРЅРѕ РґР»СЏ
// MAX_INVENTORY_SLOTS). Node РєСЌС€РёСЂСѓРµС‚ РјРѕРґСѓР»СЊ, РїРѕСЌС‚РѕРјСѓ СЌС‚Рѕ Р±С‹Р»Рѕ Р±РµР·РІСЂРµРґРЅРѕ,
// РЅРѕ РІС‹РіР»СЏРґРµР»Рѕ РєР°Рє РґРІР° СЂР°Р·РЅС‹С… РёСЃС‚РѕС‡РЅРёРєР° РѕРґРЅРёС… Рё С‚РµС… Р¶Рµ РїСЂР°РІРёР».
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
// РЈРўРР›РРўР«
// =============================================================================

// --- Р‘Р°Р»Р°РЅСЃ РѕРїС‹С‚Р° Р·Р° РїРѕРёСЃРє Р±РµСЂС‘С‚СЃСЏ РёР· equipment.js (РµРґРёРЅС‹Р№ РёСЃС‚РѕС‡РЅРёРє РїСЂР°РІРґС‹) --

function validateLocationId(locationId) {
    const num = Number(locationId);
    return Number.isSafeInteger(num) && num > 0;
}

async function getRandomLootItem(client, rarity, locationId) {
    // P2-9: РёСЃРїРѕР»СЊР·СѓРµРј РєСЌС€ РїСѓР»Р° ID РІРјРµСЃС‚Рѕ ORDER BY random() РЅР° РІСЃРµР№ С‚Р°Р±Р»РёС†Рµ
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
    
    // Fallback: РїСЂСЏРјРѕР№ Р·Р°РїСЂРѕСЃ РµСЃР»Рё РєСЌС€ РЅРµ РіРѕС‚РѕРІ
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
 * РЁР°РЅСЃС‹ РІС‹РїР°РґРµРЅРёСЏ РєР»СЋС‡РµР№ Р±РѕСЃСЃРѕРІ РёР· РїРѕРёСЃРєР°.
 *
 * РСЃС‚РѕС‡РЅРёРє РґР°РЅРЅС‹С… вЂ” bosses.key_drop_chance (РїСЂРѕС†РµРЅС‚С‹ РѕС‚ РґСЂРѕРїР°) РІРјРµСЃС‚Рµ СЃ
 * РёРјРµРЅРµРј/РёРєРѕРЅРєРѕР№ РєР»СЋС‡РµРІРѕРіРѕ РїСЂРµРґРјРµС‚Р°. РњРЅРѕР¶РёС‚РµР»СЊ СЂРёСЃРєР° Р»РѕРєР°С†РёРё СЃРѕС…СЂР°РЅСЏРµРј:
 * С‡РµРј РѕРїР°СЃРЅРµРµ Р·РѕРЅР°, С‚РµРј РІС‹С€Рµ С€Р°РЅСЃ СЃРѕСЂРІР°С‚СЊ РєР»СЋС‡.
 *
 * РћР“Р РђРќРР§Р•РќРР•: РєР»СЋС‡Рё РІС‹РїР°РґР°СЋС‚ РўРћР›Р¬РљРћ РґР»СЏ СЃР»РµРґСѓСЋС‰РµРіРѕ Р±РѕСЃСЃР° РІ РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕСЃС‚Рё.
 * РРіСЂРѕРє РЅРµ РјРѕР¶РµС‚ РїРѕР»СѓС‡РёС‚СЊ РєР»СЋС‡ РѕС‚ Р±РѕСЃСЃР° N+2, РїРѕРєР° РЅРµ СЂР°Р·Р±Р»РѕРєРёСЂРѕРІР°Р» N+1.
 * Р­С‚Рѕ РѕР±РµСЃРїРµС‡РёРІР°РµС‚ СЃС‚СЂРѕРіСѓСЋ РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕСЃС‚СЊ РїСЂРѕРіСЂРµСЃСЃРёРё.
 *
 * @param {object} client РєР»РёРµРЅС‚ Р‘Р” (С‚СЂР°РЅР·Р°РєС†РёСЏ)
 * @param {number} playerId ID РёРіСЂРѕРєР°
 * @returns {Promise<Array<{bossId:number,chance:number,name:string,icon:string,rarity:string,bossName:string}>>}
 */
async function getBossKeyChances(client, playerId) {
    // РћРїСЂРµРґРµР»СЏРµРј СЃР»РµРґСѓСЋС‰РёР№ Р±РѕСЃСЃР°, РєРѕС‚РѕСЂРѕРіРѕ РЅСѓР¶РЅРѕ РѕС‚РєСЂС‹С‚СЊ.
    // РС‰РµРј РјР°РєСЃРёРјР°Р»СЊРЅС‹Р№ boss_id РІ boss_keys, РіРґРµ Сѓ РёРіСЂРѕРєР° РµСЃС‚СЊ РєР»СЋС‡Рё,
    // РїР»СЋСЃ 1. Р•СЃР»Рё РєР»СЋС‡РµР№ РЅРµС‚ вЂ” СЃР»РµРґСѓСЋС‰РёР№ Р±РѕСЃСЃ = 2 (РїРµСЂРІС‹Р№ СЃ РєР»СЋС‡РѕРј).
    //
    // РўСЂРё РѕС‚РґРµР»СЊРЅС‹С… Р·Р°РїСЂРѕСЃР° (РїСЂРѕРіСЂРµСЃСЃ -> РјР°РєСЃРёРјСѓРј Р±РѕСЃСЃРѕРІ -> РєР»СЋС‡) Р·Р°РјРµРЅРµРЅС‹
    // РѕРґРЅРёРј: РІ РЅС‘Рј РјР°РєСЃ. Р±РѕСЃСЃ СЃС‡РёС‚Р°РµС‚СЃСЏ РїРѕРґР·Р°РїСЂРѕСЃРѕРј, Р° РєР»СЋС‡ вЂ” РґР¶РѕР№РЅРѕРј Рє РЅРµРјСѓ.
    // РћРґРёРЅ roundtrip РІРјРµСЃС‚Рѕ С‚СЂС‘С… РЅР° РљРђР–Р”РћРњ РІС‹Р·РѕРІРµ РїРѕРёСЃРєР° Р»СѓС‚Р°.
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
        return []; // РљР»СЋС‡ РґР»СЏ СЌС‚РѕРіРѕ Р±РѕСЃСЃР° РЅРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚ РёР»Рё С€Р°РЅСЃ 0
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
// РЈРќРР’Р•Р РЎРђР›Р¬РќР«Р™ РћР‘Р РђР‘РћРўР§РРљ РЎРџРРЎРљРђ Р›РћРљРђР¦РР™
// =============================================================================

/**
 * РџРѕР»СѓС‡РµРЅРёРµ СЃРїРёСЃРєР° Р»РѕРєР°С†РёР№
 * GET /api/game/locations (С‡РµСЂРµР· Р°Р»РёР°СЃ РёР· index.js)
 * GET /api/game/world/locations
 */
async function handleLocationsList(req, res) {
    logger.info('[world] GET /locations РІС‹Р·РІР°РЅ', { playerId: req.player?.id, query: req.query });
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
            // РЎС‚СЂРѕРёРј РїСЂРµРІСЊСЋ Р»СѓС‚Р° РґР»СЏ РєР»РёРµРЅС‚Р°: С‚РёРїС‹ РїСЂРµРґРјРµС‚РѕРІ, С€Р°РЅСЃС‹ СЂРµРґРєРѕСЃС‚РµР№,
            // РїСЂРёРјРµСЂРЅС‹Рµ РїСЂРµРґРјРµС‚С‹ Рё РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ РєР»СЋС‡Рµ Р±РѕСЃСЃР°.
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
        handleRouteError(res, error, 'locations_list', req.playerId);
    }
}

// РћР±Р° РјР°СЂС€СЂСѓС‚Р° РёСЃРїРѕР»СЊР·СѓСЋС‚ РѕРґРёРЅ РѕР±СЂР°Р±РѕС‚С‡РёРє
router.get('/', handleLocationsList);
router.get('/locations', handleLocationsList);

// =============================================================================
// РџРћРРЎРљ Р›РЈРўРђ
// =============================================================================

/**
 * РџРѕРёСЃРє Р»СѓС‚Р° РЅР° Р»РѕРєР°С†РёРё
 * POST /world/search в†’ POST /api/game/world/search
 */
router.post('/search', async (req, res) => {
    // Р¤РёР»СЊС‚СЂСѓРµРј С‡СѓРІСЃС‚РІРёС‚РµР»СЊРЅС‹Рµ Р·Р°РіРѕР»РѕРІРєРё РїРµСЂРµРґ Р»РѕРіРёСЂРѕРІР°РЅРёРµРј
    const safeHeaderKeys = Object.keys(req.headers).filter(k => !['authorization', 'cookie', 'x-init-data'].includes(k.toLowerCase()));
    logger.info('[world] POST /search РІС‹Р·РІР°РЅ', { playerId: req.player?.id, body: req.body, headers: safeHeaderKeys });

    if (!req.player) {
        return unauthorized(res);
    }
    const playerId = playerIdGuard(req, res);
    if (!playerId) return;

    // Р Р°РЅСЊС€Рµ Р·РґРµСЃСЊ РІСЂСѓС‡РЅСѓСЋ Р±СЂР°Р»РѕСЃСЊ СЃРѕРµРґРёРЅРµРЅРёРµ, Р° РІРµС‚РєРё РѕС‚РєР°Р·Р° (В«РЅРµС‚
    // РёРіСЂРѕРєР°В», В«РЅРµС‚ Р·РґРѕСЂРѕРІСЊСЏВ», В«РЅРµС‚ СЌРЅРµСЂРіРёРёВ», В«Р»РѕРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°В»,
    // В«РёРЅРІРµРЅС‚Р°СЂСЊ РїРѕР»РѕРЅВ») РєР°Р¶РґР°СЏ РІС‹Р·С‹РІР°Р»Р° ROLLBACK Рё РѕС‚РІРµС‡Р°Р»Р° РїСЂСЏРјРѕ РёР·
    // try. РЎ transaction() С‚РµР»Рѕ РІРѕР·РІСЂР°С‰Р°РµС‚ СЂРµР·СѓР»СЊС‚Р°С‚, Р° HTTP-РѕС‚РІРµС‚
    // РѕС‚РїСЂР°РІР»СЏРµС‚СЃСЏ РѕРґРёРЅ СЂР°Р· РџРћРЎР›Р• Р·Р°РІРµСЂС€РµРЅРёСЏ С‚СЂР°РЅР·Р°РєС†РёРё. Р­С‚Рѕ С‡РёРЅРёС‚
    // СЂРµР°Р»СЊРЅС‹Р№ РґРµС„РµРєС‚ РїСЂРµР¶РЅРµР№ Р·Р°РїРёСЃРё: res.json СЃС‚РѕСЏР» СѓР¶Рµ РїРѕСЃР»Рµ COMMIT,
    // Рё РµСЃР»Рё РѕРЅ Р±СЂРѕСЃР°Р» РёСЃРєР»СЋС‡РµРЅРёРµ, catch РІС‹РїРѕР»РЅСЏР» ROLLBACK РїРѕ Р·Р°РєСЂС‹С‚РѕР№
    // С‚СЂР°РЅР·Р°РєС†РёРё.
    try {
        const outcome = await transaction(async (client) => {
            // SELECT СЃ СЏРІРЅС‹Рј СЃРїРёСЃРєРѕРј РїРѕР»РµР№ РІРјРµСЃС‚Рѕ SELECT *. Р”РІР° РїРѕР»СЏ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹:
            // total_actions вЂ” РґР»СЏ comboBonus РїРѕ (total_actions+1) % 10, РёРЅР°С‡Рµ
            // РєРѕРјР±Рѕ-Р±РѕРЅСѓСЃ РЅРµ РґР°С‘С‚СЃСЏ РЅРёРєРѕРіРґР°;
            // max_health Рё last_hp_regen вЂ” РґР»СЏ regenerateHealth(): Р±РµР· РјР°РєСЃРёРјСѓРјР°
            // regenerable РІСЃРµРіРґР° 0, С…РµР»РїРµСЂ СѓС…РѕРґРёС‚ РІ РІРµС‚РєСѓ В«РЅР° РїРѕС‚РѕР»РєРµВ» Рё РїРёС€РµС‚
            // last_hp_regen = NOW(), С‚Рѕ РµСЃС‚СЊ РїРѕРёСЃРє РЅРµ Р»РµС‡РёС‚ Р РѕР±РЅСѓР»СЏРµС‚
            // РЅР°РєРѕРїР»РµРЅРЅРѕРµ РІСЂРµРјСЏ СЂРµРіРµРЅР°.
            const updatedPlayer = await lockPlayer(playerId, client, 'id, energy, max_energy, current_location_id, radiation, inventory, equipment, luck, health, max_health, last_hp_regen, level, experience, buffs, total_actions, last_energy_update, empty_searches_streak');

            if (!updatedPlayer) {
                return {
                    status: 404,
                    body: {
                        success: false,
                        error: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ',
                        code: 'PLAYER_NOT_FOUND'
                    }
                };
            }

            // P0-2: Р·Р°РїСЂРµС‚ РїРѕРёСЃРєР° РїСЂРё РЅСѓР»РµРІРѕРј Р·РґРѕСЂРѕРІСЊРµ
            if (Number(updatedPlayer.health || 0) <= 0) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Р’С‹ РёСЃС‚РѕС‰РµРЅС‹. РЎРЅР°С‡Р°Р»Р° РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚Рµ Р·РґРѕСЂРѕРІСЊРµ.',
                        code: 'NO_HEALTH',
                        health: 0,
                        max_health: updatedPlayer.max_health
                    }
                };
            }

            const activeBuffs = getActiveBuffs(updatedPlayer.buffs);

            // Р—Р°РїСЂРѕСЃ Р»РѕРєР°С†РёРё РІС‹РЅРµСЃРµРЅ РџР•Р Р•Р” РїСЂРѕРІРµСЂРєРѕР№ СЌРЅРµСЂРіРёРё: СЃРЅР°С‡Р°Р»Р° СѓР±РµР¶РґР°РµРјСЃСЏ,
            // С‡С‚Рѕ Р·РѕРЅР° РґРѕСЃС‚СѓРїРЅР° Рё РёРіСЂРѕРє СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓРµС‚ СѓСЂРѕРІРЅСЋ, Рё С‚РѕР»СЊРєРѕ РїРѕС‚РѕРј
            // СЃС‡РёС‚Р°РµРј СЃС‚РѕРёРјРѕСЃС‚СЊ РґРµР№СЃС‚РІРёСЏ.
            if (!updatedPlayer.current_location_id) {
                throw {
                    message: 'Р›РѕРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°',
                    code: 'LOCATION_NOT_FOUND',
                    statusCode: 404
                };
            }

            const location = await client.query(`
                SELECT id, name, radiation, is_available, min_level, loot_table FROM locations WHERE id = $1
            `, [updatedPlayer.current_location_id]);

            if (location.rows.length === 0) {
                throw {
                    message: 'Р›РѕРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°',
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
                        error: 'Р­С‚Р° Р»РѕРєР°С†РёСЏ СЃРµР№С‡Р°СЃ РЅРµРґРѕСЃС‚СѓРїРЅР° РґР»СЏ РёСЃСЃР»РµРґРѕРІР°РЅРёР№',
                        code: 'LOCATION_UNAVAILABLE'
                    }
                };
            }

            if (Number(updatedPlayer.level || 1) < Number(locationData.min_level || 1)) {
                return {
                    status: 403,
                    body: {
                        success: false,
                        error: `Р”Р»СЏ РёСЃСЃР»РµРґРѕРІР°РЅРёР№ РІ СЌС‚РѕР№ Р·РѕРЅРµ РЅСѓР¶РµРЅ СѓСЂРѕРІРµРЅСЊ ${locationData.min_level}+`,
                        code: 'INSUFFICIENT_LEVEL',
                        required_level: Number(locationData.min_level),
                        current_level: Number(updatedPlayer.level || 1)
                    }
                };
            }

            // P0-1: РїРµСЂРµСЃС‡РёС‚С‹РІР°РµРј СЌРЅРµСЂРіРёСЋ РїРѕ СЂРµР°Р»СЊРЅРѕРјСѓ РІСЂРµРјРµРЅРё (РЅРµ СЃР±СЂР°СЃС‹РІР°СЏ С‚Р°Р№РјРµСЂ)
            await recalcEnergy(client, updatedPlayer);
            // РўРѕ Р¶Рµ РґР»СЏ Р·РґРѕСЂРѕРІСЊСЏ: РјРµРґР»РµРЅРЅС‹Р№ СЂРµРіРµРЅ РїРѕСЃР»Рµ Р±РѕСЏ. Р‘РµР· РЅРµРіРѕ РёРіСЂРѕРє,
            // РёР·СЂР°СЃС…РѕРґРѕРІР°РІС€РёР№ РІСЃРµ Р°РїС‚РµС‡РєРё, РѕСЃС‚Р°РІР°Р»СЃСЏ СЃ 1 HP РЅР°РІСЃРµРіРґР°.
            await regenerateHealth(client, updatedPlayer);

            // Р’Р°Р»РёРґР°С†РёСЏ СЌРєРёРїРёСЂРѕРІРєРё С‡РµСЂРµР· normalizeEquipment: РіР°СЂР°РЅС‚РёСЂСѓРµС‚ С‡РёСЃС‚СѓСЋ
            // СЃС‚СЂСѓРєС‚СѓСЂСѓ СЃР»РѕС‚РѕРІ РїРµСЂРµРґ СЂР°СЃС‡С‘С‚РѕРј Р·Р°С‰РёС‚С‹ Рё СЂРёСЃРєР°.
            const equipment = normalizeEquipment(updatedPlayer.equipment);
            const riskProfile = calculateLocationRiskProfile(locationData, equipment);

            // Р”РёС„С„РµСЂРµРЅС†РёСЂРѕРІР°РЅРЅР°СЏ СЃС‚РѕРёРјРѕСЃС‚СЊ РїРѕРёСЃРєР° РїРѕ С‚РёРїСѓ Р·РѕРЅС‹.
            // Р‘РµР·РѕРїР°СЃРЅС‹Рµ Р·РѕРЅС‹ РґРµС€РµРІР»Рµ, РѕРїР°СЃРЅС‹Рµ вЂ” СЃС‚РѕСЏС‚ Р±РѕР»СЊС€Рµ СЌРЅРµСЂРіРёРё.
            const ENERGY_COST_BY_TIER = {
                safe: 1,
                warning: 1,
                danger: 2,
                deadly: 3
            };
            const energyCost = activeBuffs.free_energy ? 0 : (ENERGY_COST_BY_TIER[riskProfile.tier] || 1);
            if (Number(updatedPlayer.energy || 0) < energyCost) {
                throw {
                    message: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЌРЅРµСЂРіРёРё',
                    code: 'INSUFFICIENT_ENERGY',
                    statusCode: 400,
                    energy: Math.max(0, updatedPlayer.energy),
                    max_energy: updatedPlayer.max_energy
                };
            }
        
        // Р—Р°СЂР°Р¶РµРЅРёРµ Р·РѕРЅРѕР№ СЃС‡РёС‚Р°РµС‚СЃСЏ unified: radiation + Р»СЋР±С‹Рµ СѓРіСЂРѕР·С‹ Р·РѕРЅС‹.
        let radiationGain = 0;
        let radiationExpiresAt = null;
        const contaminationDefense = riskProfile.contaminationDefense;
let resultingRadiationLevel = normalizeRadiation(updatedPlayer.radiation).level;
        const existingRadiation = normalizeRadiation(updatedPlayer.radiation);

        const now = new Date();

        // РЎР±СЂР°СЃС‹РІР°РµРј РёСЃС‚С‘РєС€СѓСЋ СЂР°РґРёР°С†РёСЋ
        if (existingRadiation.expires_at && new Date(existingRadiation.expires_at) <= now) {
            resultingRadiationLevel = 0;
        }

        if (riskProfile.contaminationThreat > 0 && !activeBuffs.no_radiation) {
            // P1-7: РёСЃРїРѕР»СЊР·СѓРµРј СѓР¶Рµ РїРѕСЃС‡РёС‚Р°РЅРЅРѕРµ РґР°РІР»РµРЅРёРµ (СЃ СѓС‡С‘С‚РѕРј Р·Р°С‰РёС‚С‹)
            const randomFactor = 0.7 + crypto.randomInt(600) / 1000;
            radiationGain = Math.max(0, Math.ceil(riskProfile.contaminationPressure * randomFactor));

            if (radiationGain > 0) {
                const radiationConfig = DEBUFF_CONFIG.radiation;
                const expiresAt = new Date(
                    now.getTime() + radiationConfig.baseDurationMs + (radiationGain - 1) * radiationConfig.durationPerLevelMs
                );
                radiationExpiresAt = expiresAt.toISOString();
                
                resultingRadiationLevel = Math.min(radiationConfig.maxLevel, existingRadiation.level + radiationGain);
                
                await setPlayerRadiation(playerId, {
                        level: resultingRadiationLevel,
                        expires_at: expiresAt.toISOString(),
                        applied_at: now.toISOString()
                    }, client);
            }
        }
        
        // Р•СЃР»Рё СЂР°РґРёР°С†РёСЏ РЅРµ РЅР°РєР°РїР»РёРІР°Р»Р°СЃСЊ РІ СЌС‚РѕРј РїРѕРёСЃРєРµ, РЅРѕ СѓР¶Рµ Р±С‹Р»Р° Р°РєС‚РёРІРЅР°,
        // Р±РµСЂС‘Рј expires_at РёР· СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёС… РґР°РЅРЅС‹С…, С‡С‚РѕР±С‹ РєР»РёРµРЅС‚ РІРёРґРµР» СЃСЂРѕРє РґРµР№СЃС‚РІРёСЏ.
        if (!radiationExpiresAt && resultingRadiationLevel > 0 && existingRadiation.expires_at && new Date(existingRadiation.expires_at) > now) {
            radiationExpiresAt = existingRadiation.expires_at;
        }

        updatedPlayer.radiation = { level: resultingRadiationLevel, expires_at: radiationExpiresAt || null };

        const modifiers = calculateDebuffModifiers(updatedPlayer);
        // РЈРґР°С‡Р° РѕС‚ СЌРєРёРїРёСЂРѕРІРєРё (РЅР°РїСЂРёРјРµСЂ, РЎС‚Р°Р»РєРµСЂСЃРєРѕРіРѕ РїРѕСЏСЃР°) СЃР»РѕС‚РѕРј accessory.
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
        
        // Pity timer: РїРѕСЃР»Рµ PITY_THRESHOLD РїРѕРґСЂСЏРґ РїСѓСЃС‚С‹С… РїРѕРёСЃРєРѕРІ СЃР»РµРґСѓСЋС‰Р°СЏ
        // РІС‹Р»Р°Р·РєР° РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ РґР°С‘С‚ РїСЂРµРґРјРµС‚ СЂРµРґРєРѕСЃС‚СЊСЋ РЅРµ РЅРёР¶Рµ uncommon.
        const PITY_THRESHOLD = 10;
        const emptyStreak = Number(updatedPlayer.empty_searches_streak || 0);
        const pityActive = emptyStreak >= PITY_THRESHOLD;
        
        // РЈС‡С‘С‚ РёСЃС‚РѕС‰РµРЅРёСЏ Р·РѕРЅС‹: С‡РµРј РІС‹С€Рµ exhaustion, С‚РµРј РЅРёР¶Рµ С€Р°РЅСЃ СЂРµРґРєРѕРіРѕ Р»СѓС‚Р°.
        const locationExhaustion = Number(locationData.exhaustion || 0);
        const exhaustionPenalty = Math.min(0.5, locationExhaustion / 200); // РґРѕ -50% С€Р°РЅСЃР°
        const adjustedDropChance = Math.max(0.01, dropChance * (1 - exhaustionPenalty));
        
        if (rolled <= adjustedDropChance) {
            // РљР»СЋС‡Рё Р±РѕСЃСЃРѕРІ. РЁР°РЅСЃС‹ Р±РµСЂС‘Рј РёР· bosses.key_drop_chance (РІ РїСЂРѕС†РµРЅС‚Р°С…
            // РѕС‚ РґСЂРѕРїР°), Р° РїСЂРµРґРјРµС‚ вЂ” РґР¶РѕР№РЅРѕРј items -> bosses РїРѕ
            // required_key_id: Р±РµР· СЌС‚РѕРіРѕ РґР¶РѕР№РЅР° РєР»СЋС‡ РЅРµ РЅР°С…РѕРґРёС‚СЃСЏ РІРѕРІСЃРµ,
            // СЌРЅРµСЂРіРёСЏ С‚СЂР°С‚РёС‚СЃСЏ, Р° Р»СѓС‚ РЅРµ РІС‹РїР°РґР°РµС‚.
            //
            // РљР»СЋС‡Рё РІС‹РїР°РґР°СЋС‚ РўРћР›Р¬РљРћ РґР»СЏ СЃР»РµРґСѓСЋС‰РµРіРѕ Р±РѕСЃСЃР° РІ РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕСЃС‚Рё.
            // getBossKeyChances С‚РµРїРµСЂСЊ РїСЂРёРЅРёРјР°РµС‚ playerId Рё РІРѕР·РІСЂР°С‰Р°РµС‚ РєР»СЋС‡
            // С‚РѕР»СЊРєРѕ РґР»СЏ СЃР»РµРґСѓСЋС‰РµРіРѕ Р±РѕСЃСЃР° РІ РїСЂРѕРіСЂРµСЃСЃРёРё РёРіСЂРѕРєР°.
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
                // РљР»СЋС‡ В«РљР»СЋС‡ РѕС‚ XВ» РѕС‚РєСЂС‹РІР°РµС‚ Р±РѕР№ СЃ X, Р° С…СЂР°РЅРёС‚СЃСЏ РѕРЅ РїРѕРґ
                // РІР»Р°РґРµР»СЊС†РµРј РїСЂРµРґС‹РґСѓС‰РµРіРѕ Р±РѕСЃСЃР°: boss_keys.boss_id = X - 1.
                const ownerBossId = Math.max(1, foundKey.bossId - 1);
                await client.query(`
                    INSERT INTO boss_keys (player_id, boss_id, quantity)
                    VALUES ($1, $2, 1)
                    ON CONFLICT (player_id, boss_id)
                    DO UPDATE SET quantity = boss_keys.quantity + 1
                `, [playerId, ownerBossId]);

                foundKeyInfo = {
                    name: foundKey.name,
                    icon: foundKey.icon || 'рџ—ќпёЏ',
                    rarity: foundKey.rarity || 'epic',
                    boss_id: foundKey.bossId,
                    boss_name: foundKey.bossName
                };
            } else {
                // Pity timer: РµСЃР»Рё Р°РєС‚РёРІРµРЅ, РїСЂРёРЅСѓРґРёС‚РµР»СЊРЅРѕ РІС‹Р±РёСЂР°РµРј СЂРµРґРєРѕСЃС‚СЊ РЅРµ РЅРёР¶Рµ uncommon.
                let forcedRarity = null;
                if (pityActive) {
                    forcedRarity = 'uncommon';
                }
                itemRarity = rollItemRarity(locationData.id, riskAdjustedLuck, locationData.loot_table, forcedRarity);

                foundItem = await getRandomLootItem(client, itemRarity, locationData.id);
            }
            
            if (foundItem) {
                lootRolled = true;
                const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(updatedPlayer.inventory);

                // РџСЂРѕРІРµСЂСЏРµРј РјРµСЃС‚Рѕ РІ РёРЅРІРµРЅС‚Р°СЂРµ РїРµСЂРµРґ РґРѕР±Р°РІР»РµРЅРёРµРј РїСЂРµРґРјРµС‚Р°.
                // Р•СЃР»Рё РёРЅРІРµРЅС‚Р°СЂСЊ РїРѕР»РѕРЅ, РЅРµ РїС‹С‚Р°РµРјСЃСЏ РґРѕР±Р°РІРёС‚СЊ вЂ” РІС‹Р±СЂР°СЃС‹РІР°РµРј
                // РѕС€РёР±РєСѓ СЃСЂР°Р·Сѓ, С‡С‚РѕР±С‹ РЅРµ РјСѓС‚РёСЂРѕРІР°С‚СЊ РёРЅРІРµРЅС‚Р°СЂСЊ РІРїСѓСЃС‚СѓСЋ.
                if (inventory.length >= MAX_INVENTORY_SLOTS) {
                    throw {
                        message: `РРЅРІРµРЅС‚Р°СЂСЊ РїРµСЂРµРїРѕР»РЅРµРЅ (РјР°РєСЃ. ${MAX_INVENTORY_SLOTS} СЃР»РѕС‚РѕРІ). РСЃРїРѕР»СЊР·СѓР№ СЂР°СЃС…РѕРґРЅРёРєРё РёР»Рё СЌРєРёРїРёСЂСѓР№ Р»РёС€РЅРµРµ.`,
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

                // РЎС‚Р°РєРѕРІР°РЅРёРµ: РѕРґРЅРѕС‚РёРїРЅС‹Рµ РїСЂРµРґРјРµС‚С‹ СЃРєР»Р°РґС‹РІР°СЋС‚СЃСЏ РІ РѕРґРёРЅ СЃР»РѕС‚, РёРЅР°С‡Рµ
                // 100 СЃР»РѕС‚РѕРІ Р·Р°Р±РёРІР°СЋС‚СЃСЏ Р±С‹СЃС‚СЂРµРµ, С‡РµРј РёРіСЂРѕРє СѓСЃРїРµРІР°РµС‚ РёС… СЂР°Р·Р±РёСЂР°С‚СЊ.
                addItemToInventory(inventory, newItem, foundItem);
                itemsCollected += 1;

                // Р‘Р°С„С„ x2 Рє РґРѕР±С‹С‡Рµ РґСѓР±Р»РёСЂСѓРµС‚ РѕР±С‹С‡РЅС‹Р№ РїСЂРµРґРјРµС‚, РЅРѕ РЅРµ РєР»СЋС‡.
                // РџСЂРѕРІРµСЂСЏРµРј РјРµСЃС‚Рѕ РІ РёРЅРІРµРЅС‚Р°СЂРµ Р”Рћ РґРѕР±Р°РІР»РµРЅРёСЏ РІС‚РѕСЂРѕРіРѕ СЌРєР·РµРјРїР»СЏСЂР°,
                // С‡С‚РѕР±С‹ Р±Р°С„С„ РЅРµ РІС‹Р·РІР°Р» РїРѕР»РЅС‹Р№ РѕС‚РєР°С‚ С‚СЂР°РЅР·Р°РєС†РёРё РёР·-Р·Р° РїРµСЂРµРїРѕР»РЅРµРЅРёСЏ.
                if (activeBuffs.loot_x2 && newItem.type !== 'key') {
                    const wouldExceed = inventory.length >= MAX_INVENTORY_SLOTS;
                    if (!wouldExceed) {
                        addItemToInventory(inventory, { ...newItem }, foundItem);
                        itemsCollected += 1;
                        // trackCollectedItems РґР»СЏ РґСѓР±Р»СЏ loot_x2 вЂ” РёРЅР°С‡Рµ
                        // РґРѕСЃС‚РёР¶РµРЅРёРµ В«РљРѕР»Р»РµРєС†РёРѕРЅРµСЂВ» РЅРµ СѓС‡РёС‚С‹РІР°РµС‚ РІС‚РѕСЂРѕР№ СЌРєР·РµРјРїР»СЏСЂ.
                        if (foundItem?.id) {
                            await trackCollectedItems(client, playerId, [foundItem.id]);
                        }
                    }
                }

                // РџСЂРѕРІРµСЂРєР° Р»РёРјРёС‚Р° СЃР»РѕС‚РѕРІ РџРћРЎР›Р• РІСЃРµС… РґРѕР±Р°РІР»РµРЅРёР№ (РІРєР»СЋС‡Р°СЏ loot_x2).
                if (inventory.length > MAX_INVENTORY_SLOTS) {
                    throw {
                        message: `РРЅРІРµРЅС‚Р°СЂСЊ РїРµСЂРµРїРѕР»РЅРµРЅ (РјР°РєСЃ. ${MAX_INVENTORY_SLOTS} СЃР»РѕС‚РѕРІ). РСЃРїРѕР»СЊР·СѓР№ СЂР°СЃС…РѕРґРЅРёРєРё РёР»Рё СЌРєРёРїРёСЂСѓР№ Р»РёС€РЅРµРµ.`,
                        code: 'INVENTORY_FULL',
                        statusCode: 400
                    };
                }

                inventoryUpdate = JSON.stringify(inventory);
                
                // РћРїС‹С‚: Р±Р°Р·РѕРІС‹Р№ + Р±РѕРЅСѓСЃ СЂРµРґРєРѕСЃС‚Рё, РґРѕРјРЅРѕР¶Р°РµС‚СЃСЏ РЅР° Р±РѕРЅСѓСЃ
                // Р»РѕРєР°С†РёРё Рё РЅР° РєРѕРјР±Рѕ Р·Р° СЃРµСЂРёСЋ РґРµР№СЃС‚РІРёР№.
                // Р‘РѕРЅСѓСЃ Р»РѕРєР°С†РёРё СЂР°СЃС‚С‘С‚ РЅРµР»РёРЅРµР№РЅРѕ: РєР°Р¶РґР°СЏ СЃР»РµРґСѓСЋС‰Р°СЏ Р·РѕРЅР°
                // РґР°С‘С‚ РїСЂРѕРїРѕСЂС†РёРѕРЅР°Р»СЊРЅРѕ Р±РѕР»СЊС€Рµ РѕРїС‹С‚Р° Р·Р° СЂРёСЃРє.
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

        // Р’С‹РїР°РґРµРЅРёРµ РјРѕРЅРµС‚ РїСЂРё РїРѕРёСЃРєРµ вЂ” РЅРµР·Р°РІРёСЃРёРјРѕ РѕС‚ РІС‹РїР°РґРµРЅРёСЏ Р»СѓС‚Р°/РєР»СЋС‡Р°.
        // 30% С€Р°РЅСЃ, Р·Р°РІРёСЃРёС‚ РѕС‚ СЂРёСЃРєР°, СѓРґР°С‡Рё, СѓСЂРѕРІРЅСЏ.
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
            logger.warn('РћС€РёР±РєР° СЂР°СЃС‡С‘С‚Р° РІС‹РїР°РґРµРЅРёСЏ РјРѕРЅРµС‚', { error: err.message });
        }

        // Р’С‹С‡РёСЃР»СЏРµРј СѓСЂРѕРЅ РѕС‚ СЂР°РґРёР°С†РёРё Р’РќР• Р±Р»РѕРєР° Р»СѓС‚Р°: Р·РґРѕСЂРѕРІСЊРµ С‚РµСЂСЏРµС‚СЃСЏ РїСЂРё
        // Р»СЋР±РѕРј РїРѕРёСЃРєРµ, РґР°Р¶Рµ РµСЃР»Рё Р»СѓС‚ РЅРµ РІС‹РїР°Р». Р—РЅР°С‡РµРЅРёРµ СѓС…РѕРґРёС‚ РІ setParts РєР°Рє $2.
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

        // РЎС‚СЂРѕРёРј UPDATE РґРёРЅР°РјРёС‡РµСЃРєРё СЃ РїСЂР°РІРёР»СЊРЅС‹РјРё РїРѕР·РёС†РёСЏРјРё РїР°СЂР°РјРµС‚СЂРѕРІ
        // P0-1: РќР• С‚СЂРѕРіР°РµРј last_energy_update вЂ” СЂРµРіРµРЅ РёРґС‘С‚ РѕС‚ СЂРµР°Р»СЊРЅРѕРіРѕ РІСЂРµРјРµРЅРё
        // GREATEST(0, ...) вЂ” СЃС‚СЂР°С…РѕРІРєР° РѕС‚ РіРѕРЅРєРё: РєРѕР»РѕРЅРєР° РїРѕРґ CHECK (energy >= 0),
        // С‚Р° Р¶Рµ Р»РѕРіРёРєР°, С‡С‚Рѕ РІ Р±РѕСЋ СЃ Р±РѕСЃСЃРѕРј, PvP Рё РєРѕР»РµСЃРµ.
        const setParts = [
            'energy = GREATEST(0, energy - $1)',
            // COALESCE: Сѓ СЃС‚Р°СЂС‹С… Р·Р°РїРёСЃРµР№ СЃС‡С‘С‚С‡РёРє РјРѕРі Р±С‹С‚СЊ NULL, Рё СЃС‡С‘С‚С‡РёРє
            // РґРµР№СЃС‚РІРёР№ РЅР°РІРµС‡РЅРѕ Р·Р°РјРёСЂР°Р» РІ NULL РІРјРµСЃС‚Рѕ СЂРѕСЃС‚Р°.
            'total_actions = COALESCE(total_actions, 0) + 1',
            'health = GREATEST(0, health - $2)'
        ];
        const params = [energyCost, radiationDamage];

        // РњРѕРЅРµС‚С‹ РёР· РїРѕРёСЃРєР° (РµСЃР»Рё РІС‹РїР°Р»Рё)
        if (coinDrop) {
            params.push(coinDrop);
            setParts.push(`coins = COALESCE(coins, 0) + $${params.length}`);
        }
        
        if (inventoryUpdate) {
            params.push(inventoryUpdate);
            setParts.push(`inventory = $${params.length}`);
        }
        // РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РёРЅРІРµРЅС‚Р°СЂСЏ РІ РЅРѕСЂРјР°Р»РёР·РѕРІР°РЅРЅСѓСЋ С‚Р°Р±Р»РёС†Сѓ
        try {
            const { syncInventoryToTable, normalizeInventory } = require('../../utils/game-helpers');
            if (typeof syncInventoryToTable === 'function') {
                await syncInventoryToTable(client, playerId, normalizeInventory(inventoryUpdate));
            }
        } catch (_) { /* ignore */ }
        // XP Р±РѕР»СЊС€Рµ РЅРµ РїРёС€РµС‚СЃСЏ РЅР°РїСЂСЏРјСѓСЋ: РµРґРёРЅС‹Р№ РїСѓС‚СЊ С‡РµСЂРµР· progression.grantExperience.
        if (itemsCollected > 0) {
            params.push(itemsCollected);
            setParts.push(`items_collected = COALESCE(items_collected, 0) + $${params.length}`);
        }
        
        params.push(playerId);
        const updateSql = `UPDATE players SET ${setParts.join(', ')} WHERE id = $${params.length} RETURNING energy, max_energy, last_energy_update, coins, health`;
        
        const energyResult = await client.query(updateSql, params);

        if (!energyResult.rows[0]) {
            throw { message: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        const newEnergy = energyResult.rows[0].energy;
        const newMaxEnergy = energyResult.rows[0].max_energy;
        const lastEnergyUpdate = energyResult.rows[0].last_energy_update;
        const newHealth = energyResult.rows[0].health;

        // РџСЂРѕРІРµСЂРєР° СЃРјРµСЂС‚Рё РѕС‚ СЂР°РґРёР°С†РёРё: РµСЃР»Рё Р·РґРѕСЂРѕРІСЊРµ СѓРїР°Р»Рѕ РґРѕ 0, РёРіСЂРѕРє РїРѕРіРёР±.
        if (newHealth <= 0) {
            return {
                status: 200,
                body: {
                    success: false,
                    error: 'Р’С‹ РїРѕРіРёР±Р»Рё РѕС‚ СЂР°РґРёР°С†РёРё РІ СЌС‚РѕР№ Р·РѕРЅРµ. РќСѓР¶РЅРѕ РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ Р·РґРѕСЂРѕРІСЊРµ.',
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

        // РћР±РЅРѕРІР»РµРЅРёРµ РёСЃС‚РѕС‰РµРЅРёСЏ Р»РѕРєР°С†РёРё: РєР°Р¶РґС‹Р№ РїРѕРёСЃРє СѓРІРµР»РёС‡РёРІР°РµС‚ exhaustion.
        // РСЃС‚РѕС‰РµРЅРёРµ СЃРЅРёР¶Р°РµС‚ С€Р°РЅСЃС‹ СЂРµРґРєРѕРіРѕ Р»СѓС‚Р°, РІРѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµС‚СЃСЏ СЃРѕ РІСЂРµРјРµРЅРµРј.
        await client.query(
            `UPDATE locations SET exhaustion = LEAST(100, exhaustion + 5) WHERE id = $1`,
            [locationData.id]
        );

        // Pity timer: СЃР±СЂР°СЃС‹РІР°РµРј РїСЂРё РЅР°С…РѕРґРєРµ РїСЂРµРґРјРµС‚Р° РёР»Рё РєР»СЋС‡Р°, РёРЅР°С‡Рµ РёРЅРєСЂРµРјРµРЅС‚РёСЂСѓРµРј.
        const newStreak = (foundItem || foundKeyInfo) ? 0 : (emptyStreak + 1);
        await client.query(
            `UPDATE players SET empty_searches_streak = $1 WHERE id = $2`,
            [newStreak, playerId]
        );

        // РЎС‡С‘С‚С‡РёРєРё РїСЂРѕРіСЂРµСЃСЃР°: Р±РµР· РЅРёС… РґРѕСЃС‚РёР¶РµРЅРёСЏ В«РљРѕР»Р»РµРєС†РёРѕРЅРµСЂВ»/В«Р•Р¶РµРґРЅРµРІРЅР°СЏ
        // РїРѕР±РµРґР°В» Рё РµР¶РµРґРЅРµРІРЅС‹Рµ Р·Р°РґР°РЅРёСЏ РѕСЃС‚Р°СЋС‚СЃСЏ РЅР° РЅСѓР»Рµ РїСЂРё Р»СЋР±С‹С… РґРµР№СЃС‚РІРёСЏС….
        if (foundItem?.id) {
            await trackCollectedItems(client, playerId, [foundItem.id]);
        }
        await progressDailyTask(client, playerId, 'search', 1);
        if (itemsCollected > 0) {
            await progressDailyTask(client, playerId, 'collect_items', itemsCollected);
        }

        // РџСЂРѕРіСЂРµСЃСЃ РєРѕРЅС‚СЂР°РєС‚РѕРІ
        try {
            const { progressContract } = require('../../utils/game-helpers');
            if (typeof progressContract === 'function') {
                await progressContract(client, playerId, 'scout', 1);
                if (itemsCollected > 0) await progressContract(client, playerId, 'gather', itemsCollected);
            }
        } catch (_) { /* ignore */ }

        // XP С‡РµСЂРµР· РµРґРёРЅС‹Р№ СЃРµСЂРІРёСЃ РїСЂРѕРіСЂРµСЃСЃРёРё (СЃ РїСЂРѕРІРµСЂРєРѕР№ РґРѕСЃС‚РёР¶РµРЅРёР№).
        if (expGained > 0) {
            try {
                const progression = require('../../utils/progression');
                await progression.grantExperience(playerId, expGained, 'search', client);
            } catch (e) {
                // РќРµ СЂРѕРЅСЏРµРј РїРѕРёСЃРє РёР·-Р·Р° XP.
            }
        }

        // РЈСЃРїРµС€РЅС‹Р№ РёСЃС…РѕРґ: СЃРѕР±РёСЂР°РµРј С‚РµР»Рѕ РѕС‚РІРµС‚Р° Рё РѕС‚РґР°С‘Рј РµРіРѕ РЅР°СЂСѓР¶Сѓ, Р°
        // С‚СЂР°РЅР·Р°РєС†РёСЏ РєРѕРјРјРёС‚РёС‚СЃСЏ СЃР°РјР°. РћС‚РІРµС‚ СѓС…РѕРґРёС‚ РёР· transaction()
        // РЅРёР¶Рµ вЂ” СѓР¶Рµ РїРѕСЃР»Рµ COMMIT, РєР°Рє Рё СЂР°РЅСЊС€Рµ, РЅРѕ Р±РµР· СЂСѓС‡РЅРѕРіРѕ COMMIT.
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
                // РљР»СЋС‡ Р±РѕСЃСЃР° РІ РёРЅРІРµРЅС‚Р°СЂСЊ РЅРµ РїРѕРїР°РґР°РµС‚ (С…СЂР°РЅРёС‚СЃСЏ РІ boss_keys),
                // РїРѕСЌС‚РѕРјСѓ РєР»РёРµРЅС‚Сѓ РЅСѓР¶РµРЅ РѕС‚РґРµР»СЊРЅС‹Р№ СЃРёРіРЅР°Р», С‡С‚РѕР±С‹ РїРѕРєР°Р·Р°С‚СЊ РЅР°С…РѕРґРєСѓ.
                found_key: foundKeyInfo,
                energy: {
                    current: newEnergy,
                    max: newMaxEnergy,
                    restored: 0,
                    last_update: lastEnergyUpdate,
                    coins: Number(energyResult.rows[0].coins || 0)
                },
                health: Number(updatedPlayer.health || 0) - (radiationDamage || 0),
                // Р—Р°СЂР°Р¶РµРЅРёРµ Р·РѕРЅРѕР№ вЂ” РѕРґРЅРѕ. РРЅС„РµРєС†РёРё РѕР±СЉРµРґРёРЅРµРЅС‹ СЃ СЂР°РґРёР°С†РёРµР№,
                // РїРѕСЌС‚РѕРјСѓ РѕС‚РґРµР»СЊРЅС‹Р№ Р±Р»РѕРє infection Р±РѕР»СЊС€Рµ РЅРµ РѕС‚РґР°С‘С‚СЃСЏ:
                // РІРµСЃСЊ В«СѓСЂРѕРЅ Р·РѕРЅРµВ» СЃС‡РёС‚Р°РµС‚СЃСЏ РІ radiation.
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
                    // Р”Р°РЅРЅС‹Рµ РјРёСЂР°, РїРѕ РЅРёРј РєР»РёРµРЅС‚ СЂРёСЃСѓРµС‚ РєР°СЂС‚РѕС‡РєСѓ Р»РѕРєР°С†РёРё.
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
            // Р”Р°РЅРЅС‹Рµ РґР»СЏ Р»РѕРіР°: РЅСѓР¶РЅС‹ С‚РѕР»СЊРєРѕ РїСЂРё СѓСЃРїРµС€РЅРѕРј РїРѕРёСЃРєРµ.
            log: {
                foundItemName: foundItem?.name || null,
                effectiveLuck,
                dropChance,
                locationId: locationData.id,
                coinDrop: coinDrop || null
            }
        };
    });

        // Р›РѕРіРёСЂСѓРµРј С‚РѕР»СЊРєРѕ РїСЂРё РІС‹РїРѕР»РЅРµРЅРЅРѕРј РїРѕРёСЃРєРµ вЂ” РІ РІРµС‚РєР°С… РѕС‚РєР°Р·Р° Р»РѕС‚Р° РЅРµ Р±С‹Р»Рѕ.
        if (outcome.log) {
            logger.info(`[world] РџРѕРёСЃРє Р»СѓС‚Р°`, {
                playerId,
                foundItem: outcome.log.foundItemName,
                effectiveLuck: outcome.log.effectiveLuck,
                dropChance: outcome.log.dropChance,
                locationId: outcome.log.locationId
            });
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        // ROLLBACK РІС‹РїРѕР»РЅСЏРµС‚ transaction(). Р’СЂСѓС‡РЅСѓСЋ РѕРЅ Р±С‹Р» РЅСѓР¶РµРЅ С‚РѕР»СЊРєРѕ
        // РёР·-Р·Р° СЂСѓС‡РЅРѕРіРѕ Р¶Рµ BEGIN, Р° С‚РµРїРµСЂСЊ РµС‰С‘ Рё РјРµС€Р°Р»: res.json СЃС‚РѕСЏР»
        // СѓР¶Рµ РїРѕСЃР»Рµ COMMIT, Рё РµРіРѕ РёСЃРєР»СЋС‡РµРЅРёРµ РїСЂРёРІРѕРґРёР»Рѕ Рє РѕС‚РєР°С‚Сѓ
        // Р·Р°РєСЂС‹С‚РѕР№ С‚СЂР°РЅР·Р°РєС†РёРё.
        handleRouteError(res, error, 'location_search', req.playerId);
    }
});

// =============================================================================
// РџР•Р Р•РњР•Р©Р•РќРР• РњР•Р–Р”РЈ Р›РћРљРђР¦РРЇРњР
// =============================================================================

/**
 * РџРµСЂРµРјРµС‰РµРЅРёРµ РјРµР¶РґСѓ Р»РѕРєР°С†РёСЏРјРё
 * POST /world/move в†’ POST /api/game/world/move
 */
router.post('/move', async (req, res) => {
    // Р’Р°Р»РёРґР°С†РёСЏ РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ Р”Рћ РѕС‚РєСЂС‹С‚РёСЏ С‚СЂР°РЅР·Р°РєС†РёРё, РєР°Рє Рё СЂР°РЅСЊС€Рµ: BEGIN
    // РІ РїСЂРµР¶РЅРµР№ Р·Р°РїРёСЃРё СЃС‚РѕСЏР» РїРѕСЃР»Рµ СЌС‚РёС… РїСЂРѕРІРµСЂРѕРє. Р—Р°РѕРґРЅРѕ СѓС…РѕРґРёС‚ Р»РёС€РЅРµРµ
    // Р·Р°РЅСЏС‚РёРµ СЃРѕРµРґРёРЅРµРЅРёСЏ РёР· РїСѓР»Р° РЅР° РІСЂРµРјСЏ РІР°Р»РёРґР°С†РёРё.
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'РќРµРєРѕСЂСЂРµРєС‚РЅРѕРµ С‚РµР»Рѕ Р·Р°РїСЂРѕСЃР°',
            code: 'INVALID_REQUEST_BODY'
        });
    }
    const { location_id } = req.body;

    if (!req.player) {
        return unauthorized(res);
    }
    const playerId = playerIdGuard(req, res);
    if (!playerId) return;
    const locationIdNum = Number(location_id);

    if (location_id === undefined || location_id === null) {
        return res.status(400).json({
            success: false,
            error: 'РЈРєР°Р¶РёС‚Рµ ID Р»РѕРєР°С†РёРё',
            code: 'MISSING_LOCATION_ID'
        });
    }

    if (!validateLocationId(locationIdNum)) {
        return res.status(400).json({
            success: false,
            error: 'ID Р»РѕРєР°С†РёРё РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С†РµР»С‹Рј С‡РёСЃР»РѕРј',
            code: 'INVALID_LOCATION_ID'
        });
    }

    try {
        // РљР°Рє Рё РІ /search: С‚РµР»Рѕ С‚СЂР°РЅР·Р°РєС†РёРё РІРѕР·РІСЂР°С‰Р°РµС‚ СЂРµР·СѓР»СЊС‚Р°С‚, РѕС‚РІРµС‚
        // СѓС…РѕРґРёС‚ РїРѕСЃР»Рµ COMMIT, ROLLBACK РґРµР»Р°РµС‚ transaction().
        const outcome = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'id, level, current_location_id, energy, last_energy_update, active_boss_id, active_raid_id');

            if (!player) {
                return { status: 404, body: { success: false, error: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ', code: 'PLAYER_NOT_FOUND' } };
            }

            // Р—Р°РїСЂРµС‰Р°РµРј РїРµСЂРµРјРµС‰РµРЅРёРµ РІРѕ РІСЂРµРјСЏ Р°РєС‚РёРІРЅРѕРіРѕ Р±РѕСЏ/СЂРµР№РґР°.
            if (player.active_boss_id || player.active_raid_id) {
                return {
                    status: 409,
                    body: {
                        success: false,
                        error: 'РќРµР»СЊР·СЏ РїРµСЂРµРјРµС‰Р°С‚СЊСЃСЏ РІРѕ РІСЂРµРјСЏ Р°РєС‚РёРІРЅРѕРіРѕ Р±РѕСЏ РёР»Рё СЂРµР№РґР°',
                        code: 'ACTIVE_BATTLE_IN_PROGRESS'
                    }
                };
            }

            // РџСЂРѕРІРµСЂСЏРµРј СЃСѓС‰РµСЃС‚РІРѕРІР°РЅРёРµ РёРіСЂРѕРєР°
            if (!player) {
                return {
                    status: 404,
                    body: {
                        success: false,
                        error: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ',
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
                        error: 'Р›РѕРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°',
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
                        error: 'Р­С‚Р° Р»РѕРєР°С†РёСЏ СЃРµР№С‡Р°СЃ РЅРµРґРѕСЃС‚СѓРїРЅР° РґР»СЏ РїРµСЂРµС…РѕРґР°',
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
                        error: `РќСѓР¶РµРЅ СѓСЂРѕРІРµРЅСЊ ${requiredLevel}+`,
                        code: 'INSUFFICIENT_LEVEL',
                        required_level: requiredLevel,
                        current_level: player.level
                    }
                };
            }

            // РџРµСЂРµРјРµС‰РµРЅРёРµ СЃС‚РѕРёС‚ 1 СЌРЅРµСЂРіРёРё
            if (Number(player.energy || 0) < 1) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЌРЅРµСЂРіРёРё РґР»СЏ РїРµСЂРµРјРµС‰РµРЅРёСЏ',
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
                       -- locations_visited С‡РёС‚Р°РµС‚ РґРѕСЃС‚РёР¶РµРЅРёРµ В«РџСѓС‚РµС€РµСЃС‚РІРµРЅРЅРёРєВ»
                       -- (3 Р»РѕРєР°С†РёРё) Рё В«РСЃРєР°С‚РµР»СЊВ» (7). РҐСЂР°РЅРёС‚ РѕР±СЉРµРєС‚С‹ {id, name}.
                        locations_visited = (
                            SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
                              FROM jsonb_array_elements(
                                  COALESCE(locations_visited, '[]'::jsonb)
                                   || jsonb_build_array(jsonb_build_object('id', $1::integer, 'name', $3::text)))
                              AS t(value)
                        )
WHERE id = $2
            `, [locationIdNum, playerId, locationData.name]);

            // РџСЂРѕРіСЂРµСЃСЃ РµР¶РµРґРЅРµРІРЅРѕРіРѕ Р·Р°РґР°РЅРёСЏ В«РїРѕСЃРµС‰РµРЅРёРµ Р»РѕРєР°С†РёР№В»
            try {
                const { progressDailyTask, progressContract } = require('../../utils/game-helpers');
                if (typeof progressDailyTask === 'function') await progressDailyTask(client, playerId, 'locations_visited', 1);
                if (typeof progressContract === 'function') await progressContract(client, playerId, 'locations_visited', 1);
            } catch (_) { /* ignore */ }

            // РћР±РЅРѕРІР»РµРЅРёРµ РѕСЃРІРѕРµРЅРёСЏ Р»РѕРєР°С†РёРё
            try {
                await client.query(`
                    INSERT INTO location_mastery (player_id, location_id, visits_count, last_visit_at)
                    VALUES ($1, $2, 1, NOW())
                    ON CONFLICT (player_id, location_id)
                    DO UPDATE SET visits_count = location_mastery.visits_count + 1, last_visit_at = NOW()
                `, [playerId, locationIdNum]);
            } catch (_) { /* ignore */ }

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        location: {
                            id: locationData.id,
                            name: locationData.name,
                            icon: locationData.icon || 'рџЏ ',
                            radiation: locationData.radiation,
                            danger_level: locationData.danger_level || 1,
                            description: locationData.description
                        },
                        message: `Р’С‹ РїСЂРёР±С‹Р»Рё РІ ${locationData.name}`
                    }
                },
                log: {
                    fromLocationId: player.current_location_id,
                    toLocationId: locationIdNum
                }
            };
        });

        if (outcome.log) {
            logger.info(`[world] РџРµСЂРµРјРµС‰РµРЅРёРµ`, {
                playerId,
                fromLocationId: outcome.log.fromLocationId,
                toLocationId: outcome.log.toLocationId
            });
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        handleRouteError(res, error, 'location_move', req.playerId);
    }
});

module.exports = router;


