// utils/serverApi.d.ts
// TypeScript типизация для utils/serverApi.js (CommonJS)
// Модуль объединяет: Telegram auth, middleware, rate limiting, API ответы,
// валидацию, обработку ошибок и утилиты для игроков.

import { PoolClient } from 'pg';
import { Request, Response, NextFunction } from 'express';

/** Ошибка с кодом и статусом */
export interface ApiError extends Error {
  code?: string;
  statusCode?: number;
}

/** Результат валидации ID */
export interface ValidatedId {
  ok: boolean;
  value?: number;
  error?: string;
  code?: string;
}

/** Telegram user из initData */
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  [key: string]: unknown;
}

/** Валидированные Telegram initData */
export interface ValidatedTelegramData {
  user: TelegramUser;
  auth_date: number;
  chat_instance?: string;
  chat_type?: string;
  start_param?: string;
  raw: Record<string, string>;
  rawInitData: string;
}

/** Rate limit результат */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Rate limit опции */
export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  keyGenerator?: (req: Request) => string;
}

/** Универсальный интерфейс для запросов к БД */
export interface PlayerRecord {
  id: number;
  telegram_id: number;
  username?: string;
  coins: number;
  [key: string]: unknown;
}

/**
 * Интерфейс модуля serverApi
 */
export interface ServerApi {
  // Логирование
  logger: {
    info: (msg: unknown, ...meta: unknown[]) => void;
    warn: (msg: unknown, ...meta: unknown[]) => void;
    error: (msg: unknown, ...meta: unknown[]) => void;
    debug: (msg: unknown, ...meta: unknown[]) => void;
  };
  requestMiddleware: (req: Request, res: Response, next: NextFunction) => void;
  logPlayerAction: (playerId: number, action: string, metadata?: unknown, client?: PoolClient | null) => Promise<void>;
  logPlayerError: (playerId: number, error: Error, context?: Record<string, unknown>) => void;

  // Валидация
  validateId: (value: unknown, fieldName?: string) => ValidatedId;
  sanitizeName: (name: unknown, maxLength?: number) => { valid: boolean; error?: string; code?: string; value?: string };

  // Ответы API
  ok: (res: Response, data: unknown, statusCode?: number) => Response;
  fail: (res: Response, message: string, code?: string, statusCode?: number) => Response;
  error: (res: Response, message: string, code?: string, statusCode?: number) => Response;
  notFound: (res: Response, message?: string, code?: string) => Response;
  unauthorized: (res: Response, message?: string, code?: string) => Response;
  wrap: (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
  handleError: (res: Response, error: unknown, action?: string) => Response;

  // JSON утилиты
  serializeJSONField: (value: unknown) => string;
  safeStringify: (obj: unknown, space?: number) => string;
  safeJsonParse: <T = unknown>(str: unknown, defaultValue?: T) => T;
  getTelegramIdFromHeaders: (headers?: Record<string, unknown>) => string | null;

  // Транзакции с блокировкой
  withPlayerLock: <T>(playerId: number, fn: (client: PoolClient, player: PlayerRecord) => Promise<T>, timeoutMs?: number) => Promise<T>;

  // Утилиты игроков
  getPlayerByTelegramId: (telegramId: string | number) => Promise<PlayerRecord | null>;

  // Telegram авторизация
  validateTelegramInitData: (initData: string, botToken: string) => ValidatedTelegramData | null;
  telegramAuthMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;

  // Идемпотентность
  idempotencyMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;

  // Rate limiting
  checkRateLimit: (identifier: string, maxRequests?: number, windowMs?: number) => Promise<RateLimitResult>;
  createRateLimitMiddleware: (options?: RateLimitOptions) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

  // Ошибки
  ERROR_MESSAGES: Record<string, string>;

  // PlayerHelper
  PlayerHelper: {
    addExperience: (playerId: number, exp: number, client?: PoolClient | null) => Promise<unknown>;
  };
}

declare const serverApi: ServerApi;
export = serverApi;
