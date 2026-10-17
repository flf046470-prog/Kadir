import { createHmac } from 'node:crypto';
import type { IceServerConfig } from '@kc/net';

/**
 * The ICE servers each client's voice chat uses, handed out in `welcome`.
 *
 * STUN alone cannot connect two players who are both behind symmetric NAT — most mobile carriers
 * and many office and campus networks — so for them voice fails in silence. A TURN relay fixes it,
 * and a TURN relay is infrastructure that costs money to run, so it is configured rather than
 * built in:
 *
 * - `KC_ICE_SERVERS` — a JSON array of `RTCIceServer`s, served as is (a STUN list, or a TURN
 *   service with a fixed credential).
 * - `KC_TURN_URLS` + `KC_TURN_SECRET` — coturn's `use-auth-secret` REST scheme: each player gets a
 *   username of `<expiry>:<playerId>` and a credential of `base64(HMAC-SHA1(secret, username))`,
 *   so the long-lived secret never leaves the server and a leaked credential expires on its own
 *   (`KC_TURN_TTL`, seconds, default 12 h).
 *
 * With neither set the client keeps its STUN default, which is what it did before.
 */
export interface IceConfig {
  servers: IceServerConfig[];
  turnUrls: string[];
  turnSecret: string;
  turnTtlSeconds: number;
}

export function parseIceConfig(env: Record<string, string | undefined>): IceConfig {
  let servers: IceServerConfig[] = [];
  const raw = env.KC_ICE_SERVERS ?? '';
  if (raw.trim()) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('KC_ICE_SERVERS must be a JSON array of RTCIceServer objects');
    servers = parsed.filter(isIceServer);
    if (servers.length !== parsed.length) throw new Error('KC_ICE_SERVERS has an entry without a string `urls`');
  }
  const turnUrls = (env.KC_TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const turnSecret = env.KC_TURN_SECRET ?? '';
  if (turnUrls.length > 0 && !turnSecret) throw new Error('KC_TURN_URLS is set without KC_TURN_SECRET');
  const ttl = Number.parseInt(env.KC_TURN_TTL ?? '', 10);
  return { servers, turnUrls, turnSecret, turnTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : 12 * 3600 };
}

function isIceServer(value: unknown): value is IceServerConfig {
  if (!value || typeof value !== 'object') return false;
  const urls = (value as { urls?: unknown }).urls;
  return typeof urls === 'string' || (Array.isArray(urls) && urls.every((u) => typeof u === 'string'));
}

/** The list one player is sent. Empty means "use your default". */
export function iceServersFor(config: IceConfig, playerId: string, nowSeconds = Math.floor(Date.now() / 1000)): IceServerConfig[] {
  const list = [...config.servers];
  if (config.turnUrls.length > 0 && config.turnSecret) {
    const username = `${nowSeconds + config.turnTtlSeconds}:${playerId}`;
    const credential = createHmac('sha1', config.turnSecret).update(username).digest('base64');
    list.push({ urls: config.turnUrls, username, credential });
  }
  return list;
}
