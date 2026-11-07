const { Pool } = require('pg');
const pool = new Pool({
  host: 'aws-1-eu-west-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.eddqhtpbpqzdixejmked',
  password: 'Leonardo43552635',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
  .then(r => { console.log(JSON.stringify(r.rows.map(x=>x.table_name))); pool.end(); })
  .catch(e => { console.error('ERR:', e.message); pool.end(); });
