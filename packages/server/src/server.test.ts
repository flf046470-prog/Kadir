import { describe, expect, it, beforeEach } from 'vitest';
import { MemorySaveStore, buildJungleWorld, createIntent, Buttons, registerStoreItems } from '@kc/core';
import type { PlayerSnapshot, PlayerState } from '@kc/core';
import { SlotTable, decodeSnapshot, encodeIntent } from '@kc/net';
import type { ServerMessage } from '@kc/net';
import { AccountService } from './accounts.js';
import { Leaderboard } from './leaderboard.js';
import { MemoryLeaderboardStore } from './leaderboard-store.js';
import { RoomManager } from './rooms.js';
import { Room, reportLog } from './room.js';
import type { ClientSocket } from './room.js';
import { DevReceiptVerifier, PurchaseService } from './purchases.js';
import type { ServerConfig } from './config.js';

const level = buildJungleWorld();

function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    tickRate: 60,
    snapshotRate: 20,
    maxRooms: 10,
    maxPlayersPerRoom: 4,
    dataDir: 'data-test',
    sessionSecret: 'test-secret',
    clientTimeoutSeconds: 30,
    messageRateLimit: 90,
    allowedOrigins: [],
    publicDir: 'dist/client',
    stores: { metaAppId: '', metaAppSecret: '', steamAppId: '', steamWebApiKey: '', playPackageName: '' },
    allowDevPurchases: true,
    databaseUrl: '',
    ...overrides,
  };
}

class FakeSocket implements ClientSocket {
  json: ServerMessage[] = [];
  binary: Uint8Array[] = [];
  closed: { code?: number; reason?: string } | null = null;

  sendJson(message: ServerMessage): void {
    this.json.push(message);
  }

  sendBinary(data: Uint8Array): void {
    this.binary.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  last<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) {
      const message = this.json[i];
      if (message?.t === type) return message as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
}

async function makeHarness(config = testConfig()) {
  const store = new MemorySaveStore();
  const accounts = new AccountService(store, config.sessionSecret);
  const leaderboard = new Leaderboard(new MemoryLeaderboardStore());
  const rooms = new RoomManager(config, accounts, leaderboard);
  return { store, accounts, leaderboard, rooms, config };
}

async function joinPlayer(accounts: AccountService, room: Room, id: string, platform: 'pc' | 'mobile' | 'vr' = 'pc') {
  const profile = await accounts.loadOrCreate(id, id);
  const socket = new FakeSocket();
  room.join(socket, profile, platform, {}, true);
  return { socket, profile };
}

describe('AccountService', () => {
  it('issues and verifies session tokens', async () => {
    const { accounts } = await makeHarness();
    const guest = await accounts.createGuest('Roo');
    expect(accounts.verifyToken(guest.token)).toBe(guest.playerId);
    expect(accounts.verifyToken('garbage')).toBeNull();
    expect(accounts.verifyToken(`${guest.playerId}.1.badsig`)).toBeNull();
  });

  it('rejects expired and tampered tokens', async () => {
    const { accounts } = await makeHarness();
    const token = accounts.issueToken('p1', Date.now() - 40 * 24 * 3600 * 1000);
    expect(accounts.verifyToken(token)).toBeNull();

    const valid = accounts.issueToken('p1');
    const parts = valid.split('.');
    const tampered = `p2.${parts[1]}.${parts[2]}`;
    expect(accounts.verifyToken(tampered)).toBeNull();
  });
});

describe('matchmaking', () => {
  it('creates a public room and fills it before opening another', async () => {
    const { rooms, accounts } = await makeHarness(testConfig({ maxPlayersPerRoom: 2 }));
    const first = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;
    await joinPlayer(accounts, first, 'a');
    const second = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;
    expect(second.code).toBe(first.code);

    await joinPlayer(accounts, second, 'b');
    const third = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;
    expect(third.code).not.toBe(first.code);
  });

  it('supports private rooms joined by code', async () => {
    const { rooms, accounts } = await makeHarness();
    const priv = rooms.matchmake({ modeId: 'infection', createPrivate: true }).room as Room;
    expect(priv.isPrivate).toBe(true);
    expect(priv.code).toMatch(/^KANG-[2-9A-HJ-NP-Z]{4}$/);

    await joinPlayer(accounts, priv, 'host');
    const joined = rooms.matchmake({ roomCode: priv.code });
    expect(joined.room?.code).toBe(priv.code);

    // Private rooms are never handed out by matchmaking.
    const publicMatch = rooms.matchmake({ modeId: 'infection' }).room as Room;
    expect(publicMatch.code).not.toBe(priv.code);
  });

  it('reports useful errors for bad codes', async () => {
    const { rooms } = await makeHarness();
    expect(rooms.matchmake({ roomCode: 'nope' }).error).toBe('bad-code');
    expect(rooms.matchmake({ roomCode: 'KANG-2345' }).error).toBe('not-found');
    expect(rooms.matchmake({ modeId: 'does-not-exist' }).error).toBe('unknown-mode');
  });

  it('refuses to exceed the room cap', async () => {
    const { rooms, accounts } = await makeHarness(testConfig({ maxRooms: 1, maxPlayersPerRoom: 1 }));
    const room = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;
    await joinPlayer(accounts, room, 'a');
    expect(rooms.matchmake({ modeId: 'kangaroo-chase' }).error).toBe('no-capacity');
  });
});

describe('Room', () => {
  let harness: Awaited<ReturnType<typeof makeHarness>>;
  let room: Room;

  beforeEach(async () => {
    harness = await makeHarness();
    room = harness.rooms.createRoom('kangaroo-chase', false);
  });

  it('welcomes a joining player with everything needed to build the world', async () => {
    const { socket } = await joinPlayer(harness.accounts, room, 'a');
    const welcome = socket.last('welcome');
    expect(welcome?.levelId).toBe(level.id);
    expect(welcome?.levelSeed).toBe(level.seed);
    expect(welcome?.levelFingerprint).toBeTruthy();
    expect(welcome?.tickRate).toBe(60);
    expect(welcome?.slots.length).toBe(1);
  });

  it('tells existing players about a new arrival', async () => {
    const a = await joinPlayer(harness.accounts, room, 'a');
    await joinPlayer(harness.accounts, room, 'b', 'vr');
    expect(a.socket.last('joined')?.player.id).toBe('b');
    expect(a.socket.last('joined')?.player.platform).toBe('vr');
    expect(a.socket.last('room')?.playerCount).toBe(2);
  });

  it('broadcasts decodable snapshots at the snapshot rate', async () => {
    const { socket } = await joinPlayer(harness.accounts, room, 'a');
    for (let i = 0; i < 60; i++) room.tick();
    expect(socket.binary.length).toBe(20); // 60 ticks / 3-tick interval

    const slots = new SlotTable();
    slots.assign('a');
    const decoded = decodeSnapshot(socket.binary[0] as Uint8Array, slots, new Map());
    expect(decoded.players).toHaveLength(1);
    expect(Number.isFinite((decoded.players[0] as PlayerSnapshot).x)).toBe(true);
  });

  it('applies binary intents from clients to the simulation', async () => {
    await joinPlayer(harness.accounts, room, 'a');
    const player = room.playerState('a') as PlayerState;
    for (let i = 0; i < 30; i++) room.tick();
    const startZ = player.position.z;

    const intent = createIntent();
    intent.moveZ = 1;
    intent.buttons = Buttons.Sprint;
    for (let i = 0; i < 60; i++) {
      room.handleIntent('a', encodeIntent(intent));
      room.tick();
    }
    expect(player.position.z).toBeGreaterThan(startZ + 1);
  });

  it('ignores malformed intent frames without dropping the client', async () => {
    const { socket } = await joinPlayer(harness.accounts, room, 'a');
    room.handleIntent('a', new Uint8Array([9, 9, 9]));
    room.tick();
    expect(socket.closed).toBeNull();
  });

  it('relays chat but respects mutes and blocks', async () => {
    await joinPlayer(harness.accounts, room, 'a');
    const b = await joinPlayer(harness.accounts, room, 'b');
    room.handleChat('a', 'hello jungle');
    expect(b.socket.last('chat')?.text).toBe('hello jungle');

    room.handleModeration('b', 'block', 'a');
    b.socket.json.length = 0;
    room.handleChat('a', 'still here?');
    expect(b.socket.last('chat')).toBeUndefined();
    expect(b.profile.blockedPlayerIds).toContain('a');
  });

  it('relays voice signalling without inspecting it, and not between blocked players', async () => {
    const a = await joinPlayer(harness.accounts, room, 'a');
    const b = await joinPlayer(harness.accounts, room, 'b');
    room.handleVoiceSignal('a', 'b', 'sdp-payload', 'offer');
    expect(b.socket.last('voice')?.payload).toBe('sdp-payload');
    expect(b.socket.last('voice')?.fromId).toBe('a');

    room.handleModeration('b', 'block', 'a');
    b.socket.json.length = 0;
    room.handleVoiceSignal('a', 'b', 'sdp-2', 'offer');
    expect(b.socket.last('voice')).toBeUndefined();
    expect(a.socket.closed).toBeNull();
  });

  it('rate limits reports', async () => {
    await joinPlayer(harness.accounts, room, 'a');
    await joinPlayer(harness.accounts, room, 'b');
    reportLog.length = 0;
    expect(room.handleReport('a', 'b', 'griefing')).toBe(true);
    expect(room.handleReport('a', 'b', 'griefing')).toBe(false); // cooldown
    expect(reportLog).toHaveLength(1);
  });

  it('cleans up when a player leaves', async () => {
    const a = await joinPlayer(harness.accounts, room, 'a');
    await joinPlayer(harness.accounts, room, 'b');
    room.leave('b');
    expect(room.playerCount).toBe(1);
    expect(a.socket.last('left')?.playerId).toBe('b');
    expect(room.playerState('b')).toBeUndefined();
  });

  it('counts mode votes and rotates on the next round', async () => {
    await joinPlayer(harness.accounts, room, 'a');
    await joinPlayer(harness.accounts, room, 'b');
    room.handleVote('a', 'parkour');
    room.handleVote('b', 'parkour');
    room.startNextRound();
    expect(room.currentModeId).toBe('parkour');
    expect(room.playerCount).toBe(2);
  });
});

describe('server-authoritative progression', () => {
  it('pays out a finished round and persists it', async () => {
    const harness = await makeHarness();
    const room = harness.rooms.createRoom('parkour', false);
    const racer = await joinPlayer(harness.accounts, room, 'racer');
    const coinsBefore = racer.profile.coins;

    // Run the countdown, then walk the racer through every checkpoint.
    for (let i = 0; i < 60 * 6; i++) room.tick();
    const player = room.playerState('racer') as PlayerState;
    for (const cp of level.checkpoints) {
      player.position.x = cp.position.x;
      player.position.y = cp.position.y + 0.2;
      player.position.z = cp.position.z;
      player.velocity.x = 0;
      player.velocity.y = 0;
      player.velocity.z = 0;
      room.tick();
      room.tick();
    }
    room.tick();

    await new Promise((resolve) => setTimeout(resolve, 10));
    const results = racer.socket.last('results');
    expect(results?.result.modeId).toBe('parkour');
    expect(results?.rewards.racer?.coins).toBeGreaterThan(0);
    expect(racer.profile.coins).toBeGreaterThan(coinsBefore);
    expect(racer.profile.stats.parkourFinishes).toBe(1);

    // The lap made the leaderboard, submitted by the room and never by the client.
    expect((await harness.leaderboard.best(level.id))?.playerId).toBe('racer');

    const persisted = await harness.store.load('racer');
    expect(persisted?.coins).toBe(racer.profile.coins);
  });
});

describe('purchases', () => {
  /**
   * Nothing is sold any more, so this exercises the verifier against a catalog entry registered
   * for the test. The machinery is worth keeping correct: an unverified grant path is expensive
   * to add back safely, and an empty shelf is one line to reverse.
   */
  it('grants only against a verified receipt', async () => {
    registerStoreItems([
      { id: 'test_grant', kind: 'bundle', name: 'Test', description: '', priceCents: 0, priceCoins: 0, grants: ['coins:250'] },
    ]);
    const harness = await makeHarness();
    const purchases = new PurchaseService(new DevReceiptVerifier(true));
    const profile = await harness.accounts.loadOrCreate('buyer', 'Buyer');
    const before = profile.coins;

    const bad = await purchases.purchase(profile, 'test_grant', 'forged');
    expect(bad.ok).toBe(false);
    expect(profile.coins).toBe(before);

    const good = await purchases.purchase(profile, 'test_grant', 'dev:test_grant:1');
    expect(good.ok).toBe(true);
    expect(profile.coins).toBe(before + 250);

    // Replaying the same receipt grants nothing further.
    const replay = await purchases.purchase(profile, 'test_grant', 'dev:test_grant:1');
    expect(replay.granted).toEqual([]);
    expect(profile.coins).toBe(before + 250);
    expect(profile.purchases).toHaveLength(1);
  });

  it('refuses every receipt when the dev verifier is disabled (production posture)', async () => {
    registerStoreItems([
      { id: 'test_prod', kind: 'bundle', name: 'Test', description: '', priceCents: 0, priceCoins: 0, grants: ['coins:250'] },
    ]);
    const harness = await makeHarness();
    const purchases = new PurchaseService(new DevReceiptVerifier(false));
    const profile = await harness.accounts.loadOrCreate('buyer', 'Buyer');
    const before = profile.coins;

    const outcome = await purchases.purchase(profile, 'test_prod', 'dev:test_prod:1');

    expect(outcome.ok).toBe(false);
    expect(profile.coins).toBe(before);
  });
});

describe('leaderboard', () => {
  it('keeps only improvements and ranks by time', async () => {
    const board = new Leaderboard(new MemoryLeaderboardStore());
    expect(await board.submit('jungle-world', { playerId: 'a', name: 'A', animalId: 'kangaroo', ticks: 6000, at: 1 })).toBe(1);
    expect(await board.submit('jungle-world', { playerId: 'b', name: 'B', animalId: 'fox', ticks: 5000, at: 2 })).toBe(1);
    expect(await board.submit('jungle-world', { playerId: 'a', name: 'A', animalId: 'kangaroo', ticks: 7000, at: 3 })).toBe(-1);
    expect(await board.submit('jungle-world', { playerId: 'a', name: 'A', animalId: 'kangaroo', ticks: 4000, at: 4 })).toBe(1);
    expect((await board.top('jungle-world')).map((e) => e.playerId)).toEqual(['a', 'b']);
    expect(await board.submit('jungle-world', { playerId: 'c', name: 'C', animalId: 'fox', ticks: -5, at: 5 })).toBe(-1);
  });
});
