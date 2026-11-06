/**
 * @>D8;L 83@>:0, 4>AB865=8O 8 M=5@38O
 * @module game/player
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, transaction } = require('../../db/database');
const { lockPlayer } = require('../../db/players');
const { logger, safeJsonParse, handleError, logPlayerAction, validateId, ok, unauthorized, notFound } = require('../../utils/serverApi');

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
const { buildPlayerStatus, normalizeInventory, getActiveBuffs, getPlayerAchievements, getPlayerProgress, regenerateHealth, recalcEnergy } = helpers;
// 1I89 D09; ?@028; A :;85=B><: F5=K ?>:C?:8 M=5@388 (2 72Q740E), 5654=52=K9 1>=CA.
const equipmentRules = require('../../public/shared/equipment.js');
const { DAILY_BONUS_COOLDOWN_MS, DAILY_BONUS_STREAK_LIMIT, DAILY_BONUS_BASE_COINS, DAILY_BONUS_COINS_PER_DAY, DAILY_BONUS_STAR_EVERY } = equipmentRules;


// C-6: Whitelist @07@5HQ==KE ?>;59 4;O >1=>2;5=8O ?@>D8;O
//
// P2: 'avatar' C1@0=. >;>=:8 players.avatar =5B 2 db/schema.js, ?>MB><C
// 70?@>A A =59 2A5340 ?040; =0  (42703) -> 500 2<5AB> ?>=OB=>3> >B25B0.
// 5@=CBL ?>;5 <>6=> 2<5AB5 A <83@0F859, 4>10282 :>;>=:C.
const ALLOWED_UPDATE_FIELDS = ['username', 'first_name', 'last_name'];

/**
 * "8?/>3@0=8G5=8O 4;O :064>3> ?>;O ?@>D8;O.
 * =0G5=8O 87 B5;0 70?@>A0 157 ?@>25@:8 CE>48;8 ?@O<8:>< 2 UPDATE.
 */
const UPDATE_FIELD_RULES = {
    username: { type: 'string', max: 64, nullable: true },
    first_name: { type: 'string', max: 128, nullable: true },
    last_name: { type: 'string', max: 128, nullable: true }
};

function filterAllowedUpdateFields(body) {
    const updates = {};
    if (!body || typeof body !== 'object') return updates;
    for (const field of ALLOWED_UPDATE_FIELDS) {
        if (body[field] !== undefined) {
            updates[field] = body[field];
        }
    }
    return updates;
}

/**
 * @>25@:0 7=0G5=89 ?5@54 UPDATE: B8? 8 4;8=0.
 * @param {Object} updates >BD8;LB@>20==K5 ?>;O
 * @returns {{ok: true}|{ok: false, error: string}}
 */
function validateUpdateValues(updates) {
    for (const [field, value] of Object.entries(updates)) {
        const rule = UPDATE_FIELD_RULES[field];
        if (!rule) continue;

        if (value === null) {
            if (!rule.nullable) {
                return { ok: false, error: `>;5 �${field}� =5 <>65B 1KBL ?CABK<` };
            }
            continue;
        }

        if (typeof value !== rule.type) {
            return { ok: false, error: `>;5 �${field}� 4>;6=> 1KBL AB@>:>9` };
        }

        if (value.length > rule.max) {
            return { ok: false, error: `>;5 �${field}� A;8H:>< 4;8==>5 (<0:A. ${rule.max})` };
        }
    }
    return { ok: true };
}

/**
 * GET /profile  ?>;=K9 ?@>D8;L 83@>:0
 * >445@68205B 8 /profile (G5@57 0;80A /profile), 8 :>@=52>9 ?CBL (G5@57 /player)
 */
router.get(['/', '/profile'], async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: '"@51C5BAO 02B>@870F8O' });
        }

        const player = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
        if (!player) {
            return res.status(404).json({ error: '3@>: =5 =0945=' });
        }

        // 0AA82=K9 @535= 74>@>2LO ?@8 :064>< 70E>45 2 ?@>D8;L: 8=0G5
        // 83@>: =5 2845; 1K 2>AAB0=>2;5=8O, ?>:0 =5 7094QB 2 ?>8A:.
        // P2: .catch(() => 0) 3;>B0; >H81:C A>2A5<  @0AA8=E@>= ?>:070==>3>
        // 8 D0:B8G5A:>3> HP >AB020;AO =52848<K<. >38@C5< ?@8G8=C.
        const locked = await transaction(async (client) => {
            const l = await lockPlayer(playerId, client, 'id, health, max_health, last_hp_regen, energy, max_energy, last_energy_update');
            if (!l) throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            await regenerateHealth(client, l);
            await recalcEnergy(client, l);
            return l;
        }).catch((err) => {
            logger.warn('[player] 5 C40;>AL >1=>28BL @535= 74>@>2LO 2 ?@>D8;5', {
                playerId, error: err && err.message
            });
            throw err;
        });
        if (locked) {
            player.health = locked.health;
            player.energy = locked.energy;
            player.last_energy_update = locked.last_energy_update;
        }

        let achievements = [];
        let progress = null;
        try {
            achievements = await getPlayerAchievements(playerId);
        } catch (_) { /* ignore */ }
        try {
            progress = await getPlayerProgress(playerId);
        } catch (_) { /* ignore */ }
        const status = buildPlayerStatus(player);

        // 48=K9 8AB>G=8: 8AB8=K 4;O G8A;0 C18BKE 1>AA>2  03@530B 87 boss_mastery
        // (0 =5 players.bosses_killed, :>B>@K9 <>65B @0AE>48BLAO ?@8 @5940E).
        let bossesKilled = Number(player.bosses_killed || 0);
        try {
            const bossKillsRow = await queryOne(
                `SELECT COALESCE(SUM(kills), 0) AS total FROM boss_mastery WHERE player_id = $1`,
                [playerId]
            );
            if (bossKillsRow) bossesKilled = Number(bossKillsRow.total || 0);
        } catch (_) { /* fallback to players.bosses_killed */ }

        res.json({
            success: true,
            data: {
                player: {
                    id: player.id,
                    telegram_id: player.telegram_id,
                    username: player.username,
                    first_name: player.first_name,
                    last_name: player.last_name,
                    level: player.level,
                    experience: player.experience,
                    coins: player.coins,
                    stars: player.stars,
                    energy: status.energy,
                    max_energy: status.max_energy,
                    health: status.health,
                    max_health: status.max_health,
                    // 0@065=85 7>=K >4=>  radiation. =D5:F88 >1J548=5=K
                    // A =8<, ?>;59 infections / infections_list 2 >B25B5 =5B.
                    radiation: status.radiation,
                    clan_id: player.clan_id,
                    clan_role: player.clan_role,
                    daily_streak: player.daily_streak,
                    bosses_killed: bossesKilled,
                    pvp_wins: player.pvp_wins,
                    pvp_losses: player.pvp_losses,
                    pvp_rating: player.pvp_rating,
                    created_at: player.created_at,
                    last_daily_bonus: player.last_daily_bonus,
                    // >;O, 8A?>;L7C5<K5 :;85=B>< 4;O UI (AB0BK, M=5@38O, ;>:0F8O)
                    last_energy_update: player.last_energy_update,
                    current_location_id: player.current_location_id,
                },
                achievements: achievements || [],
                progress: progress || {},
                inventory: normalizeInventory(player.inventory),
                equipment: safeJsonParse(player.equipment, {}),
                active_buffs: getActiveBuffs(player.buffs || '{}')
            }
        });
    } catch (err) {
        logger.error({ type: 'profile_error', message: err.message });
        if (err?.code === 'PLAYER_NOT_FOUND') {
            return res.status(404).json({ success: false, error: err.message, code: err.code });
        }
        res.status(500).json({ error: 'H81:0 ?>;CG5=8O ?@>D8;O' });
    }
});

/**
 * PUT /update  >1=>2;5=85 ?@>D8;O (B>;L:> @07@5HQ==K5 ?>;O)
 */
router.put('/update', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: '"@51C5BAO 02B>@870F8O' });
        }

        const updates = filterAllowedUpdateFields(req.body);
        const fieldNames = Object.keys(updates);

        if (fieldNames.length === 0) {
            return res.status(400).json({ error: '5B @07@5HQ==KE ?>;59 4;O >1=>2;5=8O' });
        }

        // P2: 7=0G5=8O B5?5@L ?@>25@ONBAO ?> B8?C 8 4;8=5  70?@>A0.
        //  0=LH5 { username: 42 } 8;8 { first_name: { a: 1 } } CE>48;8 2 UPDATE,
        // pg ?040; A 22P02, 8 83@>: ?>;CG0; �H81:0 >1=>2;5=8O ?@>D8;O�.
        const valuesCheck = validateUpdateValues(updates);
        if (!valuesCheck.ok) {
            return res.status(400).json({ success: false, error: valuesCheck.error, code: 'VALIDATION_ERROR' });
        }

        const setClauses = fieldNames.map((field, i) => `${field} = $${i + 2}`);
        const values = fieldNames.map(f => updates[f]);
        values.unshift(playerId);

        await transaction(async (client) => {
            const playerRow = await lockPlayer(playerId, client, 'id');

            if (!playerRow) {
                throw { message: '3@>: =5 =0945=', code: 'NOT_FOUND' };
            }
            await client.query(
                `UPDATE players SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
                values
            );
        });

        await logPlayerAction(playerId, 'profile_update', { fields: fieldNames }).catch(() => {});

        const updatedPlayer = await queryOne('SELECT * FROM players WHERE id = $1', [playerId]);
        if (!updatedPlayer) return notFound(res, '3@>: =5 =0945=', 'PLAYER_NOT_FOUND');

        res.json({
            success: true,
            data: {
                username: updatedPlayer.username,
                first_name: updatedPlayer.first_name,
                last_name: updatedPlayer.last_name
            }
        });
    } catch (err) {
        logger.error({ type: 'update_profile_error', message: err.message });
        if (err?.code === 'NOT_FOUND' || err?.code === 'PLAYER_NOT_FOUND') {
            return res.status(404).json({ success: false, error: err.message, code: err.code });
        }
        res.status(500).json({ error: 'H81:0 >1=>2;5=8O ?@>D8;O' });
    }
});

/**
 * POST /buy-energy  ?>:C?:0 M=5@388 70 72Q74K
 */
router.post('/buy-energy', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);
        // &5=0 8 >1JQ<  87 >1I53> D09;0 ?@028;, B5< 65 D09;>< ?>;L7C5BAO
        // :;85=B (public/game.js, restoreEnergy).  0=LH5 �5� 8 �25� 1K;8
        // 70?8A0=K 745AL >B45;L=>, 0 :;85=B 45@60; A2>N :>?8N F5=K.
        const STARS_COST = Number.isFinite(equipmentRules.ENERGY_PURCHASE_STARS_COST) ? equipmentRules.ENERGY_PURCHASE_STARS_COST : 5;
        const ENERGY_PER_PURCHASE = Number.isFinite(equipmentRules.ENERGY_PER_PURCHASE) ? equipmentRules.ENERGY_PER_PURCHASE : 25;

        const result = await transaction(async (client) => {
            const p = await lockPlayer(playerId, client, 'stars, energy, max_energy');

            if (!p) throw { message: '3@>: =5 =0945=', code: 'NOT_FOUND', statusCode: 404 };
            const stars = Number(p.stars || 0);
            const energy = Number(p.energy || 0);
            const maxEnergy = Number(p.max_energy ?? 50);
            if (stars < STARS_COST) throw { message: '54>AB0B>G=> 72Q74', code: 'INSUFFICIENT_STARS' };
            if (energy >= maxEnergy) throw { message: '-=5@38O C65 ?>;=0O', code: 'ENERGY_FULL' };

            const newEnergy = Math.min(energy + ENERGY_PER_PURCHASE, maxEnergy);

            await client.query(
                'UPDATE players SET stars = GREATEST(0, COALESCE(stars,0) - $1), energy = $2 WHERE id = $3',
                [STARS_COST, newEnergy, playerId]
            );

            return {
                energy: newEnergy,
                stars: stars - STARS_COST,
                log: { action: 'buy_energy', playerId, data: { cost: STARS_COST, gained: ENERGY_PER_PURCHASE } }
            };
        });

        // >38@C5< ! :><<8B0 B@0=70:F88
        if (result.log) {
            try {
                await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
            } catch (e) {
                // =5 2;8O5< =0 >B25B
            }
        }

        res.json({ success: true, data: { energy: result.energy, stars: result.stars } });
    } catch (err) {
        if (err.code === 'INSUFFICIENT_STARS' || err.code === 'ENERGY_FULL' || err.code === 'NOT_FOUND') {
            return res.status(400).json({ error: err.message, code: err.code });
        }
        handleError(res, err, 'buy_energy');
    }
});

/**
 * POST /daily-bonus  5654=52=K9 1>=CA (@07 2 24 G0A0).
 * 
 * 03@040 @0ABQB A A5@859 (+25 <>=5B/45=L, <0:A. 7 4=59).
 * 064K5 3 4=O  >4=0 725740. @>?CA: >48 G0A>2 >1=C;O5B A5@8N.
 * >=AB0=BK 15@CBAO 87 equipment.js (548=K9 8AB>G=8: ?@024K A :;85=B><).
 */
router.post('/daily-bonus', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: '"@51C5BAO 02B>@870F8O' });
        }

        const result = await transaction(async (client) => {
            const player = await lockPlayer(playerId, client, 'id, coins, stars, daily_streak, last_daily_bonus');

            if (!player) throw { message: '3@>: =5 =0945=', code: 'PLAYER_NOT_FOUND', statusCode: 404 };

            const now = Date.now();
            const lastBonus = player.last_daily_bonus ? new Date(player.last_daily_bonus).getTime() : 0;

            if (lastBonus && now - lastBonus < DAILY_BONUS_COOLDOWN_MS) {
                const nextIn = Math.ceil((DAILY_BONUS_COOLDOWN_MS - (now - lastBonus)) / 60000);
                throw {
                    message: `>=CA C65 ?>;CG5=. !;54CNI89 G5@57 ${nextIn} <8=.`,
                    code: 'DAILY_BONUS_ALREADY_CLAIMED',
                    statusCode: 400,
                    next_in_minutes: nextIn,
                    daily_streak: Number(player.daily_streak || 0)
                };
            }

            // !5@8O A>E@0=O5BAO, B>;L:> 5A;8 ?@>H;K9 1>=CA 1K; =5 1>;55 42CE
            // ACB>: =0704; 8=0G5 83@>: =0G8=05B 70=>2> A ?5@2>3> 4=O.
            const keepsStreak = lastBonus && (now - lastBonus) <= 2 * DAILY_BONUS_COOLDOWN_MS;
            const streak = keepsStreak ? Number(player.daily_streak || 0) + 1 : 1;
            const cappedDay = Math.min(streak, DAILY_BONUS_STREAK_LIMIT);

            const coins = DAILY_BONUS_BASE_COINS + (cappedDay - 1) * DAILY_BONUS_COINS_PER_DAY;
            const stars = cappedDay % DAILY_BONUS_STAR_EVERY === 0 ? 1 : 0;

            await client.query(
                `UPDATE players
                    SET coins = COALESCE(coins,0) + $1,
                        stars = COALESCE(stars,0) + $2,
                        daily_streak = $3,
                        last_daily_bonus = NOW()
                  WHERE id = $4`,
                [coins, stars, streak, playerId]
            );

            try {
                const helpers = getGameHelpers();
                const h = helpers;
                if (h && typeof h.checkAchievements === 'function') h.checkAchievements(playerId, client).catch(() => {});
            } catch (_) { /* ignore */ }

            return {
                success: true,
                message: `5=L ${streak}: +${coins} <>=5B${stars ? ` 8 +${stars} P` : ''}`,
                coins: coins,
                stars: stars,
                daily_streak: streak,
                coins_total: Number(player.coins || 0) + coins,
                stars_total: Number(player.stars || 0) + stars,
                next_claim_at: new Date(now + DAILY_BONUS_COOLDOWN_MS).toISOString(),
                log: { action: 'daily_bonus', playerId, data: { coins, stars, streak } }
            };
        });

        // >38@C5< ! :><<8B0 B@0=70:F88
        if (result.log) {
            try {
                await logPlayerAction(result.log.playerId, result.log.action, result.log.data);
            } catch (e) {
                // =5 2;8O5< =0 >B25B
            }
        }

        const { log: _log, ...responseData } = result;
        res.json({ success: true, data: responseData });
    } catch (err) {
        if (err.code === 'DAILY_BONUS_ALREADY_CLAIMED' || err.code === 'PLAYER_NOT_FOUND') {
            return res.status(err.statusCode || 400).json({
                success: false,
                error: err.message,
                code: err.code,
                next_in_minutes: err.next_in_minutes,
                daily_streak: err.daily_streak
            });
        }
        handleError(res, err, 'daily_bonus');
    }
});

//  >CB POST /auto-heal C40;Q= 2<5AB5 A 02B>8A?>;L7>20=85< ;5:0@AB2:
// =0AB@0820BL ?>@>3 8 2:;NG5=85 1>;LH5 =5 =C6=>  ;5G5=85 B>;L:> @CG=>5,
// :=>?:0<8 =0 ?0=5;8 ;5G5=8O 3;02=>3> M:@0=0.

/**
 * GET /achievements  4>AB865=8O 83@>:0
 */
router.get('/achievements', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);
        const achievements = await getPlayerAchievements(playerId);
        res.json({ success: true, data: achievements || [] });
    } catch (err) {
        handleError(res, err, 'get_achievements');
    }
});

/**
 * GET /achievements/progress  4>AB865=8O 2 D>@<0B5 M:@0=0 4>AB865=89.
 *
 * 0G5< >B45;L=> >B GET /achievements: B>B >B40QB �?;>A:89� A?8A>: 4;O
 * ?@>D8;O (id/key/desc/req/reward-G8A;><), 0 M:@0= 4>AB865=89 64QB
 * { progress: [...], categories: { key: {completed, total} } } A ?>;O<8
 * description/current/target/percent/completed 8 reward-*"
 * (renderAchievementsList G8B05B reward.coins 8 reward.stars).
 *
 * ;85=B 720; /api/achievements/progress, :>B>@>3> =5 ACI5AB2>20;>:
 * 404 Not found 8 ?CAB>9 M:@0= 4>AB865=89.
 *
 * target/current AG8B05< "  DC=:F8O<8, GB> 8 /progress
 * (getAchievementTargetValue / getAchievementCurrentValue): CA;>285 2 
 * E@0=8B F5;L 2 count, 2 value, 8;8 =5 E@0=8B 2>2A5 (first_boss_kill),
 * 8 A>1AB25==K9 @071>@ @07>HQ;AO 1K A M:@0=>< ?@>3@5AA0.
 */
router.get('/achievements/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return res.status(401).json({ error: '"@51C5BAO 02B>@870F8O' });
        }

        const helpers = getGameHelpers();
        const {
            getAchievementRuntimeContext,
            getAchievementTargetValue,
            getAchievementCurrentValue,
            safeJsonParse: parseJson
        } = helpers;

        // >AB865=8O + ?@>3@5AA 83@>:0
        const rowsResult = await query(`
            SELECT a.id, a.name, a.description, a.category, a.icon, a.rarity,
                   a.condition, a.reward,
                   pa.completed, pa.completed_at, pa.reward_claimed, pa.progress_value
              FROM achievements a
              LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
             ORDER BY a.category, a.id
        `, [playerId]);

        // !B0BK 83@>:0: =C6=K getAchievementCurrentValue (level, pvp_wins, ...)
        const playerResult = await queryOne(
            'SELECT level, pvp_wins, items_collected, clan_id, clan_role, daily_streak, unique_items, locations_visited FROM players WHERE id = $1',
            [playerId]
        );
        const player = playerResult || {};
        const runtimeContext = await getAchievementRuntimeContext(null, playerId);

        const progress = (rowsResult.rows || []).map(row => {
            const condition = parseJson(row.condition, {}) || {};
            const target = Math.max(0, Number(getAchievementTargetValue(condition, runtimeContext)) || 0);
            const stored = Math.max(0, Number(row.progress_value) || 0);
            const computed = Number(getAchievementCurrentValue(condition, player, runtimeContext)) || 0;
            // 5@Q< 1>;LH55 87 42CE: progress_value >1=>2;O5BAO D>=>2K<
            // >1@01>BG8:><, computed  682>9 @0AGQB. =0G5 ?@>3@5AA-10@
            // ?>:07K20; 1K 0 C B>;L:> GB> 2K?>;=5==>3> 4>AB865=8O.
            const current = Math.max(stored, computed);
            const reward = parseJson(row.reward, {}) || {};

            return {
                id: row.id,
                name: row.name,
                // ;85=BA:89 renderAchievementsList G8B05B 8<5==> description
                description: row.description || '',
                category: row.category,
                icon: row.icon,
                rarity: row.rarity,
                current: current,
                target: target,
                percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
                completed: Boolean(row.completed) || (target > 0 && current >= target),
                reward_claimed: Boolean(row.reward_claimed),
                // reward  *" {coins, stars}: :;85=B G8B05B reward.coins/stars.
                reward: {
                    coins: Number(reward.coins) || 0,
                    stars: Number(reward.stars) || 0
                }
            };
        });

        // @C??8@>2:0 4;O :=>?>: :0B53>@89: �=~ >AAK (3/5)�
        const categories = {};
        for (const item of progress) {
            const key = item.category || 'other';
            if (!categories[key]) categories[key] = { completed: 0, total: 0 };
            categories[key].total += 1;
            if (item.completed) categories[key].completed += 1;
        }

        res.json({ success: true, data: { progress, categories } });
    } catch (err) {
        logger.error({ type: 'achievements_progress_error', message: err.message });
        res.status(500).json({ error: 'H81:0 ?>;CG5=8O 4>AB865=89' });
    }
});

/**
 * POST /achievements/claim  ?>;CG8BL =03@04C 70 4>AB865=85
 */
router.post('/achievements/claim', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);

        const achievement_id = req.body?.achievement_id;
        //
        // !, + : ?@>25@O;>AL B>;L:> `!achievement_id`, :>B>@>5
        // >BA5:05B '' / null / 0, => ?@>?CA:05B 'abc' 8 '1.5'. 0;LH5
        // Number(achievement_id) 4020; NaN / 1.5, claimAchievementReward
        // >B4020; MB> 2 `WHERE a.id = $2` 8 Postgres >B25G0; 22P02
        // (invalid input syntax for integer)  500 2<5AB> 400.
        // ">B 65 validateId C65 8A?>;L7C5BAO 2 /clan/join 8 2 serverApi.
        const idCheck = validateId(achievement_id, 'ID 4>AB865=8O');
        if (!idCheck.ok) {
            return res.status(400).json({ success: false, error: idCheck.error, code: idCheck.code });
        }

        const helpers = getGameHelpers();
        const { claimAchievementReward } = helpers;

        const result = await claimAchievementReward(playerId, idCheck.value);
        
        res.json({ success: true, data: result });
    } catch (err) {
        handleError(res, err, 'claim_achievement');
    }
});

/**
 * GET /progress  ?@>3@5AA 83@>:0
 */
router.get('/progress', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) return unauthorized(res);
        const progress = await getPlayerProgress(playerId);
        res.json({ success: true, data: progress || {} });
    } catch (err) {
        handleError(res, err, 'get_progress');
    }
});

/**
 * GET /energy  B5:CI0O M=5@38O 83@>:0
 * GET /api/game/profile/energy (G5@57 0;80A /profile 2 routes/game/index.js:375)
 * >72@0I05B { success: true, data: { energy, max_energy, last_energy_update } }
 */
router.get('/energy', async (req, res) => {
    try {
        const playerId = req.player?.id;
        if (!playerId) {
            return unauthorized(res);
        }

        const player = await queryOne(
            'SELECT energy, max_energy, last_energy_update FROM players WHERE id = $1',
            [playerId]
        );
        if (!player) {
            return notFound(res, '3@>: =5 =0945=');
        }

        return ok(res, {
            energy: Number(player.energy),
            max_energy: Number(player.max_energy),
            last_energy_update: player.last_energy_update
        });
    } catch (err) {
        logger.error({ type: 'player_energy_error', message: err.message });
        return handleError(res, err, 'get_player_energy');
    }
});

module.exports = router;
