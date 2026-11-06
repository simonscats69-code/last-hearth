/**
 * РЎРѕСЃС‚РѕСЏРЅРёРµ РёРіСЂРѕРєР° (Р·РґРѕСЂРѕРІСЊРµ, РіРѕР»РѕРґ, СЂР°РґРёР°С†РёСЏ Рё С‚.Рґ.)
 */
const { transaction } = require('../../db/database');
const express = require('express');
const router = express.Router();
const { lockPlayer } = require('../../db/players');
const { DEBUFF_CONFIG, getDebuffTier, normalizeRadiationLevel, calculateRadiationDamage } = require('../../utils/gameConstants');
// РџРѕСЂРѕРі СѓСЂРѕРЅР° РѕС‚ Р·Р°СЂР°Р¶РµРЅРёСЏ Р±РѕР»СЊС€Рµ РЅРµ РЅСѓР¶РµРЅ Р·РґРµСЃСЊ: РЅРѕСЂРјР°Р»РёР·Р°С†РёСЏ СѓСЂРѕРІРЅСЏ Рё
// СЃР°РјР° С„РѕСЂРјСѓР»Р° СѓСЂРѕРЅР° С‚РµРїРµСЂСЊ РІ utils/gameConstants.js (debuffs.js СЃС‡РёС‚Р°РµС‚
// С‚РµРј Р¶Рµ РїСѓС‚РµРј) вЂ” СЂР°РЅСЊС€Рµ В«5В» Р±С‹Р»Рѕ РІРїРёСЃР°РЅРѕ Рё Р·РґРµСЃСЊ, Рё РІ debuffs.js.
const { handleError, logPlayerAction, unauthorized } = require('../../utils/serverApi');
const { parseRadiation } = require('../../utils/normalizePlayerJson');
const { setPlayerRadiation } = require('../../db/playerRepository');
async function runStatusCheck(client, playerId) {
    const p = await lockPlayer(playerId, client, 'health, radiation');

    if (!p) {
        throw { message: 'РРіСЂРѕРє РЅРµ РЅР°Р№РґРµРЅ', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
    }

    const radConfig = DEBUFF_CONFIG?.radiation || { damagePerLevel: 5, maxLevel: 10 };
    const now = new Date();

    let radiationLevel = normalizeRadiationLevel(p.radiation);
    const radiation = parseRadiation(p.radiation);
    if (radiation.expires_at) {
        const expiresAt = new Date(radiation.expires_at);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
            radiationLevel = 0;
            await setPlayerRadiation(playerId, { level: 0, expires_at: null, applied_at: null }, client, { jsonb: false });
        }
    }
    radiationLevel = Math.min(radiationLevel, radConfig.maxLevel || 10);

    const radDamage = calculateRadiationDamage(radiationLevel, radConfig.damagePerLevel);

    const totalDamage = radDamage;

    let newHealth = p.health;
    if (totalDamage > 0) {
        const result = await client.query(
            `UPDATE players
             SET health = GREATEST(0, COALESCE(health, 0) - $1),
                 updated_at = NOW()
             WHERE id = $2
             RETURNING health`,
            [totalDamage, playerId]
        );
        newHealth = result.rows[0]?.health ?? newHealth;
    }

    return {
        totalDamage,
        health: newHealth,
        effects: {
            radiation: radDamage
        },
        states: {
            radiation: getDebuffTier(radiationLevel),
            overall: getDebuffTier(radiationLevel)
        },
        radiationLevel
    };
}



/**
 * РџСЂРѕРІРµСЂРєР° СЃРѕСЃС‚РѕСЏРЅРёСЏ (РµР¶РµРґРЅРµРІРЅС‹Р№ СЌС„С„РµРєС‚)
 * POST /status/check в†’ POST /api/game/status/check
 * РџСѓС‚СЊ: /check (РІРЅСѓС‚СЂРё СЂРѕСѓС‚РµСЂР°)
 */
router.post('/check', async (req, res) => {
    try {
        const player = req.player;
        const playerId = player?.id;
        
        if (!playerId) {
            return unauthorized(res);
        }
        
        // РСЃРїРѕР»СЊР·СѓРµРј С‚СЂР°РЅР·Р°РєС†РёСЋ СЃ Р±Р»РѕРєРёСЂРѕРІРєРѕР№ СЃС‚СЂРѕРєРё
        const result = await transaction(async (client) => runStatusCheck(client, playerId));
        
        // Р›РѕРіРёСЂСѓРµРј РґРµР№СЃС‚РІРёРµ
        await logPlayerAction(playerId, 'status_check', {
            damage: result.totalDamage,
            effects: result.effects
        });
        
        res.json({
            success: true,
            checked: true,
            damage: result.totalDamage,
            health: result.health,
            effects: result.effects,
            states: result.states,
            message: result.radiationLevel > 0 ? 'РџРѕР»СѓС‡РµРЅРѕ СѓСЂРѕРЅР° РѕС‚ РґРµР±Р°С„С„РѕРІ!' : 'Р’СЃС‘ РІ РїРѕСЂСЏРґРєРµ'
        });
        
    } catch (error) {
        return handleError(res, error, 'STATUS_CHECK');
    }
});

module.exports = router;
