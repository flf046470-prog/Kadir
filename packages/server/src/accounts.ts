import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PlayerProfile, SaveStore } from '@kc/core';
import { createProfile, sanitizeName } from '@kc/core';

/**
 * Minimal account service.
 *
 * A session token is `playerId.expiry.signature`. It is not an identity provider — it exists so
 * that the *server* decides which profile a socket may touch, and so a client can never claim
 * someone else's inventory by sending a different id. Swapping in a real IdP later means
 * replacing `verifyToken` only.
 */
export class AccountService {
  constructor(
    private readonly store: SaveStore,
    private readonly secret: string,
    private readonly ttlMs = 30 * 24 * 3600 * 1000,
  ) {}

  issueToken(playerId: string, now = Date.now()): string {
    const expiry = now + this.ttlMs;
    const payload = `${playerId}.${expiry}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verifyToken(token: string, now = Date.now()): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [playerId, expiryRaw, signature] = parts as [string, string, string];
    const expiry = Number.parseInt(expiryRaw, 10);
    if (!Number.isFinite(expiry) || expiry < now) return null;
    const expected = this.sign(`${playerId}.${expiryRaw}`);
    if (!safeEqual(expected, signature)) return null;
    return playerId;
  }

  /** Create a fresh guest account. Guests are real profiles; nothing is lost if they upgrade. */
  async createGuest(name: string): Promise<{ playerId: string; token: string; profile: PlayerProfile }> {
    const playerId = `g_${randomBytes(9).toString('base64url')}`;
    const profile = createProfile(playerId, sanitizeName(name));
    await this.store.save(profile);
    return { playerId, token: this.issueToken(playerId), profile };
  }

  async loadOrCreate(playerId: string, name = 'Roo'): Promise<PlayerProfile> {
    const existing = await this.store.load(playerId);
    if (existing) return existing;
    const profile = createProfile(playerId, sanitizeName(name));
    await this.store.save(profile);
    return profile;
  }

  save(profile: PlayerProfile): Promise<void> {
    return this.store.save(profile);
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
