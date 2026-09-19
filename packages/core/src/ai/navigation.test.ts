import { describe, expect, it } from 'vitest';

import { Bot } from './bot.js';
import { Simulation } from '../sim/simulation.js';
import { buildLevel, listLevels } from '../world/registry.js';
import '../world/index.js';
import '../modes/index.js';

/**
 * A bot that is going somewhere has to keep going.
 *
 * Racers steer straight at the next checkpoint and have no idea the world is solid, so anything
 * between them and it is a wall they lean on until the final bell. Driving the jungle course
 * before this: all six bots reached checkpoint 0, walked into the canyon face at x = -68, and
 * spent the remaining **260 seconds of a 300-second race** there, ninety metres short, while the
 * headline read "Nobody finished the route" every single time.
 *
 * There was an escape hatch and it was dead code in exactly this case — it nudged `wanderYaw`,
 * which the heading only reads when there is neither a target nor an objective.
 */

/** Run a parkour round headless and report how far each bot got from where it settled. */
function race(levelId: string, seconds: number) {
  const level = buildLevel(levelId);
  const sim = new Simulation({ level, modeId: 'parkour', seed: 3 });
  const bots: Bot[] = [];
  for (let i = 0; i < 4; i++) {
    sim.addPlayer({ id: `p${i}`, name: `P${i}` });
    bots.push(new Bot(`p${i}`, { skill: 0.6, seed: 200 + i }));
  }

  const anchor = new Map<string, { x: number; z: number }>();
  const furthest = new Map<string, number>();
  // Measured from thirty seconds in, not from the start: the opening seconds are spent leaving the
  // spawn, which every version of the bot managed. The bug is what happens afterwards.
  const settleTick = 60 * 30;

  for (let tick = 0; tick < 60 * seconds; tick++) {
    for (const [i, bot] of bots.entries()) {
      const self = sim.players.get(`p${i}`);
      if (!self) continue;
      const intent = bot.think(self, sim.players.values(), level, 1 / 60, sim.mode.objectiveFor?.(self) ?? null);
      intent.tick = sim.tick + 1;
      sim.setIntent(`p${i}`, intent);
    }
    sim.step();

    if (tick === settleTick) {
      for (const [id, p] of sim.players) anchor.set(id, { x: p.position.x, z: p.position.z });
    } else if (tick > settleTick) {
      for (const [id, p] of sim.players) {
        const from = anchor.get(id);
        if (!from) continue;
        const d = Math.hypot(p.position.x - from.x, p.position.z - from.z);
        furthest.set(id, Math.max(furthest.get(id) ?? 0, d));
      }
    }
  }

  return {
    roamed: [...furthest.entries()],
    best: Math.max(...[...sim.players.values()].map((p) => p.checkpointIndex)),
  };
}

describe('a bot racing a route', () => {
  it('never spends the round leaning on one piece of scenery', () => {
    /**
     * The measurement that separates the two versions cleanly. Over the ninety seconds after
     * settling, the shipped bot left two of four racers **0 m and 2 m** from where they stood —
     * wedged — while the rest of the field ran the course. With obstacle avoidance the worst bot
     * covers 35 m.
     *
     * Fifteen metres is the middle of that gap: far past anything a wall-leaner manages, far short
     * of anything a moving bot fails to reach. Asserted per bot rather than on the best of them,
     * because the failure was never the whole field at once.
     */
    for (const entry of listLevels()) {
      const { roamed } = race(entry.id, 120);
      expect(roamed.length, `${entry.id} reported no bots`).toBeGreaterThan(0);
      for (const [id, distance] of roamed) {
        expect(distance, `${entry.id}: ${id} got only ${distance.toFixed(1)} m from where it settled`).toBeGreaterThan(15);
      }
    }
  });

  it('gets past the opening legs of every route', () => {
    /**
     * Progress, not just motion — a bot could pass the test above by running in circles.
     *
     * Two is deliberately modest: the point is that the field is *advancing*, and the routes
     * differ in how hard their middle sections are. The jungle's fourth leg is 94 m and its sixth
     * is 136 m, and nothing here claims a bot should finish those inside two minutes.
     */
    for (const entry of listLevels()) {
      const { best } = race(entry.id, 120);
      expect(best, `${entry.id}: the whole field stalled at checkpoint ${best}`).toBeGreaterThanOrEqual(2);
    }
  });
});
