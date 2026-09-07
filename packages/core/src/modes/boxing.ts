import type { PlayerState } from '../player/state.js';
import { regenerateStamina } from '../player/combat.js';
import { RoundMode, activePlayers } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext } from './types.js';

export const BOXING_DEF: GameModeDef = {
  id: 'boxing',
  name: 'VR Boxing',
  description: 'Physical punches, stamina and knockback. Most knockouts wins.',
  minPlayers: 2,
  maxPlayers: 8,
  roundSeconds: 180,
  countdownSeconds: 5,
  icon: 'boxing',
  combat: true,
  tagging: false,
};

const KO_SCORE = 25;
const KO_RESPAWN_SECONDS = 4;

/**
 * VR Boxing.
 *
 * Punch resolution itself lives in `player/combat.ts` and is platform-neutral: in VR the punch
 * comes from real hand velocity, on PC/Mobile the platform layer drives the same hand with a
 * button-triggered thrust. This mode only owns scoring, knockouts and respawns.
 */
export class BoxingMode extends RoundMode {
  private downTimers = new Map<string, number>();

  protected override onRoundStart(ctx: ModeContext): void {
    this.downTimers.clear();
    for (const player of activePlayers(ctx)) {
      player.role = 'fighter';
      player.health = 100;
      player.stamina = 100;
      ctx.respawn(player, 'runner');
    }
    this.headline = 'Fight!';
  }

  protected override onPlaying(ctx: ModeContext): void {
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      const entry = this.entry(player.id);

      if (!player.alive) {
        const remaining = (this.downTimers.get(player.id) ?? KO_RESPAWN_SECONDS) - ctx.dt;
        if (remaining <= 0) {
          this.downTimers.delete(player.id);
          player.health = 100;
          player.stamina = 100;
          ctx.respawn(player, 'runner');
          player.alive = true;
        } else {
          this.downTimers.set(player.id, remaining);
        }
        continue;
      }

      entry.survivalTicks++;
      regenerateStamina(player, ctx.dt);

      if (player.health <= 0) {
        this.knockOut(ctx, player);
      }
    }
  }

  private knockOut(ctx: ModeContext, victim: PlayerState): void {
    victim.alive = false;
    this.downTimers.set(victim.id, KO_RESPAWN_SECONDS);
    const attackerId = victim.lastTaggedBy;
    if (attackerId) {
      const entry = this.entry(attackerId);
      entry.score += KO_SCORE;
      entry.tags++;
      this.headline = `${ctx.players.get(attackerId)?.name ?? 'Someone'} knocked out ${victim.name}`;
    }
    ctx.events.emit('punchHit', attackerId ?? victim.id, victim.position, ctx.tick, 100, {
      otherId: victim.id,
      data: 'knockout',
    });
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    let best = -Infinity;
    let winners: string[] = [];
    for (const [id, entry] of this.scores) {
      if (!ctx.players.has(id)) continue;
      if (entry.score > best) {
        best = entry.score;
        winners = [id];
      } else if (entry.score === best) {
        winners.push(id);
      }
    }
    return winners;
  }

  protected override winnerHeadline(ctx: ModeContext): string {
    const names = this.winnerIds.map((id) => ctx.players.get(id)?.name ?? 'Roo');
    return names.length === 1 ? `${names[0]} wins the belt!` : 'Draw!';
  }

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    player.role = 'fighter';
    player.health = 100;
    ctx.respawn(player, 'runner');
  }
}

registerMode(BOXING_DEF, (def) => new BoxingMode(def));
