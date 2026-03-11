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
const { query, queryOne, queryAll } = require('../../db/database');
const playerHelper = require('../../utils/playerHelper');
const pvp = require('../../db/pvp');
const { logger, logPlayerError } = require('../../utils/logger');
const { withPlayerLock } = require('../../utils/transactions');

// ============================================================================
// Утилиты
// ============================================================================

/**
 * Валидация ID (Number.isInteger и > 0)
 */
const isValidId = (id) => Number.isInteger(id) && id > 0;

/**
 * Безопасная сериализация JSON с fallback
 */
const safeStringify = (value) => {
    try {
        return JSON.stringify(value);
    } catch {
        return JSON.stringify({});
    }
};

/**
 * Парсинг JSON с fallback
 */
const safeParse = (value, fallback = {}) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        console.error('JSON.parse failed:', typeof value, String(value).substring(0, 100));
        return fallback;
    }
};

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
const fail = (res, message, code = 400, statusCode = 400) => 
    res.status(statusCode).json({ success: false, error: message, code });

/**
 * Логирование действия в player_logs
 */
const logPlayerAction = async (playerId, action, metadata = {}) => {
    try {
        await query(
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

// ============================================================================
// Маршруты
// ============================================================================

/**
 * Получение списка игроков для PvP с пагинацией
 * GET /pvp/players?limit=20&offset=0
 */
router.get('/pvp/players', async (req, res) => {
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
                   health, max_health, strength, endurance, agility
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
 * POST /pvp/attack
 */
router.post('/pvp/attack', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;

    try {
        // Валидация входных данных
        const { target_id } = req.body;
        
        if (!isValidId(target_id)) {
            return fail(res, 'Укажите корректный ID цели (число > 0)', 'INVALID_TARGET_ID');
        }

        // Выполняем атаку в транзакции
        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            if (!lockedPlayer) {
                throw new Error('Игрок не найден');
            }

            // Проверяем красную зону
            const location = await queryOne(`
                SELECT is_red_zone FROM locations WHERE id = $1
            `, [lockedPlayer.current_location_id]);

            if (!location || !location.is_red_zone) {
                throw new Error('PvP доступно только на красных зонах');
            }

            // Получаем цель
            const target = await queryOne(`
                SELECT * FROM players WHERE id = $1
            `, [target_id]);

            if (!target) {
                throw new Error('Игрок не найден');
            }

            if (target.current_location_id !== lockedPlayer.current_location_id) {
                throw new Error('Игрок не на этой локации');
            }

            // Обновляем энергию
            await playerHelper.updateEnergy(playerId);
            
            // Получаем актуальные данные атакующего
            const attacker = await playerHelper.getById(playerId);

            if (attacker.energy < 1) {
                throw new Error('Нужна энергия для атаки');
            }

            // Создаём сессию боя
            const battleId = await pvp.startBattle(playerId, target_id);

            // Логируем начало боя
            await logPlayerAction(playerId, 'pvp_attack_start', {
                target_id,
                target_name: target.username || target.first_name || 'Unknown',
                location_id: attacker.current_location_id,
                battle_id: battleId
            });

            return {
                battle_id: battleId,
                attacker: {
                    id: attacker.id,
                    health: attacker.health,
                    max_health: attacker.max_health,
                    strength: attacker.strength
                },
                target: {
                    id: target.id,
                    username: target.username,
                    health: target.health,
                    max_health: target.max_health,
                    strength: target.strength
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
 * POST /pvp/attack-hit
 */
router.post('/pvp/attack-hit', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;

    try {
        // Валидация
        const { battle_id } = req.body;
        
        if (!isValidId(battle_id)) {
            return fail(res, 'Укажите корректный ID боя (число > 0)', 'INVALID_BATTLE_ID');
        }

        // Выполняем удар в транзакции
        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            if (!lockedPlayer) {
                throw new Error('Игрок не найден');
            }

            // Получаем бой
            const battle = await queryOne(`
                SELECT * FROM pvp_battles WHERE id = $1
            `, [battle_id]);

            if (!battle) {
                throw new Error('Бой не найден');
            }

            if (battle.attacker_id !== playerId && battle.target_id !== playerId) {
                throw new Error('Вы не участник этого боя');
            }

            // Определяем атакующего и защитника
            const isAttacker = battle.attacker_id === playerId;
            const attackerId = isAttacker ? battle.attacker_id : battle.target_id;
            const defenderId = isAttacker ? battle.target_id : battle.attacker_id;

            const attacker = await playerHelper.getById(attackerId);
            const defender = await playerHelper.getById(defenderId);

            if (!attacker || !defender) {
                throw new Error('Игрок не найден');
            }

            // Вычисляем урон
            let damage = (attacker.strength * 2) + (attacker.agility * 0.5);

            // Бонус от оружия
            const equipment = safeParse(attacker.equipment, {});
            if (equipment.weapon && equipment.weapon.damage) {
                damage += equipment.weapon.damage;
            }

            damage = Math.floor(damage);

            // Применяем урон
            const newHealth = Math.max(0, defender.health - damage);

            await query(`
                UPDATE players SET health = $1 WHERE id = $2
            `, [newHealth, defenderId]);

            // Проверяем победу
            let ended = false;
            let reward = null;

            if (newHealth <= 0) {
                ended = true;

                // Награда победителю
                const coinsReward = Math.floor(defender.coins * 0.1);

                await query(`
                    UPDATE players SET coins = coins + $1 WHERE id = $2
                `, [coinsReward, attackerId]);

                // Шанс украсть предмет
                const inventory = safeParse(defender.inventory, []);
                if (inventory.length > 0 && Math.random() < 0.3) {
                    const stolenItem = inventory[Math.floor(Math.random() * inventory.length)];

                    // Добавляем предмет атакующему
                    const attackerInventory = safeParse(attacker.inventory, []);
                    attackerInventory.push(stolenItem);

                    await query(`
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
                await query(`
                    UPDATE pvp_battles SET status = 'completed', winner_id = $1, ended_at = NOW()
                    WHERE id = $2
                `, [attackerId, battle_id]);

                // Логируем завершение боя
                await logPlayerAction(playerId, 'pvp_battle_win', {
                    battle_id,
                    opponent_id: defenderId,
                    damage_dealt: damage,
                    coins_reward: coinsReward,
                    item_stolen: !!reward?.item
                });
            } else {
                // Логируем удар
                await logPlayerAction(playerId, 'pvp_attack_hit', {
                    battle_id,
                    opponent_id: defenderId,
                    damage_dealt: damage,
                    opponent_health_after: newHealth
                });
            }

            return {
                damage: damage,
                defender_health: newHealth,
                ended: ended,
                reward: reward,
                message: ended ? 'Победа!' : 'Удар нанесён'
            };
        });

        ok(res, result);

    } catch (error) {
        return handleError(res, error, 'pvp_attack_hit', playerId);
    }
});

/**
 * PvP статистика
 * GET /pvp/stats
 */
router.get('/pvp/stats', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    try {
        const stats = await queryOne(`
            SELECT pvp_wins, pvp_losses, pvp_damage_dealt, pvp_damage_taken
            FROM players WHERE id = $1
        `, [playerId]);
        
        ok(res, {
            wins: stats?.pvp_wins || 0,
            losses: stats?.pvp_losses || 0,
            damage_dealt: stats?.pvp_damage_dealt || 0,
            damage_taken: stats?.pvp_damage_taken || 0
        });

    } catch (error) {
        return handleError(res, error, 'pvp_stats', playerId);
    }
});

// ============================================================================
// Namespace экспорт
// ============================================================================

const GamePVP = {
    router,
    utils: {
        isValidId,
        safeStringify,
        safeParse,
        handleError,
        withPlayerLock,
        logPlayerAction
    }
};

module.exports = router;
module.exports.GamePVP = GamePVP;
