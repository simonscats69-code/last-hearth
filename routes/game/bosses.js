/**
 * Р‘РѕСЃСЃС‹: СЃРѕР»Рѕ-Р±РѕС‘РІРєР° Рё РјР°СЃСЃРѕРІС‹Рµ Р±РѕРё.
 *
 * РЎРѕРіР»Р°СЃРѕРІР°РЅРЅР°СЏ РјРѕРґРµР»СЊ:
 * - РћР±С‹С‡РЅС‹Рµ Р±РѕСЃСЃС‹ РґРѕСЃС‚СѓРїРЅС‹ СЃРѕР»Рѕ Рё РІ РјР°СЃСЃРѕРІРѕРј СЂРµР¶РёРјРµ
 * - РљР»СЋС‡Рё С‚СЂР°С‚СЏС‚СЃСЏ С‚РѕР»СЊРєРѕ РїСЂРё СЃС‚Р°СЂС‚Рµ Р±РѕСЏ
 * - РРіСЂРѕРє РјРѕР¶РµС‚ РЅР°С…РѕРґРёС‚СЊСЃСЏ С‚РѕР»СЊРєРѕ РІ РѕРґРЅРѕРј Р°РєС‚РёРІРЅРѕРј Р±РѕСЋ РѕРґРЅРѕРІСЂРµРјРµРЅРЅРѕ
 * - РЎРѕР»Рѕ Рё РјР°СЃСЃРѕРІС‹Р№ Р±РѕР№ вЂ” СЂР°Р·РЅС‹Рµ СЂРµР¶РёРјС‹
 */

const express = require('express');
const router = express.Router();
// transaction() РІРјРµСЃС‚Рѕ СЂСѓС‡РЅРѕРіРѕ pool.connect()/BEGIN/COMMIT/ROLLBACK РІ
// РјР°СЂС€СЂСѓС‚Р°С… СЃ Р·Р°РїРёСЃСЊСЋ: СЃРј. РїРѕСЏСЃРЅРµРЅРёРµ РІ POST /bosses/start. withClient()
// РґР»СЏ С‡С‚РµРЅРёР№, РєРѕС‚РѕСЂС‹Рј С‚СЂР°РЅР·Р°РєС†РёСЏ РЅРµ РЅСѓР¶РЅР° вЂ” СѓРґРѕР±РЅРµРµ СЂСѓС‡РЅРѕРіРѕ pool.connect().
const { transaction, withClient, isConnectionError } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { safeJsonParse, PlayerHelper: playerHelper, handleError, logger, unauthorized, logPlayerAction, requireAuth, requireBossId, requireRaidId } = require('../../utils/serverApi');
const { parseEquipment } = require('../../utils/normalizePlayerJson');
const { setPlayerEquipment } = require('../../db/playerRepository');

// Р›РµРЅРёРІР°СЏ Р·Р°РіСЂСѓР·РєР° helpers: utils/game-helpers.js вЂ” РµРґРёРЅСЃС‚РІРµРЅРЅС‹Р№ РёСЃС‚РѕС‡РЅРёРє
// С„СѓРЅРєС†РёР№ СЃРѕСЃС‚РѕСЏРЅРёСЏ РёРіСЂРѕРєР°. РћРЅ С‚СЏРЅРµС‚ db/database, РїРѕСЌС‚РѕРјСѓ РёРјРїРѕСЂС‚ Р»РµРЅРёРІС‹Р№
// (РёРЅР°С‡Рµ С†РёРєР» Р·Р°РіСЂСѓР·РєРё РјРѕРґСѓР»РµР№).
let gameHelpers = null;
function getGameHelpers() {
    if (!gameHelpers) {
        gameHelpers = require('../../utils/game-helpers');
    }
    return gameHelpers;
}

// Р­РєСЃРїРѕСЂС‚РёСЂСѓРµРјС‹Рµ С„СѓРЅРєС†РёРё С‡РµСЂРµР· getGameHelpers()
const helpers = getGameHelpers();
const { normalizeInventory, getActiveBuffs, createInventoryItem, addItemToInventory, equipmentRules, getSetBonuses, wearEquipmentSlots, trackCollectedItems, progressDailyTask, recalcEnergy } = helpers;
// Р•РґРёРЅС‹Р№ РёСЃС‚РѕС‡РЅРёРє РїСЂР°РІРґС‹: С‚РѕС‚ Р¶Рµ, С‡С‚Рѕ РІ world.js Рё items.js. Р‘РµР· РїСЂРѕРІРµСЂРєРё
// Р»РёРјРёС‚Р° РЅР°РіСЂР°РґР° Р·Р° Р±РѕСЃСЃР° РґРѕРІРµР»Р° Р±С‹ РёРЅРІРµРЅС‚Р°СЂСЊ Р±РѕР»СЊС€Рµ 100 СЃР»РѕС‚РѕРІ.
const MAX_INVENTORY_SLOTS = require('../../public/shared/equipment.js').MAX_INVENTORY_SLOTS;
const combat = require('../../utils/combat');
const crypto = require('crypto');

// РЎРєРѕР»СЊРєРѕ РєР»СЋС‡РµР№ РЅСѓР¶РЅРѕ, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ Р±РѕР№ СЃРѕ РЎР›Р•Р”РЈР®Р©РРњ Р±РѕСЃСЃРѕРј.
// Р’Р»Р°РґРµР»РµС† РєР»СЋС‡Р° вЂ” С‚РµРєСѓС‰РёР№ Р±РѕСЃСЃ: С‡С‚РѕР±С‹ РЅР°С‡Р°С‚СЊ Р±РѕР№ СЃ N, РЅСѓР¶РЅС‹ keys_required
// РєР»СЋС‡РµР№ РѕС‚ Р±РѕСЃСЃР° N-1 (СЌС‚РёРј Р¶Рµ РїРѕР»СЊР·СѓРµС‚СЃСЏ spendBossKeys).
// Fallback = 1: Р·Р° СѓР±РёР№СЃС‚РІРѕ РІС‹РґР°С‘С‚СЃСЏ СЂРѕРІРЅРѕ РѕРґРёРЅ РєР»СЋС‡, РїРѕСЌС‚РѕРјСѓ Р»СЋР±РѕРµ Р±РѕР»СЊС€РµРµ
// Р·РЅР°С‡РµРЅРёРµ РґРµР»Р°РµС‚ Р±РѕСЃСЃРѕРІ СЃРѕ РІС‚РѕСЂРѕРіРѕ РЅРµРґРѕСЃС‚РёР¶РёРјС‹РјРё РЅР°РІСЃРµРіРґР°.
//
// P1-6: РѕС€РёР±РєСѓ Р‘Р” Р·РґРµСЃСЊ РЅР°РјРµСЂРµРЅРЅРѕ РќР• РіР»СѓС€РёРј.
//
// Р‘С‹Р»Рѕ `catch { return 1; }` вЂ” Рё Р»СЋР±РѕР№ СЃР±РѕР№ Р·Р°РїСЂРѕСЃР° (РѕР±СЂС‹РІ СЃРѕРµРґРёРЅРµРЅРёСЏ,
// С‚Р°Р№РјР°СѓС‚, РїР°РґРµРЅРёРµ РїСѓР»Р°) РјРѕР»С‡Р° РїСЂРµРІСЂР°С‰Р°Р»СЃСЏ РІ В«РЅСѓР¶РµРЅ 1 РєР»СЋС‡В». РџРѕСЃР»РµРґСЃС‚РІРёСЏ:
//   * spendBossKeys РЅРµРґРѕСЃРїРёСЃС‹РІР°Р» РєР»СЋС‡Рё, РµСЃР»Рё Р±РѕСЃСЃ С‚СЂРµР±СѓРµС‚ 3;
//   * raid/:id/join РїСѓСЃРєР°Р» РёРіСЂРѕРєР° РІ СЂРµР№Рґ СЃ РјРµРЅСЊС€РёРј С‡РёСЃР»РѕРј РєР»СЋС‡РµР№, С‡РµРј
//     С‚СЂРµР±СѓРµС‚СЃСЏ РґР»СЏ РІС…РѕРґРЅРѕР№ С†РµРїРѕС‡РєРё.
// РћС‚СЃСѓС‚СЃС‚РІРёРµ СЃС‚СЂРѕРєРё вЂ” СЌС‚Рѕ РќР• РѕС€РёР±РєР° (Р±РѕСЃСЃ СѓРґР°Р»С‘РЅ РёР»Рё id = 0), fallback 1
// СЃРѕС…СЂР°РЅСЏРµС‚СЃСЏ. РћС€РёР±РєР° Р·Р°РїСЂРѕСЃР° РїСЂРѕР±СЂР°СЃС‹РІР°РµС‚СЃСЏ: СЂРѕСѓС‚ РїРѕРєР°Р¶РµС‚ 500/503, Р° РЅРµ
// С‚РёС…Рѕ РїСЂРѕРІРµРґС‘С‚ РѕРїРµСЂР°С†РёСЋ РїРѕ РЅРµРІРµСЂРЅС‹Рј РґР°РЅРЅС‹Рј.
async function getKeysRequiredForBoss(client, bossId) {
    const result = await client.query(
        'SELECT keys_required FROM bosses WHERE id = $1',
        [bossId]
    );
    return Math.max(1, Number(result.rows[0]?.keys_required) || 1);
}
const SOLO_FIGHT_DURATION_MS = 8 * 60 * 60 * 1000;
const MASS_FIGHT_DURATION_MS = 8 * 60 * 60 * 1000;

/** РЎРєРѕР»СЊРєРѕ СЃРѕР±С‹С‚РёР№ Р±РѕСЏ СЂРµР№РґР° С…СЂР°РЅРёРј РІ raid_progress.raid_log */
const RAID_LOG_MAX_EVENTS = 20;

/** Р‘РѕРЅСѓСЃ Рє РґРѕР»Рµ РЅР°РіСЂР°РґС‹ Р·Р° РїРµСЂРІС‹Р№ СѓРґР°СЂ РїРѕ СЂРµР№РґРѕРІРѕРјСѓ Р±РѕСЃСЃСѓ (+5%) */
const RAID_FIRST_HIT_BONUS = 0.05;

/** Р‘РѕРЅСѓСЃ Рє РґРѕР»Рµ РЅР°РіСЂР°РґС‹ Р·Р° СЃРјРµСЂС‚РµР»СЊРЅС‹Р№ СѓРґР°СЂ РІ СЂРµР№РґРµ (+5%) */
const RAID_LAST_HIT_BONUS = 0.05;

/**
 * Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ РІСЂРѕРґРµ В«8 С‡В» РёР»Рё В«8 С‡ 30 РјРёРЅВ» РґР»СЏ РїРѕРґСЃРєР°Р·РѕРє РІ info.
 * Р‘РµР· С„РѕСЂРјР°С‚С‚РµСЂР° С‡Р°СЃС‹ РїСЂРёС…РѕРґРёР»РѕСЃСЊ РІРїРёСЃС‹РІР°С‚СЊ РІ С‚РµРєСЃС‚ СЂСѓРєР°РјРё, Рё РїРѕРґСЃРєР°Р·РєР°
 * СЂР°СЃС…РѕРґРёР»Р°СЃСЊ СЃ SOLO_FIGHT_DURATION_MS РїСЂРё СЃРјРµРЅРµ Р±Р°Р»Р°РЅСЃР°.
 */
function formatDuration(ms) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((ms % (60 * 1000)) / 1000);
    if (hours > 0 && minutes > 0) return `${hours} С‡ ${minutes} РјРёРЅ`;
    if (hours > 0) return `${hours} С‡`;
    if (minutes > 0) return `${minutes} РјРёРЅ`;
    return `${seconds} СЃРµРє`;
}


/**
 * РЈСЂРѕРЅ, РєРѕС‚РѕСЂС‹Р№ Р±РѕСЃСЃ РЅР°РЅРѕСЃРёС‚ РёРіСЂРѕРєСѓ РІ РѕС‚РІРµС‚ РЅР° СѓРґР°СЂ.
 *
 * Р‘С‹Р»Рѕ: РїСЂРѕС†РµРЅС‚ РѕС‚ max_health РёРіСЂРѕРєР°. РР·-Р·Р° СЌС‚РѕРіРѕ РєР°С‡Р°С‚СЊ Р·РґРѕСЂРѕРІСЊРµ Р±С‹Р»Рѕ
 * Р±РµСЃСЃРјС‹СЃР»РµРЅРЅРѕ вЂ” СѓСЂРѕРЅ СЂРѕСЃ СЂРѕРІРЅРѕ РЅР°СЃС‚РѕР»СЊРєРѕ Р¶Рµ, РЅР° СЃРєРѕР»СЊРєРѕ СЂРѕСЃ Р·Р°РїР°СЃ HP,
 * Рё С‡РёСЃР»Рѕ survivable-СѓРґР°СЂРѕРІ РЅРµ РјРµРЅСЏР»РѕСЃСЊ. РџР»СЋСЃ РІРµСЃСЊ СѓСЂРѕРЅ Р±РѕСЃСЃРѕРІ СѓРєР»Р°РґС‹РІР°Р»СЃСЏ
 * РІ 2вЂ“10 РµРґРёРЅРёС†, РіРґРµ 20% Р±СЂРѕРЅРё РЅРµРѕС‚Р»РёС‡РёРјС‹ РѕС‚ РЅСѓР»СЏ.
 *
 * РЎС‚Р°Р»Рѕ: РґРІРµ РЅРµР·Р°РІРёСЃРёРјС‹Рµ РІРµР»РёС‡РёРЅС‹.
 *
 *   peak  = BOSS_COUNTER_BASE + bosses.level * BOSS_COUNTER_PER_LEVEL
 *           РїРёРєРѕРІР°СЏ СЃРёР»Р° СѓРґР°СЂР° Р±РѕСЃСЃР° вЂ” РїРѕР·РґРЅРёРµ Р±РѕСЃСЃС‹ Р±СЊСЋС‚ Р±РѕР»СЊРЅРµРµ;
 *   ratio = current_health / max_health
 *           РґРѕР»СЏ РћРЎРўРђР’РЁР•Р“РћРЎРЇ Р·РґРѕСЂРѕРІСЊСЏ. Р§РµРј СЃРёР»СЊРЅРµРµ Р±РѕСЃСЃ РїРѕР±РёС‚, С‚РµРј СЃР»Р°Р±РµРµ
 *           Р±СЊС‘С‚ РѕРЅ: РґРѕР±РёРІР°РЅРёРµ Р±РµР·РѕРїР°СЃРЅРµРµ РЅР°С‡Р°Р»Р° Р±РѕСЏ.
 *
 *   raw   = round(peak * ratio)   ->  Сѓ РїРѕС‡С‚Рё РјС‘СЂС‚РІРѕРіРѕ Р±РѕСЃСЃР° РІС‹С…РѕРґРёС‚ 0
 *
 * Р—Р°С‰РёС‚Р° = СЌРєРёРїРёСЂРѕРІРєР° + 3 Р·Р° РєР°Р¶РґС‹Р№ РЅРѕРІС‹Р№ СѓСЂРѕРІРµРЅСЊ РёРіСЂРѕРєР°.
 *
 * @param {object} boss СЃС‚СЂРѕРєР° bosses (РЅСѓР¶РЅС‹ level, max_health)
 * @param {number} maxHealth РјР°РєСЃРёРјР°Р»СЊРЅРѕРµ Р·РґРѕСЂРѕРІСЊРµ РёРіСЂРѕРєР° (РЅРµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ,
 *        РѕСЃС‚Р°РІР»РµРЅРѕ РґР»СЏ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё РІС‹Р·РѕРІРѕРІ)
 * @param {object} equipment СЌРєРёРїРёСЂРѕРІРєР° РёРіСЂРѕРєР°
 * @param {Object} [options]
 * @param {number} [options.currentHealth] С‚РµРєСѓС‰РµРµ HP Р±РѕСЃСЃР°; Р±РµР· РЅРµРіРѕ Р±РµСЂС‘С‚СЃСЏ
 *        РїРѕР»РЅРѕРµ (РЅСѓР¶РЅРѕ РґР»СЏ РєР°СЂС‚РѕС‡РєРё Р±РѕСЏ РґРѕ РїРµСЂРІРѕРіРѕ СѓРґР°СЂР°)
 * @param {number} [options.playerLevel] СѓСЂРѕРІРµРЅСЊ РёРіСЂРѕРєР° вЂ” РґР°С‘С‚ Р·Р°С‰РёС‚Сѓ
 * @returns {number} СѓСЂРѕРЅ (РјРѕР¶РµС‚ Р±С‹С‚СЊ 0)
 */
function getNextBossId(bossId) {
    return bossId + 1;
}

function normalizeRewardItems(rawRewardItems) {
    const parsed = safeJsonParse(rawRewardItems, []);
    return Array.isArray(parsed) ? parsed : [];
}

function calculateGrantedQuantity(totalQuantity, multiplier = 1) {
    const expectedQuantity = Math.max(0, Number(totalQuantity || 0) * Number(multiplier || 0));
    const guaranteedQuantity = Math.floor(expectedQuantity);
    const fractionalPart = expectedQuantity - guaranteedQuantity;

    return guaranteedQuantity + (crypto.randomInt(10000) / 10000 < fractionalPart ? 1 : 0);
}

/**
 * РЎР»РѕС‚С‹ СЌРєРёРїРёСЂРѕРІРєРё, РєРѕС‚РѕСЂС‹Рµ РїРѕР»СѓС‡Р°СЋС‚ РёР·РЅРѕСЃ РѕС‚ РѕС‚РІРµС‚РЅРѕРіРѕ СѓРґР°СЂР° Р±РѕСЃСЃР°.
 *
 * Р‘РѕСЃСЃ Р±СЊС‘С‚ РІ РѕС‚РІРµС‚ РЅР° Р›Р®Р‘РЈР® Р°С‚Р°РєСѓ РёРіСЂРѕРєР°, РїРѕСЌС‚РѕРјСѓ РёР·РЅР°С€РёРІР°РµС‚СЃСЏ РІСЃС‘
 * РЅР°РґРµС‚РѕРµ СЃРЅР°СЂСЏР¶РµРЅРёРµ, РІРєР»СЋС‡Р°СЏ РѕСЂСѓР¶РёРµ РІ СЂСѓРєР°С….
 *
 * РЎРїРёСЃРѕРє Р±РµСЂС‘Рј РёР· РєР°РЅРѕРЅР° COMBAT_SLOTS, Р° РЅРµ РїРёС€РµРј СЂСѓРєР°РјРё: СЂСѓС‡РЅР°СЏ РєРѕРїРёСЏ
 * РѕС‚СЃС‚Р°Р»Р° РѕС‚ РєР°РЅРѕРЅР° СЂРѕРІРЅРѕ РѕРґРёРЅ СЂР°Р· (РІ РЅРµР№ РѕСЃС‚Р°РІР°Р»СЃСЏ СѓРґР°Р»С‘РЅРЅС‹Р№ СЃР»РѕС‚ 'head'
 * Рё РЅРµ Р±С‹Р»Рѕ 'face'), Рё РёР·РЅРѕСЃ РїРѕ РјР°СЃРєР°Рј/РїСЂРѕС‚РёРІРѕРіР°Р·Р°Рј РїСЂРѕСЃС‚Рѕ РЅРµ РЅР°С‡РёСЃР»СЏР»СЃСЏ.
 */
const COUNTER_HIT_WEAR_SLOTS = equipmentRules.COMBAT_SLOTS;

/**
 * РћС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ Р±РѕСЃСЃР°: СѓСЂРѕРЅ РёРіСЂРѕРєСѓ + РёР·РЅРѕСЃ СЌРєРёРїРёСЂРѕРІРєРё.
 *
 * Р’РЅСѓС‚СЂРё С‚СЂР°РЅР·Р°РєС†РёРё. Р’РѕР·РІСЂР°С‰Р°РµС‚ С„Р°РєС‚РёС‡РµСЃРєРёР№ СѓСЂРѕРЅ, РѕСЃС‚Р°С‚РѕРє Р·РґРѕСЂРѕРІСЊСЏ Рё СЃР»РѕС‚С‹,
 * РіРґРµ СЃРЅР°СЂСЏР¶РµРЅРёРµ СЃР»РѕРјР°Р»РѕСЃСЊ (РєР»РёРµРЅС‚Сѓ РЅСѓР¶РЅРѕ РїРѕРєР°Р·Р°С‚СЊ РїСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ).
 *
 * @param {object} client РєР»РёРµРЅС‚ Р‘Р” (С‚СЂР°РЅР·Р°РєС†РёСЏ)
 * @param {number} playerId
 * @param {object} boss СЃС‚СЂРѕРєР° bosses
 * @param {object} player С‚РµРєСѓС‰РµРµ СЃРѕСЃС‚РѕСЏРЅРёРµ РёРіСЂРѕРєР°
 * @param {number} [bossCurrentHp] С‚РµРєСѓС‰РµРµ HP Р±РѕСЃСЃР°. Р‘РµР· РЅРµРіРѕ Р±РѕСЃСЃ СЃС‡РёС‚Р°РµС‚СЃСЏ
 *        С†РµР»С‹Рј Рё Р±СЊС‘С‚ РЅР° РїРѕР»РЅСѓСЋ СЃРёР»Сѓ.
 */
async function applyBossCounterHit(client, playerId, boss, player, bossCurrentHp) {
    const equipment = parseEquipment(player.equipment);
    let setDefense = 0;
    try {
        const sb = await getSetBonuses(equipment, client);
        setDefense = Number(sb && sb.defense) || 0;
    } catch (_) { /* ignore */ }
    const damage = combat.calculateBossCounterDamage(boss, equipment, {
        currentHealth: bossCurrentHp,
        playerLevel: player.level,
        setDefense
    });
    if (damage <= 0) {
        // РџРѕС‡С‚Рё РґРѕР±РёС‚С‹Р№ Р±РѕСЃСЃ РЅРµ Р±СЊС‘С‚ вЂ” РЅРѕ РёР·РЅРѕСЃ РЎРќРђР РЇР–Р•РќРРЇ РІСЃС‘ СЂР°РІРЅРѕ РёРґС‘С‚:
        // РёРіСЂРѕРє РїСЂРѕРґРѕР»Р¶Р°Р» РјР°С…Р°С‚СЊ РѕСЂСѓР¶РёРµРј, СЂР°Р±РѕС‚Р° С€Р»Р°. РРЅР°С‡Рµ РґРѕР±РёРІР°РЅРёРµ
        // СЃС‚Р°РЅРѕРІРёР»РѕСЃСЊ Р±С‹ Р±РµСЃРєРѕРЅРµС‡РЅС‹Рј Рё Р±РµСЃРїР»Р°С‚РЅС‹Рј РїРѕ РїСЂРѕС‡РЅРѕСЃС‚Рё.
const brokenSlots = wearEquipmentSlots(
            equipment,
            COUNTER_HIT_WEAR_SLOTS
        );
            await setPlayerEquipment(playerId, equipment, client);
            return { damage: 0, health: Number(player.health || 0), broken_slots: brokenSlots };
    }

    const health = Math.max(0, (Number(player.health) || 0) - damage);
const brokenSlots = wearEquipmentSlots(
            equipment,
            COUNTER_HIT_WEAR_SLOTS
        );

    // РЈСЂРѕРЅ Рё РёР·РЅРѕСЃ С„РёРєСЃРёСЂСѓРµРј РѕРґРЅРёРј UPDATE: Р·РґРѕСЂРѕРІСЊРµ РїРѕСЃР»Рµ РѕС‚РІРµС‚РЅРѕРіРѕ СѓРґР°СЂР°
    // Рё СЃРЅР°СЂСЏР¶РµРЅРёРµ РґРѕР»Р¶РЅС‹ СЃРѕР±Р»СЋРґР°С‚СЊСЃСЏ РІРјРµСЃС‚Рµ, РёРЅР°С‡Рµ РІ Р‘Р” РѕСЃС‚Р°С‘С‚СЃСЏ СѓСЂРѕРЅ
    // Р±РµР· РёР·РЅРѕСЃР° (РёР»Рё РЅР°РѕР±РѕСЂРѕС‚).
    await client.query(
        `UPDATE players
            SET health = $1,
                equipment = $2::jsonb
          WHERE id = $3`,
        [health, JSON.stringify(equipment), playerId]
    );

    // РђРІС‚РѕР»РµС‡РµРЅРёРµ СѓР±СЂР°РЅРѕ: Р»РµРєР°СЂСЃС‚РІР° СЂР°СЃС…РѕРґСѓСЋС‚СЃСЏ РўРћР›Р¬РљРћ РІСЂСѓС‡РЅСѓСЋ, СЃ РїР°РЅРµР»Рё
    // Р»РµС‡РµРЅРёСЏ РЅР° РіР»Р°РІРЅРѕРј СЌРєСЂР°РЅРµ. Р Р°РЅСЊС€Рµ Р·РґРµСЃСЊ РІС‹Р·С‹РІР°Р»СЃСЏ applyAutoHeal,
    // РєРѕС‚РѕСЂС‹Р№ СЃР°Рј СЃРїРёСЃС‹РІР°Р» Р°РїС‚РµС‡РєСѓ вЂ” РїСЂРёС€Р»РѕСЃСЊ СѓР±РёСЂР°С‚СЊ, С‡С‚РѕР±С‹ СЂР°СЃС…РѕРґ
    // Р»РµРєР°СЂСЃС‚РІР° Р·Р°РІРёСЃРµР» С‚РѕР»СЊРєРѕ РѕС‚ СЂРµС€РµРЅРёСЏ РёРіСЂРѕРєР°.
    return {
        damage,
        health,
        broken_slots: brokenSlots,
    };
}

async function getBossById(client, bossId) {
    const result = await client.query('SELECT * FROM bosses WHERE id = $1', [bossId]);
    return result.rows[0] || null;
}

async function getPlayerBaseState(client, playerId) {
    // РќР°СЃС‚СЂРѕР№РєРё Р°РІС‚РѕР»РµС‡РµРЅРёСЏ СѓР±СЂР°РЅС‹ РёР· SELECT: РєРѕР»РѕРЅРєРё players.*auto_heal*
    // Р±РѕР»СЊС€Рµ РЅРµ С‡РёС‚Р°СЋС‚СЃСЏ РЅРё РѕРґРЅРёРј СЂРѕСѓС‚РѕРј РїРѕСЃР»Рµ СѓРґР°Р»РµРЅРёСЏ Р°РІС‚РѕРёСЃРїРѕР»СЊР·РѕРІР°РЅРёСЏ
    // Р»РµРєР°СЂСЃС‚РІ. Р›РµРєР°СЂСЃС‚РІР° СЂР°СЃС…РѕРґСѓСЋС‚СЃСЏ С‚РѕР»СЊРєРѕ РІСЂСѓС‡РЅСѓСЋ.
    const result = await client.query(
        `SELECT id, first_name, level, health, max_health, energy, max_energy, last_energy_update, radiation, equipment,
                inventory, active_boss_id, active_boss_started_at, active_boss_mode,
                active_raid_id, buffs
         FROM players
         WHERE id = $1
         FOR UPDATE`,
        [playerId]
    );

    return result.rows[0] || null;
}

async function clearPlayerActiveBattle(client, playerId) {
    await client.query(
        `UPDATE players
         SET active_boss_id = NULL,
             active_boss_started_at = NULL,
             active_boss_mode = NULL,
             active_raid_id = NULL
         WHERE id = $1`,
        [playerId]
    );
}

async function clearActiveBattleForPlayers(client, playerIds, raidId) {
    if (!playerIds.length) return;

    await client.query(
        `UPDATE players
         SET active_boss_id = NULL,
             active_boss_started_at = NULL,
             active_boss_mode = NULL,
             active_raid_id = NULL
         WHERE id = ANY($1::bigint[])
           AND active_raid_id = $2`,
        [playerIds, raidId]
    );
}

async function resolveActiveBattle(client, playerId) {
    const player = await getPlayerBaseState(client, playerId);
    if (!player || !player.active_boss_mode) {
        return null;
    }

    if (player.active_boss_mode === 'solo') {
        // Р•СЃР»Рё РёРіСЂРѕРє РјС‘СЂС‚РІ, Р±РѕР№ РЅРµ РІРѕР·РѕР±РЅРѕРІР»СЏРµРј вЂ” РѕС‡РёС‰Р°РµРј Рё РЅР°С‡РёРЅР°РµРј Р·Р°РЅРѕРІРѕ.
        if (Number(player.health || 0) <= 0) {
            await clearPlayerActiveBattle(client, playerId);
            await client.query('DELETE FROM player_boss_progress WHERE player_id = $1', [playerId]);
            return null;
        }

        if (!player.active_boss_started_at || !player.active_boss_id) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const startedAt = new Date(player.active_boss_started_at).getTime();
        if (Number.isNaN(startedAt)) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }
        const timePassed = Date.now() - startedAt;
        if (timePassed >= SOLO_FIGHT_DURATION_MS) {
            await client.query('DELETE FROM player_boss_progress WHERE player_id = $1', [playerId]);
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const result = await client.query(
            `SELECT b.id, b.name, b.icon, b.max_health, b.reward_coins, b.reward_experience,
                    pbp.current_hp, pbp.max_hp, pbp.started_at
             FROM bosses b
             JOIN player_boss_progress pbp ON pbp.boss_id = b.id AND pbp.player_id = $1
             WHERE b.id = $2`,
            [playerId, player.active_boss_id]
        );

        const boss = result.rows[0];
        if (!boss) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        return {
            type: 'solo',
            boss_id: boss.id,
            started_at: player.active_boss_started_at,
            time_remaining_ms: SOLO_FIGHT_DURATION_MS - timePassed,
            boss: {
                id: boss.id,
                name: boss.name,
                icon: boss.icon,
                hp: boss.current_hp,
                max_hp: boss.max_hp,
                reward_coins: boss.reward_coins,
                reward_experience: boss.reward_experience
            }
        };
    }

    if (player.active_boss_mode === 'mass') {
        if (!player.active_raid_id) {
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        const raidResult = await client.query(
            `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                    b.name, b.icon, b.reward_coins, b.reward_experience
             FROM raid_progress rp
             JOIN bosses b ON b.id = rp.boss_id
             WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()`,
            [player.active_raid_id]
        );

        const raid = raidResult.rows[0];
        if (!raid) {
            await client.query('DELETE FROM boss_sessions WHERE player_id = $1 AND raid_id = $2', [playerId, player.active_raid_id]);
            await clearPlayerActiveBattle(client, playerId);
            return null;
        }

        return {
            type: 'mass',
            raid_id: raid.id,
            boss_id: raid.boss_id,
            started_at: player.active_boss_started_at,
            time_remaining_ms: Math.max(0, new Date(raid.expires_at).getTime() - Date.now()),
            boss: {
                id: raid.boss_id,
                name: raid.name,
                icon: raid.icon,
                hp: raid.current_health,
                max_hp: raid.max_health,
                reward_coins: raid.reward_coins,
                reward_experience: raid.reward_experience
            }
        };
    }

    await clearPlayerActiveBattle(client, playerId);
    return null;
}

async function getBossMasteries(client, playerId) {
    const result = await client.query('SELECT boss_id, kills FROM boss_mastery WHERE player_id = $1', [playerId]);
    return result.rows;
}

async function getPlayerKeyCount(client, playerId, previousBossId, forUpdate = false) {
    if (previousBossId <= 0) return 0;

    const lock = forUpdate ? ' FOR UPDATE' : '';
    const result = await client.query(
        `SELECT quantity FROM boss_keys WHERE player_id = $1 AND boss_id = $2${lock}`,
        [playerId, previousBossId]
    );

    return result.rows[0]?.quantity || 0;
}

/**
 * РЎРїРёСЃР°С‚СЊ РєР»СЋС‡Рё Р·Р° РѕС‚РєСЂС‹С‚РёРµ Р±РѕСЏ СЃ Р±РѕСЃСЃРѕРј.
 *
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ Р¤РђРљРўРР§Р•РЎРљР СЃРїРёСЃР°РЅРЅРѕРµ С‡РёСЃР»Рѕ. Р Р°РЅСЊС€Рµ РІС‹Р·С‹РІР°СЋС‰РёР№ РєРѕРґ СѓР·РЅР°РІР°Р» РµРіРѕ
 * РїРѕРІС‚РѕСЂРЅС‹Рј Р·Р°РїСЂРѕСЃРѕРј Рє bosses.keys_required СѓР¶Рµ РїРѕСЃР»Рµ COMMIT: Р·РЅР°С‡РµРЅРёРµ РјРѕРіР»Рѕ
 * СЂР°Р·РѕР№С‚РёСЃСЊ СЃРѕ СЃРїРёСЃР°РЅРЅС‹Рј, Р° СЃР±РѕР№ СЌС‚РѕРіРѕ Р·Р°РїСЂРѕСЃР° РїСЂРёРІРѕРґРёР» Рє РѕС€РёР±РєРµ СѓР¶Рµ РїРѕСЃР»Рµ
 * С‚РѕРіРѕ, РєР°Рє Р±РѕР№ РЅР°С‡Р°Р»СЃСЏ Рё РєР»СЋС‡Рё СЃРїРёСЃР°РЅС‹.
 *
 * @returns {Promise<number>} СЃРєРѕР»СЊРєРѕ РєР»СЋС‡РµР№ СЃРїРёСЃР°РЅРѕ (0 вЂ” РїРµСЂРІС‹Р№ Р±РѕСЃСЃ)
 */
async function spendBossKeys(client, playerId, previousBossId) {
    if (previousBossId <= 0) return 0;

    const keysRequired = await getKeysRequiredForBoss(client, previousBossId);
    // Р‘Р»РѕРєРёСЂСѓРµРј СЃС‚СЂРѕРєСѓ РєР»СЋС‡РµР№ РґР»СЏ РїСЂРµРґРѕС‚РІСЂР°С‰РµРЅРёСЏ race condition
    const nowOwned = await getPlayerKeyCount(client, playerId, previousBossId, true);
    if (nowOwned < keysRequired) {
        throw {
            message: `РќСѓР¶РЅРѕ ${keysRequired} РєР»СЋС‡РµР№ РѕС‚ Р±РѕСЃСЃР° ${previousBossId}`,
            code: 'INSUFFICIENT_KEYS',
            statusCode: 400,
            keys_owned: nowOwned,
            keys_required: keysRequired
        };
    }

    const updateResult = await client.query(
        `UPDATE boss_keys
         SET quantity = quantity - $1
         WHERE player_id = $2 AND boss_id = $3 AND quantity >= $1`,
        [keysRequired, playerId, previousBossId]
    );
    if (updateResult.rowCount === 0) {
        throw {
            message: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РєР»СЋС‡РµР№ РѕС‚ Р±РѕСЃСЃР° ${previousBossId}`,
            code: 'INSUFFICIENT_KEYS',
            statusCode: 400,
            keys_owned: await getPlayerKeyCount(client, playerId, previousBossId),
            keys_required: keysRequired
        };
    }

    return keysRequired;
}

/**
 * РљР»СЋС‡Рё, РІС‹РґР°РІР°РµРјС‹Рµ Р·Р° СѓР±РёР№СЃС‚РІРѕ Р±РѕСЃСЃР°.
 *
 * РЎРјС‹СЃР» РєРѕР»РѕРЅРєРё boss_keys.boss_id: СЌС‚Рѕ id Р±РѕСЃСЃР°, Р§Р•Р™ РєР»СЋС‡ Сѓ РёРіСЂРѕРєР° (РєР»СЋС‡
 * РІС‹РїР°РґР°РµС‚ СЃ СЌС‚РѕРіРѕ Р±РѕСЃСЃР° Рё РѕС‚РєСЂС‹РІР°РµС‚ Р±РѕР№ СЃРѕ СЃР»РµРґСѓСЋС‰РёРј). РўР°РєР°СЏ С‚СЂР°РєС‚РѕРІРєР°
 * СЃРѕРіР»Р°СЃРѕРІР°РЅР° СЃРѕ spendBossKeys(): С‡С‚РѕР±С‹ РЅР°С‡Р°С‚СЊ Р±РѕР№ СЃ N, РЅСѓР¶РЅС‹ keys_required
 * РєР»СЋС‡РµР№ РѕС‚ Р±РѕСЃСЃР° N-1.
 *
 * @returns {Promise<object|null>} РѕРїРёСЃР°РЅРёРµ РІС‹РґР°РЅРЅРѕРіРѕ РєР»СЋС‡Р° РёР»Рё null
 */
async function grantNextBossKey(client, playerId, bossId) {
    const nextBossId = getNextBossId(bossId);
    const nextBoss = await getBossById(client, nextBossId);
    if (!nextBoss) return null; // РїРѕСЃР»РµРґРЅРёР№ Р±РѕСЃСЃ: РєР»СЋС‡ РІРµСЃС‚Рё РЅРµРєСѓРґР°

    // РЎРєРѕР»СЊРєРѕ РєР»СЋС‡РµР№ РЅСѓР¶РЅРѕ РЅР° СЃР»РµРґСѓСЋС‰РёР№ Р±РѕР№ вЂ” СЃС‚РѕР»СЊРєРѕ Рё РІС‹РґР°С‘Рј, С‡С‚РѕР±С‹ РѕРґРЅР°
    // РїРѕР±РµРґР° РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ РѕС‚РєСЂС‹РІР°Р»Р° СЃР»РµРґСѓСЋС‰СѓСЋ СЃС‚СѓРїРµРЅСЊ.
    const quantity = await getKeysRequiredForBoss(client, bossId);

    await client.query(
        `INSERT INTO boss_keys (player_id, boss_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (player_id, boss_id)
         DO UPDATE SET quantity = boss_keys.quantity + EXCLUDED.quantity`,
        [playerId, bossId, quantity]
    );

    return {
        boss_id: bossId,
        quantity,
        unlocks_boss_id: nextBossId,
        boss_name: nextBoss.name
    };
}

async function loadItemTemplates(client, rewardItems) {
    const ids = rewardItems.map(r => r.item_id || r.id).filter(Boolean);
    const templates = [];
    let itemMap = {};

    if (ids.length) {
        const result = await client.query(
            `SELECT id, name, type, category, rarity, icon, slot, durability, stats,
                    COALESCE((stats->>'damage')::integer, 0) AS damage,
                    COALESCE((stats->>'defense')::integer, 0) AS defense
             FROM items WHERE id = ANY($1::int[])`,
            [ids]
        );
        itemMap = {};
        for (const r of result.rows) {
            itemMap[r.id] = r; // С‡РёСЃР»РѕРІС‹Рµ РєР»СЋС‡Рё РґР»СЏ С‚РѕС‡РЅРѕРіРѕ РїРѕРёСЃРєР°
        }
    }

    for (const reward of rewardItems) {
        if (reward.item_id || reward.id) {
            const itemId = reward.item_id || reward.id;
            const item = itemMap[itemId];
            if (item) {
                templates.push(createInventoryItem(item, {
                    quantity: Number(reward.quantity || 1)
                }));
            }
        } else if (reward.name && reward.type) {
            templates.push(createInventoryItem(reward, {
                quantity: Number(reward.quantity || 1)
            }));
        }
    }

    return templates;
}

/**
 * Р’С‹РґР°С‚СЊ РїСЂРµРґРјРµС‚С‹-РЅР°РіСЂР°РґС‹ РёРіСЂРѕРєСѓ.
 *
 * @param {object} client - РєР»РёРµРЅС‚ С‚СЂР°РЅР·Р°РєС†РёРё
 * @param {number} playerId - РєРѕРјСѓ
 * @param {Array} rewardItems - РЅР°РіСЂР°РґРЅС‹Рµ РїСЂРµРґРјРµС‚С‹ ({item_id|name} + quantity)
 * @param {number} multiplier - РјРЅРѕР¶РёС‚РµР»СЊ РєРѕР»РёС‡РµСЃС‚РІР°
 * @param {Array|null} preloadedTemplates - Р·Р°СЂР°РЅРµРµ Р·Р°РіСЂСѓР¶РµРЅРЅС‹Рµ С€Р°Р±Р»РѕРЅС‹.
 *   РќСѓР¶РЅС‹ РїСЂРё РїР°РєРµС‚РЅРѕР№ РІС‹РґР°С‡Рµ (СЂРµР№Рґ): reward_items Сѓ СЂРµР№РґР° РѕРґРЅРё РЅР° РІСЃРµС…,
 *   Р° loadItemTemplates РґРµР»Р°РµС‚ Р·Р°РїСЂРѕСЃ Рє items вЂ” РЅР° РєР°Р¶РґРѕРіРѕ СѓС‡Р°СЃС‚РЅРёРєР°
 *   СЌС‚Рѕ Р±С‹Р» N+1. Р’С‹Р·С‹РІР°СЋС‰Р°СЏ СЃС‚РѕСЂРѕРЅР° РіСЂСѓР·РёС‚ С€Р°Р±Р»РѕРЅС‹ РѕРґРёРЅ СЂР°Р· Рё РїРµСЂРµРґР°С‘С‚.
 */
async function grantRewardItems(client, playerId, rewardItems, multiplier = 1, preloadedTemplates = null) {
    const normalizedItems = normalizeRewardItems(rewardItems);
    if (!normalizedItems.length || multiplier <= 0) return { granted: [], undropped: [] };

    const templates = preloadedTemplates || await loadItemTemplates(client, normalizedItems);
    if (!templates.length) return { granted: [], undropped: [] };

    const playerRow = await lockPlayer(playerId, client, 'inventory');
    if (!playerRow) throw { message: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    const inventory = await (helpers.loadInventoryFromTable || (async () => null))(client, playerId) || normalizeInventory(playerRow.inventory);
    const granted = [];
    const undropped = [];
    let totalGrantedCount = 0;

    for (const template of templates) {
        const totalQuantity = Math.max(1, template.quantity || 1);
        const grantedQuantity = calculateGrantedQuantity(totalQuantity, multiplier);

        if (grantedQuantity <= 0) continue;

        let actuallyGranted = 0;

        for (let i = 0; i < grantedQuantity; i++) {
            if (inventory.length >= MAX_INVENTORY_SLOTS) break;

            const item = createInventoryItem(template, {
                quantity: 1,
                upgrade_level: 0,
                modifications: {}
            });

            const slotsAdded = addItemToInventory(inventory, item, template);
            if (slotsAdded > 0 && inventory.length > MAX_INVENTORY_SLOTS) {
                // РЈРґР°Р»СЏРµРј РІСЃРµ РїСЂРµРІС‹С€Р°СЋС‰РёРµ Р»РёРјРёС‚ СЃР»РѕС‚С‹ СЃ РєРѕРЅС†Р° (С‚РѕР»СЊРєРѕ С‡С‚Рѕ РґРѕР±Р°РІР»РµРЅРЅС‹Рµ)
                while (inventory.length > MAX_INVENTORY_SLOTS) {
                    inventory.pop();
                }
                break;
            }
            actuallyGranted++;
        }

        const skipped = grantedQuantity - actuallyGranted;
        if (skipped > 0) {
            undropped.push({
                id: template.id,
                name: template.name,
                icon: template.icon || 'рџ“¦',
                wanted: grantedQuantity,
                skipped,
                reason: 'INVENTORY_FULL'
            });
            logger.warn('РќР°РіСЂР°РґР° Р·Р° Р±РѕСЃСЃР° С‡Р°СЃС‚РёС‡РЅРѕ РёР»Рё РїРѕР»РЅРѕСЃС‚СЊСЋ РЅРµ РІС‹РґР°РЅР°: РёРЅРІРµРЅС‚Р°СЂСЊ Р·Р°РїРѕР»РЅРµРЅ', {
                playerId,
                item: template.name,
                wanted: grantedQuantity,
                granted: actuallyGranted,
                slots: inventory.length,
                maxSlots: MAX_INVENTORY_SLOTS
            });
        }

        if (actuallyGranted === 0) continue;

        granted.push({
            id: template.id,
            name: template.name,
            icon: template.icon || 'рџ“¦',
            quantity: actuallyGranted
        });
        totalGrantedCount += actuallyGranted;
    }

    if (granted.length) {
        await client.query(
            `UPDATE players
             SET inventory = $1,
                 items_collected = COALESCE(items_collected, 0) + $2
             WHERE id = $3`,
            [JSON.stringify(inventory), totalGrantedCount, playerId]
        );

        // РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РёРЅРІРµРЅС‚Р°СЂСЏ РІ РЅРѕСЂРјР°Р»РёР·РѕРІР°РЅРЅСѓСЋ С‚Р°Р±Р»РёС†Сѓ
        try {
            const { syncInventoryToTable } = require('../../utils/game-helpers');
            if (typeof syncInventoryToTable === 'function') await syncInventoryToTable(client, playerId, inventory);
        } catch (_) { /* ignore */ }
    }

    return { granted, undropped };
}

async function handleSoloBossKill(client, playerId, bossId, activeBuffs, masteries) {
    const boss = await getBossById(client, bossId);
    if (!boss) throw { message: 'Р‘РѕСЃСЃ РЅРµ РЅР°Р№РґРµРЅ', code: 'BOSS_NOT_FOUND', statusCode: 404 };
    const experienceReward = activeBuffs.exp_x2
        ? (boss.reward_experience || 0) * 2
        : (boss.reward_experience || 0);
    const lootMultiplier = activeBuffs.loot_x2 ? 2 : 1;

    const rewards = { coins: boss.reward_coins || 0, experience: experienceReward };

    if (rewards.coins > 0)
        await client.query('UPDATE players SET coins = coins + $1 WHERE id = $2', [rewards.coins, playerId]);
    if (experienceReward > 0) {
        try {
            const progression = require('../../utils/progression');
            await progression.grantExperience(playerId, experienceReward, 'boss_kill', client);
        } catch (_) {
            await playerHelper.addExperience(playerId, experienceReward, client);
            helpers.checkAchievements(playerId, client).catch(() => {});
        }
    }

    const grantedKey = await grantNextBossKey(client, playerId, bossId);
    if (grantedKey) rewards.key = grantedKey;

    // РџСЂРѕРіСЂРµСЃСЃ РµР¶РµРґРЅРµРІРЅРѕРіРѕ Р·Р°РґР°РЅРёСЏ В«СѓР±РёР№СЃС‚РІРѕ Р±РѕСЃСЃР°В»
    try {
        const { progressDailyTask, progressContract } = getGameHelpers();
        if (typeof progressDailyTask === 'function') await progressDailyTask(client, playerId, 'boss_kill', 1);
        if (typeof progressContract === 'function') await progressContract(client, playerId, 'boss_kill', 1);
    } catch (_) { /* ignore */ }

    // РњРЅРѕР¶РёС‚РµР»СЊ 1, Р° РЅРµ 0.5: РєР°Р¶РґС‹Р№ РїСЂРµРґРјРµС‚ РёР· reward_items РІС‹РґР°РІР°Р»СЃСЏ СЃ С€Р°РЅСЃРѕРј
    // 50% (calculateGrantedQuantity), РёР·-Р·Р° С‡РµРіРѕ РѕР±РµС‰Р°РЅРЅР°СЏ РЅР°РіСЂР°РґР° Р·Р° Р±РѕСЃСЃР°
    // С‚РµСЂСЏР»Р°СЃСЊ РїРѕР»РѕРІРёРЅСѓ СЂР°Р·. Р‘Р°С„С„ loot_x2 СѓРґРІР°РёРІР°РµС‚ РєРѕР»РёС‡РµСЃС‚РІРѕ.
    const { granted: grantedItems, undropped: soloUndropped } = await grantRewardItems(client, playerId, boss.reward_items, lootMultiplier);
    if (grantedItems.length) rewards.items = grantedItems;
    if (soloUndropped.length) rewards.undropped_items = soloUndropped;

    await client.query(
        `INSERT INTO boss_mastery (player_id, boss_id, kills, last_killed_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (player_id, boss_id)
         DO UPDATE SET kills = boss_mastery.kills + 1, last_killed_at = NOW()`,
        [playerId, bossId]
    );

    await client.query('UPDATE players SET bosses_killed = COALESCE(bosses_killed, 0) + 1 WHERE id = $1', [playerId]);
    await client.query('DELETE FROM player_boss_progress WHERE player_id = $1 AND boss_id = $2', [playerId, bossId]);
    await clearPlayerActiveBattle(client, playerId);

    // Р”РѕСЃС‚РёР¶РµРЅРёСЏ В«РљРѕР»Р»РµРєС†РёРѕРЅРµСЂВ»/В«РҐСЂР°РЅРёС‚РµР»СЊВ» СЃС‡РёС‚Р°СЋС‚ СѓРЅРёРєР°Р»СЊРЅС‹Рµ РїСЂРµРґРјРµС‚С‹:
    // СЂРµРіРёСЃС‚СЂРёСЂСѓРµРј РІС‹РґР°РЅРЅС‹Рµ РЅР°РіСЂР°РґС‹, РёРЅР°С‡Рµ РїСЂРѕРіСЂРµСЃСЃ РЅРµ СѓС‡РёС‚С‹РІР°Р» Р»СѓС‚ СЃ Р±РѕСЃСЃРѕРІ.
    const grantedIds = grantedItems.map((entry) => entry.id).filter(Boolean);
    if (grantedIds.length > 0) {
        await trackCollectedItems(client, playerId, grantedIds);
    }

    const kills = (masteries.find(m => m.boss_id === bossId)?.kills || 0) + 1;
    return { rewards, mastery: kills };
}

/**
 * Р—Р°РїРёСЃР°С‚СЊ СЃРѕР±С‹С‚РёРµ РІ Р»РѕРі Р±РѕСЏ СЂРµР№РґР°.
 *
 * Р’С‹Р·С‹РІР°РµС‚СЃСЏ Р’РќРЈРўР Р С‚СЂР°РЅР·Р°РєС†РёРё Р°С‚Р°РєРё: СЃС‚СЂРѕРєСѓ raid_progress РѕРЅР° СѓР¶Рµ
 * Р·Р°РїРµСЂР»Р° SELECT ... FOR UPDATE, РїРѕСЌС‚РѕРјСѓ read-modify-write Р±РµР· РїРѕРІС‚РѕСЂРЅРѕР№
 * Р±Р»РѕРєРёСЂРѕРІРєРё Р±РµР·РѕРїР°СЃРµРЅ вЂ” РїР°СЂР°Р»Р»РµР»СЊРЅС‹Рµ Р°С‚Р°РєРё РІС‹СЃС‚СЂРѕСЏС‚СЃСЏ РІ РѕС‡РµСЂРµРґСЊ.
 *
 * Р›РѕРі Р·Р°РІРµРґС‘РЅ СЂР°РґРё РёРЅС„РѕСЂРјР°С†РёРё: СѓС‡Р°СЃС‚РЅРёРє РґРѕР»Р¶РµРЅ РІРёРґРµС‚СЊ, РєС‚Рѕ Рё СЃРєРѕР»СЊРєРѕ
 * СЃРЅСЏР», Р° РЅРµ С‚РѕР»СЊРєРѕ СЃРѕР±СЃС‚РІРµРЅРЅС‹Рµ СѓРґР°СЂС‹. РЎС‚Р°СЂС‹Рµ СЃРѕР±С‹С‚РёСЏ РѕР±СЂРµР·Р°СЋС‚СЃСЏ, С‡С‚РѕР±С‹
 * JSONB РЅРµ СЂРѕСЃ Р±РµСЃРєРѕРЅРµС‡РЅРѕ.
 *
 * @param {object} client РєР»РёРµРЅС‚ Р‘Р” (С‚СЂР°РЅР·Р°РєС†РёСЏ)
 * @param {number} raidId
 * @param {object} event РїСЂРѕРёР·РІРѕР»СЊРЅС‹Р№ JSON-РѕР±СЉРµРєС‚ СЃРѕР±С‹С‚РёСЏ
 */
async function appendRaidLog(client, raidId, event) {
    // Р‘РµР· РєРѕР»РѕРЅРєРё (СЃС‚Р°СЂР°СЏ Р‘Р”, РіРґРµ ALTER РЅРµ РїСЂРёРјРµРЅСЏР»СЃСЏ) СЂРµР№Рґ РїСЂРѕРґРѕР»Р¶Р°РµС‚
    // СЂР°Р±РѕС‚Р°С‚СЊ вЂ” Р»РѕРі РїСЂРѕСЃС‚Рѕ РЅРµ РїРёС€РµС‚СЃСЏ.
    let rows = [];
    try {
        const result = await client.query(
            'SELECT raid_log FROM raid_progress WHERE id = $1',
            [raidId]
        );
        rows = result.rows || [];
    } catch (error) {
        if (error && error.code === '42703') return; // РєРѕР»РѕРЅРєРё raid_log РЅРµС‚
        throw error;
    }

    const raw = rows[0]?.raid_log;
    const current = Array.isArray(raw)
        ? raw
        : safeJsonParse(raw, []);
    const next = [...current.slice(-(RAID_LOG_MAX_EVENTS - 1)), event];

    try {
        await client.query(
            'UPDATE raid_progress SET raid_log = $1::jsonb WHERE id = $2',
            [JSON.stringify(next), raidId]
        );
    } catch (error) {
        if (error && error.code === '42703') return; // РєРѕР»РѕРЅРєРё raid_log РЅРµС‚
        throw error;
    }
}

/**
 * РђРєС‚РёРІРЅС‹Рµ СЂРµР№РґС‹ СЃ РїРѕР»РЅРѕР№ РєР°СЂС‚РёРЅРѕР№ Р±РѕСЏ.
 *
 * Р Р°РЅСЊС€Рµ СЃРїРёСЃРѕРє РѕС‚РґР°РІР°Р» С‚РѕР»СЊРєРѕ В«СЃРєРѕР»СЊРєРѕ СѓС‡Р°СЃС‚РЅРёРєРѕРІВ»: РёРіСЂРѕРє РЅРµ РІРёРґРµР» РЅРё
 * СЃРІРѕР№ РІРєР»Р°Рґ, РЅРё СѓСЂРѕРЅ РґСЂСѓРіРёС…, РЅРё РїСЂРёРјРµСЂРЅС‹Рµ РЅР°РіСЂР°РґС‹. Р’СЃРµ РґРѕРї. РїРѕР»СЏ
 * СЃС‡РёС‚Р°СЋС‚СЃСЏ РёР· С‚РµС… Р¶Рµ boss_sessions (РёСЃС‚РѕС‡РЅРёРє СѓСЂРѕРЅР°) РѕРґРЅРёРј Р·Р°РїСЂРѕСЃРѕРј,
 * Р±РµР· N+1.
 */
async function getActiveRaids(client, playerId) {
    const raidsResult = await client.query(
        `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                rp.leader_id, rp.leader_name,
                b.name AS boss_name, b.icon, b.description AS boss_description,
                b.reward_coins, b.reward_experience,
                COALESCE(rp.raid_log, '[]'::jsonb) AS raid_log,
                (SELECT COUNT(*) FROM boss_sessions WHERE raid_id = rp.id) AS participants_count
         FROM raid_progress rp
         JOIN bosses b ON b.id = rp.boss_id
         WHERE rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()
         ORDER BY rp.started_at DESC`,
        []
    );

    const participatingResult = await client.query(
        `SELECT bs.raid_id, bs.boss_id
          FROM boss_sessions bs
          JOIN raid_progress rp ON rp.id = bs.raid_id
          WHERE bs.player_id = $1
            AND bs.raid_id IS NOT NULL
            AND rp.is_active = true
            AND rp.is_raid = true
            AND rp.expires_at > NOW()`,
        [playerId]
    );

    const participatingIds = [...new Set(participatingResult.rows.map((row) => Number(row.raid_id)).filter(Boolean))];
    const participatingBossIds = [...new Set(participatingResult.rows.map((row) => Number(row.boss_id)).filter(Boolean))];

    // РЈСЂРѕРЅ РІСЃРµС… СѓС‡Р°СЃС‚РЅРёРєРѕРІ Р°РєС‚РёРІРЅС‹С… СЂРµР№РґРѕРІ РѕРґРЅРёРј Р·Р°РїСЂРѕСЃРѕРј: РїРѕ РЅРµРјСѓ СЃС‚СЂРѕРёРј
    // РІРєР»Р°Рґ РєР°Р¶РґРѕРіРѕ, С‚РѕРї-5 Рё РїСЂРёРјРµСЂРЅС‹Рµ РЅР°РіСЂР°РґС‹. РРјРµРЅР° Р±РµСЂС‘Рј С‚РµРј Р¶Рµ
    // Р·Р°РїСЂРѕСЃРѕРј (LEFT JOIN), РёРЅР°С‡Рµ РЅР° РєР°Р¶РґРѕРіРѕ СѓС‡Р°СЃС‚РЅРёРєР° СѓС…РѕРґРёР» Р±С‹ СЃРІРѕР№ SELECT.
    const activeRaidIds = raidsResult.rows.map((row) => Number(row.id));
    const sessionsByRaid = new Map();
    if (activeRaidIds.length > 0) {
        const sessionsResult = await client.query(
            `SELECT bs.raid_id, bs.player_id, bs.damage_dealt, p.first_name AS player_name
               FROM boss_sessions bs
               LEFT JOIN players p ON p.id = bs.player_id
              WHERE bs.raid_id = ANY($1::int[])`,
            [activeRaidIds]
        );

        for (const row of sessionsResult.rows) {
            const raidId = Number(row.raid_id);
            if (!sessionsByRaid.has(raidId)) sessionsByRaid.set(raidId, []);
            sessionsByRaid.get(raidId).push({
                player_id: Number(row.player_id),
                player_name: row.player_name || 'РРіСЂРѕРє',
                damage_dealt: Math.max(0, Number(row.damage_dealt || 0))
            });
        }
    }

    return {
        raids: raidsResult.rows.map((raid) => {
            const raidId = Number(raid.id);
            const participants = [...(sessionsByRaid.get(raidId) || [])]
                .sort((a, b) => b.damage_dealt - a.damage_dealt);

            const coinsPool = Number(raid.reward_coins || 0);
            const expPool = Number(raid.reward_experience || 0);
            const totalDamage = participants.reduce((sum, p) => sum + p.damage_dealt, 0);
            // РЈС‡Р°СЃС‚РЅРёРє СЃ РЅСѓР»РµРІС‹Рј СѓСЂРѕРЅРѕРј РґРѕР»СЋ РЅРµ РїРѕР»СѓС‡Р°РµС‚: Р±РµР· РґРµР»РµРЅРёСЏ РЅР°
            // РЅРѕР»СЊ РµРіРѕ В«РІРєР»Р°РґВ» РґР°Р» Р±С‹ NaN РІ РїСЂРѕС†РµРЅС‚С‹.
            const myEntry = participants.find((p) => p.player_id === Number(playerId)) || null;
            const myDamage = myEntry ? myEntry.damage_dealt : 0;
            const myShare = (myDamage > 0 && totalDamage > 0) ? myDamage / totalDamage : 0;

            // Р‘РѕРЅСѓСЃС‹ РїРµСЂРІРѕРіРѕ/РїРѕСЃР»РµРґРЅРµРіРѕ СѓРґР°СЂР° (+5% РєР°Р¶РґС‹Р№) Рё РѕСЃС‚Р°С‚РѕРє
            // РѕРєСЂСѓРіР»РµРЅРёСЏ РІ РёРЅС‚РµСЂС„РµР№СЃРµ РЅРµ РїРѕРєР°Р·С‹РІР°РµРј: В«РїСЂРёРјРµСЂРЅРѕВ» вЂ” С‡РµСЃС‚РЅРµРµ
            // С‚РѕС‡РЅРѕР№ С†РёС„СЂС‹, РєРѕС‚РѕСЂР°СЏ РїРѕСЃР»Рµ kill СЃР»РµРіРєР° РёР·РјРµРЅРёС‚СЃСЏ.
            const topDamagers = participants
                .filter((p) => p.damage_dealt > 0)
                .slice(0, 5)
                .map((p) => ({
                    player_id: p.player_id,
                    player_name: p.player_name,
                    damage_dealt: p.damage_dealt,
                    damage_pct: totalDamage > 0 ? Math.round((p.damage_dealt / totalDamage) * 100) : 0
                }));

            const raidLog = Array.isArray(raid.raid_log) ? raid.raid_log : safeJsonParse(raid.raid_log, []);

            return {
                id: raid.id,
                boss: {
                    id: raid.boss_id,
                    name: raid.boss_name,
                    icon: raid.icon,
                    description: raid.boss_description
                },
                hp: raid.current_health,
                max_hp: raid.max_health,
                hp_percent: raid.max_health > 0 ? Math.round((raid.current_health / raid.max_health) * 100) : 0,
                // РЎРєРѕР»СЊРєРѕ СѓСЂРѕРЅР° РЅР°РЅРµСЃРµРЅРѕ Р’РЎР•Р“Рћ (РїРѕ С„Р°РєС‚Сѓ СѓРґР°СЂРѕРІ, Р° РЅРµ РїРѕ
                // С„РѕСЂРјСѓР»Рµ max-current): РїСЂРѕРіСЂРµСЃСЃ Р±РѕСЏ РґРѕР»Р¶РµРЅ СЃРѕРІРїР°РґР°С‚СЊ СЃ
                // С‚РµРј, С‡С‚Рѕ РІРёРґРЅРѕ РІ Р»РѕРіРµ.
                total_damage: totalDamage,
                damage_remaining: Math.max(0, Number(raid.current_health || 0)),
                leader: {
                    id: raid.leader_id,
                    name: raid.leader_name
                },
                participants_count: Number(raid.participants_count || 0),
                // РР· РѕР±С‰РµРіРѕ С‡РёСЃР»Р° СѓС‡Р°СЃС‚РЅРёРєРѕРІ СЂРµР°Р»СЊРЅРѕ Р±СЊСЋС‰РёС… вЂ” РѕСЃС‚Р°Р»СЊРЅС‹Рµ
                // В«РІРёСЃСЏС‚В» Р±РµР· СѓСЂРѕРЅР° Рё РґРѕР»СЋ РЅРµ РїРѕР»СѓС‡Р°СЋС‚.
                attackers_count: participants.filter((p) => p.damage_dealt > 0).length,
                // Р›РёС‡РЅС‹Р№ РІРєР»Р°Рґ. Р”Рѕ РїРµСЂРІРѕРіРѕ СѓРґР°СЂР° вЂ” РЅСѓР»Рё, РІСЃС‘ РµС‰С‘ Р»СѓС‡С€Рµ,
                // С‡РµРј РјРѕР»С‡Р°РЅРёРµ.
                your_damage: myDamage,
                your_damage_pct: myShare > 0 ? Math.round(myShare * 100) : 0,
                top_damagers: topDamagers,
                expected_coins: myShare > 0 ? Math.floor(coinsPool * myShare) : 0,
                expected_experience: myShare > 0 ? Math.floor(expPool * myShare) : 0,
                raid_log: Array.isArray(raidLog) ? raidLog : [],
                expires_at: raid.expires_at,
                time_remaining_ms: new Date(raid.expires_at).getTime() - Date.now()
            };
        }),
        participatingIds,
        participatingBossIds
    };
}

async function validateSoloAttack(client, playerId, bossId) {
    const activeBattle = await resolveActiveBattle(client, playerId);
    if (!activeBattle || activeBattle.type !== 'solo' || activeBattle.boss_id !== bossId) {
        return { error: { success: false, error: 'РЎРЅР°С‡Р°Р»Р° РЅР°С‡РЅРёС‚Рµ СЃРѕР»Рѕ-Р±РѕР№ СЃ СЌС‚РёРј Р±РѕСЃСЃРѕРј', code: 'BOSS_NOT_STARTED' }, status: 400 };
    }

    const player = await getPlayerBaseState(client, playerId);
    if (!player) {
        return { error: { success: false, error: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ', code: 'PLAYER_NOT_FOUND' }, status: 404 };
    }

    // Р РµРіРµРЅРµСЂР°С†РёСЏ СЌРЅРµСЂРіРёРё РѕС‚ СЂРµР°Р»СЊРЅРѕ РїСЂРѕС€РµРґС€РµРіРѕ РІСЂРµРјРµРЅРё вЂ” С‚РµРј Р¶Рµ РІС‹Р·РѕРІРѕРј,
    // С‡С‚Рѕ РІ world.js:299 Рё pvp.js:338/481.
    //
    // Р—Р”Р•РЎР¬ Р‘Р«Р› Р‘РђР“: Р±РµР· recalcEnergy СЌРЅРµСЂРіРёСЏ РІ Р±РѕСЃСЃРѕРІРѕРј РєРѕРЅС‚СѓСЂРµ С‚РѕР»СЊРєРѕ
    // С‚СЂР°С‚РёР»Р°СЃСЊ (GREATEST(0, energy - 1)) Рё РЅРёРєРѕРіРґР° РЅРµ РЅР°С‡РёСЃР»СЏР»Р°СЃСЊ. РРіСЂРѕРє,
    // РІРѕСЋС‰РёР№ РўРћР›Р¬РљРћ СЃ Р±РѕСЃСЃР°РјРё, РЅРµ РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚ СЌРЅРµСЂРіРёСЋ РЅРёРєРѕРіРґР° вЂ” РїРѕСЃР»Рµ
    // РёСЃС‡РµСЂРїР°РЅРёСЏ Р·Р°Р»РёРїР°РµС‚ РЅР° В«РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЌРЅРµСЂРіРёРёВ» РґРѕ РїРѕРёСЃРєР° РІ РјРёСЂРµ.
    // recalcEnergy РґРІРёРіР°РµС‚ last_energy_update СЂРѕРІРЅРѕ РЅР° РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРЅРѕРµ
    // РІСЂРµРјСЏ, С‚Р°Рє С‡С‚Рѕ РїСЂРѕРІРµСЂРєР° РЅРёР¶Рµ РІРёРґРёС‚ СѓР¶Рµ СЂРµР°Р»СЊРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ.
    await recalcEnergy(client, player);

    const activeBuffs = getActiveBuffs(player.buffs);

    if (!activeBuffs.free_energy && player.energy < 1) {
        return { error: { success: false, error: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЌРЅРµСЂРіРёРё', code: 'INSUFFICIENT_ENERGY' }, status: 400 };
    }
    if (player.health <= 0) {
        return { error: { success: false, error: 'Р’С‹ РјРµСЂС‚РІС‹', code: 'PLAYER_DEAD' }, status: 400 };
    }

    const masteries = await getBossMasteries(client, playerId);
    return { activeBattle, player, activeBuffs, masteries };
}

function buildAlreadyInFightResponse(activeBattle) {
    return {
        success: false,
        error: 'РЈ РІР°СЃ СѓР¶Рµ РµСЃС‚СЊ Р°РєС‚РёРІРЅС‹Р№ Р±РѕР№',
        code: 'ALREADY_IN_FIGHT',
        active_battle: activeBattle
    };
}

/**
 * РћС‚РІРµС‚ РЅР° РѕС€РёР±РєСѓ РџРћР”РљР›Р®Р§Р•РќРРЇ Рє Р±Р°Р·Рµ (502), Р° РЅРµ СЃР±РѕР№ Р·Р°РїСЂРѕСЃР° (500).
 *
 * Р Р°РЅСЊС€Рµ РєР°Р¶РґС‹Р№ РјР°СЂС€СЂСѓС‚ Р±СЂР°Р» СЃРѕРµРґРёРЅРµРЅРёРµ РёР· РїСѓР»Р° РѕС‚РґРµР»СЊРЅС‹Рј try Рё СЃР°Рј
 * РѕС‚РґР°РІР°Р» 502 В«РћС€РёР±РєР° РїРѕРґРєР»СЋС‡РµРЅРёСЏ Рє Р±Р°Р·Рµ РґР°РЅРЅС‹С…В». РџРѕСЃР»Рµ РїРµСЂРµРІРѕРґР° РЅР°
 * transaction() СЌС‚РёС… try РЅРµ РѕСЃС‚Р°Р»РѕСЃСЊ, Рё РЅРµРґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ Р±Р°Р·С‹ СЃС‚Р°Р»Р°
 * РІС‹РіР»СЏРґРµС‚СЊ РєР°Рє РѕР±С‹С‡РЅР°СЏ РІРЅСѓС‚СЂРµРЅРЅСЏСЏ РѕС€РёР±РєР°.
 *
 * @param {object} res РѕС‚РІРµС‚ express
 * @param {*} error РѕС€РёР±РєР°
 * @returns {boolean} true, РµСЃР»Рё РѕС‚РІРµС‚ РѕС‚РїСЂР°РІР»РµРЅ (РѕС€РёР±РєР° вЂ” РїСЂРѕ СЃРѕРµРґРёРЅРµРЅРёРµ)
 */
function handleConnectionError(res, error) {
    if (!isConnectionError(error)) return false;

    logger.error('[bosses] РћС€РёР±РєР° РїРѕРґРєР»СЋС‡РµРЅРёСЏ Рє Р‘Р”', error);
    res.status(502).json({ success: false, error: 'РћС€РёР±РєР° РїРѕРґРєР»СЋС‡РµРЅРёСЏ Рє Р±Р°Р·Рµ РґР°РЅРЅС‹С…' });
    return true;
}

router.post('/start', async (req, res) => {
    logger.info('[bosses/start] РќР°С‡Р°Р»Рѕ Р·Р°РїСЂРѕСЃР°', { playerId: req.player?.id, body: req.body });

    // Р’Р°Р»РёРґР°С†РёСЏ РІС‹РЅРµСЃРµРЅР° Р”Рћ РѕС‚РєСЂС‹С‚РёСЏ С‚СЂР°РЅР·Р°РєС†РёРё. Р Р°РЅСЊС€Рµ СЃРѕРµРґРёРЅРµРЅРёРµ Р±СЂР°Р»РѕСЃСЊ
    // РёР· РїСѓР»Р° РїРµСЂРІС‹Рј РґРµР»РѕРј, Рё РїСЂРё РѕС‚РєР°Р·Рµ РЅР° РїСЂРѕРІРµСЂРєР°С… РѕРЅРѕ РІСЃС‘ СЂР°РІРЅРѕ
    // РѕСЃРІРѕР±РѕР¶РґР°Р»РѕСЃСЊ РІ finally вЂ” РЅРѕ Р·Р°РЅРёРјР°Р»РѕСЃСЊ РЅР° РІСЂРµРјСЏ РїСЂРѕРІРµСЂРѕРє РІРїСѓСЃС‚СѓСЋ.
    if (!req.player?.id) return res.status(401).json({ success: false, error: 'РўСЂРµР±СѓРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ', code: 'UNAUTHORIZED' });
    if (!requireAuth(req, res)) return;
    const bossId = Number(req.body?.boss_id);
    const playerId = req.player?.id;
    logger.info('[bosses/start] Р’Р°Р»РёРґР°С†РёСЏ РґР°РЅРЅС‹С…', { bossId, playerId });

    if (!requireBossId(res, bossId)) return;

    try {
        // Р Р°РЅСЊС€Рµ Р·РґРµСЃСЊ Р±С‹Р» РІР»РѕР¶РµРЅРЅС‹Р№ try СЃ СЃРѕР±СЃС‚РІРµРЅРЅС‹Рј ROLLBACK. РР·-Р·Р° РЅРµРіРѕ
        // РѕС€РёР±РєР° spendBossKeys РґРѕС…РѕРґРёР»Р° РґРѕ РІРЅРµС€РЅРµРіРѕ catch Рё РїСЂРµРІСЂР°С‰Р°Р»Р°СЃСЊ РІ
        // 500 РІРјРµСЃС‚Рѕ 400 СЃ РєРѕРґРѕРј INSUFFICIENT_KEYS. РўРµРїРµСЂСЊ С‚РµР»Рѕ С‚СЂР°РЅР·Р°РєС†РёРё
        // РїСЂРѕСЃС‚Рѕ Р±СЂРѕСЃР°РµС‚ РёСЃС…РѕРґРЅСѓСЋ РѕС€РёР±РєСѓ, Р° СЂР°Р·Р±РѕСЂ РєРѕРґРѕРІ РѕРґРёРЅ вЂ” РІ catch.
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                if (activeBattle.type === 'solo' && activeBattle.boss_id === bossId) {
                    // РџСЂРµР¶РЅРёР№ РєРѕРґ РґРµР»Р°Р» Р·РґРµСЃСЊ COMMIT, Р° РЅРµ ROLLBACK: РІ РІРµС‚РєРµ
                    // РЅРёС‡РµРіРѕ РЅРµ Р·Р°РїРёСЃС‹РІР°Р»РѕСЃСЊ, РЅРѕ РІС‹С…РѕРґ СЃ COMMIT СЃРѕС…СЂР°РЅСЏРµРј,
                    // С‡С‚РѕР±С‹ РїРѕРІРµРґРµРЅРёРµ РЅРµ РёР·РјРµРЅРёР»РѕСЃСЊ РЅРµР·Р°РјРµС‚РЅРѕ.
                    return {
                        status: 200,
                        body: {
                            success: true,
                            data: {
                                mode: 'solo',
                                resumed: true,
                                boss: activeBattle.boss,
                                time_remaining_ms: activeBattle.time_remaining_ms
                            }
                        }
                    };
                }

                return {
                    status: 400,
                    body: buildAlreadyInFightResponse(activeBattle)
                };
            }

            const boss = await getBossById(client, bossId);
            if (!boss) {
                return {
                    status: 404,
                    body: { success: false, error: 'Р‘РѕСЃСЃ РЅРµ РЅР°Р№РґРµРЅ', code: 'BOSS_NOT_FOUND' }
                };
            }

            const player = await getPlayerBaseState(client, playerId);
            if (!player || player.health <= 0) {
                return {
                    status: 400,
                    body: { success: false, error: 'Р’С‹ РјРµСЂС‚РІС‹. РќРµР»СЊР·СЏ РЅР°С‡Р°С‚СЊ Р±РѕР№ СЃ Р±РѕСЃСЃРѕРј.', code: 'PLAYER_DEAD' }
                };
            }

            // РЈСЂРѕРЅ РёРіСЂРѕРєР° РїРѕ СЌС‚РѕРјСѓ Р±РѕСЃСЃСѓ вЂ” С‚Р° Р¶Рµ calculateDamage, С‡С‚Рѕ РІ
            // /attack-boss Рё РІ СЃРїРёСЃРєРµ Р±РѕСЃСЃРѕРІ. РЎС‡РёС‚Р°РµРј РЅР° СЃС‚Р°СЂС‚Рµ, С‡С‚РѕР±С‹ РєР»РёРµРЅС‚
            // РїРѕРєР°Р·Р°Р» В«Р’Р°С€ СѓСЂРѕРЅВ» РІ Р±РѕСЋ Р”Рћ РїРµСЂРІРѕРіРѕ СѓРґР°СЂР°: СЂР°РЅСЊС€Рµ С‡РёСЃР»Рѕ
            // РїРѕСЏРІР»СЏР»РѕСЃСЊ С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ РЅРµРіРѕ.
            //
            // client РїРµСЂРµРґР°С‘Рј РІ getSetBonuses: Р±РµР· РЅРµРіРѕ С„СѓРЅРєС†РёСЏ Р±РµСЂС‘С‚ РІС‚РѕСЂРѕРµ
            // СЃРѕРµРґРёРЅРµРЅРёРµ РёР· РїСѓР»Р°, Рё РЅР° РІСЂРµРјСЏ СЂР°СЃС‡С‘С‚Р° С…РѕРґРёРј СЃ РґРІСѓРјСЏ
            // СЃРѕРµРґРёРЅРµРЅРёСЏРјРё РїСЂРё FOR UPDATE РЅР° СЃС‚СЂРѕРєРµ players.
            const masteries = await getBossMasteries(client, playerId);
            const setBonuses = await getSetBonuses(parseEquipment(player.equipment), client);
            const currentDamage = combat.calculateDamage(bossId, player, masteries, setBonuses);

            // РЎРїРёСЃР°РЅРЅРѕРµ С‡РёСЃР»Рѕ Р·Р°РїРѕРјРёРЅР°РµРј Р’РќРЈРўР Р С‚СЂР°РЅР·Р°РєС†РёРё: РїРѕРІС‚РѕСЂРЅС‹Р№
            // Р·Р°РїСЂРѕСЃ Рє Р‘Р” РїРѕСЃР»Рµ COMMIT РјРѕРі РІРµСЂРЅСѓС‚СЊ РґСЂСѓРіРѕРµ Р·РЅР°С‡РµРЅРёРµ, Р° РµРіРѕ
            // СЃР±РѕР№ РїСЂРёРІРѕРґРёР» Р±С‹ Рє РѕС€РёР±РєРµ СѓР¶Рµ РЅР°С‡Р°С‚РѕРіРѕ Р±РѕСЏ СЃРѕ СЃРїРёСЃР°РЅРЅС‹РјРё
            // РєР»СЋС‡Р°РјРё. transaction() РІРѕР·РІСЂР°С‰Р°РµС‚ СЌС‚Рѕ С‡РёСЃР»Рѕ РЅР°СЂСѓР¶Сѓ РІРјРµСЃС‚Рµ СЃ
            // РѕСЃС‚Р°Р»СЊРЅС‹Рј СЂРµР·СѓР»СЊС‚Р°С‚РѕРј вЂ” РїРµСЂРµС‡РёС‚С‹РІР°С‚СЊ Р±Р°Р·Сѓ РЅРµ РЅСѓР¶РЅРѕ.
            const keysSpent = bossId > 1
                ? await spendBossKeys(client, playerId, bossId - 1)
                : 0;

            await client.query(
                `INSERT INTO player_boss_progress (player_id, boss_id, current_hp, max_hp, started_at, last_attack)
                 VALUES ($1, $2, $3, $4, NOW(), NOW())
                 ON CONFLICT (player_id, boss_id)
                 DO UPDATE SET current_hp = $3, max_hp = $4, started_at = NOW(), last_attack = NOW()`,
                [playerId, bossId, boss.max_health, boss.max_health]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'solo',
                     active_raid_id = NULL
                 WHERE id = $2`,
                [bossId, playerId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        mode: 'solo',
                        keys_spent: keysSpent,
                        boss: {
                            id: boss.id,
                            name: boss.name,
                            icon: boss.icon,
                            hp: boss.max_health,
                            max_hp: boss.max_health,
                            // РўРµРєСѓС‰РёР№ СѓСЂРѕРЅ РёРіСЂРѕРєР° РїРѕ СЌС‚РѕРјСѓ Р±РѕСЃСЃСѓ вЂ” С‚Р° Р¶Рµ
                            // calculateDamage, С‡С‚Рѕ РІ СЃРїРёСЃРєРµ Р±РѕСЃСЃРѕРІ Рё РІ
                            // /attack-boss. РќСѓР¶РµРЅ, С‡С‚РѕР±С‹ РєР»РёРµРЅС‚ РїРѕРєР°Р·Р°Р»
                            // В«Р’Р°С€ СѓСЂРѕРЅВ» Р”Рћ РїРµСЂРІРѕРіРѕ СѓРґР°СЂР°.
                            current_damage: currentDamage,
                            // РћС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ РІ Р•Р”РРќРР¦РђРҐ СѓСЂРѕРЅР° РїСЂРё РїРѕР»РЅРѕРј HP
                            // Р±РѕСЃСЃР° вЂ” С…СѓРґС€РёР№ СЃР»СѓС‡Р°Р№, СЃ РєРѕС‚РѕСЂС‹Рј РёРіСЂРѕРє
                            // СЃС‚РѕР»РєРЅС‘С‚СЃСЏ РЅР° РїРµСЂРІРѕРј СѓРґР°СЂРµ. Р Р°РЅСЊС€Рµ С‚СѓС‚ Р±С‹Р»Р°
                            // РґРѕР»СЏ (boss.damage_percent), Р° СЃР°Рј СЂР°СЃС‡С‘С‚ Р±С‹Р»
                            // РїСЂРѕС†РµРЅС‚РѕРј РѕС‚ max_health РёРіСЂРѕРєР°: РєР°С‡Р°С‚СЊ HP Р±С‹Р»Рѕ
                            // Р±РµСЃСЃРјС‹СЃР»РµРЅРЅРѕ, СѓСЂРѕРЅ СЂРѕСЃ РІРјРµСЃС‚Рµ СЃ Р·Р°РїР°СЃРѕРј.
                            counter_damage: combat.calculateBossCounterDamage(
                                boss,
                                parseEquipment(player.equipment),
                                { playerLevel: player.level }
                            )
                        },
                        time_remaining_ms: SOLO_FIGHT_DURATION_MS,
                        // Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ С†РµР»РёРєРѕРј: РєР»РёРµРЅС‚ РїРѕРєР°Р·С‹РІР°РµС‚ РµС‘ РІ Р»РѕРіРµ
                        // Р±РѕСЏ. Р Р°РЅСЊС€Рµ РїРѕР»Рµ Р±С‹Р»Рѕ С‚РѕР»СЊРєРѕ РІ GET /bosses, Рё РїРѕСЃР»Рµ
                        // РїСЂСЏРјРѕРіРѕ СЃС‚Р°СЂС‚Р° Р»РѕРі РѕСЃС‚Р°РІР°Р»СЃСЏ Р±РµР· СЃСЂРѕРєР°.
                        fight_duration_ms: SOLO_FIGHT_DURATION_MS
                    }
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        // spendBossKeys СЃРѕРѕР±С‰Р°РµС‚ Рѕ РЅРµС…РІР°С‚РєРµ РєР»СЋС‡РµР№ СЃР°РјРѕР№ С„РёРєС†РёРµР№ РєРѕРґР°:
        // СЂР°РЅСЊС€Рµ РµС‘ РїРµСЂРµС…РІР°С‚С‹РІР°Р» РІР»РѕР¶РµРЅРЅС‹Р№ catch Рё РѕС‚РґР°РІР°Р» 400 СЃ РїРѕР»СЏРјРё
        // keys_owned/keys_required. Р‘РµР· С‚РѕР№ РїСЂРѕРІРµСЂРєРё РёРіСЂРѕРє РїРѕР»СѓС‡РёР» Р±С‹ 500
        // РІРјРµСЃС‚Рѕ РїРѕРЅСЏС‚РЅРѕРіРѕ В«РЅРµ С…РІР°С‚Р°РµС‚ РєР»СЋС‡РµР№В».
        if (error.code === 'INSUFFICIENT_KEYS') {
            return res.status(400).json(error);
        }
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'solo_start');
    }
});

router.get('/', async (req, res) => {
    logger.info('[bosses/get] РќР°С‡Р°Р»Рѕ Р·Р°РїСЂРѕСЃР°', { playerId: req.player?.id });
    try {
        // transaction(), Р° РќР• withClient(): resolveActiveBattle С‡РёСЃС‚РёС‚
        // РїСЂРѕСЃСЂРѕС‡РµРЅРЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ (DELETE player_boss_progress -> DELETE
        // boss_sessions -> UPDATE players ... active_boss_* = NULL), Рё РІ
        // withClient СЌС‚Рё С‚СЂРё С€Р°РіР° Р±С‹Р»Рё РўР Р•РњРЇ Р°РІС‚Рѕ-РєРѕРјРјРёС‚Р°РјРё РЅР° read-Р·Р°РїСЂРѕСЃРµ.
        // Р—Р”Р•РЎР¬ Р‘Р«Р› Р‘РђР“: РїР°РґРµРЅРёРµ РЅР° Р»СЋР±РѕРј С€Р°РіРµ РїРѕСЃР»Рµ РїРµСЂРІРѕРіРѕ РѕСЃС‚Р°РІР»СЏР»Рѕ
        // players.active_boss_id СѓРєР°Р·С‹РІР°СЋС‰РёРј РЅР° СѓРґР°Р»С‘РЅРЅС‹Рµ СЃС‚СЂРѕРєРё вЂ” РёРіСЂРѕРє
        // РїРѕР»СѓС‡Р°Р» В«Р±РѕР№ РµСЃС‚СЊВ», РєРѕС‚РѕСЂС‹Р№ РЅРµ resolve-РёС‚СЃСЏ, РґРѕ СЃР»РµРґСѓСЋС‰РµРіРѕ
        // СѓСЃРїРµС€РЅРѕРіРѕ РїСЂРѕС…РѕРґР°.
        const outcome = await transaction(async (client) => {
            if (!req.player?.id) return { status: 401, body: { success: false, error: 'РўСЂРµР±СѓРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ', code: 'UNAUTHORIZED' } };
            const playerId = req.player?.id;
            logger.info('[bosses/get] РџРѕР»СѓС‡РµРЅРёРµ РґР°РЅРЅС‹С… РёРіСЂРѕРєР°', { playerId });
            const player = await getPlayerBaseState(client, playerId);

            // РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ РІ Р±Р°Р·Рµ вЂ” РѕС‚РґР°С‘Рј 404 РІРјРµСЃС‚Рѕ РїР°РґРµРЅРёСЏ РЅР° player.equipment
            // (TypeError: Cannot read properties of null -> 500).
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

            const activeBattle = await resolveActiveBattle(client, playerId);
            const masteries = await getBossMasteries(client, playerId);
            const masteryMap = {};
            for (const m of masteries) masteryMap[m.boss_id] = m.kills;

            const bossesResult = await client.query('SELECT id, name, description, level, max_health, damage, reward_experience, reward_coins, reward_items, keys_required, is_group_boss, min_clan_level, icon FROM bosses ORDER BY id');
            const setBonuses = await getSetBonuses(parseEquipment(player.equipment), client);

            // РљР»СЋС‡ РІС‹РґР°С‘С‚ РџР Р•Р”Р«Р”РЈР©РР™ Р±РѕСЃСЃ, РїРѕСЌС‚РѕРјСѓ С‚СЂРµР±РѕРІР°РЅРёРµ Рє Р±РѕСЃСЃСѓ N вЂ” СЌС‚Рѕ
            // keys_required Р±РѕСЃСЃР° N-1, Р° РЅРµ СЃР°РјРѕРіРѕ N: РёРЅР°С‡Рµ С†РёС„СЂС‹ РІ UI РЅРµ
            // СЃРѕРІРїР°РґСѓС‚ СЃ СЃРµСЂРІРµСЂРЅРѕР№ РїСЂРѕРІРµСЂРєРѕР№ РєР»СЋС‡РµР№ РїСЂРё СЃС‚Р°СЂС‚Рµ Р±РѕСЏ.
            const keysRequiredByBoss = new Map(
                bossesResult.rows.map((boss) => [Number(boss.id), Math.max(1, Number(boss.keys_required) || 1)])
            );

            // РџРѕР»СѓС‡Р°РµРј РІСЃРµ РєР»СЋС‡Рё Р±РѕСЃСЃРѕРІ РѕРґРЅРёРј Р·Р°РїСЂРѕСЃРѕРј РґР»СЏ СѓСЃС‚СЂР°РЅРµРЅРёСЏ N+1
            const keysResult = await client.query(
                'SELECT boss_id, quantity FROM boss_keys WHERE player_id = $1',
                [playerId]
            );
            const keysMap = {};
            for (const r of keysResult.rows) keysMap[String(r.boss_id)] = r.quantity;

            const bossList = [];
            for (const boss of bossesResult.rows) {
                const keysRequired = boss.id === 1 ? 0 : (keysRequiredByBoss.get(Number(boss.id) - 1) || 1);
                const ownedKeys = boss.id === 1 ? 0 : (keysMap[String(boss.id - 1)] || 0);
                const isUnlocked = boss.id === 1 || ownedKeys >= keysRequired;
                const soloProgress = activeBattle?.type === 'solo' && activeBattle.boss_id === boss.id
                    ? activeBattle.boss.hp
                    : boss.max_health;

                bossList.push({
                    id: boss.id,
                    name: boss.name,
                    description: boss.description,
                    icon: boss.icon,
                    hp: soloProgress,
                    max_hp: boss.max_health,
                    reward_coins: boss.reward_coins,
                    reward_experience: boss.reward_experience,
                    // РћС‚РІРµС‚РЅС‹Р№ СѓСЂРѕРЅ Р±РѕСЃСЃР° РІ Р•Р”РРќРР¦РђРҐ РїСЂРё РµРіРѕ С‚РµРєСѓС‰РµРј HP вЂ”
                    // UI РїРѕРєР°Р·С‹РІР°РµС‚ РµРіРѕ РІ РєР°СЂС‚РѕС‡РєРµ Р±РѕСЏ. РЎС‡РёС‚Р°РµРј С‚РµРј Р¶Рµ
                    // calculateBossCounterDamage, С‡С‚Рѕ Рё СЃР°Рј РѕС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ,
                    // РїРѕСЌС‚РѕРјСѓ С†РёС„СЂР° РІ РєР°СЂС‚РѕС‡РєРµ СЃРѕРІРїР°РґР°РµС‚ СЃ С‚РѕР№, С‡С‚Рѕ РїРѕР»СѓС‡РёС‚
                    // РёРіСЂРѕРє. Р’РЅРµ Р°РєС‚РёРІРЅРѕРіРѕ Р±РѕСЏ HP = РїРѕР»РЅРѕРµ (С…СѓРґС€РёР№ СЃР»СѓС‡Р°Р№).
                    counter_damage: combat.calculateBossCounterDamage(
                        boss,
                        parseEquipment(player.equipment),
                        { currentHealth: soloProgress, playerLevel: player.level }
                    ),
                    required_keys: keysRequired,
                    owned_keys: ownedKeys,
                    is_unlocked: isUnlocked,
                    mastery: masteryMap[boss.id] || 0,
                    current_damage: combat.calculateDamage(boss.id, player, masteries, setBonuses),
                    can_start_solo: isUnlocked && !activeBattle,
                    can_start_mass: isUnlocked && !activeBattle
                });
            }

            const raids = await getActiveRaids(client, playerId);
            // РћС‚Р»РѕР¶РµРЅРЅС‹Рµ РЅР°РіСЂР°РґС‹ Р·Р° СЂРµР№РґС‹: РЅР°С‡РёСЃР»СЏСЋС‚СЃСЏ РІСЃРµРј СѓС‡Р°СЃС‚РЅРёРєР°Рј, РЅРѕ
            // СѓРІРёРґРµС‚СЊ РёС… РґРѕР»Р¶РµРЅ РєР°Р¶РґС‹Р№. Р‘РµР· СЌС‚РѕРіРѕ РїРѕР»СЏ СѓС‡Р°СЃС‚РЅРёРє, Р±РёРІС€РёР№ РЅРµ
            // РїРѕСЃР»РµРґРЅРёРј СѓРґР°СЂРѕРј, РЅРµ СѓР·РЅР°РІР°Р» Рѕ СЃРІРѕРµР№ РґРѕР»Рµ.
            const pendingRaidRewards = await getPendingRaidRewards(client, playerId);

            return {
                success: true,
                data: {
                    bosses: bossList,
                    raids: raids.raids,
                    participating_raid_ids: raids.participatingIds,
                    participating_boss_ids: raids.participatingBossIds,
                    pending_raid_rewards: pendingRaidRewards,
                    player_energy: player.energy,
                    player_max_energy: player.max_energy,
                    player_level: player.level,
                    active_battle: activeBattle,
                    fight_duration_ms: SOLO_FIGHT_DURATION_MS,
                    raid_duration_ms: MASS_FIGHT_DURATION_MS,
                    info: {
                        // Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ Р±РѕСЏ РїРѕРґСЃС‚Р°РІР»СЏРµРј РёР· РєРѕРЅСЃС‚Р°РЅС‚С‹: СЂР°РЅСЊС€Рµ
                        // В«8 С‡Р°СЃРѕРІВ» Р±С‹Р»Рѕ РІРїРёСЃР°РЅРѕ С‚РµРєСЃС‚РѕРј, Рё РїСЂРё СЃРјРµРЅРµ Р±Р°Р»Р°РЅСЃР°
                        // РїРѕРґСЃРєР°Р·РєР° РІСЂР°Р»Р°.
                        solo: `РЎРѕР»Рѕ-Р±РѕР№: СЃС‚Р°СЂС‚ С‡РµСЂРµР· РєРЅРѕРїРєСѓ, 1 СѓРґР°СЂ = 1 СЌРЅРµСЂРіРёСЏ, Р±РѕР№ РґР»РёС‚СЃСЏ ${formatDuration(SOLO_FIGHT_DURATION_MS)}.`,
                        mastery: 'РљР°Р¶РґР°СЏ РїРѕР±РµРґР° РЅР°Рґ Р±РѕСЃСЃРѕРј СѓРІРµР»РёС‡РёРІР°РµС‚ СѓСЂРѕРЅ РїРѕ РЅРµРјСѓ Рё С‡Р°СЃС‚РёС‡РЅРѕ СѓСЃРёР»РёРІР°РµС‚ СѓСЂРѕРЅ РїРѕ СЃР»РµРґСѓСЋС‰РёРј Р±РѕСЃСЃР°Рј.',
                        raids: `РњР°СЃСЃРѕРІС‹Р№ Р±РѕР№ вЂ” РѕС‚РґРµР»СЊРЅС‹Р№ СЂРµР¶РёРј РЅР° ${formatDuration(MASS_FIGHT_DURATION_MS)}. РќР°РіСЂР°РґС‹ Рё РїСЂРµРґРјРµС‚С‹ РґРµР»СЏС‚СЃСЏ РїСЂРѕРїРѕСЂС†РёРѕРЅР°Р»СЊРЅРѕ СѓСЂРѕРЅСѓ, РєР»СЋС‡ РїРѕР»СѓС‡Р°РµС‚ С‚РѕР»СЊРєРѕ Р»РёРґРµСЂ.`
                    }
                }
            };
        });
        if (outcome && outcome.status) {
            return res.status(outcome.status).json(outcome.body);
        }
        res.json(outcome);
    } catch (error) {
        if (handleConnectionError(res, error)) return;
        return handleError(res, error, 'boss_list');
    }
});

async function getPendingRaidRewards(client, playerId) {
    // FOR UPDATE:claim С‡РёС‚Р°РµС‚ claimed=false Рё РїРѕРјРµС‡Р°РµС‚ РёС… РІ С‚РѕР№ Р¶Рµ
    // С‚СЂР°РЅР·Р°РєС†РёРё. Р‘РµР· Р±Р»РѕРєРёСЂРѕРІРєРё РґРІР° РїР°СЂР°Р»Р»РµР»СЊРЅС‹С… Р·Р°РїСЂРѕСЃР° С‡РёС‚Р°СЋС‚ РѕРґРёРЅ
    // РЅР°Р±РѕСЂ pending Рё РЅР°С‡РёСЃР»СЏСЋС‚ РЅР°РіСЂР°РґСѓ РґРІР°Р¶РґС‹ (РґРІРѕР№РЅРѕР№ С‚Р°Рї/СЂРµС‚СЂР°Р№).
    const result = await client.query(
        `SELECT id, raid_id, boss_id, coins, experience, items, key_item_name, created_at
           FROM raid_rewards
          WHERE player_id = $1 AND claimed = false
          ORDER BY created_at ASC
          FOR UPDATE`,
        [playerId]
    );
    return result.rows.map((row) => ({
        id: row.id,
        raid_id: row.raid_id,
        boss_id: row.boss_id,
        coins: Number(row.coins || 0),
        experience: Number(row.experience || 0),
        items: Array.isArray(row.items) ? row.items : safeJsonParse(row.items, []),
        key_item_name: row.key_item_name || null
    }));
}

/**
 * РџРѕРјРµС‚РёС‚СЊ РЅР°РіСЂР°РґС‹ Р·Р° СЂРµР№РґС‹ РїРѕР»СѓС‡РµРЅРЅС‹РјРё Рё РІРµСЂРЅСѓС‚СЊ РёС… СЃРѕРґРµСЂР¶РёРјРѕРµ.
 *
 * РћС‚РґРµР»СЊРЅС‹Р№ РІС‹Р·РѕРІ, Р° РЅРµ В«РїСЂРѕС‡РёС‚Р°Р» Рё СЃР°Рј РїРѕРіР°СЃВ»: /bosses РґС‘СЂРіР°РµС‚СЃСЏ РЅР° РєР°Р¶РґРѕРµ
 * РѕС‚РєСЂС‹С‚РёРµ СЌРєСЂР°РЅР°, Рё РµСЃР»Рё РєР»РёРµРЅС‚ СѓРїР°РґС‘С‚ РјРµР¶РґСѓ РїРѕРєР°Р·РѕРј Рё РїРѕРіР°С€РµРЅРёРµРј, РёРіСЂРѕРє
 * РІС‚РѕСЂРѕР№ СЂР°Р· СѓРІРёРґРёС‚ РїРѕРїР°Рї вЂ” СЌС‚Рѕ Р»СѓС‡С€Рµ, С‡РµРј РЅРµ СѓРІРёРґРµС‚СЊ РІРѕРІСЃРµ.
 */
router.post('/raid/rewards/claim', async (req, res) => {
    try {
        if (!req.player?.id) return unauthorized(res);
        const playerId = req.player?.id;
        if (!requireAuth(req, res)) return;

        const result = await transaction(async (client) => {
            const pending = await getPendingRaidRewards(client, playerId);
            if (pending.length === 0) return { claimed: [], rewards: [] };

            const ids = pending.map((r) => r.id);
            await client.query(
                'UPDATE raid_rewards SET claimed = true WHERE id = ANY($1::int[])',
                [ids]
            );

            return {
                claimed: ids,
                rewards: pending.map((r) => ({
                    raid_id: r.raid_id,
                    boss_id: r.boss_id,
                    coins: r.coins,
                    experience: r.experience,
                    items: r.items,
                    key_item_name: r.key_item_name
                }))
            };
        });

        await logPlayerAction(playerId, 'raid_rewards_claimed', {
            count: result.claimed.length
        });

        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'raid_rewards_claim');
    }
});

router.post('/attack-boss', async (req, res) => {
    // Р’Р°Р»РёРґР°С†РёСЏ РґРѕ РѕС‚РєСЂС‹С‚РёСЏ С‚СЂР°РЅР·Р°РєС†РёРё вЂ” РєР°Рє РІ РѕСЃС‚Р°Р»СЊРЅС‹С… РјР°СЂС€СЂСѓС‚Р°С… Р±РѕСЃСЃРѕРІ.
    const bossId = Number(req.body?.boss_id);
    // P2: guard РЅР° req.player. РћР±С‹С‡РЅРѕ РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅ validatePlayer, РЅРѕ
    // РїСЂРё РїСЂСЏРјРѕРј РІС‹Р·РѕРІРµ СЂРѕСѓС‚РµСЂР° req.player РјРѕР¶РµС‚ РѕС‚СЃСѓС‚СЃС‚РІРѕРІР°С‚СЊ, Рё СЂРѕСѓС‚РµСЂ
    // РѕС‚РІРµС‡Р°Р» 500 РІРјРµСЃС‚Рѕ 401.
    if (!req.player?.id) return res.status(401).json({ success: false, error: 'РўСЂРµР±СѓРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ', code: 'UNAUTHORIZED' });
    if (!requireAuth(req, res)) return;
    if (!req.player?.id) return unauthorized(res);
    const playerId = req.player?.id;

    if (!requireBossId(res, bossId)) return;

    try {
        const outcome = await transaction(async (client) => {
            const validation = await validateSoloAttack(client, playerId, bossId);
            if (validation.error) {
                // РЎС‚Р°С‚СѓСЃ Рё С‚РµР»Рѕ РїСЂРёС…РѕРґСЏС‚ РёР· validateSoloAttack: С‚Р°Рј СЂР°Р·РЅС‹Рµ
                // РѕС‚РєР°Р·С‹ (РЅРµС‚ Р±РѕСЏ, РјС‘СЂС‚РІ, РјР°Р»Рѕ СЌРЅРµСЂРіРёРё), Рё РёС… РєРѕРґС‹ РЅРµР»СЊР·СЏ
                // СЃРІР°Р»РёРІР°С‚СЊ РІ РѕРґРЅСѓ РѕС€РёР±РєСѓ.
                return {
                    status: validation.status,
                    body: validation.error
                };
            }

            const { activeBattle, player, activeBuffs, masteries } = validation;
            const boss = await getBossById(client, bossId);
            // client РїРµСЂРµРґР°РЅ: РІРЅСѓС‚СЂРё transaction() СЃ FOR UPDATE РЅР° players
            // РІС‚РѕСЂРѕР№ РІС‹Р·РѕРІ С‡РµСЂРµР· РіР»РѕР±Р°Р»СЊРЅС‹Р№ query() Р±СЂР°Р» Р±С‹ РІС‚РѕСЂРѕРµ СЃРѕРµРґРёРЅРµРЅРёРµ
            // РїСѓР»Р° (max 20) вЂ” РїСЂРё >10 Р±РѕСЏС… РїСѓР» РёСЃС‡РµСЂРїС‹РІР°Р»СЃСЏ Рё РїРёСЃР°Р» 500.
            const setBonuses = await getSetBonuses(parseEquipment(player.equipment), client);
            const damage = combat.calculateDamage(bossId, player, masteries, setBonuses);
            const newHp = Math.max(0, (Number(activeBattle.boss.hp) || 0) - (Number(damage) || 0));
            const energyCost = activeBuffs.free_energy ? 0 : 1;

            // РћС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ Р±РѕСЃСЃР° Рё РёР·РЅРѕСЃ СЃРЅР°СЂСЏР¶РµРЅРёСЏ.
            // activeBattle.boss.hp вЂ” С‚РµРєСѓС‰РµРµ HP РґРѕ СЌС‚РѕРіРѕ СѓРґР°СЂР°: РѕС‚ РЅРµРіРѕ
            // Р·Р°РІРёСЃРёС‚, РЅР°СЃРєРѕР»СЊРєРѕ СЃРёР»СЊРЅРѕ Р±РѕСЃСЃ Р±СЊС‘С‚ РІ РѕС‚РІРµС‚.
            const counterHit = boss
                ? await applyBossCounterHit(client, playerId, boss, player, activeBattle.boss.hp)
                : { damage: 0, health: Number(player.health || 0), broken_slots: [] };

            // applyBossCounterHit РїРёС€РµС‚ РёР·РЅРѕС€РµРЅРЅСѓСЋ СЌРєРёРїРёСЂРѕРІРєСѓ РІ Р‘Р”, РЅРѕ
            // РѕР±СЉРµРєС‚ player.equipment РІ JS РЅРµ РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ. РџРµСЂРµС‡РёС‚С‹РІР°РµРј
            // РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ РёР· Р‘Р”, С‡С‚РѕР±С‹ player_defense РЅРёР¶Рµ СЃС‡РёС‚Р°Р» РїРѕ
            // Р°РєС‚СѓР°Р»СЊРЅРѕРјСѓ СЃРѕСЃС‚РѕСЏРЅРёСЋ РїРѕСЃР»Рµ РёР·РЅРѕСЃР°.
            const eqRow = await client.query(
                `SELECT equipment FROM players WHERE id = $1`,
                [playerId]
            );
            player.equipment = parseEquipment(eqRow.rows[0]?.equipment || '{}');
            const _setDefense = await (async () => {
                try {
                    const sb = await getSetBonuses(player.equipment, client);
                    return Number(sb && sb.defense) || 0;
                } catch (_) { return 0; }
            })();

            // Р•Р¶РµРґРЅРµРІРЅРѕРµ Р·Р°РґР°РЅРёРµ В«РќР°РЅРµСЃРё 100 СѓСЂРѕРЅР° Р±РѕСЃСЃР°РјВ».
            await progressDailyTask(client, playerId, 'boss_damage', damage);
            try {
                const { progressContract } = getGameHelpers();
                if (typeof progressContract === 'function') await progressContract(client, playerId, 'boss_damage', damage);
            } catch (_) { /* ignore */ }

            // РўСЂР°С‚Р° СЌРЅРµСЂРіРёРё РќР• РґРІРёРіР°РµС‚ last_energy_update: СЂРµРіРµРЅ РёРґС‘С‚ РѕС‚
            // СЂРµР°Р»СЊРЅРѕ РїСЂРѕС€РµРґС€РµРіРѕ РІСЂРµРјРµРЅРё (С‚Рѕ Р¶Рµ РїСЂР°РІРёР»Рѕ, С‡С‚Рѕ РІ world.js Рё РІ
            // recalcEnergy). РРЅР°С‡Рµ РєР°Р¶РґС‹Р№ СѓРґР°СЂ РѕР±РЅСѓР»СЏР» Р±С‹ РЅР°РєРѕРїР»РµРЅРЅС‹Р№
            // СЂРµРіРµРЅ СЌРЅРµСЂРіРёРё.
            const energyResult = await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - $1)
                 WHERE id = $2
                 RETURNING energy, max_energy, last_energy_update`,
                [energyCost, playerId]
            );
            if (!energyResult.rows[0]) {
                throw { message: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            await client.query(
                `UPDATE player_boss_progress
                 SET current_hp = $1, last_attack = NOW()
                 WHERE player_id = $2 AND boss_id = $3`,
                [newHp, playerId, bossId]
            );

            let killed = false;
            let rewards = null;
            let mastery = masteries.find((m) => m.boss_id === bossId)?.kills || 0;

            if (newHp <= 0) {
                killed = true;
                const killResult = await handleSoloBossKill(client, playerId, bossId, activeBuffs, masteries);
                rewards = killResult.rewards;
                mastery = killResult.mastery;
            }

            // РћР”РРќ РїР»РѕСЃРєРёР№ РѕС‚РІРµС‚, Р±РµР· РІР»РѕР¶РµРЅРЅРѕРіРѕ data: {} вЂ” РІ РЅС‘Рј СЂР°РЅСЊС€Рµ
            // РґСѓР±Р»РёСЂРѕРІР°Р»РёСЃСЊ boss/damage/rewards/mastery/energy/health.
            // РџРѕСЃР»Рµ СѓРґР°Р»РµРЅРёСЏ РІС‚РѕСЂРѕРіРѕ РїСѓС‚Рё Р°С‚Р°РєРё РєР»РёРµРЅС‚ С‡РёС‚Р°РµС‚ С‚РѕР»СЊРєРѕ
            // РІРµСЂС…РЅРёР№ СѓСЂРѕРІРµРЅСЊ, РїРѕСЌС‚РѕРјСѓ РґСѓРїР»СЊ Р±С‹Р» РјС‘СЂС‚РІС‹Рј РІРµСЃРѕРј РІ РєР°Р¶РґРѕРј
            // РѕС‚РІРµС‚Рµ СѓРґР°СЂР°.
            return {
                status: 200,
                body: {
                    success: true,
                    boss_hp: newHp,
                    boss_max_hp: activeBattle.boss.max_hp,
                    damage_dealt: damage,
                    boss_defeated: killed,
                    player_energy: energyResult.rows[0].energy,
                    player_max_energy: energyResult.rows[0].max_energy,
                    // РљР»РёРµРЅС‚ СЃС‚СЂРѕРёС‚ СЂРµРіРµРЅРµСЂР°С†РёСЋ СЌРЅРµСЂРіРёРё РѕС‚ СЌС‚РѕР№ РјРµС‚РєРё. Р‘РµР· РЅРµС‘
                    // РѕРЅ РїСЂРѕРґРѕР»Р¶РёС‚ СЃС‡РёС‚Р°С‚СЊ РѕС‚ СѓСЃС‚Р°СЂРµРІС€РµР№ РјРµС‚РєРё Рё РїРѕРєР°Р¶РµС‚ Р»РёС€РЅСЋСЋ.
                    last_energy_update: energyResult.rows[0].last_energy_update,
                    mastery,
                    rewards,
                    // РћС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ Р±РѕСЃСЃР°.
                    player_damage_taken: counterHit.damage,
                    player_health: counterHit.health,
                    broken_equipment: counterHit.broken_slots,
                    // РћС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ РЎР›Р•Р”РЈР®Р©Р•Р“Рћ СѓРґР°СЂР° вЂ” РїРѕ СѓР¶Рµ СѓРјРµРЅСЊС€РµРЅРЅРѕРјСѓ
                    // HP Р±РѕСЃСЃР°. Р‘РµР· СЌС‚РѕРіРѕ РїРѕРґРїРёСЃСЊ РІ Р±РѕСЋ РїРѕРєР°Р·С‹РІР°Р»Р° Р±С‹ СѓСЂРѕРЅ РѕС‚
                    // РїРѕР»РЅРѕРіРѕ HP Рё РЅРµ РјРµРЅСЏР»Р°СЃСЊ РІРµСЃСЊ Р±РѕР№, С…РѕС‚СЏ СЃРјС‹СЃР» РЅРѕРІРѕР№
                    // С„РѕСЂРјСѓР»С‹ РІ С‚РѕРј, С‡С‚Рѕ РїРѕР±РёС‚С‹Р№ Р±РѕСЃСЃ Р±СЊС‘С‚ СЃР»Р°Р±РµРµ.
                    counter_damage: combat.calculateBossCounterDamage(
                        boss,
                        parseEquipment(player.equipment),
                        { currentHealth: newHp, playerLevel: player.level }
                    ),
                    // РС‚РѕРіРѕРІР°СЏ Р·Р°С‰РёС‚Р° РёРіСЂРѕРєР°: СЌРєРёРїРёСЂРѕРІРєР° + 3 Р·Р° СѓСЂРѕРІРµРЅСЊ + СЃРµС‚РѕРІР°СЏ Р·Р°С‰РёС‚Р°.
                    // Р‘РµР· СЌС‚РѕРіРѕ СЂРѕСЃС‚ Р·Р°С‰РёС‚С‹ СЃ СѓСЂРѕРІРЅРµРј Р±С‹Р» Р±С‹ РЅРµ РІРёРґРµРЅ вЂ”
                    // Р° РёРјРµРЅРЅРѕ РЅР° РЅРµРіРѕ Р¶Р°Р»СѓСЋС‚СЃСЏ (В«Р±СЂРѕРЅСЏ РЅРµ Р·Р°С‰РёС‰Р°РµС‚В»).
                    player_defense: equipmentRules.calculateDefenseTotal(parseEquipment(player.equipment))
                        + equipmentRules.calculateLevelDefense(player.level)
                        + _setDefense
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'solo_attack');
    }
});

router.get('/raids', async (req, res) => {
    try {
        if (!req.player?.id) return unauthorized(res);
        const playerId = req.player?.id;
        const outcome = await withClient(async (client) => {
            const raids = await getActiveRaids(client, playerId);
            // РЎСЋРґР° Р¶Рµ РѕС‚РґР°С‘Рј РЅРµРїРѕР»СѓС‡РµРЅРЅС‹Рµ РЅР°РіСЂР°РґС‹: /raids Р·РѕРІС‘С‚ РєР»РёРµРЅС‚ РїРѕСЃР»Рµ
            // РєР°Р¶РґРѕРіРѕ СѓРґР°СЂР° РїРѕ СЂРµР№РґСѓ, Рё СЌС‚Рѕ РµРґРёРЅСЃС‚РІРµРЅРЅР°СЏ С‚РѕС‡РєР°, РіРґРµ СѓС‡Р°СЃС‚РЅРёРє
            // СѓР·РЅР°С‘С‚ Рѕ СЃРІРѕРµР№ РґРѕР»Рµ, РµСЃР»Рё РґРѕР±РёР» Р±РѕСЃСЃР° РЅРµ РѕРЅ.
            const pendingRaidRewards = playerId ? await getPendingRaidRewards(client, playerId) : [];
            return {
                success: true,
                data: {
                    raids: raids.raids,
                    participating_raid_ids: raids.participatingIds,
                    participating_boss_ids: raids.participatingBossIds,
                    pending_raid_rewards: pendingRaidRewards
                }
            };
        });
        res.json(outcome);
    } catch (error) {
        return handleError(res, error, 'raids');
    }
});

router.post('/raid/start', async (req, res) => {
    // Р’Р°Р»РёРґР°С†РёСЏ РґРѕ РѕС‚РєСЂС‹С‚РёСЏ С‚СЂР°РЅР·Р°РєС†РёРё вЂ” РєР°Рє РІ POST /bosses/start.
    const bossId = Number(req.body?.boss_id);
    if (!requireAuth(req, res)) return;
    if (!req.player?.id) return unauthorized(res);
    const playerId = req.player?.id;
    const playerName = req.player.first_name || 'РРіСЂРѕРє';

    if (!requireBossId(res, bossId)) return;

    try {
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                return {
                    status: 400,
                    body: buildAlreadyInFightResponse(activeBattle)
                };
            }

            const boss = await getBossById(client, bossId);
            if (!boss) {
                return {
                    status: 404,
                    body: { success: false, error: 'Р‘РѕСЃСЃ РЅРµ РЅР°Р№РґРµРЅ', code: 'BOSS_NOT_FOUND' }
                };
            }

            // P1-4: СЃРµСЂРёР°Р»РёР·СѓРµРј СЃРѕР·РґР°РЅРёРµ СЂРµР№РґР° РїРѕ СЃС‚СЂРѕРєРµ Р±РѕСЃСЃР°.
            //
            // РџРѕСЂСЏРґРѕРє Р±Р»РѕРєРёСЂРѕРІРѕРє вЂ” player (getPlayerBaseState РІС‹С€Рµ) в†’ bosses,
            // Рё РѕРЅ С‚Р°РєРѕР№ Р¶Рµ РІРѕ РІСЃРµС… РѕСЃС‚Р°Р»СЊРЅС‹С… СЂРѕСѓС‚Р°С…: РЅРё РѕРґРЅР° С‚СЂР°РЅР·Р°РєС†РёСЏ РЅРµ
            // Р±РµСЂС‘С‚ Р±РѕСЃСЃР° СЂР°РЅСЊС€Рµ РёРіСЂРѕРєР°, РїРѕСЌС‚РѕРјСѓ РІР·Р°РёРјРѕР±Р»РѕРєРёСЂРѕРІРєРё РЅРµ Р±СѓРґРµС‚.
            //
            // Р—Р°С‡РµРј: РїСЂРѕРІРµСЂРєР° В«СЂРµР№Рґ СѓР¶Рµ РёРґС‘С‚В» (SELECT РЅРёР¶Рµ) Рё INSERT С€Р»Рё Р±РµР·
            // Р±Р»РѕРєРёСЂРѕРІРєРё, РїРѕСЌС‚РѕРјСѓ РґРІР° Р»РёРґРµСЂР°, Р·Р°РїСѓСЃС‚РёРІС€РёРµ СЂРµР№Рґ РѕРґРЅРѕРІСЂРµРјРµРЅРЅРѕ,
            // РѕР±Р° РїСЂРѕС…РѕРґРёР»Рё РїСЂРѕРІРµСЂРєСѓ Рё СѓРїРёСЂР°Р»РёСЃСЊ РІ UNIQUE(boss_id, is_active):
            // РїРѕР±РµРґРёС‚РµР»СЊ РїРѕР»СѓС‡Р°Р» СЂРµР№Рґ, Р° РїСЂРѕРёРіСЂР°РІС€РёР№ вЂ” 500 INTERNAL_ERROR
            // РІРјРµСЃС‚Рѕ РІРЅСЏС‚РЅРѕР№ Р±РёР·РЅРµСЃ-РѕС€РёР±РєРё RAID_ALREADY_ACTIVE.
            const player = await getPlayerBaseState(client, playerId);

            await client.query(
                'SELECT id FROM bosses WHERE id = $1 FOR UPDATE',
                [bossId]
            );
            if (!player || player.health <= 0) {
                return {
                    status: 400,
                    body: { success: false, error: 'Р’С‹ РјРµСЂС‚РІС‹. РќРµР»СЊР·СЏ РЅР°С‡Р°С‚СЊ РјР°СЃСЃРѕРІС‹Р№ Р±РѕР№.', code: 'PLAYER_DEAD' }
                };
            }

            await client.query(
                `DELETE FROM raid_progress
                 WHERE boss_id = $1
                   AND is_raid = true
                   AND (expires_at <= NOW() OR is_active = false)`,
                [bossId]
            );

            const existingRaid = await client.query(
                `SELECT id FROM raid_progress
                 WHERE boss_id = $1 AND is_active = true AND is_raid = true AND expires_at > NOW()`,
                [bossId]
            );

            if (existingRaid.rows.length > 0) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'РњР°СЃСЃРѕРІС‹Р№ Р±РѕР№ РЅР° СЌС‚РѕРіРѕ Р±РѕСЃСЃР° СѓР¶Рµ РёРґС‘С‚',
                        code: 'RAID_ALREADY_ACTIVE',
                        raid_id: existingRaid.rows[0].id
                    }
                };
            }

            // РЎРј. РїРѕСЏСЃРЅРµРЅРёРµ РІ POST /bosses/start: С‡РёСЃР»Рѕ СЃРїРёСЃР°РЅРЅС‹С… РєР»СЋС‡РµР№
            // РїРѕР»СѓС‡Р°РµС‚СЃСЏ РІРЅСѓС‚СЂРё С‚СЂР°РЅР·Р°РєС†РёРё Рё СѓС…РѕРґРёС‚ РІ РѕС‚РІРµС‚Рµ РІРјРµСЃС‚Рµ СЃ РЅРёРј,
            // РїРµСЂРµС‡РёС‚С‹РІР°С‚СЊ Р±Р°Р·Сѓ РїРѕСЃР»Рµ COMMIT РЅРµ РЅСѓР¶РЅРѕ.
            const keysSpent = bossId > 1
                ? await spendBossKeys(client, playerId, bossId - 1)
                : 0;

            const expiresAt = new Date(Date.now() + MASS_FIGHT_DURATION_MS);

            const raidResult = await client.query(
                `INSERT INTO raid_progress
                 (boss_id, current_health, max_health, started_at, expires_at, is_active, is_raid, leader_id, leader_name)
                 VALUES ($1, $2, $3, NOW(), $4, true, true, $5, $6)
                 RETURNING id`,
                [bossId, boss.max_health, boss.max_health, expiresAt, playerId, playerName]
            );

            const raidId = raidResult.rows[0].id;

            await client.query(
                `INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                 VALUES ($1, $2, $3, 0, NOW(), NOW())
             ON CONFLICT (boss_id, player_id, raid_id)
                  DO UPDATE SET raid_id = EXCLUDED.raid_id,
                                joined_at = NOW(),
                                last_hit_at = NOW()`,
                [bossId, playerId, raidId]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'mass',
                     active_raid_id = $2
                 WHERE id = $3`,
                [bossId, raidId, playerId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        raid_id: raidId,
                        mode: 'mass',
                        boss: {
                            id: boss.id,
                            name: boss.name,
                            icon: boss.icon,
                            hp: boss.max_health,
                            max_hp: boss.max_health
                        },
                        keys_spent: keysSpent,
                        expires_at: expiresAt,
                        time_remaining_ms: MASS_FIGHT_DURATION_MS
                    }
                }
            };
        });

        await logPlayerAction(playerId, 'raid_start', { bossId, raidId: outcome.body?.data?.raid_id });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        // РљР°Рє РІ POST /bosses/start: РЅРµС…РІР°С‚РєР° РєР»СЋС‡РµР№ вЂ” Р±РёР·РЅРµСЃ-РѕС€РёР±РєР° СЃ 400
        // Рё РїРѕР»СЏРјРё keys_owned/keys_required, Р° РЅРµ 500.
        if (error.code === 'INSUFFICIENT_KEYS') {
            return res.status(400).json(error);
        }
        // P1-4 (СЃС‚СЂР°С…РѕРІРєР°): РµСЃР»Рё UNIQUE(boss_id, is_active) СЃСЂР°Р±РѕС‚Р°Р» СЂР°РЅСЊС€Рµ,
        // С‡РµРј Р±Р»РѕРєРёСЂРѕРІРєР° Р±РѕСЃСЃР° (РЅР°РїСЂРёРјРµСЂ, СЂРµР№Рґ СЃРѕР·РґР°РЅ РґСЂСѓРіРёРј РїСѓС‚С‘Рј) вЂ” РѕС‚РґР°С‘Рј
        // С‚Сѓ Р¶Рµ Р±РёР·РЅРµСЃ-РѕС€РёР±РєСѓ, Р° РЅРµ РЅРµРїРѕРЅСЏС‚РЅС‹Р№ 500 INTERNAL_ERROR.
        if (error.code === '23505' || /unique|duplicate/i.test(error.constraint || error.message || '')) {
            logger.warn('[bosses] Р“РѕРЅРєР° РїСЂРё СЃРѕР·РґР°РЅРёРё СЂРµР№РґР°, СЂРµР№Рґ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚', {
                playerId, bossId, constraint: error.constraint
            });
            return res.status(400).json({
                success: false,
                error: 'РњР°СЃСЃРѕРІС‹Р№ Р±РѕР№ РЅР° СЌС‚РѕРіРѕ Р±РѕСЃСЃР° СѓР¶Рµ РёРґС‘С‚',
                code: 'RAID_ALREADY_ACTIVE'
            });
        }
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_start');
    }
});

router.post('/raid/:id/join', async (req, res) => {
    // Р’Р°Р»РёРґР°С†РёСЏ РґРѕ РѕС‚РєСЂС‹С‚РёСЏ С‚СЂР°РЅР·Р°РєС†РёРё вЂ” РєР°Рє РІ РѕСЃС‚Р°Р»СЊРЅС‹С… РјР°СЂС€СЂСѓС‚Р°С… Р±РѕСЃСЃРѕРІ.
    const raidId = Number(req.params.id);
    if (!requireAuth(req, res)) return;
    if (!req.player?.id) return unauthorized(res);
    const playerId = req.player?.id;

    if (!requireRaidId(res, raidId)) return;

    try {
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (activeBattle) {
                if (activeBattle.type === 'mass' && activeBattle.raid_id === raidId) {
                    return {
                        status: 400,
                        body: { success: false, error: 'Р’С‹ СѓР¶Рµ СѓС‡Р°СЃС‚РІСѓРµС‚Рµ РІ СЌС‚РѕРј РјР°СЃСЃРѕРІРѕРј Р±РѕСЋ', code: 'ALREADY_PARTICIPATING' }
                    };
                }

                return {
                    status: 400,
                    body: buildAlreadyInFightResponse(activeBattle)
                };
            }

            const raidResult = await client.query(
                `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at,
                        b.name AS boss_name, b.icon
                  FROM raid_progress rp
                  JOIN bosses b ON b.id = rp.boss_id
                  WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()
                  FOR UPDATE`,
                [raidId]
            );

            const raid = raidResult.rows[0];
            if (!raid) {
                return {
                    status: 404,
                    body: { success: false, error: 'РњР°СЃСЃРѕРІС‹Р№ Р±РѕР№ РЅРµ РЅР°Р№РґРµРЅ', code: 'RAID_NOT_FOUND' }
                };
            }

            const player = await getPlayerBaseState(client, playerId);
            if (!player || player.health <= 0) {
                return {
                    status: 400,
                    body: { success: false, error: 'Р’С‹ РјРµСЂС‚РІС‹. РќРµР»СЊР·СЏ РїСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ Рє РјР°СЃСЃРѕРІРѕРјСѓ Р±РѕСЋ.', code: 'PLAYER_DEAD' }
                };
            }

            // РљР»СЋС‡РµРІР°СЏ С†РµРїРѕС‡РєР° РЅРµ РґРѕР»Р¶РЅР° РѕР±С…РѕРґРёС‚СЊСЃСЏ С‡РµСЂРµР· С‡СѓР¶РѕР№ СЂРµР№Рґ: РёРіСЂРѕРє Р±РµР·
            // РµРґРёРЅРѕРіРѕ РєР»СЋС‡Р° РЅРµ РґРѕР»Р¶РµРЅ РїРѕРїР°СЃС‚СЊ РІ СЂРµР№Рґ РЅР° 10-РіРѕ Р±РѕСЃСЃР° Рё Р±РёС‚СЊ
            // РµРіРѕ Р·Р° РґРѕР»СЋ РЅР°РіСЂР°Рґ. РљР»СЋС‡Рё РїСЂРё РІС…РѕРґРµ РќР• С‚СЂР°С‚СЏС‚СЃСЏ (РёС… РїР»Р°С‚РёС‚
            // Р»РёРґРµСЂ, РєРѕС‚РѕСЂС‹Р№ РёС… Рё Р·Р°РїСѓСЃС‚РёР») вЂ” С‚СЂРµР±СѓРµС‚СЃСЏ С‚РѕР»СЊРєРѕ РЅР°Р»РёС‡РёРµ.
            if (raid.boss_id > 1) {
                const required = await getKeysRequiredForBoss(client, raid.boss_id - 1);
                const owned = await getPlayerKeyCount(client, playerId, raid.boss_id - 1);
                if (owned < required) {
                    return {
                        status: 400,
                        body: {
                            success: false,
                            error: `РќСѓР¶РЅРѕ ${required} РєР»СЋС‡РµР№ РѕС‚ Р±РѕСЃСЃР° ${raid.boss_id - 1}, Сѓ РІР°СЃ ${owned}`,
                            code: 'INSUFFICIENT_KEYS',
                            keys_owned: owned,
                            keys_required: required
                        }
                    };
                }
            }

            await client.query(
                `INSERT INTO boss_sessions (boss_id, player_id, raid_id, damage_dealt, joined_at, last_hit_at)
                 VALUES ($1, $2, $3, 0, NOW(), NOW())
             ON CONFLICT (boss_id, player_id, raid_id)
                  DO UPDATE SET raid_id = EXCLUDED.raid_id,
                                joined_at = NOW(),
                                last_hit_at = NOW()`,
                [raid.boss_id, playerId, raidId]
            );

            await client.query(
                `UPDATE players
                 SET active_boss_id = $1,
                     active_boss_started_at = NOW(),
                     active_boss_mode = 'mass',
                     active_raid_id = $2
                 WHERE id = $3`,
                [raid.boss_id, raidId, playerId]
            );

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        raid_id: raidId,
                        mode: 'mass',
                        boss: {
                            id: raid.boss_id,
                            name: raid.boss_name,
                            icon: raid.icon,
                            hp: raid.current_health,
                            max_hp: raid.max_health
                        },
                        expires_at: raid.expires_at
                    }
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_join');
    }
});

/**
 * Р’С‹Р№С‚Рё РёР· РјР°СЃСЃРѕРІРѕРіРѕ Р±РѕСЏ (РѕСЃС‚Р°С‚СЊСЃСЏ Р±РµР· Р°РєС‚РёРІРЅРѕРіРѕ Р±РѕСЏ, РЅРѕ СЃ РЅР°РєРѕРїР»РµРЅРЅС‹Рј РІРєР»Р°РґРѕРј).
 *
 * Р Р°РЅСЊС€Рµ РІС‹С…РѕРґР° РЅРµ Р±С‹Р»Рѕ РІРѕРѕР±С‰Рµ: active_boss_* СЃРЅРёРјР°Р»РёСЃСЊ С‚РѕР»СЊРєРѕ РїСЂРё
 * СѓР±РёР№СЃС‚РІРµ Р±РѕСЃСЃР° РёР»Рё РёСЃС‚РµС‡РµРЅРёРё СЂРµР№РґР°.
 *
 * РЎРµСЃСЃРёСЋ СЃ РЅР°РєРѕРїР»РµРЅРЅС‹Рј СѓСЂРѕРЅРѕРј РќР• СѓРґР°Р»СЏРµРј: РЅР°РіСЂР°РґР° РїСЂРё СѓР±РёР№СЃС‚РІРµ Р±РѕСЃСЃР°
 * СЃС‡РёС‚Р°РµС‚СЃСЏ РїРѕ boss_sessions, Рё РІС‹С€РµРґС€РёР№ СѓС‡Р°СЃС‚РЅРёРє РґРѕР»Р¶РµРЅ РїРѕР»СѓС‡РёС‚СЊ СЃРІРѕСЋ
 * РґРѕР»СЋ (СЃС‚СЂРѕРєРё raid_rewards РїРёС€СѓС‚СЃСЏ РІСЃРµРј СѓС‡Р°СЃС‚РЅРёРєР°Рј СЂРµР№РґР°).
 */
router.post('/raid/:id/leave', async (req, res) => {
    // Р’Р°Р»РёРґР°С†РёСЏ РґРѕ РѕС‚РєСЂС‹С‚РёСЏ С‚СЂР°РЅР·Р°РєС†РёРё вЂ” РєР°Рє РІ РѕСЃС‚Р°Р»СЊРЅС‹С… РјР°СЂС€СЂСѓС‚Р°С… Р±РѕСЃСЃРѕРІ.
    const raidId = Number(req.params.id);
    if (!requireAuth(req, res)) return;
    if (!req.player?.id) return unauthorized(res);
    const playerId = req.player?.id;

    if (!requireRaidId(res, raidId)) return;

    try {
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (!activeBattle || activeBattle.type !== 'mass' || activeBattle.raid_id !== raidId) {
                return {
                    status: 400,
                    body: { success: false, error: 'Р’С‹ РЅРµ СѓС‡Р°СЃС‚РІСѓРµС‚Рµ РІ СЌС‚РѕРј РјР°СЃСЃРѕРІРѕРј Р±РѕСЋ', code: 'NOT_PARTICIPATING' }
                };
            }

            await clearPlayerActiveBattle(client, playerId);

            return {
                status: 200,
                body: {
                    success: true,
                    data: { raid_id: raidId, left: true }
                }
            };
        });

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_leave');
    }
});

router.post('/raid/:id/attack', async (req, res) => {
    // Р’Р°Р»РёРґР°С†РёСЏ РґРѕ РѕС‚РєСЂС‹С‚РёСЏ С‚СЂР°РЅР·Р°РєС†РёРё вЂ” РєР°Рє РІ РѕСЃС‚Р°Р»СЊРЅС‹С… РјР°СЂС€СЂСѓС‚Р°С… Р±РѕСЃСЃРѕРІ.
    const raidId = Number(req.params.id);
    if (!requireAuth(req, res)) return;
    if (!req.player?.id) return unauthorized(res);
    const playerId = req.player?.id;

    if (!requireRaidId(res, raidId)) return;

    try {
        // expLogs СЃРѕР±РёСЂР°РµС‚СЃСЏ РІРЅСѓС‚СЂРё С‚СЂР°РЅР·Р°РєС†РёРё, РЅРѕ Р»РѕРіРёСЂСѓРµРј РїРѕСЃР»Рµ COMMIT,
        // С‡С‚РѕР±С‹ timeout РІ Р»РѕРіРёСЂРѕРІР°РЅРёРё РЅРµ РѕС‚РєР°С‚С‹РІР°Р» РЅР°С‡РёСЃР»РµРЅРЅС‹Рµ РЅР°РіСЂР°РґС‹.
        let expLogs = [];
        const outcome = await transaction(async (client) => {
            const activeBattle = await resolveActiveBattle(client, playerId);
            if (!activeBattle || activeBattle.type !== 'mass' || activeBattle.raid_id !== raidId) {
                // Р РµР№Рґ РєРѕРЅС‡РёР»СЃСЏ, Рё РµРіРѕ СЃС‚СЂРѕРєР° СѓР¶Рµ СѓРґР°Р»РµРЅР° вЂ” resolveActiveBattle
                // СЃР±СЂРѕСЃРёР» active_raid_id. Р Р°РЅСЊС€Рµ Р·РґРµСЃСЊ РІСЃРµРіРґР° Р±С‹Р»Рѕ В«Р’С‹ РЅРµ
                // СѓС‡Р°СЃС‚РІСѓРµС‚РµВ», С…РѕС‚СЏ РёРіСЂРѕРє СѓС‡Р°СЃС‚РІРѕРІР°Р» Рё РЅР°РіСЂР°РґСѓ РїРѕР»СѓС‡РёР».
                const raidExists = await client.query(
                    `SELECT 1 FROM raid_progress
                      WHERE id = $1 AND is_raid = true AND is_active = true AND expires_at > NOW()`,
                    [raidId]
                );
                if (raidExists.rows.length === 0) {
                    return {
                        status: 400,
                        body: {
                            success: false,
                            error: 'Р­С‚РѕС‚ РјР°СЃСЃРѕРІС‹Р№ Р±РѕР№ СѓР¶Рµ Р·Р°РІРµСЂС€С‘РЅ. РќР°РіСЂР°РґС‹ Р·Р° РЅРµРіРѕ СЃРјРѕС‚СЂРёС‚Рµ РІ СЂР°Р·РґРµР»Рµ Р±РѕСЃСЃРѕРІ.',
                            code: 'RAID_FINISHED'
                        }
                    };
                }
                return {
                    status: 400,
                    body: { success: false, error: 'Р’С‹ РЅРµ СѓС‡Р°СЃС‚РІСѓРµС‚Рµ РІ СЌС‚РѕРј РјР°СЃСЃРѕРІРѕРј Р±РѕСЋ', code: 'NOT_PARTICIPATING' }
                };
            }

            const raidResult = await client.query(
                `SELECT rp.id, rp.boss_id, rp.current_health, rp.max_health, rp.expires_at, rp.leader_id,
                        b.name AS boss_name, b.reward_coins, b.reward_experience, b.reward_items
                 FROM raid_progress rp
                 JOIN bosses b ON b.id = rp.boss_id
                 WHERE rp.id = $1 AND rp.is_active = true AND rp.is_raid = true AND rp.expires_at > NOW()
                 FOR UPDATE`,
                [raidId]
            );

            const raid = raidResult.rows[0];
            if (!raid) {
                return {
                    status: 404,
                    body: { success: false, error: 'РњР°СЃСЃРѕРІС‹Р№ Р±РѕР№ РЅРµ РЅР°Р№РґРµРЅ', code: 'RAID_NOT_FOUND' }
                };
            }

            const sessionResult = await client.query(
                'SELECT * FROM boss_sessions WHERE player_id = $1 AND raid_id = $2 FOR UPDATE',
                [playerId, raidId]
            );

            const session = sessionResult.rows[0];
            if (!session) {
                return {
                    status: 400,
                    body: { success: false, error: 'Р’С‹ РЅРµ СѓС‡Р°СЃС‚РІСѓРµС‚Рµ РІ СЌС‚РѕРј РјР°СЃСЃРѕРІРѕРј Р±РѕСЋ', code: 'NOT_PARTICIPATING' }
                };
            }

            const player = await getPlayerBaseState(client, playerId);
            if (!player) {
                return { status: 404, body: { success: false, error: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ', code: 'PLAYER_NOT_FOUND' } };
            }
            // Р±РµР· РЅРµС‘ РїРѕСЃР»Рµ РёСЃС‡РµСЂРїР°РЅРёСЏ СЌРЅРµСЂРіРёРё СЂРµР№Рґ С‚РѕР¶Рµ С‚СЂРµР±РѕРІР°Р» РїРѕРёСЃРєР° РІ РјРёСЂРµ.
            await recalcEnergy(client, player);
            const activeBuffs = getActiveBuffs(player.buffs);
            if (!activeBuffs.free_energy && player.energy < 1) {
                return {
                    status: 400,
                    body: { success: false, error: 'РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ СЌРЅРµСЂРіРёРё', code: 'INSUFFICIENT_ENERGY' }
                };
            }

            if (player.health <= 0) {
                return {
                    status: 400,
                    body: { success: false, error: 'Р’С‹ РјРµСЂС‚РІС‹. РќРµР»СЊР·СЏ Р°С‚Р°РєРѕРІР°С‚СЊ СЂРµР№РґРѕРІРѕРіРѕ Р±РѕСЃСЃР°.', code: 'PLAYER_DEAD' }
                };
            }

            const masteries = await getBossMasteries(client, playerId);
            const setBonuses = await getSetBonuses(parseEquipment(player.equipment), client);
            const damage = combat.calculateDamage(raid.boss_id, player, masteries, setBonuses);
            const newHp = Math.max(0, (Number(raid.current_health) || 0) - (Number(damage) || 0));
            const newTotalDamage = session.damage_dealt + damage;
            const energyCost = activeBuffs.free_energy ? 0 : 1;

            // РћС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ СЂРµР№РґРѕРІРѕРіРѕ Р±РѕСЃСЃР° Рё РёР·РЅРѕСЃ СЃРЅР°СЂСЏР¶РµРЅРёСЏ вЂ” С‚Рѕ Р¶Рµ,
            // С‡С‚Рѕ Рё РІ СЃРѕР»Рѕ-Р±РѕСЋ: РёРЅР°С‡Рµ СЂРµР№Рґ Р±С‹Р» Р±С‹ РїРѕР»РЅРѕСЃС‚СЊСЋ Р±РµР·РѕРїР°СЃРЅС‹Рј.
            // raid.current_health вЂ” HP Р”Рћ СЌС‚РѕРіРѕ СѓРґР°СЂР°, РѕС‚ РЅРµРіРѕ Р·Р°РІРёСЃРёС‚ СЃРёР»Р°
            // РѕС‚РІРµС‚РЅРѕРіРѕ СѓРґР°СЂР°.
            const raidBoss = await getBossById(client, raid.boss_id);
            const counterHit = raidBoss
                ? await applyBossCounterHit(client, playerId, raidBoss, player, raid.current_health)
                : { damage: 0, health: Number(player.health || 0), broken_slots: [] };

            // applyBossCounterHit РїРёС€РµС‚ РёР·РЅРѕС€РµРЅРЅСѓСЋ СЌРєРёРїРёСЂРѕРІРєСѓ РІ Р‘Р”, РЅРѕ
            // РѕР±СЉРµРєС‚ player.equipment РІ JS РЅРµ РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ. РџРµСЂРµС‡РёС‚С‹РІР°РµРј
            // РѕР±РѕСЂСѓРґРѕРІР°РЅРёРµ РёР· Р‘Р”, С‡С‚РѕР±С‹ player_defense РЅРёР¶Рµ СЃС‡РёС‚Р°Р» РїРѕ
            // Р°РєС‚СѓР°Р»СЊРЅРѕРјСѓ СЃРѕСЃС‚РѕСЏРЅРёСЋ РїРѕСЃР»Рµ РёР·РЅРѕСЃР°.
            const eqRow = await client.query(
                `SELECT equipment FROM players WHERE id = $1`,
                [playerId]
            );
            player.equipment = parseEquipment(eqRow.rows[0]?.equipment || '{}');
            await progressDailyTask(client, playerId, 'boss_damage', damage);
            try {
                const { progressContract } = getGameHelpers();
                if (typeof progressContract === 'function') await progressContract(client, playerId, 'boss_damage', damage);
            } catch (_) { /* ignore */ }

            // РЎРј. РєРѕРјРјРµРЅС‚Р°СЂРёР№ РІС‹С€Рµ: СЂРµРіРµРЅ РЅРµ СЃР±СЂР°СЃС‹РІР°РµС‚СЃСЏ РїСЂРё С‚СЂР°С‚Рµ.
            const energyResult = await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - $1)
                 WHERE id = $2
                 RETURNING energy, max_energy, last_energy_update`,
                [energyCost, playerId]
            );
            if (!energyResult.rows[0]) {
                throw { message: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }

            await client.query('UPDATE raid_progress SET current_health = $1 WHERE id = $2', [newHp, raidId]);
            // first_hit РѕС‚РјРµС‡Р°РµС‚СЃСЏ Р·РґРµСЃСЊ, Р° РЅРµ РІ РјРѕРјРµРЅС‚ РІС…РѕРґР°: СѓС‡Р°СЃС‚РЅРёРє,
            // РІРѕС€РµРґС€РёР№ РїРµСЂРІС‹Рј, РЅРѕ РЅРёРєРµРј РЅРµ С‚СЂРѕРЅСѓС‚С‹Р№ Р±РѕСЃСЃР°, Р±РѕРЅСѓСЃР° РЅРµ СЃС‚РѕРёС‚.
            // damage_dealt РІ CASE вЂ” РЎРўРђР РћР• Р·РЅР°С‡РµРЅРёРµ (РґРѕ СЌС‚РѕРіРѕ UPDATE).
            // first_hitter = TRUE С‚РѕР»СЊРєРѕ С‚РѕРјСѓ, РєС‚Рѕ РїРµСЂРІС‹Рј РЅР°РЅС‘СЃ СѓСЂРѕРЅ Р±РѕСЃСЃСѓ
            // РІ СЌС‚РѕРј СЂРµР№РґРµ (СѓСЂРѕРЅ РёРіСЂРѕРєР° = 0 Рё РЅРёРєС‚Рѕ РґСЂСѓРіРѕР№ РµС‰С‘ РЅРµ Р±РёР»СЃСЏ).
            await client.query(
                `UPDATE boss_sessions
                    SET damage_dealt = $1,
                        last_hit_at = NOW(),
                        first_hitter = CASE
                            WHEN damage_dealt = 0
                                 AND NOT EXISTS (
                                     SELECT 1 FROM boss_sessions bs2
                                     WHERE bs2.raid_id = boss_sessions.raid_id
                                       AND bs2.player_id != boss_sessions.player_id
                                       AND bs2.damage_dealt > 0
                                 )
                            THEN TRUE
                            ELSE first_hitter
                        END
                  WHERE player_id = $2 AND raid_id = $3`,
                [newTotalDamage, playerId, raidId]
            );

            // Р›РѕРі Р±РѕСЏ: С‡РµР№ СѓРґР°СЂ, СЃРєРѕР»СЊРєРѕ СЃРЅСЏР» Рё С‡РµРј РѕС‚РІРµС‚РёР» Р±РѕСЃСЃ. РџРёС€РµРј
            // РїРѕСЃР»Рµ РјСѓС‚Р°С†РёР№, С‡С‚РѕР±С‹ С†РёС„СЂС‹ СЃРѕР±С‹С‚РёСЏ Р±С‹Р»Рё РёС‚РѕРіРѕРІС‹РјРё.
            await appendRaidLog(client, raidId, {
                type: 'attack',
                player_id: playerId,
                player_name: player.first_name || 'РРіСЂРѕРє',
                damage,
                counter_damage: counterHit.damage,
                boss_hp_after: newHp,
                final: newHp <= 0,
                at: new Date().toISOString()
            });

            let killed = false;
            let rewards = null;
            if (newHp <= 0) {
                killed = true;
                await client.query('UPDATE raid_progress SET is_active = false, ended_at = NOW(), current_health = 0 WHERE id = $1', [raidId]);

                const participantsResult = await client.query(
                    `SELECT bs.player_id, bs.damage_dealt, bs.first_hitter, p.buffs
                      FROM boss_sessions bs
                      JOIN players p ON p.id = bs.player_id
                      WHERE bs.raid_id = $1`,
                    [raidId]
                );

                const allParticipants = participantsResult.rows;
                const rewardParticipants = allParticipants.filter((row) => Number(row.damage_dealt || 0) > 0);
                const totalDamage = rewardParticipants.reduce((sum, row) => sum + Number(row.damage_dealt || 0), 0) || 1;
                const participantIds = allParticipants.map((row) => row.player_id);

                const leaderIdRaw = Number(raid.leader_id);
                const lastHitId = playerId;
                const shares = allParticipants.map((row) => {
                    const dealt = Number(row.damage_dealt || 0);
                    let bonusMultiplier = 1;
                    if (dealt > 0 && row.first_hitter) bonusMultiplier += RAID_FIRST_HIT_BONUS;
                    if (Number(row.player_id) === lastHitId) bonusMultiplier += RAID_LAST_HIT_BONUS;
                    return {
                        participantId: Number(row.player_id),
                        dealt,
                        share: dealt > 0 ? dealt / totalDamage : 0,
                        bonusMultiplier,
                        buffs: row.buffs
                    };
                });

                const coinsPool = Number(raid.reward_coins || 0);
                const expPool = Number(raid.reward_experience || 0);
                const topDamager = shares.reduce((best, row) => (row.dealt > (best ? best.dealt : -1) ? row : best), null);
                const hasRealDamage = Boolean(topDamager) && topDamager.dealt > 0;
                const coinsRemainder = hasRealDamage
                    ? Math.max(0, coinsPool - shares.reduce((s, r) => s + Math.floor(coinsPool * r.share * r.bonusMultiplier), 0))
                    : 0;
                const expRemainder = hasRealDamage
                    ? Math.max(0, expPool - shares.reduce((s, r) => s + Math.floor(expPool * r.share * r.bonusMultiplier), 0))
                    : 0;

                // Р‘Р°С‚С‡-Р·Р°РіСЂСѓР·РєР° С€Р°Р±Р»РѕРЅРѕРІ РЅР°РіСЂР°Рґ Р”Рћ С†РёРєР»Р° РїРѕ СѓС‡Р°СЃС‚РЅРёРєР°Рј.
                const raidRewardTemplates = await loadItemTemplates(
                    client,
                    normalizeRewardItems(raid.reward_items)
                );

                // Р‘Р°С‚С‡РѕРІС‹Рµ РјР°СЃСЃРёРІС‹ РґР»СЏ РјР°СЃСЃРѕРІС‹С… UPDATE/INSERT РІРјРµСЃС‚Рѕ N+1 РІ С†РёРєР»Рµ.
                const coinUpdates = [];   // [playerId, amount, ...]
                const expUpdates = [];    // [playerId, amount, ...]
                const masteryUpdates = []; // [playerId, bossId, ...]
                const bossesKilledUpdates = []; // [playerId, ...]
                const raidRewardsRows = []; // [raidId, bossId, playerId, coins, exp, itemsJson, keyName, claimed]
                const participantRewards = new Map(); // playerId -> {coins, exp, items, key}

                for (const entry of [...shares].sort((a, b) => a.participantId - b.participantId)) {
                    const participantId = entry.participantId;
                    const participantBuffs = getActiveBuffs(entry.buffs);
                    const lootMultiplier = participantBuffs.loot_x2 ? 2 : 1;

                    const baseCoins = Math.floor(coinsPool * entry.share * entry.bonusMultiplier);
                    const baseExp = Math.floor(expPool * entry.share * entry.bonusMultiplier);
                    const isTopDamager = Boolean(topDamager) && topDamager.participantId === participantId;

                    const coinsReward = baseCoins + (isTopDamager ? coinsRemainder : 0);
                    let experienceReward = participantBuffs.exp_x2 ? baseExp * 2 : baseExp;
                    if (isTopDamager && expRemainder > 0) experienceReward += expRemainder;

                    const { granted: grantedItems, undropped: participantUndropped } = await grantRewardItems(client, participantId, raid.reward_items, entry.share * lootMultiplier, raidRewardTemplates);
                    // trackCollectedItems РґР»СЏ РЅР°РіСЂР°Рґ СЂРµР№РґР° вЂ” РёРЅР°С‡Рµ РґРѕСЃС‚РёР¶РµРЅРёРµ
                    // В«РљРѕР»Р»РµРєС†РёРѕРЅРµСЂВ» РЅРµ СѓС‡РёС‚С‹РІР°РµС‚ РїСЂРµРґРјРµС‚С‹ РёР· СЂРµР№РґР°.
if (grantedItems && grantedItems.length > 0) {
                            const grantedIds = grantedItems
                                .filter((item) => item && item.id)
                                .map((item) => item.id);
                            if (grantedIds.length > 0) {
                                await trackCollectedItems(client, participantId, grantedIds);
                            }
                        }
                    const isLeader = participantId === leaderIdRaw;

                    // РљР»СЋС‡ СЃР»РµРґСѓСЋС‰РµРіРѕ Р±РѕСЃСЃР° РІС‹РґР°С‘С‚СЃСЏ Р’РЎР•Рњ СѓС‡Р°СЃС‚РЅРёРєР°Рј СЃ СѓСЂРѕРЅРѕРј > 0,
                    // Р° РЅРµ С‚РѕР»СЊРєРѕ Р»РёРґРµСЂСѓ. Р›РёРґРµСЂ РїРѕР»СѓС‡Р°РµС‚ РєР»СЋС‡ РіР°СЂР°РЅС‚РёСЂРѕРІР°РЅРЅРѕ,
                    // РѕСЃС‚Р°Р»СЊРЅС‹Рµ вЂ” СЃ РІРµСЂРѕСЏС‚РЅРѕСЃС‚СЊСЋ, РїСЂРѕРїРѕСЂС†РёРѕРЅР°Р»СЊРЅРѕР№ РґРѕР»Рµ СѓСЂРѕРЅР°.
                    let participantKey = null;
                    if (entry.dealt > 0) {
                        const keyChance = isLeader ? 1 : entry.share;
                        if (Math.random() < keyChance) {
                            participantKey = await grantNextBossKey(client, participantId, raid.boss_id);
                        }
                    }

                    if (participantId === playerId) {
                        rewards = {
                            coins: coinsReward,
                            experience: experienceReward,
                            items: grantedItems
                        };
                        if (participantKey) rewards.key = participantKey;
                        if (participantUndropped.length) rewards.undropped_items = participantUndropped;
                    }

                    if (entry.dealt > 0) {
                        masteryUpdates.push(participantId, raid.boss_id);
                        bossesKilledUpdates.push(participantId);
                    }

                    if (coinsReward > 0) {
                        coinUpdates.push(participantId, coinsReward);
                    }
                    if (experienceReward > 0) {
                        expUpdates.push(participantId, experienceReward);
                    }

                    const keyName = participantKey ? (participantKey.boss_name || null) : null;
                    raidRewardsRows.push(
                        raidId,
                        raid.boss_id,
                        participantId,
                        coinsReward,
                        experienceReward,
                        JSON.stringify(Array.isArray(grantedItems) ? grantedItems : []),
                        participantUndropped.length > 0 ? JSON.stringify(participantUndropped) : '[]',
                        keyName,
                        participantId === playerId
                    );

                    participantRewards.set(participantId, {
                        coins: coinsReward,
                        experience: experienceReward,
                        items: grantedItems,
                        key: participantKey || null
                    });
                }

                // Р‘Р°С‚С‡РѕРІС‹Р№ UPDATE РјРѕРЅРµС‚
                if (coinUpdates.length > 0) {
                    const numRows = coinUpdates.length / 2;
                    const values = Array.from({ length: numRows }, (_, i) =>
                        `($${i * 2 + 1}::bigint, $${i * 2 + 2}::integer)`
                    ).join(', ');
                    await client.query(
                        `UPDATE players p SET coins = p.coins + v.amount
                         FROM (VALUES ${values}) AS v(player_id, amount)
                         WHERE p.id = v.player_id`,
                        coinUpdates
                    );
                }

                // Р‘Р°С‚С‡РѕРІС‹Р№ UPDATE РѕРїС‹С‚Р° СѓР±СЂР°РЅ: РѕРїС‹С‚ РЅР°С‡РёСЃР»СЏРµС‚СЃСЏ С‡РµСЂРµР· playerHelper.addExperience
                // РЅРёР¶Рµ (РѕРЅ Р¶Рµ РґРµР»Р°РµС‚ level-up). Р Р°РЅСЊС€Рµ Р·РґРµСЃСЊ Р±С‹Р» РµС‰С‘ РѕРґРёРЅ +experience,
                // С‡С‚Рѕ РґР°РІР°Р»Рѕ РґРІРѕР№РЅРѕР№ СЃС‡С‘С‚.
                // Р›РѕРіРё РѕРїС‹С‚Р° вЂ” РїРѕ РѕРґРЅРѕРјСѓ РЅР° РёРіСЂРѕРєР° (РЅРµР»СЊР·СЏ Р±Р°С‚С‡РёС‚СЊ РёР·-Р·Р° СЂР°Р·РЅС‹С… logData)
                for (const entry of shares) {
                    const pid = entry.participantId;
                    const expReward = participantRewards.get(pid)?.experience || 0;
                    if (expReward > 0) {
                        const expResult = await playerHelper.addExperience(pid, expReward, client);
                        expLogs.push({ playerId: pid, logData: expResult.logData });
                    }
                }

                // РЎРѕР±С‹С‚РёР№РЅР°СЏ РїСЂРѕРІРµСЂРєР° РґРѕСЃС‚РёР¶РµРЅРёР№ РґР»СЏ РІСЃРµС… СѓС‡Р°СЃС‚РЅРёРєРѕРІ СЂРµР№РґР°
                for (const entry of shares) {
                    helpers.checkAchievements(entry.participantId, client).catch(() => {});
                }

                // Р‘Р°С‚С‡РѕРІС‹Р№ UPDATE bosses_killed Рё boss_mastery
                if (bossesKilledUpdates.length > 0) {

                    await client.query(
                        `UPDATE players SET bosses_killed = COALESCE(bosses_killed, 0) + 1
                         WHERE id = ANY($1::bigint[])`,
                        [bossesKilledUpdates]
                    );
                }
                if (masteryUpdates.length > 0) {
                    // masteryUpdates вЂ” РїР°СЂС‹ [playerId, bossId, playerId, bossId, ...]
                    const numRows = masteryUpdates.length / 2;
                    const values = Array.from({ length: numRows }, (_, i) =>
                        `($${i * 2 + 1}::bigint, $${i * 2 + 2}::bigint, 1, NOW())`
                    ).join(', ');
                    await client.query(
                        `INSERT INTO boss_mastery (player_id, boss_id, kills, last_killed_at)
                         VALUES ${values}
                         ON CONFLICT (player_id, boss_id)
                         DO UPDATE SET kills = boss_mastery.kills + 1, last_killed_at = NOW()`,
                        masteryUpdates
                    );
                }

                // Р‘Р°С‚С‡РѕРІС‹Р№ INSERT raid_rewards
                if (raidRewardsRows.length > 0) {
                    // raidRewardsRows СЃРѕРґРµСЂР¶РёС‚ РіСЂСѓРїРїС‹ РїРѕ 9 СЌР»РµРјРµРЅС‚РѕРІ РЅР° СѓС‡Р°СЃС‚РЅРёРєР°:
                    // [raidId, bossId, playerId, coins, exp, itemsJson, undroppedItemsJson, keyName, claimed]
                    // РџСЂРѕРІРµСЂСЏРµРј РєСЂР°С‚РЅРѕСЃС‚СЊ, С‡С‚РѕР±С‹ РЅРµ РѕР±СЂР°Р·РѕРІР°Р»РёСЃСЊ Р±РёС‚С‹Рµ РїР»РµР№СЃС…РѕР»РґРµСЂС‹ $n.
                    if (raidRewardsRows.length % 9 !== 0) {
                        logger.warn('[bosses] raidRewardsRows РґР»РёРЅР° РЅРµ РєСЂР°С‚РЅР° 9', {
                            length: raidRewardsRows.length
                        });
                        throw {
                            message: 'Р’РЅСѓС‚СЂРµРЅРЅСЏСЏ РѕС€РёР±РєР° С„РѕСЂРјРёСЂРѕРІР°РЅРёСЏ РЅР°РіСЂР°Рґ СЂРµР№РґР°',
                            code: 'INTERNAL_ERROR',
                            statusCode: 500
                        };
                    }
                    const numRows = raidRewardsRows.length / 9;
                    const values = Array.from({ length: numRows }, (_, i) =>
                        `($${i * 9 + 1}::bigint, $${i * 9 + 2}::bigint, $${i * 9 + 3}::bigint, $${i * 9 + 4}::integer, $${i * 9 + 5}::integer, $${i * 9 + 6}::jsonb, $${i * 9 + 7}::jsonb, $${i * 9 + 8}, $${i * 9 + 9}::boolean)`
                    ).join(', ');
                    await client.query(
                        `INSERT INTO raid_rewards
                         (raid_id, boss_id, player_id, coins, experience, items, undropped_items, key_item_name, claimed)
                         VALUES ${values}`,
                        raidRewardsRows
                    );
                }

                if (rewards && Array.isArray(rewards.items) && rewards.items.length === 0) {
                    delete rewards.items;
                }

                await clearActiveBattleForPlayers(client, participantIds, raidId);
                await client.query('DELETE FROM boss_sessions WHERE raid_id = $1', [raidId]);
                await client.query('DELETE FROM raid_progress WHERE id = $1', [raidId]);
            }

            return {
                status: 200,
                body: {
                    success: true,
                    data: {
                        raid: {
                            id: raidId,
                            hp: newHp,
                            max_hp: raid.max_health,
                            hp_percent: raid.max_health > 0 ? Math.round((newHp / raid.max_health) * 100) : 0
                        },
                        // РџР»РѕСЃРєРёРµ РїСЃРµРІРґРѕРЅРёРјС‹ вЂ” С‚Рµ Р¶Рµ РёРјРµРЅР°, С‡С‚Рѕ Сѓ СЃРѕР»Рѕ-СѓРґР°СЂР°
                        // (СЃРј. РѕС‚РІРµС‚ /attack-boss). РќСѓР¶РЅС‹ РѕР±С‰РµРјСѓ РѕР±СЂР°Р±РѕС‚С‡РёРєСѓ
                        // СЂРµР·СѓР»СЊС‚Р°С‚Р°: РєР»РёРµРЅС‚ Р±РѕР»СЊС€Рµ РЅРµ РґРѕР»Р¶РµРЅ СЂР°Р·Р»РёС‡Р°С‚СЊ РґРІРµ
                        // С„РѕСЂРјС‹ РѕС‚РІРµС‚Р°. РЎС‚Р°СЂС‹Рµ РІР»РѕР¶РµРЅРЅС‹Рµ РїРѕР»СЏ РѕСЃС‚Р°СЋС‚СЃСЏ.
                        boss_hp: newHp,
                        boss_max_hp: raid.max_health,
                        total_damage: Math.max(0, (raid.max_health || 0) - (newHp || 0)),
                        damage_dealt: damage,
                        boss_defeated: killed,
                        damage,
                        damage_taken: counterHit.damage,
                        health: counterHit.health,
                        broken_equipment: counterHit.broken_slots,
                        // РћС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ СЃР»РµРґСѓСЋС‰РµРіРѕ СѓРґР°СЂР° вЂ” РїРѕ СѓР¶Рµ СѓРјРµРЅСЊС€РµРЅРЅРѕРјСѓ
                        // HP Р±РѕСЃСЃР°, С‡С‚РѕР±С‹ РїРѕРґРїРёСЃСЊ РІ Р±РѕСЋ Р¶РёР»Р° РІРјРµСЃС‚Рµ СЃ Р±РѕР№РѕРј.
                        counter_damage: combat.calculateBossCounterDamage(
                            raidBoss,
                            parseEquipment(player.equipment),
                            { currentHealth: newHp, playerLevel: player.level }
                        ),
                        // РС‚РѕРіРѕРІР°СЏ Р·Р°С‰РёС‚Р°: СЌРєРёРїРёСЂРѕРІРєР° + 3 Р·Р° СѓСЂРѕРІРµРЅСЊ.
                        player_defense: equipmentRules.calculateDefenseTotal(parseEquipment(player.equipment))
                            + equipmentRules.calculateLevelDefense(player.level)
                            + (Number(setBonuses && setBonuses.defense) || 0),
                        player_energy: energyResult.rows[0]?.energy ?? player.energy,
                        last_energy_update: energyResult.rows[0]?.last_energy_update || null,
                        your_total_damage: newTotalDamage,
                        killed,
                        rewards
                    },
                }
            };
        });

        // Р›РѕРіРё РѕРїС‹С‚Р° вЂ” РїРѕСЃР»Рµ COMMIT, С‡С‚РѕР±С‹ timeout РІ Р»РѕРіРёСЂРѕРІР°РЅРёРё РЅРµ РѕС‚РєР°С‚С‹РІР°Р»
        // РЅР°С‡РёСЃР»РµРЅРЅС‹Рµ РЅР°РіСЂР°РґС‹ (logPlayerAction РёСЃРїРѕР»СЊР·СѓРµС‚ СЃРІРѕС‘ СЃРѕРµРґРёРЅРµРЅРёРµ РёР· РїСѓР»Р°).
        for (const { playerId: pid, logData } of expLogs) {
            await logPlayerAction(pid, logData.action, logData.data);
        }

        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        if (handleConnectionError(res, error)) return undefined;
        return handleError(res, error, 'mass_attack');
    }
});

module.exports = router;


