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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '5000', 10),
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') || 
         process.env.DB_SSL === 'true' 
         ? { rejectUnauthorized: false } 
         : false
});

pool.on('error', (err) => {
    logger.error('Неожиданная ошибка пула БД:', err);
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
    try {
        await pool.query('SELECT 1');
        logger.info('Подключение к БД установлено');
        const { initSchema } = require('./schema');
        await initSchema();
        return true;
    } catch (error) {
        logger.error('Ошибка инициализации БД:', { message: error.message, code: error.code });
        throw error;
    }
}

async function closePool() {
    try {
        await pool.end();
        logger.info('Пул соединений закрыт');
    } catch (error) {
        logger.error('Ошибка закрытия пула:', error.message);
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
    setLogger
};