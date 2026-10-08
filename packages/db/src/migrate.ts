// packages/db/src/migrate.ts
// Database migration runner

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '../db/migrations');

async function runMigrations(pool: Pool) {
  // Create migrations table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Get applied migrations
  const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set(result.rows.map(r => r.version));

  // Read migration files
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    for (const file of files) {
      const version = file.replace('.sql', '');
      if (applied.has(version)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`Applied migration: ${version}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
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
