import { v3distance } from '../math/vec3.js';
import { DEFAULT_TAG_RULES, findTags } from '../player/tag.js';
import type { PlayerState } from '../player/state.js';
import { RoundMode, activePlayers, chaserCount } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext } from './types.js';

export const FREEZE_TAG_DEF: GameModeDef = {
  id: 'freeze-tag',
  name: 'Freeze Tag',
  description: 'Tagged players freeze solid. Stand by a frozen friend to thaw them out.',
  minPlayers: 3,
  maxPlayers: 16,
  roundSeconds: 210,
  countdownSeconds: 5,
  icon: 'freeze',
  combat: false,
  tagging: true,
};

/** Seconds a rescuer must stand beside a frozen player to thaw them. */
const THAW_SECONDS = 2;
/** How close counts as "beside". Generous, because the rescuer is standing still and exposed. */
const THAW_RADIUS = 2.2;

const FREEZE_SCORE = 15;
const THAW_SCORE = 20;
const RUNNER_TICK_SCORE = 1 / 60;
/** Seconds of immunity a thawed player gets, so the chaser cannot camp the rescue. */
const THAW_IMMUNITY = 3;

/**
 * Freeze Tag.
 *
 * The same chase everyone already knows, with one change that turns it from a solo game into a
 * team one: being tagged does not make you the chaser, it takes you out — and the only way back
 * is for someone else to come and stand next to you while the chaser is still out there. That
 * choice, whether to spend three exposed seconds on a rescue, is the whole mode.
 *
 * It reuses the gadget freeze rather than inventing a second kind of frozen, so a frozen player
 * is stopped by exactly the same code that stops one hit by a freeze gun — including on VR,
 * where the hands are the thing that has to be taken away.
 */
export class FreezeTagMode extends RoundMode {
  private chaserIds: string[] = [];
  /** Thaw progress in seconds, keyed by the frozen player's id. */
  private thawing = new Map<string, number>();

  protected override onRoundStart(ctx: ModeContext): void {
    this.thawing.clear();
    const players = ctx.rand.shuffle([...activePlayers(ctx)]);
    const chasers = chaserCount(this.def, players.length, 0.2);
    this.chaserIds = players.slice(0, chasers).map((p) => p.id);

    players.forEach((player, index) => {
      const chaser = index < chasers;
      player.role = chaser ? 'chaser' : 'runner';
      player.roleTicks = 0;
      player.gadgets.frozen = 0;
      ctx.respawn(player, chaser ? 'chaser' : 'runner');
      ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: player.role });
    });

    this.headline = chasers > 1 ? `${chasers} chasers — stay warm` : 'Stay warm';
  }

  protected override onPlaying(ctx: ModeContext): void {
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      player.roleTicks++;
      if (player.role === 'runner' && !this.isFrozen(player)) {
        const entry = this.entry(player.id);
        entry.score += RUNNER_TICK_SCORE;
        entry.survivalTicks++;
      }
    }

    this.freezeTagged(ctx);
    this.thawRescued(ctx);

    const free = this.countFree(ctx);
    if (free === 0 && this.countRunners(ctx) > 0) {
      this.finish(ctx, 'all-frozen');
      return;
    }
    if (this.roundTicks % 60 === 0) {
      this.headline = free === 1 ? 'One left unfrozen' : `${free} still running`;
    }
  }

  /** A frozen player is held frozen; the gadget timer would otherwise tick them free. */
  private isFrozen(player: PlayerState): boolean {
    return player.gadgets.frozen > 0;
  }

  private freezeTagged(ctx: ModeContext): void {
    const tags = findTags(
      ctx.players.values(),
      (p) => p.role === 'chaser',
      (p) => p.role === 'runner' && !this.isFrozen(p),
      DEFAULT_TAG_RULES,
    );

    for (const tag of tags) {
      // Topped up every tick while frozen, so the freeze lasts until someone thaws them rather
      // than expiring on the gadget's own three-second clock.
      tag.target.gadgets.frozen = 1;
      tag.target.velocity.x = 0;
      tag.target.velocity.z = 0;
      tag.tagger.tagCooldown = DEFAULT_TAG_RULES.cooldown;
      tag.target.lastTaggedBy = tag.tagger.id;

      const entry = this.entry(tag.tagger.id);
      entry.score += FREEZE_SCORE;
      entry.tags++;
      this.thawing.delete(tag.target.id);
      this.headline = `${tag.target.name} is frozen`;
      ctx.events.emit('status', tag.target.id, tag.target.position, ctx.tick, 1, {
        otherId: tag.tagger.id,
        data: 'frozen',
      });
    }

    // Hold everyone who is still frozen frozen.
    for (const player of ctx.players.values()) {
      if (player.role === 'runner' && this.isFrozen(player)) player.gadgets.frozen = 1;
    }
  }

  private thawRescued(ctx: ModeContext): void {
    for (const frozen of ctx.players.values()) {
      if (!frozen.active || frozen.role !== 'runner' || !this.isFrozen(frozen)) continue;

      const rescuer = this.rescuerFor(ctx, frozen);
      if (!rescuer) {
        this.thawing.delete(frozen.id);
        continue;
      }

      const progress = (this.thawing.get(frozen.id) ?? 0) + ctx.dt;
      if (progress < THAW_SECONDS) {
        this.thawing.set(frozen.id, progress);
        continue;
      }

      this.thawing.delete(frozen.id);
      frozen.gadgets.frozen = 0;
      frozen.invulnTimer = THAW_IMMUNITY;
      const entry = this.entry(rescuer.id);
      entry.score += THAW_SCORE;
      entry.escapes++;
      this.headline = `${rescuer.name} thawed ${frozen.name}`;
      ctx.events.emit('status', frozen.id, frozen.position, ctx.tick, 0, {
        otherId: rescuer.id,
        data: 'thawed',
      });
    }
  }

  /** The nearest unfrozen runner standing close enough to count. */
  private rescuerFor(ctx: ModeContext, frozen: PlayerState): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDistance = THAW_RADIUS;
    for (const other of ctx.players.values()) {
      if (other.id === frozen.id || !other.active) continue;
      if (other.role !== 'runner' || this.isFrozen(other)) continue;
      const distance = v3distance(other.position, frozen.position);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }
    return best;
  }

  private countFree(ctx: ModeContext): number {
    let n = 0;
    for (const p of ctx.players.values()) if (p.active && p.role === 'runner' && !this.isFrozen(p)) n++;
    return n;
  }

  private countRunners(ctx: ModeContext): number {
    let n = 0;
    for (const p of ctx.players.values()) if (p.active && p.role === 'runner') n++;
    return n;
  }

  /** Thaw progress 0..1 for the HUD ring that appears over a frozen player being rescued. */
  thawProgress(playerId: string): number {
    return Math.min(1, (this.thawing.get(playerId) ?? 0) / THAW_SECONDS);
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    const free = [...ctx.players.values()].filter((p) => p.active && p.role === 'runner' && !this.isFrozen(p));
    if (free.length > 0) return free.map((p) => p.id);
    return this.chaserIds.filter((id) => ctx.players.has(id));
  }

  protected override winnerHeadline(ctx: ModeContext): string {
    if (this.winnerIds.length === 0) return 'Round over';
    const first = ctx.players.get(this.winnerIds[0] as string);
    if (first?.role === 'chaser') return 'Everyone froze';
    return this.winnerIds.length === 1 ? `${first?.name ?? 'One runner'} stayed warm` : 'The runners held out';
  }

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    player.role = 'runner';
    player.gadgets.frozen = 0;
    player.invulnTimer = THAW_IMMUNITY;
    ctx.respawn(player, 'runner');
  }

  override playerLeft(ctx: ModeContext, playerId: string): void {
    super.playerLeft(ctx, playerId);
    this.thawing.delete(playerId);
    this.chaserIds = this.chaserIds.filter((id) => id !== playerId);
  }
}

registerMode(FREEZE_TAG_DEF, (def) => new FreezeTagMode(def));
