import type { PlayerState } from '../player/state.js';
import { RoundMode, activePlayers } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext, PlayerResult } from './types.js';

export const PARKOUR_DEF: GameModeDef = {
  id: 'parkour',
  name: 'Parkour Race',
  description: 'Race the checkpoint route. Beat your personal best, then the world best.',
  minPlayers: 1,
  maxPlayers: 16,
  roundSeconds: 300,
  countdownSeconds: 5,
  icon: 'parkour',
  combat: false,
  tagging: false,
};

const FINISH_SCORE = 100;
const CHECKPOINT_SCORE = 8;

/**
 * Parkour Race.
 *
 * Checkpoints must be taken in order (skipping is ignored, not punished — cutting a corner
 * simply doesn't count), which keeps routing creative while making times comparable.
 */
export class ParkourMode extends RoundMode {
  private finishTicks = new Map<string, number>();

  protected override onRoundStart(ctx: ModeContext): void {
    this.finishTicks.clear();
    for (const player of activePlayers(ctx)) {
      player.role = 'racer';
      player.checkpointIndex = -1;
      player.lapStartTick = ctx.tick;
      ctx.respawn(player, 'start');
    }
    this.headline = 'Go!';
  }

  protected override onPlaying(ctx: ModeContext): void {
    for (const player of ctx.players.values()) {
      if (!player.active || this.finishTicks.has(player.id)) continue;
      this.entry(player.id).survivalTicks++;
    }
    if (this.finishTicks.size > 0 && this.finishTicks.size >= this.racerCount(ctx)) {
      this.finish(ctx, 'all-finished');
    }
  }

  checkpointReached(ctx: ModeContext, player: PlayerState, index: number, finish: boolean): void {
    if (this.phase !== 'playing') return;
    if (this.finishTicks.has(player.id)) return;
    // Checkpoints are sequential; the start line (index 0) also arms the timer.
    if (index !== player.checkpointIndex + 1) return;

    player.checkpointIndex = index;
    const entry = this.entry(player.id);
    entry.score += CHECKPOINT_SCORE;

    if (index === 0) {
      player.lapStartTick = ctx.tick;
    }
    ctx.events.emit('checkpoint', player.id, player.position, ctx.tick, index, { data: index });

    if (finish) {
      const lapTicks = player.lapStartTick >= 0 ? ctx.tick - player.lapStartTick : this.roundTicks;
      this.finishTicks.set(player.id, lapTicks);
      if (player.bestLapTicks < 0 || lapTicks < player.bestLapTicks) {
        player.bestLapTicks = lapTicks;
      }
      // Earlier finishers score higher; the raw time decides ties in the results table.
      entry.score += FINISH_SCORE - Math.min(60, this.finishTicks.size * 10);
      ctx.events.emit('lapComplete', player.id, player.position, ctx.tick, lapTicks / 60, {
        data: lapTicks,
      });
      this.headline = `${player.name} finished in ${(lapTicks / 60).toFixed(2)}s`;
    }
  }

  private racerCount(ctx: ModeContext): number {
    let n = 0;
    for (const p of ctx.players.values()) if (p.active && p.role === 'racer') n++;
    return n;
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    let bestTicks = Infinity;
    let winners: string[] = [];
    for (const [id, ticks] of this.finishTicks) {
      if (!ctx.players.has(id)) continue;
      if (ticks < bestTicks) {
        bestTicks = ticks;
        winners = [id];
      } else if (ticks === bestTicks) {
        winners.push(id);
      }
    }
    return winners;
  }

  protected override winnerHeadline(ctx: ModeContext): string {
    if (this.winnerIds.length === 0) return 'Nobody finished the route';
    const name = ctx.players.get(this.winnerIds[0] as string)?.name ?? 'Roo';
    const ticks = this.finishTicks.get(this.winnerIds[0] as string) ?? 0;
    return `${name} — ${(ticks / 60).toFixed(2)}s`;
  }

  /** Finishers first (by time), then everyone else by checkpoints reached. */
  protected override compareResults = (a: PlayerResult, b: PlayerResult): number => {
    const at = this.finishTicks.get(a.playerId);
    const bt = this.finishTicks.get(b.playerId);
    if (at !== undefined && bt !== undefined) return at - bt;
    if (at !== undefined) return -1;
    if (bt !== undefined) return 1;
    return b.score - a.score;
  };

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    player.role = 'racer';
    player.checkpointIndex = -1;
    player.lapStartTick = ctx.tick;
    ctx.respawn(player, 'start');
  }

  /** Lap time in ticks for a player, or -1. Used by the leaderboard service. */
  lapTicks(playerId: string): number {
    return this.finishTicks.get(playerId) ?? -1;
  }
}

registerMode(PARKOUR_DEF, (def) => new ParkourMode(def));
