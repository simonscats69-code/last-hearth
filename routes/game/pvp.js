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
const { query, queryOne, queryAll, transaction } = require('../../db/database');
const pvp = require('../../db/pvp');
const { logger, logPlayerError, safeParse, safeStringify, PlayerHelper: playerHelper } = require('../../utils/serverApi');



/**
 * Валидация ID (Number.isInteger и > 0)
 */
const isValidId = (id) => Number.isInteger(id) && id > 0;

/**
 * Централизованный обработчик ошибок
 */
const handleError = (res, error, action, playerId) => {
    if (playerId) {
        logPlayerError(playerId, error, { action });
    } else {
        logger.error(`[PVP] ${action}: ${error.message}`, {
            stack: error.stack
        });
    }

    let code = 'INTERNAL_ERROR';
    let statusCode = 500;

    if (error.message.includes('энергия') || error.message.includes('ENERGY')) {
        code = 'INSUFFICIENT_ENERGY';
        statusCode = 400;
    } else if (error.message.includes('не найден') || error.message.includes('локации')) {
        code = 'NOT_FOUND';
        statusCode = 404;
    } else if (error.message.includes('красной зоне') || error.message.includes('RED_ZONE')) {
        code = 'NOT_RED_ZONE';
        statusCode = 400;
    } else if (error.message.includes('не участник') || error.message.includes('участник')) {
        code = 'NOT_PARTICIPANT';
        statusCode = 403;
    } else if (error.message.includes('слишком быстро') || error.message.includes('COOLDOWN')) {
        code = 'ATTACK_COOLDOWN';
        statusCode = 429;
    } else if (error.message.includes('валидация') || error.message.includes('ID')) {
        code = 'VALIDATION_ERROR';
        statusCode = 400;
    }

    return res.status(statusCode).json({
        success: false,
        error: error.message,
        code
    });
};

/**
 * Унифицированный формат успешного ответа
 */
const ok = (res, data = {}) => res.json({ success: true, ...data });

/**
 * Унифицированный формат ошибки
 */
const fail = (res, message, code = 'ERROR', statusCode = 400) => 
    res.status(statusCode).json({ success: false, error: message, code });

/**
 * Логирование действия в player_logs
 * @param {number} playerId - ID игрока
 * @param {string} action - Название действия
 * @param {object} metadata - Дополнительные данные
 * @param {object} client - Опциональный клиент БД для использования внутри транзакции
 */
const logPlayerAction = async (playerId, action, metadata = {}, client = null) => {
    try {
        // Используем переданный client или глобальную функцию query
        const executeQuery = client 
            ? (sql, params) => client.query(sql, params)
            : query;
        
        await executeQuery(
            `INSERT INTO player_logs (player_id, action, metadata, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, safeStringify(metadata)]
        );
    } catch (error) {
        logger.warn('Не удалось залогировать действие игрока', {
            playerId,
            action,
            error: error.message
        });
    }
};



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
            SELECT is_red_zone FROM locations WHERE id = $1
        `, [player.current_location_id]);
        
        if (!location || !location.is_red_zone) {
            return ok(res, {
                available: false,
                message: 'PvP доступно только на красных зонах'
            });
        }

        // Получаем игроков на той же локации с пагинацией
        const players = await queryAll(`
            SELECT id, telegram_id, username, first_name, level, 
                   health, max_health, strength, endurance, agility,
                   pvp_wins, pvp_rating, pvp_streak
            FROM players 
            WHERE current_location_id = $1 AND id != $2
            LIMIT $3 OFFSET $4
        `, [player.current_location_id, playerId, limit, offset]);

        // Общее количество игроков
        const countResult = await queryOne(`
            SELECT COUNT(*) as total FROM players 
            WHERE current_location_id = $1 AND id != $2
        `, [player.current_location_id, playerId]);
        const total = parseInt(countResult?.total || 0);

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
        
        if (!isValidId(target_id)) {
            return fail(res, 'Укажите корректный ID цели (число > 0)', 'INVALID_TARGET_ID');
        }

        // Выполняем атаку в транзакции с блокировкой обоих игроков
        const result = await transaction(async (client) => {
            // Блокируем обоих игроков в порядке возрастания ID для предотвращения deadlock
            const [firstId, secondId] = playerId < target_id
                ? [playerId, target_id]
                : [target_id, playerId];
            
            const firstResult = await client.query(
                `SELECT * FROM players WHERE id = $1 FOR UPDATE`,
                [firstId]
            );
            const secondResult = await client.query(
                `SELECT * FROM players WHERE id = $1 FOR UPDATE`,
                [secondId]
            );
            
            if (!firstResult.rows[0] || !secondResult.rows[0]) {
                throw new Error('Игрок не найден');
            }
            
            const lockedPlayer = firstId === playerId ? firstResult.rows[0] : secondResult.rows[0];
            const targetPlayer = firstId === target_id ? firstResult.rows[0] : secondResult.rows[0];

            // Проверяем красную зону
            const location = await client.query(`
                SELECT is_red_zone FROM locations WHERE id = $1
            `, [lockedPlayer.current_location_id]);

            if (!location.rows[0] || !location.rows[0].is_red_zone) {
                throw new Error('PvP доступно только на красных зонах');
            }

            if (targetPlayer.current_location_id !== lockedPlayer.current_location_id) {
                throw new Error('Игрок не на этой локации');
            }

            // Проверяем наличие энергии ДО списания
            if (!lockedPlayer || lockedPlayer.energy < 1) {
                throw new Error('Нужна энергия для атаки');
            }

            // Обновляем энергию (вычитаем 1 за атаку)
            await client.query(
                `UPDATE players SET energy = energy - 1 WHERE id = $1`,
                [playerId]
            );

            // Создаём сессию боя с передачей client для работы внутри транзакции
            const battle = await pvp.createPVPMatch(playerId, target_id, lockedPlayer.current_location_id, client);

            // Логируем начало боя
            await logPlayerAction(playerId, 'pvp_attack_start', {
                target_id,
                target_name: targetPlayer.username || targetPlayer.first_name || 'Unknown',
                location_id: lockedPlayer.current_location_id,
                battle_id: battle.id
            }, client);

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
                }
            };
        });

        ok(res, result);

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
        
        if (!isValidId(battle_id)) {
            return fail(res, 'Укажите корректный ID боя (число > 0)', 'INVALID_BATTLE_ID');
        }

        // Выполняем удар в транзакции
        const battleResult = await transaction(async (client) => {
            // Получаем бой
            const battle = await client.query(`
                SELECT * FROM pvp_battles WHERE id = $1
            `, [battle_id]);

            if (!battle.rows[0]) {
                throw new Error('Бой не найден');
            }

            const battleData = battle.rows[0];

            if (battleData.attacker_id !== playerId && battleData.target_id !== playerId) {
                throw new Error('Вы не участник этого боя');
            }

            // Определяем атакующего и защитника
            const isAttacker = battleData.attacker_id === playerId;
            const attackerId = isAttacker ? battleData.attacker_id : battleData.target_id;
            const defenderId = isAttacker ? battleData.target_id : battleData.attacker_id;

            // Блокируем обоих игроков в определённом порядке для предотвращения deadlock
            const [firstId, secondId] = attackerId < defenderId
                ? [attackerId, defenderId]
                : [defenderId, attackerId];
            
            const attackerResult = await client.query(
                `SELECT * FROM players WHERE id = $1 FOR UPDATE`,
                [firstId]
            );
            const defenderResult = await client.query(
                `SELECT * FROM players WHERE id = $1 FOR UPDATE`,
                [secondId]
            );
            
            const [firstRow, secondRow] = [attackerResult.rows[0], defenderResult.rows[0]];
            const attacker = attackerId === firstId ? firstRow : secondRow;
            const defender = defenderId === firstId ? firstRow : secondRow;

            if (!attacker || !defender) {
                throw new Error('Игрок не найден');
            }

            // Проверяем, что игрок жив перед атакой
            if (attacker.health <= 0) {
                throw new Error('Вы мертвы и не можете атаковать');
            }
            if (defender.health <= 0) {
                throw new Error('Противник уже мертв');
            }

            // Вычисляем урон атакующего
            let damage = (attacker.strength * 2) + (attacker.agility * 0.5);

            // Бонус от оружия
            const equipment = safeParse(attacker.equipment, {});
            if (equipment.weapon && equipment.weapon.damage) {
                damage += equipment.weapon.damage;
            }

            // Проверка на уклонение (agility)
            // Шанс уклонения = min(25%, agility * 0.5%)
            const dodgeChance = Math.min(25, defender.agility * 0.5);
            const isDodged = Math.random() * 100 < dodgeChance;
            
            if (isDodged) {
                // Возвращаем специальный объект для обработки вне транзакции
                return { dodged: true, attackerHealth: attacker.health, defenderHealth: defender.health };
            }

            // Защита от выносливости (endurance)
            // Уменьшаем урон: min(75%, endurance * 0.5%)
            const defenseReduction = Math.min(75, defender.endurance * 0.5);
            damage = Math.floor(damage * (1 - defenseReduction / 100));
            damage = Math.max(1, damage); // Минимальный урон 1

            // Применяем урон
            const newHealth = Math.max(0, defender.health - damage);

            await client.query(`
                UPDATE players SET health = $1 WHERE id = $2
            `, [newHealth, defenderId]);

            // Проверяем победу
            let ended = false;
            let reward = null;

            if (newHealth <= 0) {
                ended = true;

                // Награда победителю
                // Ограничиваем максимальную награду
                const MAX_PVP_COINS = 10000;
                const coinsReward = Math.min(
                    Math.floor(defender.coins * 0.1),
                    MAX_PVP_COINS
                );

                await client.query(`
                    UPDATE players SET coins = coins + $1 WHERE id = $2
                `, [coinsReward, attackerId]);

                // Шанс украсть предмет (снижено с 30% до 10%)
                const inventory = safeParse(defender.inventory, []);
                if (inventory.length > 0 && Math.random() < 0.1) {
                    const stolenItem = inventory[Math.floor(Math.random() * inventory.length)];

                    // Добавляем предмет атакующему
                    const attackerInventory = safeParse(attacker.inventory, []);
                    attackerInventory.push(stolenItem);

                    await client.query(`
                        UPDATE players SET inventory = $1 WHERE id = $2
                    `, [safeStringify(attackerInventory), attackerId]);

                    reward = {
                        coins: coinsReward,
                        item: stolenItem
                    };
                } else {
                    reward = {
                        coins: coinsReward
                    };
                }

                // Завершаем бой
                await client.query(`
                    UPDATE pvp_battles SET status = 'completed', winner_id = $1, ended_at = NOW()
                    WHERE id = $2
                `, [attackerId, battle_id]);

                // Обновляем PvP статистику победителя и даём опыт
                const pvpExpReward = 50; // 50 XP за победу в PvP
                await client.query(`
                    UPDATE players
                    SET pvp_wins = pvp_wins + 1,
                        pvp_damage_dealt = pvp_damage_dealt + $1,
                        experience = experience + $2
                    WHERE id = $3
                `, [damage, pvpExpReward, attackerId]);

                // Обновляем PvP статистику проигравшего
                await client.query(`
                    UPDATE players
                    SET pvp_losses = pvp_losses + 1,
                        pvp_damage_taken = pvp_damage_taken + $1
                    WHERE id = $2
                `, [damage, defenderId]);

                // Логируем завершение боя
                await logPlayerAction(playerId, 'pvp_battle_win', {
                    battle_id,
                    opponent_id: defenderId,
                    damage_dealt: damage,
                    coins_reward: coinsReward,
                    item_stolen: !!reward?.item
                }, client);
            } else {
                // Логируем удар
                await logPlayerAction(playerId, 'pvp_attack_hit', {
                    battle_id,
                    opponent_id: defenderId,
                    damage_dealt: damage,
                    opponent_health_after: newHealth
                }, client);
            }

            return {
                damage: damage,
                defender_health: newHealth,
                ended: ended,
                reward: reward,
                message: ended ? 'Победа!' : 'Удар нанесён'
            };
        });

        // Обработка уклонения
        if (battleResult?.dodged) {
            return res.json({
                success: true,
                message: 'Противник уклонился от атаки!',
                dodged: true,
                attackerHealth: battleResult.attackerHealth,
                defenderHealth: battleResult.defenderHealth
            });
        }

        return ok(res, battleResult);

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
        const stats = await queryOne(`
            SELECT pvp_wins, pvp_losses, pvp_total_damage_dealt, pvp_total_damage_taken,
                   pvp_rating, pvp_streak, pvp_max_streak, coins_stolen_from_me, items_stolen_from_me
            FROM players WHERE id = $1
        `, [playerId]);
        
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
            wins: stats?.pvp_wins || 0,
            losses: stats?.pvp_losses || 0,
            damage_dealt: stats?.pvp_total_damage_dealt || 0,
            damage_taken: stats?.pvp_total_damage_taken || 0,
            rating: stats?.pvp_rating || 1000,
            streak: stats?.pvp_streak || 0,
            maxStreak: stats?.pvp_max_streak || 0,
            coinsStolenFromMe: stats?.coins_stolen_from_me || 0,
            itemsStolenFromMe: stats?.items_stolen_from_me || 0,
            recentMatches: [],
            cooldown: { active: false }
        });

    } catch (error) {
        return handleError(res, error, 'pvp_stats', playerId);
    }
});
module.exports = router;
