import { describe, expect, it } from 'vitest';
import {
  MemorySaveStore,
  buildJungleWorld,
  createIntent,
  Bot,
  getStoreItem,
} from '@kc/core';
import type { PlayerState } from '@kc/core';
import { SlotTable, decodeSnapshot, encodeIntent } from '@kc/net';
import type { ServerMessage } from '@kc/net';
import { AccountService } from './accounts.js';
import { Leaderboard } from './leaderboard.js';
import { RoomManager } from './rooms.js';
import { Room } from './room.js';
import type { ClientSocket } from './room.js';
import { DevReceiptVerifier, PurchaseService } from './purchases.js';
import type { ServerConfig } from './config.js';

const level = buildJungleWorld();

const CONFIG: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  tickRate: 60,
  snapshotRate: 20,
  maxRooms: 20,
  maxPlayersPerRoom: 8,
  dataDir: 'data-test',
  sessionSecret: 'integration-secret',
  clientTimeoutSeconds: 30,
  messageRateLimit: 90,
  allowedOrigins: [],
  publicDir: 'dist/client',
  stores: { metaAppId: '', metaAppSecret: '', steamAppId: '', steamWebApiKey: '', playPackageName: '' },
  allowDevPurchases: true,
};

class FakeSocket implements ClientSocket {
  json: ServerMessage[] = [];
  binary: Uint8Array[] = [];
  sendJson(message: ServerMessage): void {
    this.json.push(message);
  }
  sendBinary(data: Uint8Array): void {
    this.binary.push(data);
  }
  close(): void {}
  last<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) {
      const message = this.json[i];
      if (message?.t === type) return message as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
}

function harness() {
  const store = new MemorySaveStore();
  const accounts = new AccountService(store, CONFIG.sessionSecret);
  const leaderboard = new Leaderboard(CONFIG.dataDir);
  const rooms = new RoomManager(CONFIG, accounts, leaderboard);
  const purchases = new PurchaseService(new DevReceiptVerifier(true));
  return { store, accounts, leaderboard, rooms, purchases };
}

/**
 * Integration coverage for the flows a player actually walks through, exercised against the
 * real room, the real simulation and the real persistence layer — no mocks between them.
 */
describe('lobby → match → results', () => {
  it('carries a player from joining a room to being paid for the round', async () => {
    const { accounts, rooms, store } = harness();
    const room = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;

    // Two humans join through the room's public entry point.
    const sockets = new Map<string, FakeSocket>();
    for (const id of ['alice', 'bob']) {
      const profile = await accounts.loadOrCreate(id, id);
      const socket = new FakeSocket();
      sockets.set(id, socket);
      room.join(socket, profile, 'pc', {}, true);
    }
    expect(room.playerCount).toBe(2);
    expect(sockets.get('alice')?.last('welcome')?.levelId).toBe(level.id);

    // Bots drive the match through its countdown and into play, using encoded intents so the
    // whole wire path (encode → decode → sanitise → simulate) is exercised.
    const bots = ['alice', 'bob'].map((id, i) => new Bot(id, { skill: 0.8, seed: 4000 + i }));
    for (let tick = 0; tick < 60 * 20; tick++) {
      for (const bot of bots) {
        const self = room.playerState(bot.playerId);
        if (!self) continue;
        const intent = bot.think(self, roomPlayers(room), level, 1 / 60);
        intent.tick = tick;
        room.handleIntent(bot.playerId, encodeIntent(intent));
      }
      room.tick();
    }

    expect(room.simulation.mode.state().phase).toBe('playing');
    const roles = ['alice', 'bob'].map((id) => room.playerState(id)?.role);
    expect(roles).toContain('chaser');
    expect(roles).toContain('runner');

    // Snapshots decode on the client side with the server's own slot numbering.
    const welcome = sockets.get('alice')?.last('welcome');
    const slots = new SlotTable();
    for (const [id, slot] of welcome?.slots ?? []) slots.setSlot(id, slot);
    const frames = sockets.get('alice')?.binary ?? [];
    expect(frames.length).toBeGreaterThan(300);
    const decoded = decodeSnapshot(frames[0] as Uint8Array, slots, new Map());
    expect(decoded.players.length).toBeGreaterThan(0);

    // End the round early and confirm payout + persistence.
    room.simulation.endRound('test');
    room.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const results = sockets.get('alice')?.last('results');
    expect(results).toBeDefined();
    expect(results?.result.players).toHaveLength(2);
    expect(results?.rewards.alice?.coins).toBeGreaterThan(0);

    const persisted = await store.load('alice');
    expect(persisted?.stats.rounds).toBe(1);
    expect(persisted?.coins).toBeGreaterThan(250);
  });
});

describe('store → inventory → match', () => {
  it('a verified purchase unlocks an animal the player can then equip and play as', async () => {
    const { accounts, rooms, purchases, store } = harness();
    const profile = await accounts.loadOrCreate('buyer', 'Buyer');

    const item = getStoreItem('animal_tiger');
    expect(item?.priceCents).toBe(149);

    const outcome = await purchases.purchase(profile, 'animal_tiger', 'dev:animal_tiger:xyz');
    expect(outcome.ok).toBe(true);
    expect(profile.ownedAnimals).toContain('tiger');
    profile.equipped.animalId = 'tiger';
    await accounts.save(profile);

    // The equipped animal is what the room spawns the player as.
    const room = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;
    const reloaded = await accounts.loadOrCreate('buyer');
    room.join(new FakeSocket(), reloaded, 'mobile', { hat: 'hat_crown' }, true);
    expect(room.playerState('buyer')?.animalId).toBe('tiger');

    // And the purchase survives a round trip through storage.
    const persisted = await store.load('buyer');
    expect(persisted?.ownedAnimals).toContain('tiger');
    expect(persisted?.purchases).toHaveLength(1);
  });
});

describe('private room → friends', () => {
  it('lets a second player join by code and share the same match', async () => {
    const { accounts, rooms } = harness();
    const host = rooms.matchmake({ modeId: 'infection', createPrivate: true }).room as Room;
    const hostProfile = await accounts.loadOrCreate('host', 'Host');
    host.join(new FakeSocket(), hostProfile, 'vr', {}, true);

    const joined = rooms.matchmake({ roomCode: host.code });
    expect(joined.room?.code).toBe(host.code);
    const friendProfile = await accounts.loadOrCreate('friend', 'Friend');
    const friendSocket = new FakeSocket();
    joined.room?.join(friendSocket, friendProfile, 'mobile', {}, true);

    expect(host.playerCount).toBe(2);
    expect(friendSocket.last('welcome')?.isPrivate).toBe(true);
    expect(friendSocket.last('welcome')?.players.map((p) => p.id)).toContain('host');
  });
});

describe('cross-platform play', () => {
  it('simulates PC, mobile and VR players in one room under the same rules', async () => {
    const { accounts, rooms } = harness();
    const room = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;

    for (const [id, platform] of [
      ['pc-player', 'pc'],
      ['mobile-player', 'mobile'],
      ['vr-player', 'vr'],
    ] as const) {
      const profile = await accounts.loadOrCreate(id, id);
      room.join(new FakeSocket(), profile, platform, {}, true);
    }

    // A VR intent carries hands; PC and mobile intents do not. Both must simulate.
    const vrIntent = createIntent();
    vrIntent.hands = [
      { tracked: true, pos: { x: -0.3, y: 1.2, z: 0.4 }, vel: { x: 0, y: 0, z: 0 }, grip: 0 },
      { tracked: true, pos: { x: 0.3, y: 1.2, z: 0.4 }, vel: { x: 0, y: 0, z: 0 }, grip: 0 },
    ];
    const flatIntent = createIntent();
    flatIntent.moveZ = 1;

    for (let tick = 0; tick < 240; tick++) {
      vrIntent.tick = tick;
      flatIntent.tick = tick;
      room.handleIntent('vr-player', encodeIntent(vrIntent));
      room.handleIntent('pc-player', encodeIntent(flatIntent));
      room.handleIntent('mobile-player', encodeIntent(flatIntent));
      room.tick();
    }

    const vr = room.playerState('vr-player') as PlayerState;
    const pc = room.playerState('pc-player') as PlayerState;
    const mobile = room.playerState('mobile-player') as PlayerState;

    expect(vr.hands[0].tracked).toBe(true);
    expect(pc.hands[0].tracked).toBe(false);
    // Identical intents produce identical movement regardless of the platform label.
    expect(pc.config.maxSpeed).toBe(mobile.config.maxSpeed);
    expect(vr.config.maxSpeed).toBe(pc.config.maxSpeed);
    for (const player of [vr, pc, mobile]) {
      expect(Number.isFinite(player.position.x)).toBe(true);
      expect(player.position.y).toBeGreaterThan(level.killPlaneY);
    }
  });
});

function roomPlayers(room: Room): PlayerState[] {
  return [...room.simulation.players.values()];
}
