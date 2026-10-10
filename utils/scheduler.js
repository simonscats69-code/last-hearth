/**
 * Планировщик задач (Cron)
 * Массовые операции на сервере
 * 
 * Особенности:
 * - setTimeout вместо setInterval (защита от наложений)
 * - Метрики выполнения
 * - Транзакции для атомарных операций
 * - Batch-обработка для больших объёмов
 * - Состояние в БД для горизонтального масштабирования
 */

const { query, describeError, withClient } = require('../db/database');
const { logger } = require('./serverApi');
const { checkAchievements } = require('./game-helpers');

// Список задач планировщика
const SCHEDULER_TASKS = [
    'energy',
    'dailyActivity',
    'achievements',
    'cleanup',
    'dailyTasks',
    'debuffs',
    'raids'
];

// Флаг для graceful shutdown (в памяти — перезапуск процесса сбрасывает)
let schedulerEnabled = true;

/**
 * Получить состояние задачи из БД
 */
async function getTaskState(taskName) {
    try {
        return await withClient(async (client) => {
            const result = await client.query(
                'SELECT * FROM scheduler_state WHERE task_name = $1',
                [taskName]
            );
            return result.rows[0] || { 
                task_name: taskName, 
                is_running: false, 
                retry_count: 0, 
                offset_value: 0,
                metadata: {}
            };
        });
    } catch (err) {
        // Если таблицы нет (старая версия БД), падаем на in-memory
        logger.warn('[scheduler] scheduler_state table not found, using memory fallback', { error: describeError(err) });
        return { task_name: taskName, is_running: false, retry_count: 0, offset_value: 0, metadata: {} };
    }
}

/**
 * Обновить состояние задачи в БД
 */
async function setTaskState(taskName, updates) {
    try {
        await withClient(async (client) => {
            const fields = [];
            const values = [taskName];
            let idx = 2;

            for (const [key, value] of Object.entries(updates)) {
                fields.push(`${key} = $${idx++}`);
                values.push(value);
            }
            fields.push('updated_at = NOW()');

            await client.query(`
                INSERT INTO scheduler_state (task_name, ${Object.keys(updates).join(', ')}, updated_at)
                VALUES ($1, ${Object.keys(updates).map((_, i) => `$${i + 2}`).join(', ')}, NOW())
                ON CONFLICT (task_name) DO UPDATE SET ${fields.join(', ')}
            `, values);
        });
    } catch (err) {
        logger.error('[scheduler] failed to update task state', { task: taskName, error: describeError(err) });
    }
}

/**
 * Проверить и установить флаг выполнения (atomic check-and-set)
 * Возвращает true, если задача НЕ выполнялась и флаг установлен
 */
async function tryAcquireTaskLock(taskName) {
    try {
        return await withClient(async (client) => {
            const result = await client.query(`
                UPDATE scheduler_state 
                SET is_running = true, last_run_at = NOW(), updated_at = NOW()
                WHERE task_name = $1 AND is_running = false
                RETURNING task_name
            `, [taskName]);
            return result.rows.length > 0;
        });
    } catch (err) {
        // Fallback на in-memory если таблицы нет
        return null; // null = неизвестно, пробуем in-memory
    }
}

/**
 * Освободить флаг выполнения
 */
async function releaseTaskLock(taskName) {
    try {
        await withClient(async (client) => {
            await client.query(`
                UPDATE scheduler_state 
                SET is_running = false, updated_at = NOW()
                WHERE task_name = $1
            `, [taskName]);
        });
    } catch (err) {
        logger.error('[scheduler] failed to release task lock', { task: taskName, error: describeError(err) });
    }
}

/**
 * Безопасный перезапуск задачи.
 *
 * setTimeout(fn) не возвращает промис, поэтому .catch к нему не прицепить.
 * У всех семи задач внутри есть try/catch/finally, который гасит ошибку
 * и логирует (например, regenerateEnergy → energy_regen_error), поэтому
 * их промис всегда resolve и сам по себе unhandledRejection не создаёт.
 *
 * Остаётся один путь: throw ВНУТРИ catch-блока задачи — прежде всего
 * logger.error, если лог недоступен. Такой throw выходит из задачи наружу
 * и становится unhandledRejection. Глобальный обработчик в index.js только
 * пишет в лог, то есть задача молча перестала бы выполняться навсегда,
 * без перезапуска.
 *
 * Эта обёртка ловит и то, и другое, и всегда планирует следующий запуск.
 *
 * @param {string} name имя задачи для логов
 * @param {Function} task сама задача
 * @param {number} delayMs задержка до следующего запуска
 */
function schedule(name, task, delayMs) {
    if (!schedulerEnabled) return;
    setTimeout(() => {
        try {
            const result = task();
            if (result && typeof result.catch === 'function') {
                result.catch((err) => {
                    logger.error({ type: 'scheduler_task_rejected', task: name, message: describeError(err) });
                });
            }
        } catch (err) {
            logger.error({ type: 'scheduler_task_failed', task: name, message: describeError(err) });
        }
    }, delayMs);
}

// In-memory fallback для состояния (если scheduler_state недоступна)
const memoryState = {
    isRunning: {},
    debuffRetryCount: 0,
    achievementsOffset: 0
};

// Инициализация in-memory флагов
for (const task of SCHEDULER_TASKS) {
    memoryState.isRunning[task] = false;
}

// Метрики выполнения (остаются в памяти — только для мониторинга)
const metrics = {
    energy: { total: 0, lastDuration: 0, lastSuccessAt: null },
    dailyActivity: { total: 0, lastDuration: 0, lastSuccessAt: null },
    achievements: { total: 0, lastDuration: 0, playersProcessed: 0, errors: 0, lastSuccessAt: null },
    cleanup: { total: 0, lastDuration: 0, lastSuccessAt: null },
    dailyTasks: { total: 0, lastDuration: 0, lastSuccessAt: null }
};

/**
 * Получить метрики планировщика
 */
function getSchedulerMetrics() {
    return { ...metrics };
}

/**
 * Проверить, выполняется ли задача (БД или память)
 * НЕ захватывает лок, только читает состояние
 */
async function isTaskRunning(taskName) {
    try {
        const state = await getTaskState(taskName);
        return state.is_running === true;
    } catch {
        // Fallback на память
        return memoryState.isRunning[taskName] || false;
    }
}

/**
 * Установить флаг выполнения (БД или память)
 * Захватывает лок если running=true, освобождает если running=false
 */
async function setTaskRunning(taskName, running) {
    if (running) {
        const acquired = await tryAcquireTaskLock(taskName);
        if (acquired === null || acquired === false) {
            memoryState.isRunning[taskName] = true;
        }
    } else {
        await releaseTaskLock(taskName);
        memoryState.isRunning[taskName] = false;
    }
}

/**
 * Получить значение offset (БД или память)
 */
async function getOffset(taskName) {
    try {
        const state = await getTaskState(taskName);
        return state.offset_value || 0;
    } catch {
        return memoryState.achievementsOffset || 0;
    }
}

/**
 * Установить значение offset (БД или память)
 */
async function setOffset(taskName, value) {
    try {
        await setTaskState(taskName, { offset_value: value });
    } catch {
        memoryState.achievementsOffset = value;
    }
}

/**
 * Получить retry count (БД или память)
 */
async function getRetryCount(taskName) {
    try {
        const state = await getTaskState(taskName);
        return state.retry_count || 0;
    } catch {
        return memoryState.debuffRetryCount || 0;
    }
}

/**
 * Установить retry count (БД или память)
 */
async function setRetryCount(taskName, value) {
    try {
        await setTaskState(taskName, { retry_count: value });
    } catch {
        memoryState.debuffRetryCount = value;
    }
}

/**
 * Восстановление энергии игрокам
 * Запускается каждую минуту (после завершения предыдущей)
 */
async function regenerateEnergy() {
    if (await isTaskRunning('energy')) {
        logger.warn('energy: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    await setTaskRunning('energy', true);
    const startTime = Date.now();
    
    try {
        // Реген накопительный: игрок мог не заходить 10 минут и должен
        // получить все 10 единиц, а не одну.
        //
        // Регрессия: стояло energy + 1 и last_energy_update = NOW(). Метка
        // сдвигалась на «сейчас», хотя начислена всего минута, поэтому
        // недобранное время терялось безвозвратно. Плюс это конфликтовало
        // с recalcEnergy() из utils/game-helpers.js, который считает реген
        // от last_energy_update и двигает метку на last + regen*60000 —
        // два разных правила для одного поля давали двойной счёт.
        //
        // Теперь правило одно (здесь и в recalcEnergy): прибавляем
        // floor((NOW() - last_energy_update) / 1 минута) и двигаем метку
        // ровно на восстановленное время, а не в NOW().
        const result = await query(`
            UPDATE players
            SET energy = LEAST(
                    max_energy,
                    energy + FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_energy_update, NOW() - INTERVAL '1 minute'))) / 60)::int
                ),
                last_energy_update = COALESCE(last_energy_update, NOW())
                    + (FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_energy_update, NOW() - INTERVAL '1 minute'))) / 60)::int
                       * INTERVAL '1 minute')
            WHERE energy < max_energy
              AND COALESCE(last_energy_update, NOW() - INTERVAL '1 minute') < NOW() - INTERVAL '1 minute'
            RETURNING id, energy, max_energy
        `);
        
        const duration = Date.now() - startTime;
        metrics.energy.total++;
        metrics.energy.lastDuration = duration;
        metrics.energy.lastSuccessAt = new Date().toISOString();
        
        if (result.rows.length > 0) {
            logger.info({ 
                type: 'energy_regen', 
                players_updated: result.rows.length,
                duration_ms: duration
            });
        }
    } catch (err) {
        logger.error({ type: 'energy_regen_error', message: describeError(err) });
    } finally {
        await setTaskRunning('energy', false);
        
        // Запускаем следующую итерацию через 1 минуту (если планировщик не остановлен)
        if (schedulerEnabled) {
            schedule('regenerateEnergy', regenerateEnergy, 60 * 1000);
        }
    }
}

/**
 * Проверка ежедневной активности
 * Запускается каждый час
 */
async function checkDailyActivity() {
    if (await isTaskRunning('dailyActivity')) {
        logger.warn('dailyActivity: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    await setTaskRunning('dailyActivity', true);
    const startTime = Date.now();

    try {
        // Серия дней (daily_streak) больше НЕ растёт здесь.
        //
        // Раньше стояло:
        //   UPDATE players SET daily_streak = LEAST(365, daily_streak + 1)
        //    WHERE last_action_time > NOW() - INTERVAL '20 hours'
        //      AND last_action_time < NOW() - INTERVAL '4 hours'
        // Задача ходит каждый час, поэтому игрок, не заходивший 4–20 часов,
        // получал +1 серии ЕЖЕДОЧАСНО — до +16 в сутки и потолок 365 за сутки.
        // Теперь серию ведёт единственный источник: игрок сам забирает ежедневный
        // бонус (POST /player/daily-bonus), где серия растёт один раз в сутки и
        // обнуляется при пропуске больше 48 часов.
        //
        // Здесь остаётся только сброс серий у игроков, которые давно не заходили и
        // никогда не заберут бонус.
        const resetResult = await query(`
            UPDATE players
            SET daily_streak = 0
            WHERE last_action_time < NOW() - INTERVAL '2 days'
            AND COALESCE(daily_streak, 0) > 0
            RETURNING id
        `);

        if (resetResult.rows.length > 0) {
            logger.info({
                type: 'streak_reset',
                players_affected: resetResult.rows.length
            });
        }
        
        const duration = Date.now() - startTime;
        metrics.dailyActivity.total++;
        metrics.dailyActivity.lastDuration = duration;
        metrics.dailyActivity.lastSuccessAt = new Date().toISOString();
        
        logger.info({ type: 'daily_activity', duration_ms: duration });
    } catch (err) {
        logger.error({ type: 'daily_activity_error', message: describeError(err) });
    } finally {
        await setTaskRunning('dailyActivity', false);
        
        // Запускаем следующую итерацию через 1 час (если планировщик не остановлен)
        if (schedulerEnabled) {
            schedule('checkDailyActivity', checkDailyActivity, 60 * 60 * 1000);
        }
    }
}

/**
 * Очистка старых логов
 * Запускается каждые 6 часов
 */
async function cleanupOldLogs() {
    if (await isTaskRunning('cleanup')) {
        logger.warn('cleanup: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    await setTaskRunning('cleanup', true);
    const startTime = Date.now();
    
    try {
        // Удаляем логи старше 30 дней
        const logsResult = await query(`
            DELETE FROM player_logs 
            WHERE created_at < NOW() - INTERVAL '30 days'
            RETURNING id
        `);
        
        if (logsResult.rows.length > 0) {
            logger.info({ 
                type: 'logs_cleanup', 
                logs_deleted: logsResult.rows.length 
            });
        }
        
        // Удаляем старые сессии
        const sessionsResult = await query(`
            DELETE FROM player_sessions
            WHERE expires_at < NOW()
            RETURNING id
        `);

        if (sessionsResult.rows.length > 0) {
            logger.info({
                type: 'sessions_cleanup',
                sessions_deleted: sessionsResult.rows.length
            });
        }

        // Удаляем сообщения клан-чата старше 30 дней.
        // Без ретеншена clan_chat рос forever: чат — самая активная таблица
        // на действия игроков, а лимитер (10 сообщений / 30 с) лишь снижает
        // скорость роста, но не ограничивает историю.
        try {
            const chatResult = await query(`
                DELETE FROM clan_chat
                WHERE created_at < NOW() - INTERVAL '30 days'
                RETURNING id
            `);

            if (chatResult.rows.length > 0) {
                logger.info({
                    type: 'clan_chat_cleanup',
                    messages_deleted: chatResult.rows.length
                });
            }
        } catch (chatErr) {
            // Таблицы может не быть в устаревшей схеме — не роняем всю очистку.
            logger.warn('clan_chat cleanup пропущен: ' + describeError(chatErr));
        }
        
        const duration = Date.now() - startTime;
        metrics.cleanup.total++;
        metrics.cleanup.lastDuration = duration;
        metrics.cleanup.lastSuccessAt = new Date().toISOString();
        
        logger.info({ type: 'cleanup', duration_ms: duration });
    } catch (err) {
        logger.error({ type: 'cleanup_error', message: describeError(err) });
    } finally {
        await setTaskRunning('cleanup', false);
        
        // Запускаем следующую итерацию через 6 часов (если планировщик не остановлен)
        if (schedulerEnabled) {
            schedule('cleanupOldLogs', cleanupOldLogs, 6 * 60 * 60 * 1000);
        }
    }
}

/**
 * Batch-обработка достижений
 * Обрабатывает игроков пачками с параллельной обработкой
 */
const BATCH_SIZE = 50;
const CONCURRENCY = 10; // Одновременно обрабатываем 10 игроков

/**
 * Обработать одного игрока (с обработкой ошибок)
 */
async function processPlayerAchievements(player) {    
    try {
        await checkAchievements(player.id);
        return { success: true, playerId: player.id };
    } catch (err) {
        logger.error({ type: 'achievement_error', playerId: player.id, message: describeError(err) });
        return { success: false, playerId: player.id, error: describeError(err) };
    }
}

/**
 * Параллельная обработка батча игроков
 */
async function processBatchParallel(players) {
    const results = [];
    
    // Обрабатываем игроков параллельно с ограничением concurrency
    for (let i = 0; i < players.length; i += CONCURRENCY) {
        const chunk = players.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.allSettled(
            chunk.map(player => processPlayerAchievements(player))
        );
        results.push(...chunkResults.map(r => r.value || { success: false }));
    }
    
    return results;
}

async function checkAllAchievements() {
    if (await isTaskRunning('achievements')) {
        logger.warn('achievements: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    await setTaskRunning('achievements', true);
    const startTime = Date.now();
    let totalProcessed = 0;
    let totalErrors = 0;
    let offset = await getOffset('achievements');
    
    try {
        for (;;) {
            // Batch-выборка игроков
            const players = await query(`
                SELECT id, level, bosses_killed, pvp_wins, items_collected,
                       daily_streak
                FROM players 
                WHERE last_action_time > NOW() - INTERVAL '24 hours'
                ORDER BY id
                LIMIT $1 OFFSET $2
            `, [BATCH_SIZE, offset]);
            
            if (players.rows.length === 0) {
                break; // Все игроки обработаны
            }
            
            // Параллельная обработка батча (без транзакции - долгая операция)
            const results = await processBatchParallel(players.rows);
            
            totalProcessed += results.filter(r => r.success).length;
            totalErrors += results.filter(r => !r.success).length;
            
            // Сохраняем offset ТОЛЬКО после успешной обработки батча
            offset += BATCH_SIZE;
            await setOffset('achievements', offset);
            
            // Пауза между батчами
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Сбрасываем offset после завершения
        await setOffset('achievements', 0);
        
        const duration = Date.now() - startTime;
        metrics.achievements.total++;
        metrics.achievements.lastDuration = duration;
        metrics.achievements.playersProcessed = totalProcessed;
        metrics.achievements.errors = totalErrors;
        metrics.achievements.lastSuccessAt = new Date().toISOString();
        
        logger.info({ 
            type: 'achievements_check', 
            players_checked: totalProcessed,
            errors: totalErrors,
            duration_ms: duration
        });
    } catch (err) {
        logger.error({ type: 'achievements_check_error', message: describeError(err) });
    } finally {
        await setTaskRunning('achievements', false);
        
        // Запускаем следующую итерацию через 1 час (если планировщик не остановлен)
        if (schedulerEnabled) {
            schedule('checkAllAchievements', checkAllAchievements, 60 * 60 * 1000);
        }
    }
}

/**
 * Очистка истёкших дебаффов
 * Запускается каждые 5 минут
 */
async function cleanupExpiredDebuffs() {
    if (await isTaskRunning('debuffs')) {
        logger.warn('debuffs: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    await setTaskRunning('debuffs', true);
    const startTime = Date.now();
    let success = false;
    
    try {
        // Батчевый отбор: сначала выбираем до 100 игроков с истёкшими
        // дебаффами, затем обновляем только их.
        //
        // Раньше UPDATE шёл по всей таблице players без LIMIT (при том,
        // что комментарий выше утверждал об обратном). Таблица растёт
        // вместе с числом игроков, и каждые 5 минут сервер брал блокировки
        // на ВСЕ строки — запрос конфликтовал с любым действием игрока.
        // Теперь работа не зависит от размера таблицы, а неубранные
        // игроки подхватываются следующим тиком.
        const expiredRadiation = await query(`
            WITH expired AS (
                SELECT id
                FROM players
                WHERE radiation->>'expires_at' IS NOT NULL
                  AND (radiation->>'expires_at')::timestamp < NOW()
                LIMIT 100
            )
            UPDATE players p
            SET radiation = jsonb_set(
                COALESCE(p.radiation, '{}'::jsonb),
                '{level}',
                '0'::jsonb
            )
            FROM expired
            WHERE p.id = expired.id
        `);

        // Инфекции: оставляем только те, у которых срок ещё не вышел.
        // jsonb_array_length на NULL даёт NULL, а условие NULL > 0 — не
        // истина, поэтому игроки без инфекций отсекаются корректно.
        const expiredInfections = await query(`
            WITH expired AS (
                SELECT id
                FROM players
                WHERE infections IS NOT NULL
                  AND jsonb_typeof(infections) = 'array'
                  AND jsonb_array_length(infections) > 0
                  AND EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(infections) elem
                      WHERE elem->>'expires_at' IS NOT NULL
                        AND (elem->>'expires_at')::timestamp <= NOW()
                  )
                LIMIT 100
            )
            UPDATE players p
            SET infections = COALESCE((
                SELECT jsonb_agg(elem)
                FROM jsonb_array_elements(p.infections) AS elem
                WHERE (elem->>'expires_at')::timestamp > NOW()
                   OR elem->>'expires_at' IS NULL
            ), '[]'::jsonb)
            FROM expired
            WHERE p.id = expired.id
        `);

        const cleanedCount = (expiredRadiation.rowCount || 0) + (expiredInfections.rowCount || 0);
        if (cleanedCount > 0) {
            logger.info({
                type: 'debuffs_cleanup_batch',
                players_updated: cleanedCount,
                radiation: expiredRadiation.rowCount || 0,
                infections: expiredInfections.rowCount || 0
            });
        }

        success = true;
        const duration = Date.now() - startTime;
        logger.info({ 
            type: 'debuffs_cleanup', 
            duration_ms: duration
        });
    } catch (err) {
        logger.error({ type: 'debuffs_cleanup_error', message: describeError(err) });
        const retryCount = await getRetryCount('debuffs') + 1;
        await setRetryCount('debuffs', retryCount);
        
        const delay = Math.min(
            5 * 60 * 1000 * Math.pow(2, retryCount),
            30 * 60 * 1000
        );
        
        logger.warn({ 
            type: 'debuffs_cleanup_retry', 
            retryCount: retryCount,
            nextDelayMs: delay 
        });
    } finally {
        await setTaskRunning('debuffs', false);
        
        if (success) {
            await setRetryCount('debuffs', 0);
        }
        
        // Единый запуск следующей итерации
        const retryCount = await getRetryCount('debuffs');
        const nextDelay = success ? 5 * 60 * 1000 : Math.min(
            5 * 60 * 1000 * Math.pow(2, retryCount || 1),
            30 * 60 * 1000
        );
        
        if (schedulerEnabled) {
            schedule('cleanupExpiredDebuffs', cleanupExpiredDebuffs, nextDelay);
        }
    }
}

/**
 * Очистка истёкших рейдов боссов
 * Запускается каждые 5 минут
 * 
 * Если рейд истёк (expires_at < NOW()) и не был убит:
 * - Помечается как неактивный
 * - Участники НЕ получают награды (рейд проигран)
 */
async function cleanupExpiredRaids() {
    if (await isTaskRunning('raids')) {
        logger.warn('raids: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    await setTaskRunning('raids', true);
    const startTime = Date.now();
    
    try {
        // Находим истёкшие активные рейды
        const expiredRaids = await query(`
            SELECT id, boss_id, leader_id 
            FROM raid_progress 
            WHERE is_active = true 
                AND expires_at < NOW()
        `);
        
        if (expiredRaids.rows.length > 0) {
            logger.info({
                type: 'expired_raids',
                count: expiredRaids.rows.length
            });
            
            // Помечаем рейды как неактивные
            for (const raid of expiredRaids.rows) {
                const participantsResult = await query(
                    'SELECT player_id FROM boss_sessions WHERE raid_id = $1',
                    [raid.id]
                );
                const participantIds = participantsResult.rows.map(row => row.player_id);

                await query(`
                    UPDATE raid_progress 
                    SET is_active = false, ended_at = NOW()
                    WHERE id = $1
                `, [raid.id]);

                if (participantIds.length > 0) {
                    // Условие active_raid_id = $1 обязательно.
                    //
                    // Истёкший рейд мог быть обнаружен ПОЗЖЕ, чем игрок успел
                    // начать новый бой (например, рейд истёк в 12:00, игрок в
                    // 12:03 начал соло-бой, а эта задача отработала в 12:05).
                    // Без фильтра UPDATE обнулял active_boss_id у игрока,
                    // который уже сражался с ДРУГИМ боссом: незавершённый
                    // бой и его прогресс (player_boss_progress) исчезали,
                    // а бой возобновить было уже нельзя — блокировка
                    // проверяется по active_boss_id.
                    await query(
                        `UPDATE players
                         SET active_boss_id = NULL,
                             active_boss_started_at = NULL,
                             active_boss_mode = NULL,
                             active_raid_id = NULL
                         WHERE id = ANY($1::bigint[])
                           AND active_raid_id = $2`,
                        [participantIds, raid.id]
                    );
                }
                
                await query('DELETE FROM boss_sessions WHERE raid_id = $1', [raid.id]);
                  
                // Логируем истёкший рейд
                logger.info({
                    type: 'raid_expired',
                    raidId: raid.id,
                    bossId: raid.boss_id,
                    leaderId: raid.leader_id
                });
            }
        }
        
        const duration = Date.now() - startTime;
        
        logger.info({
            type: 'cleanup_expired_raids',
            raids_processed: expiredRaids.rows.length,
            duration_ms: duration
        });
        
        return;
    } catch (err) {
        logger.error({ type: 'raids_cleanup_error', message: describeError(err) });
    } finally {
        await setTaskRunning('raids', false);
        
        // Запускаем следующую итерацию через 5 минут
        if (schedulerEnabled) {
            schedule('cleanupExpiredRaids', cleanupExpiredRaids, 5 * 60 * 1000);
        }
    }
}

/**
 * Сброс ежедневных заданий
 * Запускается каждые 6 часов
 */
async function resetDailyTasks() {
    if (await isTaskRunning('dailyTasks')) {
        logger.warn('dailyTasks: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    await setTaskRunning('dailyTasks', true);
    const startTime = Date.now();
    
    try {
        const result = await query(`
            UPDATE players 
            SET daily_tasks_completed = 0,
                daily_tasks_reset_at = NOW()
            WHERE daily_tasks_reset_at < NOW() - INTERVAL '24 hours'
            OR daily_tasks_reset_at IS NULL
            RETURNING id
        `);
        
        if (result.rows.length > 0) {
            logger.info({ 
                type: 'daily_tasks_reset', 
                players_affected: result.rows.length 
            });
        }

        // Удаление просроченных заданий.
        //
        // Строки в daily_tasks создаются на каждый день (GET /daily-tasks
        // делает INSERT ... ON CONFLICT DO NOTHING с expires_at = полночь
        // следующего дня) и удаляются только при получении награды. Если
        // игрок не забрал награду, строка оставалась навсегда: за год
        // активной игры это 3 × 365 = ~1000 строк на игрока, а при
        // нескольких тысячах игроков таблица росла без очистки, хотя
        // индекс idx_daily_tasks_expires для этих строк уже не работал.
        //
        // Сутки запаса: задание с expires_at, равным текущему полуночи,
        // могло быть ещё нужно игроку — удаляем только то, что прошло.
        const deletedResult = await query(`
            DELETE FROM daily_tasks
            WHERE expires_at < NOW() - INTERVAL '1 day'
            RETURNING id
        `);

        if (deletedResult.rows.length > 0) {
            logger.info({
                type: 'daily_tasks_cleanup',
                tasks_deleted: deletedResult.rows.length
            });
        }
        
        const duration = Date.now() - startTime;
        metrics.dailyTasks.total++;
        metrics.dailyTasks.lastDuration = duration;
        metrics.dailyTasks.lastSuccessAt = new Date().toISOString();
        
        logger.info({ type: 'daily_tasks_reset', duration_ms: duration });
    } catch (err) {
        logger.error({ type: 'daily_tasks_reset_error', message: describeError(err) });
    } finally {
        await setTaskRunning('dailyTasks', false);
        
        // Запускаем следующую итерацию через 6 часов (если планировщик не остановлен)
        if (schedulerEnabled) {
            schedule('resetDailyTasks', resetDailyTasks, 6 * 60 * 60 * 1000);
        }
    }
}

/**
 * Запуск планировщика
 * Запускает все задачи с задержкой для избежания пиковой нагрузки
 */
async function startScheduler() {
    // Проверяем, не запущены ли уже задачи
    const energyRunning = await isTaskRunning('energy');
    const dailyRunning = await isTaskRunning('dailyActivity');
    
    if (energyRunning || dailyRunning) {
        logger.warn('Планировщик уже запущен');
        return;
    }
    
    logger.info('Запуск планировщика задач');
    
    // Запускаем задачи с небольшой задержкой между ними
    // чтобы избежать пиковой нагрузки при старте
    
    // Энергия - сразу (самая частая)
    schedule('regenerateEnergy', regenerateEnergy, 1000);
    
    // Ежедневная активность - через 10 секунд
    schedule('checkDailyActivity', checkDailyActivity, 10 * 1000);
    
    // Достижения - через 20 секунд
    schedule('checkAllAchievements', checkAllAchievements, 20 * 1000);
    
    // Очистка логов - через 30 секунд
    schedule('cleanupOldLogs', cleanupOldLogs, 30 * 1000);
    
    // Сброс заданий - через 40 секунд
    schedule('resetDailyTasks', resetDailyTasks, 40 * 1000);
    
    // Очистка дебаффов - через 50 секунд
    schedule('cleanupExpiredDebuffs', cleanupExpiredDebuffs, 50 * 1000);
    
    // Очистка истёкших рейдов - через 60 секунд
    schedule('cleanupExpiredRaids', cleanupExpiredRaids, 60 * 1000);
    
    logger.info('Планировщик задач запущен');
}

/**
 * Остановка планировщика
 * Не останавливает текущие задачи, только предотвращает запуск новых
 */
async function stopScheduler() {
    // Сбрасываем флаги в БД
    for (const task of SCHEDULER_TASKS) {
        await releaseTaskLock(task);
    }
    
    // Сбрасываем память
    for (const task of SCHEDULER_TASKS) {
        memoryState.isRunning[task] = false;
    }
    
    schedulerEnabled = false;
    logger.info('Планировщик остановлен');
}

// Наружу уходят запуск, остановка и метрики. Задачи (regenerateEnergy,
// checkDailyActivity, cleanupExpiredRaids и др.) вызываются здесь же, по
// расписанию: раньше они экспортировались, но ни один модуль их не читал,
// и в списке экспортов прятались 8 имён, которым не место наружу.
//
// getSchedulerMetrics, наоборот, читается — его отдаёт GET /metrics
// (utils/scheduler.js -> index.js). Раньше он тоже был мёртвым: счётчики
// задач (сколько раз отработала регенерация энергии, сколько раз
// падал cleanup, сколько длилась последняя задача) накапливались в
// памяти и никуда не выводились.
module.exports = {
    startScheduler,
    stopScheduler,
    getSchedulerMetrics
};
