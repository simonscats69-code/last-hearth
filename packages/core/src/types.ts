// packages/core/src/types.ts
// Shared type definitions for Last Hearth

/** Item rarity levels */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** Equipment slot types */
export type EquipmentSlot =
  | 'weapon'
  | 'armor'
  | 'head'
  | 'body'
  | 'hands'
  | 'legs'
  | 'boots'
  | 'accessory';

/** Item categories */
export type ItemCategory =
  | 'weapon'
  | 'armor'
  | 'food'
  | 'medicine'
  | 'resource'
  | 'ammo'
  | 'key'
  | 'consumable'
  | 'material';

/** Base item structure from database */
export interface BaseItem {
  id: number;
  name: string;
  description: string;
  type: ItemCategory;
  category?: string;
  rarity: Rarity;
  price: number;
  stars_price?: number;
  icon: string;
  stats: Record<string, number>;
  slot?: EquipmentSlot;
  ammo_type?: string;
  durability?: number;
  max_durability?: number;
  set_id?: number;
  upgrade_level?: number;
  max_upgrade_level?: number;
  modifications?: Record<string, number>;
}

/** Inventory item (extends base with runtime data) */
export interface InventoryItem extends BaseItem {
  quantity: number;
  index?: number;
}

/** Player equipment slots */
export interface PlayerEquipment {
  weapon?: InventoryItem;
  armor?: InventoryItem;
  head?: InventoryItem;
  body?: InventoryItem;
  hands?: InventoryItem;
  legs?: InventoryItem;
  boots?: InventoryItem;
  accessory?: InventoryItem;
}

/** Player stats from database */
export interface PlayerStats {
  id: number;
  telegram_id: number;
  username?: string;
  first_name: string;
  last_name?: string;
  level: number;
  experience: number;
  coins: number;
  stars: number;
  energy: number;
  max_energy: number;
  health: number;
  max_health: number;
  strength: number;
  endurance: number;
  agility: number;
  intelligence: number;
  luck: number;
  radiation: { level: number; expires_at: string | null; applied_at: string | null } | null;
  infections: Array<{ type: string; level: number; expires_at: string }>;
  buffs: Record<string, number>;
  equipment: Record<string, InventoryItem | null>;
  inventory: InventoryItem[];
  clan_id: number | null;
  clan_role: string | null;
  current_location_id: number;
  last_action_time: Date;
  last_energy_update: Date;
  last_hp_regen: Date;
  auto_heal_enabled: boolean;
  auto_heal_threshold: number;
  boss_damage: number;
  items_collected: number;
  bosses_killed: number;
  pvp_wins: number;
  pvp_losses: number;
  pvp_draws: number;
  pvp_streak: number;
  pvp_max_streak: number;
  pvp_rating: number;
  total_actions: number;
  daily_streak: number;
  daily_tasks_completed: number;
  daily_tasks_reset_at: Date | null;
  locations_visited: number[];
  clans_joined: number;
  clan_donated: number;
  active_boss_id: number | null;
  active_raid_id: number | null;
  active_boss_mode: string | null;
  active_boss_started_at: Date | null;
}

/** Equipment slot names */
export const EQUIPMENT_SLOTS: EquipmentSlot[] = [
  'weapon', 'armor', 'head', 'body', 'hands', 'legs', 'boots', 'accessory'
];

/** Combat-relevant equipment slots */
export const COMBAT_SLOTS: EquipmentSlot[] = [
  'weapon', 'armor', 'head', 'body', 'hands', 'legs', 'boots', 'accessory'
];

/** Rarity order for sorting */
export const RARITY_ORDER: readonly Rarity[] = [
  'common', 'uncommon', 'rare', 'epic', 'legendary'
] as const;

/** Equipment slot icons */
export const SLOT_ICONS: Record<EquipmentSlot, string> = {
  weapon: '⚔️',
  armor: '🛡️',
  head: '🪖',
  body: '🧥',
  hands: '🧤',
  legs: '👖',
  boots: '🥾',
  accessory: '🧭',
};

/** Rarity colors for UI */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

/** Valid equipment slots for combat */
export const VALID_COMBAT_SLOTS = ['weapon', 'body', 'head', 'hands', 'legs', 'boots', 'accessory'] as const;

/** Ammo item names */
export const AMMO_ITEM_NAME = 'Патроны';
export const ROCKET_ITEM_NAME = 'Реактивные гранаты';

/** Modification types */
export interface Modification {
  id: string;
  name: string;
  description: string;
  stat: 'damage' | 'defense' | 'luck' | 'radiation_resist' | 'infection_resist';
  bonus_per_level: number;
  max_level: number;
  materials_per_level: Record<string, number>;
  cost_multiplier: number;
}

export const MODIFICATIONS: Modification[] = [
  {
    id: 'sharpening',
    name: 'Заточка',
    description: 'Увеличивает урон оружия',
    stat: 'damage',
    bonus_per_level: 2,
    max_level: 5,
    materials_per_level: { 'Пластик': 2, 'Металлолом': 1 },
    cost_multiplier: 1.5,
  },
  {
    id: 'reinforcement',
    name: 'Укрепление',
    description: 'Увеличивает защиту брони',
    stat: 'defense',
    bonus_per_level: 3,
    max_level: 5,
    materials_per_level: { 'Металлолом': 2, 'Пластик': 1 },
    cost_multiplier: 1.5,
  },
  {
    id: 'lucky_charm',
    name: 'Амулет удачи',
    description: 'Увеличивает удачу',
    stat: 'luck',
    bonus_per_level: 2,
    max_level: 3,
    materials_per_level: { 'Кристалл силы': 1 },
    cost_multiplier: 2.0,
  },
  {
    id: 'lead_lining',
    name: 'Свинецовая подкладка',
    description: 'Защита от радиации',
    stat: 'radiation_resist',
    bonus_per_level: 5,
    max_level: 3,
    materials_per_level: { 'Свинец': 2, 'Металлолом': 1 },
    cost_multiplier: 1.8,
  },
  {
    id: 'herbal_lining',
    name: 'Травяная подкладка',
    description: 'Защита от инфекций',
    stat: 'infection_resist',
    bonus_per_level: 5,
    max_level: 3,
    materials_per_level: { 'Трава': 2, 'Ткань': 1 },
    cost_multiplier: 1.8,
  },
];

export const MODIFICATION_BY_STAT: Record<string, Modification> = Object.fromEntries(
  MODIFICATIONS.map(m => [m.stat, m])
);

/** Upgrade materials by rarity */
export const UPGRADE_MATERIAL_BY_RARITY: Record<string, string> = {
  common: 'Металлолом',
  uncommon: 'Пластик',
  rare: 'Провода',
  epic: 'Электроника',
  legendary: 'Кристалл силы',
};

/** Scrap yield by rarity */
export const SCRAP_YIELD_BY_RARITY: Record<string, Record<string, number>> = {
  common: { 'Металлолом': 1, 'Древесина': 1 },
  uncommon: { 'Металлолом': 2, 'Пластик': 1 },
  rare: { 'Металлолом': 3, 'Провода': 1 },
  epic: { 'Металлолом': 5, 'Электроника': 2 },
  legendary: { 'Кристалл силы': 1, 'Титан': 2, 'Уран': 1 },
};

/** Base prices by rarity (used when item.price is not set) */
export const BASE_PRICE_BY_RARITY = {
  common: 50,
  uncommon: 200,
  rare: 800,
  epic: 5000,
  legendary: 50000,
};

/** Max inventory slots */
export const MAX_INVENTORY_SLOTS = 100;

/** Modification max level */
export const MAX_MODIFICATION_LEVEL = 5;

/** Upgrade bonus per level (8% per level) */
export const UPGRADE_BONUS_PER_LEVEL = 0.08;

/** Valid equipment slots */
export const VALID_SLOTS = ['weapon', 'head', 'body', 'hands', 'legs', 'boots', 'accessory'] as const;
