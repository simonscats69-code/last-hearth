/**
 * Инициализация базы данных: проверка соединения + DDL + сиды.
 *
 * Модуль выделен из db/database.js, чтобы разорвать циклическую зависимость:
 *
 *     db/database.js  ->  db/schema.js  ->  db/database.js
 *
 * Теперь связь односторонняя:
 *   database.js  <-  schema.js  (schema знает про подключение)
 *   db/init.js   ->  оба        (единственный, кто знает про оба)
 *   db/migrate.js ->  schema + database  (тяжёлые миграции + ремонт данных)
 *
 * index.js вызывает initDatabase() отсюда (только createTables + seedDatabase).
 * Тяжёлые миграции (runMigrations, DROP TABLE, DELETE, ремонт данных) вызываются
 * отдельной командой: node db/migrate.js
 */

const { pool, describeDbTarget, describeError } = require('./database');
const { logger } = require('../utils/log');

// Схему тоже грузим лениво: она тяжёлая (все CREATE TABLE) и нужна только
// при инициализации. Цикла при этом нет — schema.js не ссылается на init.js.
let schemaModule = null;
function getSchema() {
    if (!schemaModule) {
        schemaModule = require('./schema');
    }
    return schemaModule;
}

/**
 * Быстрая инициализация БД при старте приложения.
 *
 * Выполняет только идемпотентные операции:
 * - createTables (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS)
 * - seedDatabase (UPSERT базовых данных)
 * - seedAchievements (UPSERT достижений)
 *
 * Тяжёлые миграции (ALTER TABLE, DROP TABLE, DELETE, ремонт данных) вынесены
 * в db/migrate.js и вызываются отдельно через `node db/migrate.js`.
 * Это исключает уничтожение данных при каждом перезапуске приложения.
 */
async function initDatabase() {
    const target = describeDbTarget();

    if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
        logger.warn(`DATABASE_URL и DB_HOST не заданы — подключаемся к ${target}. ` +
            'В Docker/контейнере это почти наверняка ошибка: задайте DATABASE_URL в окружении (панель Bothost).');
    }

    logger.info('Подключение к БД: ' + target);

    try {
        await pool.query('SELECT 1');
        logger.info('Подключение к БД установлено');

        const {
            createTables,
            seedDatabase,
            seedAchievements
        } = getSchema();

        await createTables();
        await seedDatabase();
        await seedAchievements();

        return true;
    } catch (error) {
        logger.error(`Ошибка инициализации БД (${target}): ${describeError(error)}`);
        throw error;
    }
}

module.exports = {
    initDatabase
};
