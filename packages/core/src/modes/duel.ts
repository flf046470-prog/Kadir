import { v3distance } from '../math/vec3.js';
import { regenerateStamina } from '../player/combat.js';
import { DEFAULT_TAG_RULES, findTags } from '../player/tag.js';
import type { PlayerState } from '../player/state.js';
import { RoundMode, activePlayers, chaserCount } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext } from './types.js';

export const DUEL_DEF: GameModeDef = {
  id: 'duel',
  name: 'Conversion Duel',
  description: 'Kangaroos hunt humans. A catch starts a boxing match, and the winner converts the loser.',
  minPlayers: 2,
  maxPlayers: 16,
  roundSeconds: 300,
  countdownSeconds: 6,
  icon: 'duel',
  combat: true,
  tagging: true,
};

/** Which species a role belongs to, outside a bout. */
const KANGAROO_ROLE = 'chaser';
const HUMAN_ROLE = 'runner';

/** Seconds a bout may last before it is decided on health. */
const BOUT_SECONDS = 20;
/** How far apart the two fighters are placed at the bell. */
const BOUT_SEPARATION = 1.6;
/** Seconds of immunity after a bout, so the loser is not instantly caught again. */
const POST_BOUT_IMMUNITY = 4;

const CATCH_SCORE = 10;
const WIN_BOUT_SCORE = 30;
const SURVIVE_TICK_SCORE = 1 / 60;

interface Bout {
  kangarooId: string;
  humanId: string;
  /** Seconds left on the bout clock. */
  remaining: number;
}

/**
 * Conversion Duel.
 *
 * Kangaroos chase humans across the same map everything else is played on. A catch does not end
 * anything — it *starts* something: the two are pulled a metre and a half apart, everyone else is
 * locked out, and they box until one of them drops. The winner converts the loser to their own
 * species, so the population swings back and forth all round and the last thirty seconds are
 * usually the interesting ones.
 *
 * The design consequence worth stating: because losing turns you into the other side rather than
 * removing you, nobody is ever spectating. A player who loses every bout is still playing, just
 * on the other team.
 */
export class DuelMode extends RoundMode {
  private bouts: Bout[] = [];
  /** Species to restore a fighter to if their bout is abandoned (opponent disconnected). */
  private fighterSpecies = new Map<string, 'kangaroo' | 'human'>();

  protected override onRoundStart(ctx: ModeContext): void {
    this.bouts = [];
    this.fighterSpecies.clear();
    const players = ctx.rand.shuffle([...activePlayers(ctx)]);
    // A third start as kangaroos by default: enough pressure to matter, few enough that the
    // humans have a game. A player-authored config can change the ratio.
    const kangarooCount = chaserCount(this.def, players.length, 1 / 3);

    players.forEach((player, index) => {
      this.setSpecies(ctx, player, index < kangarooCount ? 'kangaroo' : 'human');
      ctx.respawn(player, index < kangarooCount ? 'chaser' : 'runner');
    });

    this.headline = `${kangarooCount} kangaroo${kangarooCount === 1 ? '' : 's'} on the hunt`;
  }

  private setSpecies(ctx: ModeContext, player: PlayerState, species: 'kangaroo' | 'human'): void {
    player.role = species === 'kangaroo' ? KANGAROO_ROLE : HUMAN_ROLE;
    player.animalId = species;
    player.roleTicks = 0;
    player.health = 100;
    player.stamina = 100;
    player.alive = true;
    ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: player.role });
  }

  protected override onPlaying(ctx: ModeContext): void {
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      player.roleTicks++;
      regenerateStamina(player, ctx.dt);
      if (player.role === HUMAN_ROLE) {
        const entry = this.entry(player.id);
        entry.score += SURVIVE_TICK_SCORE;
        entry.survivalTicks++;
      }
    }

    this.stepBouts(ctx);
    this.startNewBouts(ctx);

    const humans = this.countRole(ctx, HUMAN_ROLE);
    if (humans === 0 && this.bouts.length === 0 && ctx.players.size > 1) {
      this.finish(ctx, 'converted');
      return;
    }
    if (this.roundTicks % 60 === 0 && this.bouts.length === 0) {
      this.headline = `${humans} human${humans === 1 ? '' : 's'} left`;
    }
  }

  /** A catch pulls both fighters into a bout. Fighters cannot be caught, so bouts never nest. */
  private startNewBouts(ctx: ModeContext): void {
    const tags = findTags(
      ctx.players.values(),
      (p) => p.role === KANGAROO_ROLE && p.invulnTimer <= 0,
      (p) => p.role === HUMAN_ROLE && p.invulnTimer <= 0,
      DEFAULT_TAG_RULES,
    );

    for (const tag of tags) {
      const taggerEntry = this.entry(tag.tagger.id);
      taggerEntry.score += CATCH_SCORE;
      taggerEntry.tags++;
      this.beginBout(ctx, tag.tagger, tag.target);
    }
  }

  private beginBout(ctx: ModeContext, kangaroo: PlayerState, human: PlayerState): void {
    this.fighterSpecies.set(kangaroo.id, 'kangaroo');
    this.fighterSpecies.set(human.id, 'human');

    for (const fighter of [kangaroo, human]) {
      fighter.role = 'fighter';
      fighter.health = 100;
      fighter.stamina = 100;
      fighter.alive = true;
      fighter.velocity.x = 0;
      fighter.velocity.y = 0;
      fighter.velocity.z = 0;
      fighter.climbing = false;
      fighter.staggerTimer = 0;
      // Status effects do not carry into the ring: a bout is meant to be decided by the fight.
      fighter.gadgets.frozen = 0;
      fighter.gadgets.snared = 0;
    }

    this.faceOff(kangaroo, human);
    this.bouts.push({ kangarooId: kangaroo.id, humanId: human.id, remaining: BOUT_SECONDS });
    this.headline = `${kangaroo.name} caught ${human.name}!`;
    ctx.events.emit('roundState', kangaroo.id, human.position, ctx.tick, 0, {
      otherId: human.id,
      data: 'bout',
    });
  }

  /** Place the two a fixed distance apart, looking at each other, around where the catch happened. */
  private faceOff(a: PlayerState, b: PlayerState): void {
    const midX = (a.position.x + b.position.x) / 2;
    const midY = Math.max(a.position.y, b.position.y);
    const midZ = (a.position.z + b.position.z) / 2;

    let dx = b.position.x - a.position.x;
    let dz = b.position.z - a.position.z;
    const length = Math.hypot(dx, dz);
    // Landing exactly on top of each other leaves no axis to separate along; pick one.
    if (length < 1e-3) {
      dx = 0;
      dz = 1;
    } else {
      dx /= length;
      dz /= length;
    }

    const half = BOUT_SEPARATION / 2;
    a.position.x = midX - dx * half;
    a.position.y = midY;
    a.position.z = midZ - dz * half;
    b.position.x = midX + dx * half;
    b.position.y = midY;
    b.position.z = midZ + dz * half;
    a.yaw = Math.atan2(dx, dz);
    b.yaw = Math.atan2(-dx, -dz);
  }

  private stepBouts(ctx: ModeContext): void {
    for (let i = this.bouts.length - 1; i >= 0; i--) {
      const bout = this.bouts[i] as Bout;
      const kangaroo = ctx.players.get(bout.kangarooId);
      const human = ctx.players.get(bout.humanId);

      // Someone left mid-bout: the one still here wins by default rather than being stranded
      // as a 'fighter' with nobody to fight.
      if (!kangaroo || !human) {
        const survivor = kangaroo ?? human;
        if (survivor) this.restore(ctx, survivor);
        this.bouts.splice(i, 1);
        continue;
      }

      bout.remaining -= ctx.dt;

      const knockedOut = kangaroo.health <= 0 ? kangaroo : human.health <= 0 ? human : null;
      if (knockedOut) {
        this.resolveBout(ctx, bout, knockedOut === kangaroo ? human : kangaroo, knockedOut);
        this.bouts.splice(i, 1);
        continue;
      }

      if (bout.remaining <= 0) {
        // Decided on health. A dead-even bout goes to the human: they were the one being hunted,
        // and rewarding the aggressor for stalling would make catching-and-waiting a strategy.
        const winner = kangaroo.health > human.health ? kangaroo : human;
        const loser = winner === kangaroo ? human : kangaroo;
        this.resolveBout(ctx, bout, winner, loser);
        this.bouts.splice(i, 1);
      }
    }
  }

  /** The winner's species claims the loser. */
  private resolveBout(ctx: ModeContext, bout: Bout, winner: PlayerState, loser: PlayerState): void {
    const winnerSpecies = this.fighterSpecies.get(winner.id) ?? 'kangaroo';
    this.fighterSpecies.delete(winner.id);
    this.fighterSpecies.delete(loser.id);

    this.setSpecies(ctx, winner, winnerSpecies);
    this.setSpecies(ctx, loser, winnerSpecies);

    const entry = this.entry(winner.id);
    entry.score += WIN_BOUT_SCORE;
    if (winner.id === bout.kangarooId) entry.tags++;
    else this.entry(loser.id).escapes++;

    // Both walk away untouchable for a moment, so the loser is not immediately re-caught and the
    // winner is not jumped by a third party while the animation plays.
    winner.invulnTimer = POST_BOUT_IMMUNITY;
    loser.invulnTimer = POST_BOUT_IMMUNITY;
    winner.tagCooldown = POST_BOUT_IMMUNITY;
    loser.tagCooldown = POST_BOUT_IMMUNITY;

    this.headline = `${winner.name} converts ${loser.name}`;
    ctx.events.emit('roleChange', loser.id, loser.position, ctx.tick, 1, {
      otherId: winner.id,
      data: `converted:${winnerSpecies}`,
    });
  }

  /** Put an abandoned fighter back to the species they entered the bout as. */
  private restore(ctx: ModeContext, fighter: PlayerState): void {
    this.setSpecies(ctx, fighter, this.fighterSpecies.get(fighter.id) ?? 'human');
    this.fighterSpecies.delete(fighter.id);
    fighter.invulnTimer = POST_BOUT_IMMUNITY;
  }

  /**
   * Punches land inside the ring and nowhere else.
   *
   * Without this a kangaroo could simply beat a human to death in the open and never catch them,
   * and — more subtly — any two players brushing past each other would trade accidental punches,
   * each one granting a quarter-second of hit-immunity that the catch check reads as "untouchable".
   * Catches would silently fail for reasons no player could see.
   */
  canDamage(attacker: PlayerState, victim: PlayerState): boolean {
    return this.bouts.some(
      (bout) =>
        (bout.kangarooId === attacker.id && bout.humanId === victim.id) ||
        (bout.humanId === attacker.id && bout.kangarooId === victim.id),
    );
  }

  private countRole(ctx: ModeContext, role: PlayerState['role']): number {
    let n = 0;
    for (const p of ctx.players.values()) if (p.active && p.role === role) n++;
    return n;
  }

  override playerLeft(ctx: ModeContext, playerId: string): void {
    super.playerLeft(ctx, playerId);
    this.fighterSpecies.delete(playerId);
    // The bout itself is cleaned up on the next tick, where the survivor can be restored.
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    // Whoever is a kangaroo at the final bell won the round; if the humans held out, they did.
    const kangaroos = [...ctx.players.values()].filter((p) => p.active && p.role === KANGAROO_ROLE);
    const humans = [...ctx.players.values()].filter((p) => p.active && p.role === HUMAN_ROLE);
    const winners = kangaroos.length > humans.length ? kangaroos : humans;
    return winners.map((p) => p.id);
  }

  protected override winnerHeadline(ctx: ModeContext): string {
    if (this.winnerIds.length === 0) return 'Round over';
    const first = ctx.players.get(this.winnerIds[0] as string);
    return first?.role === KANGAROO_ROLE ? 'The kangaroos take the valley' : 'The humans held out';
  }

  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    // Join the smaller side, so arriving never decides the round.
    const kangaroos = this.countRole(ctx, KANGAROO_ROLE);
    const humans = this.countRole(ctx, HUMAN_ROLE);
    this.setSpecies(ctx, player, kangaroos <= humans ? 'kangaroo' : 'human');
    ctx.respawn(player, kangaroos <= humans ? 'chaser' : 'runner');
    player.invulnTimer = POST_BOUT_IMMUNITY;
  }

  /** Exposed for the HUD and tests: who is currently in the ring. */
  get activeBouts(): readonly Readonly<Bout>[] {
    return this.bouts;
  }

  /** Distance between the two fighters of a bout — used by tests and the spectator camera. */
  static boutDistance(ctx: ModeContext, bout: Bout): number {
    const a = ctx.players.get(bout.kangarooId);
    const b = ctx.players.get(bout.humanId);
    return a && b ? v3distance(a.position, b.position) : Infinity;
  }
}

registerMode(DUEL_DEF, (def) => new DuelMode(def));
