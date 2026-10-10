import { describe, expect, it } from 'vitest';
import { AUTO_MUTE_MIN_REPORTERS, MemorySaveStore, autoMuteThreshold } from '@kc/core';
import type { ServerMessage } from '@kc/net';
import { AccountService } from './accounts.js';
import { Leaderboard } from './leaderboard.js';
import { MemoryLeaderboardStore } from './leaderboard-store.js';
import { RoomManager } from './rooms.js';
import type { ClientSocket, Room } from './room.js';
import type { ServerConfig } from './config.js';
import { PERMANENT } from './moderation.js';

const CONFIG: ServerConfig = {
  port: 0,
  host: '127.0.0.1',
  tickRate: 60,
  snapshotRate: 20,
  maxRooms: 20,
  maxPlayersPerRoom: 16,
  dataDir: 'data-test',
  sessionSecret: 'mod-secret',
  clientTimeoutSeconds: 30,
  messageRateLimit: 90,
  allowedOrigins: [],
  onlineOrigin: '',
  publicDir: 'dist/client',
  assetLinksFile: '',
  stores: { metaAppId: '', metaAppSecret: '', steamAppId: '', steamWebApiKey: '', playPackageName: '' },
  allowDevPurchases: true,
  databaseUrl: '',
  ice: { servers: [], turnUrls: [], turnSecret: '', turnTtlSeconds: 43200 },
  moderators: new Set(['mod']),
};

class FakeSocket implements ClientSocket {
  json: ServerMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;
  sendJson(message: ServerMessage): void {
    this.json.push(message);
  }
  sendBinary(): void {}
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  all<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }>[] {
    return this.json.filter((m) => m.t === type) as Extract<ServerMessage, { t: T }>[];
  }
}

async function setup(ids: string[]) {
  const store = new MemorySaveStore();
  const accounts = new AccountService(store, CONFIG.sessionSecret);
  const rooms = new RoomManager(CONFIG, accounts, new Leaderboard(new MemoryLeaderboardStore()));
  const room = rooms.matchmake({ modeId: 'kangaroo-chase' }).room as Room;
  const sockets = new Map<string, FakeSocket>();
  for (const id of ids) {
    const profile = await accounts.loadOrCreate(id, id);
    const socket = new FakeSocket();
    sockets.set(id, socket);
    room.join(socket, profile, 'pc', {}, true);
  }
  return { rooms, room, accounts, sockets, socket: (id: string) => sockets.get(id) as FakeSocket };
}

describe('moderators', () => {
  it('are decided by the server, shown with a badge, and told so in welcome', async () => {
    const { socket } = await setup(['mod', 'ayse']);
    expect(socket('mod').all('welcome')[0]?.isModerator).toBe(true);
    expect(socket('ayse').all('welcome')[0]?.isModerator).toBeUndefined();
    const roster = socket('ayse').all('welcome')[0]?.players ?? [];
    expect(roster.find((p) => p.id === 'mod')?.moderator).toBe(true);
  });

  it('refuses every action from a player who is not a moderator', async () => {
    const { rooms, socket } = await setup(['mod', 'ayse', 'kerem']);
    for (const action of ['kick', 'mute', 'ban'] as const) {
      const result = await rooms.moderation.act('ayse', action, 'kerem', 10);
      expect(result.ok).toBe(false);
    }
    expect(socket('kerem').closed).toBeNull();
  });

  it('kick: removes the player and keeps them out of that room for a while', async () => {
    const { rooms, room, socket } = await setup(['mod', 'ayse', 'kerem']);
    const result = await rooms.moderation.act('mod', 'kick', 'kerem');
    expect(result.ok).toBe(true);
    expect(socket('kerem').closed?.code).toBe(4010);
    expect(socket('kerem').all('sanctioned')[0]?.kind).toBe('kick');
    expect(room.hasPlayer('kerem')).toBe(false);
    expect(rooms.matchmake({ roomCode: room.code, playerId: 'kerem' }).error).toBe('kicked');
    // Public matchmaking sends them somewhere else rather than back in.
    expect(rooms.matchmake({ modeId: 'kangaroo-chase', playerId: 'kerem' }).room?.code).not.toBe(room.code);
    // Everyone else can still join.
    expect(rooms.matchmake({ roomCode: room.code, playerId: 'someone' }).room?.code).toBe(room.code);
  });

  it('ban: survives on the profile, refuses login, and lifts', async () => {
    const { rooms, accounts, socket } = await setup(['mod', 'kerem']);
    await rooms.moderation.act('mod', 'ban', 'kerem', 0, 'slurs');
    expect(socket('kerem').closed?.code).toBe(4011);
    const profile = await accounts.loadOrCreate('kerem');
    expect(profile.banUntil).toBe(PERMANENT);
    expect(rooms.moderation.admit(profile)).toMatch(/banned/);
    await rooms.moderation.act('mod', 'unban', 'kerem');
    expect(rooms.moderation.admit(await accounts.loadOrCreate('kerem'))).toBeNull();
  });

  it('a timed ban expires on its own', async () => {
    const { rooms, accounts } = await setup(['mod', 'kerem']);
    const now = Date.now();
    await rooms.moderation.act('mod', 'ban', 'kerem', 60, '', now);
    const profile = await accounts.loadOrCreate('kerem');
    expect(rooms.moderation.admit(profile, now + 30 * 60_000)).toMatch(/until/);
    expect(rooms.moderation.admit(profile, now + 61 * 60_000)).toBeNull();
  });

  it('mute: stops chat, refuses call signalling, hangs up live calls — and unmutes', async () => {
    const { rooms, room, socket } = await setup(['mod', 'ayse', 'kerem']);
    await rooms.moderation.act('mod', 'mute', 'kerem', 10);
    // Live calls end on both sides.
    expect(socket('ayse').all('voice').some((v) => v.fromId === 'kerem' && v.kind === 'leave')).toBe(true);
    expect(socket('kerem').all('voice').some((v) => v.fromId === 'ayse' && v.kind === 'leave')).toBe(true);
    // No new call.
    const before = socket('ayse').all('voice').length;
    room.handleVoiceSignal('kerem', 'ayse', '{"type":"offer"}', 'offer');
    expect(socket('ayse').all('voice').length).toBe(before);
    // No chat.
    room.handleChat('kerem', 'hello');
    expect(socket('kerem').all('chat-rejected').length).toBe(1);
    expect(socket('ayse').all('chat').length).toBe(0);
    await rooms.moderation.act('mod', 'unmute', 'kerem');
    room.handleVoiceSignal('kerem', 'ayse', '{"type":"offer"}', 'offer');
    expect(socket('ayse').all('voice').length).toBe(before + 1);
  });

  it('moderators cannot sanction each other or themselves', async () => {
    const { rooms } = await setup(['mod']);
    expect((await rooms.moderation.act('mod', 'ban', 'mod')).ok).toBe(false);
  });
});

describe('reports', () => {
  it('reach online moderators at once, with names', async () => {
    const { room, socket } = await setup(['mod', 'ayse', 'kerem']);
    expect(room.handleReport('ayse', 'kerem', 'voice-abuse')).toBe(true);
    const pushed = socket('mod').all('mod-report')[0]?.report;
    expect(pushed?.targetName).toBe('kerem');
    expect(pushed?.reporterName).toBe('ayse');
    expect(socket('ayse').all('mod-report')).toHaveLength(0);
  });

  it('auto-mute: needs several different reporters, not one loud one', async () => {
    const ids = ['a', 'b', 'c', 'd', 'target'];
    const { room, rooms } = await setup(ids);
    expect(autoMuteThreshold(ids.length)).toBe(AUTO_MUTE_MIN_REPORTERS);
    // One player reporting over and over is one reporter (and the limiter refuses the repeats).
    for (let i = 0; i < 5; i++) room.handleReport('a', 'target', 'harassment');
    expect(rooms.moderation.isMuted('target')).toBe(false);
    room.handleReport('b', 'target', 'harassment');
    expect(rooms.moderation.isMuted('target')).toBe(false);
    room.handleReport('c', 'target', 'harassment');
    expect(rooms.moderation.isMuted('target')).toBe(true);
  });

  it('in a big room, a few friends cannot mute a stranger by themselves', () => {
    expect(autoMuteThreshold(32)).toBeGreaterThanOrEqual(10);
  });
});
