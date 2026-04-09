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

const { query, transaction: tx } = require('../db/database');
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

// Счётчик повторных ошибок для debuffs cleanup
let debuffRetryCount = 0;
const MAX_DEBUFF_RETRIES = 5;

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
        // Прямой запрос без tx() - одиночный UPDATE не требует транзакции
        const result = await query(`
            UPDATE players 
            SET energy = LEAST(max_energy, energy + 1),
                last_energy_update = NOW()
            WHERE energy < max_energy 
            AND (last_energy_update IS NULL OR last_energy_update < NOW() - INTERVAL '1 minute')
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
        logger.error({ type: 'energy_regen_error', message: err.message });
    } finally {
        isRunning.energy = false;
        
        // Запускаем следующую итерацию через 1 минуту (если планировщик не остановлен)
        if (schedulerEnabled) {
            setTimeout(regenerateEnergy, 60 * 1000);
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
        // Обнуляем streak для игроков, которые не заходили более 2 дней
        const resetResult = await query(`
            UPDATE players 
            SET daily_streak = 0
            WHERE last_action_time < NOW() - INTERVAL '2 days'
            AND daily_streak > 0
            RETURNING id
        `);
        
        if (resetResult.rows.length > 0) {
            logger.info({ 
                type: 'streak_reset', 
                players_affected: resetResult.rows.length 
            });
        }
        
        // Увеличиваем streak для активных игроков (с ограничением max=365)
        await query(`
            UPDATE players 
            SET daily_streak = LEAST(365, daily_streak + 1)
            WHERE last_action_time > NOW() - INTERVAL '20 hours'
            AND last_action_time < NOW() - INTERVAL '4 hours'
        `);
        
        const duration = Date.now() - startTime;
        metrics.dailyActivity.total++;
        metrics.dailyActivity.lastDuration = duration;
        metrics.dailyActivity.lastSuccessAt = new Date().toISOString();
        
        logger.info({ type: 'daily_activity', duration_ms: duration });
    } catch (err) {
        logger.error({ type: 'daily_activity_error', message: err.message });
    } finally {
        isRunning.dailyActivity = false;
        
        // Запускаем следующую итерацию через 1 час (если планировщик не остановлен)
        if (schedulerEnabled) {
            setTimeout(checkDailyActivity, 60 * 60 * 1000);
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
        logger.error({ type: 'cleanup_error', message: err.message });
    } finally {
        isRunning.cleanup = false;
        
        // Запускаем следующую итерацию через 6 часов (если планировщик не остановлен)
        if (schedulerEnabled) {
            setTimeout(cleanupOldLogs, 6 * 60 * 60 * 1000);
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
    const stats = {
        level: player.level,
        bosses_killed: player.bosses_killed,
        pvp_wins: player.pvp_wins,
        items_collected: player.items_collected,
        daily_streak: player.daily_streak,
        referrals: player.referrals
    };
    
    try {
        await checkAchievements(player.id, stats);
        return { success: true, playerId: player.id };
    } catch (err) {
        logger.error({ type: 'achievement_error', playerId: player.id, message: err.message });
        return { success: false, playerId: player.id, error: err.message };
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
        results.push(...chunkResults.map(r => r.value));
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
        while (true) {
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
        logger.error({ type: 'achievements_check_error', message: err.message });
    } finally {
        isRunning.achievements = false;
        
        // Запускаем следующую итерацию через 1 час (если планировщик не остановлен)
        if (schedulerEnabled) {
            setTimeout(checkAllAchievements, 60 * 60 * 1000);
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
        logger.error({ type: 'debuffs_cleanup_error', message: err.message });
        debuffRetryCount++;
        
        // Экспоненциальная задержка при ошибках (до 30 минут)
        const delay = Math.min(
            5 * 60 * 1000 * Math.pow(2, debuffRetryCount),
            30 * 60 * 1000
        );
        
        logger.warn({ 
            type: 'debuffs_cleanup_retry', 
            retryCount: debuffRetryCount,
            nextDelayMs: delay 
        });
        
        if (schedulerEnabled) {
            setTimeout(cleanupExpiredDebuffs, delay);
        }
    } finally {
        isRunning.debuffs = false;
        
        // Сброс счётчика только при успехе
        if (success) {
            debuffRetryCount = 0;
            
            // Запускаем следующую итерацию через 5 минут (если планировщик не остановлен)
            if (schedulerEnabled) {
                setTimeout(cleanupExpiredDebuffs, 5 * 60 * 1000);
            }
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
    } finally {
        isRunning.raids = false;
        
        // Запускаем следующую итерацию через 5 минут
        if (schedulerEnabled) {
            setTimeout(cleanupExpiredRaids, 5 * 60 * 1000);
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
        logger.error({ type: 'daily_tasks_reset_error', message: err.message });
    } finally {
        isRunning.dailyTasks = false;
        
        // Запускаем следующую итерацию через 6 часов
        setTimeout(resetDailyTasks, 6 * 60 * 60 * 1000);
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
    setTimeout(regenerateEnergy, 1000);
    
    // Ежедневная активность - через 10 секунд
    setTimeout(checkDailyActivity, 10 * 1000);
    
    // Достижения - через 20 секунд
    setTimeout(checkAllAchievements, 20 * 1000);
    
    // Очистка логов - через 30 секунд
    setTimeout(cleanupOldLogs, 30 * 1000);
    
    // Сброс заданий - через 40 секунд
    setTimeout(resetDailyTasks, 40 * 1000);
    
    // Очистка дебаффов - через 50 секунд
    setTimeout(cleanupExpiredDebuffs, 50 * 1000);
    
    // Очистка истёкших рейдов - через 60 секунд
    setTimeout(cleanupExpiredRaids, 60 * 1000);
    
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
