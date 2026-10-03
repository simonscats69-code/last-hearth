/**
 * Резервная копия боевой БД в JSON.
 *
 * Зачем: перед применением миграций (db/schema.js runMigrations) нужен
 * откат. Миграции меняют структуру И данные: переносят предметы, чистят
 * наследие, объединяют дубли, а сид перезаписывает цены в каталоге.
 * Откатить это вручную нечем — только из дампа.
 *
 * Почему не pg_dump: на Bothost (и во многих контейнерах) бинарника нет,
 * а ставить его нельзя. Скрипт идёт через уже настроенный пул из
 * db/database.js, поэтому работает везде, где работает сама игра.
 *
 * Запуск:  npm run backup
 * Файлы:   backups/backup-YYYY-MM-DDTHH-mm-ssZ/
 *          ├─ manifest.json  — сколько строк в каждой таблице
 *          └─ <table>.json    — данные каждой таблицы
 *
 * ВНИМАНИЕ: скрипт только читает базу и пишет файлы на диск.
 */

try {
    require('dotenv').config();
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ENOENT') throw e;
}

const fs = require('fs');
const path = require('path');
const { pool, closePool } = require('../db/database');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

/** Таблицы, которые не нужно сохранять: временные и внутренние счётчики. */
const SKIP_TABLES = new Set(['schema_migrations']);

async function listTables(client) {
    const result = await client.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
          ORDER BY table_name`
    );
    return result.rows
        .map((row) => row.table_name)
        .filter((name) => !SKIP_TABLES.has(name));
}

async function main() {
    const client = await pool.connect();
    try {
        const tables = await listTables(client);
        if (tables.length === 0) {
            throw new Error('В схеме public нет ни одной таблицы — проверь подключение');
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/\.\d{3}Z$/, 'Z');
        const targetDir = path.join(BACKUP_DIR, `backup-${stamp}`);
        fs.mkdirSync(targetDir, { recursive: true });

        console.log(`[backup] Найдено таблиц: ${tables.length}`);
        console.log(`[backup] Каталог: ${targetDir}`);

        const manifest = { createdAt: new Date().toISOString(), tables: {} };

        for (const table of tables) {
            // Имя таблицы не может прийти извне: оно взято из information_schema
            // и вставляется в SQL только как есть. Но кавычки всё равно ставим,
            // чтобы имена вида "order" или с заглавными буквами не ломали запрос.
            const safeTable = `"${table.replace(/"/g, '""')}"`;
            const result = await client.query(`SELECT * FROM ${safeTable}`);

            const file = path.join(targetDir, `${table}.json`);
            fs.writeFileSync(file, JSON.stringify(result.rows, null, 0), 'utf8');

            manifest.tables[table] = { rows: result.rows.length, file: path.basename(file) };
            console.log(`[backup]   ${table}: ${result.rows.length} строк`);
        }

        fs.writeFileSync(
            path.join(targetDir, 'manifest.json'),
            JSON.stringify(manifest, null, 2),
            'utf8'
        );

        const totalRows = Object.values(manifest.tables).reduce((sum, t) => sum + t.rows, 0);
        console.log(`[backup] Готово: ${totalRows} строк в ${tables.length} таблицах`);
    } finally {
        client.release();
        // Освобождаем пул иначе процесс не завершится.
        if (typeof closePool === 'function') closePool();
        else if (typeof pool.end === 'function') pool.end();
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[backup] ОШИБКА:', error.message);
        process.exit(1);
    });