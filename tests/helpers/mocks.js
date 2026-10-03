/**
 * Общие фейковые модули для тестов.
 *
 * Проблема: utils/game-helpers.js и db/pvp.js require-ят db/database,
 * который при загрузке создаёт pg.Pool, а также utils/serverApi, который
 * держит setInterval (очистка rate-limit). В тестах это вечно живой
 * процесс. Здесь — минимальные заглушки ровно на те экспорты, которые
 * реально нужны тестируемым функциям.
 */

/** Заглушка db/database: query/queryOne/transaction никогда не ходят в БД */
function databaseMock() {
    const notCalled = (name) => () => {
        throw new Error(`db/database.${name}() не должен вызываться в этом тесте`);
    };
    return {
        query: notCalled('query'),
        queryOne: notCalled('queryOne'),
        queryAll: notCalled('queryAll'),
        transaction: notCalled('transaction'),
        pool: { connect: notCalled('pool.connect'), query: notCalled('pool.query') },
        closePool: () => {},
        setLogger: () => {},
        describeError: (e) => String(e && e.message || e),
        describeDbTarget: () => 'test'
    };
}

/** Заглушка utils/serverApi: только логгер и безопасный JSON */
function serverApiMock() {
    const noop = () => {};
    const silentLogger = { info: noop, warn: noop, error: noop, debug: noop };
    return {
        logger: silentLogger,
        safeJsonParse: (value, fallback = null) => {
            if (typeof value !== 'string') return value == null ? fallback : value;
            try { return JSON.parse(value); } catch { return fallback; }
        },
        logPlayerAction: async () => {},
        handleError: noop,
        logPlayerError: noop,
        safeStringify: (v) => JSON.stringify(v == null ? null : v)
    };
}

module.exports = { databaseMock, serverApiMock };
