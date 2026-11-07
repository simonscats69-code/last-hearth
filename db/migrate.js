/**
 * Запуск миграций БД: схемные изменения + объединённые SQL-миграции + ремонт данных.
 *
 * Выделен из db/init.js, чтобы тяжёлые операции (ALTER/DROP/DELETE) не выполнялись
 * при каждом старте приложения.
 *
 * Использование:
 *   node db/migrate.js          # применить все неприменённые миграции
 *   node db/migrate.js --help   # справка
 *
 * SQL-миграции хранятся в одном файле db/migrations.sql (объединение бывших 11 файлов).
 * Применение идемпотентно: повторный запуск ничего не делает.
 */

const fs = require('fs');
const path = require('path');
const { pool, transaction, describeError, isConnectionError } = require('./database');
const { logger } = require('../utils/log');

const MIGRATIONS_FILE = path.join(__dirname, 'migrations.sql');
const MIGRATION_VERSION = 'migrations_sql';

/**
 * Таблица schema_migrations хранит версии применённых миграций.
 */
async function ensureMigrationsTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);
}

/**
 * Получить множество уже применённых миграций.
 */
async function getAppliedMigrations(client) {
    const result = await client.query(
        'SELECT version FROM schema_migrations ORDER BY version'
    );
    return new Set(result.rows.map((row) => row.version));
}

/**
 * Применить объединённый SQL-файл миграций (db/migrations.sql).
 * Идемпотентен: повторный запуск ничего не делает.
 */
async function runSqlMigrations() {
    if (!fs.existsSync(MIGRATIONS_FILE)) {
        logger.info('[migrate] SQL-миграции не найдены, пропускаем');
        return;
    }
    const sql = fs.readFileSync(MIGRATIONS_FILE, 'utf-8');
    if (!sql.trim()) {
        logger.info('[migrate] SQL-миграции пустые, пропускаем');
        return;
    }

    const applied = await transaction(async (client) => {
        await ensureMigrationsTable(client);
        const appliedSet = await getAppliedMigrations(client);
        if (appliedSet.has(MIGRATION_VERSION)) {
            return { total: 1, applied: 0 };
        }
        await client.query(sql);
        await client.query(
            'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
            [MIGRATION_VERSION]
        );
        return { total: 1, applied: 1 };
    });

    logger.info(`[migrate] SQL-миграции: ${applied.applied} из ${applied.total} применены`);
}

/**
 * Применить схемные миграции (идемпотентные ALTER TABLE ADD COLUMN IF NOT EXISTS и т.п.).
 * Вынесены в отдельную функцию для удобства тестирования.
 */
async function runSchemaMigrations() {
    const { createTables, runMigrations } = require('./schema');
    await createTables();
    await runMigrations();
    logger.info('[migrate] Схемные миграции применены');
}

/**
 * Применить ремонт данных (переименования предметов, починка инвентарей и т.д.).
 */
async function runDataRepairs() {
    const {
        applyItemRenames,
        repairPlayerInventories,
        mergeDuplicateInventoryStacks
    } = require('./schema');

    await applyItemRenames();
    logger.info('[migrate] Переименования предметов применены');

    try {
        const lootCache = require('../utils/lootCache');
        lootCache.clearLootCache();
        logger.info('[migrate] Кэш лута сброшен после переименований');
    } catch (cacheError) {
        logger.warn('[migrate] Не удалось сбросить кэш лута: ' + cacheError.message);
    }

    await repairPlayerInventories();
    logger.info('[migrate] Починка инвентарей выполнена');

    await mergeDuplicateInventoryStacks();
    logger.info('[migrate] Слияние дублей инвентаря выполнено');
}

/**
 * Полный цикл миграций.
 */
async function runAllMigrations() {
    await pool.query({ text: 'SELECT 1', timeout: 5000 });

    await runSchemaMigrations();
    await runSqlMigrations();
    await runDataRepairs();
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Использование: node db/migrate.js [--help]');
    console.log('Применяет все неприменённые миграции БД.');
    process.exit(0);
}

if (require.main === module) {
    runAllMigrations()
        .then(async () => {
            logger.info('[migrate] Все миграции успешно применены');
            try { await pool.end(); } catch { /* ignore */ }
            process.exit(0);
        })
        .catch(async (error) => {
            logger.error(`[migrate] Ошибка миграций: ${describeError(error)}`);
            if (isConnectionError(error)) {
                logger.error('[migrate] Ошибка подключения к БД. Проверьте настройки.');
            }
            try { await pool.end(); } catch { /* ignore */ }
            process.exit(1);
        });
}

module.exports = {
    runAllMigrations,
    runSchemaMigrations,
    runSqlMigrations,
    runDataRepairs
};