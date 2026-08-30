import { resetForRound } from '../gadgets/state.js';
import type { PlayerState } from '../player/state.js';
import type { GameMode, GameModeDef, MatchResult, ModeContext, ModePhase, ModeStateView, PlayerResult } from './types.js';

export interface ScoreEntry {
  score: number;
  tags: number;
  escapes: number;
  survivalTicks: number;
}

/**
 * Shared round machinery: waiting → countdown → playing → ended, plus score bookkeeping and
 * result construction. Concrete modes only implement the interesting part.
 */
export abstract class RoundMode implements GameMode {
  readonly def: GameModeDef;
  protected phase: ModePhase = 'waiting';
  protected phaseTicks = 0;
  protected roundTicks = 0;
  protected scores = new Map<string, ScoreEntry>();
  protected headline = '';
  protected winnerIds: string[] = [];
  /** Kept from `start()` so `state()` can report live roles without needing a context. */
  protected roster: Map<string, PlayerState> = new Map();

  constructor(def: GameModeDef) {
    this.def = def;
  }

  start(ctx: ModeContext): void {
    this.phase = 'waiting';
    this.phaseTicks = 0;
    this.roundTicks = 0;
    this.scores.clear();
    this.winnerIds = [];
    this.headline = `Waiting for players (${this.def.minPlayers}+)`;
    this.roster = ctx.players;
  }

  playerJoined(ctx: ModeContext, player: PlayerState): void {
    this.entry(player.id);
    if (this.phase === 'playing') {
      // A late joiner is armed on arrival; otherwise they would wait out the round holding
      // gadgets with no charges in them.
      resetForRound(player.gadgets, this.def.startingCash ?? 0);
      this.onLateJoin(ctx, player);
    }
  }

  playerLeft(_ctx: ModeContext, playerId: string): void {
    this.scores.delete(playerId);
  }

  step(ctx: ModeContext): void {
    this.phaseTicks++;
    const active = countActive(ctx);

    switch (this.phase) {
      case 'waiting':
        if (active >= this.def.minPlayers) this.enterPhase('countdown', ctx);
        else this.headline = `Waiting for players (${active}/${this.def.minPlayers})`;
        break;
      case 'countdown': {
        const remaining = this.def.countdownSeconds - this.phaseTicks * ctx.dt;
        this.headline = `Starting in ${Math.max(0, Math.ceil(remaining))}`;
        if (active < this.def.minPlayers) this.enterPhase('waiting', ctx);
        else if (remaining <= 0) this.enterPhase('playing', ctx);
        break;
      }
      case 'playing': {
        this.roundTicks++;
        this.onPlaying(ctx);
        if (this.timeRemaining(ctx) <= 0) this.finish(ctx, 'time');
        break;
      }
      case 'ended':
        break;
    }
  }

  protected enterPhase(phase: ModePhase, ctx: ModeContext): void {
    this.phase = phase;
    this.phaseTicks = 0;
    if (phase === 'playing') {
      this.roundTicks = 0;
      // Every round starts clean: last round's traps are swept and charges refilled. Done here
      // rather than in each mode so a new mode cannot forget and inherit a minefield.
      ctx.gadgets.clear();
      for (const player of ctx.players.values()) resetForRound(player.gadgets, this.def.startingCash ?? 0);
      this.onRoundStart(ctx);
    }
    ctx.events.emit('roundState', 'system', { x: 0, y: 0, z: 0 }, ctx.tick, 0, { data: phase });
  }

  protected timeRemaining(ctx: ModeContext): number {
    if (this.phase !== 'playing') return this.def.roundSeconds;
    return this.def.roundSeconds - this.roundTicks * ctx.dt;
  }

  protected entry(playerId: string): ScoreEntry {
    let e = this.scores.get(playerId);
    if (!e) {
      e = { score: 0, tags: 0, escapes: 0, survivalTicks: 0 };
      this.scores.set(playerId, e);
    }
    return e;
  }

  /** Public entry point for ending a round early; `finish` stays the internal hook. */
  endRound(ctx: ModeContext, reason: string): void {
    this.finish(ctx, reason);
  }

  protected finish(ctx: ModeContext, reason: string): void {
    if (this.phase === 'ended') return;
    this.winnerIds = this.computeWinners(ctx);
    this.phase = 'ended';
    this.phaseTicks = 0;
    this.headline = this.winnerHeadline(ctx);
    ctx.events.emit('roundState', 'system', { x: 0, y: 0, z: 0 }, ctx.tick, 0, { data: `ended:${reason}` });
  }

  state(): ModeStateView {
    const scores: Record<string, number> = {};
    for (const [id, entry] of this.scores) scores[id] = Math.round(entry.score);
    return {
      modeId: this.def.id,
      phase: this.phase,
      timeRemaining: Math.max(0, this.remainingSeconds),
      scores,
      roles: this.roleMap(),
      headline: this.headline,
    };
  }

  protected get remainingSeconds(): number {
    if (this.phase === 'countdown') return this.def.countdownSeconds - this.phaseTicks / 60;
    if (this.phase === 'playing') return this.def.roundSeconds - this.roundTicks / 60;
    return 0;
  }

  finished(): boolean {
    return this.phase === 'ended';
  }

  results(ctx: ModeContext): MatchResult {
    const players: PlayerResult[] = [];
    for (const [id, entry] of this.scores) {
      const player = ctx.players.get(id);
      players.push({
        playerId: id,
        name: player?.name ?? id,
        animalId: player?.animalId ?? 'kangaroo',
        placement: 0,
        score: Math.round(entry.score),
        tags: entry.tags,
        escapes: entry.escapes,
        survivalTicks: entry.survivalTicks,
        bestLapTicks: player?.bestLapTicks ?? -1,
        won: this.winnerIds.includes(id),
      });
    }
    players.sort(this.compareResults);
    players.forEach((p, i) => {
      p.placement = i + 1;
    });
    return {
      modeId: this.def.id,
      levelId: ctx.level.id,
      durationTicks: this.roundTicks,
      players,
      winnerIds: [...this.winnerIds],
    };
  }

  /** Higher score first by default; parkour overrides with time. */
  protected compareResults = (a: PlayerResult, b: PlayerResult): number => b.score - a.score;

  protected roleMap(): Record<string, string> {
    const roles: Record<string, string> = {};
    for (const [id, player] of this.roster) roles[id] = player.role;
    return roles;
  }

  protected abstract onRoundStart(ctx: ModeContext): void;
  protected abstract onPlaying(ctx: ModeContext): void;
  protected abstract computeWinners(ctx: ModeContext): string[];
  protected abstract winnerHeadline(ctx: ModeContext): string;
  protected onLateJoin(_ctx: ModeContext, _player: PlayerState): void {}
}

export function countActive(ctx: ModeContext): number {
  let n = 0;
  for (const player of ctx.players.values()) if (player.active) n++;
  return n;
}

export function activePlayers(ctx: ModeContext): PlayerState[] {
  return [...ctx.players.values()].filter((p) => p.active);
}
