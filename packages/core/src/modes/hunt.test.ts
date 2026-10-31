import { describe, expect, it } from 'vitest';

import { getGadget } from '../gadgets/catalog.js';
import { applyPayload } from '../gadgets/runtime.js';
import { selectedGadget } from '../gadgets/state.js';
import { buildJungleWorld } from '../world/jungle.js';
import { Simulation, TICK_DT } from '../sim/simulation.js';
import type { PlayerState } from '../player/state.js';
import { HUNT_DEF, HuntMode } from './hunt.js';
import './hunt.js';

/** Run a hunt to the point where roles have been dealt. */
function startedHunt(playerCount = 4) {
  const sim = new Simulation({ level: buildJungleWorld(), modeId: 'hunt', seed: 7 });
  for (let i = 0; i < playerCount; i++) sim.addPlayer({ id: `p${i}`, name: `P${i}` });
  // waiting → countdown → playing
  sim.stepMany(Math.ceil((HUNT_DEF.countdownSeconds + 1) / TICK_DT));
  return sim;
}

function byRole(sim: Simulation, role: PlayerState['role']): PlayerState[] {
  return [...sim.players.values()].filter((p) => p.role === role);
}

describe('the hunt', () => {
  it('deals exactly one hunter in a small lobby, and humans for the rest', () => {
    const sim = startedHunt(4);
    expect(byRole(sim, 'hunter')).toHaveLength(1);
    expect(byRole(sim, 'survivor')).toHaveLength(3);
  });

  it('scales to one hunter per six players', () => {
    expect(byRole(startedHunt(12), 'hunter')).toHaveLength(2);
  });

  it('makes the hunter a kangaroo and everyone else human', () => {
    const sim = startedHunt(4);
    expect(byRole(sim, 'hunter')[0]?.animalId).toBe('kangaroo');
    for (const survivor of byRole(sim, 'survivor')) expect(survivor.animalId).toBe('human');
  });

  it('issues the hunter a loaded rifle', () => {
    const hunter = byRole(startedHunt(4), 'hunter')[0] as PlayerState;
    expect(selectedGadget(hunter.gadgets)).toBe('hunter_rifle');
    expect(hunter.gadgets.charges.hunter_net).toBe(getGadget('hunter_net')?.uses);
  });

  it('starts survivors empty-handed with cash instead of gear', () => {
    const survivor = byRole(startedHunt(4), 'survivor')[0] as PlayerState;
    expect(survivor.gadgets.slots).toEqual([null, null, null]);
    // The helper steps a second past the bell, so the float has already started earning; the
    // point is that they began with it, not that no time has passed.
    expect(survivor.gadgets.cash).toBeGreaterThanOrEqual(HUNT_DEF.startingCash ?? 0);
    expect(survivor.gadgets.cash).toBeLessThan((HUNT_DEF.startingCash ?? 0) + 60);
  });

  /**
   * The fairness claim for this mode, tested rather than asserted in a comment: a player who
   * owns every gadget in the game starts a Hunt with exactly what a brand-new account starts
   * with, because the mode clears loadouts at the bell.
   */
  it('ignores what a player owns — a whale and a new account start identically', () => {
    const sim = new Simulation({ level: buildJungleWorld(), modeId: 'hunt', seed: 7 });
    sim.addPlayer({ id: 'whale', loadout: { primary: 'freeze_gun', secondary: 'bear_trap', armour: 'steel_vest' } });
    sim.addPlayer({ id: 'newbie' });
    sim.addPlayer({ id: 'third' });
    sim.stepMany(Math.ceil((HUNT_DEF.countdownSeconds + 1) / TICK_DT));

    for (const player of sim.players.values()) {
      if (player.role !== 'survivor') continue;
      expect(player.gadgets.slots, player.id).toEqual([null, null, null]);
      expect(player.gadgets.armour, player.id).toBe(0);
    }
  });

  it('pays survivors for staying alive', () => {
    const sim = startedHunt(4);
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;
    const before = survivor.gadgets.cash;
    sim.stepMany(60 * 5);
    expect(survivor.gadgets.cash).toBeGreaterThan(before);
  });

  it('does not pay the hunter', () => {
    const sim = startedHunt(4);
    const hunter = byRole(sim, 'hunter')[0] as PlayerState;
    sim.stepMany(60 * 5);
    expect(hunter.gadgets.cash).toBe(0);
  });
});

describe('the in-round shop', () => {
  function huntWith(playerCount = 4) {
    const sim = startedHunt(playerCount);
    const mode = sim.mode as HuntMode;
    // `results` needs a context; the mode owns one internally, so reach it the way the sim does.
    return { sim, mode };
  }

  it('sells a survivor a vest and charges them for it', () => {
    const { sim, mode } = huntWith();
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;
    survivor.gadgets.cash = 1000;

    const ctx = (sim as unknown as { modeCtx: Parameters<HuntMode['purchase']>[0] }).modeCtx;
    expect(mode.purchase(ctx, survivor, 'steel_vest')).toBe(true);
    expect(survivor.gadgets.armour).toBe(60);
    expect(survivor.gadgets.cash).toBe(1000 - (getGadget('steel_vest')?.roundCost ?? 0));
  });

  /**
   * Buying and then not being able to fire it was the actual bug: the gadget went into its own
   * slot, the selection stayed on the empty primary, and the fire button did nothing — which
   * from the player's chair is indistinguishable from the gadget being broken.
   */
  it('hands the survivor the thing they just bought, ready to fire', () => {
    const { sim, mode } = huntWith();
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;
    survivor.gadgets.cash = 1000;

    const ctx = (sim as unknown as { modeCtx: Parameters<HuntMode['purchase']>[0] }).modeCtx;
    expect(mode.purchase(ctx, survivor, 'smoke_bomb')).toBe(true);
    expect(selectedGadget(survivor.gadgets)).toBe('smoke_bomb');
  });

  /**
   * The case `setSlot`'s own repair does not cover: the player already holds something usable,
   * so the selection is valid and stays put — leaving the thing they just paid for sitting in a
   * slot they have to know to cycle to.
   */
  it('switches to the new purchase even when already holding something', () => {
    const { sim, mode } = huntWith();
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;
    survivor.gadgets.cash = 2000;

    const ctx = (sim as unknown as { modeCtx: Parameters<HuntMode['purchase']>[0] }).modeCtx;
    mode.purchase(ctx, survivor, 'freeze_gun');
    expect(selectedGadget(survivor.gadgets)).toBe('freeze_gun');

    mode.purchase(ctx, survivor, 'smoke_bomb');
    expect(selectedGadget(survivor.gadgets)).toBe('smoke_bomb');
  });

  it('does not point the fire button at a vest, which cannot be fired', () => {
    const { sim, mode } = huntWith();
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;
    survivor.gadgets.cash = 1000;

    const ctx = (sim as unknown as { modeCtx: Parameters<HuntMode['purchase']>[0] }).modeCtx;
    mode.purchase(ctx, survivor, 'smoke_bomb');
    mode.purchase(ctx, survivor, 'steel_vest');
    // The vest is worn, not held: buying it must not steal the selection from the bomb.
    expect(survivor.gadgets.armour).toBe(60);
    expect(selectedGadget(survivor.gadgets)).toBe('smoke_bomb');
  });

  it('refuses a purchase the survivor cannot afford, and takes no cash', () => {
    const { sim, mode } = huntWith();
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;
    survivor.gadgets.cash = 10;

    const ctx = (sim as unknown as { modeCtx: Parameters<HuntMode['purchase']>[0] }).modeCtx;
    expect(mode.purchase(ctx, survivor, 'steel_vest')).toBe(false);
    expect(survivor.gadgets.cash).toBe(10);
    expect(survivor.gadgets.armour).toBe(0);
  });

  it('will not sell the hunter anything', () => {
    const { sim, mode } = huntWith();
    const hunter = byRole(sim, 'hunter')[0] as PlayerState;
    hunter.gadgets.cash = 99999;

    const ctx = (sim as unknown as { modeCtx: Parameters<HuntMode['purchase']>[0] }).modeCtx;
    expect(mode.purchase(ctx, hunter, 'steel_vest')).toBe(false);
  });

  it('does not stock role-locked gear, so the rifle can never be bought', () => {
    const stock = HuntMode.stock().map((s) => s.id);
    expect(stock).not.toContain('hunter_rifle');
    expect(stock).not.toContain('hunter_net');
    expect(stock).toContain('freeze_gun');
    expect(stock).toContain('smoke_bomb');
    expect(stock).toContain('steel_vest');
    expect(stock).toContain('steel_helmet');
  });

  it('refuses the rifle even when asked for it directly', () => {
    const { sim, mode } = huntWith();
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;
    survivor.gadgets.cash = 99999;

    const ctx = (sim as unknown as { modeCtx: Parameters<HuntMode['purchase']>[0] }).modeCtx;
    expect(mode.purchase(ctx, survivor, 'hunter_rifle')).toBe(false);
    expect(selectedGadget(survivor.gadgets)).toBeNull();
  });

  it('prices the shop so a survivor can afford roughly two things per round', () => {
    // Design intent, pinned: 600 to start plus 12/s over four minutes is ~3,480, and the whole
    // shelf costs less than that — a survivor should be choosing, not saving.
    const total = HuntMode.stock().reduce((sum, item) => sum + item.cost, 0);
    const earned = (HUNT_DEF.startingCash ?? 0) + 12 * HUNT_DEF.roundSeconds;
    expect(total).toBeLessThan(earned);
    expect(HuntMode.stock()[0]?.cost).toBeLessThanOrEqual(HUNT_DEF.startingCash ?? 0);
  });
});

describe('who may hit whom', () => {
  it('lets the hunter hurt survivors and survivors hurt the hunter', () => {
    const sim = startedHunt(4);
    const mode = sim.mode as HuntMode;
    const hunter = byRole(sim, 'hunter')[0] as PlayerState;
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;

    expect(mode.canDamage(hunter, survivor)).toBe(true);
    expect(mode.canDamage(survivor, hunter)).toBe(true);
  });

  it('refuses survivor-on-survivor damage, so griefing cannot decide a hunt', () => {
    const sim = startedHunt(4);
    const mode = sim.mode as HuntMode;
    const [a, b] = byRole(sim, 'survivor') as [PlayerState, PlayerState];
    expect(mode.canDamage(a, b)).toBe(false);
  });

  it('stops a rifle round from landing on someone the mode says is off limits', () => {
    const sim = startedHunt(4);
    const [a, b] = byRole(sim, 'survivor') as [PlayerState, PlayerState];
    b.gadgets.armour = 60;
    const rifle = getGadget('hunter_rifle');
    expect(rifle).toBeDefined();
    if (!rifle) return;

    const ctx = (sim as unknown as { gadgetCtx: Parameters<typeof applyPayload>[3] }).gadgetCtx;
    applyPayload(rifle, b, a, ctx);

    expect(b.health).toBe(100);
    expect(b.gadgets.armour).toBe(60);
  });
});

describe('ending a hunt', () => {
  it('gives the round to the humans who lasted the clock', () => {
    const sim = startedHunt(4);
    sim.endRound('time');
    const result = sim.results();
    const survivors = byRole(sim, 'survivor').map((p) => p.id);
    expect(result.winnerIds.toSorted()).toEqual(survivors.toSorted());
  });

  it('gives it to the hunter once every human is down', () => {
    const sim = startedHunt(4);
    const hunter = byRole(sim, 'hunter')[0] as PlayerState;
    for (const survivor of byRole(sim, 'survivor')) {
      survivor.health = 0;
      survivor.lastTaggedBy = hunter.id;
    }

    // Down them, then run past the down timer so they become spectators and the round ends.
    sim.stepMany(60 * 5);

    expect(sim.finished()).toBe(true);
    expect(sim.results().winnerIds).toEqual([hunter.id]);
  });

  it('scores the hunter for each human they put down', () => {
    const sim = startedHunt(4);
    const hunter = byRole(sim, 'hunter')[0] as PlayerState;
    const victim = byRole(sim, 'survivor')[0] as PlayerState;
    victim.health = 0;
    victim.lastTaggedBy = hunter.id;
    sim.stepMany(2);

    const entry = sim.results().players.find((p) => p.playerId === hunter.id);
    expect(entry?.tags).toBe(1);
    expect(entry?.score).toBeGreaterThan(0);
  });
});
