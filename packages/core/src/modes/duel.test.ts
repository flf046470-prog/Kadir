import { describe, expect, it } from 'vitest';

import { buildJungleWorld } from '../world/jungle.js';
import { Simulation, TICK_DT } from '../sim/simulation.js';
import type { PlayerState } from '../player/state.js';
import { DUEL_DEF, DuelMode } from './duel.js';
import './duel.js';

function startedDuel(playerCount = 6, seed = 11) {
  const sim = new Simulation({ level: buildJungleWorld(), modeId: 'duel', seed });
  for (let i = 0; i < playerCount; i++) sim.addPlayer({ id: `p${i}`, name: `P${i}` });
  sim.stepMany(Math.ceil((DUEL_DEF.countdownSeconds + 0.5) / TICK_DT));
  return sim;
}

function byRole(sim: Simulation, role: PlayerState['role']): PlayerState[] {
  return [...sim.players.values()].filter((p) => p.role === role);
}

/** Put a kangaroo close enough to a human that the tag rules fire. */
function bringTogether(kangaroo: PlayerState, human: PlayerState): void {
  human.position.x = kangaroo.position.x + 0.4;
  human.position.y = kangaroo.position.y;
  human.position.z = kangaroo.position.z;
  kangaroo.invulnTimer = 0;
  human.invulnTimer = 0;
  kangaroo.tagCooldown = 0;
  human.tagCooldown = 0;
}

describe('starting a duel round', () => {
  it('splits the lobby roughly one kangaroo to two humans', () => {
    const sim = startedDuel(6);
    expect(byRole(sim, 'chaser')).toHaveLength(2);
    expect(byRole(sim, 'runner')).toHaveLength(4);
  });

  it('always deals at least one kangaroo, even in a two-player room', () => {
    const sim = startedDuel(2);
    expect(byRole(sim, 'chaser').length).toBeGreaterThanOrEqual(1);
  });

  it('gives each side the matching body', () => {
    const sim = startedDuel(6);
    for (const p of byRole(sim, 'chaser')) expect(p.animalId).toBe('kangaroo');
    for (const p of byRole(sim, 'runner')) expect(p.animalId).toBe('human');
  });
});

describe('a catch starts a bout', () => {
  it('pulls both fighters into the ring', () => {
    const sim = startedDuel(6);
    const mode = sim.mode as DuelMode;
    const kangaroo = byRole(sim, 'chaser')[0] as PlayerState;
    const human = byRole(sim, 'runner')[0] as PlayerState;

    bringTogether(kangaroo, human);
    sim.stepMany(2);

    expect(mode.activeBouts).toHaveLength(1);
    expect(kangaroo.role).toBe('fighter');
    expect(human.role).toBe('fighter');
  });

  it('places them apart and facing each other', () => {
    const sim = startedDuel(6);
    const mode = sim.mode as DuelMode;
    const kangaroo = byRole(sim, 'chaser')[0] as PlayerState;
    const human = byRole(sim, 'runner')[0] as PlayerState;

    bringTogether(kangaroo, human);
    sim.stepMany(1);

    const bout = mode.activeBouts[0];
    expect(bout).toBeDefined();
    // Separated rather than standing inside each other, and within arm's reach.
    const gap = Math.hypot(kangaroo.position.x - human.position.x, kangaroo.position.z - human.position.z);
    expect(gap).toBeGreaterThan(1);
    expect(gap).toBeLessThan(2.5);
  });

  it('resets both to full health, so a worn-down chaser is not doomed', () => {
    const sim = startedDuel(6);
    const kangaroo = byRole(sim, 'chaser')[0] as PlayerState;
    const human = byRole(sim, 'runner')[0] as PlayerState;
    kangaroo.health = 12;

    bringTogether(kangaroo, human);
    sim.stepMany(1);

    expect(kangaroo.health).toBe(100);
    expect(human.health).toBe(100);
  });

  it('locks everyone else out — a fighter cannot be caught by a third party', () => {
    const sim = startedDuel(6);
    const mode = sim.mode as DuelMode;
    const [kangarooA, kangarooB] = byRole(sim, 'chaser') as [PlayerState, PlayerState];
    const human = byRole(sim, 'runner')[0] as PlayerState;

    bringTogether(kangarooA, human);
    sim.stepMany(2);
    // Now walk the second kangaroo straight into the ring.
    kangarooB.position.x = human.position.x + 0.3;
    kangarooB.position.y = human.position.y;
    kangarooB.position.z = human.position.z;
    kangarooB.invulnTimer = 0;
    kangarooB.tagCooldown = 0;
    sim.stepMany(4);

    expect(mode.activeBouts).toHaveLength(1);
    expect(kangarooB.role).toBe('chaser');
  });
});

describe('winning a bout', () => {
  function boutOf(sim: Simulation): { kangaroo: PlayerState; human: PlayerState } {
    const kangaroo = byRole(sim, 'chaser')[0] as PlayerState;
    const human = byRole(sim, 'runner')[0] as PlayerState;
    bringTogether(kangaroo, human);
    sim.stepMany(2);
    return { kangaroo, human };
  }

  it('converts the loser to the winner’s species', () => {
    const sim = startedDuel(6);
    const { kangaroo, human } = boutOf(sim);

    human.health = 0;
    sim.stepMany(2);

    expect(human.role).toBe('chaser');
    expect(human.animalId).toBe('kangaroo');
    expect(kangaroo.role).toBe('chaser');
  });

  it('works the other way too — a human who wins takes the kangaroo', () => {
    const sim = startedDuel(6);
    const { kangaroo, human } = boutOf(sim);

    kangaroo.health = 0;
    sim.stepMany(2);

    expect(kangaroo.role).toBe('runner');
    expect(kangaroo.animalId).toBe('human');
    expect(human.role).toBe('runner');
  });

  it('leaves both untouchable for a moment so the loser is not instantly re-caught', () => {
    const sim = startedDuel(6);
    const { kangaroo, human } = boutOf(sim);
    human.health = 0;
    sim.stepMany(2);

    expect(human.invulnTimer).toBeGreaterThan(0);
    expect(kangaroo.invulnTimer).toBeGreaterThan(0);
  });

  it('decides a bout that runs out of time on health', () => {
    const sim = startedDuel(6);
    const { kangaroo, human } = boutOf(sim);
    human.health = 30;
    kangaroo.health = 80;

    sim.stepMany(Math.ceil(21 / TICK_DT));

    expect(human.role).toBe('chaser');
    expect(human.animalId).toBe('kangaroo');
  });

  it('gives a dead-even bout to the human, so stalling a catch does not pay', () => {
    const sim = startedDuel(6);
    const { kangaroo, human } = boutOf(sim);
    human.health = 100;
    kangaroo.health = 100;

    sim.stepMany(Math.ceil(21 / TICK_DT));

    expect(human.role).toBe('runner');
    expect(kangaroo.role).toBe('runner');
    expect(kangaroo.animalId).toBe('human');
  });

  it('never leaves a fighter stranded when their opponent disconnects', () => {
    const sim = startedDuel(6);
    const mode = sim.mode as DuelMode;
    const { kangaroo, human } = boutOf(sim);

    sim.removePlayer(human.id);
    sim.stepMany(2);

    expect(mode.activeBouts).toHaveLength(0);
    expect(kangaroo.role).toBe('chaser');
  });
});

/**
 * Regression cover for the bug this mode found: with combat enabled globally, two players simply
 * standing near each other traded punches, and each punch granted 0.25 s of hit-immunity that the
 * catch check read as "untouchable". Catches failed for a reason invisible to the player.
 */
describe('who may hit whom', () => {
  it('lets the two fighters of a bout hit each other', () => {
    const sim = startedDuel(6);
    const mode = sim.mode as DuelMode;
    const kangaroo = byRole(sim, 'chaser')[0] as PlayerState;
    const human = byRole(sim, 'runner')[0] as PlayerState;
    bringTogether(kangaroo, human);
    sim.stepMany(2);

    expect(mode.canDamage(kangaroo, human)).toBe(true);
    expect(mode.canDamage(human, kangaroo)).toBe(true);
  });

  it('refuses every punch thrown outside a bout', () => {
    const sim = startedDuel(6);
    const mode = sim.mode as DuelMode;
    const kangaroo = byRole(sim, 'chaser')[0] as PlayerState;
    const human = byRole(sim, 'runner')[0] as PlayerState;

    expect(mode.canDamage(kangaroo, human)).toBe(false);
    expect(mode.canDamage(human, kangaroo)).toBe(false);
  });

  it('refuses a third party punching into a bout', () => {
    const sim = startedDuel(6);
    const mode = sim.mode as DuelMode;
    const [kangarooA, kangarooB] = byRole(sim, 'chaser') as [PlayerState, PlayerState];
    const human = byRole(sim, 'runner')[0] as PlayerState;
    bringTogether(kangarooA, human);
    sim.stepMany(2);

    expect(mode.canDamage(kangarooB, human)).toBe(false);
    expect(mode.canDamage(human, kangarooB)).toBe(false);
  });

  it('does not let two players standing together punch away each other’s catchability', () => {
    const sim = startedDuel(6);
    const kangaroo = byRole(sim, 'chaser')[0] as PlayerState;
    const human = byRole(sim, 'runner')[0] as PlayerState;
    bringTogether(kangaroo, human);
    // One tick is all it takes: before the fix, the accidental punch fired here and the catch
    // on the same tick was swallowed by the immunity it granted.
    sim.stepMany(1);

    expect(human.role).toBe('fighter');
    expect(kangaroo.role).toBe('fighter');
  });
});

describe('ending a duel round', () => {
  it('ends early once nobody is human any more', () => {
    const sim = startedDuel(3);
    for (const player of sim.players.values()) {
      player.role = 'chaser';
      player.animalId = 'kangaroo';
    }
    sim.stepMany(2);
    expect(sim.finished()).toBe(true);
  });

  it('gives the round to whichever species is larger at the bell', () => {
    const sim = startedDuel(6);
    sim.endRound('time');
    const humans = byRole(sim, 'runner').map((p) => p.id);
    expect(sim.results().winnerIds.toSorted()).toEqual(humans.toSorted());
  });

  it('leaves nobody spectating — losing puts you on the other team', () => {
    const sim = startedDuel(6);
    const { human } = (() => {
      const kangaroo = byRole(sim, 'chaser')[0] as PlayerState;
      const h = byRole(sim, 'runner')[0] as PlayerState;
      bringTogether(kangaroo, h);
      sim.stepMany(2);
      h.health = 0;
      sim.stepMany(2);
      return { human: h };
    })();

    expect(human.role).not.toBe('spectator');
    expect(human.alive).toBe(true);
    for (const player of sim.players.values()) {
      expect(['chaser', 'runner', 'fighter'], player.id).toContain(player.role);
    }
  });
});
