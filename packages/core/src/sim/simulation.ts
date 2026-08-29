import { Rand, hashString } from '../math/rand.js';
import { v3distance, vec3 } from '../math/vec3.js';
import { capsuleFits } from '../physics/character.js';
import { PhysicsWorld } from '../physics/world.js';
import type { InputIntent } from '../input/intent.js';
import { createIntent, copyIntent, sanitizeIntent } from '../input/intent.js';
import type { GameMode, ModeContext, MatchResult } from '../modes/types.js';
import { createMode } from '../modes/registry.js';
import type { CombatConfig } from '../player/combat.js';
import { DEFAULT_COMBAT, resolvePunches } from '../player/combat.js';
import type { MovementConfig } from '../player/config.js';
import { DEFAULT_MOVEMENT } from '../player/config.js';
import type { LocomotionContext } from '../player/locomotion.js';
import { stepPlayer } from '../player/locomotion.js';
import type { PlayerState, PlayerRole } from '../player/state.js';
import { createPlayerState, respawnPlayer } from '../player/state.js';
import type { LevelDef, SpawnPoint } from '../world/level.js';
import { findSpawns } from '../world/level.js';
import { SimEventQueue } from './events.js';
import type { Snapshot } from './snapshot.js';
import { snapshotPlayer } from './snapshot.js';

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

export interface SimulationOptions {
  level: LevelDef;
  modeId: string;
  seed?: number;
  combat?: CombatConfig;
}

export interface AddPlayerOptions {
  id: string;
  name?: string;
  animalId?: string;
  config?: MovementConfig;
  role?: PlayerRole;
}

/**
 * The authoritative simulation.
 *
 * Deterministic: `step()` is a pure function of (state, intents). The server runs it as the
 * source of truth; the client runs *the same class* for prediction. Nothing in here touches
 * a renderer, a socket or the DOM.
 */
export class Simulation {
  readonly level: LevelDef;
  readonly world: PhysicsWorld;
  readonly players = new Map<string, PlayerState>();
  readonly events = new SimEventQueue();
  readonly rand: Rand;
  readonly mode: GameMode;

  tick = 0;

  private intents = new Map<string, InputIntent>();
  private locomotion: LocomotionContext;
  private modeCtx: ModeContext;
  private combatConfig: CombatConfig;
  private spawnCursor = 0;

  constructor(options: SimulationOptions) {
    this.level = options.level;
    this.world = new PhysicsWorld(options.level.colliders);
    this.rand = new Rand(options.seed ?? hashString(options.level.id));
    this.mode = createMode(options.modeId);
    this.combatConfig = options.combat ?? DEFAULT_COMBAT;

    this.locomotion = {
      world: this.world,
      events: this.events,
      tick: 0,
      killPlaneY: options.level.killPlaneY,
    };

    this.modeCtx = {
      players: this.players,
      level: this.level,
      world: this.world,
      events: this.events,
      rand: this.rand,
      tick: 0,
      dt: TICK_DT,
      respawn: (player, tag) => this.respawn(player, tag),
    };

    this.mode.start(this.modeCtx);
  }

  addPlayer(options: AddPlayerOptions): PlayerState {
    const player = createPlayerState({
      id: options.id,
      name: options.name ?? 'Roo',
      animalId: options.animalId ?? 'kangaroo',
      config: options.config ?? DEFAULT_MOVEMENT,
      role: options.role ?? 'idle',
    });
    this.players.set(player.id, player);
    this.intents.set(player.id, createIntent());
    this.respawn(player, 'runner');
    this.mode.playerJoined(this.modeCtx, player);
    return player;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.intents.delete(id);
    this.mode.playerLeft(this.modeCtx, id);
  }

  /** Store the latest intent for a player. Server sanitises; the client trusts its own input. */
  setIntent(id: string, intent: InputIntent, sanitize = true): void {
    const stored = this.intents.get(id);
    if (!stored) return;
    copyIntent(stored, intent);
    if (sanitize) sanitizeIntent(stored);
    const player = this.players.get(id);
    if (player) player.lastIntentTick = this.tick;
  }

  getIntent(id: string): InputIntent | undefined {
    return this.intents.get(id);
  }

  /** Advance exactly one tick. */
  step(): void {
    this.tick++;
    this.locomotion.tick = this.tick;
    this.modeCtx.tick = this.tick;

    for (const player of this.players.values()) {
      if (!player.active) continue;
      const intent = this.intents.get(player.id);
      if (!intent) continue;
      stepPlayer(player, intent, this.locomotion, TICK_DT);
      this.checkCheckpoints(player);
      if (!player.alive && player.position.y < this.level.killPlaneY) {
        this.respawn(player);
        this.events.emit('respawn', player.id, player.position, this.tick, 0, { data: 'fall' });
      }
    }

    if (this.mode.def.combat) {
      for (const player of this.players.values()) {
        resolvePunches(player, this.players.values(), this.combatConfig, this.events, this.tick);
      }
    }

    this.mode.step(this.modeCtx);
  }

  /** Run N ticks — used by the server loop's catch-up and by tests. */
  stepMany(count: number): void {
    for (let i = 0; i < count; i++) this.step();
  }

  snapshot(): Snapshot {
    const players = [];
    for (const player of this.players.values()) {
      players.push(snapshotPlayer(player));
    }
    return { tick: this.tick, players, mode: this.mode.state() };
  }

  results(): MatchResult {
    return this.mode.results(this.modeCtx);
  }

  finished(): boolean {
    return this.mode.finished();
  }

  /** End the current round early. Used by host controls, empty-room cleanup and tests. */
  endRound(reason = 'manual'): void {
    this.mode.endRound(this.modeCtx, reason);
  }

  /** Place a player at a free spawn point matching `tag`. */
  respawn(player: PlayerState, tag: SpawnPoint['tag'] = 'runner'): void {
    const spawns = findSpawns(this.level, tag);
    if (spawns.length === 0) {
      respawnPlayer(player, vec3(0, 2, 0), this.tick);
      return;
    }
    // Round-robin from a seeded offset, then pick the first spot that is free and not crowded.
    const start = (this.spawnCursor++ + this.rand.int(0, spawns.length)) % spawns.length;
    let chosen = spawns[start] as SpawnPoint;
    for (let i = 0; i < spawns.length; i++) {
      const candidate = spawns[(start + i) % spawns.length] as SpawnPoint;
      if (!capsuleFits(this.world, candidate.position, { radius: player.config.radius, height: player.config.standHeight })) {
        continue;
      }
      if (this.isCrowded(candidate, player.id)) continue;
      chosen = candidate;
      break;
    }
    respawnPlayer(player, chosen.position, this.tick);
    player.yaw = chosen.yaw;
    player.spawnPointIndex = spawns.indexOf(chosen);
  }

  private isCrowded(spawn: SpawnPoint, excludeId: string): boolean {
    for (const other of this.players.values()) {
      if (other.id === excludeId) continue;
      if (v3distance(other.position, spawn.position) < 2.2) return true;
    }
    return false;
  }

  private checkCheckpoints(player: PlayerState): void {
    if (!this.mode.checkpointReached) return;
    const checkpoints = this.level.checkpoints;
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      if (!cp) continue;
      if (v3distance(player.position, cp.position) > cp.radius) continue;
      this.mode.checkpointReached(this.modeCtx, player, cp.index, cp.finish === true);
      break;
    }
  }
}
