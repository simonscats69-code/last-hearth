/**
 * PvP (production-ready PvP)
 *
 * Основные:
 * - SELECT FOR UPDATE для блокировки строк
 * - Валидация ID (сущность)
 * - Ведение логов в player_logs
 * - Формат ответа { success, data/error, code }
 * - Логирование действий игрока
 * - Namespace: GamePVP
 * - Глобальный обработчик ошибок:
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
    unauthorized,
    PlayerHelper: playerHelper
} = require('../../utils/serverApi');

// Загружаем игровые хелперы из utils/game-helpers.js (оборудование, инвентарь и т.д.).
// ВАЖНО: работа с БД ведётся через db/database, а не напрямую — исключаем циклы.
// При необходимости пересоздать хелперы — utils/getGameHelpers.js.
const { getGameHelpers } = require('../../utils/getGameHelpers');
const { setPlayerEquipment } = require('../../db/playerRepository');

// Экземпляр хелперов (получаем один раз при загрузке модуля).
const helpers = getGameHelpers();
const { getActiveBuffs, normalizeInventory, recalcEnergy, normalizeEquipment, getSetBonuses, wearEquipmentSlots, addItemToInventory, trackCollectedItems } = helpers;
// Валидация ID (см. utils/validate.js).
const { validateId } = require('../../utils/validate');
// Максимальное количество слотов инвентаря (берём из equipment.js).
const equipmentRules = require('../../public/shared/equipment.js');
const MAX_INVENTORY_SLOTS = equipmentRules.MAX_INVENTORY_SLOTS;

/**
 * Ошибки PvP.
 *
 * Задаёт message, код и HTTP-статус. handleError из serverApi не раскрывает внутренние данные.
 */
const PvpError = {
    BANNED:            { message: 'Игрок заблокирован', code: 'BANNED', statusCode: 403 },
    NOT_RED_ZONE:      { message: 'PvP доступен только в красной зоне', code: 'NOT_RED_ZONE',      statusCode: 400 },
    NOT_SAME_LOCATION: { message: 'Игрок не в том же месте',       code: 'NOT_SAME_LOCATION', statusCode: 400 },
    TARGET_DEAD:       { message: 'Цель уже мертва',           code: 'PLAYER_DEAD',       statusCode: 400 },
    SELF_DEAD:         { message: 'Вы мертвы и не можете атаковать', code: 'PLAYER_DEAD',      statusCode: 400 },
    LEVEL_TOO_LOW:     { message: 'Уровень слишком низкий для PvP', code: 'PVP_LEVEL_TOO_LOW', statusCode: 400 },
    TARGET_PROTECTED:  { message: 'Цель защищена от PvP', code: 'TARGET_PROTECTED', statusCode: 400 },
    COOLDOWN:          { message: 'Пауза между атаками PvP', code: 'ATTACK_COOLDOWN', statusCode: 429 },
    TARGET_COOLDOWN:   { message: 'Цель находится на паузе PvP', code: 'TARGET_COOLDOWN',   statusCode: 429 },
    RATE_LIMIT:        { message: 'Слишком частые атаки одной цели', code: 'ATTACK_COOLDOWN', statusCode: 429 },
    TARGET_FARMED:     { message: 'Цель недавно атаковалась (лимит в час)', code: 'TARGET_FARMED', statusCode: 429 },
    ALREADY_IN_BATTLE: { message: 'Уже идёт активный бой PvP', code: 'ALREADY_IN_BATTLE', statusCode: 409 },
    INSUFFICIENT_ENERGY: { message: 'Недостаточно энергии для атаки', code: 'INSUFFICIENT_ENERGY', statusCode: 400 },
    INSUFFICIENT_ENERGY_HIT: { message: 'Недостаточно энергии для удара', code: 'INSUFFICIENT_ENERGY', statusCode: 400 },
    BATTLE_NOT_FOUND:  { message: 'Бой не найден',                   code: 'BATTLE_NOT_FOUND',   statusCode: 404 },
    PLAYER_NOT_FOUND:  { message: 'Игрок не найден',                 code: 'PLAYER_NOT_FOUND',   statusCode: 404 },
    BATTLE_FINISHED:   { message: 'Бой завершён',                code: 'BATTLE_FINISHED',    statusCode: 409 },
    NOT_PARTICIPANT:   { message: 'Вы не участник боя',       code: 'NOT_PARTICIPANT',    statusCode: 403 },
    INVALID_INPUT:     { message: 'Некорректные данные запроса',    code: 'VALIDATION_ERROR',   statusCode: 400 }
};

/**
 * Выбрасывает структурированную ошибку PvP.
 * @param {object} spec Спецификация из PvpError
 * @throws {object} { message, code, statusCode }
 */
function throwPvpError(spec) {
    throw { message: spec.message, code: spec.code, statusCode: spec.statusCode };
}

/**
 * Формирует HTTP-ответ об ошибке PvP.
 *
 * handleError из serverApi отдаёт код, statusCode и структурированное тело.
 * Для внутренней логики используются русские сообщения; клиенту уходит общий текст.
 *
 * @param {object} res express response
 * @param {Error|object} error ошибка
 * @param {string} action имя действия для логов
 * @param {number} [playerId] ID игрока
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
 * Успешный ответ PvP.
 *
 * Возвращает { success: true, ...data } или { success: true, data }.
 */
const ok = (res, data = {}) => res.json({ success: true, data });

/**
 * Ответ об ошибке PvP (4xx).
 *
 * @param {object} res express response
 * @param {string} message текст ошибки
 * @param {string} [code] код ошибки
 * @param {number} [statusCode] HTTP-статус
 */
const fail = (res, message, code = 'ERROR', statusCode = 400) =>
    res.status(statusCode).json({ success: false, error: message, code });



/**
 * Список игроков для PvP.
 * GET /pvp/players?limit=20&offset=0 → GET /api/game/pvp/players
 * Алиас: /players (префикс /api/game)
 */
router.get('/players', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    if (!playerId) return unauthorized(res);
    
    try {
        let limit = parseInt(req.query.limit, 10) || 20;
        let offset = parseInt(req.query.offset, 10) || 0;
        
        limit = Math.min(Math.max(1, limit), 100);
        offset = Math.max(0, offset);

        const location = await queryOne(`
            SELECT danger_level FROM locations WHERE id = $1
        `, [player.current_location_id]);
        
        if (!location || Number(location.danger_level || 0) < 6) {
            return ok(res, {
                available: false,
                message: 'PvP доступен только в красной зоне'
            });
        }

        // Список живых игроков в той же красной зоне, кроме себя.
        // COUNT(*) OVER() даёт общее количество без дополнительного запроса.
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

        const total = resultRows.length > 0
            ? parseInt(resultRows[0].total_count || 0, 10)
            : 0;

        const players = resultRows.map(({ total_count, ...playerRow }) => playerRow);

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
 * Начало атаки PvP.
 * POST /pvp/attack → POST /api/game/pvp/attack
 * Алиас: /attack (префикс /api/game)
 */
router.post('/attack', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    if (!playerId) return unauthorized(res);

    try {
        if (!req.body || typeof req.body !== 'object') {
            return fail(res, 'Некорректное тело запроса', 'INVALID_REQUEST_BODY', 400);
        }

        const { target_id } = req.body;

        const targetIdCheck = validateId(target_id, 'ID цели');
        if (!targetIdCheck.ok) {
            return fail(res, 'Некорректный ID цели (ожидалось число)', 'INVALID_TARGET_ID');
        }
        const targetId = targetIdCheck.value;

        if (targetId === playerId) {
            return fail(res, 'Нельзя атаковать себя', 'SELF_TARGET');
        }

        const outcome = await transaction(async (client) => {
            // Блокируем игроков в строгом порядке ID — защита от deadlock.
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

            await recalcEnergy(client, lockedPlayer);

            const startBuffs = getActiveBuffs(lockedPlayer.buffs);

            if (!startBuffs.free_energy && Number(lockedPlayer.energy || 0) < 1) {
                throwPvpError(PvpError.INSUFFICIENT_ENERGY);
            }

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

            const battle = await pvp.createPVPMatch(playerId, targetId, lockedPlayer.current_location_id, client, damageBonus);

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

        if (outcome.log) {
            await logPlayerAction(outcome.log.playerId, outcome.log.action, outcome.log.data);
        }

        ok(res, outcome);

    } catch (error) {
        return handleError(res, error, 'pvp_attack', playerId);
    }
});

/**
 * Реванш после проигрыша.
 * POST /pvp/revanche → POST /api/game/pvp/revanche
 */
router.post('/revanche', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    const { target_id } = req.body || {};

    try {
        if (!playerId) {
            return fail(res, 'Требуется авторизация', 'UNAUTHORIZED', 401);
        }

        const targetIdCheck = validateId(target_id, 'ID цели');
        if (!targetIdCheck.ok) {
            return fail(res, 'Некорректный ID цели', 'INVALID_TARGET_ID');
        }
        const targetId = targetIdCheck.value;

        const targetCheck = await queryOne('SELECT id, banned, health, level FROM players WHERE id = $1', [targetId]);
        if (!targetCheck) {
            return res.status(404).json({ success: false, error: 'Игрок не найден', code: 'PLAYER_NOT_FOUND' });
        }
        if (targetCheck.banned) {
            return res.status(403).json({ success: false, error: 'Игрок заблокирован', code: 'BANNED' });
        }
        if (Number(targetCheck.health || 0) <= 0) {
            return res.status(400).json({ success: false, error: 'Цель мертва', code: 'TARGET_DEAD' });
        }
        if (Number(targetCheck.level || 0) < 5) {
            return res.status(400).json({ success: false, error: 'Цель защищена от PvP', code: 'TARGET_PROTECTED' });
        }

        const outcome = await transaction(async (client) => {
            const p = await lockPlayer(playerId, client, 'revanche_against, revanche_expires_at, revanche_bonus');
            if (!p) throwPvpError(PvpError.PLAYER_NOT_FOUND);

            if (Number(p.revanche_against) !== targetId) {
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Нет активного реванша против этого игрока',
                        code: 'NO_REVANCHE'
                    }
                };
            }

            if (p.revanche_expires_at && new Date(p.revanche_expires_at) <= new Date()) {
                await client.query(
                    `UPDATE players SET revanche_against = NULL, revanche_expires_at = NULL WHERE id = $1`,
                    [playerId]
                );
                return {
                    status: 400,
                    body: {
                        success: false,
                        error: 'Срок реванша истёк',
                        code: 'REVANCHE_EXPIRED'
                    }
                };
            }

            const bonus = Number(p.revanche_bonus || 25);

            return {
                battle_id: null,
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

        if (outcome.log) {
            await logPlayerAction(outcome.log.playerId, outcome.log.action, outcome.log.data);
        }

        ok(res, {
            bonus_percent: outcome.bonus_percent,
            target_id: outcome.target.id,
            message: `Реванш доступен! Бонус +${outcome.bonus_percent}% к следующей атаке.`
        });

    } catch (error) {
        return handleError(res, error, 'pvp_revanche', playerId);
    }
});

/**
 * Лог боя PvP.
 * GET /pvp/battle-log/:battle_id → GET /api/game/pvp/battle-log/:battle_id
 */
router.get('/battle-log/:battle_id', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    const { battle_id } = req.params;

    try {
        if (!playerId) {
            return fail(res, 'Требуется авторизация', 'UNAUTHORIZED', 401);
        }

        const battleIdCheck = validateId(battle_id, 'ID боя');
        if (!battleIdCheck.ok) {
            return fail(res, 'Некорректный ID боя', 'INVALID_BATTLE_ID');
        }
        const battleId = battleIdCheck.value;

        const battle = await queryOne(
            `SELECT attacker_id, defender_id FROM pvp_battles WHERE id = $1`,
            [battleId]
        );
        if (!battle) {
            return fail(res, 'Бой не найден', 'BATTLE_NOT_FOUND', 404);
        }
        if (Number(battle.attacker_id) !== playerId && Number(battle.defender_id) !== playerId) {
            return fail(res, 'Вы не участник боя', 'NOT_PARTICIPANT', 403);
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
 * Удар в бою PvP.
 * POST /pvp/attack-hit → POST /api/game/pvp/attack-hit
 * Алиас: /attack-hit (префикс /api/game)
 */
router.post('/attack-hit', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    if (!playerId) return unauthorized(res);

    try {
        if (!req.body || typeof req.body !== 'object') {
            return fail(res, 'Некорректное тело запроса', 'INVALID_REQUEST_BODY', 400);
        }
        const { battle_id } = req.body;
        
        const battleIdCheck = validateId(battle_id, 'ID боя');
        if (!battleIdCheck.ok) {
            return fail(res, 'Некорректный ID боя (ожидалось число)', 'INVALID_BATTLE_ID');
        }
        const battleId = battleIdCheck.value;

        let expLogData = null;
        const outcome = await transaction(async (client) => {
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

            const attackerIdRaw = Number(battleData.attacker_id);
            const defenderIdRaw = Number(battleData.defender_id);

            if (attackerIdRaw !== playerId && defenderIdRaw !== playerId) {
                throwPvpError(PvpError.NOT_PARTICIPANT);
            }

            const isAttacker = attackerIdRaw === playerId;
            const attackerId = isAttacker ? attackerIdRaw : defenderIdRaw;
            const defenderId = isAttacker ? defenderIdRaw : attackerIdRaw;

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

            if (Number(attacker.health || 0) <= 0) {
                throwPvpError(PvpError.SELF_DEAD);
            }
            if (Number(defender.health || 0) <= 0) {
                throwPvpError(PvpError.TARGET_DEAD);
            }

            const activeBuffs = getActiveBuffs(attacker.buffs);
            await recalcEnergy(client, attacker);
            if (!activeBuffs.free_energy && Number(attacker.energy || 0) < 1) {
                throwPvpError(PvpError.INSUFFICIENT_ENERGY_HIT);
            }

            const energyCost = activeBuffs.free_energy ? 0 : 1;

            const energyResult = await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - $1)
                 WHERE id = $2
                 RETURNING energy, max_energy, last_energy_update`,
                [energyCost, attackerId]
            );
            if (!energyResult.rows[0]) {
                throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
            }
            const energyLeft = Number(energyResult.rows[0]?.energy || 0);
            const energyLastUpdate = energyResult.rows[0]?.last_energy_update || null;

            const attackerEq = normalizeEquipment(attacker.equipment);
            const defenderEq = normalizeEquipment(defender.equipment);
            const attackerSetBonuses = await getSetBonuses(attackerEq, client);
            let damage = pvp.calculatePVPDamage(
                { ...attacker, equipment: attackerEq, set_damage: attackerSetBonuses.damage || 0 },
                { ...defender, equipment: defenderEq }
            ).damage;

            const battleDamageBonus = Number(battleData.damage_bonus || 0);
            if (battleDamageBonus > 0 && isAttacker) {
                damage = Math.floor(damage * (1 + battleDamageBonus / 100));
            }

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

                await client.query(
                    `INSERT INTO pvp_battle_log (battle_id, round_number, attacker_id, defender_id, damage, is_dodged, defender_health_after)
                     VALUES ($1, (SELECT COALESCE(MAX(round_number), 0) + 1 FROM pvp_battle_log WHERE battle_id = $2), $3, $4, 0, true, $5)`,
                    [battleId, battleId, attackerId, defenderId, defender.health]
                );

                return {
                    dodged: true,
                    battleEnded: false,
                    message: 'Цель увернулась от удара!',
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

            const newHealth = Math.max(0, defender.health - damage);

            const attackerBroken = wearEquipmentSlots(attackerEq, ['weapon']);
            const defenderBroken = wearEquipmentSlots(defenderEq, equipmentRules.EQUIPMENT_SLOTS);

            await client.query(`
                UPDATE players
                   SET health = $1,
                       equipment = $2::jsonb
                 WHERE id = $3
            `, [newHealth, JSON.stringify(defenderEq), defenderId]);

            await client.query(
                `INSERT INTO pvp_battle_log (battle_id, round_number, attacker_id, defender_id, damage, is_dodged, defender_health_after)
                 VALUES ($1, (SELECT COALESCE(MAX(round_number), 0) + 1 FROM pvp_battle_log WHERE battle_id = $2), $3, $4, $5, false, $6)`,
                [battleId, battleId, attackerId, defenderId, damage, newHealth]
            );

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
            const ALLOWED_DAMAGE_FIELDS = new Set(['attacker_damage', 'defender_damage']);
            if (!ALLOWED_DAMAGE_FIELDS.has(battleDamageField)) {
                throw { message: 'Некорректное поле урона', code: 'INTERNAL_ERROR', statusCode: 500 };
            }
            await client.query(
                `UPDATE pvp_battles
                 SET ${battleDamageField} = COALESCE(${battleDamageField}, 0) + $1,
                     battle_duration = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::integer)
                 WHERE id = $2`,
                [damage, battleId]
            );

            let battleEnded = false;
            let rewards = null;
            let winner = null;
            let loser = null;
            let battleLogData = null;

            const defenderHealth = newHealth;

            if (defenderHealth <= 0) {
                battleEnded = true;

                const coinsReward = pvp.calculateCoinsToSteal(defender.coins);

                const defenderInventory = await (helpers.loadInventoryFromTable || (async () => null))(client, defenderId) || normalizeInventory(defender.inventory);
                const attackerInventory = await (helpers.loadInventoryFromTable || (async () => null))(client, attackerId) || normalizeInventory(attacker.inventory);
                let stolenItem = null;

                if (crypto.randomInt(10) === 0) {
                    const [stolen] = pvp.getRandomItemsToSteal(defenderInventory, 1);
                    if (stolen && attackerInventory.length < MAX_INVENTORY_SLOTS) {
                        const stolenIndex = defenderInventory.indexOf(stolen);
                        if (stolenIndex < 0) {
                            stolenItem = null;
                        } else {
                            const stackQuantity = Math.max(1, Number(stolen.quantity || 1));
                            const isEquipment = equipmentRules.isEquipmentItem(stolen);

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
                
                // Начисление опыта за победу — один вызов, чтобы не было дюпа.
                const expResult = await playerHelper.addExperience(attackerId, pvpExpReward, client);
                expLogData = expResult.logData;

                await client.query(`
                    UPDATE players
                    SET pvp_losses = pvp_losses + 1,
                        pvp_streak = 0,
                        pvp_rating = GREATEST(500, pvp_rating - 15),
                        coins = GREATEST(0, coins - $1),
                        coins_stolen_from_me = coins_stolen_from_me + $1,
                        items_stolen_from_me = items_stolen_from_me + $2,
                        current_location_id = COALESCE($3, current_location_id),
                        revanche_against = $4,
                        revanche_expires_at = NOW() + INTERVAL '24 hours',
                        revanche_bonus = 25
                    WHERE id = $5
                `, [coinsReward, stolenItem ? 1 : 0, safeLocationId, attackerId, defenderId]);

                await client.query(`
                    UPDATE players SET coins = coins + $1 WHERE id = $2
                `, [coinsReward, attackerId]);

                if (stolenItem) {
                    await helpers.syncInventoryToTable(client, defenderId, defenderInventory);
                    await helpers.syncInventoryToTable(client, attackerId, attackerInventory);
                    await client.query(
                        `UPDATE players SET items_collected = COALESCE(items_collected, 0) + 1 WHERE id = $1`,
                        [attackerId]
                    );
                }

                rewards = {
                    coins: coinsReward,
                    item: stolenItem,
                    experience: pvpExpReward
                };
                winner = { id: attackerId };
                loser = { id: defenderId };

                const cooldownMin = 5;
                 await client.query(
                    `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
                     VALUES
                         ($1, 'pvp_battle', NOW() + $3 * interval '1 minute'),
                         ($2, 'pvp_battle', NOW() + $3 * interval '1 minute')
                     ON CONFLICT (player_id, cooldown_type)
                     DO UPDATE SET expires_at = NOW() + $3 * interval '1 minute'`,
                    [attackerId, defenderId, cooldownMin]
                );
                await client.query(
                    `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
                     VALUES ($1, 'pvp_target_' || $2, NOW() + '10 minutes'::interval)
                     ON CONFLICT (player_id, cooldown_type)
                     DO UPDATE SET expires_at = NOW() + '10 minutes'::interval`,
                    [attackerId, defenderId]
                );

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
 * Статистика PvP.
 * GET /pvp/stats → GET /api/game/pvp/stats
 * Алиас: /stats (префикс /api/game)
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
                ? (battle.defender_username || battle.defender_first_name || 'Игрок')
                : (battle.attacker_username || battle.attacker_first_name || 'Игрок');

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
