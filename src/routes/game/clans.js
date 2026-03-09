/**
 * Кланы (production-ready версия)
 * 
 * Улучшения:
 * - Транзакции с SELECT FOR UPDATE для атомарности
 * - Валидация входных данных (ID, строки)
 * - Логирование действий в player_logs
 * - Единый формат ответов { success, data/error, code }
 * - Пагинация для списка кланов
 * - Namespace: GameClans
 * - Централизованный обработчик ошибок
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll } = require('../../db/database');
const { logger, logPlayerError } = require('../../utils/logger');

// ============================================================================
// Утилиты
// ============================================================================

/**
 * Валидация ID (Number.isInteger и > 0)
 */
const isValidId = (id) => Number.isInteger(id) && id > 0;

/**
 * Валидация и очистка имени клана
 */
const sanitizeName = (name) => {
    if (typeof name !== 'string') return '';
    return name.trim().replace(/[^\wа-я -]/gi, '').slice(0, 30);
};

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
 * Централизованный обработчик ошибок
 */
const handleError = (res, error, action, playerId) => {
    if (playerId) {
        logPlayerError(playerId, error, { action });
    } else {
        logger.error(`[CLANS] ${action}: ${error.message}`, {
            stack: error.stack
        });
    }

    let code = 'INTERNAL_ERROR';
    let statusCode = 500;

    if (error.message.includes('достаточно') || error.message.includes('монет')) {
        code = 'INSUFFICIENT_COINS';
        statusCode = 400;
    } else if (error.message.includes('не найден')) {
        code = 'NOT_FOUND';
        statusCode = 404;
    } else if (error.message.includes('уже состоите') || error.message.includes('не состоите')) {
        code = 'CLAN_MEMBERSHIP_ERROR';
        statusCode = 400;
    } else if (error.message.includes('закрытый') || error.message.includes('полный')) {
        code = 'CLAN_ACCESS_ERROR';
        statusCode = 400;
    } else if (error.message.includes('лидер') || error.message.includes('Leader')) {
        code = 'LEADER_ERROR';
        statusCode = 403;
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
const fail = (res, msg, code = 400, statusCode = 400) => 
    res.status(statusCode).json({ success: false, error: msg, code });

/**
 * Guard проверка
 */
const guard = (cond, res, msg, code = 400, statusCode = 400) => {
    if (cond) { fail(res, msg, code, statusCode); return true; }
    return false;
};

/**
 * Async wrapper
 */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Транзакция с блокировкой игрока
 */
const txWithLock = async (playerId, fn) => {
    await query('BEGIN');
    try {
        const lockedPlayer = await queryOne(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        const result = await fn(lockedPlayer);
        await query('COMMIT');
        return result;
    } catch (error) {
        await query('ROLLBACK');
        throw error;
    }
};

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
 * Получение информации о клане игрока
 * GET /clan
 */
router.get('/clan', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    if (guard(!player.clan_id, res, 'Вы не состоите в клане', 'NOT_IN_CLAN')) return;
    
    const data = await queryOne(`
        SELECT 
            c.*,
            COALESCE(
                (
                    SELECT ARRAY_AGG(
                        JSON_BUILD_OBJECT(
                            'telegram_id', p.telegram_id,
                            'username', p.username,
                            'first_name', p.first_name,
                            'level', p.level,
                            'clan_role', p.clan_role,
                            'clan_donated', p.clan_donated
                        )
                        ORDER BY p.clan_donated DESC
                        LIMIT 30
                    )
                    FROM players p WHERE p.clan_id = c.id
                ),
                '{}'
            ) AS members,
            (SELECT COUNT(*) FROM players WHERE clan_id = c.id) AS members_count
        FROM clans c
        WHERE c.id = $1
    `, [player.clan_id]);
    
    if (guard(!data, res, 'Клан не найден', 'CLAN_NOT_FOUND', 404)) return;
    
    // Логируем действие
    await logPlayerAction(playerId, 'view_clan', {
        clan_id: player.clan_id
    });
    
    ok(res, {
        in_clan: true,
        clan: { 
            id: data.id, 
            name: data.name, 
            description: data.description, 
            leader_id: data.leader_id, 
            members_count: Number(data.members_count || 0), 
            total_donated: data.total_donated, 
            created_at: data.created_at 
        },
        members: data.members || [],
        player_role: player.clan_role
    });
}));

/**
 * Создание клана
 * POST /clan/create
 */
router.post('/clan/create', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    const { name, description = '' } = req.body;
    
    // Валидация
    const cleanName = sanitizeName(name);
    if (guard(cleanName.length < 3 || cleanName.length > 30, res, 'Название клана: 3-30 символов', 'INVALID_NAME')) return;
    if (guard(player.clan_id, res, 'Вы уже состоите в клане', 'ALREADY_IN_CLAN')) return;
    if (guard(player.coins < 1000, res, 'Нужно 1000 монет', 'NOT_ENOUGH_COINS')) return;
    
    const result = await txWithLock(playerId, async (lockedPlayer) => {
        if (!lockedPlayer) {
            throw new Error('Игрок не найден');
        }

        // Проверяем монеты еще раз внутри транзакции
        if (lockedPlayer.coins < 1000) {
            throw new Error('Недостаточно монет');
        }

        const insertResult = await query(
            `INSERT INTO clans (name, description, leader_id, created_at) 
             VALUES ($1, $2, $3, NOW()) RETURNING id`,
            [cleanName, String(description).slice(0, 200), lockedPlayer.telegram_id]
        );
        const clanId = insertResult.rows[0].id;
        
        await query(
            `UPDATE players SET clan_id = $1, clan_role = 'leader', coins = coins - 1000 
             WHERE id = $2`,
            [clanId, playerId]
        );

        // Логируем создание клана
        await logPlayerAction(playerId, 'clan_create', {
            clan_id: clanId,
            clan_name: cleanName,
            cost: 1000
        });

        return { message: `Клан "${cleanName}" создан!`, clan: { id: clanId, name: cleanName } };
    });
    
    ok(res, result);
}));

/**
 * Вступление в клан
 * POST /clan/join
 */
router.post('/clan/join', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    const { clan_id } = req.body;
    
    // Валидация ID
    if (guard(!isValidId(clan_id), res, 'Укажите корректный ID клана', 'INVALID_CLAN_ID')) return;
    if (guard(player.clan_id, res, 'Вы уже состоите в клане', 'ALREADY_IN_CLAN')) return;
    
    const clan = await queryOne(
        `SELECT c.*, (SELECT COUNT(*) FROM players WHERE clan_id = c.id) AS members_count 
         FROM clans c WHERE c.id = $1`, 
        [clan_id]
    );
    
    if (guard(!clan, res, 'Клан не найден', 'CLAN_NOT_FOUND', 404)) return;
    if (guard(!clan.is_open, res, 'Клан закрытый', 'CLAN_CLOSED')) return;
    if (guard(Number(clan.members_count) >= 30, res, 'Клан полный (макс. 30 участников)', 'CLAN_FULL')) return;
    
    const result = await txWithLock(playerId, async (lockedPlayer) => {
        if (!lockedPlayer) {
            throw new Error('Игрок не найден');
        }

        // Проверяем, что игрок не состоит в клане
        if (lockedPlayer.clan_id) {
            throw new Error('Вы уже состоите в клане');
        }

        // Проверяем количество участников
        const memberCount = await queryOne(
            'SELECT COUNT(*) as count FROM players WHERE clan_id = $1',
            [clan_id]
        );

        if (Number(memberCount.count) >= 30) {
            throw new Error('Клан полный');
        }

        const updateResult = await query(`
            UPDATE players
            SET clan_id = $1, clan_role = 'member'
            WHERE id = $2
            AND clan_id IS NULL
            RETURNING id
        `, [clan_id, playerId]);
        
        if (!updateResult.rows.length) {
            throw new Error('Не удалось вступить (клан полный)');
        }

        // Логируем вступление
        await logPlayerAction(playerId, 'clan_join', {
            clan_id,
            clan_name: clan.name
        });

        return { message: `Вы вступили в клан ${clan.name}`, clan: { id: clan.id, name: clan.name } };
    });
    
    ok(res, result);
}));

/**
 * Покидание клана
 * POST /clan/leave
 */
router.post('/clan/leave', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    if (guard(!player.clan_id, res, 'Вы не состоите в клане', 'NOT_IN_CLAN')) return;
    if (guard(player.clan_role === 'leader', res, 'Лидер не может покинуть клан. Передайте лидерство.', 'LEADER_CANT_LEAVE', 403)) return;
    
    await txWithLock(playerId, async (lockedPlayer) => {
        if (!lockedPlayer) {
            throw new Error('Игрок не найден');
        }

        await query(
            `UPDATE players SET clan_id = NULL, clan_role = NULL WHERE id = $1`, 
            [playerId]
        );

        // Логируем выход из клана
        await logPlayerAction(playerId, 'clan_leave', {
            clan_id: player.clan_id
        });
    });
    
    ok(res, { message: 'Вы покинули клан' });
}));

/**
 * Получение списка кланов с пагинацией
 * GET /clans?limit=20&offset=0
 */
router.get('/clans', wrap(async (req, res) => {
    const playerId = req.player?.id;
    
    // Пагинация
    let limit = parseInt(req.query.limit) || 20;
    let offset = parseInt(req.query.offset) || 0;
    
    limit = Math.min(Math.max(1, limit), 100);
    offset = Math.max(0, offset);

    // Получаем общее количество
    const countResult = await queryOne(`SELECT COUNT(*) as total FROM clans`);
    const total = parseInt(countResult?.total || 0);

    // Получаем кланы с пагинацией
    const clans = await queryAll(`
        SELECT c.*, (SELECT COUNT(*) FROM players WHERE clan_id = c.id) AS members_count 
        FROM clans c 
        ORDER BY c.total_donated DESC 
        LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // Логируем
    await logPlayerAction(playerId, 'view_clans', {
        limit,
        offset,
        total
    });

    ok(res, { 
        clans: clans.map(c => ({ 
            id: c.id, 
            name: c.name, 
            description: c.description, 
            members_count: Number(c.members_count), 
            total_donated: c.total_donated, 
            is_open: c.is_open 
        })),
        pagination: {
            limit,
            offset,
            total
        }
    });
}));

/**
 * Получение информации о клановом боссе
 * GET /clan-boss
 */
router.get('/clan-boss', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    if (guard(!player.clan_id, res, 'Вы не состоите в клане', 'NOT_IN_CLAN')) return;
    
    const boss = await queryOne(
        `SELECT * FROM clan_bosses WHERE clan_id = $1 AND status = 'active' 
         ORDER BY started_at DESC LIMIT 1`, 
        [player.clan_id]
    );
    
    if (!boss) return ok(res, { active: false, message: 'Нет активного кланового босса' });
    
    ok(res, { active: true, boss });
}));

/**
 * Вызов кланового босса
 * POST /clan-boss/spawn
 */
router.post('/clan-boss/spawn', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    if (guard(!player.clan_id, res, 'Вы не состоите в клане', 'NOT_IN_CLAN')) return;
    if (guard(player.clan_role !== 'leader', res, 'Только лидер может вызвать босса', 'NOT_LEADER', 403)) return;
    if (guard(player.coins < 500, res, 'Нужно 500 монет', 'NOT_ENOUGH_COINS')) return;
    
    const result = await txWithLock(playerId, async (lockedPlayer) => {
        if (!lockedPlayer) {
            throw new Error('Игрок не найден');
        }

        if (lockedPlayer.coins < 500) {
            throw new Error('Недостаточно монет');
        }

        try {
            await query(
                `INSERT INTO clan_bosses (clan_id, hp, max_hp, status, started_at) 
                 VALUES ($1, 10000, 10000, 'active', NOW())`, 
                [player.clan_id]
            );
        } catch (e) {
            throw { message: 'Босс уже активен', code: 'BOSS_ALREADY_ACTIVE' };
        }
        
        await query(`UPDATE players SET coins = coins - 500 WHERE id = $1`, [playerId]);

        // Логируем
        await logPlayerAction(playerId, 'clan_boss_spawn', {
            clan_id: player.clan_id,
            cost: 500
        });

        return { message: 'Клановый босс призван!' };
    });
    
    if (result?.code) return fail(res, result.message, result.code);
    ok(res, result);
}));

/**
 * Атака кланового босса
 * POST /clan-boss/attack
 */
router.post('/clan-boss/attack', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    if (guard(!player.clan_id, res, 'Вы не состоите в клане', 'NOT_IN_CLAN')) return;
    
    const now = Date.now();
    if (guard(now - new Date(player.last_attack || 0) < 1000, res, 'Слишком быстро, подожди 1 секунду', 'ATTACK_TOO_FAST', 429)) return;
    
    const damage = Math.max(1, Math.floor(player.strength * 2 + player.agility * 0.5));
    
    const result = await txWithLock(playerId, async (lockedPlayer) => {
        if (!lockedPlayer) {
            throw new Error('Игрок не найден');
        }

        if (lockedPlayer.energy < 5) {
            throw new Error('Недостаточно энергии');
        }

        const bossResult = await query(`
            UPDATE clan_bosses
            SET hp = GREATEST(0, hp - $1)
            WHERE clan_id = $2 AND status = 'active' AND hp > 0
            RETURNING id, hp, max_hp
        `, [damage, player.clan_id]);
        
        if (!bossResult.rows.length) throw { message: 'Нет активного босса', code: 'NO_BOSS' };
        
        const playerResult = await query(
            `UPDATE players SET energy = energy - 5, last_attack = NOW() 
             WHERE id = $1 AND energy >= 5 
             RETURNING energy`, 
            [playerId]
        );
        
        if (!playerResult.rows.length) throw { message: 'Недостаточно энергии', code: 'NOT_ENOUGH_ENERGY' };

        // Логируем атаку
        await logPlayerAction(playerId, 'clan_boss_attack', {
            clan_id: player.clan_id,
            damage,
            boss_hp: bossResult.rows[0].hp
        });

        return { 
            damage, 
            boss_hp: bossResult.rows[0].hp, 
            boss_max_hp: bossResult.rows[0].max_hp, 
            energy_spent: 5 
        };
    });
    
    if (result?.code) return fail(res, result.message, result.code);
    ok(res, result);
}));

// ============================================================================
// Namespace экспорт
// ============================================================================

const GameClans = {
    router,
    utils: {
        isValidId,
        sanitizeName,
        safeStringify,
        handleError,
        txWithLock,
        logPlayerAction
    }
};

module.exports = router;
module.exports.GameClans = GameClans;
