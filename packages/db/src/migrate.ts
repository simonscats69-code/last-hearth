// packages/db/src/migrate.ts
// Database migration runner

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_FILE: string = (() => {
  const candidates = [
    path.join(__dirname, '../db/migrations.sql'),
    path.join(__dirname, '../../../db/migrations.sql'),
    path.join(__dirname, '../../db/migrations.sql'),
    path.join(process.cwd(), 'db/migrations.sql'),
    path.join(process.cwd(), '../db/migrations.sql'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0] as string;
})();

const MIGRATION_VERSION = 'migrations_sql';

async function runMigrations(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set(result.rows.map(r => r.version));

  if (!fs.existsSync(MIGRATIONS_FILE)) {
    console.log('No migrations file found, skipping');
    return;
  }
  const sql = fs.readFileSync(MIGRATIONS_FILE, 'utf-8');
  if (!sql.trim()) {
    console.log('Migrations file is empty, skipping');
    return;
  }

  if (applied.has(MIGRATION_VERSION)) {
    console.log('Migrations already applied');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [MIGRATION_VERSION]);
      await client.query('COMMIT');
      console.log(`Applied migration: ${MIGRATION_VERSION}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }

  console.log('Migrations complete');
}

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

runMigrations(pool)
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    pool.end();
    process.exit(1);
  });