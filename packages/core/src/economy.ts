// packages/core/src/economy.ts
// Economy rules: sell prices, repair costs, upgrade costs, coin drops

import {
  InventoryItem,
  BASE_PRICE_BY_RARITY,
  MAX_INVENTORY_SLOTS
} from './types';
import { GAME_CONFIG } from './config';

/** Item types that cannot be sold */
export const NON_SELLABLE_TYPES = new Set(['key']);

/** Portion of shop price the player gets when selling */
export const SELL_RATE = 0.35;

/** Minimum sell price by rarity (for items with price = 0) */
export const SELL_FLOOR_BY_RARITY: Record<string, number> = {
  common: 3,
  uncommon: 8,
  rare: 20,
  epic: 45,
  legendary: 100
};

/** Calculate sell price for a single item */
export function calculateSellPrice(
  dbItem: { price?: number; type?: string; rarity?: string } | null | undefined,
  inventoryItem: InventoryItem | null | undefined
): number {
  if (!dbItem) return 0;
  const itemType = String(dbItem.type || inventoryItem?.type || '');
  if (NON_SELLABLE_TYPES.has(itemType)) return 0;

  const shopPrice = Number(dbItem.price || 0);
  if (shopPrice > 0) {
    return Math.max(1, Math.floor(shopPrice * SELL_RATE));
  }

  const rarity = String(dbItem.rarity || inventoryItem?.rarity || 'common');
  const floorPrice = SELL_FLOOR_BY_RARITY[rarity as keyof typeof SELL_FLOOR_BY_RARITY];
  return Number(floorPrice ?? SELL_FLOOR_BY_RARITY['common']);
}

/** Add item to inventory with stacking */
export function addItemToInventory(
  inventory: InventoryItem[],
  newItem: InventoryItem,
  dbItem?: { stackable?: boolean; max_stack?: number; type?: string; category?: string; slot?: string } | null
): number {
  if (!Array.isArray(inventory) || !newItem) return 0;

  const type = String(newItem.type || dbItem?.type || '').toLowerCase();
  const category = String(newItem.category || dbItem?.category || type).toLowerCase();

  const EQUIPMENT_TYPES = new Set([
    'weapon', 'armor', 'helmet', 'body', 'head',
    'hands', 'legs', 'boots', 'accessory', 'equipment'
  ]);

  const isEquipment = Boolean(newItem.slot || dbItem?.slot)
    || EQUIPMENT_TYPES.has(type)
    || EQUIPMENT_TYPES.has(category);
  const stackable = dbItem ? dbItem.stackable !== false : true;

  const maxStack = Math.max(1, Number(dbItem?.max_stack || 99));
  const quantity = Math.max(1, Number(newItem.quantity || 1));

  let remaining = quantity;

  if (stackable && !isEquipment && type !== 'key' && !newItem.upgrade_level) {
    for (let i = 0; i < inventory.length && remaining > 0; i++) {
      const existing = inventory[i];
      if (!existing || existing.id !== newItem.id) continue;
      if (existing.rarity !== newItem.rarity) continue;
      if (Number(existing.upgrade_level || 0) !== 0) continue;

      const currentQty = Math.max(0, Number(existing.quantity || 1));
      if (currentQty >= maxStack) continue;

      const toAdd = Math.min(maxStack - currentQty, remaining);
      inventory[i] = { ...existing, quantity: currentQty + toAdd };
      remaining -= toAdd;
    }
  }

  let slotsAdded = 0;
  while (remaining > 0) {
    const chunk = Math.min(maxStack, remaining);
    inventory.push({ ...newItem, quantity: chunk });
    remaining -= chunk;
    slotsAdded++;
  }

  return slotsAdded;
}

/** Total inventory count across all stacks */
export function getTotalInventoryCount(inventory: InventoryItem[]): number {
  return inventory.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)), 0);
}

/** Check if inventory is full */
export function isInventoryFull(inventory: InventoryItem[]): boolean {
  return inventory.length >= MAX_INVENTORY_SLOTS;
}

/** Sell all sellable items from inventory */
export function calculateTotalSellValue(
  inventory: InventoryItem[],
  dbItems: Map<number, { price?: number; type?: string; rarity?: string }>
): { totalValue: number; soldCount: number; unsellableCount: number } {
  let totalValue = 0;
  let soldCount = 0;
  let unsellableCount = 0;

  for (const item of inventory) {
    const dbItem = dbItems.get(Number(item.id));
    const price = calculateSellPrice(dbItem || null, item);
    if (price <= 0) {
      unsellableCount++;
      continue;
    }
    totalValue += price * Math.max(1, Number(item.quantity || 1));
    soldCount++;
  }

  return { totalValue, soldCount, unsellableCount };
}
