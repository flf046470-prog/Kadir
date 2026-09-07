import { describe, expect, it } from 'vitest';
import {
  MemorySaveStore,
  buildJungleWorld,
  createIntent,
  Bot,
  equipAnimal,
  equipGadgets,
  getStoreItem,
} from '@kc/core';
import type { PlayerState } from '@kc/core';
import { SlotTable, decodeSnapshot, encodeIntent } from '@kc/net';
import type { ServerMessage } from '@kc/net';
import { AccountService } from './accounts.js';
import { Leaderboard } from './leaderboard.js';
import { MemoryLeaderboardStore } from './leaderboard-store.js';
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
  databaseUrl: '',
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
  const leaderboard = new Leaderboard(new MemoryLeaderboardStore());
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
  /**
   * The path a new player actually takes now that the game is free: open the game, pick anything,
   * play as it. No purchase, no unlock, no receipt — the roster is simply theirs.
   */
  it('a brand-new account can equip any animal and the room spawns them as it', async () => {
    const { accounts, rooms, store } = harness();
    const profile = await accounts.loadOrCreate('newbie', 'Newbie');

    expect(getStoreItem('animal_tiger'), 'nothing is sold any more').toBeUndefined();
    expect(profile.ownedAnimals).toContain('tiger');
    expect(profile.ownedCosmetics).toContain('hat_crown');

    expect(equipAnimal(profile, 'tiger').ok).toBe(true);
    await accounts.save(profile);

    // The equipped animal is what the room spawns the player as.
    const room = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;
    const reloaded = await accounts.loadOrCreate('newbie');
    room.join(new FakeSocket(), reloaded, 'mobile', { hat: 'hat_crown' }, true);
    expect(room.playerState('newbie')?.animalId).toBe('tiger');

    // And it survives a round trip through storage without a purchase record.
    const persisted = await store.load('newbie');
    expect(persisted?.equipped.animalId).toBe('tiger');
    expect(persisted?.purchases).toHaveLength(0);
  });

  it('gives that account the whole gadget shelf too, ready to equip', async () => {
    const { accounts } = harness();
    const profile = await accounts.loadOrCreate('newbie', 'Newbie');

    const outcome = equipGadgets(profile, { primary: 'freeze_gun', secondary: 'bear_trap', armour: 'steel_helmet' });

    expect(outcome.problems).toEqual([]);
    expect(profile.equipped.gadgets.secondary).toBe('bear_trap');
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
