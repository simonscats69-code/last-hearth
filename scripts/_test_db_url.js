/**
 * Проверка произвольной строки подключения к БД (без запуска сервера).
 * Запуск:
 *   node scripts/_test_db_url.js "postgresql://user:pass@host:5432/postgres?sslmode=require"
 * Без аргумента берётся DATABASE_URL из окружения/.env.
 * Использует реальный конфиг приложения (db/database.js), включая обработку
 * sslmode, — поведение то же, что на сервере.
 */
require('dotenv').config();

const target = process.argv[2] || process.env.DATABASE_URL;
if (!target) {
    console.error('Нет строки подключения. Использование: node scripts/_test_db_url.js "<DATABASE_URL>"');
    process.exit(2);
}

// db/database.js строит пул на этапе require — подменяем env ДО импорта,
// чтобы проверить именно переданную строку конфигом приложения.
process.env.DATABASE_URL = target;

const { pool, describeError } = require('../db/database');

function masked(url) {
    try {
        const u = new URL(url);
        if (u.password) u.password = '***';
        return u.toString();
    } catch {
        return url.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
    }
}

(async () => {
    let code = 1;
    console.log('Проверяем:', masked(target));
    try {
        const r = await pool.query('SELECT 1 AS ok, current_user AS who');
        console.log('OK: подключение успешно | user:', r.rows[0].who);
        code = 0;
    } catch (e) {
        console.error('FAIL:', describeError(e));
    } finally {
        try { await pool.end(); } catch { /* ignore */ }
    }
    process.exit(code);
})();
