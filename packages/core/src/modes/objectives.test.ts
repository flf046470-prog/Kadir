import { describe, expect, it } from 'vitest';

import { buildJungleWorld } from '../world/jungle.js';
import { Simulation, TICK_DT } from '../sim/simulation.js';
import { Bot, botName } from '../ai/bot.js';
import { BOXING_DEF } from './boxing.js';
import './index.js';

const level = buildJungleWorld();

/** An angle folded into (-PI, PI], so "how far off zero" is a single number. */
function shortest(angle: number): number {
  const TAU = Math.PI * 2;
  let d = angle % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Start a mode and run it to `playing`. */
function started(modeId: string, playerCount = 6, seed = 1000) {
  const sim = new Simulation({ level, modeId, seed });
  for (let i = 0; i < playerCount; i++) sim.addPlayer({ id: `bot${i}`, name: botName(i) });
  sim.stepMany(Math.ceil(12 / TICK_DT));
  return sim;
}

/** Drive every player with a bot for `seconds`, handing each the mode's own objective. */
function playOut(sim: Simulation, seconds: number): void {
  const bots = [...sim.players.keys()].map((id, i) => new Bot(id, { skill: 0.45 + (i % 4) * 0.15, seed: 500 + i }));
  for (let tick = 0; tick < 60 * seconds; tick++) {
    for (const bot of bots) {
      const self = sim.players.get(bot.playerId);
      if (!self) continue;
      const objective = sim.mode.objectiveFor?.(self) ?? null;
      sim.setIntent(bot.playerId, bot.think(self, sim.players.values(), level, 1 / 60, objective), false);
    }
    sim.step();
  }
}

/**
 * VR Boxing, whose one job is counting knockouts.
 *
 * The mode's own description is "Most knockouts wins" and it awarded nothing for any of them.
 * `knockOut` was called from a `player.health <= 0` check that could never run: `resolvePunches`
 * sets `alive = false` on the same tick it takes health to zero, and the `!player.alive` branch
 * above it always `continue`d first. Measured over a 200-second round of bots before the fix —
 * 342 punches landed, 25 fighters knocked down, 0 knockouts scored, all six players tied on zero
 * and all six declared the winner.
 */
describe('boxing counts its knockouts', () => {
  it('credits the puncher when a fighter goes down', () => {
    const sim = started('boxing', 2);
    const [a, b] = [...sim.players.values()];
    expect(a && b).toBeTruthy();
    if (!a || !b) return;

    b.lastTaggedBy = a.id;
    b.health = 0;
    b.alive = false;
    sim.stepMany(2);

    const results = sim.results().players;
    const attacker = results.find((p) => p.playerId === a.id);
    expect(attacker?.score, 'the puncher scored nothing for a knockout').toBeGreaterThan(0);
    expect(attacker?.tags).toBe(1);
  });

  it('puts the downed fighter back in after the count', () => {
    const sim = started('boxing', 2);
    const [, b] = [...sim.players.values()];
    if (!b) return;
    b.health = 0;
    b.alive = false;
    sim.stepMany(2);
    expect(b.alive).toBe(false);
    // The respawn clock is four seconds; a little past it they are fighting again on full health.
    sim.stepMany(Math.ceil(5 / TICK_DT));
    expect(b.alive).toBe(true);
    expect(b.health).toBe(100);
  });

  it('scores a knockout once, not once per tick while down', () => {
    // The knockout is read from the alive→down transition, so the guard is that staying down
    // does not keep paying. Without it a single knockout would be worth hundreds of points.
    const sim = started('boxing', 2);
    const [a, b] = [...sim.players.values()];
    if (!a || !b) return;
    b.lastTaggedBy = a.id;
    b.health = 0;
    b.alive = false;
    sim.stepMany(2);
    const afterOne = sim.results().players.find((p) => p.playerId === a.id)?.score ?? 0;
    sim.stepMany(120);
    const afterWaiting = sim.results().players.find((p) => p.playerId === a.id)?.score ?? 0;
    expect(afterWaiting).toBe(afterOne);
  });

  it('produces a real winner over a played-out round rather than tying everyone on zero', () => {
    const sim = started('boxing', 6);
    playOut(sim, BOXING_DEF.roundSeconds + 5);
    const results = sim.results();
    const top = results.players.slice().sort((x, y) => y.score - x.score)[0];
    expect(top?.score, 'nobody scored across a whole round of boxing').toBeGreaterThan(0);
    expect(results.winnerIds.length).toBeLessThan(6);
  });
});

/**
 * Where a mode wants you to be.
 *
 * Bots only ever knew how to want another player — chase them or flee them. In the two modes
 * whose objective is a *place* they simply wandered: King of the Hill scored 0-3 across four
 * minutes because they rarely stood in the ring, and a full 300-second race ended with six bots
 * having reached six checkpoints between them and nobody finishing.
 */
describe('modes publish an objective for the bots to run at', () => {
  it('points every player at the hill', () => {
    const sim = started('hill');
    const player = [...sim.players.values()][0];
    if (!player) return;
    const objective = sim.mode.objectiveFor?.(player);
    expect(objective, 'King of the Hill published no objective').toBeTruthy();
    // Everyone wants the same point in this mode — that is the whole design.
    const other = [...sim.players.values()][1];
    if (other) expect(sim.mode.objectiveFor?.(other)).toEqual(objective);
  });

  it('points a racer at the next checkpoint in sequence, not the nearest one', () => {
    /**
     * Checkpoints only count in order, so "nearest" is usually the wrong one to run at.
     */
    const sim = started('parkour');
    const player = [...sim.players.values()][0];
    if (!player) return;
    player.checkpointIndex = 2;
    const objective = sim.mode.objectiveFor?.(player);
    const third = level.checkpoints.find((c) => c.index === 3);
    expect(objective).toEqual(third?.position);
  });

  it('stops giving a finished racer somewhere to be', () => {
    /**
     * Holds because finishing means clearing the last checkpoint, so there is no next one to point
     * at. Worth keeping as a statement of the behaviour even though no separate guard implements
     * it — an explicit `finishTicks` check used to sit in `objectiveFor` and was unreachable.
     */
    const sim = started('parkour');
    const player = [...sim.players.values()][0];
    if (!player) return;

    const mode = sim.mode as unknown as {
      checkpointReached(ctx: unknown, p: typeof player, index: number, finish: boolean): void;
    };
    const ctx = (sim as unknown as { modeCtx: unknown }).modeCtx;
    const ordered = [...level.checkpoints].sort((a, b) => a.index - b.index);
    for (const c of ordered) {
      expect(sim.mode.objectiveFor?.(player), `after checkpoint ${c.index - 1}`).not.toBeNull();
      mode.checkpointReached(ctx, player, c.index, c.finish === true);
    }

    expect(sim.mode.objectiveFor?.(player), 'a finished racer was still being steered').toBeNull();
  });

  it('gives the chasing modes no objective, so they keep chasing players', () => {
    for (const modeId of ['kangaroo-chase', 'infection', 'duel', 'hunt']) {
      const sim = started(modeId);
      const player = [...sim.players.values()][0];
      if (!player) continue;
      expect(sim.mode.objectiveFor?.(player) ?? null, modeId).toBeNull();
    }
  });

  it('steers the bot at the objective rather than wandering', () => {
    /**
     * Two opposite objectives, because one is not enough to tell steering from wandering.
     *
     * The first version of this pointed at a single goal and asked whether the bot ended up facing
     * it. A bot that ignores the objective entirely wanders on a seeded RNG, and on the seed this
     * test used it happened to wander to roughly the right heading — so the mutation that removed
     * the objective branch survived. Asking the same bot to go two opposite ways and checking that
     * it turns *differently* cannot be satisfied by any fixed wander.
     */
    const settledYaw = (dz: number): number => {
      const sim = started('hill', 2);
      const self = [...sim.players.values()][0];
      if (!self) throw new Error('no player');
      self.yaw = 0;
      const bot = new Bot(self.id, { skill: 1, seed: 11 });
      const goal = { x: self.position.x, y: self.position.y, z: self.position.z + dz };
      // A single tick only turns a fraction of the way; let the heading settle.
      for (let i = 0; i < 90; i++) {
        self.yaw = bot.think(self, sim.players.values(), level, 1 / 60, goal).lookYaw;
      }
      return self.yaw;
    };

    const towardsPositiveZ = settledYaw(40);
    const towardsNegativeZ = settledYaw(-40);

    // +Z is yaw 0 and -Z is yaw PI in this game's convention.
    expect(Math.abs(shortest(towardsPositiveZ)), `facing ${towardsPositiveZ.toFixed(2)}`).toBeLessThan(0.6);
    expect(Math.abs(shortest(towardsNegativeZ)), `facing ${towardsNegativeZ.toFixed(2)}`).toBeGreaterThan(2.5);
  });

  it('actually gets bots onto the hill, which is the point of publishing it', () => {
    // The end-to-end outcome. Before the objective existed this scored 0-3 over four minutes.
    const sim = started('hill');
    playOut(sim, 120);
    const top = sim.results().players.slice().sort((a, b) => b.score - a.score)[0];
    expect(top?.score, 'bots never held the hill').toBeGreaterThan(10);
  });
});

/**
 * Climbing towards an objective that is above you.
 *
 * The stuck check only fires when a bot stops moving, and a bot hopping under a ledge does not
 * stop — it drifts, which reads as progress. All six racers ended a full race parked at
 * checkpoint 1 with checkpoint 2 twelve metres over their heads. Climbing is this game's core
 * verb; a bot that cannot do it deliberately cannot play half of any map.
 */
describe('bots climb towards an objective above them', () => {
  function intentFor(objective: { x: number; y: number; z: number } | null) {
    const sim = started('parkour', 2);
    const self = [...sim.players.values()][0];
    if (!self) throw new Error('no player');
    const bot = new Bot(self.id, { skill: 0.8, seed: 3 });
    return bot.think(self, sim.players.values(), level, 1 / 60, objective && {
      x: self.position.x + objective.x,
      y: self.position.y + objective.y,
      z: self.position.z + objective.z,
    });
  }

  const GRAB = 1 << 3 | 1 << 4;

  it('grabs for a hold when the objective is overhead', () => {
    expect(intentFor({ x: 1, y: 12, z: 1 }).buttons & GRAB).toBeGreaterThan(0);
  });

  it('does not climb at a target on its own level', () => {
    expect(intentFor({ x: 6, y: 0, z: 0 }).buttons & GRAB).toBe(0);
  });

  it('does not climb at something high but far away — it runs there first', () => {
    // Grabbing at nothing from forty metres away is a bot standing still and clawing the air.
    expect(intentFor({ x: 40, y: 12, z: 0 }).buttons & GRAB).toBe(0);
  });
});
