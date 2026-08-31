import type { Rand } from '../math/rand.js';
import type { SimEventQueue } from '../sim/events.js';
import type { PlayerState } from '../player/state.js';
import type { LevelDef } from '../world/level.js';
import type { PhysicsWorld } from '../physics/world.js';
import type { GadgetContext, GadgetRuntime } from '../gadgets/runtime.js';

export type ModePhase = 'waiting' | 'countdown' | 'playing' | 'ended';

/** Data-only description of a mode. New modes register one of these; no engine change needed. */
export interface GameModeDef {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  roundSeconds: number;
  countdownSeconds: number;
  /** Shown in the lobby; also used by matchmaking to group players. */
  icon: string;
  /** Modes that use punches enable the combat system. */
  combat: boolean;
  /** Modes where being tagged changes your role. */
  tagging: boolean;
  /** Round cash every player starts with, for modes that run an in-round shop. */
  startingCash?: number;
  /**
   * Fraction of the lobby that starts as chasers/hunters. Modes fall back to their own default
   * when it is absent; a player-authored config is what usually supplies it.
   */
  chaserRatio?: number;
  /** When false, loadouts are cleared at the bell and the shop is closed. Defaults to true. */
  gadgetsEnabled?: boolean;
}

export interface ModeContext {
  players: Map<string, PlayerState>;
  /** Live gadget entities. Modes clear these between rounds and place mode-owned ones. */
  gadgets: GadgetRuntime;
  /** Ready-made context for `applyPayload` and friends, so a mode never rebuilds one. */
  gadgetCtx: GadgetContext;
  level: LevelDef;
  world: PhysicsWorld;
  events: SimEventQueue;
  rand: Rand;
  tick: number;
  /** Seconds per tick. */
  dt: number;
  /** Move a player to a spawn point appropriate for their role. */
  respawn(player: PlayerState, tag?: 'runner' | 'chaser' | 'start'): void;
}

export interface PlayerResult {
  playerId: string;
  name: string;
  animalId: string;
  placement: number;
  score: number;
  tags: number;
  escapes: number;
  /** Ticks spent alive / not-infected / chasing, depending on the mode. */
  survivalTicks: number;
  /** Parkour: best lap in ticks, -1 when not applicable. */
  bestLapTicks: number;
  won: boolean;
}

export interface MatchResult {
  modeId: string;
  levelId: string;
  durationTicks: number;
  players: PlayerResult[];
  /** Empty when the round ended without a winner (e.g. everyone left). */
  winnerIds: string[];
}

/** Compact, network-friendly view of mode state for the HUD. */
export interface ModeStateView {
  modeId: string;
  phase: ModePhase;
  /** Seconds remaining in the current phase. */
  timeRemaining: number;
  /** Per-player role/score summary keyed by player id. */
  scores: Record<string, number>;
  roles: Record<string, string>;
  /** Short line the HUD shows front and centre ("You are IT!", "3 runners left"). */
  headline: string;
}

export interface GameMode {
  readonly def: GameModeDef;
  start(ctx: ModeContext): void;
  playerJoined(ctx: ModeContext, player: PlayerState): void;
  playerLeft(ctx: ModeContext, playerId: string): void;
  step(ctx: ModeContext): void;
  /** Called by the sim when a checkpoint volume is entered (parkour). */
  checkpointReached?(ctx: ModeContext, player: PlayerState, index: number, finish: boolean): void;
  /**
   * In-round shop. Only modes that run one implement it; the server routes a purchase request
   * here and the mode decides — it owns the round cash, so it is the only thing that can.
   * Returns false when the buy is refused (wrong role, wrong phase, cannot afford it).
   */
  purchase?(ctx: ModeContext, player: PlayerState, gadgetId: string): boolean;
  /** What that shop sells, for the HUD. Present exactly when `purchase` is. */
  shopStock?(): { id: string; name: string; cost: number }[];
  /**
   * Who may damage whom, for punches and for gadget damage alike.
   *
   * Omitted means a free-for-all, which is what Boxing wants. Every other mode with combat has
   * an opinion — Duel only lets the two fighters in a bout hit each other, Hunt only lets the
   * hunter and survivors trade — and getting this wrong is not cosmetic: a punch that should not
   * have landed still grants hit-immunity, which swallows catches and enables team griefing.
   */
  canDamage?(attacker: PlayerState, victim: PlayerState): boolean;
  state(): ModeStateView;
  finished(): boolean;
  /** End the round early (host action, empty room, admin tooling, tests). */
  endRound(ctx: ModeContext, reason: string): void;
  results(ctx: ModeContext): MatchResult;
}

export type GameModeFactory = (def: GameModeDef) => GameMode;
