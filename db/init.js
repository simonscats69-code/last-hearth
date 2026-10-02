/**
 * Инициализация базы данных: проверка соединения + DDL + сиды.
 *
 * Модуль выделен из db/database.js, чтобы разорвать циклическую зависимость:
 *
 *     db/database.js  ->  db/schema.js  ->  db/database.js
 *
 * Раньше database.js тянул schema.js ЛЕНИВО (require внутри initDatabase),
 * а schema.js импортировал query из database.js на верхнем уровне. Цикл
 * работал, но был хрупок: новый require на верхнем уровне в любом из двух
 * файлов дал бы частично инициализированный модуль, и ошибка проявилась бы
 * не при старте сервера, а посреди игры.
 *
 * Теперь связь односторонняя:
 *   database.js  <-  schema.js  (schema знает про подключение)
 *   db/init.js   ->  оба        (единственный, кто знает про оба)
 *
 * index.js вызывает initDatabase() отсюда.
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

        const { createTables, runMigrations, seedDatabase, seedAchievements } = getSchema();

        await createTables();
        await runMigrations();
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
