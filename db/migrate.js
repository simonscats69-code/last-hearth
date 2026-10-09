/**
 * Запуск миграций БД: схемные изменения + версионированные SQL-миграции +
 * ремонтные процедуры (переименования, сворачивание дублей и т.д.).
 *
 * Выделен из db/init.js, чтобы разделить:
 * - БЫСТРЫЙ старт приложения (createTables + seedDatabase — идемпотентно, безопасно)
 * - ТЯЖЁЛЫЕ миграции (ALTER TABLE, DROP, DELETE, ремонт данных — отдельная команда)
 *
 * Использование:
 *   node db/migrate.js          # применить все неприменённые миграции
 *   node db/migrate.js --help   # справка
 *
 * Миграции идемпотентны: каждая запись в schema_migrations гарантирует,
 * что миграция выполнена ровно один раз.
 */

const fs = require('fs');
const path = require('path');
const { pool, query, transaction, describeError, isConnectionError } = require('./database');
const { logger } = require('../utils/log');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

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
 * Получить список уже применённых миграций.
 */
async function getAppliedMigrations(client) {
    const result = await client.query(
        'SELECT version FROM schema_migrations ORDER BY version'
    );
    return new Set(result.rows.map((row) => row.version));
}

/**
 * Получить список доступных файлов миграций (.sql), отсортированных по имени.
 */
function getAvailableMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        return [];
    }
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter((file) => file.endsWith('.sql'))
        .sort();
}

/**
 * Применить одну миграцию из SQL-файла.
 */
async function applyMigration(client, migrationFile, version) {
    const sql = fs.readFileSync(
        path.join(MIGRATIONS_DIR, migrationFile),
        'utf-8'
    );
    await client.query(sql);
    await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
        [version]
    );
    logger.info(`[migrate] Применена миграция: ${version}`);
}

/**
 * Запустить все неприменённые SQL-миграции в транзакции.
 */
async function runSqlMigrations() {
    const files = getAvailableMigrations();
    if (files.length === 0) {
        logger.info('[migrate] SQL-миграции не найдены, пропускаем');
        return;
    }

    const applied = await transaction(async (client) => {
        await ensureMigrationsTable(client);
        const appliedSet = await getAppliedMigrations(client);

        let count = 0;
        for (const file of files) {
            const version = file.replace('.sql', '');
            if (appliedSet.has(version)) {
                continue;
            }
            await applyMigration(client, file, version);
            count++;
        }
        return { total: files.length, applied: count };
    });

    logger.info(`[migrate] SQL-миграции: ${applied.applied} из ${applied.total} применены`);
}

/**
 * Запустить схемные миграции (идемпотентные ALTER TABLE ADD COLUMN IF NOT EXISTS и т.п.).
 * Выделены в отдельную функцию для удобства тестирования.
 */
async function runSchemaMigrations() {
    // Ленивый require: schema.js тяжёлая и нужна только при миграции
    const { runMigrations } = require('./schema');
    await runMigrations();
    logger.info('[migrate] Схемные миграции применены');
}

/**
 * Запустить ремонтные процедуры данных.
 */
async function runDataRepairs() {
    const {
        applyItemRenames,
        repairPlayerInventories,
        mergeDuplicateInventoryStacks
    } = require('./schema');

    // Переименования — сразу после схемы: новые предметы уже созданы,
    // старые строки каталога ещё есть, предметы игроков на них ссылаются.
    await applyItemRenames();
    logger.info('[migrate] Переименования предметов применены');

    // Ремонт идёт до слияния стеков: он чинит состав инвентаря
    // (фантомные id, ключи в boss_keys), а уже потом стеки сворачиваются.
    await repairPlayerInventories();
    logger.info('[migrate] Ремонт игроков завершён');

    await mergeDuplicateInventoryStacks();
    logger.info('[migrate] Сворачивание дублей инвентаря завершено');
}

/**
 * Полный цикл миграций.
 */
async function runAllMigrations() {
    // Проверка доступности БД
    await pool.query('SELECT 1');

    // 1. Схемные миграции (идемпотентные ALTER TABLE)
    await runSchemaMigrations();

    // 2. Версионированные SQL-миграции (DROP TABLE, DELETE, и т.п.)
    await runSqlMigrations();

    // 3. Ремонтные процедуры данных (переименования, сворачивание дублей)
    await runDataRepairs();
}

// Точка входа: если запущен напрямую (не через require)
if (require.main === module) {
    runAllMigrations()
        .then(() => {
            logger.info('[migrate] Все миграции успешно применены');
            process.exit(0);
        })
        .catch((error) => {
            logger.error(`[migrate] Ошибка миграции: ${describeError(error)}`);
            if (isConnectionError(error)) {
                logger.error('[migrate] Ошибка подключения к БД. Проверьте настройки.');
            }
            process.exit(1);
        });
}

module.exports = {
    runAllMigrations,
    runSchemaMigrations,
    runSqlMigrations,
    runDataRepairs,
    ensureMigrationsTable,
    getAppliedMigrations,
    getAvailableMigrations
};
