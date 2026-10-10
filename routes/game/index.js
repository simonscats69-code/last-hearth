/**
 * Главный файл игровых роутеров
 * Объединяет все модули game API
 */

const express = require('express');
const router = express.Router();
const { query, queryOne, describeError } = require('../../db/database');
const rateLimit = require('express-rate-limit');
const { validateTelegramInitData, logger, idempotencyMiddleware } = require('../../utils/serverApi');

// ====== ЛИМИТЫ ЗАПРОСОВ ======
//
// Ключ лимита — только req.player.id. По req.ip нельзя: в мобильных сетях
// (CGNAT) один адрес делят десятки игроков, и они блокируют друг друга —
// трое соседей по сети исчерпывали общий лимит атак и все трое получали
// 429 «Слишком много попыток авторизации».
//
// Ключевая проблема — ключ по req.ip: в мобильных сетях (CGNAT) один адрес
// делят десятки игроков, поэтому игроки блокировали друг друга. Ни один
// игровой лимит больше не привязан к IP.
//
// Итоговая схема:
//  1) антифлуд по IP — ДО авторизации, только чтобы прикрыть ботов без initData;
//  2) validatePlayer — проверка подписи Telegram, определяет req.player.id;
//  3) ВСЕ игровые лимиты — ПОСЛЕ авторизации и по id игрока;
//  4) общий лимит игрока — последний, тоже по id игрока.
const ipFloodLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Слишком много запросов. Подождите минуту.', code: 'IP_RATE_LIMIT' },
    keyGenerator: (req) => req.ip
});

// Ключ лимитов, которые живут ПОСЛЕ validatePlayer.
// Строка приводится явно: player.id — число, а в БД он bigint, который
// в JSON приходит как строка. Смешивать числа и строки в одном ключе нельзя —
// иначе один и тот же игрок получил бы два независимых счётчика.
const playerKey = (req) => String(req.player?.id ?? req.ip);

const criticalActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    // Удары по боссу и PvP. Энергия (1 за удар) остаётся главным ограничителем,
    // лимит — только страховка от спама кликом.
    max: 60,
    message: { error: 'Слишком много атак. Отдохните минуту.', code: 'CRITICAL_ACTION_LIMIT' },
    keyGenerator: playerKey
});

// Общий лимит на игрока — ЕДИНСТВЕННЫЙ на этом уровне.
//
// Раньше здесь висело два последовательных router.use(generalActionLimiter)
// (max: 60) и router.use(playerActionLimiter) (max: 120): первый всегда
// срабатывал первым, поэтому фактический лимит был 60/мин, а лимитер на 120
// был недостижимым мёртвым кодом — и его комментарий «120/мин хватает на бой
// и фарм» не соответствовал поведению. Легитимный бой (удар + добивка +
// инвентарь + профиль) упирался в 429.
//
// Теперь один лимитер, ровно с теми 120/мин, которые и задумывались.
// Точечные лимиты выше (атаки 60/мин, покупки 20/мин) остаются отдельными.
const generalActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Слишком много запросов. Подождите минуту.', code: 'ACTION_LIMIT' },
    keyGenerator: playerKey
});

const purchaseLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Слишком много покупок.', code: 'PURCHASE_LIMIT' },
    keyGenerator: playerKey
});

// Загрузка роутеров без шума в логах.
//
// Успешные сообщения уходят на debug: на уровне info старт остаётся
// читаемым. Реальную ошибку логирует только catch.
function safeRequire(path, name) {
    try {
        let module = require(path);

        if (typeof module === 'function' && !Array.isArray(module.stack)) {
            module = module();
        }

        if (module && typeof module === 'object') {
            if (module.router) return module.router;
            if (module.get || module.post || module.put || module.delete || module.patch) return module;
            if (Array.isArray(module.stack)) return module;
        }

        return module;
    } catch (error) {
        logger.error(`[game] Ошибка загрузки ${name}:`, error.message, error.stack);
        const mockRouter = express.Router();
        mockRouter.use((req, res) => res.status(500).json({ error: `Модуль ${name} недоступен` }));
        return mockRouter;
    }
}

// Импорт роутеров (объединённые модули)
const worldRouter = safeRequire('./world', 'world');
const bossesRouter = safeRequire('./bosses', 'bosses');

const clansRouter = safeRequire('./clans', 'clans');
const pvpRouter = safeRequire('./pvp', 'pvp');
const playerRouter = safeRequire('./player', 'player');
const itemsRouter = safeRequire('./items', 'items');
const workshopRouter = safeRequire('./workshop', 'workshop');
const statusRouter = safeRequire('./status', 'status');
const minigamesRouter = safeRequire('./minigames', 'minigames');

async function upsertPlayerFromTelegramUser(user) {
    const telegramId = Number(user.id);

    return await upsertOnce(user, telegramId);
}

async function upsertOnce(user, telegramId) {
    return await queryOne(`
        INSERT INTO players (
            telegram_id,
            username,
            first_name,
            last_name,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (telegram_id)
        DO UPDATE SET
            username = COALESCE(EXCLUDED.username, players.username),
            first_name = COALESCE(EXCLUDED.first_name, players.first_name),
            last_name = COALESCE(EXCLUDED.last_name, players.last_name),
            updated_at = NOW()
        RETURNING *
    `, [
        telegramId,
        user.username || null,
        user.first_name || 'Player',
        user.last_name || null
    ]);
}

function buildRequestPlayer(user, dbPlayer) {
    return {
        ...dbPlayer,
        id: Number(dbPlayer.id),
        player_id: Number(dbPlayer.id),
        telegram_id: Number(dbPlayer.telegram_id),
        username: dbPlayer.username || user.username || null,
        first_name: dbPlayer.first_name || user.first_name || 'Player',
        last_name: dbPlayer.last_name || user.last_name || null,
        language_code: user.language_code || 'ru',
        is_premium: Boolean(user.is_premium),
        telegram_user: user
    };
}

/**
 * Разбор пользователя из initData без проверки подписи.
 * Допустим ТОЛЬКО в development (когда нет TG_BOT_TOKEN и проверить подпись невозможно).
 */
function parseUserFromInitDataUnsafe(initData) {
    try {
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user') || '{}');
        return user?.id ? { user } : null;
    } catch {
        return null;
    }
}

// Middleware для валидации Telegram данных
async function validatePlayer(req, res, next) {
    try {
        const initData = req.headers['x-telegram-init-data'] || req.headers['x-init-data'];
        const botToken = process.env.TG_BOT_TOKEN;

        if (!initData) {
            logger.warn('[validatePlayer] Отсутствует initData');
            return res.status(401).json({ error: 'Нет данных авторизации' });
        }

        let validated;
        if (botToken) {
            validated = validateTelegramInitData(initData, botToken);
        } else if (process.env.NODE_ENV !== 'production') {
            // Dev-режим без токена: подпись проверить нечем, разбираем как есть
            logger.warn('[validatePlayer] TG_BOT_TOKEN не настроен — авторизация без проверки подписи (development)');
            validated = parseUserFromInitDataUnsafe(initData);
        }

        if (!validated) {
            logger.warn('[validatePlayer] Невалидные данные авторизации', {
                initDataLength: initData.length,
                hasBotToken: !!botToken
            });
            return res.status(401).json({ error: 'Невалидные данные авторизации' });
        }

        const dbPlayer = await upsertPlayerFromTelegramUser(validated.user);
        
        if (dbPlayer.banned) {
            logger.warn({ type: 'banned_player_access', playerId: dbPlayer.id, telegramId: validated.user.id });
            return res.status(403).json({ error: 'Ваш аккаунт заблокирован.' });
        }
        
        req.player = buildRequestPlayer(validated.user, dbPlayer);
        req.telegramAuth = validated;

        // Отметка активности. Колонка last_action_time была DEFAULT NOW()
        // при регистрации и больше НИКОГДА не обновлялась: игроки вечно
        // считались офлайн в кланах (is_online), а планировщик достижений
        // выбирал для проверки только тех, кто зарегистрировался за сутки.
        // Пишем не чаще раза в 5 минут на игрока — иначе это лишний UPDATE
        // на каждый запрос; троттлинг держится в памяти процесса.
        touchPlayerActivity(dbPlayer.id);

        logger.info('[validatePlayer] Авторизация успешна', {
            telegramId: validated.user.id,
            playerId: dbPlayer.id,
            firstName: validated.user.first_name,
            username: validated.user.username
        });

        next();
    } catch (error) {
        logger.error('[game] Ошибка валидации игрока:', error);
        return res.status(500).json({ error: 'Ошибка сервера' });
    }
}

/**
 * Отметка «игрок активен» с троттлингом.
 *
 * Запись в БД делается не чаще раза в 5 минут на игрока: защита
 * last_action_time нужна кланам (онлайн), планировщику достижений и
 * админской статистике, но обновлять её на каждом запросе слишком дорого.
 *
 * @param {number} playerId
 */
const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastActivityTouch = new Map();

/**
 * Через сколько чистить «залипшие» записи шины активности.
 *
 * Запись живёт только чтобы троттлить UPDATE last_action_time: одно
 * значение на игрока. Без чистки Map растёт по числу уникальных игроков
 * (десятки тысяч) и держит ключи, которые уже никогда не пригодятся.
 * Один проход в час — дешёвая страховка.
 */
const ACTIVITY_BUS_RETENTION_MS = 60 * 60 * 1000;

/**
 * Удаляет из Map записи, которые никто не трогал дольше retention.
 * Идемпотентно: запись заново создастся при следующем запросе игрока.
 * @param {number} [retentionMs]
 * @returns {number} сколько записей удалено
 */
function pruneActivityBus(retentionMs = ACTIVITY_BUS_RETENTION_MS) {
    const cutoff = Date.now() - retentionMs;
    let removed = 0;
    for (const [id, at] of lastActivityTouch) {
        if (at < cutoff) {
            lastActivityTouch.delete(id);
            removed++;
        }
    }
    return removed;
}

function touchPlayerActivity(playerId) {
    const id = Number(playerId);
    if (!Number.isInteger(id) || id <= 0) return;

    const now = Date.now();
    const last = lastActivityTouch.get(id) || 0;
    if (now - last < ACTIVITY_TOUCH_INTERVAL_MS) return;

    lastActivityTouch.set(id, now);

    // Периодически подчищаем шину. Сравнение по остатку от деления, чтобы не
    // заводить отдельный setInterval: чистим не чаще раза в минуту.
    pruneActivityBus(ACTIVITY_BUS_RETENTION_MS);

    // Ошибку не пробрасываем: отметка активности не должна ломать запрос.
    query(
        `UPDATE players
            SET last_action_time = NOW()
          WHERE id = $1
            AND (last_action_time IS NULL OR last_action_time < NOW() - INTERVAL '5 minutes')`,
        [id]
    ).catch((error) => {
        lastActivityTouch.delete(id);
        logger.warn('[activity] Не удалось обновить last_action_time', describeError(error));
    });
}

// ====== 1. АНТИФЛУД ПО IP (до авторизации: клиент ещё не известен) ======
// Стоит первым, чтобы бот без валидного initData не долбил обработчики.
// 120/мин на адрес: в мобильных сетях (CGNAT) адрес общий у многих игроков,
// поэтому лимит должен быть заметно выше игрового.
router.use(ipFloodLimiter);

// ====== 2. ВАЛИДАЦИЯ ИГРОКА ======
router.use(validatePlayer);

// ====== 3. ЛИМИТЫ ОТДЕЛЬНЫХ ДЕЙСТВИЙ (уже по id игрока) ======
//
// Эти лимиты обязаны стоять ПОСЛЕ validatePlayer: до него игрока ещё нет,
// и keyGenerator по id не сработает. Собственный счётчик у каждого игрока.
router.use('/bosses/attack-boss', criticalActionLimiter);
router.use('/bosses/attack-with-weapon', criticalActionLimiter);
router.use(/^\/bosses\/raid\/\d+\/attack$/, criticalActionLimiter);
router.use('/pvp/attack', criticalActionLimiter);
router.use('/pvp/attack-hit', criticalActionLimiter);
router.use('/minigames/wheel/spin', criticalActionLimiter);
router.use('/minigames/purchase', purchaseLimiter);
// Ремонт, улучшение и модификация — траты ресурсов, поэтому под лимитом покупок.
router.use('/workshop/repair', purchaseLimiter);
router.use('/workshop/upgrade', purchaseLimiter);
router.use('/workshop/modify', purchaseLimiter);
router.use('/items/buy', purchaseLimiter);
router.use('/items/buy-stars', purchaseLimiter);
// Алиас /inventory монтирует тот же роутер предметов (см. конец файла),
// поэтому лимиты трат монет нужно продублировать: иначе /inventory/buy
// и /inventory/buy-stars проходили бы мимо purchaseLimiter.
router.use('/inventory/buy', purchaseLimiter);
router.use('/inventory/buy-stars', purchaseLimiter);

// Лимитер чата клана. Общий лимитер ниже (120/мин) допускал ~2 сообщения
// в секунду: этого хватало, чтобы завалить clan_chat чужими участниками.
// Чат — не бой, поэтому окно шире и планка ниже.
const chatLimiter = rateLimit({
    windowMs: 30 * 1000,
    max: 10,
    message: { error: 'Слишком часто отправляешь сообщения. Подожди немного.', code: 'CHAT_RATE_LIMIT' },
    keyGenerator: playerKey
});
router.use('/clans/clan/chat', chatLimiter);

// ====== ИДЕМПОТЕНТНОСТЬ МУТАЦИЙ ======
// P1-8: раньше idempotencyMiddleware висел на app.use('/api/game', ...) в
// index.js — то есть ДО validatePlayer. В этот момент req.player ещё не
// установлен, playerId undefined, и middleware всегда уходил в next(),
// ничего не проверяя и ничего не сохраняя: мёртвый код, который только
// добавлял req/res-обёртки.
//
// Теперь он смонтирован ЗДЕСЬ, после validatePlayer (есть req.player.id),
// но ПОСЛЕ лимитов запросов: иначе запросы с разными ключами обходили бы
// rate-limit вообще, не расходуя бюджет. Повторы с тем же ключом попадут
// под реплей и не выполнят действие второй раз.
router.use(idempotencyMiddleware);

// Общий лимит на игрока — последний, тоже по id игрока.
router.use(generalActionLimiter);

// ====== ЛОГИРОВАНИЕ ======
router.use((req, res, next) => {
    logger.info('[game] Входящий запрос:', { method: req.method, path: req.path, originalUrl: req.originalUrl, playerId: req.player?.id });
    next();
});

// ====== ПОДКЛЮЧЕНИЕ РОУТЕРОВ ======
router.use('/world', worldRouter);
router.use('/bosses', bossesRouter);
router.use('/clans', clansRouter);
router.use('/pvp', pvpRouter);
router.use('/player', playerRouter);
router.use('/items', itemsRouter);
router.use('/workshop', workshopRouter);
router.use('/status', statusRouter);
router.use('/minigames', minigamesRouter);

// Алиасы для обратной совместимости
router.use('/locations', worldRouter);
router.use('/profile', playerRouter);
router.use('/inventory', itemsRouter);
router.use('/wheel', minigamesRouter);
router.use('/purchase', minigamesRouter);

module.exports = router;
