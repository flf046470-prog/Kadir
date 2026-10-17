import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation.js';
import { LevelBuilder } from '../world/builder.js';
import { Rand } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { Buttons, createIntent } from '../input/intent.js';
import type { InputIntent } from '../input/intent.js';
import { createProfile } from '../progression/profile.js';
import { applyMatchStats } from '../progression/achievements.js';
import '../modes/index.js';

/**
 * Distance and climb, measured by the simulation.
 *
 * Both are profile stats and "Master Climber" is an achievement on one of them, and before this
 * nothing fed either: `addMetric` had no callers, so the achievement could not be earned by any
 * amount of climbing. Measured on six bots over a full round on every map, distance comes out at
 * 115–2,678 m a round; bots never grab, so climbing is proven here on a wall, with the grab button.
 */
function rig() {
  const b = new LevelBuilder(new Rand(1));
  b.box(vec3(0, -1, 0), vec3(60, 1, 60), 'dirt', 0, 'test');
  // A climbable wall at x = 6, as in the locomotion tests.
  b.box(vec3(6, 6, 0), vec3(0.6, 6, 8), 'rock', 0, 'test');
  b.spawn(vec3(4.6, 0.5, 0), Math.PI / 2, 'test', 'start');
  const level = b.build({
    id: 'travel-rig',
    name: 'travel rig',
    version: 1,
    seed: 1,
    killPlaneY: -40,
    playRadius: 100,
    ambientColor: 0,
    skyColor: 0,
    fogDensity: 0,
  });
  const sim = new Simulation({ level, modeId: 'kangaroo-chase' });
  const player = sim.addPlayer({ id: 'p1', name: 'P', animalId: 'kangaroo' });
  player.position.x = 4.6;
  player.position.y = 0.5;
  player.position.z = 0;
  player.yaw = Math.PI / 2;
  return { sim, player };
}

function hold(sim: Simulation, intent: InputIntent, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    intent.tick = sim.tick + 1;
    sim.setIntent('p1', intent, false);
    sim.step();
  }
}

describe('distance and climb', () => {
  it('counts height climbed on a wall, and puts it on the profile', () => {
    const { sim, player } = rig();
    const intent = createIntent();
    intent.lookYaw = Math.PI / 2;
    intent.buttons = Buttons.GrabLeft;
    intent.moveZ = 1;
    hold(sim, intent, 120);
    expect(player.climbing).toBe(true);
    const result = sim.results();
    const me = result.players.find((p) => p.playerId === 'p1');
    expect(me?.climbMetres).toBeGreaterThan(1);
    // Within a decimetre of the height actually gained.
    expect(me?.climbMetres).toBeLessThanOrEqual(player.position.y - 0.5 + 0.1);

    const profile = createProfile('p1', 'P');
    applyMatchStats(profile, result, 'p1');
    expect(profile.stats.climbMetres).toBe(me?.climbMetres);
    expect(profile.stats.distanceMetres).toBe(me?.distanceMetres);
  });

  it('does not count a hop as a climb', () => {
    const { sim, player } = rig();
    player.position.x = -10;
    const intent = createIntent();
    for (let hop = 0; hop < 6; hop++) {
      intent.buttons = Buttons.Jump;
      hold(sim, intent, 2);
      intent.buttons = 0;
      hold(sim, intent, 50);
    }
    const me = sim.results().players.find((p) => p.playerId === 'p1');
    expect(me?.climbMetres).toBe(0);
  });

  it('counts running, but not the respawn after a fall off the world', () => {
    const { sim, player } = rig();
    player.position.x = -40;
    player.position.z = -40;
    const intent = createIntent();
    intent.moveZ = 1;
    hold(sim, intent, 120);
    const ran = sim.results().players.find((p) => p.playerId === 'p1')?.distanceMetres ?? 0;
    expect(ran).toBeGreaterThan(5);
    // Over the kill plane: the simulation respawns the player at the spawn, about 60 m away.
    player.position.y = -45;
    hold(sim, createIntent(), 3);
    expect(Math.hypot(player.position.x - 4.6, player.position.z)).toBeLessThan(2);
    const after = sim.results().players.find((p) => p.playerId === 'p1')?.distanceMetres ?? 0;
    expect(after - ran).toBeLessThan(1);
  });
});
