import { describe, expect, it } from 'vitest';
import { MemorySaveStore } from '@kc/core';
import type { ServerMessage } from '@kc/net';
import { AccountService } from './accounts.js';
import { Leaderboard } from './leaderboard.js';
import { MemoryLeaderboardStore } from './leaderboard-store.js';
import { RoomManager } from './rooms.js';
import { Room } from './room.js';
import type { ClientSocket } from './room.js';
import type { ServerConfig } from './config.js';

const CONFIG: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  tickRate: 60,
  snapshotRate: 20,
  maxRooms: 20,
  maxPlayersPerRoom: 8,
  dataDir: 'data-test',
  sessionSecret: 'lobby-secret',
  clientTimeoutSeconds: 30,
  messageRateLimit: 90,
  allowedOrigins: [],
  publicDir: 'dist/client',
  assetLinksFile: '',
  stores: { metaAppId: '', metaAppSecret: '', steamAppId: '', steamWebApiKey: '', playPackageName: '' },
  allowDevPurchases: true,
  databaseUrl: '',
};

class FakeSocket implements ClientSocket {
  json: ServerMessage[] = [];
  sendJson(message: ServerMessage): void {
    this.json.push(message);
  }
  sendBinary(): void {}
  close(): void {}
  last<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.json.length - 1; i >= 0; i--) {
      const message = this.json[i];
      if (message?.t === type) return message as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
  count(type: ServerMessage['t']): number {
    return this.json.filter((m) => m.t === type).length;
  }
}

/**
 * The lobby list, and the ready flag that had never left the server.
 *
 * `handleReady` wrote `client.ready` on every request and nothing anywhere read the field: it was
 * never broadcast, never rendered, and never used to decide anything. The client had a Ready
 * button wired end to end into a value no one could observe — which is indistinguishable from a
 * working feature until two people try to use it.
 */
describe('room state as a lobby', () => {
  async function room2() {
    const store = new MemorySaveStore();
    const accounts = new AccountService(store, CONFIG.sessionSecret);
    const rooms = new RoomManager(CONFIG, accounts, new Leaderboard(new MemoryLeaderboardStore()));
    const room = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;
    const sockets = new Map<string, FakeSocket>();
    for (const id of ['ayse', 'kerem']) {
      const profile = await accounts.loadOrCreate(id, id);
      const socket = new FakeSocket();
      sockets.set(id, socket);
      room.join(socket, profile, 'pc', {}, true);
    }
    return { room, sockets };
  }

  it('names everyone in the room, not just how many there are', async () => {
    const { sockets } = await room2();
    const seen = sockets.get('ayse')?.last('room');
    // A count cannot answer the question a shared room code is asking: did my friend arrive?
    expect(seen?.players.map((p) => p.name).sort()).toEqual(['ayse', 'kerem']);
    expect(seen?.playerCount).toBe(2);
  });

  it('starts everyone not ready', async () => {
    const { sockets } = await room2();
    expect(sockets.get('ayse')?.last('room')?.players.every((p) => !p.ready)).toBe(true);
  });

  it('tells the other player when someone readies', async () => {
    const { room, sockets } = await room2();
    room.handleReady('kerem', true);

    const onAyse = sockets.get('ayse')?.last('room');
    expect(onAyse?.players.find((p) => p.name === 'kerem')?.ready).toBe(true);
    // And only that player: a ready flag that sets everybody is worse than none.
    expect(onAyse?.players.find((p) => p.name === 'ayse')?.ready).toBe(false);
  });

  it('clears again, so ready is a state and not a one-way latch', async () => {
    const { room, sockets } = await room2();
    room.handleReady('kerem', true);
    room.handleReady('kerem', false);
    expect(sockets.get('ayse')?.last('room')?.players.find((p) => p.name === 'kerem')?.ready).toBe(false);
  });

  it('says nothing when the flag did not change', async () => {
    // Ready is a button, and a button gets double-tapped. Rebroadcasting the whole room to
    // everyone on every repeat press is free traffic for anyone who holds the key down.
    const { room, sockets } = await room2();
    const socket = sockets.get('ayse') as FakeSocket;
    room.handleReady('kerem', true);
    const after = socket.count('room');
    room.handleReady('kerem', true);
    room.handleReady('kerem', true);
    expect(socket.count('room')).toBe(after);
  });

  it('ignores a ready from someone who is not in the room', async () => {
    const { room, sockets } = await room2();
    const socket = sockets.get('ayse') as FakeSocket;
    const before = socket.count('room');
    expect(() => room.handleReady('nobody', true)).not.toThrow();
    expect(socket.count('room')).toBe(before);
  });

  it('drops a player out of the list when they leave', async () => {
    const { room, sockets } = await room2();
    room.leave('kerem');
    const seen = sockets.get('ayse')?.last('room');
    expect(seen?.players.map((p) => p.name)).toEqual(['ayse']);
  });
});
