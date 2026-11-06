/**
 * API 4510DD>2 - A8AB5<0 C?@02;5=8O 4510DD0<8
 * 
 * $C=:F8>=0;:
 * - @8<5=5=85 4510DD>2 (@0480F8O, 8=D5:F88)
 * - @>25@:0 4510DD>2 ?> B09<5@C
 * - 5G5=85 4510DD>2 ?@54<5B0<8
 * -  0AGQB 2;8O=8O =0 AB0BK
 */

const express = require('express');
const router = express.Router();
const { transaction, queryOne } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
// logger @0=LH5 8A?>;L7>20;AO B>;L:> 2 C40;Q==KE HTTP-@>CB0E. H81:8 87
// DebuffAPI ;>28B 2K7K20NI89: world.js >B40QB 8E 2 handleError.
const { safeJsonParse, logPlayerAction, handleError, unauthorized, notFound } = require('../../utils/serverApi');

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
const { normalizeInventory, consumeInventoryItem } = helpers;
const {
    DEBUFF_TYPES,
    DEBUFF_CONFIG,
    DEBUFF_CURES,
    calculateDebuffModifiers,
    getDebuffTier,
    normalizeRadiationLevel,
    calculateRadiationDamage
} = require('../../utils/gameConstants');

function createDebuffError(message, code, statusCode = 400) {
    return { message, code, statusCode };
}



const DebuffAPI = {
    /**
     * @8<5=8BL 4510DD : 83@>:C
     * @param {number} playerId - ID 83@>:0
     * @param {string} type - B8? 4510DD0 (B>;L:> radiation  8=D5:F88 >1J548=5=K A =8<)
     * @param {number} level - C@>25=L 4510DD0
     * @param {object} options - 4>?>;=8B5;L=K5 >?F88 {source, client}
     *   client  2=5H=89 :;85=B B@0=70:F88; 5A;8 ?5@540=, =>20O B@0=70:F8O
     *   =5 >B:@K205BAO (70I8B0 >B 2;>65==KE 1;>:8@>2>: AB@>:8 83@>:0)
     */
    async apply(playerId, type, level, options = {}) {
        const config = DEBUFF_CONFIG[type];
        if (!config) {
            throw { message: `58725AB=K9 B8? 4510DD0: ${type}`, code: 'UNKNOWN_DEBUFF', statusCode: 400 };
        }

        // P2: C@>25=L ?@82>48< : :>=5G=><C G8A;C  0@8D<5B8:8.
        //
        // K;>: level = Math.min(config.maxLevel, Math.max(config.minLevel, level)).
        // @8 level = undefined/NaN/{} Math.min/Max c NaN 40NB NaN, 40;55
        // (level - 1) * durationPerLevel = NaN, expiresAt = Invalid Date,
        // 8 2 JSONB CE>48B expires_at: null  @0480F8O 28A8B 25G=>,
        // 0 8=D5:F8O 40QB 0 C@>=0 =02A5340.
        const numericLevel = Number(level);
        if (!Number.isFinite(numericLevel)) {
            throw { message: `5:>@@5:B=K9 C@>25=L 4510DD0: ${level}`, code: 'INVALID_DEBUFF_LEVEL', statusCode: 400 };
        }
        level = Math.min(config.maxLevel, Math.max(config.minLevel, numericLevel));

        const executor = async (client) => {
            // ;>:8@C5< AB@>:C 83@>:0 ?> 2=CB@5==5<C id
            const player = await lockPlayer(playerId, client, 'radiation');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const now = new Date();
            const baseDuration = config.baseDurationMs;
            const durationPerLevel = config.durationPerLevelMs;
            const expiresAt = new Date(now.getTime() + baseDuration + (level - 1) * durationPerLevel);
            
            if (type === DEBUFF_TYPES.RADIATION) {
                // @8<5=O5</C25;8G8205< @0480F8N
                const currentLevel = normalizeRadiationLevel(player.radiation);
                const newLevel = Math.min(config.maxLevel, currentLevel + Number(level || 0));
                
                await client.query(
                    `UPDATE players SET radiation = $1 WHERE id = $2`,
                    [JSON.stringify({
                        level: newLevel,
                        expires_at: expiresAt.toISOString(),
                        applied_at: now.toISOString()
                    }), playerId]
                );
                
                await logPlayerAction(playerId, 'debuff_radiation_apply', {
                    oldLevel: currentLevel,
                    newLevel,
                    source: options.source
                }, client);
                
                return { type, oldLevel: currentLevel, newLevel, expiresAt };
            }

            // 48=AB25==K9 B8? 4510DD0  @0480F8O. @56=OO 25B:0
            // DEBUFF_TYPES.INFECTION ?8A0;0 2 players.infections >B45;L=K<
            // <0AA82><; B5?5@L 7>=0 40QB >4=> 70@065=85 2 players.radiation.
            throw { message: `58725AB=K9 B8? 4510DD0: ${type}`, code: 'UNKNOWN_DEBUFF', statusCode: 400 };
        };

        if (options.client) {
            return executor(options.client);
        }

        return await transaction(executor);
    },
    
    /**
     * @>25@8BL 4510DDK 83@>:0 (>G8AB8BL 8ABQ:H85)
     * @param {number} playerId - ID 83@>:0
     * @returns {Promise<object>} AB0BCA 4510DD>2
     */
    async check(playerId) {
        return await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'radiation, health');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            const now = new Date();
            const expired = [];
            const active = [];
            const warnings = [];
            
            // @>25@O5< @0480F8N
            const radiation = safeJsonParse(player.radiation, { level: 0, expires_at: null, applied_at: null });
            const radiationLevel = normalizeRadiationLevel(radiation);
            if (radiationLevel > 0 && radiation.expires_at) {
                const expiresAt = new Date(radiation.expires_at);
                if (!Number.isFinite(expiresAt.getTime())) {
                    await client.query(`UPDATE players SET radiation = $1 WHERE id = $2`, [JSON.stringify({ level: 0, expires_at: null, applied_at: null }), playerId]);
                    expired.push('radiation');
                } else if (expiresAt <= now) {
                    // 510DD 8ABQ: ?> 2@5<5=8
                    await client.query(
                        `UPDATE players SET radiation = $1 WHERE id = $2`,
                        [JSON.stringify({ level: 0, expires_at: null, applied_at: null }), playerId]
                    );
                    expired.push('radiation');
                } else {
                    // AB5AB25==>5 70BCE0=85: A=8605< C@>25=L =0 1 :064K5 regenRateMs (30 <8=)
                    const config = DEBUFF_CONFIG.radiation;
                    const lastDecay = radiation.last_decay_at ? new Date(radiation.last_decay_at) : (radiation.applied_at ? new Date(radiation.applied_at) : now);
                    const elapsedMs = now - lastDecay;
                    const decaySteps = Math.floor(elapsedMs / config.regenRateMs);
                    
                    if (decaySteps > 0) {
                        const newLevel = Math.max(0, radiationLevel - decaySteps);
                        let newExpiresAt = null;
                        if (newLevel > 0) {
                            // !G8B05< expires_at >B 8AE>4=>3> applied_at, 0 =5 >B now,
                            // GB>1K 70BCE0=85 =5 ?@>4;520;> >1I89 A@>: 687=8 @0480F88.
                            const appliedAt = radiation.applied_at ? new Date(radiation.applied_at) : now;
                            const totalDurationMs = config.baseDurationMs + (newLevel - 1) * config.durationPerLevelMs;
                            const newExpires = new Date(appliedAt.getTime() + totalDurationMs);
                            newExpiresAt = newExpires.toISOString();
                        }
                        
                        await client.query(
                            `UPDATE players SET radiation = $1 WHERE id = $2`,
                            [JSON.stringify({
                                level: newLevel,
                                expires_at: newExpiresAt,
                                applied_at: radiation.applied_at,
                                last_decay_at: now.toISOString()
                            }), playerId]
                        );
                        radiation.level = newLevel;
                        radiation.expires_at = newExpiresAt;
                    }
                    
                    if (radiation.level > 0) {
                        active.push({ type: 'radiation', level: radiation.level, expiresAt: radiation.expires_at });
                        
                        // @54C?@5645=85 5A;8 >AB0;>AL <5=55 30 <8=CB
                        const timeLeft = new Date(radiation.expires_at) - now;
                        if (timeLeft < 30 * 60 * 1000) {
                            warnings.push('radiation_expiring');
                        }
                    } else {
                        expired.push('radiation');
                    }
                }
            }
            
            // @>25@O5< 70@065=85: 548=AB25==K9 4510DD  @0480F8O.
            // @56=89 1;>: ?@>25@:8 players.infections (<0AA82 A expires_at
            // ?> :064><C M;5<5=BC) C40;Q= 2<5AB5 A 8=D5:F8O<8.
            
            //  0AGQB C@>=0 >B 4510DD0.
            // P2: this.calculateDebuffDamage(...) ;><0;AO ?@8 45AB@C:BC@870F88
            // (`const { apply } = require('./debuffs').DebuffAPI`)  this B5@O;AO
            // 8 <5B>4 1K; =54>ABC?5=. K7K205< G5@57 DebuffAPI O2=>.
            const totalDamage = DebuffAPI.calculateDebuffDamage(active);
            if (totalDamage > 0) {
                await client.query(
                    `UPDATE players SET health = GREATEST(0, COALESCE(health,0) - $1) WHERE id = $2`,
                    [totalDamage, playerId]
                );
            }
            
            return { expired, active, warnings, damage: totalDamage };
        });
    },
    
    /**
     *  0AAG8B0BL C@>= >B 4510DD>2
     *
     * 48=AB25==K9 4510DD  @0480F8O. #@>= =0G8=05BAO A 5 C@>2=O:
     * (level - 4) * damagePerLevel. @56=OO 25B:0 8=D5:F88 (10% H0=A �
     * C@>25=L � 2) C40;5=0 2<5AB5 A infection: ?>@>3 8 :>MDD8F85=B
     * 70E0@4:>6820;8AL 2 42CE <5AB0E AB0BCA0 8 745AL.
     *
     * @param {Array} activeDebuffs - <0AA82 0:B82=KE 4510DD>2
     * @returns {number} AC<<0@=K9 C@>=
     */
    calculateDebuffDamage(activeDebuffs) {
        if (!activeDebuffs) return 0;
        let damage = 0;
        const now = new Date();
        
        for (const debuff of activeDebuffs) {
            if (!debuff.expiresAt) continue;
            
            const expiresAt = new Date(debuff.expiresAt);
            if (!Number.isFinite(expiresAt.getTime())) continue;

            // 510DD 8ABQ: - ?@>?CA:05< (C@>= =5 =0=>A8BAO)
            if (expiresAt <= now) continue;
            
            if (debuff.type !== DEBUFF_TYPES.RADIATION) continue;

            const config = DEBUFF_CONFIG.radiation;
            if (!config) continue;

            // $>@<C;0 8 ?>@>3 C@>=0  B0 65, GB> 2 status.js /check:
            // >15 2K=5A5=K 2 utils/gameConstants.js calculateRadiationDamage.
            damage += calculateRadiationDamage(debuff.level, config.damagePerLevel);
        }
        
        return Math.floor(damage);
    },
    
    /**
     * >;CG8BL 0:B82=K5 4510DDK 83@>:0
     *
     * ">;L:> @0480F8O: 8=D5:F88 >1J548=5=K A =59.
     */
    getActive(player) {
        if (!player) return [];
        // ">B 65 ?0@A5@, GB> 8 2 status.js /check: B@8 D>@<0B0 E@0=5=8O
        // @0480F88 (>1J5:B/G8A;>/AB@>:0-JSON) 682CB 2 >4=>9 DC=:F88
        // utils/gameConstants.js.
        const radiationObj = typeof player.radiation === 'object' && player.radiation !== null
            ? player.radiation
            : safeJsonParse(player.radiation, {});
        const level = normalizeRadiationLevel(player.radiation);

        const active = [];

        if (level > 0) {
            active.push({
                type: DEBUFF_TYPES.RADIATION,
                level,
                expiresAt: radiationObj.expires_at || null,
                severity: getDebuffTier(level),
                name: ' 0480F8O',
                icon: '"'
            });
        }
        
        return active;
    },
    
    /**
     * 5G8BL 4510DD ?@54<5B><
     */
    async cure(playerId, cureType, itemId, itemIndex = null, options = {}) {
        const consumeItem = options.consumeItem !== false;
        const externalClient = options.client || null;

        const executor = async (client) => {
            // >;CG05< 83@>:0 8 8=25=B0@L
            const player = await lockPlayer(playerId, client, 'radiation, inventory');

            if (!player) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            
            // I5< ?@54<5B 2 8=25=B0@5
            const inventory = normalizeInventory(player.inventory);
            const resolvedItemIndex = Number.isInteger(itemIndex)
                ? itemIndex
                : inventory.findIndex(i => Number(i?.id) === Number(itemId));
            
            if (resolvedItemIndex < 0 || resolvedItemIndex >= inventory.length) {
                throw createDebuffError('@54<5B =5 =0945= 2 8=25=B0@5', 'ITEM_NOT_FOUND', 404);
            }
            
            const item = inventory[resolvedItemIndex];
            const itemStats = safeJsonParse(item.stats, item.stats && typeof item.stats === 'object' ? item.stats : {}) || {};

            let resolvedCureType = cureType;
            let cure = DEBUFF_CURES[resolvedCureType] || null;

            // 2B>-@568< ?>418@05B A8;C ;5G5=8O 87 @50;L=>3> ?@54<5B0,
            // GB>1K =5 702KH0BL MDD5:B ?@8 ?@54<5B0E A> A;01K<8 AB0B0<8.
            //
            // 48= 8AB>G=8: A8;K ;5G5=8O: contamination_cure (radiation_cure /
            // rad_removal). @56=OO ?0@0 radiationReduction /
            // infectionReduction A:;55=0 2 >4=>, ?>MB><C =B84>B 8 2AQ
            // >AB0;L=>5 ;5G8B @0480F8N >48=0:>2>.
            if (!cure && (resolvedCureType === 'auto' || resolvedCureType === 'debuff')) {
                resolvedCureType = 'auto';
                cure = {
                    contaminationReduction: Number(itemStats.radiation_cure || item.rad_removal || 0)
                };
            }

            if (!cure) {
                throw createDebuffError(`58725AB=K9 B8? ;5G5=8O: ${cureType}`, 'INVALID_TYPE', 400);
            }

            // >@<0;87C5< ?>;5: C auto-@568<0 contaminationReduction,
            // C B01;8FK DEBUFF_CURES  radiationReduction.
            const curePower = Number(
                cure.contaminationReduction !== undefined
                    ? cure.contaminationReduction
                    : cure.radiationReduction
            ) || 0;
            
            // @>25@O5<, GB> ?@54<5B ?>4E>48B 4;O ;5G5=8O
            const itemPower = Number(itemStats.radiation_cure || item.rad_removal || 0);
            if (!(curePower > 0) || !(itemPower > 0)) {
                throw createDebuffError('-B>B ?@54<5B =5 ;5G8B 4510DDK', 'INVALID_ITEM_TYPE', 400);
            }
            
            const radiation = safeJsonParse(player.radiation, { level: 0 });
            const radiationLevel = normalizeRadiationLevel(radiation);

            // @>25@O5<, GB> 5ABL 0:B82=K9 4510DD 4;O ;5G5=8O  ;N1>9 <CB0F88
            if (radiationLevel <= 0) {
                throw { message: ':B82=KE 4510DD>2 4;O ;5G5=8O =5 =0945=>', code: 'NO_ACTIVE_DEBUFF', statusCode: 400 };
            }

            // 5G8< 70@065=85: A=8605< C@>25=L 8 ?@>?>@F8>=0;L=> C:>@0G8205<
            // A@>: 459AB28O. 48= 1;>: 2<5AB> ?@56=8E �;5G8< @0480F8N� 8
            // �;5G8< 8=D5:F88�.
            {
                const effectiveCure = Math.min(curePower, itemPower);
                const newLevel = Math.max(0, radiationLevel - effectiveCure);

                // 5@5AG8BK205< 2@5<O 8AB5G5=8O
                let newExpiresAt = null;
                if (newLevel > 0 && radiation.expires_at && radiationLevel > 0) {
                    const oldExpires = new Date(radiation.expires_at);
                    const now = new Date();
                    if (Number.isFinite(oldExpires.getTime())) {
                        // 0I8B0 >B 45;5=8O =0 =>;L: 8A?>;L7C5< Math.max(1, ...) 4;O C@>2=O
                        const safeLevel = Math.max(1, radiationLevel);
                        const reductionRatio = effectiveCure / safeLevel;
                        const reduction = (oldExpires.getTime() - now.getTime()) * reductionRatio;
                        newExpiresAt = new Date(Math.max(now.getTime(), oldExpires.getTime() - reduction)).toISOString();
                    }
                }
                
                await client.query(
                    `UPDATE players SET radiation = $1 WHERE id = $2`,
                    [JSON.stringify({
                        level: newLevel,
                        expires_at: newExpiresAt,
                        applied_at: radiation.applied_at
                    }), playerId]
                );
                
                await logPlayerAction(playerId, 'debuff_cure_radiation', {
                    cureType: resolvedCureType,
                    oldLevel: radiationLevel,
                    newLevel
                }, client);
            }

            if (consumeItem) {
                const { updatedInventory, quantityLeft } = consumeInventoryItem(inventory, resolvedItemIndex);

                await client.query(
                    `UPDATE players SET inventory = $1 WHERE id = $2`,
                    [JSON.stringify(updatedInventory), playerId]
                );

                return {
                    success: true,
                    cured: resolvedCureType,
                    itemUsed: item.name,
                    quantityLeft: quantityLeft
                };
            }
            
            return {
                success: true,
                cured: resolvedCureType,
                itemUsed: item.name
            };
        };

        if (externalClient) {
            return executor(externalClient);
        }

        return await transaction(executor);
    },
    
    /**
     *  0AAG8B0BL <>48D8:0B>@K 4;O 83@>:0
     */
    getModifiers(player) {
        return calculateDebuffModifiers(player);
    }
};

// ============================================
// HTTP- ( #"+ $$
// ============================================

/**
 * POST /debuffs/apply  ?@8<5=8BL 4510DD : 83@>:C (@0480F8O)
 * "5;>: { type, level, source }
 */
router.post('/apply', async (req, res) => {
    const playerId = req.player?.id;
    const { type, level, source } = req.body || {};
    try {
        if (!playerId) {
            return unauthorized(res, '5 02B>@87>20=');
        }
        const result = await DebuffAPI.apply(playerId, type || DEBUFF_TYPES.RADIATION, Number(level) || 1, { source });
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_apply', playerId);
    }
});

/**
 * POST /debuffs/check  ?@>25@8BL 4510DDK 83@>:0 (>G8AB8BL 8ABQ:H85, ?@8<5=8BL C@>=)
 * CB8@CNI89 <0@H@CB: <>65B ?@8<5=8BL C@>=, ?>MB><C B@51C5B Idempotency-Key.
 */
router.post('/check', async (req, res) => {
    const playerId = req.player?.id;
    try {
        if (!playerId) {
            return unauthorized(res, '5 02B>@87>20=');
        }
        const result = await DebuffAPI.check(playerId);
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_check', playerId);
    }
});

/**
 * GET /debuffs/active  ?>;CG8BL 0:B82=K5 4510DDK 83@>:0
 */
router.get('/active', async (req, res) => {
    const playerId = req.player?.id;
    try {
        if (!playerId) {
            return unauthorized(res, '5 02B>@87>20=');
        }
        const playerResult = await queryOne('SELECT radiation FROM players WHERE id = $1', [playerId]);
        if (!playerResult) {
            return notFound(res, '3@>: =5 =0945=', 'PLAYER_NOT_FOUND');
        }
        const active = DebuffAPI.getActive(playerResult);
        return res.json({ success: true, data: { active } });
    } catch (error) {
        return handleError(res, error, 'debuff_active', playerId);
    }
});

/**
 * POST /debuffs/cure  2K;5G8BL 4510DD ?@54<5B><
 * "5;>: { cureType, itemId, itemIndex }
 */
router.post('/cure', async (req, res) => {
    const playerId = req.player?.id;
    const { cureType, itemId, itemIndex } = req.body || {};
    try {
        if (!playerId) {
            return unauthorized(res, '5 02B>@87>20=');
        }
        const result = await DebuffAPI.cure(playerId, cureType || 'auto', itemId, itemIndex);
        return res.json({ success: true, data: result });
    } catch (error) {
        return handleError(res, error, 'debuff_cure', playerId);
    }
});

// -:A?>@B: DebuffAPI 4;O 2=CB@5==8E <>4C;59, router 4;O ?>4:;NG5=8O 2 index.js
module.exports = { DebuffAPI, router };
