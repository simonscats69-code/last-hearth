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
  // 1. player_inventory item_id not in items
  let r = await pool.query("SELECT pi.player_id, pi.item_id FROM player_inventory pi LEFT JOIN items i ON pi.item_id = i.id WHERE i.id IS NULL");
  console.log('orphan player_inventory (item not in items):', r.rows.length, r.rows.slice(0,5));
  // 2. players current_location_id not in locations
  r = await pool.query("SELECT p.id, p.current_location_id FROM players p LEFT JOIN locations l ON p.current_location_id = l.id WHERE p.current_location_id IS NOT NULL AND l.id IS NULL");
  console.log('players with invalid location:', r.rows.length, r.rows);
  // 3. crafting_recipes result_item_id not in items
  r = await pool.query("SELECT c.id, c.result_item_id FROM crafting_recipes c LEFT JOIN items i ON c.result_item_id = i.id WHERE i.id IS NULL");
  console.log('crafting_recipes with missing result item:', r.rows.length, r.rows);
  // 4. daily_tasks with invalid player_id
  r = await pool.query("SELECT dt.id, dt.player_id FROM daily_tasks dt LEFT JOIN players p ON dt.player_id = p.id WHERE p.id IS NULL");
  console.log('daily_tasks with missing player:', r.rows.length, r.rows);
  pool.end();
}
main().catch(e=>{console.error('ERR:',e.message);pool.end();});
