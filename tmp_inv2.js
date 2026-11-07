const { Pool } = require('pg');
const pool = new Pool({
  host: 'aws-1-eu-west-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.eddqhtpbpqzdixejmked',
  password: 'Leonardo43552635',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
async function main(){
  const r = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='player_inventory' ORDER BY ordinal_position");
  console.log(JSON.stringify(r.rows));
  const r2 = await pool.query("SELECT * FROM player_inventory LIMIT 3");
  console.log(JSON.stringify(r2.rows));
  pool.end();
}
main().catch(e=>{console.error('ERR:',e.message);pool.end();});
