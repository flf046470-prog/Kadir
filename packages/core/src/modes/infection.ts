import { DEFAULT_TAG_RULES, applyTagCooldowns, findTags } from '../player/tag.js';
import type { PlayerState } from '../player/state.js';
import { RoundMode, activePlayers } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext } from './types.js';

export const INFECTION_DEF: GameModeDef = {
  id: 'infection',
  name: 'Infection',
  description: 'One infected kangaroo. Every player they catch joins them. Last survivor wins.',
  minPlayers: 3,
  maxPlayers: 16,
  roundSeconds: 180,
  countdownSeconds: 6,
  icon: 'infection',
  combat: false,
  tagging: true,
};

const SURVIVOR_TICK_SCORE = 1.5 / 60;
const INFECT_SCORE = 15;
const LAST_SURVIVOR_BONUS = 60;

/** Infection: infected never turn back, so tension rises across the round. */
export class InfectionMode extends RoundMode {
  private survivorCount = 0;

  protected override onRoundStart(ctx: ModeContext): void {
    const players = ctx.rand.shuffle([...activePlayers(ctx)]);
    players.forEach((player, index) => {
      player.role = index === 0 ? 'infected' : 'runner';
      player.roleTicks = 0;
      ctx.respawn(player, index === 0 ? 'chaser' : 'runner');
      ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: player.role });
    });
    this.survivorCount = Math.max(0, players.length - 1);
    this.headline = 'Patient zero is loose!';
  }

  protected override onPlaying(ctx: ModeContext): void {
    for (const player of ctx.players.values()) {
      if (!player.active || player.role !== 'runner') continue;
      const entry = this.entry(player.id);
      entry.score += SURVIVOR_TICK_SCORE;
      entry.survivalTicks++;
    }

    const tags = findTags(
      ctx.players.values(),
      (p) => p.role === 'infected',
      (p) => p.role === 'runner',
      DEFAULT_TAG_RULES,
    );

    for (const tag of tags) {
      applyTagCooldowns(tag.tagger, tag.target, DEFAULT_TAG_RULES);
      const entry = this.entry(tag.tagger.id);
      entry.score += INFECT_SCORE;
      entry.tags++;
      tag.target.role = 'infected';
      tag.target.roleTicks = 0;
      ctx.events.emit('tag', tag.tagger.id, tag.target.position, ctx.tick, tag.distance, {
        otherId: tag.target.id,
      });
      ctx.events.emit('roleChange', tag.target.id, tag.target.position, ctx.tick, 0, { data: 'infected' });
    }

    this.survivorCount = this.countSurvivors(ctx);
    if (this.survivorCount === 0) {
      this.finish(ctx, 'all-infected');
      return;
    }
    if (this.roundTicks % 30 === 0 || tags.length > 0) {
      this.headline = this.survivorCount === 1 ? 'One survivor left!' : `${this.survivorCount} survivors`;
    }
  }

  private countSurvivors(ctx: ModeContext): number {
    let n = 0;
    for (const p of ctx.players.values()) if (p.active && p.role === 'runner') n++;
    return n;
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    const survivors: string[] = [];
    for (const player of ctx.players.values()) {
      if (player.active && player.role === 'runner') survivors.push(player.id);
    }
    if (survivors.length > 0) {
      for (const id of survivors) {
        const entry = this.entry(id);
        entry.score += LAST_SURVIVOR_BONUS;
        entry.escapes = 1;
      }
      return survivors;
    }
    // Everyone was infected: the most productive infector wins.
    let best = -Infinity;
    let winners: string[] = [];
    for (const [id, entry] of this.scores) {
      if (!ctx.players.has(id)) continue;
      if (entry.tags > best) {
        best = entry.tags;
        winners = [id];
      } else if (entry.tags === best) {
        winners.push(id);
      }
    }
    return winners;
  }

  protected override winnerHeadline(ctx: ModeContext): string {
    const names = this.winnerIds.map((id) => ctx.players.get(id)?.name ?? 'Roo');
    if (names.length === 0) return 'Round over';
    if (this.survivorCount > 0) {
      return names.length === 1 ? `${names[0]} survived!` : `${names.length} survived!`;
    }
    return `${names[0]} infected the most`;
  }

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    // Late joiners start infected so the round cannot be reset by joining.
    player.role = 'infected';
    ctx.respawn(player, 'chaser');
  }
}

registerMode(INFECTION_DEF, (def) => new InfectionMode(def));
