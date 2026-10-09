// packages/core/src/index.ts
// Main entry point for @last-hearth/core

export * from './equipment-rules';
export * from './economy';
export * from './types';
export * from './formulas';

export { GAME_CONFIG } from './config';
export type { GameConfig } from './config';

export {
  MAX_UPGRADE_LEVEL,
  MAX_INVENTORY_SLOTS,
} from './types';