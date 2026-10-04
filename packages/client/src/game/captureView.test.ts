import { describe, expect, it } from 'vitest';
import { LevelBuilder, Rand, Simulation, vec3 } from '@kc/core';
import { captureViewOf } from './captureView.js';

/** A floor, a wall between the start and one player, and open ground to another. */
function rig() {
  const b = new LevelBuilder(new Rand(1));
  b.box(vec3(0, -1, 0), vec3(60, 1, 60), 'dirt', 0, 'test');
  // A wall across +x, 5 m out: hides whoever stands behind it.
  b.box(vec3(5, 3, 0), vec3(0.5, 3, 6), 'rock', 0, 'test');
  b.spawn(vec3(0, 0.5, 0), 0, 'test', 'start');
  const level = b.build({
    id: 'capture-rig',
    name: 'capture rig',
    version: 1,
    seed: 1,
    killPlaneY: -40,
    playRadius: 100,
    ambientColor: 0,
    skyColor: 0,
    fogDensity: 0,
  });
  const sim = new Simulation({ level, modeId: 'kangaroo-chase' });
  const place = (id: string, x: number, z: number) => {
    const p = sim.addPlayer({ id, name: id, animalId: 'kangaroo' });
    p.position.x = x;
    p.position.y = 0.5;
    p.position.z = z;
    return p;
  };
  place('me', 0, 0);
  place('ahead', 0, 10);
  place('hidden', 10, 0);
  place('behind', 0, -4);
  return sim;
}

describe('what the store capture can see', () => {
  it('measures each player from the camera, nearest first', () => {
    const sim = rig();
    const view = captureViewOf(sim.players.values(), 'me', 0, sim.world)!;
    expect(view.others.map((o) => o.id)).toEqual(['behind', 'ahead', 'hidden']);
    const by = Object.fromEntries(view.others.map((o) => [o.id, o]));
    // Facing +z (yaw 0): straight ahead is bearing 0, straight behind is ±π.
    expect(by.ahead!.bearing).toBeCloseTo(0, 6);
    expect(Math.abs(by.behind!.bearing)).toBeCloseTo(Math.PI, 6);
    expect(by.ahead!.distance).toBeCloseTo(10, 6);
  });

  it('turns with the camera', () => {
    const sim = rig();
    // Facing +x (yaw π/2), the player 10 m along +x is dead ahead and the one along +z is 90° off.
    const view = captureViewOf(sim.players.values(), 'me', Math.PI / 2, sim.world)!;
    const by = Object.fromEntries(view.others.map((o) => [o.id, o]));
    expect(by.hidden!.bearing).toBeCloseTo(0, 6);
    expect(Math.abs(by.ahead!.bearing)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('says who a wall hides', () => {
    // The point of the hook: a frame aimed at a player behind rock is a frame of rock.
    const sim = rig();
    const by = Object.fromEntries(captureViewOf(sim.players.values(), 'me', 0, sim.world)!.others.map((o) => [o.id, o]));
    expect(by.hidden!.visible).toBe(false);
    expect(by.ahead!.visible).toBe(true);
    expect(by.behind!.visible).toBe(true);
  });

  it('has nothing to say without a local player', () => {
    const sim = rig();
    expect(captureViewOf(sim.players.values(), 'nobody', 0, sim.world)).toBeNull();
  });
});
