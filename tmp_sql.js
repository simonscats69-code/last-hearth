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
  console.log('=== items columns ===');
  let r = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='items' ORDER BY ordinal_position");
  console.log(JSON.stringify(r.rows));
  console.log('=== items sample ===');
  r = await pool.query("SELECT * FROM items LIMIT 3");
  console.log(JSON.stringify(r.rows));
  console.log('=== crafting_recipes columns ===');
  r = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='crafting_recipes' ORDER BY ordinal_position");
  console.log(JSON.stringify(r.rows));
  console.log('=== crafting_recipes sample ===');
  r = await pool.query("SELECT * FROM crafting_recipes LIMIT 3");
  console.log(JSON.stringify(r.rows));
  pool.end();
}
main().catch(e=>{console.error('ERR:',e.message);pool.end();});
