// packages/core/src/formulas.ts
// Game formulas shared between client and server

import {
  Rarity,
  RARITY_ORDER,
  BASE_PRICE_BY_RARITY,
  MAX_INVENTORY_SLOTS
} from './types';
import { GAME_CONFIG } from './config';

/** Drop chance based on luck */
export function calculateDropChance(luck: number): number {
  if (luck <= 0) return 5;
  const chance = 10 + (luck * 0.4);
  return Math.min(GAME_CONFIG.MAX_DROP_CHANCE, Math.round(chance * 10) / 10);
}

/** Coin drop calculation */
export function calculateCoinDrop(options: {
  riskTier?: string;
  luck?: number;
  playerLevel?: number;
} = {}): { amount: number } | null {
  const { riskTier = 'safe', luck = 0, playerLevel = 1 } = options;

  const roll = Math.random() * 100;
  if (roll > GAME_CONFIG.COIN_DROP_CHANCE) {
    return null;
  }

  const riskMultipliers: Record<string, number> = {
    safe: 1.0,
    warning: 1.5,
    danger: 2.0,
    deadly: 3.0
  };

  const riskMultiplier = riskMultipliers[riskTier] || 1.0;
  const luckMultiplier = 1 + (luck * 0.01);
  const levelMultiplier = 1 + (playerLevel * 0.05);

  const amount = Math.floor(
    GAME_CONFIG.BASE_COIN_AMOUNT * riskMultiplier * luckMultiplier * levelMultiplier
  );
  const finalAmount = Math.min(GAME_CONFIG.MAX_COIN_AMOUNT, Math.max(1, amount));

  return { amount: finalAmount };
}

/** Rarity color for UI */
export function getRarityColor(rarity: Rarity | undefined): string {
  const colors: Record<Rarity, string> = {
    common: '#9ca3af',
    uncommon: '#22c55e',
    rare: '#3b82f6',
    epic: '#a855f7',
    legendary: '#f59e0b',
  };
  return colors[rarity || 'common'];
}

/** Rarity sort index */
export function getRaritySortIndex(rarity: Rarity | undefined): number {
  return RARITY_ORDER.indexOf(rarity || 'common');
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Format number with suffix (K, M, B) */
export function formatNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

/** Calculate percentage */
export function percentage(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map value from one range to another */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}
