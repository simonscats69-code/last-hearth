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
const { withPlayerLock, validateId, sanitizeName, ok, fail, notFound, badRequest, wrap, logPlayerAction, serializeJSONField, logger } = require('../../utils/serverApi');

// =============================================================================
// УТИЛИТЫ
// =============================================================================

const { pool } = require('../../db/database');

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
    
    if (!player.clan_id) {
        return fail(res, 'Вы не состоите в клане', 'NOT_IN_CLAN');
    }
    
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
    
    if (!data) {
        return notFound(res, 'Клан не найден', 'CLAN_NOT_FOUND');
    }
    
    // Логируем действие
    await logPlayerAction(pool, playerId, 'view_clan', {
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
    
    // Валидация имени клана
    const nameValidation = sanitizeName(name, 30);
    if (!nameValidation.valid) {
        return fail(res, nameValidation.error, nameValidation.code);
    }
    
    if (player.clan_id) {
        return fail(res, 'Вы уже состоите в клане', 'ALREADY_IN_CLAN');
    }
    
    if (player.coins < 1000) {
        return fail(res, 'Нужно 1000 монет', 'NOT_ENOUGH_COINS');
    }
    
    const result = await withPlayerLock(playerId, async (lockedPlayer) => {
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
            [nameValidation.value, String(description).slice(0, 200), lockedPlayer.telegram_id]
        );
        const clanId = insertResult.rows[0].id;
        
        await query(
            `UPDATE players SET clan_id = $1, clan_role = 'leader', coins = coins - 1000 
             WHERE id = $2`,
            [clanId, playerId]
        );

        // Логируем создание клана
        await logPlayerAction(pool, playerId, 'clan_create', {
            clan_id: clanId,
            clan_name: nameValidation.value,
            cost: 1000
        });

        return { message: `Клан "${nameValidation.value}" создан!`, clan: { id: clanId, name: nameValidation.value } };
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
    
    // Валидация ID клана
    const idValidation = validateId(clan_id, 'ID клана');
    if (!idValidation.valid) {
        return fail(res, idValidation.error, idValidation.code);
    }
    
    if (player.clan_id) {
        return fail(res, 'Вы уже состоите в клане', 'ALREADY_IN_CLAN');
    }
    
    const clan = await queryOne(
        `SELECT c.*, (SELECT COUNT(*) FROM players WHERE clan_id = c.id) AS members_count 
         FROM clans c WHERE c.id = $1`, 
        [clan_id]
    );
    
    if (!clan) {
        return notFound(res, 'Клан не найден', 'CLAN_NOT_FOUND');
    }
    
    if (!clan.is_open) {
        return fail(res, 'Клан закрытый', 'CLAN_CLOSED');
    }
    
    if (Number(clan.members_count) >= 30) {
        return fail(res, 'Клан полный (макс. 30 участников)', 'CLAN_FULL');
    }
    
    const result = await withPlayerLock(playerId, async (lockedPlayer) => {
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
        await logPlayerAction(pool, playerId, 'clan_join', {
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
    
    if (!player.clan_id) {
        return fail(res, 'Вы не состоите в клане', 'NOT_IN_CLAN');
    }
    
    if (player.clan_role === 'leader') {
        return fail(res, 'Лидер не может покинуть клан. Передайте лидерство.', 'LEADER_CANT_LEAVE', 403);
    }
    
    await withPlayerLock(playerId, async (lockedPlayer) => {
        if (!lockedPlayer) {
            throw new Error('Игрок не найден');
        }

        await query(
            `UPDATE players SET clan_id = NULL, clan_role = NULL WHERE id = $1`, 
            [playerId]
        );

        // Логируем выход из клана
        await logPlayerAction(pool, playerId, 'clan_leave', {
            clan_id: player.clan_id
        });
    });
    
    ok(res, { message: 'Вы покинули клан' });
}));

/**
 * Получение списка кланов с пагинацией
 * GET /clans?limit=20&offset=0
 * Путь: / (корень внутри роутера)
 */
router.get('/', wrap(async (req, res) => {
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
    await logPlayerAction(pool, playerId, 'view_clans', {
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
 * Получение сообщений кланового чата
 * GET /clan/chat
 */
router.get('/clan/chat', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    if (!player.clan_id) {
        return fail(res, 'Вы не состоите в клане', 'NOT_IN_CLAN');
    }
    
    try {
        const messages = await queryAll(`
            SELECT cm.id, cm.message, cm.created_at, 
                   p.username, p.first_name, p.level, p.avatar_url
            FROM clan_messages cm
            JOIN players p ON cm.player_id = p.id
            WHERE cm.clan_id = $1
            ORDER BY cm.created_at DESC
            LIMIT 50
        `, [player.clan_id]);
        
        // Логируем просмотр чата
        await logPlayerAction(pool, playerId, 'clan_chat_view', {
            clan_id: player.clan_id,
            messages_count: messages.length
        });
        
        // Возвращаем в правильном порядке (старые сверху)
        ok(res, { messages: messages.reverse() });
    } catch (e) {
        logger.error('Ошибка получения чата клана:', e);
        fail(res, 'Ошибка загрузки чата', 'CHAT_LOAD_ERROR');
    }
}));

/**
 * Отправка сообщения в клановый чат
 * POST /clan/chat
 */
router.post('/clan/chat', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    const { message } = req.body;
    
    if (!player.clan_id) {
        return fail(res, 'Вы не состоите в клане', 'NOT_IN_CLAN');
    }
    
    // Валидация сообщения
    if (!message || typeof message !== 'string') {
        return fail(res, 'Сообщение не может быть пустым', 'EMPTY_MESSAGE');
    }
    
    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0) {
        return fail(res, 'Сообщение не может быть пустым', 'EMPTY_MESSAGE');
    }
    
    if (trimmedMessage.length > 500) {
        return fail(res, 'Сообщение слишком длинное (макс. 500 символов)', 'MESSAGE_TOO_LONG');
    }
    
    try {
        const result = await query(
            `INSERT INTO clan_messages (clan_id, player_id, message, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, created_at`,
            [player.clan_id, playerId, trimmedMessage]
        );
        
        // Логируем отправку сообщения
        await logPlayerAction(pool, playerId, 'clan_chat_send', {
            clan_id: player.clan_id,
            message_length: trimmedMessage.length
        });
        
        ok(res, { 
            success: true, 
            message: 'Сообщение отправлено',
            message_id: result.rows[0].id
        });
    } catch (e) {
        logger.error('Ошибка отправки сообщения в чат клана:', e);
        fail(res, 'Ошибка отправки сообщения', 'SEND_MESSAGE_ERROR');
    }
}));

/**
 * Пожертвование в клан
 * POST /clan/donate
 */
router.post('/clan/donate', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    const { amount } = req.body;
    
    if (!player.clan_id) {
        return fail(res, 'Вы не состоите в клане', 'NOT_IN_CLAN');
    }
    
    // Валидация суммы
    const donation = parseInt(amount);
    if (!donation || isNaN(donation) || donation <= 0) {
        return fail(res, 'Неверная сумма пожертвования', 'INVALID_AMOUNT');
    }
    
    if (donation > 1000000) {
        return fail(res, 'Слишком большая сумма (макс. 1,000,000)', 'AMOUNT_TOO_BIG');
    }
    
    const result = await withPlayerLock(playerId, async (lockedPlayer) => {
        if (!lockedPlayer) {
            throw new Error('Игрок не найден');
        }

        if (lockedPlayer.coins < donation) {
            throw new Error('Недостаточно монет');
        }

        // Списание с игрока и добавление в казну клана
        await query(
            `UPDATE players SET coins = coins - $1, clan_donated = clan_donated + $1 
             WHERE id = $2`,
            [donation, playerId]
        );
        
        await query(
            `UPDATE clans SET total_donated = total_donated + $1 WHERE id = $2`,
            [donation, player.clan_id]
        );
        
        // Получаем обновленную сумму пожертвований клана
        const clanResult = await queryOne(
            `SELECT total_donated FROM clans WHERE id = $1`,
            [player.clan_id]
        );

        // Логируем пожертвование
        await logPlayerAction(pool, playerId, 'clan_donate', {
            clan_id: player.clan_id,
            amount: donation,
            new_balance: lockedPlayer.coins - donation
        });

        return { 
            success: true,
            donated: donation,
            new_balance: lockedPlayer.coins - donation,
            clan_total: clanResult?.total_donated || donation
        };
    });
    
    ok(res, result);
}));

// ============================================================================
// Namespace экспорт
// ============================================================================

const GameClans = {
    router,
    utils: {
        validateId,
        sanitizeName,
        serializeJSONField,
        withPlayerLock,
        logPlayerAction
    }
};

module.exports = router;
module.exports.GameClans = GameClans;
