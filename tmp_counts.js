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
  const tables = ["achievements","blueprints","boss_keys","boss_mastery","boss_sessions","bosses","clan_chat","clans","contract_bounties","crafting_recipes","daily_tasks","idempotency_keys","item_set_items","item_sets","items","location_mastery","location_pois","locations","material_refinements","player_achievements","player_boss_progress","player_inventory","player_logs","player_poi_cooldowns","player_recipes","player_reputation","players","pvp_battle_log","pvp_battles","pvp_cooldowns","raid_progress","raid_rewards","rate_limits","scheduler_state","schema_migrations","survivor_contracts"];
  for(const t of tables){
    try {
      const r = await pool.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(t, r.rows[0].count);
    } catch(e) {
      console.log(t, 'ERR:', e.message);
    }
  }
  pool.end();
}
main();
