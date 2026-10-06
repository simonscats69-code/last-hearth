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
const { withPlayerLock, validateId, sanitizeName, ok, fail, notFound, wrap, logPlayerAction, logger, ERROR_MESSAGES } = require('../../utils/serverApi');

const crypto = require('crypto');

function generateClanInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'CL-';

    for (let i = 0; i < 6; i++) {
        const randomIndex = crypto.randomInt(0, chars.length);
        code += chars.charAt(randomIndex);
    }

    return code;
}



/**
 * Получение информации о клане игрока
 * GET /clan
 */
router.get('/clan', wrap(async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    // Отсутствие клана — это НЕ ошибка запроса, а обычное состояние игрока.
    // Раньше здесь был fail(..., 'NOT_IN_CLAN') = HTTP 400, и браузер писал в
    // консоль красное «Failed to load resource: 400» при каждом открытии
    // экрана клана. Клиент всё равно трактует in_clan:false как «клана нет»
    // (loadClan в public/game.js), поэтому отдаём 200 + явное состояние.
    if (!player.clan_id) {
        return ok(res, {
            in_clan: false,
            is_leader: false,
            clan: null,
            members: [],
            player_role: null
        });
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
                            'clan_donated', p.clan_donated,
                            'is_online', CASE
                                WHEN p.last_action_time IS NOT NULL AND p.last_action_time > NOW() - INTERVAL '10 minutes' THEN true
                                ELSE false
                            END
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
    await logPlayerAction(playerId, 'view_clan', {
        clan_id: player.clan_id
    });

    ok(res, {
            in_clan: true,
            is_leader: player.clan_role === 'leader',
            clan: { 
                id: data.id, 
                name: data.name, 
                description: data.description, 
                leader_id: data.leader_id, 
                level: Number(data.level || 1),
                coins: Number(data.coins || 0),
                loot_bonus: Number(data.loot_bonus || 0),
                invite_code: data.invite_code || '—',
                is_open: data.is_open !== false,
                is_public: data.is_public !== false,
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
    const { name, description = '', is_public: isPublicBody, is_open: isOpenBody } = req.body;
    // Отдельный код приглашения на каждое создание. Генерация перенесена
    // внутрь транзакции: код выдавался ДО проверок, и при откате (занятое
    // имя, не хватило монет) он «сгорал» впустую — попытка создать клан
    // после ошибки тратила ещё одну.
    let inviteCode = null;

    // is_open (приглашать по коду) и is_public (показывать в списке) —
    // РАЗНЫЕ настройки.
    const isPublic = isPublicBody === undefined ? true : Boolean(isPublicBody);
    const isOpen = isOpenBody === undefined ? true : Boolean(isOpenBody);
    
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
    
    const result = await withPlayerLock(playerId, async (client, lockedPlayer) => {
        if (!lockedPlayer) {
            // statusCode обязателен: без него handleError отдаёт 500
            // и игрок видит «Внутренняя ошибка» вместо понятного текста
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        // Проверяем монеты еще раз внутри транзакции
        if (lockedPlayer.coins < 1000) {
            throw { message: ERROR_MESSAGES.INSUFFICIENT_COINS, code: 'INSUFFICIENT_COINS', statusCode: 400 };
        }

        // Проверяем уникальность имени клана
        const existingClanResult = await client.query(
            'SELECT id FROM clans WHERE LOWER(name) = LOWER($1)',
            [nameValidation.value]
        );
        const existingClan = existingClanResult.rows[0];
        if (existingClan) {
            // 409 Conflict: имя занято, это ожидаемое состояние, а не сбой
            throw { message: 'Клан с таким именем уже существует', code: 'CLAN_NAME_TAKEN', statusCode: 409 };
        }

        // Код приглашения генерируем здесь: транзакция могла откатиться
        // на проверке имени или монет, и код, выданный заранее, пропал бы.
        // invite_code объявлен UNIQUE, поэтому коллизия (32^6 ≈ 10^9 вариантов,
        // но при тысячах кланов исход уже не единичный) дала бы 500 с текстом
        // PostgreSQL. Повторяем попытку до успеха.
        const MAX_INVITE_ATTEMPTS = 5;
        let insertResult = null;
        let lastInviteError = null;

        for (let attempt = 1; attempt <= MAX_INVITE_ATTEMPTS; attempt++) {
            inviteCode = generateClanInviteCode();
            try {
                insertResult = await client.query(
                    `INSERT INTO clans (name, description, leader_id, created_at, is_open, is_public, invite_code)
                     VALUES ($1, $2, $3, NOW(), $4, $5, $6) RETURNING id`,
                    // leader_id — ВНУТРЕННИЙ players.id, а не telegram_id.
                    [nameValidation.value, String(description).slice(0, 200), playerId, isOpen, isPublic, inviteCode]
                );
                break;
            } catch (insertError) {
                // 23505 — нарушение UNIQUE. Если это не invite_code,
                // повторять бессмысленно (например, конфликт по имени).
                const isInviteCollision = insertError?.code === '23505'
                    && String(insertError?.constraint || '').includes('invite_code');
                if (!isInviteCollision) throw insertError;
                lastInviteError = insertError;
            }
        }

        if (!insertResult) {
            logger.error('[clans] Не удалось сгенерировать свободный invite_code', {
                playerId,
                attempts: MAX_INVITE_ATTEMPTS,
                error: lastInviteError?.message
            });
            throw { message: 'Не удалось создать клан: код приглашения занят. Попробуй ещё раз.', code: 'INVITE_CODE_CONFLICT', statusCode: 503 };
        }

        const clanId = insertResult.rows[0].id;
        
        await client.query(
            `UPDATE players SET clan_id = $1, clan_role = 'leader', coins = coins - 1000 
             WHERE id = $2`,
            [clanId, playerId]
        );

        // Логируем создание клана
        await logPlayerAction(playerId, 'clan_create', {
            clan_id: clanId,
            clan_name: nameValidation.value,
            cost: 1000
        }, client);

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
    
    // Валидация ID клана.
    // Читаем .ok, а не .valid: serverApi.validateId возвращает { ok, ... },
    // и .valid там не было — проверка отклоняла ЛЮБОЙ clan_id, включая
    // корректный (вступить в клан было невозможно).
    const idValidation = validateId(clan_id, 'ID клана');
    if (!idValidation.ok) {
        return fail(res, idValidation.error, idValidation.code);
    }
    const clanId = idValidation.value;
    
    if (player.clan_id) {
        return fail(res, 'Вы уже состоите в клане', 'ALREADY_IN_CLAN');
    }
    
    const clan = await queryOne(
        `SELECT c.*, (SELECT COUNT(*) FROM players WHERE clan_id = c.id) AS members_count
         FROM clans c WHERE c.id = $1`,
        [clanId]
    );
    
    if (!clan) {
        return notFound(res, 'Клан не найден', 'CLAN_NOT_FOUND');
    }
    
    if (clan.is_open !== true) {
        return fail(res, 'Клан закрытый', 'CLAN_CLOSED');
    }
    
    if (Number(clan.members_count) >= 30) {
        return fail(res, 'Клан полный (макс. 30 участников)', 'CLAN_FULL');
    }
    
    const result = await withPlayerLock(playerId, async (client, lockedPlayer) => {
        if (!lockedPlayer) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        // Проверяем, что игрок не состоит в клане
        if (lockedPlayer.clan_id) {
            throw { message: 'Вы уже состоите в клане', code: 'ALREADY_IN_CLAN', statusCode: 400 };
        }

        // Проверяем количество участников
        const memberCountResult = await client.query(
            'SELECT COUNT(*) as count FROM players WHERE clan_id = $1',
            [clanId]
        );
        const memberCount = memberCountResult.rows[0];

        if (Number(memberCount.count) >= 30) {
            throw { message: 'Клан полный', code: 'CLAN_FULL', statusCode: 400 };
        }

        const updateResult = await client.query(`
            UPDATE players
            SET clan_id = $1, clan_role = 'member'
            WHERE id = $2
            AND clan_id IS NULL
            RETURNING id
        `, [clanId, playerId]);
        
        if (!updateResult.rows.length) {
            // Гонка: игрок успел вступить в другой клан между проверкой и UPDATE
            throw { message: 'Не удалось вступить (клан полный)', code: 'CLAN_JOIN_FAILED', statusCode: 409 };
        }

        // Логируем вступление
        await logPlayerAction(playerId, 'clan_join', {
            clan_id: clanId,
            clan_name: clan.name
        }, client);

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
    
    await withPlayerLock(playerId, async (client, lockedPlayer) => {
        if (!lockedPlayer) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        await client.query(
            `UPDATE players SET clan_id = NULL, clan_role = NULL WHERE id = $1`, 
            [playerId]
        );

        // Логируем выход из клана
        await logPlayerAction(playerId, 'clan_leave', {
            clan_id: player.clan_id
        }, client);
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
    const search = String(req.query.search || '').trim();
    
    // Пагинация
    let limit = parseInt(req.query.limit) || 20;
    let offset = parseInt(req.query.offset) || 0;
    
    limit = Math.min(Math.max(1, limit), 100);
    offset = Math.max(0, offset);

    // Получаем общее количество
    const hasSearch = search && search.trim().length > 0;
    const searchPattern = hasSearch ? `%${search}%` : '%%';

    let countQuery = 'SELECT COUNT(*) as total FROM clans c';
    let searchQuery = '';
    
    if (hasSearch) {
        searchQuery = ` WHERE c.name ILIKE $1 OR c.description ILIKE $1`;
        countQuery += searchQuery;
    }

    const countResult = hasSearch 
        ? await queryOne(countQuery, [searchPattern])
        : await queryOne(countQuery);
    const total = parseInt(countResult?.total || 0);

    // Получаем кланы с пагинацией
    let clansQuery = `
        SELECT c.*, (SELECT COUNT(*) FROM players WHERE clan_id = c.id) AS members_count 
        FROM clans c 
    `;
    
    if (hasSearch) {
        clansQuery += ` WHERE c.name ILIKE $3 OR c.description ILIKE $3`;
    }
    
    clansQuery += ` ORDER BY c.total_donated DESC LIMIT $1 OFFSET $2`;

    const clans = hasSearch
        ? await queryAll(clansQuery, [limit, offset, searchPattern])
        : await queryAll(clansQuery, [limit, offset]);

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
            level: Number(c.level || 1),
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
 * Получение участников клана
 * GET /clan/members
 */
router.get('/clan/members', wrap(async (req, res) => {
    const player = req.player;

    if (!player.clan_id) {
        return fail(res, 'Вы не состоите в клане', 'NOT_IN_CLAN');
    }

    const members = await queryAll(`
        SELECT id, telegram_id, username, first_name, level, clan_role, clan_donated,
               CASE
                   WHEN last_action_time IS NOT NULL AND last_action_time > NOW() - INTERVAL '10 minutes' THEN true
                   ELSE false
               END AS is_online
        FROM players
        WHERE clan_id = $1
        ORDER BY
            CASE clan_role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
            level DESC,
            first_name ASC NULLS LAST,
            username ASC NULLS LAST
    `, [player.clan_id]);

    ok(res, { members });
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
            SELECT cc.id, cc.message, cc.created_at, 
                   p.username, p.first_name, p.level
            FROM clan_chat cc
            JOIN players p ON cc.player_id = p.id
            WHERE cc.clan_id = $1
            ORDER BY cc.created_at DESC
            LIMIT 50
        `, [player.clan_id]);
        
        // Логируем просмотр чата
        await logPlayerAction(playerId, 'clan_chat_view', {
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
            `INSERT INTO clan_chat (clan_id, player_id, message, created_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, created_at`,
            [player.clan_id, playerId, trimmedMessage]
        );
        
        // Логируем отправку сообщения
        await logPlayerAction(playerId, 'clan_chat_send', {
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
    
    const result = await withPlayerLock(playerId, async (client, lockedPlayer) => {
        if (!lockedPlayer) {
            throw { message: 'Игрок не найден', code: 'PLAYER_NOT_FOUND', statusCode: 404 };
        }

        if (lockedPlayer.coins < donation) {
            throw { message: ERROR_MESSAGES.INSUFFICIENT_COINS, code: 'INSUFFICIENT_COINS', statusCode: 400 };
        }

        // Списание с игрока и добавление в казну клана
        await client.query(
            // COALESCE: у старых записей счётчик пожертвований мог быть NULL,
            // и clan_donated замирал навсегда вместо роста.
            `UPDATE players SET coins = coins - $1, clan_donated = COALESCE(clan_donated, 0) + $1
             WHERE id = $2`,
            [donation, playerId]
        );

        await client.query(
            `UPDATE clans
                SET total_donated = COALESCE(total_donated, 0) + $1,
                    coins = COALESCE(coins, 0) + $1
              WHERE id = $2`,
            [donation, player.clan_id]
        );
        
        // Получаем обновлённые показатели клана
        const clanResult = await client.query(
            `SELECT total_donated, coins FROM clans WHERE id = $1`,
            [player.clan_id]
        );

        // Логируем пожертвование (внутри транзакции — передаём client)
        await logPlayerAction(playerId, 'clan_donate', {
            clan_id: player.clan_id,
            amount: donation,
            new_balance: lockedPlayer.coins - donation
        }, client);

        return { 
            success: true,
            donated: donation,
            new_balance: lockedPlayer.coins - donation,
            clan_total: clanResult.rows[0]?.coins || donation,
            total_donated: clanResult.rows[0]?.total_donated || donation
        };
    });
    
    ok(res, result);
}));
module.exports = router;
