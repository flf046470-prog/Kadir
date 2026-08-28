import { Rand, isValidRoomCode, listModes } from '@kc/core';
import type { LevelDef } from '@kc/core';
import { buildJungleWorld } from '@kc/core';
import type { AccountService } from './accounts.js';
import type { Leaderboard } from './leaderboard.js';
import { Room } from './room.js';
import type { ServerConfig } from './config.js';

export interface MatchmakeRequest {
  modeId?: string;
  roomCode?: string;
  createPrivate?: boolean;
}

export type MatchmakeError = 'not-found' | 'full' | 'bad-code' | 'no-capacity' | 'unknown-mode';

export interface MatchmakeResult {
  room?: Room;
  error?: MatchmakeError;
}

/**
 * Room lifecycle and matchmaking.
 *
 * One shared tick loop drives every room: a single 60 Hz timer with accumulator-based catch-up
 * is far cheaper than one timer per room, and it keeps all rooms on the same clock, which makes
 * server-side timing bugs reproducible.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private rand = new Rand(Date.now() >>> 0);
  private timer: NodeJS.Timeout | null = null;
  private accumulator = 0;
  private lastTickAt = 0;
  private level: LevelDef;

  constructor(
    private readonly config: ServerConfig,
    private readonly accounts: AccountService,
    private readonly leaderboard: Leaderboard,
  ) {
    this.level = buildJungleWorld();
  }

  get sharedLevel(): LevelDef {
    return this.level;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  list(): { code: string; modeId: string; players: number; max: number; isPrivate: boolean }[] {
    return [...this.rooms.values()].map((room) => ({
      code: room.code,
      modeId: room.currentModeId,
      players: room.playerCount,
      max: room.maxPlayers,
      isPrivate: room.isPrivate,
    }));
  }

  matchmake(request: MatchmakeRequest): MatchmakeResult {
    if (request.roomCode) {
      const code = request.roomCode.toUpperCase();
      if (!isValidRoomCode(code)) return { error: 'bad-code' };
      const room = this.rooms.get(code);
      if (!room) return { error: 'not-found' };
      if (room.isFull) return { error: 'full' };
      return { room };
    }

    const modeId = request.modeId ?? 'kangaroo-chase';
    if (!listModes().some((m) => m.id === modeId)) return { error: 'unknown-mode' };

    if (!request.createPrivate) {
      // Prefer the fullest room that still has space: players want a busy lobby, not an empty one.
      let best: Room | null = null;
      for (const room of this.rooms.values()) {
        if (room.isPrivate || room.isFull || room.currentModeId !== modeId) continue;
        if (!best || room.playerCount > best.playerCount) best = room;
      }
      if (best) return { room: best };
    }

    if (this.rooms.size >= this.config.maxRooms) return { error: 'no-capacity' };
    return { room: this.createRoom(modeId, request.createPrivate === true) };
  }

  createRoom(modeId: string, isPrivate: boolean): Room {
    let code = Room.newCode(this.rand);
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = Room.newCode(this.rand);

    const room = new Room({
      code,
      modeId,
      isPrivate,
      maxPlayers: this.config.maxPlayersPerRoom,
      snapshotIntervalTicks: Math.max(1, Math.round(this.config.tickRate / this.config.snapshotRate)),
      accounts: this.accounts,
      leaderboard: this.leaderboard,
      level: this.level,
      seed: this.rand.int(0, 2 ** 30),
    });
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  start(): void {
    if (this.timer) return;
    const stepMs = 1000 / this.config.tickRate;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.update(Date.now(), stepMs), stepMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Exposed so tests can drive the loop deterministically. */
  update(now: number, stepMs: number): void {
    const elapsed = now - this.lastTickAt;
    this.lastTickAt = now;
    this.accumulator += elapsed;
    // Cap catch-up: after a long stall we drop time rather than spiral into a death loop.
    const maxSteps = 6;
    let steps = 0;
    while (this.accumulator >= stepMs && steps < maxSteps) {
      this.accumulator -= stepMs;
      steps++;
      for (const room of this.rooms.values()) room.tick(now);
    }
    if (steps === maxSteps) this.accumulator = 0;

    if (steps > 0) this.reap(now);
  }

  private reap(now: number): void {
    for (const [code, room] of this.rooms) {
      if (room.playerCount === 0 && room.emptyForMs(now) > 60_000) {
        this.rooms.delete(code);
      }
    }
  }
}
