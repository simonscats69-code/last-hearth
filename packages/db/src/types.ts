// packages/db/src/types.ts
// Database-related type definitions

export interface DbPlayer {
  id: number;
  telegram_id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  level: number;
  experience: number;
  strength: number;
  endurance: number;
  agility: number;
  intelligence: number;
  luck: number;
  health: number;
  max_health: number;
  radiation: string;
  energy: number;
  max_energy: number;
  infections: string;
  current_location_id: number;
  inventory: string;
  equipment: string;
  coins: number;
  stars: number;
  banned: boolean;
  ban_reason?: string;
  clan_id?: number;
  clan_role?: string;
  total_actions: number;
  bosses_killed: number;
  days_played: number;
  last_energy_update: Date;
  last_action_time: Date;
  active_boss_mode?: string;
  active_raid_id?: number;
  last_daily_bonus?: Date;
  daily_streak: number;
  created_at: Date;
  updated_at: Date;
  pvp_wins: number;
  pvp_losses: number;
  pvp_draws: number;
  pvp_streak: number;
  pvp_max_streak: number;
  pvp_rating: number;
  pvp_total_damage_dealt: number;
  pvp_total_damage_taken: number;
  coins_stolen_from_me: number;
  items_stolen_from_me: number;
  unique_items: string;
  locations_visited: string;
  clans_joined: number;
  clan_donated: number;
  active_boss_id?: number;
}

export interface DbItem {
  id: number;
  name: string;
  description?: string;
  type: string;
  category?: string;
  rarity: string;
  price: number;
  stars_price?: number;
  icon: string;
  stats: string;
  slot?: string;
  ammo_type?: string;
  durability?: number;
  max_durability?: number;
  set_id?: number;
  upgrade_level?: number;
  max_upgrade_level?: number;
  modifications?: string;
  stackable?: boolean;
  max_stack?: number;
}

export interface DbBoss {
  id: number;
  name: string;
  description?: string;
  level: number;
  health: number;
  max_health: number;
  damage: number;
  defense: number;
  reward_coins: number;
  reward_exp: number;
  reward_stars?: number;
  icon: string;
  location_id: number;
  required_level: number;
  is_active: boolean;
  created_at: Date;
}

export interface DbAchievement {
  id: number;
  name: string;
  description: string;
  category: string;
  icon: string;
  rarity: string;
  condition: string;
  reward: string;
  created_at: Date;
}
