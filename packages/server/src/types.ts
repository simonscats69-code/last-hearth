// packages/server/src/types.ts
// Server-specific type definitions

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface AuthenticatedRequest {
  playerId: number;
  telegramId: number;
  username?: string;
}

export interface RouteContext {
  playerId: number;
  db: import('pg').Pool;
}

export interface BossFightState {
  bossId: number;
  playerId: number;
  bossHealth: number;
  bossMaxHealth: number;
  playerHealth: number;
  playerMaxHealth: number;
  startedAt: Date;
  mode: string;
}

export interface PvPResult {
  winnerId: number;
  loserId: number;
  isDraw: boolean;
  damageDealt: number;
  damageTaken: number;
  ratingChange: number;
}
