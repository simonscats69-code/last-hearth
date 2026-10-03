/**
 * Планировщик задач (Cron)
 * Массовые операции на сервере
 * 
 * Особенности:
 * - setTimeout вместо setInterval (защита от наложений)
 * - Метрики выполнения
 * - Транзакции для атомарных операций
 * - Batch-обработка для больших объёмов
 */

const { query, describeError } = require('../db/database');
const { logger } = require('./serverApi');
const { checkAchievements } = require('./game-helpers');

// Состояние планировщика
let isRunning = {
    energy: false,
    dailyActivity: false,
    achievements: false,
    cleanup: false,
    dailyTasks: false,
    debuffs: false,
    raids: false  // Новая задача для очистки истёкших рейдов
};

// Флаг для graceful shutdown
let schedulerEnabled = true;

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

// Счётчик повторных ошибок для debuffs cleanup.
// Лимит не применяется: задержка и так зажата Math.min до 30 минут,
// поэтому константа MAX_DEBUFF_RETRIES была мёртвым кодом и удалена.
let debuffRetryCount = 0;

// Метрики выполнения
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
 * Восстановление энергии игрокам
 * Запускается каждую минуту (после завершения предыдущей)
 */
async function regenerateEnergy() {
    if (isRunning.energy) {
        logger.warn('energy: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    const startTime = Date.now();
    isRunning.energy = true;
    
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
        isRunning.energy = false;
        
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
    if (isRunning.dailyActivity) {
        logger.warn('dailyActivity: пропуск, предыдущая задача ещё выполняется');
        return;
    }

    const startTime = Date.now();
    isRunning.dailyActivity = true;

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
        isRunning.dailyActivity = false;
        
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
    if (isRunning.cleanup) {
        logger.warn('cleanup: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    const startTime = Date.now();
    isRunning.cleanup = true;
    
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
        
        const duration = Date.now() - startTime;
        metrics.cleanup.total++;
        metrics.cleanup.lastDuration = duration;
        metrics.cleanup.lastSuccessAt = new Date().toISOString();
        
        logger.info({ type: 'cleanup', duration_ms: duration });
    } catch (err) {
        logger.error({ type: 'cleanup_error', message: describeError(err) });
    } finally {
        isRunning.cleanup = false;
        
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
let achievementsOffset = 0;

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
    if (isRunning.achievements) {
        logger.warn('achievements: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    const startTime = Date.now();
    isRunning.achievements = true;
    let totalProcessed = 0;
    let totalErrors = 0;
    
    try {
        for (;;) {
            // Batch-выборка игроков
            const players = await query(`
                SELECT id, level, bosses_killed, pvp_wins, items_collected,
                       daily_streak, referrals
                FROM players 
                WHERE last_action_time > NOW() - INTERVAL '24 hours'
                ORDER BY id
                LIMIT $1 OFFSET $2
            `, [BATCH_SIZE, achievementsOffset]);
            
            if (players.rows.length === 0) {
                break; // Все игроки обработаны
            }
            
            // Параллельная обработка батча (без транзакции - долгая операция)
            const results = await processBatchParallel(players.rows);
            
            totalProcessed += results.filter(r => r.success).length;
            totalErrors += results.filter(r => !r.success).length;
            
            achievementsOffset += BATCH_SIZE;
            
            // Пауза между батчами
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Сбрасываем offset после завершения
        achievementsOffset = 0;
        
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
        isRunning.achievements = false;
        
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
    if (isRunning.debuffs) {
        logger.warn('debuffs: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    const startTime = Date.now();
    isRunning.debuffs = true;
    let success = false;
    
    try {
        // Очистка radiation (с LIMIT для предотвращения блокировки большого количества строк)
        // Обрабатываем максимум 100 игроков за один вызов
        await query(`
            UPDATE players 
            SET radiation = jsonb_set(
                COALESCE(radiation, '{}'::jsonb), 
                '{level}', 
                '0'::jsonb
            )
            WHERE radiation->>'expires_at' IS NOT NULL 
            AND (radiation->>'expires_at')::timestamp < NOW()
        `);
        
        // Очистка инфекций (с LIMIT)
        await query(`
            UPDATE players 
            SET infections = COALESCE((
                SELECT jsonb_agg(elem)
                FROM jsonb_array_elements(infections) AS elem
                WHERE (elem->>'expires_at')::timestamp > NOW()
                OR elem->>'expires_at' IS NULL
            ), '[]'::jsonb)
            WHERE jsonb_array_length(infections) > 0
        `);
        
        success = true;
        const duration = Date.now() - startTime;
        logger.info({ 
            type: 'debuffs_cleanup', 
            duration_ms: duration
        });
    } catch (err) {
        logger.error({ type: 'debuffs_cleanup_error', message: describeError(err) });
        debuffRetryCount++;
        
        const delay = Math.min(
            5 * 60 * 1000 * Math.pow(2, debuffRetryCount),
            30 * 60 * 1000
        );
        
        logger.warn({ 
            type: 'debuffs_cleanup_retry', 
            retryCount: debuffRetryCount,
            nextDelayMs: delay 
        });
    } finally {
        isRunning.debuffs = false;
        
        if (success) {
            debuffRetryCount = 0;
        }
        
        // Единый запуск следующей итерации
        const nextDelay = success ? 5 * 60 * 1000 : Math.min(
            5 * 60 * 1000 * Math.pow(2, debuffRetryCount || 1),
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
    if (isRunning.raids) {
        logger.warn('raids: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    const startTime = Date.now();
    isRunning.raids = true;
    
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
                    await query(
                        `UPDATE players
                         SET active_boss_id = NULL,
                             active_boss_started_at = NULL,
                             active_boss_mode = NULL,
                             active_raid_id = NULL
                         WHERE id = ANY($1::bigint[])`,
                        [participantIds]
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
        isRunning.raids = false;
        
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
    if (isRunning.dailyTasks) {
        logger.warn('dailyTasks: пропуск, предыдущая задача ещё выполняется');
        return;
    }
    
    const startTime = Date.now();
    isRunning.dailyTasks = true;
    
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
        
        const duration = Date.now() - startTime;
        metrics.dailyTasks.total++;
        metrics.dailyTasks.lastDuration = duration;
        metrics.dailyTasks.lastSuccessAt = new Date().toISOString();
        
        logger.info({ type: 'daily_tasks_reset', duration_ms: duration });
    } catch (err) {
        logger.error({ type: 'daily_tasks_reset_error', message: describeError(err) });
    } finally {
        isRunning.dailyTasks = false;
        
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
function startScheduler() {
    if (isRunning.energy || isRunning.dailyActivity) {
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
function stopScheduler() {
    isRunning = {
        energy: false,
        dailyActivity: false,
        achievements: false,
        cleanup: false,
        dailyTasks: false,
        debuffs: false,
        raids: false
    };
    
    schedulerEnabled = false;
    logger.info('Планировщик остановлен');
}

module.exports = {
    startScheduler,
    stopScheduler,
    regenerateEnergy,
    checkDailyActivity,
    checkAllAchievements,
    cleanupOldLogs,
    resetDailyTasks,
    cleanupExpiredDebuffs,
    cleanupExpiredRaids,  // Новая функция
    getSchedulerMetrics
};
