/**
 * База игрока (production-ready версия)
 * 
 * Улучшения:
 * - Транзакции с SELECT FOR UPDATE для атомарности
 * - Валидация входных данных (ID, строки)
 * - Логирование действий в player_logs
 * - Единый формат ответов { success, data/error, code }
 * - Namespace: GameBase
 * - Централизованный обработчик ошибок
 */

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../../db/database');
const { logger, logPlayerError } = require('../../utils/logger');
const { withPlayerLock } = require('../../utils/transactions');

// ============================================================================
// Константы и утилиты
// ============================================================================

// Доступные постройки
const BUILDINGS = {
    wall: { id: 'wall', name: 'Стена', description: 'Защита от рейдов', cost: 100, level: 1 },
    floor: { id: 'floor', name: 'Пол', description: 'Основа для построек', cost: 50, level: 1 },
    workbench: { id: 'workbench', name: 'Верстак', description: 'Простой крафт', cost: 200, level: 1 },
    forge: { id: 'forge', name: 'Кузня', description: 'Крафт оружия и брони', cost: 500, level: 1 },
    lab: { id: 'lab', name: 'Лаборатория', description: 'Медицина и химия', cost: 800, level: 1 },
    garden: { id: 'garden', name: 'Огород', description: 'Еда и вода', cost: 300, level: 1 },
    storage: { id: 'storage', name: 'Кладовая', description: 'Хранение вещей', cost: 400, level: 1 },
    watchtower: { id: 'watchtower', name: 'Вышка', description: 'Раннее предупреждение', cost: 350, level: 1 }
};

/**
 * Валидация ID (Number.isInteger и > 0)
 */
const isValidId = (id) => Number.isInteger(id) && id > 0;

/**
 * Валидация строки
 */
const isValidString = (str, minLen = 1, maxLen = 100) => {
    return typeof str === 'string' && str.length >= minLen && str.length <= maxLen;
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
 * Парсинг JSON с fallback
 */
const safeParse = (value, fallback = {}) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        logger.error({ type: 'base_json_parse_error', value: typeof value, value_preview: String(value).substring(0, 100) });
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
        logger.error(`[BASE] ${action}: ${error.message}`, {
            stack: error.stack
        });
    }

    let code = 'INTERNAL_ERROR';
    let statusCode = 500;

    if (error.message.includes('достаточно') || error.message.includes('монет')) {
        code = 'INSUFFICIENT_COINS';
        statusCode = 400;
    } else if (error.message.includes('не найден') || error.message.includes('постройка')) {
        code = 'NOT_FOUND';
        statusCode = 404;
    } else if (error.message.includes('уже построено') || error.message.includes('построен')) {
        code = 'ALREADY_BUILT';
        statusCode = 400;
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
 * Транзакция с блокировкой игрока
 */
// Импортировать из transactionHelpers: withPlayerLock
// Удалено - используйте utils/transactionHelpers.js

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
 * Получение списка зданий
 * GET /base/buildings → GET /api/game/base/buildings
 * Путь: /buildings (внутри роутера)
 */
router.get('/buildings', async (req, res) => {
    const playerId = req.player?.id;
    
    try {
        // Возвращаем доступные постройки
        const buildings = Object.values(BUILDINGS).map(b => ({
            id: b.id,
            name: b.name,
            description: b.description,
            cost: b.cost,
            level: b.level
        }));

        // Логируем действие
        await logPlayerAction(playerId, 'view_buildings', {
            buildings_count: buildings.length
        });

        ok(res, { buildings });

    } catch (error) {
        return handleError(res, error, 'view_buildings', playerId);
    }
});

/**
 * Получение базы игрока
 * GET /base → GET /api/game/base
 * Путь: / (корень внутри роутера)
 */
router.get('/', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    try {
        const base = safeParse(player.base, {});
        
        ok(res, {
            base,
            coins: player.coins
        });

    } catch (error) {
        return handleError(res, error, 'view_base', playerId);
    }
});

/**
 * Постройка/улучшение здания (с транзакцией)
 * POST /base/build → POST /api/game/base/build
 * Путь: /build (внутри роутера)
 */
router.post('/build', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;

    try {
        // Валидация входных данных
        const { building_id, upgrade = false } = req.body;
        
        if (!isValidString(building_id, 1, 50)) {
            return fail(res, 'Укажите корректный ID здания', 'INVALID_BUILDING_ID');
        }

        // Проверяем, что здание существует
        if (!BUILDINGS[building_id]) {
            return fail(res, 'Здание не найдено: ' + building_id, 'BUILDING_NOT_FOUND');
        }

        // Выполняем постройку в транзакции с блокировкой
        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            if (!lockedPlayer) {
                throw new Error('Игрок не найден');
            }

            // Получаем актуальные данные
            const base = safeParse(lockedPlayer.base, {});
            const currentLevel = base[building_id] || 0;
            const currentCoins = lockedPlayer.coins || 0;

            // Проверяем, можем ли построить
            if (!upgrade && currentLevel > 0) {
                throw new Error('Здание уже построено. Используйте upgrade для улучшения.');
            }

            // Вычисляем стоимость
            const baseCost = BUILDINGS[building_id].cost;
            const cost = baseCost * (upgrade ? currentLevel + 1 : 1);

            // Проверяем монеты
            if (currentCoins < cost) {
                throw new Error('Недостаточно монет');
            }

            // Строим/улучшаем
            base[building_id] = currentLevel + 1;

            // Обновляем в транзакции с RETURNING
            const updated = await query(`
                UPDATE players 
                SET base = $1, coins = coins - $2
                WHERE id = $3
                RETURNING coins
            `, [safeStringify(base), cost, playerId]);
            
            const coinsRemaining = updated.rows[0]?.coins || 0;

            // Логируем действие
            await logPlayerAction(playerId, 'build_structure', {
                building_id,
                building_name: BUILDINGS[building_id].name,
                level: base[building_id],
                cost,
                is_upgrade: upgrade,
                previous_level: currentLevel
            });

            return {
                message: 'Постройка завершена!',
                building: {
                    id: building_id,
                    level: base[building_id],
                    name: BUILDINGS[building_id].name
                },
                coins_spent: cost,
                coins_remaining: coinsRemaining
            };
        });

        ok(res, result);

    } catch (error) {
        return handleError(res, error, 'build_structure', playerId);
    }
});

/**
 * Улучшение здания (алиас для build с upgrade=true)
 * POST /base/upgrade
 * @deprecated Используйте /base/build с параметром upgrade: true
 */
router.post('/base/upgrade', async (req, res) => {
    const player = req.player;
    const playerId = player?.id;
    
    try {
        logger.warn('Используется устаревший маршрут /base/upgrade', { playerId });
        
        req.body.upgrade = true;
        
        // Вызываем основной обработчик
        const { building_id } = req.body;
        
        if (!isValidString(building_id, 1, 50)) {
            return fail(res, 'Укажите корректный ID здания', 'INVALID_BUILDING_ID');
        }

        if (!BUILDINGS[building_id]) {
            return fail(res, 'Здание не найдено: ' + building_id, 'BUILDING_NOT_FOUND');
        }

        const result = await withPlayerLock(playerId, async (lockedPlayer) => {
            if (!lockedPlayer) {
                throw new Error('Игрок не найден');
            }

            const base = safeParse(lockedPlayer.base, {});
            const currentLevel = base[building_id] || 0;
            const currentCoins = lockedPlayer.coins || 0;

            if (currentLevel === 0) {
                throw new Error('Здание не построено. Сначала постройте его.');
            }

            const baseCost = BUILDINGS[building_id].cost;
            const cost = baseCost * (currentLevel + 1);

            if (currentCoins < cost) {
                throw new Error('Недостаточно монет');
            }

            base[building_id] = currentLevel + 1;

            await query(`
                UPDATE players 
                SET base = $1, coins = coins - $2
                WHERE id = $3
            `, [safeStringify(base), cost, playerId]);

            await logPlayerAction(playerId, 'upgrade_structure', {
                building_id,
                building_name: BUILDINGS[building_id].name,
                new_level: base[building_id],
                cost
            });

            return {
                message: 'Улучшение завершено!',
                building: {
                    id: building_id,
                    level: base[building_id],
                    name: BUILDINGS[building_id].name
                },
                coins_spent: cost
            };
        });

        ok(res, result);

    } catch (error) {
        return handleError(res, error, 'upgrade_structure', playerId);
    }
});

// ============================================================================
// Namespace экспорт
// ============================================================================

const GameBase = {
    router,
    BUILDINGS,
    utils: {
        isValidId,
        isValidString,
        safeStringify,
        safeParse,
        handleError,
        withPlayerLock,
        logPlayerAction
    }
};

module.exports = router;
module.exports.GameBase = GameBase;
