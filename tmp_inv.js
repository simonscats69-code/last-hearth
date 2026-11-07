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
  const r = await pool.query("SELECT player_id, item_id, quantity, item_data FROM player_inventory LIMIT 5");
  console.log(JSON.stringify(r.rows));
  pool.end();
}
main().catch(e=>{console.error('ERR:',e.message);pool.end();});
