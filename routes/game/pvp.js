/**
 * PvP (production-ready версия)
 * 
 * Улучшения:
 * - Транзакции с SELECT FOR UPDATE для атомарности
 * - Валидация входных данных (ID)
 * - Логирование действий в player_logs
 * - Единый формат ответов { success, data/error, code }
 * - Пагинация для списка игроков
 * - Namespace: GamePVP
 * - Централизованный обработчик ошибок
 */

const express = require('express');
const router = express.Router();
const { queryOne, queryAll, transaction } = require('../../db/database');
const pvp = require('../../db/pvp');
const crypto = require('crypto');
const {
    logger,
    logPlayerAction,
    logPlayerError,
    handleError: apiHandleError,
    // Сериализация инвентаря при краже предметов в бою.
    safeStringify,
    PlayerHelper: playerHelper
} = require('../../utils/serverApi');

// Ленивая загрузка helpers: utils/game-helpers.js — единственный источник
// функций состояния игрока. Он тянет db/database, поэтому импорт ленивый
// (иначе цикл загрузки модулей). Общий загрузчик — utils/getGameHelpers.js.
const { getGameHelpers } = require('../../utils/getGameHelpers');

// Экспортируемые функции через getGameHelpers()
const helpers = getGameHelpers();
const { getActiveBuffs, normalizeInventory, recalcEnergy, normalizeEquipment, getSetBonuses, wearEquipmentSlots, addItemToInventory, applyAutoHeal } = helpers;
// Валидация ID — общая, см. utils/validate.js.
const { validateId } = require('../../utils/validate');
// Файл правил предметов импортируется один раз: брать его и по имени
// модуля, и по пути в двух местах не нужно — при втором импорте легко
// получить другой набор констант, чем ожидал автор.
// MAX_INVENTORY_SLOTS — иначе кража предмета могла выдать 101-й слот
// инвентаря и заблокировать добычу. equipmentRules отвечает и за «снаряжение
// ли это» — от этого зависит, крадут ли предмет целиком или одну штуку.
const equipmentRules = require('../../public/shared/equipment.js');
const MAX_INVENTORY_SLOTS = equipmentRules.MAX_INVENTORY_SLOTS;

/**
 * Ошибки PvP.
 * 
 * Каждое правило бросает объект с явными code и statusCode.
 * handleError из serverApi читает их напрямую.
 */
const PvpError = {
    PLAYER_NOT_FOUND:  { message: 'Игрок не найден',              code: 'PLAYER_NOT_FOUND',  statusCode: 404 },
    NOT_RED_ZONE:      { message: 'PvP доступно только на красных зонах', code: 'NOT_RED_ZONE',      statusCode: 400 },
    NOT_SAME_LOCATION: { message: 'Игрок не на этой локации',       code: 'NOT_SAME_LOCATION', statusCode: 400 },
    TARGET_DEAD:       { message: 'Противник уже мертв',           code: 'PLAYER_DEAD',       statusCode: 400 },
    SELF_DEAD:         { message: 'Вы мертвы и не можете атаковать', code: 'PLAYER_DEAD',      statusCode: 400 },
    LEVEL_TOO_LOW:     { message: 'Игроки ниже 5 уровня не могут участвовать в PvP', code: 'PVP_LEVEL_TOO_LOW', statusCode: 400 },
    TARGET_PROTECTED:  { message: 'Цель защищена от PvP до 5 уровня', code: 'TARGET_PROTECTED', statusCode: 400 },
    COOLDOWN:          { message: 'Подождите перед следующим PvP боем', code: 'ATTACK_COOLDOWN', statusCode: 429 },
    TARGET_COOLDOWN:   { message: 'Противник временно защищён от PvP', code: 'TARGET_COOLDOWN',   statusCode: 429 },
    RATE_LIMIT:        { message: 'Нельзя атаковать эту цель слишком часто', code: 'ATTACK_COOLDOWN', statusCode: 429 },
    ALREADY_IN_BATTLE: { message: 'Один из игроков уже находится в активном PvP бою', code: 'ALREADY_IN_BATTLE', statusCode: 409 },
    INSUFFICIENT_ENERGY: { message: 'Недостаточно энергии для атаки', code: 'INSUFFICIENT_ENERGY', statusCode: 400 },
    INSUFFICIENT_ENERGY_HIT: { message: 'Недостаточно энергии для удара', code: 'INSUFFICIENT_ENERGY', statusCode: 400 },
    BATTLE_NOT_FOUND:  { message: 'Бой не найден',                   code: 'BATTLE_NOT_FOUND',   statusCode: 404 },
    BATTLE_FINISHED:   { message: 'Бой уже завершён',                code: 'BATTLE_FINISHED',    statusCode: 409 },
    NOT_PARTICIPANT:   { message: 'Вы не участник этого боя',       code: 'NOT_PARTICIPANT',    statusCode: 403 },
    INVALID_INPUT:     { message: 'Некорректные данные запроса',    code: 'VALIDATION_ERROR',   statusCode: 400 }
};

/**
 * Бросить игровую ошибку PvP с явным кодом.
 * @param {object} spec элемент PvpError
 * @throws {object} { message, code, statusCode }
 */
function throwPvpError(spec) {
    throw { message: spec.message, code: spec.code, statusCode: spec.statusCode };
}

/**
 * Ответ об ошибке PvP.
 *
 * Обработка кодов и статусов теперь общая (handleError из serverApi):
 * он берёт code и statusCode из выброшенного объекта. Локальная копия
 * разбирала текст сообщения по подстрокам, из-за чего обычное игровое
 * ограничение («Игроки ниже 5 уровня...») уходило клиенту как
 * INTERNAL_ERROR с HTTP 500 и текстом «Внутренняя ошибка сервера».
 *
 * Сохранена только та часть, которой нет в общем обработчике: запись
 * ошибки в лог конкретного игрока.
 *
 * @param {object} res ответ express
 * @param {Error|object} error ошибка
 * @param {string} action имя операции для логов
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
 * Формат здесь плоский — { success: true, ...данные }, а не общий
 * { success: true, data }. Клиент читает оба: `result?.data || result`.
 * Оставлено как есть, чтобы ответы PvP не поехали вместе с общим
 * изменением — это отдельная задача на весь проект, где у endpoints
 * разные формы (см. также ok() в db и маршруты).
 *
 * @param {object} res ответ express
 * @param {object} [data] данные ответа
 */
const ok = (res, data = {}) => res.json({ success: true, ...data });

/**
 * Ошибка клиентского запроса PvP (4xx).
 * Форма ответа совпадает с общей fail() из serverApi.
 *
 * @param {object} res ответ express
 * @param {string} message текст ошибки
 * @param {string} [code] код ошибки
 * @param {number} [statusCode] HTTP-статус
 */
const fail = (res, message, code = 'ERROR', statusCode = 400) =>
    res.status(statusCode).json({ success: false, error: message, code });



/**
 * Получение списка игроков для PvP с пагинацией
 * GET /pvp/players?limit=20&offset=0 → GET /api/game/pvp/players
 * Путь: /players (внутри роутера)
 */
router.get('/players', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    try {
        // Пагинация
        let limit = parseInt(req.query.limit) || 20;
        let offset = parseInt(req.query.offset) || 0;
        
        limit = Math.min(Math.max(1, limit), 100);
        offset = Math.max(0, offset);

        // Проверяем, что игрок на красной зоне
        const location = await queryOne(`
            SELECT danger_level FROM locations WHERE id = $1
        `, [player.current_location_id]);
        
        if (!location || Number(location.danger_level || 0) < 6) {
            return ok(res, {
                available: false,
                message: 'PvP доступно только на красных зонах'
            });
        }

        // Получаем игроков на той же локации с пагинацией.
        // Фильтры те же, что и в проверке атаки (/attack): banned исключает
        // забаненных (иначе они видны как цели, хотя атаковать их нельзя),
        // health > 0 — мёртвый противник всё равно отклоняется в /attack
        // («Противник уже мертв»), то есть это был клик в никуда.
        //
        // COUNT(*) OVER() считает общее число подходящих строк в том же
        // проходе выборки: раньше total приходилось считать отдельным
        // запросом с тем же WHERE — два прохода по players на каждый
        // рендер списка потенциальных целей.
        // ВАЖНО: queryAll() возвращает массив строк, а не { rows }.
        const resultRows = await queryAll(`
            SELECT id, telegram_id, username, first_name, level,
                   health, max_health, strength, endurance, agility,
                   pvp_wins, pvp_rating, pvp_streak,
                   COUNT(*) OVER() AS total_count
            FROM players
            WHERE current_location_id = $1 AND id != $2
              AND banned = false AND health > 0
            LIMIT $3 OFFSET $4
        `, [player.current_location_id, playerId, limit, offset]);

        // total одинаков для всех строк; если строк нет, total = 0
        const total = resultRows.length > 0
            ? parseInt(resultRows[0].total_count || 0)
            : 0;

        // Убираем служебное поле из ответа клиенту
        const players = resultRows.map(({ total_count, ...playerRow }) => playerRow);

        // Логируем
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
 * Начало PvP атаки (с транзакцией)
 * POST /pvp/attack → POST /api/game/pvp/attack
 * Путь: /attack (внутри роутера)
 */
router.post('/attack', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;

    try {
        // Валидация входных данных
        const { target_id } = req.body;
        
        // Общая валидация ID (utils/validate.js). Возвращает нормализованное
        // число, поэтому id, пришедший строкой из JSON, тоже валиден.
        const targetIdCheck = validateId(target_id, 'ID цели');
        if (!targetIdCheck.ok) {
            return fail(res, 'Укажите корректный ID цели (число > 0)', 'INVALID_TARGET_ID');
        }
        const targetId = targetIdCheck.value;

        if (targetId === playerId) {
            return fail(res, 'Нельзя атаковать самого себя', 'SELF_TARGET');
        }

        // Выполняем атаку в транзакции с блокировкой обоих игроков.
        // Результат содержит данные ответа и лог: лог уходит после COMMIT.
        const outcome = await transaction(async (client) => {
            // Блокируем обоих игроков в порядке возрастания ID для предотвращения deadlock
            // Сравниваются нормализованные числа (targetId), а не строки из
            // тела запроса: порядок нужен для единого порядка блокировок.
            const [firstId, secondId] = playerId < targetId
                ? [playerId, targetId]
                : [targetId, playerId];
            
            const firstResult = await client.query(
                `SELECT * FROM players WHERE id = $1 FOR UPDATE`,
                [firstId]
            );
            const secondResult = await client.query(
                `SELECT * FROM players WHERE id = $1 FOR UPDATE`,
                [secondId]
            );
            
            if (!firstResult.rows[0] || !secondResult.rows[0]) {
                throwPvpError(PvpError.PLAYER_NOT_FOUND);
            }
            
            const lockedPlayer = firstId === playerId ? firstResult.rows[0] : secondResult.rows[0];
            const targetPlayer = firstId === targetId ? firstResult.rows[0] : secondResult.rows[0];

            // Проверяем красную зону
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

            const attackerProtected = await pvp.isProtectedFromPVP(playerId, client);
            if (attackerProtected) {
                throwPvpError(PvpError.LEVEL_TOO_LOW);
            }

            const targetProtected = await pvp.isProtectedFromPVP(targetId, client);
            if (targetProtected) {
                throwPvpError(PvpError.TARGET_PROTECTED);
            }

            // Объединённый запрос всех кулдаунов для обоих игроков (вместо 3-х отдельных)
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

const existingBattleResult = await client.query(
                `SELECT id, attacker_id, defender_id
                 FROM pvp_battles
                 WHERE status = 'active'
                   AND (attacker_id = $1 OR defender_id = $1 OR attacker_id = $2 OR defender_id = $2)
                   LIMIT 1`,
                [playerId, targetId]
            );

            if (existingBattleResult.rows[0]) {
                throwPvpError(PvpError.ALREADY_IN_BATTLE);
            }

            // P0-1: пересчитываем энергию по реальному времени ПЕРЕД проверкой
            await recalcEnergy(client, lockedPlayer);

            const startBuffs = getActiveBuffs(lockedPlayer.buffs);

            // Проверяем наличие энергии ДО списания
            if (!lockedPlayer || (!startBuffs.free_energy && Number(lockedPlayer.energy || 0) < 1)) {
                throwPvpError(PvpError.INSUFFICIENT_ENERGY);
            }

            // Создаём сессию боя с передачей client для работы внутри транзакции
            const battle = await pvp.createPVPMatch(playerId, targetId, lockedPlayer.current_location_id, client);

            // Возвращаем результат и данные для логирования ПОСЛЕ коммита
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

        // Логируем ПОСЛЕ коммита транзакции
        if (outcome.log) {
            await logPlayerAction(outcome.log.playerId, outcome.log.action, outcome.log.data);
        }

        ok(res, outcome);

    } catch (error) {
        return handleError(res, error, 'pvp_attack', playerId);
    }
});

/**
 * Удар в PvP (с транзакцией)
 * POST /pvp/attack-hit → POST /api/game/pvp/attack-hit
 * Путь: /attack-hit (внутри роутера)
 */
router.post('/attack-hit', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;

    try {
        // Валидация
        const { battle_id } = req.body;
        
        const battleIdCheck = validateId(battle_id, 'ID боя');
        if (!battleIdCheck.ok) {
            return fail(res, 'Укажите корректный ID боя (число > 0)', 'INVALID_BATTLE_ID');
        }
        const battleId = battleIdCheck.value;

        // Выполняем удар в транзакции
        // Результат транзакции: содержит данные ответа и лог.
        // Логи уходят после COMMIT — см. ниже.
        const outcome = await transaction(async (client) => {
            // Получаем бой
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

            // КРИТИЧНО: attacker_id/defender_id — BIGINT, а pg отдаёт int8
            // СТРОКОЙ ('42'), тогда как req.player.id — число (buildRequestPlayer
            // делает Number(dbPlayer.id)). Строгое сравнение строки с числом
            // всегда даёт false, поэтому проверка участника срабатывала
            // ошибочно: удар в PvP отклонялся с «Вы не участник этого боя»
            // ЛИБО проходил для защитника, который тут же становился
            // «атакующим» (isAttacker = false). Приводим к Number явно.
            const attackerIdRaw = Number(battleData.attacker_id);
            const defenderIdRaw = Number(battleData.defender_id);

            if (attackerIdRaw !== playerId && defenderIdRaw !== playerId) {
                throwPvpError(PvpError.NOT_PARTICIPANT);
            }

            // Определяем атакующего и защитника
            const isAttacker = attackerIdRaw === playerId;
            const attackerId = isAttacker ? attackerIdRaw : defenderIdRaw;
            const defenderId = isAttacker ? defenderIdRaw : attackerIdRaw;

            // Блокируем обоих игроков в определённом порядке для предотвращения deadlock
            const [firstId, secondId] = attackerId < defenderId
                ? [attackerId, defenderId]
                : [defenderId, attackerId];
            
            const firstPlayerResult = await client.query(
                `SELECT * FROM players WHERE id = $1 FOR UPDATE`,
                [firstId]
            );
            const secondPlayerResult = await client.query(
                `SELECT * FROM players WHERE id = $1 FOR UPDATE`,
                [secondId]
            );
            
            const firstPlayer = firstPlayerResult.rows[0];
            const secondPlayer = secondPlayerResult.rows[0];
            const attacker = attackerId === firstId ? firstPlayer : secondPlayer;
            const defender = defenderId === firstId ? firstPlayer : secondPlayer;

            if (!attacker || !defender) {
                throwPvpError(PvpError.PLAYER_NOT_FOUND);
            }

            // Проверяем, что игрок жив перед атакой
            if (attacker.health <= 0) {
                throwPvpError(PvpError.SELF_DEAD);
            }
            if (defender.health <= 0) {
                throwPvpError(PvpError.TARGET_DEAD);
            }

            const activeBuffs = getActiveBuffs(attacker.buffs);
            // P0-1: пересчитываем энергию по реальному времени перед тратой
            await recalcEnergy(client, attacker);
            if (!activeBuffs.free_energy && Number(attacker.energy || 0) < 1) {
                throwPvpError(PvpError.INSUFFICIENT_ENERGY_HIT);
            }

            const energyCost = activeBuffs.free_energy ? 0 : 1;

            // Энергия: last_energy_update НЕ двигаем — реген идёт от реально
            // прошедшего времени, иначе удар обнулил бы накопленный реген.
            // Единое правило описано в utils/game-helpers.js (recalcEnergy).
            const energyResult = await client.query(
                `UPDATE players
                 SET energy = GREATEST(0, energy - $1)
                 WHERE id = $2
                 RETURNING energy, max_energy, last_energy_update`,
                [energyCost, attackerId]
            );
            const energyLeft = Number(energyResult.rows[0]?.energy || 0);
            const energyLastUpdate = energyResult.rows[0]?.last_energy_update || null;

            // P1-6: формулы с насыщением (soft caps) — вынесены в db/pvp.js
            const attackerEq = normalizeEquipment(attacker.equipment);
            const defenderEq = normalizeEquipment(defender.equipment);
            // Бонус сета атакующего (урон) — считаем один раз для обоих.
            const attackerSetBonuses = await getSetBonuses(attackerEq);
            let damage = pvp.calculatePVPDamage(
                { ...attacker, equipment: attackerEq, set_damage: attackerSetBonuses.damage || 0 },
                { ...defender, equipment: defenderEq }
            ).damage;

            // Уклонение (soft cap 20%)
            const dodgeChance = Math.min(20, defender.agility / (defender.agility + 40) * 20);
            const isDodged = crypto.randomInt(100) < dodgeChance;
            
            if (isDodged) {
                await client.query(
                    `UPDATE pvp_battles
                     SET battle_duration = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::integer)
                     WHERE id = $1`,
                    [battleId]
                );

                // Уклонение защитник увидит только на своём экране PvP: активных
                // push-уведомлений нет, бой подтягивается по /matches.
                return {
                    dodged: true,
                    battleEnded: false,
                    message: 'Противник уклонился от атаки!',
                    hit: {
                        damage: 0,
                        yourHealth: attacker.health,
                        targetHealth: defender.health,
                        maxHealth: defender.max_health
                    },
                    energy_left: energyLeft,
                    last_energy_update: energyLastUpdate
                };
            }

            // Применяем урон
            const newHealth = Math.max(0, defender.health - damage);

            // Износ снаряжения: оружие атакующего и броня защитника.
            const attackerBroken = wearEquipmentSlots(client, attackerId, attackerEq, ['weapon']);
            const defenderBroken = wearEquipmentSlots(client, defenderId, defenderEq,
                ['body', 'head', 'hands', 'legs', 'boots', 'armor', 'helmet', 'accessory']);

            await client.query(`
                UPDATE players
                   SET health = $1,
                       equipment = $2::jsonb
                 WHERE id = $3
            `, [newHealth, JSON.stringify(defenderEq), defenderId]);

            // Автолечение защитника: то же, что и в бою с боссом — если у
            // него здоровье упало ниже порога, игра сама выпьет лекарство.
            // PvP без этого превращался в «добивай в ноль», потому что
            // защитник не успевал/не мог вылечиться.
            const defenderAutoHeal = await applyAutoHeal(client, defenderId, {
                ...defender,
                health: newHealth,
                auto_heal_enabled: defender.auto_heal_enabled,
                auto_heal_threshold: defender.auto_heal_threshold
            });

            // Износ оружия атакующего сохраняем ВСЕГДА, а не только при поломке:
            // иначе −1 прочности за удар просто терялся бы в памяти.
            await client.query(
                'UPDATE players SET equipment = $1::jsonb WHERE id = $2',
                [JSON.stringify(attackerEq), attackerId]
            );

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
            await client.query(
                `UPDATE pvp_battles
                 SET ${battleDamageField} = COALESCE(${battleDamageField}, 0) + $1,
                     battle_duration = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::integer)
                 WHERE id = $2`,
                [damage, battleId]
            );

            // Проверяем победу
            let battleEnded = false;
            let rewards = null;
            let winner = null;
            let loser = null;
            // Данные для логов собираем здесь и формируем ПОСЛЕ коммита
            // транзакции: падение записи лога не должно откатывать бой.
            let battleLogData = null;

            // Победа считается по здоровью ПОСЛЕ автолечения: если защитник
            // автоматически выпил лекарство, он не погиб.
            const defenderHealth = defenderAutoHeal ? defenderAutoHeal.health : newHealth;

            if (defenderHealth <= 0) {
                battleEnded = true;

                // Награда победителю — формулы вынесены в db/pvp.js
                const coinsReward = pvp.calculateCoinsToSteal(defender.coins);

                // Шанс украсть предмет (снижено с 30% до 10%)
                const defenderInventory = normalizeInventory(defender.inventory);
                const attackerInventory = normalizeInventory(attacker.inventory);
                let stolenItem = null;

                if (crypto.randomInt(10) === 0) {
                    const [stolen] = pvp.getRandomItemsToSteal(defenderInventory, 1);
                    // Украденный предмет должен поместиться: снаряжение не стакуется,
                    // поэтому «втиснуть» его можно только в пустой слот —
                    // если мест нет, предмет просто не крадётся (у проигравшего
                    // он остаётся). Иначе атакующий получил бы 101-й слот и
                    // любая добыча сразу упиралась бы в INVENTORY_FULL.
                    if (stolen && attackerInventory.length < MAX_INVENTORY_SLOTS) {
                        const stolenIndex = defenderInventory.indexOf(stolen);
                        const stackQuantity = Math.max(1, Number(stolen.quantity || 1));
                        const isEquipment = equipmentRules.isEquipmentItem(stolen);

                        // Из стака крадётся ОДНА штука, а не весь стак — иначе проигравший
                        // терял бы, например, все 99 собранных консервов.
                        if (!isEquipment && stackQuantity > 1) {
                            defenderInventory[stolenIndex] = { ...stolen, quantity: stackQuantity - 1 };
                            addItemToInventory(attackerInventory, { ...stolen, quantity: 1 }, null);
                            stolenItem = { ...stolen, quantity: 1 };
                        } else {
                            defenderInventory.splice(stolenIndex, 1);
                            addItemToInventory(attackerInventory, { ...stolen }, null);
                            stolenItem = stolen;
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
                const safeLocationId = Number(safeLocationResult.rows[0]?.id || 1);

                // Завершаем бой
await client.query(`
                     UPDATE pvp_battles
                     SET status = 'completed',
                         winner_id = $1,
                         loser_id = $2,
                         attacker_reward = CASE WHEN attacker_id = $1 THEN $3 ELSE 0 END,
                         defender_reward = CASE WHEN defender_id = $1 THEN $3 ELSE 0 END,
                         ended_at = NOW(),
                         battle_duration = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::integer)
                     WHERE id = $4
                 `, [attackerId, defenderId, coinsReward, battleId]);

                // Обновляем PvP статистику победителя и даём опыт
                const pvpExpReward = pvp.calculatePVPRewardExperience(attacker.level, defender.level);
                await client.query(
                    `UPDATE players
                     SET pvp_wins = pvp_wins + 1,
                         pvp_streak = pvp_streak + 1,
                         pvp_max_streak = GREATEST(pvp_max_streak, pvp_streak + 1),
                         pvp_rating = pvp_rating + 25
                     WHERE id = $1`,
                    [attackerId]
                );
                
                // Используем playerHelper.addExperience для корректного level-up
                await playerHelper.addExperience(attackerId, pvpExpReward, client);

                // Обновляем PvP статистику проигравшего
                await client.query(`
                    UPDATE players
                    SET pvp_losses = pvp_losses + 1,
                        pvp_streak = 0,
                        pvp_rating = GREATEST(500, pvp_rating - 15),
                        coins = GREATEST(0, coins - $1),
                        coins_stolen_from_me = coins_stolen_from_me + $1,
                        items_stolen_from_me = items_stolen_from_me + $2,
                        current_location_id = $3
                    WHERE id = $4
                `, [coinsReward, stolenItem ? 1 : 0, safeLocationId, defenderId]);

                await client.query(`
                    UPDATE players SET coins = coins + $1 WHERE id = $2
                `, [coinsReward, attackerId]);

                if (stolenItem) {
                    await client.query(
                        `UPDATE players SET inventory = $1 WHERE id = $2`,
                        [safeStringify(defenderInventory), defenderId]
                    );
                    await client.query(
                        `UPDATE players SET inventory = $1 WHERE id = $2`,
                        [safeStringify(attackerInventory), attackerId]
                    );
                }

                rewards = {
                    coins: coinsReward,
                    item: stolenItem,
                    experience: pvpExpReward
                };
                winner = { id: attackerId };
                loser = { id: defenderId };

                // P1-5: устанавливаем кулдаун после боя для обоих + защита от фарма цели
                const cooldownMin = 5;
                // Атомарно ставим кулдауны обоим игрокам одним запросом:
                // ON CONFLICT (player_id, cooldown_type) работает для каждой строки VALUES отдельно.
                await client.query(
                    `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
                     VALUES
                         ($1, 'pvp_battle', NOW() + ($3 || ' minutes')::interval),
                         ($2, 'pvp_battle', NOW() + ($3 || ' minutes')::interval)
                     ON CONFLICT (player_id, cooldown_type)
                     DO UPDATE SET expires_at = NOW() + ($3 || ' minutes')::interval`,
                    [attackerId, defenderId, cooldownMin]
                );
                // Защита от повторной атаки одной цели (10 мин)
                await client.query(
                    `INSERT INTO pvp_cooldowns (player_id, cooldown_type, expires_at)
                     VALUES ($1, 'pvp_target_' || $2, NOW() + '10 minutes'::interval)
                     ON CONFLICT (player_id, cooldown_type)
                     DO UPDATE SET expires_at = NOW() + '10 minutes'::interval`,
                    [attackerId, defenderId]
                );

                // Активных push-уведомлений нет: поражение противник увидит на своём
                // экране PvP — там бой подтягивается по /api/game/pvp/matches.

                // Логи боя формируем как данные: сама запись уйдёт в лог
                // уже после COMMIT, чтобы её падение не откатило бой.
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
                    yourHealth: attacker.health,
                    targetHealth: defenderHealth,
                    maxHealth: defender.max_health,
                    targetAutoHeal: defenderAutoHeal
                        ? { used: defenderAutoHeal.used, heal: defenderAutoHeal.heal }
                        : null,
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
        
        // Логируем ПОСЛЕ коммита транзакции
        if (outcome.log) {
            await logPlayerAction(outcome.log.playerId, outcome.log.action, outcome.log.data);
        }

        return ok(res, outcome);

    } catch (error) {
        return handleError(res, error, 'pvp_attack_hit', playerId);
    }
});

/**
 * PvP статистика
 * GET /pvp/stats → GET /api/game/pvp/stats
 * Путь: /stats (внутри роутера)
 */
router.get('/stats', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
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
