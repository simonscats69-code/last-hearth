// packages/core/src/config.ts
// Centralized game configuration - single source of truth for client and server

/** Game configuration constants */
export const GAME_CONFIG = Object.freeze({
  // Drop chances
  BASE_DROP_CHANCE: 8,
  MAX_DROP_CHANCE: 60,
  MAX_LUCK: 150,

  // Regeneration
  ENERGY_REGEN_INTERVAL_MS: 60 * 1000,
  HEALTH_REGEN_INTERVAL_MS: 90 * 1000,
  HEALTH_REGEN_CAP_RATIO: 0.6,
  DEFAULT_AUTO_HEAL_THRESHOLD: 35,
  AUTO_HEAL_THRESHOLD_MIN: 10,
  AUTO_HEAL_THRESHOLD_MAX: 90,

  // Wear and repair
  WEAR_PER_HIT: 0.5,
  REPAIR_COST_MULTIPLIER: 0.4,
  UPGRADE_COST_MULTIPLIER: 0.8,
  BASE_DURABILITY: 500,

  // Prices
  BASE_PRICE_BY_RARITY: Object.freeze({
    common: 50,
    uncommon: 200,
    rare: 800,
    epic: 5000,
    legendary: 50000,
  }),

  // Coin drops
  COIN_DROP_CHANCE: 30,
  BASE_COIN_AMOUNT: 50,
  MAX_COIN_AMOUNT: 500,
  RISK_MULTIPLIERS: Object.freeze({
    safe: 1.0,
    warning: 1.5,
    danger: 2.0,
    deadly: 3.0,
  }),
});

export type GameConfig = typeof GAME_CONFIG;

// Re-export constants for convenience
export const {
  BASE_DROP_CHANCE,
  MAX_DROP_CHANCE,
  MAX_LUCK,
  ENERGY_REGEN_INTERVAL_MS,
  HEALTH_REGEN_INTERVAL_MS,
  HEALTH_REGEN_CAP_RATIO,
  DEFAULT_AUTO_HEAL_THRESHOLD,
  AUTO_HEAL_THRESHOLD_MIN,
  AUTO_HEAL_THRESHOLD_MAX,
  WEAR_PER_HIT,
  REPAIR_COST_MULTIPLIER,
  UPGRADE_COST_MULTIPLIER,
  BASE_DURABILITY,
  BASE_PRICE_BY_RARITY,
  COIN_DROP_CHANCE,
  BASE_COIN_AMOUNT,
  MAX_COIN_AMOUNT,
  RISK_MULTIPLIERS,
} = GAME_CONFIG;
