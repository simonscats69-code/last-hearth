// packages/db/src/schema.ts
// Database schema types derived from db/schema.js

export interface PlayerRow {
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
  auto_heal_enabled?: boolean;
  auto_heal_threshold?: number;
  boss_damage?: number;
  items_collected?: number;
  daily_tasks_completed?: number;
  daily_tasks_reset_at?: Date;
  last_hp_regen?: Date;
}

export interface ItemRow {
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
  created_at: Date;
}

export interface BossRow {
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

export interface AchievementRow {
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

export interface PlayerAchievementRow {
  id: number;
  player_id: number;
  achievement_id: number;
  progress_value: number;
  completed: boolean;
  completed_at?: Date;
  reward_claimed: boolean;
  created_at: Date;
}

export interface ClanRow {
  id: number;
  name: string;
  description?: string;
  leader_id: number;
  level: number;
  experience: number;
  max_members: number;
  icon: string;
  is_public: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface LocationRow {
  id: number;
  name: string;
  description?: string;
  risk_level: number;
  radiation: number;
  infection: number;
  icon: string;
  required_level: number;
  created_at: Date;
}
