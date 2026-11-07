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
  // players with NULL jsonb fields
  let r = await pool.query("SELECT id, telegram_id FROM players WHERE inventory IS NULL OR equipment IS NULL OR radiation IS NULL");
  console.log('players with NULL jsonb:', r.rows.length, r.rows);
  // consumable/food items stats
  r = await pool.query("SELECT id, name, type, stats FROM items WHERE type IN ('consumable','food') LIMIT 5");
  console.log('consumable/food items sample:', JSON.stringify(r.rows));
  // duplicate item names
  r = await pool.query("SELECT name, COUNT(*) as c FROM items GROUP BY name HAVING COUNT(*) > 1 LIMIT 10");
  console.log('duplicate item names:', r.rows.length, r.rows);
  // players with negative coins
  r = await pool.query("SELECT id, telegram_id, coins FROM players WHERE coins < 0");
  console.log('players with negative coins:', r.rows.length, r.rows);
  pool.end();
}
main().catch(e=>{console.error('ERR:',e.message);pool.end();});
