import {
  Simulation,
  TICK_DT,
  buildJungleWorld,
  createIntent,
  generateRoomCode,
  levelFingerprint,
  sanitizeName,
  Rand,
  hashString,
  computeMatchAward,
  grantAward,
  applyMatchStats,
  evaluateAchievements,
  getModeDef,
  createModerationState,
  ReportLimiter,
} from '@kc/core';
import type {
  InputIntent,
  LevelDef,
  MatchResult,
  ModerationState,
  PlayerProfile,
  PlayerState,
  Snapshot,
} from '@kc/core';
import {
  FAR_SNAPSHOT_DIVISOR,
  NEAR_DISTANCE,
  PROTOCOL_VERSION,
  SlotTable,
  decodeIntent,
  encodeSnapshot,
} from '@kc/net';
import type { Platform, RosterEntry, ServerMessage } from '@kc/net';
import type { AccountService } from './accounts.js';
import type { Leaderboard } from './leaderboard.js';

export interface ClientSocket {
  sendJson(message: ServerMessage): void;
  sendBinary(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface RoomClient {
  playerId: string;
  socket: ClientSocket;
  profile: PlayerProfile;
  platform: Platform;
  cosmetics: Record<string, string>;
  crossPlay: boolean;
  moderation: ModerationState;
  /** Last snapshot sent to this client — the delta baseline. WebSocket is ordered and reliable, so what we sent is what they have. */
  baseline: Snapshot | null;
  slot: number;
  lastIntentAt: number;
  messageBudget: number;
  votedMode: string | null;
  ready: boolean;
}

export interface RoomOptions {
  code: string;
  modeId: string;
  isPrivate: boolean;
  maxPlayers: number;
  snapshotIntervalTicks: number;
  accounts: AccountService;
  leaderboard: Leaderboard;
  level?: LevelDef;
  seed?: number;
}

/**
 * One authoritative match.
 *
 * The room owns the only trustworthy copy of the world. Clients send intents; the room
 * simulates, decides every tag, punch and score, and broadcasts delta snapshots. Rewards are
 * computed here from the room's own `MatchResult` and written straight to the profile store —
 * a match result never travels up from a client.
 */
export class Room {
  readonly code: string;
  readonly isPrivate: boolean;
  readonly maxPlayers: number;
  readonly level: LevelDef;
  readonly clients = new Map<string, RoomClient>();

  private sim: Simulation;
  private slots = new SlotTable();
  private snapshotIntervalTicks: number;
  private accounts: AccountService;
  private leaderboard: Leaderboard;
  private scratchIntent: InputIntent = createIntent();
  private reports = new ReportLimiter();
  private resultsSent = false;
  private modeId: string;
  private emptySince: number | null = Date.now();

  constructor(options: RoomOptions) {
    this.code = options.code;
    this.isPrivate = options.isPrivate;
    this.maxPlayers = options.maxPlayers;
    this.snapshotIntervalTicks = options.snapshotIntervalTicks;
    this.accounts = options.accounts;
    this.leaderboard = options.leaderboard;
    this.level = options.level ?? buildJungleWorld();
    this.modeId = options.modeId;
    this.sim = new Simulation({ level: this.level, modeId: options.modeId, seed: options.seed });
  }

  get playerCount(): number {
    return this.clients.size;
  }

  get isFull(): boolean {
    return this.clients.size >= this.maxPlayers;
  }

  get currentModeId(): string {
    return this.modeId;
  }

  /** How long the room has been empty, in ms. Used by the manager to reap idle rooms. */
  emptyForMs(now = Date.now()): number {
    return this.emptySince === null ? 0 : now - this.emptySince;
  }

  join(socket: ClientSocket, profile: PlayerProfile, platform: Platform, cosmetics: Record<string, string>, crossPlay: boolean): RoomClient {
    const slot = this.slots.assign(profile.playerId);
    const client: RoomClient = {
      playerId: profile.playerId,
      socket,
      profile,
      platform,
      cosmetics,
      crossPlay,
      moderation: createModerationState(profile.mutedPlayerIds, profile.blockedPlayerIds),
      baseline: null,
      slot,
      lastIntentAt: Date.now(),
      messageBudget: 0,
      votedMode: null,
      ready: false,
    };
    this.clients.set(profile.playerId, client);
    this.emptySince = null;

    this.sim.addPlayer({
      id: profile.playerId,
      name: sanitizeName(profile.name),
      animalId: profile.equipped.animalId,
    });

    socket.sendJson({
      t: 'welcome',
      playerId: profile.playerId,
      roomCode: this.code,
      isPrivate: this.isPrivate,
      levelId: this.level.id,
      levelSeed: this.level.seed,
      levelFingerprint: levelFingerprint(this.level),
      modeId: this.modeId,
      tickRate: 1 / TICK_DT,
      serverTick: this.sim.tick,
      slots: this.slots.entries(),
      players: [...this.clients.values()].map((c) => this.rosterEntry(c)),
    });

    this.broadcast({ t: 'joined', player: this.rosterEntry(client) }, profile.playerId);
    this.broadcastRoomState();
    return client;
  }

  leave(playerId: string): void {
    const client = this.clients.get(playerId);
    if (!client) return;
    void this.accounts.save(client.profile);
    this.clients.delete(playerId);
    this.slots.release(playerId);
    this.sim.removePlayer(playerId);
    this.broadcast({ t: 'left', playerId });
    this.broadcastRoomState();
    if (this.clients.size === 0) this.emptySince = Date.now();
  }

  handleIntent(playerId: string, data: Uint8Array, now = Date.now()): void {
    const client = this.clients.get(playerId);
    if (!client) return;
    try {
      decodeIntent(data, this.scratchIntent);
    } catch {
      return; // malformed frame: ignore rather than disconnect (mobile networks corrupt things)
    }
    // sanitize=true: the simulation clamps axes, angles and hand poses before they touch physics.
    this.sim.setIntent(playerId, this.scratchIntent);
    client.lastIntentAt = now;
  }

  handleChat(playerId: string, text: string): void {
    const client = this.clients.get(playerId);
    if (!client) return;
    const clean = text.trim().slice(0, 140);
    if (!clean) return;
    for (const other of this.clients.values()) {
      if (other.moderation.blocked.has(playerId) || other.moderation.muted.has(playerId)) continue;
      other.socket.sendJson({ t: 'chat', playerId, name: client.profile.name, text: clean });
    }
  }

  handleVoiceSignal(fromId: string, targetId: string, payload: string, kind: 'offer' | 'answer' | 'ice' | 'leave'): void {
    const target = this.clients.get(targetId);
    const from = this.clients.get(fromId);
    if (!target || !from) return;
    // The server never inspects or stores voice data — it only introduces the two peers.
    if (target.moderation.blocked.has(fromId) || from.moderation.blocked.has(targetId)) return;
    if (payload.length > 8000) return;
    target.socket.sendJson({ t: 'voice', fromId, payload, kind });
  }

  handleModeration(playerId: string, action: 'mute' | 'unmute' | 'block' | 'unblock', targetId: string): void {
    const client = this.clients.get(playerId);
    if (!client || targetId === playerId) return;
    const { moderation, profile } = client;
    switch (action) {
      case 'mute':
        moderation.muted.add(targetId);
        break;
      case 'unmute':
        moderation.muted.delete(targetId);
        break;
      case 'block':
        moderation.blocked.add(targetId);
        moderation.muted.add(targetId);
        break;
      case 'unblock':
        moderation.blocked.delete(targetId);
        moderation.muted.delete(targetId);
        break;
    }
    profile.mutedPlayerIds = [...moderation.muted];
    profile.blockedPlayerIds = [...moderation.blocked];
    void this.accounts.save(profile);
  }

  handleReport(playerId: string, targetId: string, reason: string): boolean {
    if (!this.clients.has(targetId)) return false;
    if (!this.reports.allow(playerId)) return false;
    // Reports are recorded for human review; no automated punishment.
    reportLog.push({ reporterId: playerId, targetId, reason, roomCode: this.code, at: Date.now() });
    if (reportLog.length > 5000) reportLog.shift();
    return true;
  }

  handleVote(playerId: string, modeId: string): void {
    const client = this.clients.get(playerId);
    if (!client || !getModeDef(modeId)) return;
    client.votedMode = modeId;
    this.broadcastRoomState();
  }

  handleReady(playerId: string, ready: boolean): void {
    const client = this.clients.get(playerId);
    if (client) client.ready = ready;
  }

  /** Advance the simulation by one tick and broadcast when due. */
  tick(now = Date.now()): void {
    this.sim.step();

    const events = this.sim.events.drain();
    if (events.length > 0) {
      this.broadcast({ t: 'events', events });
    }

    if (this.sim.tick % this.snapshotIntervalTicks === 0) {
      this.broadcastSnapshots();
    }
    if (this.sim.tick % 30 === 0) {
      this.broadcast({ t: 'mode', state: this.sim.mode.state() });
      this.dropTimedOutClients(now);
    }

    if (this.sim.finished() && !this.resultsSent) {
      this.resultsSent = true;
      void this.finishRound();
    }
  }

  private broadcastSnapshots(): void {
    const snapshot = this.sim.snapshot();
    const farPhase = Math.floor(this.sim.tick / this.snapshotIntervalTicks) % FAR_SNAPSHOT_DIVISOR !== 0;

    for (const client of this.clients.values()) {
      const skip = new Set<string>();
      if (farPhase) {
        const viewer = snapshot.players.find((p) => p.id === client.playerId);
        if (viewer) {
          for (const other of snapshot.players) {
            if (other.id === client.playerId) continue;
            const distance = Math.hypot(other.x - viewer.x, other.y - viewer.y, other.z - viewer.z);
            // Distant players update at a quarter rate — the single biggest bandwidth win.
            if (distance > NEAR_DISTANCE) skip.add(other.id);
          }
        }
      }
      const bytes = encodeSnapshot(snapshot, this.slots, {
        baseline: client.baseline,
        viewerId: client.playerId,
        nearDistance: NEAR_DISTANCE,
        skip,
      });
      client.socket.sendBinary(bytes);
      client.baseline = mergeBaseline(client.baseline, snapshot, skip);
    }
  }

  private dropTimedOutClients(now: number): void {
    for (const client of [...this.clients.values()]) {
      if (now - client.lastIntentAt > 30_000) {
        client.socket.close(4000, 'timeout');
        this.leave(client.playerId);
      }
    }
  }

  /** Round over: compute rewards from the server's own result and persist everything. */
  private async finishRound(): Promise<void> {
    const result = this.sim.results();
    const rewards: Record<string, { coins: number; xp: number; achievements: string[] }> = {};

    for (const client of this.clients.values()) {
      const award = computeMatchAward(result, client.playerId);
      grantAward(client.profile, award);
      applyMatchStats(client.profile, result, client.playerId);
      const unlocked = evaluateAchievements(client.profile);
      rewards[client.playerId] = {
        coins: award.coins,
        xp: award.xp,
        achievements: unlocked.map((u) => u.def.id),
      };
      this.submitLeaderboard(result, client);
      await this.accounts.save(client.profile);
    }

    this.broadcast({ t: 'results', result, rewards });
    setTimeout(() => this.startNextRound(), 8000).unref?.();
  }

  private submitLeaderboard(result: MatchResult, client: RoomClient): void {
    if (result.modeId !== 'parkour') return;
    const entry = result.players.find((p) => p.playerId === client.playerId);
    if (!entry || entry.bestLapTicks <= 0) return;
    this.leaderboard.submit(this.level.id, {
      playerId: client.playerId,
      name: client.profile.name,
      animalId: client.profile.equipped.animalId,
      ticks: entry.bestLapTicks,
      at: Date.now(),
    });
  }

  /** Rotate to the most-voted mode and rebuild the simulation for a fresh round. */
  startNextRound(): void {
    const nextMode = this.winningVote() ?? this.modeId;
    this.modeId = nextMode;
    this.resultsSent = false;
    this.sim = new Simulation({
      level: this.level,
      modeId: nextMode,
      seed: new Rand(hashString(`${this.code}:${Date.now()}`)).int(0, 2 ** 30),
    });
    for (const client of this.clients.values()) {
      client.baseline = null;
      client.votedMode = null;
      this.sim.addPlayer({
        id: client.playerId,
        name: sanitizeName(client.profile.name),
        animalId: client.profile.equipped.animalId,
      });
    }
    this.broadcastRoomState();
  }

  private winningVote(): string | null {
    const tally = new Map<string, number>();
    for (const client of this.clients.values()) {
      if (!client.votedMode) continue;
      tally.set(client.votedMode, (tally.get(client.votedMode) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [mode, count] of tally) {
      if (count > bestCount) {
        best = mode;
        bestCount = count;
      }
    }
    return best;
  }

  private rosterEntry(client: RoomClient): RosterEntry {
    return {
      id: client.playerId,
      name: client.profile.name,
      animalId: client.profile.equipped.animalId,
      cosmetics: client.cosmetics,
      platform: client.platform,
      slot: client.slot,
    };
  }

  broadcast(message: ServerMessage, exceptPlayerId?: string): void {
    for (const client of this.clients.values()) {
      if (client.playerId === exceptPlayerId) continue;
      client.socket.sendJson(message);
    }
  }

  broadcastRoomState(): void {
    const votes: Record<string, number> = {};
    for (const client of this.clients.values()) {
      if (client.votedMode) votes[client.votedMode] = (votes[client.votedMode] ?? 0) + 1;
    }
    this.broadcast({
      t: 'room',
      roomCode: this.code,
      isPrivate: this.isPrivate,
      modeId: this.modeId,
      playerCount: this.clients.size,
      maxPlayers: this.maxPlayers,
      votes,
    });
  }

  /** Exposed for tests and admin tooling. */
  get simulation(): Simulation {
    return this.sim;
  }

  playerState(playerId: string): PlayerState | undefined {
    return this.sim.players.get(playerId);
  }

  static newCode(rand: Rand): string {
    return generateRoomCode(rand);
  }

  static get protocolVersion(): number {
    return PROTOCOL_VERSION;
  }
}

/** Skipped players keep their previous baseline entry so the next delta is still correct. */
function mergeBaseline(previous: Snapshot | null, next: Snapshot, skipped: Set<string>): Snapshot {
  if (skipped.size === 0 || !previous) return next;
  const players = next.players.map((player) => {
    if (!skipped.has(player.id)) return player;
    return previous.players.find((p) => p.id === player.id) ?? player;
  });
  return { tick: next.tick, players, mode: next.mode };
}

/** In-memory report log. A real deployment ships these to a moderation queue. */
export const reportLog: { reporterId: string; targetId: string; reason: string; roomCode: string; at: number }[] = [];
