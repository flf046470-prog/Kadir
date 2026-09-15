import { describe, expect, it } from 'vitest';

import { LevelBuilder } from '../world/builder.js';
import { Rand } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { Simulation } from '../sim/simulation.js';
import { createIntent } from '../input/intent.js';
import type { SurfaceName } from '../world/builder.js';
import '../modes/index.js';

/**
 * Does the ground you are standing on change how you move?
 *
 * Every surface preset has carried a `friction` number since the level builder existed — ice at
 * 0.35, glazed ice at 0.28, snow at 1.05, dirt at 1 — and `MovementConfig.friction` is documented as
 * "Ground deceleration when there is no input, **scaled by the surface's friction**". That scaling
 * was never written. `frictionOfGround` looked at one thing, `groundMaterial === 'water'`, so every
 * solid surface in the game decelerated identically and Glacier World — a map whose entire premise
 * is that ice decides where you can commit to a turn — played exactly like the jungle.
 *
 * Measured as a coast: run up to speed, release the stick, and see how far the player travels
 * before stopping. That is the number a player actually feels, and unlike asserting the
 * coefficient it would still fail if the coefficient were read and then multiplied by zero.
 */
describe('surface friction', () => {
  /** A flat floor of one surface, and a player standing on it. */
  function coastDistance(surface: SurfaceName): number {
    const b = new LevelBuilder(new Rand(1));
    b.box(vec3(0, -1, 0), vec3(200, 1, 200), surface, 0, 'test');
    b.spawn(vec3(0, 0.5, 0), 0, 'test', 'start');
    const level = b.build({
      id: `friction-${surface}`,
      name: 'friction rig',
      version: 1,
      seed: 1,
      killPlaneY: -40,
      playRadius: 300,
      ambientColor: 0,
      skyColor: 0,
      fogDensity: 0,
    });

    const sim = new Simulation({ level, modeId: 'kangaroo-chase' });
    const player = sim.addPlayer({ id: 'p1', name: 'P', animalId: 'kangaroo' });
    const intent = createIntent();

    // Accelerate north for two seconds. Long enough to reach the speed cap on any surface, so the
    // coast below starts from the same speed and measures deceleration alone.
    intent.moveZ = 1;
    for (let tick = 0; tick < 120; tick++) {
      intent.tick = tick + 1;
      sim.setIntent('p1', intent, false);
      sim.step();
    }

    const startZ = player.position.z;
    const startSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    expect(startSpeed).toBeGreaterThan(1); // the rig itself must work before its result means anything

    // Release everything and let friction do the work.
    intent.moveZ = 0;
    for (let tick = 120; tick < 420; tick++) {
      intent.tick = tick + 1;
      sim.setIntent('p1', intent, false);
      sim.step();
      if (Math.hypot(player.velocity.x, player.velocity.z) === 0) break;
    }

    return Math.abs(player.position.z - startZ);
  }

  it('slides much further on ice than on dirt', () => {
    const dirt = coastDistance('dirt');
    const ice = coastDistance('ice');
    // Ice declares 0.35 against dirt's 1, so the coast should be several times longer. Asserted as
    // a ratio rather than a distance so retuning the base friction cannot silently break it.
    expect(ice).toBeGreaterThan(dirt * 2);
  });

  it('stops soonest on the surfaces that declare the most grip', () => {
    // The ordering is the whole design of the glacier: the snow floor of the crevasse is where a
    // runner goes to stop, and the glazed ice of the seracs is where they cannot.
    const snow = coastDistance('snow');
    const dirt = coastDistance('dirt');
    const ice = coastDistance('ice');
    const glazed = coastDistance('glazedIce');

    expect(snow).toBeLessThan(dirt);
    expect(dirt).toBeLessThan(ice);
    expect(ice).toBeLessThan(glazed);
  });

  it('keeps every surface eventually stoppable', () => {
    // "Slippery" must not mean "never stops": a player who cannot come to rest cannot stand on a
    // ledge, and the resting snap is what stops idle players costing a snapshot every tick.
    for (const surface of ['ice', 'glazedIce', 'snow', 'dirt'] as const) {
      expect(coastDistance(surface)).toBeLessThan(120);
    }
  });
});
