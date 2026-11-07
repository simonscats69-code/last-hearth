const { Pool } = require('pg');
const pool = new Pool({
  host: 'aws-1-eu-west-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.eddqhtpbpqzdixejmked',
  password: 'Leonardo43552635',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='players' ORDER BY ordinal_position")
  .then(r => { console.log(JSON.stringify(r.rows)); pool.end(); })
  .catch(e => { console.error('ERR:', e.message); pool.end(); });
