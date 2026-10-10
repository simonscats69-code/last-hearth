// packages/core/src/equipment-rules.ts
// Equipment rules extracted from public/shared/equipment.js
// Single source of truth for equipment durability, upgrades, repairs, and sets

import {
  Rarity,
  EquipmentSlot,
  InventoryItem,
  PlayerEquipment,
  COMBAT_SLOTS,
  EQUIPMENT_SLOTS,
  DEFENSE_SLOTS,
  RARITY_ORDER,
  BASE_PRICE_BY_RARITY,
  MAX_MODIFICATION_LEVEL,
  MAX_UPGRADE_LEVEL,
  UPGRADE_BONUS_PER_LEVEL,
  UPGRADE_MATERIAL_BY_RARITY,
  SCRAP_YIELD_BY_RARITY,
  AMMO_ITEM_NAME,
  ROCKET_ITEM_NAME,
  MODIFICATIONS,
  MODIFICATION_BY_STAT,
  MAX_INVENTORY_SLOTS,
} from './types';
import { GAME_CONFIG, WEAR_PER_HIT, REPAIR_COST_MULTIPLIER, UPGRADE_COST_MULTIPLIER } from './config';

/** Слоты экипировки, которые участвуют в расчёте защиты */
export const EQUIPMENT_SLOTS_LIST: readonly EquipmentSlot[] = Object.freeze(DEFENSE_SLOTS);

/** Синонимы полей сопротивления */
export const RADIATION_KEYS = Object.freeze([
  'radiation_resist', 'radiation_resistance', 'radiationDefense'
]);

export const INFECTION_KEYS = Object.freeze([
  'infection_resist', 'infection_resistance', 'infectionDefense'
]);

/** Достать числовой стат из предмета по списку возможных полей */
export function getEquipmentStatValue(item: InventoryItem | null | undefined, keys: readonly string[]): number {
  if (!item || typeof item !== 'object') return 0;

  for (const key of keys) {
    const directValue = Number((item as unknown as Record<string, unknown>)[key]);
    if (Number.isFinite(directValue) && directValue > 0) {
      return directValue;
    }
  }

  const stats = item.stats && typeof item.stats === 'object' ? item.stats : null;
  if (!stats) return 0;

  for (const key of keys) {
    const statValue = Number((stats as unknown as Record<string, unknown>)[key]);
    if (Number.isFinite(statValue) && statValue > 0) {
      return statValue;
    }
  }

  return 0;
}

/** Сумма сопротивления по всем слотам экипировки */
export function sumEquipmentResistance(equipment: PlayerEquipment | null | undefined, keys: readonly string[]): number {
  if (!equipment) return 0;
  let total = 0;
  for (const slot of EQUIPMENT_SLOTS_LIST) {
    total += getEquipmentStatValue(equipment[slot], keys);
  }
  return total;
}

/** Сырое сопротивление -> очки защиты */
export function normalizeResistanceToThreatPoints(totalResistance: number): number {
  return Math.max(0, Math.round(Number(totalResistance || 0) / 10));
}

/** Защита от радиации из экипировки */
export function calculateRadiationDefense(equipment: PlayerEquipment | null | undefined): number {
  return normalizeResistanceToThreatPoints(
    sumEquipmentResistance(equipment, RADIATION_KEYS)
  );
}

/** Защита от инфекций из экипировки */
export function calculateInfectionDefense(equipment: PlayerEquipment | null | undefined): number {
  return normalizeResistanceToThreatPoints(
    sumEquipmentResistance(equipment, INFECTION_KEYS)
  );
}

/** Зеркало normalizeResistanceToThreatPoints с округлением вверх */
export function normalizeThreatLevelToPoints(rawLevel: number): number {
  return Math.max(0, Math.ceil(Number(rawLevel || 0) / 10));
}

/** Пороги риска локаций */
export const RISK_PREPARED_MAX_SCORE = 2;

export const RISK_TIERS = Object.freeze([
  Object.freeze({
    key: 'safe', label: 'Стабильно', maxScore: 1,
    rewardMultiplier: 1, keyChanceMultiplier: 1, rarityLuckBonus: 0, expMultiplier: 1
  }),
  Object.freeze({
    key: 'warning', label: 'Риск', maxScore: 4,
    rewardMultiplier: 1.12, keyChanceMultiplier: 1.35, rarityLuckBonus: 6, expMultiplier: 1.18
  }),
  Object.freeze({
    key: 'danger', label: 'Опасно', maxScore: 7,
    rewardMultiplier: 1.28, keyChanceMultiplier: 1.75, rarityLuckBonus: 12, expMultiplier: 1.4
  }),
  Object.freeze({
    key: 'deadly', label: 'Смертельно', maxScore: Infinity,
    rewardMultiplier: 1.5, keyChanceMultiplier: 2.25, rarityLuckBonus: 18, expMultiplier: 1.7
  })
]);

/** Тир риска по сумме давления угроз */
export function getRiskTierByScore(score: number) {
  const value = Number(score);
  const safeScore = Number.isFinite(value) ? Math.max(0, value) : 0;
  return RISK_TIERS.find((tier) => safeScore <= tier.maxScore) || RISK_TIERS[RISK_TIERS.length - 1];
}

/** Формула опыта до следующего уровня */
export function getExpForLevel(level: number): number {
  const lvl = Math.max(1, Number(level) || 1);
  return Math.round(500 * lvl * (1 + lvl / 25));
}

/** Общий опыт для достижения уровня */
export function getTotalExpForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i < Math.max(1, Number(level) || 1); i++) {
    total += getExpForLevel(i);
  }
  return total;
}

/** Потолок здоровья для пассивного регена */
export function getHealthRegenCap(maxHealth: number): number {
  const max = Math.max(1, Number(maxHealth) || 1);
  return Math.max(1, Math.floor(max * GAME_CONFIG.HEALTH_REGEN_CAP_RATIO));
}

/** Сколько HP можно восстановить бесплатно */
export function getRegenerableHealth(health: number, maxHealth: number): number {
  return Math.max(0, getHealthRegenCap(maxHealth) - Math.max(0, Number(health) || 0));
}

/** Определить слот экипировки для предмета */
export function resolveEquipmentSlot(item: InventoryItem | null | undefined): EquipmentSlot | null {
  if (!item || typeof item !== 'object') return null;

  const candidates = [
    item.slot,
    item.category,
    item.type
  ];

  for (const candidate of candidates) {
    const slot = String(candidate || '').toLowerCase();
    if (COMBAT_SLOTS.includes(slot as EquipmentSlot)) return slot as EquipmentSlot;
  }
  return null;
}

/** Слоты, участвующие в бою */
export const COMBAT_SLOTS_LIST = Object.freeze(EQUIPMENT_SLOTS.concat(['weapon']));

/** Поля «защиты» предмета */
export const DEFENSE_KEYS = Object.freeze(['defense', 'armor', 'protection']);

/** Поля «удачи» предмета */
export const LUCK_KEYS = Object.freeze(['luck', 'luck_bonus']);

/** Привести редкость к известному значению */
export function normalizeRarity(rarity: string | undefined): Rarity {
  const value = String(rarity || '').toLowerCase();
  return RARITY_ORDER.includes(value as Rarity) ? value as Rarity : 'common';
}

/** Привести уровень улучшения к диапазону 0..MAX_UPGRADE_LEVEL */
export function getUpgradeLevel(item: InventoryItem | null | undefined): number {
  const raw = Number(item?.upgrade_level);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(MAX_UPGRADE_LEVEL, Math.max(0, Math.round(raw)));
}

/** Множитель характеристик за улучшения */
export function getUpgradeMultiplier(item: InventoryItem | null | undefined): number {
  return 1 + getUpgradeLevel(item) * UPGRADE_BONUS_PER_LEVEL;
}

/** Снаряжение ли это */
export function isEquipmentItem(item: InventoryItem | null | undefined): boolean {
  if (!item || typeof item !== 'object') return false;
  const type = String(item.type || '').toLowerCase();
  if (type === 'weapon' || type === 'armor') return true;
  return Boolean(item.slot);
}

/** Текущая и максимальная прочность предмета */
export function getDurabilityInfo(item: InventoryItem | null | undefined): {
  current: number; max: number; isBroken: boolean; ratio: number
} {
  const maxRaw = Number(item && (item.max_durability ?? item.durability));
  const max = Math.max(1, Math.round(Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : GAME_CONFIG.BASE_DURABILITY));

  if (!isEquipmentItem(item)) {
    return { current: max, max, isBroken: false, ratio: 1 };
  }

  const raw = Number(item && item.durability);
  const current = Number.isFinite(raw)
    ? Math.min(max, Math.max(0, Math.round(raw)))
    : max;

  return {
    current,
    max,
    isBroken: current <= 0,
    ratio: max > 0 ? current / max : 0
  };
}

/** Значение характеристики с учётом улучшений, модификаций и прочности */
export function getEffectiveStatValue(item: InventoryItem | null | undefined, keys: readonly string[]): number {
  const base = getEquipmentStatValue(item, keys);
  if (base <= 0) return 0;
  if (isEquipmentItem(item) && getDurabilityInfo(item).isBroken) return 0;

  const upgraded = base * getUpgradeMultiplier(item);

  let bonus = 0;
  for (const key of keys) {
    bonus += getModificationBonus(item, key);
  }

  return Math.max(0, Math.round(upgraded + bonus));
}

/** Суммарная защита экипировки */
export function calculateDefenseTotal(equipment: PlayerEquipment | null | undefined): number {
  if (!equipment) return 0;
  let total = 0;
  for (const slot of COMBAT_SLOTS) {
    total += getEffectiveStatValue(equipment[slot], DEFENSE_KEYS);
  }
  return total;
}

/** Суммарная прибавка к удаче из экипировки */
export function calculateEquipmentLuckBonus(equipment: PlayerEquipment | null | undefined): number {
  if (!equipment) return 0;
  let total = 0;
  for (const slot of COMBAT_SLOTS) {
    total += getEffectiveStatValue(equipment[slot], LUCK_KEYS);
  }
  return total;
}

/** Снижение входящего урона защитой */
export function applyDefenseReduction(damage: number, defense: number): number {
  const incoming = Math.max(0, Number(damage) || 0);
  const defenseTotal = Math.max(0, Number(defense) || 0);
  if (defenseTotal <= 0) return Math.max(1, Math.round(incoming));

  const reduction = Math.min(60, (defenseTotal / (defenseTotal + 100)) * 60);
  return Math.max(1, Math.floor(incoming * (1 - reduction / 100)));
}

/** Износ предмета */
export function wearEquipment(item: InventoryItem, amount = 1): InventoryItem {
  if (!isEquipmentItem(item)) return item;

  const info = getDurabilityInfo(item);
  const wear = Math.max(0, Math.round(Number(amount) * WEAR_PER_HIT));

  return {
    ...item,
    durability: Math.max(0, info.current - wear),
    max_durability: info.max
  };
}

/** Цена ремонта */
export function calculateRepairCost(item: InventoryItem | null | undefined): number {
  if (!item) return 0;
  const info = getDurabilityInfo(item);
  const missing = info.max - info.current;
  if (missing <= 0) return 0;

  const rarity = normalizeRarity(item.rarity);
  const basePrice = Number(item.price) || BASE_PRICE_BY_RARITY[rarity];
  return Math.max(1, Math.ceil((missing / info.max) * basePrice * REPAIR_COST_MULTIPLIER));
}

/** Стоимость следующего улучшения */
export function calculateUpgradeCost(item: InventoryItem | null | undefined): {
  level: number; next_level: number; coins: number; materials: Record<string, number>
} | null {
  if (!item) return null;
  const level = getUpgradeLevel(item);
  if (level >= MAX_UPGRADE_LEVEL) return null;

  const rarity = normalizeRarity(item.rarity);
  const basePrice = Number(item.price) || BASE_PRICE_BY_RARITY[rarity];
  const coins = Math.max(20, Math.round(basePrice * UPGRADE_COST_MULTIPLIER * (level + 1)));

  const materials: Record<string, number> = {};
  const primary = UPGRADE_MATERIAL_BY_RARITY[rarity];
  if (primary) materials[primary] = 1 + Math.floor(level / 2);

  const ammoType = String(item.ammo_type || '').toLowerCase();
  if (ammoType === 'rockets') {
    materials[ROCKET_ITEM_NAME] = (materials[ROCKET_ITEM_NAME] || 0) + (level + 1);
  } else if (ammoType === 'ammo' || String(item.category || '').toLowerCase() === 'ranged') {
    materials[AMMO_ITEM_NAME] = (materials[AMMO_ITEM_NAME] || 0) + (level + 1);
  }

  return { level, next_level: level + 1, coins, materials };
}

/** Что даёт разбор предмета */
export function calculateScrapYield(item: InventoryItem | null | undefined, quantity = 1): Record<string, number> {
  if (!item || !isEquipmentItem(item)) return {};

  const rarity = normalizeRarity(item.rarity);
  const yieldMap = SCRAP_YIELD_BY_RARITY[rarity as keyof typeof SCRAP_YIELD_BY_RARITY] ?? SCRAP_YIELD_BY_RARITY['common'];
  if (!yieldMap) return {};

  const factor = Math.max(1, Math.min(5, Math.round(Number(quantity) || 1)));

  const result: Record<string, number> = {};
  const yieldEntries = Object.entries(yieldMap);
  for (const [name, count] of yieldEntries) {
    result[name] = count * factor;
  }
  return result;
}

/** Уровень модификации предмета */
export function getModificationLevel(item: InventoryItem | null | undefined, key: string): number {
  const all = (item && item.modifications && typeof item.modifications === 'object')
    ? item.modifications
    : {};
  const raw = Number((all as Record<string, unknown>)[key]);
  if (!Number.isFinite(raw)) return 0;
  return Math.min(MAX_MODIFICATION_LEVEL, Math.max(0, Math.round(raw)));
}

/** Плоская прибавка от модификаций */
export function getModificationBonus(item: InventoryItem | null | undefined, stat: string): number {
  const modification = MODIFICATION_BY_STAT[stat];
  if (!modification) return 0;
  return getModificationLevel(item, modification.key) * modification.perLevel;
}

/** Стоимость следующего уровня модификации */
export function calculateModificationCost(item: InventoryItem | null | undefined, key: string): {
  level: number; next_level: number; coins: number; materials: Record<string, number>
} | null {
  const modification = MODIFICATIONS.find(m => m.key === key);
  if (!modification || !item) return null;

  const level = getModificationLevel(item, key);
  if (level >= MAX_MODIFICATION_LEVEL) return null;

  const rarity = normalizeRarity(item.rarity);
  const basePrice = Number(item.price) || BASE_PRICE_BY_RARITY[rarity];
  const coins = Math.max(15, Math.round(basePrice * 0.25 * (level + 1)));
  const material = modification.materials[rarity];

  return {
    level,
    next_level: level + 1,
    coins,
    materials: material ? { [material]: 1 + level } : {}
  };
}

/** Подходит ли модификация этому предмету */
export function isModificationApplicable(item: InventoryItem | null | undefined, key: string): boolean {
  const modification = MODIFICATIONS.find(m => m.key === key);
  if (!modification || !item || !isEquipmentItem(item)) return false;

  const type = String(item.type || '').toLowerCase();
  if (modification.appliesTo === 'weapon') return type === 'weapon';
  if (modification.appliesTo === 'armor') return type === 'armor';
  return true;
}

/** Разброс урона */
export function rollVarianceDamage(baseDamage: number, variancePercent: number): number {
  const base = Math.max(0, Number(baseDamage) || 0);
  const variance = Math.max(0, Math.min(100, Number(variancePercent) || 0));
  if (base === 0) return 0;
  if (variance === 0) return Math.max(1, Math.round(base));

  const factor = 1 - variance / 100 + Math.random() * (2 * variance / 100);
  return Math.max(1, Math.floor(base * factor));
}

/** Сколько предметов каждого сета надето */
export function collectSetPieceCounts(equipment: PlayerEquipment | null | undefined): Record<number, number> {
  const counts: Record<number, number> = {};
  if (!equipment) return counts;

  for (const slot of COMBAT_SLOTS) {
    const item = equipment[slot];
    if (!item) continue;
    const statsSetId = item.stats && typeof item.stats === 'object'
      ? (item.stats as Record<string, unknown>)['set_id']
      : undefined;
    const setId = Number(item['set_id'] || statsSetId || 0);
    if (!setId) continue;
    counts[setId] = (counts[setId] || 0) + 1;
  }
  return counts;
}

/** Бонусы сетов */
export function calculateSetBonuses(
  equipment: PlayerEquipment | null | undefined,
  sets: Array<{ id: number; bonus_2?: Record<string, number>; bonus_3?: Record<string, number>; bonus_4?: Record<string, number> }>
): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!Array.isArray(sets) || sets.length === 0) return totals;

  const counts = collectSetPieceCounts(equipment);
  for (const set of sets) {
    const count = counts[Number(set.id)] || 0;
    if (count < 2) continue;

    const tier = count >= 4 ? 4 : (count === 3 ? 3 : 2);
    const bonus = set[`bonus_${tier}`];
    if (!bonus || typeof bonus !== 'object') continue;

    for (const [key, value] of Object.entries(bonus)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        totals[key] = (totals[key] || 0) + numeric;
      }
    }
  }
  return totals;
}
