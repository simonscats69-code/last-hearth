// utils/equipment.d.ts
// TypeScript типизация для public/shared/equipment.js
// equipment.js — единственный источник правды для клиента и сервера (UMD модуль)
// Эта декларация позволяет импортировать его из TypeScript-кода с типами.

/** Редкость предмета */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** Слот экипировки */
export type EquipmentSlot = 'weapon' | 'armor' | 'head' | 'body' | 'hands' | 'legs' | 'boots' | 'accessory';

/** Модификация снаряжения: Заточка или Облицовка */
export interface Modification {
  key: string;
  name: string;
  stat: 'damage' | 'defense';
  perLevel: number;
  appliesTo: 'weapon' | 'armor' | 'both';
  icon: string;
  materials: Record<string, string>;
}

/** Предмет */
export interface InventoryItem {
  id?: number;
  name: string;
  type?: string;
  category?: string;
  rarity?: string;
  price?: number;
  icon?: string;
  stats?: Record<string, number>;
  slot?: EquipmentSlot;
  ammo_type?: string;
  durability?: number;
  max_durability?: number;
  set_id?: number;
  upgrade_level?: number;
  descriptions?: Record<string, number>;
  stackable?: boolean;
  max_stack?: number;
  quantity?: number;
}

/** Информация о прочности предмета */
export interface DurabilityInfo {
  current: number;
  max: number;
  isBroken: boolean;
  ratio: number;
}

/** Стоимость улучшения/модификации */
export interface UpgradeCost {
  level: number;
  next_level: number;
  coins: number;
  materials: Record<string, number>;
}

/** Интерфейс equipmentRules — экспорт из public/shared/equipment.js */
export interface EquipmentRules {
  // Константы
  MAX_INVENTORY_SLOTS: number;
  MAX_UPGRADE_LEVEL: number;
  MAX_MODIFICATION_LEVEL: number;
  UPGRADE_BONUS_PER_LEVEL: number;
  WEAR_PER_HIT: number;
  REPAIR_COST_MULTIPLIER: number;
  UPGRADE_COST_MULTIPLIER: number;
  RARITY_ORDER: readonly string[];
  MODIFICATIONS: Record<string, Modification>;
  MODIFICATION_BY_STAT: Record<string, Modification>;
  UPGRADE_MATERIAL_BY_RARITY: Record<string, string>;
  SCRAP_YIELD_BY_RARITY: Record<string, Record<string, number>>;
  BASE_PRICE_BY_RARITY: Record<string, number>;
  AMMO_ITEM_NAME: string;
  ROCKET_ITEM_NAME: string;
  COMBAT_SLOTS: readonly string[];
  GAME_CONFIG: Record<string, unknown>;
  ENERGY_REGEN_INTERVAL_MS: number;
  HEALTH_REGEN_INTERVAL_MS: number;
  HEALTH_REGEN_CAP_RATIO: number;
  DEFAULT_AUTO_HEAL_THRESHOLD: number;
  AUTO_HEAL_THRESHOLD_MIN: number;
  AUTO_HEAL_THRESHOLD_MAX: number;
  ENERGY_PURCHASE_STARS_COST: number;
  ENERGY_PER_PURCHASE: number;

  // Функции
  calculateDropChance(rarity: string, luck: number): number;
  calculateCoinDrop(locationRisk: unknown, luck: number): number;
  getEquipmentStatValue(item: unknown, keys: readonly string[]): number;
  sumEquipmentResistance(equipment: unknown, keys: readonly string[]): number;
  normalizeResistanceToThreatPoints(total: number): number;
  normalizeThreatLevelToPoints(raw: number): number;
  calculateRadiationDefense(equipment: unknown): number;
  calculateInfectionDefense(equipment: unknown): number;
  normalizeRarity(rarity: string | undefined): string;
  getUpgradeLevel(item: InventoryItem | null): number;
  getUpgradeMultiplier(item: InventoryItem | null): number;
  isEquipmentItem(item: InventoryItem | null): boolean;
  getDurabilityInfo(item: InventoryItem | null): DurabilityInfo;
  getEffectiveStatValue(item: InventoryItem | null, keys: readonly string[]): number;
  calculateDefenseTotal(equipment: unknown): number;
  calculateEquipmentLuckBonus(equipment: unknown): number;
  applyDefenseReduction(damage: number, defense: number): number;
  wearEquipment(item: InventoryItem, amount?: number): InventoryItem;
  calculateRepairCost(item: InventoryItem | null): number;
  calculateUpgradeCost(item: InventoryItem | null): UpgradeCost | null;
  calculateScrapYield(item: InventoryItem | null, quantity?: number): Record<string, number>;
  getModificationLevel(item: InventoryItem | null, key: string): number;
  getModificationBonus(item: InventoryItem | null, stat: string): number;
  calculateModificationCost(item: InventoryItem | null, key: string): UpgradeCost | null;
  isModificationApplicable(item: InventoryItem | null, key: string): boolean;
  rollVarianceDamage(baseDamage: number, variancePercent: number): number;
  collectSetPieceCounts(equipment: unknown): Record<number, number>;
  calculateSetBonuses(equipment: unknown, sets: unknown[]): Record<string, number>;
  getRegenerableHealth(health: number, maxHealth: number): number;
  getAutoHealThreshold(maxHealth: number, threshold: number | null): number;
  selectHealItem(items: unknown[], options: unknown): unknown | null;
  getRiskTierByScore(score: number): unknown;
  getExpForLevel(level: number): number;
  getTotalExpForLevel(level: number): number;
  getHealthRegenCap(maxHealth: number): number;
}

declare const equipmentRules: EquipmentRules;
export = equipmentRules;
