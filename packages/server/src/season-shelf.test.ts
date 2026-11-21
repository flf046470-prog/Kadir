import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { MemorySaveStore, SEASON_SHELF } from '@kc/core';
import type { ServerMessage } from '@kc/net';
import type { EventProgress } from '@kc/core';
import { AccountService } from './accounts.js';
import { createHttpHandler } from './http.js';
import { Leaderboard } from './leaderboard.js';
import { MemoryLeaderboardStore } from './leaderboard-store.js';
import { DevReceiptVerifier, PurchaseService } from './purchases.js';
import type { ClientSocket } from './room.js';
import { RoomManager } from './rooms.js';
import type { ServerConfig } from './config.js';

const CONFIG = {
  port: 0,
  host: '127.0.0.1',
  tickRate: 60,
  snapshotRate: 20,
  maxRooms: 20,
  maxPlayersPerRoom: 8,
  dataDir: 'data-test',
  sessionSecret: 'shelf-secret',
  clientTimeoutSeconds: 30,
  messageRateLimit: 90,
  allowedOrigins: [],
  onlineOrigin: '',
  publicDir: 'dist/client',
  assetLinksFile: '',
  stores: { metaAppId: '', metaAppSecret: '', steamAppId: '', steamWebApiKey: '', playPackageName: '' },
  allowDevPurchases: false,
  databaseUrl: '',
  ice: { servers: [], turnUrls: [], turnSecret: '', turnTtlSeconds: 43200 },
  moderators: new Set<string>(),
} as ServerConfig;

const socket = (): ClientSocket & { json: ServerMessage[] } => {
  const json: ServerMessage[] = [];
  return { json, sendJson: (m) => json.push(m), sendBinary() {}, close() {} };
};

async function server() {
  const accounts = new AccountService(new MemorySaveStore(), 'x');
  const leaderboard = new Leaderboard(new MemoryLeaderboardStore());
  const rooms = new RoomManager(CONFIG, accounts, leaderboard);
  const handler = createHttpHandler({ config: CONFIG, accounts, rooms, leaderboard, purchases: new PurchaseService(new DevReceiptVerifier(false)) });
  const http = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const call = async (token: string, path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const get = async (token: string, path: string) => {
    const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { accounts, rooms, call, get, close: () => http.close() };
}

/** What everyone else in the room is told this player is wearing. */
function shownWearing(playerId: string, watcher: ReturnType<typeof socket>): Record<string, string> | undefined {
  const welcome = [...watcher.json].reverse().find((m) => m.t === 'welcome' || m.t === 'joined');
  if (welcome?.t === 'joined' && welcome.player.id === playerId) return welcome.player.cosmetics;
  if (welcome?.t === 'welcome') return welcome.players.find((p) => p.id === playerId)?.cosmetics;
  return undefined;
}

describe('a season cosmetic is earned before it is worn', () => {
  const propeller = SEASON_SHELF.find((item) => item.grants.includes('hat_propeller'))!;

  it('is not shown on a player who only claims to wear it', async () => {
    const s = await server();
    const cheat = await s.accounts.createGuest('Cheat');
    const watcher = socket();
    const room = s.rooms.matchmake({ playerId: 'watcher' }).room!;
    room.join(watcher, await s.accounts.loadOrCreate('watcher', 'Watcher'), 'pc', {}, true);
    // The hello's cosmetics are the client's word; a fresh account owns no season cosmetic.
    room.join(socket(), await s.accounts.loadOrCreate(cheat.playerId), 'pc', { hat: 'hat_propeller', glasses: 'glasses_round' }, true);
    expect(shownWearing(cheat.playerId, watcher)).toEqual({ glasses: 'glasses_round' });
    s.close();
  });

  it('is bought with coins won in play, then equipped and shown', async () => {
    const s = await server();
    const player = await s.accounts.createGuest('Earner');
    // Too poor: a new account starts with 250.
    const poor = await s.call(player.token, '/api/purchase/coins', { itemId: propeller.id });
    expect(poor.status).toBe(400);
    expect(poor.body.error).toBe('insufficient-coins');
    expect((await s.call(player.token, '/api/equip', { slot: 'hat', cosmeticId: 'hat_propeller' })).status).toBe(400);

    const profile = await s.accounts.loadOrCreate(player.playerId);
    profile.coins = propeller.priceCoins + 100;
    await s.accounts.save(profile);
    const bought = await s.call(player.token, '/api/purchase/coins', { itemId: propeller.id });
    expect(bought.status).toBe(200);
    expect(bought.body.coins).toBe(100);
    expect(bought.body.ownedCosmetics).toContain('hat_propeller');
    // Twice is refused rather than charged twice.
    expect((await s.call(player.token, '/api/purchase/coins', { itemId: propeller.id })).body.error).toBe('already-owned');
    expect((await s.call(player.token, '/api/equip', { slot: 'hat', cosmeticId: 'hat_propeller' })).status).toBe(200);

    const watcher = socket();
    const room = s.rooms.matchmake({ playerId: 'watcher' }).room!;
    room.join(watcher, await s.accounts.loadOrCreate('watcher', 'Watcher'), 'pc', {}, true);
    room.join(socket(), await s.accounts.loadOrCreate(player.playerId), 'pc', { hat: 'hat_propeller' }, true);
    expect(shownWearing(player.playerId, watcher)).toEqual({ hat: 'hat_propeller' });
    s.close();
  });

  it('refuses a starter cosmetic for coins: there is no shelf item for it', async () => {
    const s = await server();
    const player = await s.accounts.createGuest('Shopper');
    const refused = await s.call(player.token, '/api/purchase/coins', { itemId: 'shelf_hat_crown' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('unknown-item');
    s.close();
  });
});

describe('the profile answers with the events', () => {
  it('joins a running event on opening the game, so progress starts from there', async () => {
    // Only Date is faked: the server and fetch still need real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    const s = await server();
    try {
      const player = await s.accounts.createGuest('Spooky');
      const before = await s.accounts.loadOrCreate(player.playerId);
      before.stats.climbMetres = 400; // climbed long before Halloween
      await s.accounts.save(before);

      const response = await s.get(player.token, '/api/profile');
      expect(response.status).toBe(200);
      const events = response.body.events as EventProgress[];
      expect(events.map((e) => [e.id, e.active])).toEqual([['halloween', true]]);
      expect(events[0]?.challenges.map((c) => c.value)).toEqual([0, 0]);
      // Written, not only shown: the next round counts from 400, not from whenever it is played.
      expect((await s.accounts.loadOrCreate(player.playerId)).events['halloween@2026']?.baseline.climbMetres).toBe(400);
    } finally {
      s.close();
      vi.useRealTimers();
    }
  });
});
