import { env } from 'node:process';

export interface ServerConfig {
  port: number;
  host: string;
  /** Simulation ticks per second. Must match the client. */
  tickRate: number;
  snapshotRate: number;
  maxRooms: number;
  maxPlayersPerRoom: number;
  /** Where player profiles are persisted. */
  dataDir: string;
  /** Secret used to sign session tokens. MUST be set in production. */
  sessionSecret: string;
  /** Seconds without an intent before a client is dropped. */
  clientTimeoutSeconds: number;
  /** Messages per second a single connection may send before being throttled. */
  messageRateLimit: number;
  /** Allow the built-in dev origin check to be relaxed locally. */
  allowedOrigins: string[];
  publicDir: string;
}

function int(name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig(): ServerConfig {
  const secret = env.KC_SESSION_SECRET ?? '';
  if (!secret && env.NODE_ENV === 'production') {
    throw new Error('KC_SESSION_SECRET must be set in production');
  }
  return {
    port: int('PORT', 8787),
    host: env.HOST ?? '0.0.0.0',
    tickRate: int('KC_TICK_RATE', 60),
    snapshotRate: int('KC_SNAPSHOT_RATE', 20),
    maxRooms: int('KC_MAX_ROOMS', 200),
    maxPlayersPerRoom: int('KC_MAX_PLAYERS', 16),
    dataDir: env.KC_DATA_DIR ?? 'data',
    sessionSecret: secret || 'dev-only-insecure-secret',
    clientTimeoutSeconds: int('KC_CLIENT_TIMEOUT', 30),
    messageRateLimit: int('KC_MSG_RATE', 90),
    allowedOrigins: (env.KC_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    publicDir: env.KC_PUBLIC_DIR ?? 'dist/client',
  };
}
