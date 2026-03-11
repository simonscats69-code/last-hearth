/**
 * Боссы и рейды
 * Namespace: player, bosses, clans
 * 
 * Критерии продакшна:
 * - Транзакции и атомарность для операций записи
 * - Валидация входных данных
 * - Логирование действий игрока
 * - Единый формат ответов {success, data}
 * - Обратная совместимость (@deprecated)
 * - Централизованный namespace
 * - Единый обработчик ошибок
 * - Пагинация для списка боссов
 */

const express = require('express');
const router = express.Router();
const { pool, query, queryOne, queryAll } = require('../../db/database');
const playerHelper = require('../../utils/playerHelper');
const { logger } = require('../../utils/logger');
const { notifyBossAttack, getConnectedCount } = require('../../utils/realtime');

/**
 * Универсальный обработчик ошибок
 * @param {object} res - объект ответа Express
 * @param {Error} error - объект ошибки
 * @param {string} action - действие, в котором произошла ошибка
 */
function handleError(res, error, action = 'unknown') {
    logger.error(`[bosses] ${action}`, {
        error: error.message,
        stack: error.stack
    });
    
    return res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        code: 'INTERNAL_ERROR'
    });
}

/**
 * Safe JSON parsing с fallback
 * @param {any} value - значение для парсинга
 * @param {object} fallback - значение по умолчанию
 * @returns {object} распарсенный объект
 */
function safeJsonParse(value, fallback = {}) {
    if (value === null || value === undefined) {
        return fallback;
    }
    
    if (typeof value === 'object') {
        return value;
    }
    
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (e) {
            console.error('JSON.parse failed:', typeof value, value.substring(0, 100));
            logger.warn('[bosses] Ошибка парсинга JSON', { value: value.substring(0, 100) });
            return fallback;
        }
    }
    
    return fallback;
}

/**
 * Валидация ID босса
 * @param {any} bossId - ID для валидации
 * @returns {boolean} результат валидации
 */
function validateBossId(bossId) {
    return Number.isInteger(bossId) && bossId > 0;
}

/**
 * Валидация булева параметра
 * @param {any} value - значение для валидации
 * @returns {boolean} результат валидации
 */
function validateBoolean(value) {
    return typeof value === 'boolean';
}

/**
 * Получение списка боссов с пагинацией
 */
router.get('/bosses', async (req, res) => {
    try {
        const player = req.player;
        
        // Пагинация: параметры limit и offset
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        
        // Получаем ключи игрока
        const keys = await queryAll(`
            SELECT boss_id, quantity FROM boss_keys WHERE player_id = $1
        `, [player.id]);
        
        const keyMap = {};
        keys.forEach(k => { keyMap[k.boss_id] = k.quantity; });
        
        // Получаем общее количество боссов
        const countResult = await query(`
            SELECT COUNT(*) as total FROM bosses
        `);
        const totalBosses = parseInt(countResult.rows[0].total);
        
        // Получаем боссов с пагинацией
        const bosses = await queryAll(`
            SELECT * FROM bosses ORDER BY id ASC LIMIT $1 OFFSET $2
        `, [limit, offset]);
        
        // Определяем доступность боссов
        const bossList = bosses.map(boss => {
            // Первый босс доступен всегда
            const isUnlocked = boss.id === 1 || (keyMap[boss.id - 1] || 0) >= 3;
            
            return {
                id: boss.id,
                name: boss.name,
                description: boss.description,
                hp: boss.hp,
                max_hp: boss.max_hp,
                reward_coins: boss.reward_coins,
                reward_exp: boss.reward_exp,
                reward_items: safeJsonParse(boss.reward_items, []),
                keys_required: boss.id > 1 ? 3 : 0,
                keys_owned: keyMap[boss.id] || 0,
                unlocked: isUnlocked,
                in_raid: false
            };
        });
        
        // Единый формат ответа
        res.json({
            success: true,
            data: {
                bosses: bossList,
                player_keys: keyMap,
                pagination: {
                    total: totalBosses,
                    limit: limit,
                    offset: offset,
                    has_more: offset + bosses.length < totalBosses
                }
            }
        });
        
    } catch (error) {
        handleError(res, error, 'bosses_list');
    }
});

/**
 * Атака босса (обычная или рейд)
 */
router.post('/attack-boss', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { boss_id, is_raid = false } = req.body;
        const playerId = req.player.id;
        
        // Валидация входных данных
        if (boss_id === undefined || boss_id === null) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID босса',
                code: 'MISSING_BOSS_ID'
            });
        }
        
        if (!validateBossId(boss_id)) {
            return res.status(400).json({
                success: false,
                error: 'ID босса должен быть положительным целым числом',
                code: 'INVALID_BOSS_ID'
            });
        }
        
        if (!validateBoolean(is_raid)) {
            return res.status(400).json({
                success: false,
                error: 'Параметр is_raid должен быть boolean',
                code: 'INVALID_RAID_TYPE'
            });
        }
        
        // Используем транзакцию для атомарности
        await client.query('BEGIN');
        
        try {
            // Получаем босса
            const bossResult = await client.query(`
                SELECT * FROM bosses WHERE id = $1
            `, [boss_id]);
            
            if (bossResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    error: 'Босс не найден',
                    code: 'BOSS_NOT_FOUND'
                });
            }
            
            const boss = bossResult.rows[0];
            
            // Проверяем ключи
            if (boss_id > 1) {
                const keyRecord = await client.query(`
                    SELECT quantity FROM boss_keys 
                    WHERE player_id = $1 AND boss_id = $2
                `, [playerId, boss_id]);
                
                const keyCount = keyRecord.rows[0]?.quantity || 0;
                
                if (keyCount < 3) {
                    await client.query('ROLLBACK');
                    return res.json({
                        success: false,
                        error: `Нужно 3 ключа для боя с ${boss.name}`,
                        code: 'INSUFFICIENT_KEYS',
                        keys_owned: keyCount,
                        keys_required: 3
                    });
                }
                
                // Используем ключи (только для не-рейда)
                if (!is_raid) {
                    await client.query(`
                        UPDATE boss_keys 
                        SET quantity = quantity - 3 
                        WHERE player_id = $1 AND boss_id = $2
                    `, [playerId, boss_id]);
                }
            }
            
            // Обновляем энергию - сначала получаем с блокировкой
            // Оптимизированный порядок: FOR UPDATE -> проверка -> UPDATE
            const playerResult = await client.query(`
                SELECT * FROM players WHERE id = $1 FOR UPDATE
            `, [playerId]);
            
            const updatedPlayer = playerResult.rows[0];
            
            // Проверяем энергию до списания
            if (updatedPlayer.energy < 1) {
                await client.query('ROLLBACK');
                return res.json({
                    success: false,
                    error: 'Недостаточно энергии',
                    code: 'INSUFFICIENT_ENERGY',
                    energy: updatedPlayer.energy
                });
            }
            
            // Списываем энергию
            await client.query(`
                UPDATE players SET energy = energy - 1, last_energy_update = NOW()
                WHERE id = $1
            `, [playerId]);
            
            // Вычисляем урон
            const equipment = safeJsonParse(updatedPlayer.equipment, {});
            const weapon = equipment.weapon || {};
            
            let damage = (updatedPlayer.strength * 2) + (updatedPlayer.agility * 0.5);
            
            // Бонус от оружия
            if (weapon.damage) {
                damage += weapon.damage;
            }
            
            // Модификации
            if (weapon.modifications?.sharpening) {
                damage += weapon.modifications.sharpening * 2;
            }
            
            // Уровень
            damage *= (1 + updatedPlayer.level * 0.1);
            
            damage = Math.floor(damage);
            
            let result;
            
            if (is_raid) {
                // Рейд - обрабатываем в транзакции
                result = await handleRaidAttack(client, playerId, boss, damage, is_raid);
            } else {
                // Одиночный бой
                result = await handleSoloAttack(client, playerId, boss, damage, is_raid);
            }
            
            await client.query('COMMIT');
            
            // WebSocket уведомление об атаке босса
            if (getConnectedCount() > 0) {
                notifyBossAttack(playerId, {
                    bossId: boss.id,
                    bossName: boss.name,
                    newHp: result.newHp,
                    maxHp: boss.max_hp,
                    damage: damage,
                    isRaid: is_raid,
                    killed: result.killed
                });
            }
            
            // Логируем действие
            logger.info(`[bosses] Атака босса`, {
                playerId,
                bossId: boss_id,
                damage,
                killed: result.killed,
                is_raid
            });
            
            // Единый формат ответа
            res.json({
                success: true,
                data: {
                    boss: {
                        id: boss.id,
                        name: boss.name,
                        hp: result.newHp,
                        max_hp: boss.max_hp
                    },
                    damage: damage,
                    killed: result.killed,
                    rewards: result.rewards,
                    is_raid: is_raid
                }
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        
    } catch (error) {
        handleError(res, error, 'attack_boss');
    } finally {
        client.release();
    }
});

/**
 * Выдача наград за убийство босса
 * Унифицированная функция для одиночной и рейд-атаки
 */
async function grantRewards(client, playerId, boss) {
    const rewards = {
        coins: boss.reward_coins,
        exp: boss.reward_exp,
        items: safeJsonParse(boss.reward_items, [])
    };
    
    try {
        // Выдаём монеты
        if (boss.reward_coins) {
            await client.query(`
                UPDATE players SET coins = coins + $1 WHERE id = $2
            `, [boss.reward_coins, playerId]);
        }
        
        // Выдаём опыт
        if (boss.reward_exp) {
            await playerHelper.addExperience(playerId, boss.reward_exp);
        }
        
        // Обновляем счётчик убитых боссов
        await client.query(`
            UPDATE players SET bosses_killed = bosses_killed + 1 WHERE id = $1
        `, [playerId]);
        
    } catch (error) {
        logger.error('[bosses] Ошибка выдачи наград', {
            playerId,
            bossId: boss.id,
            error: error.message
        });
        throw error;
    }
    
    return rewards;
}

/**
 * Обработка рейд-атаки
 */
async function handleRaidAttack(client, playerId, boss, damage, isRaid) {
    let raidSession = await client.query(`
        SELECT * FROM boss_sessions 
        WHERE boss_id = $1 AND status = 'active'
        ORDER BY started_at DESC LIMIT 1
    `, [boss.id]);
    
    raidSession = raidSession.rows[0];
    
    if (!raidSession) {
        // Создаём новую сессию рейда
        const insertResult = await client.query(`
            INSERT INTO boss_sessions (boss_id, hp, max_hp, status, started_at)
            VALUES ($1, $2, $2, 'active', NOW())
            RETURNING id, hp
        `, [boss.id, boss.max_hp]);
        
        raidSession = { id: insertResult.rows[0].id, hp: boss.max_hp };
    }
    
    // Добавляем урон
    const newHp = Math.max(0, raidSession.hp - damage);
    
    await client.query(`
        UPDATE boss_sessions SET hp = $1 WHERE id = $2
    `, [newHp, raidSession.id]);
    
    // UPSERT прогресса игрока - оптимизация запросов
    await client.query(`
        INSERT INTO raid_progress (session_id, player_id, damage)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, player_id) 
        DO UPDATE SET damage = raid_progress.damage + EXCLUDED.damage
    `, [raidSession.id, playerId, damage]);
    
    // Проверяем, убит ли босс
    let killed = false;
    let rewards = null;
    
    if (newHp <= 0) {
        killed = true;
        
        // Завершаем рейд
        await client.query(`
            UPDATE boss_sessions SET status = 'completed', ended_at = NOW()
            WHERE id = $1
        `, [raidSession.id]);
        
        // Выдаём награды через унифицированную функцию
        rewards = await grantRewards(client, playerId, boss);
        
        // UPSERT ключа для следующего босса
        const nextBossId = boss.id + 1;
        await client.query(`
            INSERT INTO boss_keys (player_id, boss_id, quantity) VALUES ($1, $2, 1)
            ON CONFLICT (player_id, boss_id) 
            DO UPDATE SET quantity = boss_keys.quantity + 1
        `, [playerId, nextBossId]);
    }
    
    return { newHp, killed, rewards };
}

/**
 * Обработка одиночной атаки
 */
async function handleSoloAttack(client, playerId, boss, damage, isRaid) {
    const newHp = Math.max(0, boss.hp - damage);
    
    // Проверяем победу
    let killed = false;
    let rewards = null;
    
    if (newHp <= 0) {
        killed = true;
        
        // Выдаём награды через унифицированную функцию
        rewards = await grantRewards(client, playerId, boss);
        
        // UPSERT ключа для следующего босса
        const nextBossId = boss.id + 1;
        await client.query(`
            INSERT INTO boss_keys (player_id, boss_id, quantity) VALUES ($1, $2, 1)
            ON CONFLICT (player_id, boss_id) 
            DO UPDATE SET quantity = boss_keys.quantity + 1
        `, [playerId, nextBossId]);
    }
    
    return { newHp, killed, rewards };
}

/**
 * Получение списка боссов (устаревшая версия)
 * @deprecated Используйте GET /bosses с единым форматом ответа
 */
router.get('/bosses-legacy', async (req, res) => {
    try {
        const player = req.player;
        
        // Получаем ключи игрока
        const keys = await queryAll(`
            SELECT boss_id, quantity FROM boss_keys WHERE player_id = $1
        `, [player.id]);
        
        const keyMap = {};
        keys.forEach(k => { keyMap[k.boss_id] = k.quantity; });
        
        // Получаем всех боссов
        const bosses = await queryAll(`
            SELECT * FROM bosses ORDER BY id ASC
        `);
        
        // Определяем доступность боссов
        const bossList = bosses.map(boss => {
            // Первый босс доступен всегда
            const isUnlocked = boss.id === 1 || (keyMap[boss.id - 1] || 0) >= 3;
            
            return {
                id: boss.id,
                name: boss.name,
                description: boss.description,
                hp: boss.hp,
                max_hp: boss.max_hp,
                reward_coins: boss.reward_coins,
                reward_exp: boss.reward_exp,
                reward_items: boss.reward_items,
                keys_required: boss.id > 1 ? 3 : 0,
                keys_owned: keyMap[boss.id] || 0,
                unlocked: isUnlocked,
                in_raid: false
            };
        });
        
        res.json({
            bosses: bossList,
            player_keys: keyMap
        });
        
    } catch (error) {
        console.error('Ошибка /bosses:', error);
        res.status(500).json({ error: 'Ошибка получения боссов' });
    }
});

module.exports = router;
