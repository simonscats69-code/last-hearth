/**
 * PvP (production-ready 25@A8O)
 * 
 * #;CGH5=8O:
 * - "@0=70:F88 A SELECT FOR UPDATE 4;O 0B><0@=>AB8
 * - 0;840F8O 2E>4=KE 40==KE (ID)
 * - >38@>20=85 459AB289 2 player_logs
 * - 48=K9 D>@<0B >B25B>2 { success, data/error, code }
 * - 038=0F8O 4;O A?8A:0 83@>:>2
 * - Namespace: GamePVP
 * - &5=B@0;87>20==K9 >1@01>BG8: >H81>:
 */

const express = require('express');
const router = express.Router();
const { queryOne, queryAll, transaction } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const pvp = require('../../db/pvp');
const crypto = require('crypto');
const {
    logger,
    logPlayerAction,
    logPlayerError,
    handleError: apiHandleError,
    // !5@80;870F8O 8=25=B0@O ?@8 :@065 ?@54<5B>2 2 1>N.
    safeStringify,
    unauthorized,
    PlayerHelper: playerHelper
} = require('../../utils/serverApi');

// 5=820O 703@C7:0 helpers: utils/game-helpers.js  548=AB25==K9 8AB>G=8:
// DC=:F89 A>AB>O=8O 83@>:0. = BO=5B db/database, ?>MB><C 8<?>@B ;5=82K9
// (8=0G5 F8:; 703@C7:8 <>4C;59). 1I89 703@C7G8:  utils/getGameHelpers.js.
const { getGameHelpers } = require('../../utils/getGameHelpers');
const { setPlayerEquipment } = require('../../db/playerRepository');

// -:A?>@B8@C5<K5 DC=:F88 G5@57 getGameHelpers()
const helpers = getGameHelpers();
const { getActiveBuffs, normalizeInventory, recalcEnergy, normalizeEquipment, getSetBonuses, wearEquipmentSlots, addItemToInventory, trackCollectedItems } = helpers;
// 0;840F8O ID  >1I0O, A<. utils/validate.js.
const { validateId } = require('../../utils/validate');
// $09; ?@028; ?@54<5B>2 8<?>@B8@C5BAO >48= @07: 1@0BL 53> 8 ?> 8<5=8
// <>4C;O, 8 ?> ?CB8 2 42CE <5AB0E =5 =C6=>  ?@8 2B>@>< 8<?>@B5 ;53:>
// ?>;CG8BL 4@C3>9 =01>@ :>=AB0=B, G5< >6840; 02B>@.
// MAX_INVENTORY_SLOTS  8=0G5 :@060 ?@54<5B0 <>3;0 2K40BL 101-9 A;>B
// 8=25=B0@O 8 701;>:8@>20BL 4>1KGC. equipmentRules >B25G05B 8 70 пїЅA=0@O65=85
// ;8 MB>пїЅ  >B MB>3> 7028A8B, :@04CB ;8 ?@54<5B F5;8:>< 8;8 >4=C HBC:C.
const equipmentRules = require('../../public/shared/equipment.js');
const MAX_INVENTORY_SLOTS = equipmentRules.MAX_INVENTORY_SLOTS;

/**
 * H81:8 PvP.
 * 
 * 064>5 ?@028;> 1@>A05B >1J5:B A O2=K<8 code 8 statusCode.
 * handleError 87 serverApi G8B05B 8E =0?@O<CN.
 */
const PvpError = {
    BANNED:            { message: '3@>: 701;>:8@>20=', code: 'BANNED', statusCode: 403 },
    NOT_RED_ZONE:      { message: 'PvP 4>ABC?=> B>;L:> =0 :@0A=KE 7>=0E', code: 'NOT_RED_ZONE',      statusCode: 400 },
    NOT_SAME_LOCATION: { message: '3@>: =5 =0 MB>9 ;>:0F88',       code: 'NOT_SAME_LOCATION', statusCode: 400 },
    TARGET_DEAD:       { message: '@>B82=8: C65 <5@B2',           code: 'PLAYER_DEAD',       statusCode: 400 },
    SELF_DEAD:         { message: 'K <5@B2K 8 =5 <>65B5 0B0:>20BL', code: 'PLAYER_DEAD',      statusCode: 400 },
    LEVEL_TOO_LOW:     { message: '3@>:8 =865 5 C@>2=O =5 <>3CB CG0AB2>20BL 2 PvP', code: 'PVP_LEVEL_TOO_LOW', statusCode: 400 },
    TARGET_PROTECTED:  { message: '&5;L 70I8I5=0 >B PvP 4> 5 C@>2=O', code: 'TARGET_PROTECTED', statusCode: 400 },
    COOLDOWN:          { message: '>4>648B5 ?5@54 A;54CNI8< PvP 1>5<', code: 'ATTACK_COOLDOWN', statusCode: 429 },
    TARGET_COOLDOWN:   { message: '@>B82=8: 2@5<5==> 70I8IQ= >B PvP', code: 'TARGET_COOLDOWN',   statusCode: 429 },
    RATE_LIMIT:        { message: '5;L7O 0B0:>20BL MBC F5;L A;8H:>< G0AB>', code: 'ATTACK_COOLDOWN', statusCode: 429 },
    TARGET_FARMED:     { message: '8<8B 0B0: =0 MB>3> 83@>:0 8AG5@?0= (<0:A. 5 2 G0A)', code: 'TARGET_FARMED', statusCode: 429 },
    ALREADY_IN_BATTLE: { message: '48= 87 83@>:>2 C65 =0E>48BAO 2 0:B82=>< PvP 1>N', code: 'ALREADY_IN_BATTLE', statusCode: 409 },
    INSUFFICIENT_ENERGY: { message: '54>AB0B>G=> M=5@388 4;O 0B0:8', code: 'INSUFFICIENT_ENERGY', statusCode: 400 },
    INSUFFICIENT_ENERGY_HIT: { message: '54>AB0B>G=> M=5@388 4;O C40@0', code: 'INSUFFICIENT_ENERGY', statusCode: 400 },
    BATTLE_NOT_FOUND:  { message: '>9 =5 =0945=',                   code: 'BATTLE_NOT_FOUND',   statusCode: 404 },
    PLAYER_NOT_FOUND:  { message: '3@>: =5 =0945=',                 code: 'PLAYER_NOT_FOUND',   statusCode: 404 },
    BATTLE_FINISHED:   { message: '>9 C65 7025@HQ=',                code: 'BATTLE_FINISHED',    statusCode: 409 },
    NOT_PARTICIPANT:   { message: 'K =5 CG0AB=8: MB>3> 1>O',       code: 'NOT_PARTICIPANT',    statusCode: 403 },
    INVALID_INPUT:     { message: '5:>@@5:B=K5 40==K5 70?@>A0',    code: 'VALIDATION_ERROR',   statusCode: 400 }
};

/**
 * @>A8BL 83@>2CN >H81:C PvP A O2=K< :>4><.
 * @param {object} spec M;5<5=B PvpError
 * @throws {object} { message, code, statusCode }
 */
function throwPvpError(spec) {
    throw { message: spec.message, code: spec.code, statusCode: spec.statusCode };
}

/**
 * B25B >1 >H81:5 PvP.
 *
 * 1@01>B:0 :>4>2 8 AB0BCA>2 B5?5@L >1I0O (handleError 87 serverApi):
 * >= 15@QB code 8 statusCode 87 2K1@>H5==>3> >1J5:B0. >:0;L=0O :>?8O
 * @0718@0;0 B5:AB A>>1I5=8O ?> ?>4AB@>:0<, 87-70 G53> >1KG=>5 83@>2>5
 * >3@0=8G5=85 (пїЅ3@>:8 =865 5 C@>2=O...пїЅ) CE>48;> :;85=BC :0:
 * INTERNAL_ERROR A HTTP 500 8 B5:AB>< пїЅ=CB@5==OO >H81:0 A5@25@0пїЅ.
 *
 * !>E@0=5=0 B>;L:> B0 G0ABL, :>B>@>9 =5B 2 >1I5< >1@01>BG8:5: 70?8AL
 * >H81:8 2 ;>3 :>=:@5B=>3> 83@>:0.
 *
 * @param {object} res >B25B express
 * @param {Error|object} error >H81:0
 * @param {string} action 8<O >?5@0F88 4;O ;>3>2
 * @param {number} [playerId] ID 83@>:0
 */
const handleError = (res, error, action, playerId) => {
    if (playerId) {
        logPlayerError(playerId, error, { action });
    } else {
        logger.error(`[PVP] ${action}: ${error.message}`, { stack: error.stack });
    }

    return apiHandleError(res, error, action);
};

/**
 * #A?5H=K9 >B25B PvP.
 *
 * $>@<0B 745AL ?;>A:89  { success: true, ...40==K5 }, 0 =5 >1I89
 * { success: true, data }. ;85=B G8B05B >10: `result?.data || result`.
 * AB02;5=> :0: 5ABL, GB>1K >B25BK PvP =5 ?>5E0;8 2<5AB5 A >1I8<
 * 87<5=5=85<  MB> >B45;L=0O 7040G0 =0 25AL ?@>5:B, 345 C endpoints
 * @07=K5 D>@<K (A<. B0:65 ok() 2 db 8 <0@H@CBK).
 *
 * @param {object} res >B25B express
 * @param {object} [data] 40==K5 >B25B0
 */
const ok = (res, data = {}) => res.json({ success: true, data });

/**
 * H81:0 :;85=BA:>3> 70?@>A0 PvP (4xx).
 * $>@<0 >B25B0 A>2?0405B A >1I59 fail() 87 serverApi.
 *
 * @param {object} res >B25B express
 * @param {string} message B5:AB >H81:8
 * @param {string} [code] :>4 >H81:8
 * @param {number} [statusCode] HTTP-AB0BCA
 */
const fail = (res, message, code = 'ERROR', statusCode = 400) =>
    res.status(statusCode).json({ success: false, error: message, code });



/**
 * >;CG5=85 A?8A:0 83@>:>2 4;O PvP A ?038=0F859
 * GET /pvp/players?limit=20&offset=0 пїЅ GET /api/game/pvp/players
 * CBL: /players (2=CB@8 @>CB5@0)
 */
router.get('/players', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    if (!playerId) return unauthorized(res);
    
    try {
        // 038=0F8O
        let limit = parseInt(req.query.limit, 10) || 20;
        let offset = parseInt(req.query.offset, 10) || 0;
        
        limit = Math.min(Math.max(1, limit), 100);
        offset = Math.max(0, offset);

        // @>25@O5<, GB> 83@>: =0 :@0A=>9 7>=5
        const location = await queryOne(`
            SELECT danger_level FROM locations WHERE id = $1
        `, [player.current_location_id]);
        
        if (!location || Number(location.danger_level || 0) < 6) {
            return ok(res, {
                available: false,
                message: 'PvP 4>ABC?=> B>;L:> =0 :@0A=KE 7>=0E'
            });
        }

        // >;CG05< 83@>:>2 =0 B>9 65 ;>:0F88 A ?038=0F859.
        // $8;LB@K B5 65, GB> 8 2 ?@>25@:5 0B0:8 (/attack): banned 8A:;NG05B
        // 7010=5==KE (8=0G5 >=8 284=K :0: F5;8, E>BO 0B0:>20BL 8E =5;L7O),
        // health > 0  <Q@B2K9 ?@>B82=8: 2AQ @02=> >B:;>=O5BAO 2 /attack
        // (пїЅ@>B82=8: C65 <5@B2пїЅ), B> 5ABL MB> 1K; :;8: 2 =8:C40.
        //
        // COUNT(*) OVER() AG8B05B >1I55 G8A;> ?>4E>4OI8E AB@>: 2 B>< 65
        // ?@>E>45 2K1>@:8: @0=LH5 total ?@8E>48;>AL AG8B0BL >B45;L=K<
        // 70?@>A>< A B5< 65 WHERE  420 ?@>E>40 ?> players =0 :064K9
        // @5=45@ A?8A:0 ?>B5=F80;L=KE F5;59.
        // : queryAll() 2>72@0I05B <0AA82 AB@>:, 0 =5 { rows }.
        const resultRows = await queryAll(`
            SELECT id, username, first_name, level,
                   health, max_health, strength, endurance, agility,
                   pvp_wins, pvp_rating, pvp_streak,
                   COUNT(*) OVER() AS total_count
            FROM players
             WHERE current_location_id = $1 AND id != $2
               AND banned = false AND health > 0
             ORDER BY id
             LIMIT $3 OFFSET $4
         `, [player.current_location_id, playerId, limit, offset]);

        // total >48=0:>2 4;O 2A5E AB@>:; 5A;8 AB@>: =5B, total = 0
        const total = resultRows.length > 0
            ? parseInt(resultRows[0].total_count || 0, 10)
            : 0;

        // #18@05< A;C651=>5 ?>;5 87 >B25B0 :;85=BC
        const players = resultRows.map(({ total_count, ...playerRow }) => playerRow);

        // >38@C5<
        await logPlayerAction(playerId, 'pvp_view_players', {
            location_id: player.current_location_id,
            limit,
            offset,
            total
        });

        ok(res, {
            available: true,
            players: players,
            pagination: {
                limit,
                offset,
                total
            }
        });

    } catch (error) {
        return handleError(res, error, 'pvp_view_players', playerId);
    }
});

/**
 * 0G0;> PvP 0B0:8 (A B@0=70:F859)
 * POST /pvp/attack пїЅ POST /api/game/pvp/attack
 * CBL: /attack (2=CB@8 @>CB5@0)
 */
router.post('/attack', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    if (!playerId) return unauthorized(res);

    try {
        // 0;840F8O 2E>4=KE 40==KE
        if (!req.body || typeof req.body !== 'object') {
            return fail(res, '5:>@@5:B=>5 B5;> 70?@>A0', 'INVALID_REQUEST_BODY', 400);
        }

        const { target_id } = req.body;

        // 1I0O 20;840F8O ID (utils/validate.js). >72@0I05B =>@<0;87>20==>5
        // G8A;>, ?>MB><C id, ?@8H54H89 AB@>:>9 87 JSON, B>65 20;845=.
        const targetIdCheck = validateId(target_id, 'ID F5;8');
        if (!targetIdCheck.ok) {
            return fail(res, '#:068B5 :>@@5:B=K9 ID F5;8 (G8A;> > 0)', 'INVALID_TARGET_ID');
        }
        const targetId = targetIdCheck.value;

        if (targetId === playerId) {
            return fail(res, '5;L7O 0B0:>20BL A0<>3> A51O', 'SELF_TARGET');
        }

        // K?>;=O5< 0B0:C 2 B@0=70:F88 A 1;>:8@>2:>9 >1>8E 83@>:>2.
        //  57C;LB0B A>45@68B 40==K5 >B25B0 8 ;>3: ;>3 CE>48B ?>A;5 COMMIT.
        const outcome = await transaction(async (client) => {
            // ;>:8@C5< >1>8E 83@>:>2 2 ?>@O4:5 2>7@0AB0=8O ID 4;O ?@54>B2@0I5=8O deadlock
            // !@02=820NBAO =>@<0;87>20==K5 G8A;0 (targetId), 0 =5 AB@>:8 87
            // B5;0 70?@>A0: ?>@O4>: =C65= 4;O 548=>3> ?>@O4:0 1;>:8@>2>:.
            const [firstId, secondId] = playerId < targetId
                ? [playerId, targetId]
                : [targetId, playerId];
            
            const firstPlayer = await lockPlayer(firstId, client);
            const secondPlayer = await lockPlayer(secondId, client);

            if (!firstPlayer || !secondPlayer) {
                throwPvpError(PvpError.PLAYER_NOT_FOUND);
            }

            const lockedPlayer = firstId === playerId ? firstPlayer : secondPlayer;
            const targetPlayer = firstId === targetId ? firstPlayer : secondPlayer;

            // @>25@O5< :@0A=CN 7>=C
            const location = await client.query(`
                SELECT danger_level FROM locations WHERE id = $1
            `, [lockedPlayer.current_location_id]);

            if (!location.rows[0] || Number(location.rows[0].danger_level || 0) < 6) {
                throwPvpError(PvpError.NOT_RED_ZONE);
            }

            if (targetPlayer.current_location_id !== lockedPlayer.current_location_id) {
                throwPvpError(PvpError.NOT_SAME_LOCATION);
            }

            if (Number(targetPlayer.health || 0) <= 0) {
                throwPvpError(PvpError.TARGET_DEAD);
            }
            if (Number(lockedPlayer.health || 0) <= 0) {
                throwPvpError(PvpError.SELF_DEAD);
            }
            if (lockedPlayer.banned) {
                throwPvpError(PvpError.BANNED);
            }
            if (targetPlayer.banned) {
                throwPvpError(PvpError.BANNED);
            }

            const attackerProtected = await pvp.isProtectedFromPVP(playerId, client);
            if (attackerProtected) {
                throwPvpError(PvpError.LEVEL_TOO_LOW);
            }

            const targetProtected = await pvp.isProtectedFromPVP(targetId, client);
            if (targetProtected) {
                throwPvpError(PvpError.TARGET_PROTECTED);
            }

            // 1J548=Q==K9 70?@>A 2A5E :C;40C=>2 4;O >1>8E 83@>:>2 (2<5AB> 3-E >B45;L=KE)
            const cooldownResults = await client.query(
                `SELECT player_id, cooldown_type, expires_at
                 FROM pvp_cooldowns
                 WHERE player_id IN ($1, $2)
                   AND cooldown_type IN ('pvp_battle', $3)
                   AND expires_at > NOW()`,
                [playerId, targetId, `pvp_target_${targetId}`]
            );

            const cooldownsByPlayer = {};
            for (const row of cooldownResults.rows) {
                if (!cooldownsByPlayer[row.player_id]) cooldownsByPlayer[row.player_id] = {};
                cooldownsByPlayer[row.player_id][row.cooldown_type] = row.expires_at;
            }

            if (cooldownsByPlayer[playerId]?.['pvp_battle']) {
                throwPvpError(PvpError.COOLDOWN);
            }
            if (cooldownsByPlayer[targetId]?.['pvp_battle']) {
                throwPvpError(PvpError.TARGET_COOLDOWN);
            }
            if (cooldownsByPlayer[playerId]?.[`pvp_target_${targetId}`]) {
                throwPvpError(PvpError.RATE_LIMIT);
            }

            // P1-8: 8<8B 0B0: =0 >4=C ?0@C 83@>:>2 2 G0A (70I8B0 >B D0@<0)
            const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const recentAttacksResult = await client.query(
                `SELECT COUNT(*) as cnt FROM pvp_battles
                 WHERE ((attacker_id = $1 AND defender_id = $2) OR (attacker_id = $2 AND defender_id = $1))
                   AND started_at > $3`,
                [playerId, targetId, hourAgo]
            );
            const recentAttacks = Number(recentAttacksResult.rows[0]?.cnt || 0);
            const MAX_ATTACKS_PER_HOUR = 5;
            if (recentAttacks >= MAX_ATTACKS_PER_HOUR) {
                throwPvpError(PvpError.TARGET_FARMED);
            }

            const existingBattleResult = await client.query(
                `SELECT id, attacker_id, defender_id
                 FROM pvp_battles
                 WHERE status = 'active'
                   AND (attacker_id = $1 OR defender_id = $1 OR attacker_id = $2 OR defender_id = $2)
                 ORDER BY id ASC
                 LIMIT 1
                 FOR UPDATE`,
                [playerId, targetId]
            );

            if (existingBattleResult.rows[0]) {
                throwPvpError(PvpError.ALREADY_IN_BATTLE);
            }

            // P0-1: ?5@5AG8BK205< M=5@38N ?> @50;L=><C 2@5<5=8   ?@>25@:>9
            await recalcEnergy(client, lockedPlayer);

            const startBuffs = getActiveBuffs(lockedPlayer.buffs);

            // @>25@O5< =0;8G85 M=5@388  A?8A0=8O
            if (!startBuffs.free_energy && Number(lockedPlayer.energy || 0) < 1) {
                throwPvpError(PvpError.INSUFFICIENT_ENERGY);
            }

            //  (: 5A;8 C 0B0:CNI53> 5ABL ?@02> =0 @520=H ?@>B82 F5;8,
            // ?@8<5=O5< 1>=CA : C@>=C 8 30A8< ?@02> (>48= @07 =0 ?>@065=85).
            let damageBonus = 0;
            const revancheCheck = await client.query(
                `SELECT revanche_bonus FROM players WHERE id = $1 AND revanche_against = $2
                 AND revanche_expires_at > NOW()`,
                [playerId, targetId]
            );
            if (revancheCheck.rows[0]) {
                damageBonus = Number(revancheCheck.rows[0].revanche_bonus || 25);
                await client.query(
                    `UPDATE players SET revanche_against = NULL, revanche_expires_at = NULL, revanche_bonus = 25 WHERE id = $1`,
                    [playerId]
                );
            }

            // !>740Q< A5AA8N 1>O A ?5@540G59 client 4;O @01>BK 2=CB@8 B@0=70:F88
            const battle = await pvp.createPVPMatch(playerId, targetId, lockedPlayer.current_location_id, client, damageBonus);

            // >72@0I05< @57C;LB0B 8 40==K5 4;O ;>38@>20=8O ! :><<8B0
            return {
                battle_id: battle.id,
                attacker: {
                    id: lockedPlayer.id,
                    health: lockedPlayer.health,
                    max_health: lockedPlayer.max_health,
                    strength: lockedPlayer.strength
                },
                target: {
                    id: targetPlayer.id,
                    username: targetPlayer.username,
                    health: targetPlayer.health,
                    max_health: targetPlayer.max_health,
                    strength: targetPlayer.strength
                },
                log: {
                    action: 'pvp_attack_start',
                    playerId,
                    data: {
                        target_id: targetId,
                        target_name: targetPlayer.username || targetPlayer.first_name || 'Unknown',
                        location_id: lockedPlayer.current_location_id,
                        battle_id: battle.id
                    }
                }
            };
        });

        // >38@C5< ! :><<8B0 B@0=70:F88
        if (outcome.log) {
            await logPlayerAction(outcome.log.playerId, outcome.log.action, outcome.log.data);
        }

        ok(res, outcome);

    } catch (error) {
        return handleError(res, error, 'pvp_attack', playerId);
    }
});

/**
 *  520=H ?>A;5 ?>@065=8O 2 PvP
 * POST /pvp/revanche пїЅ POST /api/game/pvp/revanche
 * >72>;O5B ?@>83@02H5<C >BK3@0BLAO ?@>B82 ?>1548B5;O A 1>=CA>< : C@>=C.
 */
router.post('/revanche', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    const { target_id } = req.body || {};

    try {
        if (!playerId) {
            return fail(res, '"@51C5BAO 02B>@870F8O', 'UNAUTHORIZED', 401);
        }

        const targetIdCheck = validateId(target_id, 'ID F5;8');
        if (!targetIdCheck.ok) {
            return fail(res, '#:068B5 :>@@5:B=K9 ID F5;8', 'INVALID_TARGET_ID');
        }
            const targetId = targetIdCheck.value;

            // 0;840F8O F5;8: 682, =5 7010=5=, C@>25=L >=5
            const targetCheck = await queryOne('SELECT id, banned, health, level FROM players WHERE id = $1', [targetId]);
            if (!targetCheck) {
                return res.status(404).json({ success: false, error: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND' });
            }
            if (targetCheck.banned) {
                return res.status(403).json({ success: false, error: '3@>: 701;>:8@>20=', code: 'BANNED' });
            }
            if (Number(targetCheck.health || 0) <= 0) {
                return res.status(400).json({ success: false, error: '@>B82=8: <Q@B2', code: 'TARGET_DEAD' });
            }
            if (Number(targetCheck.level || 0) < 5) {
                return res.status(400).json({ success: false, error: '&5;L 70I8I5=0 4> 5 C@>2=O', code: 'TARGET_PROTECTED' });
            }

            const outcome = await transaction(async (client) => {
            // @>25@O5<, GB> C 83@>:0 5ABL revanche ?@>B82 MB>9 F5;8
            const p = await lockPlayer(playerId, client, 'revanche_against, revanche_expires_at, revanche_bonus');
            if (!p) throwPvpError(PvpError.PLAYER_NOT_FOUND);

            if (Number(p.revanche_against) !== targetId) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: '5B ?@020 =0 @520=H ?@>B82 MB>3> 83@>:0',
                        code: 'NO_REVANCHE'
                    }
                };
            }

            if (p.revanche_expires_at && new Date(p.revanche_expires_at) <= new Date()) {
                //  520=H 8ABQ:  >G8I05<
                await client.query(
                    `UPDATE players SET revanche_against = NULL, revanche_expires_at = NULL WHERE id = $1`,
                    [playerId]
                );
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: '!@>: @520=H0 8ABQ:',
                        code: 'REVANCHE_EXPIRED'
                    }
                };
            }

            const bonus = Number(p.revanche_bonus || 25);

            // @02> =0 @520=H A>E@0=O5BAO 4;O /attack (>48= @07 =0 ?>@065=85);
            // 745AL B>;L:> 2>72@0I05< 1>=CA, =5 >G8I05< D;03.

            return {
                battle_id: null, // A>740ABAO 2 createPVPMatch
                bonus_percent: bonus,
                target: { id: targetId },
                log: {
                    action: 'pvp_revanche_start',
                    playerId,
                    data: { target_id: targetId, bonus_percent: bonus }
                }
            };
        });

        if (outcome.status) {
            return res.status(outcome.status).json(outcome.body);
        }

        // >38@C5< ! :><<8B0
        if (outcome.log) {
            await logPlayerAction(outcome.log.playerId, outcome.log.action, outcome.log.data);
        }

        ok(res, {
            bonus_percent: outcome.bonus_percent,
            target_id: outcome.target.id,
            message: ` 520=H 0:B828@>20=! >=CA : C@>=C +${outcome.bonus_percent}% =0 MB>B 1>9.`
        });

    } catch (error) {
        return handleError(res, error, 'pvp_revanche', playerId);
    }
});

/**
 * >3 1>O PvP (?>H03>20O E@>=8:0)
 * GET /pvp/battle-log/:battle_id пїЅ GET /api/game/pvp/battle-log/:battle_id
 */
router.get('/battle-log/:battle_id', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    const { battle_id } = req.params;

    try {
        if (!playerId) {
            return fail(res, '"@51C5BAO 02B>@870F8O', 'UNAUTHORIZED', 401);
        }

        const battleIdCheck = validateId(battle_id, 'ID 1>O');
        if (!battleIdCheck.ok) {
            return fail(res, '#:068B5 :>@@5:B=K9 ID 1>O', 'INVALID_BATTLE_ID');
        }
        const battleId = battleIdCheck.value;

        // @>25@O5<, GB> 83@>: CG0AB=8: 1>O
        const battle = await queryOne(
            `SELECT attacker_id, defender_id FROM pvp_battles WHERE id = $1`,
            [battleId]
        );
        if (!battle) {
            return fail(res, '>9 =5 =0945=', 'BATTLE_NOT_FOUND', 404);
        }
        if (Number(battle.attacker_id) !== playerId && Number(battle.defender_id) !== playerId) {
            return fail(res, 'K =5 CG0AB=8: MB>3> 1>O', 'NOT_PARTICIPANT', 403);
        }

        const log = await queryAll(
            `SELECT round_number, attacker_id, defender_id, damage, is_dodged, is_critical, defender_health_after, created_at
             FROM pvp_battle_log
             WHERE battle_id = $1
             ORDER BY round_number ASC, id ASC`,
            [battleId]
        );

        ok(res, {
            battle_id: battleId,
            log: log.map((entry) => ({
                round: entry.round_number,
                attacker_id: Number(entry.attacker_id),
                defender_id: Number(entry.defender_id),
                damage: Number(entry.damage || 0),
                is_dodged: Boolean(entry.is_dodged),
                is_critical: Boolean(entry.is_critical),
                defender_health_after: Number(entry.defender_health_after || 0),
                created_at: entry.created_at
            }))
        });

    } catch (error) {
        return handleError(res, error, 'pvp_battle_log', playerId);
    }
});

/**
 * #40@ 2 PvP (A B@0=70:F859)
 * POST /pvp/attack-hit пїЅ POST /api/game/pvp/attack-hit
 * CBL: /attack-hit (2=CB@8 @>CB5@0)
 */
router.post('/attack-hit', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    if (!playerId) return unauthorized(res);

    try {
        // 0;840F8O
        if (!req.body || typeof req.body !== 'object') {
            return fail(res, '5:>@@5:B=>5 B5;> 70?@>A0', 'INVALID_REQUEST_BODY', 400);
        }
        const { battle_id } = req.body;
        
        const battleIdCheck = validateId(battle_id, 'ID 1>O');
        if (!battleIdCheck.ok) {
            return fail(res, '#:068B5 :>@@5:B=K9 ID 1>O (G8A;> > 0)', 'INVALID_BATTLE_ID');
        }
        const battleId = battleIdCheck.value;

        // K?>;=O5< C40@ 2 B@0=70:F88
        //  57C;LB0B B@0=70:F88: A>45@68B 40==K5 >B25B0 8 ;>3.
        // >38 CE>4OB ?>A;5 COMMIT  A<. =865.
        let expLogData = null;
        const outcome = await transaction(async (client) => {
            // >;CG05< 1>9
            const battle = await client.query(`
                SELECT * FROM pvp_battles WHERE id = $1 FOR UPDATE
            `, [battleId]);

            if (!battle.rows[0]) {
                throwPvpError(PvpError.BATTLE_NOT_FOUND);
            }

            const battleData = battle.rows[0];

            if (battleData.status !== 'active') {
                throwPvpError(PvpError.BATTLE_FINISHED);
            }

            //  "': attacker_id/defender_id  BIGINT, 0 pg >B40QB int8
            // !"  ('42'), B>340 :0: req.player.id  G8A;> (buildRequestPlayer
            // 45;05B Number(dbPlayer.id)). !B@>3>5 A@02=5=85 AB@>:8 A G8A;><
            // 2A5340 40QB false, ?>MB><C ?@>25@:0 CG0AB=8:0 A@010BK20;0
            // >H81>G=>: C40@ 2 PvP >B:;>=O;AO A пїЅK =5 CG0AB=8: MB>3> 1>OпїЅ
            //  ?@>E>48; 4;O 70I8B=8:0, :>B>@K9 BCB 65 AB0=>28;AO
            // пїЅ0B0:CNI8<пїЅ (isAttacker = false). @82>48< : Number O2=>.
            const attackerIdRaw = Number(battleData.attacker_id);
            const defenderIdRaw = Number(battleData.defender_id);

            if (attackerIdRaw !== playerId && defenderIdRaw !== playerId) {
                throwPvpError(PvpError.NOT_PARTICIPANT);
            }

            // ?@545;O5< 0B0:CNI53> 8 70I8B=8:0
            const isAttacker = attackerIdRaw === playerId;
            const attackerId = isAttacker ? attackerIdRaw : defenderIdRaw;
            const defenderId = isAttacker ? defenderIdRaw : attackerIdRaw;

            // ;>:8@C5< >1>8E 83@>:>2 2 >?@545;Q==>< ?>@O4:5 4;O ?@54>B2@0I5=8O deadlock
            const [firstId, secondId] = attackerId < defenderId
                ? [attackerId, defenderId]
                : [defenderId, attackerId];
            
            const firstPlayer = await lockPlayer(firstId, client);
            const secondPlayer = await lockPlayer(secondId, client);

            const attacker = attackerId === firstId ? firstPlayer : secondPlayer;
            const defender = defenderId === firstId ? firstPlayer : secondPlayer;

            if (!attacker || !defender) {
                throwPvpError(PvpError.PLAYER_NOT_FOUND);
            }

            // @>25@O5<, GB> 83@>: 682 ?5@54 0B0:>9
            if (Number(attacker.health || 0) <= 0) {
                throwPvpError(PvpError.SELF_DEAD);
            }
            if (Number(defender.health || 0) <= 0) {
                throwPvpError(PvpError.TARGET_DEAD);
            }

            const activeBuffs = getActiveBuffs(attacker.buffs);
            // P0-1: ?5@5AG8BK205< M=5@38N ?> @50;L=><C 2@5<5=8 ?5@54 B@0B>9
            await recalcEnergy(client, attacker);
            if (!activeBuffs.free_energy && Number(attacker.energy || 0) < 1) {
                throwPvpError(PvpError.INSUFFICIENT_ENERGY_HIT);
            }

            const energyCost = activeBuffs.free_energy ? 0 : 1;

            // -=5@38O: last_energy_update  428305<  @535= 84QB >B @50;L=>
            // ?@>H54H53> 2@5<5=8, 8=0G5 C40@ >1=C;8; 1K =0:>?;5==K9 @535=.
            // 48=>5 ?@028;> >?8A0=> 2 utils/game-helpers.js (recalcEnergy).
            const energyResult = await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - $1)
                 WHERE id = $2
                 RETURNING energy, max_energy, last_energy_update`,
                [energyCost, attackerId]
            );
            if (!energyResult.rows[0]) {
                throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            const energyLeft = Number(energyResult.rows[0]?.energy || 0);
            const energyLastUpdate = energyResult.rows[0]?.last_energy_update || null;

            // P1-6: D>@<C;K A =0AKI5=85< (soft caps)  2K=5A5=K 2 db/pvp.js
            const attackerEq = normalizeEquipment(attacker.equipment);
            const defenderEq = normalizeEquipment(defender.equipment);
            // >=CA A5B0 0B0:CNI53> (C@>=)  AG8B05< >48= @07 4;O >1>8E.
            // client ?5@540=: transaction() C65 45@68B FOR UPDATE =0 pvp_battles
            // 8 42CE players, 2B>@>9 2K7>2 G5@57 query() 1@0; 1K 5IQ >4=>
            // A>548=5=85 ?C;0 (max 20).
            const attackerSetBonuses = await getSetBonuses(attackerEq, client);
            let damage = pvp.calculatePVPDamage(
                { ...attacker, equipment: attackerEq, set_damage: attackerSetBonuses.damage || 0 },
                { ...defender, equipment: defenderEq }
            ).damage;

            // >=CA C@>=0 >B @520=H0 (0B0:CNI89 ?>;CG05B +X% : C@>=C 2 MB>< 1>N)
            const battleDamageBonus = Number(battleData.damage_bonus || 0);
            if (battleDamageBonus > 0 && isAttacker) {
                damage = Math.floor(damage * (1 + battleDamageBonus / 100));
            }

            // #:;>=5=85 (soft cap 20%)
            const agilityDenom = Number(defender.agility || 0) + 40;
            const dodgeChance = agilityDenom === 0 ? 0 : Math.min(20, Number(defender.agility || 0) / agilityDenom * 20);
            const isDodged = crypto.randomInt(100) < dodgeChance;
            
            if (isDodged) {
                await client.query(
                    `UPDATE pvp_battles
                     SET battle_duration = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::integer)
                     WHERE id = $1`,
                    [battleId]
                );

                // >3 E>40: C:;>=5=85
                await client.query(
                    `INSERT INTO pvp_battle_log (battle_id, round_number, attacker_id, defender_id, damage, is_dodged, defender_health_after)
                     VALUES ($1, (SELECT COALESCE(MAX(round_number), 0) + 1 FROM pvp_battle_log WHERE battle_id = $2), $3, $4, 0, true, $5)`,
                    [battleId, battleId, attackerId, defenderId, defender.health]
                );

                // #:;>=5=85 70I8B=8: C2848B B>;L:> =0 A2>Q< M:@0=5 PvP: 0:B82=KE
                // push-C254><;5=89 =5B, 1>9 ?>4BO38205BAO ?> /matches.
                return {
                    dodged: true,
                    battleEnded: false,
                    message: '@>B82=8: C:;>=8;AO >B 0B0:8!',
                    hit: {
                        damage: 0,
                        yourHealth: Number(attacker.health || 0),
                        targetHealth: Number(defender.health || 0),
                        maxHealth: Number(defender.max_health || 0)
                    },
                    energy_left: energyLeft,
                    last_energy_update: energyLastUpdate
                };
            }

            // @8<5=O5< C@>=
            const newHealth = Math.max(0, defender.health - damage);

            // 7=>A A=0@O65=8O: >@C685 0B0:CNI53> 8 1@>=O 70I8B=8:0.
            // !?8A>: A;>B>2  87 :0=>=0 COMBAT_SLOTS, 0 =5 @CG=0O :>?8O:
            // @CG=>9 A?8A>: >BAB020; >B :0=>=0 (2 =Q< >AB020;AO C40;Q==K9
            // A;>B 'head' 8 =5 1K;> 'face'), 8 <0A:8 A ?@>B82>3070<8 =5
            // 87=0H820;8AL 2 PvP 2>>1I5.
            const attackerBroken = wearEquipmentSlots(attackerEq, ['weapon']);
            const defenderBroken = wearEquipmentSlots(defenderEq, equipmentRules.EQUIPMENT_SLOTS);

            await client.query(`
                UPDATE players
                   SET health = $1,
                       equipment = $2::jsonb
                 WHERE id = $3
            `, [newHealth, JSON.stringify(defenderEq), defenderId]);

            // >3 E>40: Successful hit
            await client.query(
                `INSERT INTO pvp_battle_log (battle_id, round_number, attacker_id, defender_id, damage, is_dodged, defender_health_after)
                 VALUES ($1, (SELECT COALESCE(MAX(round_number), 0) + 1 FROM pvp_battle_log WHERE battle_id = $2), $3, $4, $5, false, $6)`,
                [battleId, battleId, attackerId, defenderId, damage, newHealth]
            );

            // 2B>;5G5=85 70I8B=8:0 C1@0=>: ;5:0@AB20 @0AE>4CNBAO B>;L:>
            // 2@CG=CN A ?0=5;8 ;5G5=8O.  0=LH5 745AL 2K7K20;AO applyAutoHeal,
            // 8 PvP 02B><0B8G5A:8 B@0B8; 0?B5G:C 70I8B=8:0.

            // 7=>A >@C68O 0B0:CNI53> A>E@0=O5< !, 0 =5 B>;L:> ?@8 ?>;><:5:
            // 8=0G5 1 ?@>G=>AB8 70 C40@ ?@>AB> B5@O;AO 1K 2 ?0<OB8.
            await setPlayerEquipment(attackerId, attackerEq, client);

            await client.query(
                `UPDATE players
                 SET pvp_total_damage_dealt = pvp_total_damage_dealt + $1
                 WHERE id = $2`,
                [damage, attackerId]
            );

            await client.query(
                `UPDATE players
                 SET pvp_total_damage_taken = pvp_total_damage_taken + $1
                 WHERE id = $2`,
                [damage, defenderId]
            );

            const battleDamageField = isAttacker ? 'attacker_damage' : 'defender_damage';
            // Whitelist 8<Q= :>;>=>:: 70I8B0 >B SQL-8=J5:F88 2 845=B8D8:0B>@
            // ?@8 1C4CI5< @5D0:B>@8=35 (?0@0<5B@870F8O G5@57 $n =5 @01>B05B
            // 4;O 8<Q= :>;>=>:).
            const ALLOWED_DAMAGE_FIELDS = new Set(['attacker_damage', 'defender_damage']);
            if (!ALLOWED_DAMAGE_FIELDS.has(battleDamageField)) {
                throw { message: '5:>@@5:B=>5 ?>;5 C@>=0', code: 'INTERNAL_ERROR', statusCode: 500 };
            }
            await client.query(
                `UPDATE pvp_battles
                 SET ${battleDamageField} = COALESCE(${battleDamageField}, 0) + $1,
                     battle_duration = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::integer)
                 WHERE id = $2`,
                [damage, battleId]
            );

            // @>25@O5< ?>154C
            let battleEnded = false;
            let rewards = null;
            let winner = null;
            let loser = null;
            // 0==K5 4;O ;>3>2 A>18@05< 745AL 8 D>@<8@C5< ! :><<8B0
            // B@0=70:F88: ?045=85 70?8A8 ;>30 =5 4>;6=> >B:0BK20BL 1>9.
            let battleLogData = null;

            // >1540 AG8B05BAO ?> 74>@>2L5 ?>A;5 C@>=0.
            const defenderHealth = newHealth;

            if (defenderHealth <= 0) {
                battleEnded = true;

                // 03@040 ?>1548B5;N  D>@<C;K 2K=5A5=K 2 db/pvp.js
                const coinsReward = pvp.calculateCoinsToSteal(defender.coins);

                // (0=A C:@0ABL ?@54<5B (A=865=> A 30% 4> 10%)
                const defenderInventory = await (helpers.loadInventoryFromTable || (async () => null))(client, defenderId) || normalizeInventory(defender.inventory);
                const attackerInventory = await (helpers.loadInventoryFromTable || (async () => null))(client, attackerId) || normalizeInventory(attacker.inventory);
                let stolenItem = null;

                if (crypto.randomInt(10) === 0) {
                    const [stolen] = pvp.getRandomItemsToSteal(defenderInventory, 1);
                    // #:@045==K9 ?@54<5B 4>;65= ?><5AB8BLAO: A=0@O65=85 =5 AB0:C5BAO,
                    // ?>MB><C пїЅ2B8A=CBLпїЅ 53> <>6=> B>;L:> 2 ?CAB>9 A;>B 
                    // 5A;8 <5AB =5B, ?@54<5B ?@>AB> =5 :@04QBAO (C ?@>83@02H53>
                    // >= >AB0QBAO). =0G5 0B0:CNI89 ?>;CG8; 1K 101-9 A;>B 8
                    // ;N10O 4>1KG0 A@07C C?8@0;0AL 1K 2 INVENTORY_FULL.
                    if (stolen && attackerInventory.length < MAX_INVENTORY_SLOTS) {
                        const stolenIndex = defenderInventory.indexOf(stolen);
                        if (stolenIndex < 0) {
                            stolenItem = null;
                        } else {
                            const stackQuantity = Math.max(1, Number(stolen.quantity || 1));
                            const isEquipment = equipmentRules.isEquipmentItem(stolen);

                            // 7 AB0:0 :@04QBAO  HBC:0, 0 =5 25AL AB0:  8=0G5 ?@>83@02H89
                            // B5@O; 1K, =0?@8<5@, 2A5 99 A>1@0==KE :>=A5@2>2.
                            if (!isEquipment && stackQuantity > 1) {
                                defenderInventory[stolenIndex] = { ...stolen, quantity: stackQuantity - 1 };
                                addItemToInventory(attackerInventory, { ...stolen, quantity: 1 }, null);
                                stolenItem = { ...stolen, quantity: 1 };
                                await trackCollectedItems(client, attackerId, [stolen.id]);
                            } else {
                                defenderInventory.splice(stolenIndex, 1);
                                addItemToInventory(attackerInventory, { ...stolen }, null);
                                stolenItem = stolen;
                                await trackCollectedItems(client, attackerId, [stolen.id]);
                            }
                        }
                    }
                }

                const safeLocationResult = await client.query(
                    `SELECT id
                     FROM locations
                     WHERE COALESCE(danger_level, 0) < 6
                     ORDER BY danger_level ASC, id ASC
                     LIMIT 1`
                );
                const safeLocationId = safeLocationResult.rows[0]?.id ? Number(safeLocationResult.rows[0].id) : null;

                // 025@H05< 1>9
await client.query(`
                     UPDATE pvp_battles
                     SET status = 'completed',
                         winner_id = $1,
                         loser_id = $2,
                         attacker_reward = CASE WHEN attacker_id = $1 THEN $3 ELSE 0 END,
                         defender_reward = CASE WHEN defender_id = $2 THEN -$3 ELSE 0 END,
                         ended_at = NOW(),
                         battle_duration = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::integer)
                     WHERE id = $4
                 `, [attackerId, defenderId, coinsReward, battleId]);

                // 1=>2;O5< PvP AB0B8AB8:C ?>1548B5;O 8 40Q< >?KB
                const pvpExpReward = pvp.calculatePVPRewardExperience(attacker.level, defender.level);
                await client.query(
                    `UPDATE players
                     SET pvp_wins = pvp_wins + 1,
                         pvp_streak = pvp_streak + 1,
                          pvp_max_streak = GREATEST(pvp_max_streak, $2),
                         pvp_rating = pvp_rating + 25
                      WHERE id = $1`,
                    [attackerId, Number(attacker.pvp_streak || 0) + 1]
                );
                
// A?>;L7C5< playerHelper.addExperience 4;O :>@@5:B=>3> level-up
                const expResult = await playerHelper.addExperience(attackerId, pvpExpReward, client);
                try {
                    const progression = require('../utils/progression');
                    await progression.grantExperience(attackerId, pvpExpReward, 'pvp_win', client);
                } catch (_) {
                    try {
                        const { getGameHelpers } = require('../utils/game-helpers');
                        const h = getGameHelpers();
                        if (h && typeof h.checkAchievements === 'function') h.checkAchievements(attackerId, client).catch(() => {});
                    } catch (__) { /* ignore */ }
                }
                expLogData = expResult.logData;

                // 1=>2;O5< PvP AB0B8AB8:C ?@>83@02H53>
                await client.query(`
                    UPDATE players
                    SET pvp_losses = pvp_losses + 1,
                        pvp_streak = 0,
                        pvp_rating = GREATEST(500, pvp_rating - 15),
                        coins = GREATEST(0, coins - $1),
                        coins_stolen_from_me = coins_stolen_from_me + $1,
                        items_stolen_from_me = items_stolen_from_me + $2,
                        current_location_id = COALESCE($3, current_location_id),
                        --  520=H: ?@>83@02H89 <>65B >BK3@0BLAO ?@>B82 ?>1548B5;O
                        -- 2 B5G5=85 24 G0A>2 A 1>=CA>< : C@>=C
                        revanche_against = $4,
                        revanche_expires_at = NOW() + INTERVAL '24 hours',
                        revanche_bonus = 25
                    WHERE id = $5
                `, [coinsReward, stolenItem ? 1 : 0, safeLocationId, attackerId, defenderId]);

                await client.query(`
                    UPDATE players SET coins = coins + $1 WHERE id = $2
                `, [coinsReward, attackerId]);

                if (stolenItem) {
                    // RETURNING + rowCount: AB@>:8 70?5@BK FOR UPDATE @0=55
                    // (?>@O4>: 45B5@<8=8@>20=), => ?@8 8AG57=>25=88 83@>:0
                    // <564C GB5=85< 8 70?8ALN 8=25=B0@L <>;G0 =5 A>E@0=8;AO
                    // 1K  C:@045==K9 ?@54<5B @0AA8=E@>=878@>20;AO A .
                    const defWrite = await client.query(
                        `UPDATE players SET inventory = $1 WHERE id = $2 RETURNING id`,
                        [safeStringify(defenderInventory), defenderId]
                    );
                    if (defWrite.rowCount === 0) {
                        throw { message: '0I8B=8: 8AG57', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
                    }
                    const attWrite = await client.query(
                        `UPDATE players SET inventory = $1, items_collected = COALESCE(items_collected, 0) + 1 WHERE id = $2 RETURNING id`,
                        [safeStringify(attackerInventory), attackerId]
                    );
                    if (attWrite.rowCount === 0) {
                        throw { message: 'B0:CNI89 8AG57', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
                    }
                }

                rewards = {
                    coins: coinsReward,
                    item: stolenItem,
                    experience: pvpExpReward
                };
                winner = { id: attackerId };
                loser = { id: defenderId };

                // P1-5: CAB0=02;8205< :C;40C= ?>A;5 1>O 4;O >1>8E + 70I8B0 >B D0@<0 F5;8
                const cooldownMin = 5;
                // B><0@=> AB028< :C;40C=K >1>8< 83@>:0< >4=8< 70?@>A><:
                // ON CONFLICT (player_id, cooldown_type) @01>B05B 4;O :064>9 AB@>:8 VALUES >B45;L=>.
                 await client.query(
                     `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
                      VALUES
                          ($1, 'pvp_battle', NOW() + $3 * interval '1 minute'),
                          ($2, 'pvp_battle', NOW() + $3 * interval '1 minute')
                      ON CONFLICT (player_id, cooldown_type)
                      DO UPDATE SET expires_at = NOW() + $3 * interval '1 minute'`,
                     [attackerId, defenderId, cooldownMin]
                 );
                // 0I8B0 >B ?>2B>@=>9 0B0:8 >4=>9 F5;8 (10 <8=)
                await client.query(
                    `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
                     VALUES ($1, 'pvp_target_' || $2, NOW() + '10 minutes'::interval)
                     ON CONFLICT (player_id, cooldown_type)
                     DO UPDATE SET expires_at = NOW() + '10 minutes'::interval`,
                    [attackerId, defenderId]
                );

                // :B82=KE push-C254><;5=89 =5B: ?>@065=85 ?@>B82=8: C2848B =0 A2>Q<
                // M:@0=5 PvP  B0< 1>9 ?>4BO38205BAO ?> /api/game/pvp/matches.

                // >38 1>O D>@<8@C5< :0: 40==K5: A0<0 70?8AL C94QB 2 ;>3
                // C65 ?>A;5 COMMIT, GB>1K 5Q ?045=85 =5 >B:0B8;> 1>9.
                battleLogData = {
                    action: 'pvp_battle_win',
                    data: {
                        battle_id,
                        opponent_id: defenderId,
                        damage_dealt: damage,
                        coins_reward: coinsReward,
                        item_stolen: !!stolenItem
                    }
                };
            } else {
                battleLogData = {
                    action: 'pvp_attack_hit',
                    data: {
                        battle_id,
                        opponent_id: defenderId,
                        damage_dealt: damage,
                        opponent_health_after: newHealth
                    }
                };
            }

            return {
                battleEnded,
                winner,
                loser,
                rewards,
                hit: {
                    damage,
                    yourHealth: Number(attacker.health || 0),
                    targetHealth: Number(defenderHealth || 0),
                    maxHealth: Number(defender.max_health || 0),
                    your_broken_equipment: attackerBroken,
                    target_broken_equipment: defenderBroken
                },
                energy_left: energyLeft,
                last_energy_update: energyLastUpdate,
                message: battleEnded ? 'Победа!' : 'Удар нанесён',
                log: {
                    playerId,
                    ...battleLogData
                }
            };
        });
        
        // >38@C5< ! :><<8B0 B@0=70:F88
        if (outcome.log) {
            await logPlayerAction(outcome.log.playerId, outcome.log.action, outcome.log.data);
        }

        if (expLogData && outcome.log) {
            await logPlayerAction(outcome.log.playerId, expLogData.action, expLogData.data);
        }

        return ok(res, outcome);

    } catch (error) {
        return handleError(res, error, 'pvp_attack_hit', playerId);
    }
});

/**
 * PvP AB0B8AB8:0
 * GET /pvp/stats пїЅ GET /api/game/pvp/stats
 * CBL: /stats (2=CB@8 @>CB5@0)
 */
router.get('/stats', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    if (!playerId) return unauthorized(res);
    
    try {
        const [stats, cooldown, recentBattles] = await Promise.all([
            queryOne(`
                SELECT pvp_wins, pvp_losses, pvp_total_damage_dealt, pvp_total_damage_taken,
                       pvp_rating, pvp_streak, pvp_max_streak, coins_stolen_from_me, items_stolen_from_me
                FROM players WHERE id = $1
            `, [playerId]),
            pvp.getPVPCooldown(playerId),
            queryAll(`
                SELECT b.id, b.attacker_id, b.defender_id, b.winner_id,
                       b.attacker_damage, b.defender_damage,
                       COALESCE(b.ended_at, b.started_at) AS battle_time,
                       attacker.username AS attacker_username,
                       attacker.first_name AS attacker_first_name,
                       defender.username AS defender_username,
                       defender.first_name AS defender_first_name
                FROM pvp_battles b
                LEFT JOIN players attacker ON attacker.id = b.attacker_id
                LEFT JOIN players defender ON defender.id = b.defender_id
                WHERE (b.attacker_id = $1 OR b.defender_id = $1)
                  AND b.status = 'completed'
                ORDER BY COALESCE(b.ended_at, b.started_at) DESC
                LIMIT 10
            `, [playerId])
        ]);

        const recentMatches = recentBattles.map((battle) => {
            const isOriginalAttacker = Number(battle.attacker_id) === Number(playerId);
            const opponentName = isOriginalAttacker
                ? (battle.defender_username || battle.defender_first_name || '3@>:')
                : (battle.attacker_username || battle.attacker_first_name || '3@>:');

            return {
                id: battle.id,
                result: Number(battle.winner_id) === Number(playerId) ? 'win' : 'loss',
                opponentName,
                date: battle.battle_time,
                damageDealt: isOriginalAttacker ? Number(battle.attacker_damage || 0) : Number(battle.defender_damage || 0),
                damageTaken: isOriginalAttacker ? Number(battle.defender_damage || 0) : Number(battle.attacker_damage || 0)
            };
        });
        
        ok(res, {
            stats: {
                wins: stats?.pvp_wins || 0,
                losses: stats?.pvp_losses || 0,
                totalDamageDealt: stats?.pvp_total_damage_dealt || 0,
                totalDamageTaken: stats?.pvp_total_damage_taken || 0,
                rating: stats?.pvp_rating || 1000,
                streak: stats?.pvp_streak || 0,
                maxStreak: stats?.pvp_max_streak || 0,
                coinsStolenFromMe: stats?.coins_stolen_from_me || 0,
                itemsStolenFromMe: stats?.items_stolen_from_me || 0
            },
            recentMatches,
            cooldown: cooldown
                ? {
                    active: true,
                    type: cooldown.cooldown_type,
                    expiresAt: cooldown.expires_at,
                    reason: cooldown.reason
                }
                : { active: false }
        });

    } catch (error) {
        return handleError(res, error, 'pvp_stats', playerId);
    }
});
module.exports = router;

