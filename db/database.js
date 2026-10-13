/**
 * Похоже ли это на ошибку ПОДКЛЮЧЕНИЯ к БД, а не на сбой запроса.
 *
 * Нужна, чтобы отличать «база недоступна» от «запрос упал». Раньше это
 * различалось вручную: несколько маршрутов брали соединение отдельным
 * try и отдавали 502 «Ошибка подключения к базе данных». После перевода
 * маршрутов на transaction() такого try не осталось, и недоступность
 * базы стала выглядеть как обычная внутренняя ошибка 500 — по логам
 * нельзя было понять, что дело не в коде.
 *
 * Коды покрывают и сетевые ошибки Node, и SQLSTATE от pg.
 *
 * @param {*} err ошибка
 * @returns {boolean} true, если это похоже на проблему с соединением
 */
function isConnectionError(err) {
    if (!err || typeof err.code !== 'string') return false;
    return [
        // Сетевые ошибки Node
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'ENOTFOUND',
        'EPIPE',
        // SQLSTATE: класс 08 — connection exception
        '08000', '08001', '08003', '08004', '08006', '08007',
        '08P01'
    ].includes(err.code);
}

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
 * pg >= 8.16 (pg-connection-string): sslmode из строки подключения ПЕРЕОПРЕДЕЛЯЕТ
 * ssl из конфига (Object.assign в pg/lib/connection-parameters.js), причём
 * require/verify-ca трактуются как verify-full — строгая проверка сертификата.
 * Сертификат Supabase (пулер) её не проходит: SELF_SIGNED_CERT_IN_CHAIN.
 * Поэтому sslmode вырезаем из строки, а SSL настраиваем сами:
 * disable -> без TLS, любой другой sslmode -> TLS с rejectUnauthorized:false.
 */
function splitSslmode(rawUrl) {
    const match = rawUrl.match(/[?&]sslmode=([^&]*)/);
    if (!match) return { url: rawUrl, sslmode: null };
    const url = rawUrl
        .replace(/([?&])sslmode=[^&]*&?/g, '$1')
        .replace(/[?&]$/, '');
    return { url, sslmode: decodeURIComponent(match[1]) };
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
        const { url, sslmode } = splitSslmode(process.env.DATABASE_URL);
        // sslmode=disable -> без TLS; иначе TLS без строгой проверки цепочки
        // (сертификат Supabase её не проходит, см. комментарий splitSslmode)
        const sslEnabled = sslmode
            ? sslmode !== 'disable'
            : process.env.DB_SSL === 'true';
        return {
            ...base,
            connectionString: url,
            ssl: sslEnabled ? { rejectUnauthorized: false } : false
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

/**
 * Коды SQLSTATE, при которых транзакцию имеет смысл повторить.
 *
 * 40P01 — deadlock_detected: Postgres сам выбрал жертву и откатил её.
 * 40001 — serialization_failure: конфликт на уровне изоляции.
 *
 * Оба случая — НЕ ошибка приложения, а способ Postgres разрешить конфликт:
 * при повторной попытке транзакция обычно проходит. Без retry любой бой двух
 * игроков, замокнувших строки в разном порядке (A->B и B->A), отдавал бы 500.
 */
const RETRYABLE_PG_CODES = new Set(['40P01', '40001']);

/** Сколько раз повторять транзакцию при deadlock/serialization failure. */
const TRANSACTION_RETRY_MAX = 3;
/** Базовая задержка повтора (мс). Растёт экспоненциально: 50, 100, 200. */
const TRANSACTION_RETRY_BASE_DELAY_MS = 50;

/** Проверка, что ошибка — повторяемый конфликт транзакций. */
function isRetryableTransactionError(error) {
    return Boolean(error && RETRYABLE_PG_CODES.has(String(error.code)));
}

/** Задержка с джитфером, чтобы параллельные повторы не столкнулись снова. */
function retryDelay(attempt) {
    const base = TRANSACTION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    return base + Math.floor(Math.random() * base * 0.2);
}

async function transaction(fn) {
    let lastError = null;

    for (let attempt = 1; attempt <= TRANSACTION_RETRY_MAX; attempt++) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            // ROLLBACK тоже может упасть (соединение уже мертво) — тогда
            // исходная ошибка важнее, и именно её нужно пробросить.
            try {
                await client.query('ROLLBACK');
            } catch {
                // игнорируем: соединение всё равно уйдёт в release()
            }

            // Deadlock/serialization — повторяем с задержкой. Остальное — сразу наружу.
            if (!isRetryableTransactionError(error) || attempt === TRANSACTION_RETRY_MAX) {
                throw error;
            }

            lastError = error;
            console.warn(`[db] Транзакция откачена (${error.code}), попытка ${attempt}/${TRANSACTION_RETRY_MAX}. Повторяю.`);
            await new Promise(resolve => setTimeout(resolve, retryDelay(attempt)));
        } finally {
            client.release();
        }
    }

    // Сюда доходим только если все попытки были повторяемыми.
    throw lastError;
}

/**
 * Выполнить функцию с клиентом БД БЕЗ транзакции (BEGIN/COMMIT).
 * Полезно для чтения нескольких таблиц подряд, когда не нужна
 * атомарность записи, но удобно переиспользовать одно соединение.
 * Автоматически освобождает клиент в finally.
 */
async function withClient(fn) {
    const client = await pool.connect();
    try {
        return await fn(client);
    } finally {
        client.release();
    }
}

/**
 * initDatabase вынесен в db/init.js.
 *
 * Причина: отсюда требовался ./schema, а он импортирует query из этого же
 * файла — получался цикл db/database.js <-> db/schema.js, удерживаемый
 * ленивым require внутри initDatabase. Теперь database.js вообще не знает
 * про schema: единственный, кто связывает подключение и DDL, — db/init.js.
 */
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
    withClient,
    closePool,
    setLogger,
    describeError,
    describeDbTarget,
    isConnectionError
};