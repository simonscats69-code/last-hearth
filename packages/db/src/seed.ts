// packages/db/src/seed.ts
// Database seed data runner

import { Pool } from 'pg';

async function runSeed(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Seed basic achievements if none exist
    const countResult = await client.query('SELECT COUNT(*) as cnt FROM achievements');
    const count = Number(countResult.rows[0]?.cnt || 0);

    if (count === 0) {
      await client.query(`
        INSERT INTO achievements (name, description, category, icon, rarity, condition, reward)
        VALUES
          ('Первые шаги', 'Достичь 5 уровня', 'level', '👣', 'common', '{"type": "level", "count": 5}', '{"coins": 100}'),
          ('Ветеран', 'Достичь 10 уровня', 'level', '⭐', 'uncommon', '{"type": "level", "count": 10}', '{"coins": 500}'),
          ('Босс-убийца', 'Победить 5 боссов', 'boss', '💀', 'rare', '{"type": "bosses_killed", "count": 5}', '{"coins": 1000}'),
          ('PvP-боец', 'Выиграть 10 PvP-боёв', 'pvp', '⚔️', 'uncommon', '{"type": "pvp_wins", "count": 10}', '{"coins": 500}')
      `);
      console.log('Seeded achievements');
    }

    await client.query('COMMIT');
    console.log('Seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

runSeed(pool)
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch(err => {
    console.error('Seed failed:', err);
    pool.end();
    process.exit(1);
  });
