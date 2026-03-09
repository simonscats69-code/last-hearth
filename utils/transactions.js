/**
 * Утилиты для работы с транзакциями и логированием
 * Объединяет транзакции с блокировкой и логирование действий игроков
 */

const { query, queryOne, tx } = require('../db/database');
const { logger } = require('./logger');

// =============================================================================
// Транзакции с блокировкой
// =============================================================================

/**
 * Выполнить функцию в транзакции с блокировкой игрока
 * @param {number} playerId - ID игрока
 * @param {function} fn - async функция с lockedPlayer
 * @returns {Promise<any>} результат функции
 */
async function withPlayerLock(playerId, fn) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { 
            message: 'Некорректный ID игрока', 
            code: 'INVALID_PLAYER_ID',
            statusCode: 400 
        };
    }
    
    return await tx(async () => {
        const lockedPlayer = await queryOne(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!lockedPlayer) {
            throw { 
                message: 'Игрок не найден', 
                code: 'PLAYER_NOT_FOUND',
                statusCode: 404 
            };
        }
        
        return await fn(lockedPlayer);
    });
}

/**
 * Выполнить функцию в транзакции с блокировкой клана
 * @param {number} clanId - ID клана
 * @param {function} fn - async функция с lockedClan
 * @returns {Promise<any>} результат функции
 */
async function withClanLock(clanId, fn) {
    if (!Number.isInteger(clanId) || clanId <= 0) {
        throw { 
            message: 'Некорректный ID клана', 
            code: 'INVALID_CLAN_ID',
            statusCode: 400 
        };
    }
    
    return await tx(async () => {
        const lockedClan = await queryOne(
            'SELECT * FROM clans WHERE id = $1 FOR UPDATE',
            [clanId]
        );
        
        if (!lockedClan) {
            throw { 
                message: 'Клан не найден', 
                code: 'CLAN_NOT_FOUND',
                statusCode: 404 
            };
        }
        
        return await fn(lockedClan);
    });
}

/**
 * Выполнить функцию в транзакции с блокировкой игрока и клана
 * @param {number} playerId - ID игрока
 * @param {number} clanId - ID клана
 * @param {function} fn - async функция с lockedPlayer, lockedClan
 * @returns {Promise<any>} результат функции
 */
async function withPlayerAndClanLock(playerId, clanId, fn) {
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw { 
            message: 'Некорректный ID игрока', 
            code: 'INVALID_PLAYER_ID',
            statusCode: 400 
        };
    }
    
    if (!Number.isInteger(clanId) || clanId <= 0) {
        throw { 
            message: 'Некорректный ID клана', 
            code: 'INVALID_CLAN_ID',
            statusCode: 400 
        };
    }
    
    return await tx(async () => {
        const lockedPlayer = await queryOne(
            'SELECT * FROM players WHERE id = $1 FOR UPDATE',
            [playerId]
        );
        
        if (!lockedPlayer) {
            throw { 
                message: 'Игрок не найден', 
                code: 'PLAYER_NOT_FOUND',
                statusCode: 404 
            };
        }
        
        const lockedClan = await queryOne(
            'SELECT * FROM clans WHERE id = $1 FOR UPDATE',
            [clanId]
        );
        
        if (!lockedClan) {
            throw { 
                message: 'Клан не найден', 
                code: 'CLAN_NOT_FOUND',
                statusCode: 404 
            };
        }
        
        return await fn(lockedPlayer, lockedClan);
    });
}

// =============================================================================
// Middleware для проверки клана
// =============================================================================

/**
 * Middleware: проверка что игрок состоит в клане
 */
function ensureInClan(req, res, next) {
    const playerId = req.player?.id;
    
    if (!playerId) {
        return res.status(401).json({ 
            success: false, 
            error: 'Требуется авторизация',
            code: 'UNAUTHORIZED'
        });
    }
    
    queryOne(
        'SELECT c.*, pc.role as clan_role FROM players p ' +
        'LEFT JOIN clans c ON p.clan_id = c.id ' +
        'LEFT JOIN player_clans pc ON pc.player_id = p.id AND pc.clan_id = c.id ' +
        'WHERE p.id = $1',
        [playerId]
    ).then(playerWithClan => {
        if (!playerWithClan || !playerWithClan.clan_id) {
            return res.status(400).json({
                success: false,
                error: 'Вы не состоите в клане',
                code: 'NOT_IN_CLAN'
            });
        }
        
        req.clan = {
            id: playerWithClan.clan_id,
            name: playerWithClan.name,
            role: playerWithClan.clan_role,
            leaderId: playerWithClan.leader_id,
            membersCount: playerWithClan.members_count,
            level: playerWithClan.level
        };
        req.playerClan = playerWithClan;
        
        next();
    }).catch(err => {
        logger.error({ type: 'ensureInClan_error', message: err.message });
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки клана',
            code: 'INTERNAL_ERROR'
        });
    });
}

/**
 * Middleware: проверка что игрок - лидер клана
 */
function ensureLeader(req, res, next) {
    if (!req.clan) {
        return res.status(400).json({
            success: false,
            error: 'Сначала проверьте членство в клане (ensureInClan)',
            code: 'MIDDLEWARE_ORDER_ERROR'
        });
    }
    
    if (req.clan.role !== 'leader') {
        return res.status(403).json({
            success: false,
            error: 'Только лидер клана может это сделать',
            code: 'NOT_LEADER'
        });
    }
    
    next();
}

// =============================================================================
// Валидация ресурсов
// =============================================================================

/**
 * Проверить достаточно ли ресурсов у игрока
 */
function checkResources(player, resources, options = {}) {
    const { allowNegative = false } = options;
    
    if (resources.coins !== undefined) {
        if (!allowNegative && resources.coins < 0) {
            return { valid: false, error: 'Количество монет не может быть отрицательным', code: 'INVALID_AMOUNT' };
        }
        if (player.coins < resources.coins) {
            return { 
                valid: false, 
                error: `Недостаточно монет. Требуется: ${resources.coins}, у вас: ${player.coins}`,
                code: 'INSUFFICIENT_COINS',
                required: resources.coins,
                available: player.coins
            };
        }
    }
    
    if (resources.stars !== undefined) {
        if (!allowNegative && resources.stars < 0) {
            return { valid: false, error: 'Количество звёзд не может быть отрицательным', code: 'INVALID_AMOUNT' };
        }
        if (player.stars < resources.stars) {
            return { 
                valid: false, 
                error: `Недостаточно звёзд. Требуется: ${resources.stars}, у вас: ${player.stars}`,
                code: 'INSUFFICIENT_STARS',
                required: resources.stars,
                available: player.stars
            };
        }
    }
    
    if (resources.energy !== undefined) {
        if (!allowNegative && resources.energy < 0) {
            return { valid: false, error: 'Энергия не может быть отрицательной', code: 'INVALID_AMOUNT' };
        }
        if (player.energy < resources.energy) {
            return { 
                valid: false, 
                error: `Недостаточно энергии. Требуется: ${resources.energy}, у вас: ${player.energy}`,
                code: 'INSUFFICIENT_ENERGY',
                required: resources.energy,
                available: player.energy
            };
        }
    }
    
    if (resources.health !== undefined) {
        if (!allowNegative && resources.health < 0) {
            return { valid: false, error: 'Здоровье не может быть отрицательным', code: 'INVALID_AMOUNT' };
        }
        if (player.health < resources.health) {
            return { 
                valid: false, 
                error: `Недостаточно здоровья. Требуется: ${resources.health}, у вас: ${player.health}`,
                code: 'INSUFFICIENT_HEALTH',
                required: resources.health,
                available: player.health
            };
        }
    }
    
    return { valid: true };
}

/**
 * Проверить лимит клана (участники)
 */
function checkClanMembersLimit(clan, additionalMembers = 1) {
    if (!clan) {
        return { valid: false, error: 'Клан не найден', code: 'CLAN_NOT_FOUND' };
    }
    
    const currentMembers = clan.members_count || 0;
    const maxMembers = clan.max_members || 50;
    
    if (currentMembers + additionalMembers > maxMembers) {
        return { 
            valid: false, 
            error: `Клан полный. Максимум участников: ${maxMembers}`,
            code: 'CLAN_FULL',
            current: currentMembers,
            max: maxMembers
        };
    }
    
    return { valid: true };
}

// =============================================================================
// Пагинация
// =============================================================================

/**
 * Универсальная пагинация
 */
async function paginate(countSql, countParams, dataSql, dataParams, options = {}) {
    const { defaultLimit = 10, maxLimit = 50 } = options;
    
    let limit = defaultLimit;
    let offset = 0;
    
    if (options.page !== undefined && options.limit !== undefined) {
        limit = Math.min(Math.max(1, options.limit), maxLimit);
        offset = (options.page - 1) * limit;
    } else if (options.limit !== undefined) {
        limit = Math.min(Math.max(1, options.limit), maxLimit);
        offset = options.offset || 0;
    }
    
    const totalResult = await query(countSql, countParams);
    const total = parseInt(totalResult.rows[0]?.count || 0, 10);
    
    const dataResult = await query(
        `${dataSql} LIMIT $${dataParams.length + 1} OFFSET $${dataParams.length + 2}`,
        [...dataParams, limit, offset]
    );
    
    const page = Math.floor(offset / limit) + 1;
    const hasMore = offset + dataResult.rows.length < total;
    
    return {
        data: dataResult.rows,
        total,
        page,
        limit,
        hasMore,
        rows: dataResult.rows,
        count: total
    };
}

/**
 * Простая пагинация с limit/offset
 */
function simplePaginate(queryObject, limit, offset) {
    const total = queryObject.rowCount || queryObject.rows?.length || 0;
    const page = Math.floor(offset / limit) + 1;
    const hasMore = offset + queryObject.rows.length < total;
    
    return {
        data: queryObject.rows,
        total,
        page,
        limit,
        hasMore,
        rows: queryObject.rows,
        count: total
    };
}

// =============================================================================
// Универсальные валидаторы
// =============================================================================

/**
 * Валидация ID
 */
function validateId(id, fieldName = 'id') {
    if (id === undefined || id === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    if (!Number.isInteger(id) || id <= 0) {
        return { valid: false, error: `Некорректный ${fieldName}`, code: 'INVALID_ID' };
    }
    return { valid: true };
}

/**
 * Валидация диапазона
 */
function validateRange(value, min, max, fieldName = 'значение') {
    if (value === undefined || value === null) {
        return { valid: false, error: `Требуется ${fieldName}`, code: 'MISSING_FIELD' };
    }
    if (!Number.isInteger(value)) {
        return { valid: false, error: `${fieldName} должно быть целым числом`, code: 'INVALID_TYPE' };
    }
    if (value < min || value > max) {
        return { valid: false, error: `${fieldName} должно быть от ${min} до ${max}`, code: 'OUT_OF_RANGE' };
    }
    return { valid: true };
}

// =============================================================================
// Утилиты для работы с JSON
// =============================================================================

/**
 * Сериализация значения в JSON-строку
 */
function serializeJSONField(value) {
    if (value === undefined || value === null) {
        return '{}';
    }
    if (typeof value === 'function') {
        return '{}';
    }
    try {
        return JSON.stringify(value);
    } catch (error) {
        return '{}';
    }
}

/**
 * Безопасное превращение объекта в строку
 */
function safeStringify(obj, space) {
    if (obj === undefined || obj === null) {
        return '{}';
    }
    if (typeof obj === 'function') {
        return '{}';
    }
    try {
        return JSON.stringify(obj, null, space);
    } catch (error) {
        return '{}';
    }
}

/**
 * Безопасный парсинг JSON-строки
 */
function parseJSONField(str, defaultValue = {}) {
    if (!str || typeof str !== 'string') {
        return defaultValue;
    }
    if (!str.trim()) {
        return defaultValue;
    }
    try {
        return JSON.parse(str);
    } catch (error) {
        return defaultValue;
    }
}

// =============================================================================
// Логирование действий игроков
// =============================================================================

const PLAYER_ACTIONS_TABLE = 'player_logs';

/**
 * Централизованный обработчик ошибок логирования
 */
function handleLogError(error, context) {
    console.error(`[${context}] Ошибка логирования:`, error.message);
}

/**
 * Логирование действия игрока в БД
 */
async function logPlayerAction(poolConnection, playerId, action, meta = {}) {
    if (!poolConnection || !playerId || !action) {
        console.error('[logPlayerAction] Некорректные параметры');
        return;
    }

    try {
        const serializedMeta = serializeJSONField(meta);
        await poolConnection.query(
            `INSERT INTO ${PLAYER_ACTIONS_TABLE} (player_id, action, meta, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, serializedMeta]
        );
    } catch (error) {
        handleLogError(error, 'logPlayerAction');
    }
}

/**
 * Логирование действия игрока в рамках транзакции
 */
async function logPlayerActionWithTx(tx, playerId, action, meta = {}) {
    if (!tx || !playerId || !action) {
        console.error('[logPlayerActionWithTx] Некорректные параметры');
        return;
    }

    try {
        const serializedMeta = serializeJSONField(meta);
        await tx.query(
            `INSERT INTO ${PLAYER_ACTIONS_TABLE} (player_id, action, meta, created_at) 
             VALUES ($1, $2, $3, NOW())`,
            [playerId, action, serializedMeta]
        );
    } catch (error) {
        handleLogError(error, 'logPlayerActionWithTx');
    }
}

// =============================================================================
// Экспорт
// =============================================================================

module.exports = {
    // Транзакции с блокировкой
    withPlayerLock,
    withClanLock,
    withPlayerAndClanLock,
    
    // Middleware для клана
    ensureInClan,
    ensureLeader,
    
    // Валидация ресурсов
    checkResources,
    checkClanMembersLimit,
    
    // Пагинация
    paginate,
    simplePaginate,
    
    // Универсальные валидаторы
    validateId,
    validateRange,
    
    // JSON утилиты
    serializeJSONField,
    safeStringify,
    parseJSONField,
    
    // Логирование
    logPlayerAction,
    logPlayerActionWithTx,
    PLAYER_ACTIONS_TABLE
};
