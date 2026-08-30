import { getGadget, listGadgets } from '../gadgets/catalog.js';
import { grantRoleGadgets } from '../gadgets/loadout.js';
import { setSlot } from '../gadgets/state.js';
import type { PlayerState } from '../player/state.js';
import { RoundMode, activePlayers } from './base.js';
import { registerMode } from './registry.js';
import type { GameModeDef, ModeContext } from './types.js';

export const HUNT_DEF: GameModeDef = {
  id: 'hunt',
  name: 'The Hunt',
  description: 'One armed kangaroo. Everyone else is human, unarmed, and has four minutes to live.',
  minPlayers: 2,
  maxPlayers: 12,
  roundSeconds: 240,
  countdownSeconds: 8,
  icon: 'hunt',
  combat: true,
  tagging: false,
  startingCash: 600,
};

/** Points per second alive as a survivor. */
const SURVIVE_TICK_SCORE = 1 / 30;
/** Round cash per second alive — the reason hiding early pays for equipment later. */
const CASH_PER_SECOND = 12;
/** What the hunter scores for putting a survivor down. */
const DOWN_SCORE = 40;
/** What a survivor scores for lasting the whole round. */
const ESCAPE_SCORE = 120;
/** Seconds a downed survivor waits before returning as a spectator ghost. */
const DOWN_SECONDS = 3;

/**
 * The Hunt.
 *
 * One player is a kangaroo with a rifle and a net. Everyone else is a human with empty hands and
 * a clock to outlast. Survivors earn round cash simply by being alive and spend it, mid-round, on
 * the gear that keeps them that way: a freeze gun to buy three seconds, smoke to break line of
 * sight, a snare on the ledge behind them, a vest for when none of that worked.
 *
 * **Nothing anyone owns matters here.** Loadouts are cleared at the bell and every gadget is
 * bought with round cash at the same price by everyone, which makes this the mode where the
 * monetisation cannot touch the outcome even in principle. Buying a gadget for $0.99 puts it in
 * your *starting* loadout for the casual modes; it buys nothing in a Hunt.
 */
export class HuntMode extends RoundMode {
  private downTimers = new Map<string, number>();
  private hunterIds: string[] = [];
  private cashCarry = new Map<string, number>();

  protected override onRoundStart(ctx: ModeContext): void {
    this.downTimers.clear();
    this.cashCarry.clear();
    const players = ctx.rand.shuffle([...activePlayers(ctx)]);
    // One hunter per six players, so a big lobby is not a formality for the survivors.
    const hunterCount = Math.max(1, Math.floor(players.length / 6));
    this.hunterIds = players.slice(0, hunterCount).map((p) => p.id);

    players.forEach((player, index) => {
      const hunter = index < hunterCount;
      this.arm(ctx, player, hunter);
      ctx.respawn(player, hunter ? 'chaser' : 'runner');
    });

    this.headline = hunterCount > 1 ? `${hunterCount} hunters are loose` : 'Survive the hunt';
  }

  /** Put a player into a role and give them exactly the equipment that role starts with. */
  private arm(ctx: ModeContext, player: PlayerState, hunter: boolean): void {
    player.role = hunter ? 'hunter' : 'survivor';
    player.animalId = hunter ? 'kangaroo' : 'human';
    player.health = 100;
    player.alive = true;
    player.roleTicks = 0;

    // Cleared, not merged: whatever they equipped in the lobby has no bearing on a Hunt.
    player.gadgets.slots = [null, null, null];
    player.gadgets.charges = {};
    player.gadgets.cooldowns = {};
    player.gadgets.armour = 0;

    if (hunter) {
      grantRoleGadgets(player.gadgets, 'hunter', ['hunter_rifle', 'hunter_net']);
      // Charges for issued gear: `resetForRound` already ran, before the role existed.
      for (const id of ['hunter_rifle', 'hunter_net']) {
        const def = getGadget(id);
        if (def && def.uses > 0) player.gadgets.charges[id] = def.uses;
      }
      player.gadgets.cash = 0;
    } else {
      player.gadgets.cash = this.def.startingCash ?? 0;
    }
    player.gadgets.selected = 0;
    ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: player.role });
  }

  protected override onPlaying(ctx: ModeContext): void {
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      const entry = this.entry(player.id);
      player.roleTicks++;

      if (player.role === 'survivor') {
        if (!player.alive) {
          this.tickDownTimer(ctx, player);
          continue;
        }
        if (player.health <= 0) {
          this.putDown(ctx, player);
          continue;
        }
        entry.survivalTicks++;
        entry.score += SURVIVE_TICK_SCORE;
        this.accrueCash(player, ctx.dt);
      }
    }

    const remaining = this.countSurvivors(ctx);
    if (remaining === 0 && this.countRole(ctx, 'survivor') > 0) {
      this.finish(ctx, 'hunted');
      return;
    }
    if (this.roundTicks % 60 === 0) {
      this.headline = remaining === 1 ? 'One human left' : `${remaining} humans left`;
    }
  }

  /**
   * Round cash accrues in whole units.
   *
   * The fractional part is carried rather than rounded away each tick, because at 60 Hz a naive
   * `Math.floor(12 / 60)` is zero and a survivor would earn nothing for the entire round.
   */
  private accrueCash(player: PlayerState, dt: number): void {
    const carry = (this.cashCarry.get(player.id) ?? 0) + CASH_PER_SECOND * dt;
    const whole = Math.floor(carry);
    if (whole > 0) player.gadgets.cash += whole;
    this.cashCarry.set(player.id, carry - whole);
  }

  private putDown(ctx: ModeContext, victim: PlayerState): void {
    victim.alive = false;
    victim.health = 0;
    this.downTimers.set(victim.id, DOWN_SECONDS);
    const hunterId = victim.lastTaggedBy;
    if (hunterId && this.hunterIds.includes(hunterId)) {
      const entry = this.entry(hunterId);
      entry.score += DOWN_SCORE;
      entry.tags++;
    }
    this.headline = `${victim.name} is down`;
    ctx.events.emit('roleChange', victim.id, victim.position, ctx.tick, 0, { data: 'down' });
  }

  /** A downed survivor becomes a spectator rather than respawning — the clock is the point. */
  private tickDownTimer(ctx: ModeContext, player: PlayerState): void {
    const remaining = (this.downTimers.get(player.id) ?? DOWN_SECONDS) - ctx.dt;
    if (remaining > 0) {
      this.downTimers.set(player.id, remaining);
      return;
    }
    this.downTimers.delete(player.id);
    player.role = 'spectator';
    player.gadgets.slots = [null, null, null];
    ctx.events.emit('roleChange', player.id, player.position, ctx.tick, 0, { data: 'spectator' });
  }

  /**
   * The in-round shop.
   *
   * Survivors only, and never the hunter: the hunter's kit is issued, and letting them buy a vest
   * with cash they do not earn would be a second economy nobody asked for. Role-locked gear is
   * not on the shelf at all, so this cannot hand out a rifle.
   */
  purchase(ctx: ModeContext, player: PlayerState, gadgetId: string): boolean {
    if (this.phase !== 'playing') return false;
    if (player.role !== 'survivor' || !player.alive) return false;
    const def = getGadget(gadgetId);
    if (!def || def.roles.length > 0) return false;
    if (player.gadgets.cash < def.roundCost) return false;

    player.gadgets.cash -= def.roundCost;
    setSlot(player.gadgets, gadgetId);
    if (def.uses > 0) player.gadgets.charges[gadgetId] = def.uses;
    if (def.payload.on === 'armour') player.gadgets.armour = def.payload.points;
    delete player.gadgets.cooldowns[gadgetId];

    ctx.events.emit('gadgetUse', player.id, player.position, ctx.tick, def.roundCost, { data: `buy:${gadgetId}` });
    return true;
  }

  /**
   * Hunters hurt survivors and survivors hurt hunters — nothing else.
   *
   * Survivor-on-survivor damage would make griefing the dominant strategy in a mode whose whole
   * tension is that the humans need each other, and it would let one player hand the hunt to the
   * kangaroo for free.
   */
  canDamage(attacker: PlayerState, victim: PlayerState): boolean {
    if (attacker.role === 'hunter') return victim.role === 'survivor';
    if (attacker.role === 'survivor') return victim.role === 'hunter';
    return false;
  }

  private countSurvivors(ctx: ModeContext): number {
    let n = 0;
    for (const p of ctx.players.values()) if (p.active && p.role === 'survivor' && p.alive) n++;
    return n;
  }

  private countRole(ctx: ModeContext, role: PlayerState['role']): number {
    let n = 0;
    for (const p of ctx.players.values()) if (p.active && p.role === role) n++;
    return n;
  }

  protected override computeWinners(ctx: ModeContext): string[] {
    const alive = [...ctx.players.values()].filter((p) => p.active && p.role === 'survivor' && p.alive);
    if (alive.length > 0) {
      // Survivors win as a group. Lasting the round is the achievement; who scored most is not.
      for (const player of alive) {
        const entry = this.entry(player.id);
        entry.score += ESCAPE_SCORE;
        entry.escapes = 1;
      }
      return alive.map((p) => p.id);
    }
    return this.hunterIds.filter((id) => ctx.players.has(id));
  }

  protected override winnerHeadline(ctx: ModeContext): string {
    if (this.winnerIds.length === 0) return 'Round over';
    const first = ctx.players.get(this.winnerIds[0] as string);
    if (first?.role === 'hunter') return 'The hunter takes them all';
    return this.winnerIds.length === 1 ? `${first?.name ?? 'One human'} survived` : `${this.winnerIds.length} humans survived`;
  }

  /** Someone arriving mid-hunt joins as a survivor with a starting float, not as a ghost. */
  protected override onLateJoin(ctx: ModeContext, player: PlayerState): void {
    this.arm(ctx, player, false);
    ctx.respawn(player, 'runner');
  }

  /** What the in-round shop offers, in the order a survivor would want to read it. */
  shopStock(): { id: string; name: string; cost: number }[] {
    return HuntMode.stock();
  }

  /** Static twin, so the shelf can be inspected without a running round (HUD previews, tests). */
  static stock(): { id: string; name: string; cost: number }[] {
    return listGadgets()
      .filter((g) => g.roles.length === 0)
      .map((g) => ({ id: g.id, name: g.name, cost: g.roundCost }))
      .toSorted((a, b) => a.cost - b.cost);
  }
}

registerMode(HUNT_DEF, (def) => new HuntMode(def));
