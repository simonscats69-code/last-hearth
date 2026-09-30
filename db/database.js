/**
 * Модуль подключения к PostgreSQL
 */

const { Pool } = require('pg');

let logger = {
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args)
};

function setLogger(log) {
    logger = log;
}

/**
 * Конфигурация подключения.
 * Приоритет: DATABASE_URL, иначе DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD,
 * иначе стандартный fallback pg (localhost:5432) — в контейнере это почти
 * всегда ошибка: Postgres внутри контейнера нет.
 */
function buildPoolConfig() {
    const base = {
        max: parseInt(process.env.DB_POOL_MAX || '20', 10),
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '5000', 10)
    };

    if (process.env.DATABASE_URL) {
        const sslRequired = process.env.DATABASE_URL.includes('sslmode=require') ||
            process.env.DB_SSL === 'true';
        return {
            ...base,
            connectionString: process.env.DATABASE_URL,
            ssl: sslRequired ? { rejectUnauthorized: false } : false
        };
    }

    if (process.env.DB_HOST) {
        const sslRequired = process.env.DB_HOST.includes('supabase') ||
            process.env.DB_SSL === 'true';
        return {
            ...base,
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '5432', 10),
            database: process.env.DB_NAME || 'postgres',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'postgres',
            ssl: sslRequired ? { rejectUnauthorized: false } : false
        };
    }

    // Ни DATABASE_URL, ни DB_HOST не заданы -> pg уйдёт на localhost:5432
    return base;
}

const pool = new Pool(buildPoolConfig());

/**
 * Описание ошибки для логов.
 * pg бросает AggregateError (несколько адресов подключения) с ПУСТЫМ
 * .message — без этого хелпера все ошибки БД в логах выглядят как
 * пустые строки ("message": "").
 */
function describeError(err) {
    if (err === null || err === undefined) return 'unknown error';
    if (typeof err === 'string') return err;

    const parts = [];
    if (err.code) parts.push(String(err.code));
    const message = String(err.message || '').trim();
    if (message) parts.push(message);

    if (Array.isArray(err.errors) && err.errors.length > 0) {
        const inner = err.errors
            .map(e => (e && e.message) ? e.message : String(e))
            .filter(Boolean)
            .join(' | ');
        if (inner) parts.push(`причины: [${inner}]`);
    }

    if (parts.length === 0) parts.push(err.name || 'unknown error');
    return parts.join(' — ');
}

/** Описание цели подключения для логов (без пароля) */
function describeDbTarget() {
    if (process.env.DATABASE_URL) {
        try {
            const url = new URL(process.env.DATABASE_URL);
            const db = (url.pathname || '/').replace(/^\//, '') || 'postgres';
            return `${url.hostname}:${url.port || 5432}/${db}`;
        } catch {
            return 'DATABASE_URL (некорректный формат)';
        }
    }
    if (process.env.DB_HOST) {
        return `${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'postgres'}`;
    }
    return 'localhost:5432/postgres (DATABASE_URL и DB_HOST не заданы!)';
}

pool.on('error', (err) => {
    logger.error('Неожиданная ошибка пула БД: ' + describeError(err));
});

async function query(sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result;
    } finally {
        client.release();
    }
}

async function queryOne(sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows[0] || null;
    } finally {
        client.release();
    }
}

async function queryAll(sql, params = []) {
    const client = await pool.connect();
    try {
        const result = await client.query(sql, params);
        return result.rows || [];
    } finally {
        client.release();
    }
}

async function transaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
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
        const { createTables, runMigrations, seedDatabase, seedAchievements } = require('./schema');
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

async function closePool() {
    try {
        await pool.end();
        logger.info('Пул соединений закрыт');
    } catch (error) {
        logger.error('Ошибка закрытия пула: ' + describeError(error));
    }
}

module.exports = {
    pool,
    query,
    queryOne,
    queryAll,
    transaction,
    initDatabase,
    closePool,
    setLogger,
    describeError,
    describeDbTarget
};