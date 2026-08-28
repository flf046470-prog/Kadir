import { DEFAULT_TAG_RULES, applyTagCooldowns, findTags } from '../player/tag.js';
import type { PlayerState } from '../player/state.js';
import { RoundMode, activePlayers } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext } from './types.js';

export const KANGAROO_CHASE_DEF: GameModeDef = {
  id: 'kangaroo-chase',
  name: 'Kangaroo Chase',
  description: 'Chasers hunt runners. Get tagged and you become a chaser. Survive to score.',
  minPlayers: 2,
  maxPlayers: 16,
  roundSeconds: 240,
  countdownSeconds: 5,
  icon: 'chase',
  combat: false,
  tagging: true,
};

/** Points per second survived as a runner. */
const RUNNER_TICK_SCORE = 1 / 60;
/** Points for a successful tag. */
const TAG_SCORE = 12;

/**
 * Kangaroo Chase — the flagship mode.
 *
 * One chaser per five players (rounded up), and being tagged makes *you* the chaser while the
 * tagger goes free. Runners score continuously, chasers score in bursts, so both roles are
 * worth playing well.
 */
export class ChaseMode extends RoundMode {
  private chaserCount = 1;

  protected override onRoundStart(ctx: ModeContext): void {
    const players = activePlayers(ctx);
    this.chaserCount = Math.max(1, Math.floor(players.length / 5));
    const shuffled = ctx.rand.shuffle([...players]);
    shuffled.forEach((player, index) => {
      const chaser = index < this.chaserCount;
      this.assignRole(ctx, player, chaser ? 'chaser' : 'runner');
      ctx.respawn(player, chaser ? 'chaser' : 'runner');
    });
    this.headline = this.chaserCount > 1 ? `${this.chaserCount} chasers are loose!` : 'Run!';
  }

  protected override onPlaying(ctx: ModeContext): void {
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      const entry = this.entry(player.id);
      if (player.role === 'runner') {
        entry.score += RUNNER_TICK_SCORE;
        entry.survivalTicks++;
      }
      player.roleTicks++;
    }

    const tags = findTags(
      ctx.players.values(),
      (p) => p.role === 'chaser',
      (p) => p.role === 'runner',
      DEFAULT_TAG_RULES,
    );

    for (const tag of tags) {
      applyTagCooldowns(tag.tagger, tag.target, DEFAULT_TAG_RULES);
      const taggerEntry = this.entry(tag.tagger.id);
      taggerEntry.score += TAG_SCORE;
      taggerEntry.tags++;

      // Role swap: the tagged player becomes a chaser, the tagger is freed.
      this.assignRole(ctx, tag.target, 'chaser');
      this.assignRole(ctx, tag.tagger, 'runner');

      ctx.events.emit('tag', tag.tagger.id, tag.target.position, ctx.tick, tag.distance, {
        otherId: tag.target.id,
      });
    }

    if (tags.length > 0) {
      this.headline = `${tags.length} tagged!`;
    } else if (this.roundTicks % 60 === 0) {
      const runners = this.countRole(ctx, 'runner');
      this.headline = `${runners} running`;
    }
  }

  private countRole(ctx: ModeContext, role: PlayerState['role']): number {
    let n = 0;
    for (const p of ctx.players.values()) if (p.active && p.role === role) n++;
    return n;
  }

  private assignRole(ctx: ModeContext, player: PlayerState, role: PlayerState['role']): void {
    if (player.role === role) return;
    player.role = role;
    player.roleTicks = 0;
    ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: role });
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    // A player who finished the round having never been made chaser "escaped" the whole round.
    for (const [id, entry] of this.scores) {
      const player = ctx.players.get(id);
      if (player && player.role === 'runner' && entry.tags === 0 && player.lastTaggedBy === null) {
        entry.escapes = 1;
      }
    }
    return this.pickTopScorers(ctx);
  }

  private pickTopScorers(ctx: ModeContext): string[] {
    let best = -Infinity;
    let winners: string[] = [];
    for (const [id, entry] of this.scores) {
      if (!ctx.players.has(id)) continue;
      if (entry.score > best + 1e-6) {
        best = entry.score;
        winners = [id];
      } else if (Math.abs(entry.score - best) <= 1e-6) {
        winners.push(id);
      }
    }
    return winners;
  }

  protected override winnerHeadline(ctx: ModeContext): string {
    const names = this.winnerIds.map((id) => ctx.players.get(id)?.name ?? 'Roo');
    if (names.length === 0) return 'Round over';
    return names.length === 1 ? `${names[0]} wins!` : `Tie: ${names.join(', ')}`;
  }

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    player.role = 'runner';
    ctx.respawn(player, 'runner');
  }

}

registerMode(KANGAROO_CHASE_DEF, (def) => new ChaseMode(def));
