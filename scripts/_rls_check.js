/**
 * Диагностика RLS (Supabase Advisor).
 * Запуск: node scripts/_rls_check.js
 * Печатает таблицы public с выключенным RLS, существующие политики
 * и текущую роль подключения. После запуска сервера (миграция в
 * runMigrations включает RLS) список "RLS-off tables" должен стать пустым.
 */
require('dotenv').config();
// Конфиг берём из приложения (db/database.js): учитывает sslmode/SSL так же,
// как сервер, — проверяем ровно то подключение, что и в бою.
const { pool: p, describeError } = require('../db/database');

(async () => {
    try {
        const r = await p.query(`
            SELECT c.relname, c.relrowsecurity
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p')
              AND NOT c.relrowsecurity
            ORDER BY c.relname
        `);
        console.log('RLS-off tables:', r.rowCount);
        r.rows.forEach(x => console.log(' -', x.relname));

        const pol = await p.query(`
            SELECT schemaname, tablename, policyname, roles, cmd
            FROM pg_policies WHERE schemaname = 'public'
            ORDER BY tablename
        `);
        console.log('Existing policies:', pol.rowCount);
        pol.rows.forEach(x => console.log(' *', x.tablename, '->', x.policyname, 'roles:', x.roles.join(','), 'cmd:', x.cmd));

        const who = await p.query(`SELECT current_user, session_user`);
        console.log('connected as:', who.rows[0].current_user, '/', who.rows[0].session_user);
    } catch (e) {
        console.log('DB ERR:', describeError(e));
    } finally {
        await p.end();
    }
})();
