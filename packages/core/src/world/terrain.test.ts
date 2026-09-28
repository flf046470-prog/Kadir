import { describe, expect, it } from 'vitest';

import { Rand } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { heightfieldHeight } from '../physics/heightfield.js';
import { makeRaycastResult } from '../physics/types.js';
import type { HeightfieldCollider } from '../physics/types.js';
import { PhysicsWorld } from '../physics/world.js';
import { LevelBuilder, TERRAIN_BLEND, TERRAIN_CLEARANCE } from './builder.js';
import { buildJungleWorld } from './jungle.js';
import { levelFingerprint } from './level.js';

/** A 60 m square of ground with one of everything built on it, then a big uniform rise. */
function sculpted() {
  const b = new LevelBuilder(new Rand(1));
  const ground = b.terrain({ minX: -30, maxX: 30, minZ: -30, maxZ: 30, cellSize: 1, base: 0, bottom: -4, surface: 'dirt' });
  b.spawn(vec3(-15, 0.5, -15), 0, 'test', 'runner');
  b.checkpoint(vec3(15, 0.5, -15), 3);
  b.body('football', vec3(-15, 0.3, 15));
  b.box(vec3(15, 1, 15), vec3(2, 1, 2), 'rock');
  b.prop('bush', vec3(0, 0, 0));
  b.prop('tree', vec3(1, 10, 1));
  b.sculpt(ground, (_x, _z, free) => 3 * free);
  return { b, ground };
}

describe('LevelBuilder.sculpt', () => {
  it('keeps the ground flat round everything built on it, and shapes it elsewhere', () => {
    const { ground } = sculpted();
    const flat = (x: number, z: number): number => heightfieldHeight(ground, x, z);
    // Within the clearance of a spawn, a checkpoint, a ball and a box: still the plane they were built on.
    for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15], [17, 17]] as const) expect(flat(x, z), `${x},${z}`).toBe(0);
    // And the footprint's own edge, where whatever meets it met a plane.
    expect(flat(-30, 5)).toBe(0);
    // Out in the open, past the clearance and the blend: the full shape.
    expect(flat(0, 0)).toBe(3);
    expect(flat(-15, -15 + 2 + TERRAIN_CLEARANCE + TERRAIN_BLEND + 0.5)).toBe(3);
  });

  it('sets a prop that stood on the plane down on the new ground, and leaves one in the air alone', () => {
    const { b } = sculpted();
    expect(b.props.find((p) => p.kind === 'bush')?.position.y).toBe(3);
    expect(b.props.find((p) => p.kind === 'tree')?.position.y).toBe(10);
  });

  it('records its new top, so its bounds and its broadphase cell cover the hills', () => {
    const { ground } = sculpted();
    expect(ground.top).toBe(3);
    const world = new PhysicsWorld([ground]);
    const ray = makeRaycastResult();
    world.raycast(ray, vec3(0, 10, 0), vec3(0, -1, 0), 20);
    expect(ray.point.y).toBe(3);
  });
});

describe('the jungle floor', () => {
  const level = buildJungleWorld();
  const world = new PhysicsWorld(level.colliders);
  const ground = level.colliders.find((c): c is HeightfieldCollider => c.kind === 'heightfield')!;
  const ray = makeRaycastResult();
  /** The largest change in ground height between two samples 25 cm apart along a line in x. */
  function worstStep(z: number, x0: number, x1: number, from: number): { step: number; low: number; high: number } {
    let step = 0;
    let low = Infinity;
    let high = -Infinity;
    let previous: number | null = null;
    for (let x = x0; x <= x1; x += 0.25) {
      world.raycast(ray, vec3(x, from, z), vec3(0, -1, 0), 40);
      const y = ray.point.y;
      if (previous !== null) step = Math.max(step, Math.abs(y - previous));
      previous = y;
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
    return { step, low, high };
  }

  it('slopes down into the cave through both gaps in its mouth', () => {
    // It used to be a 4 m sheer drop at x = -62, with the ramp meant for it buried in the floor.
    for (const z of [26, -26]) {
      const { step, low, high } = worstStep(z, -72, -44, 8);
      expect(high - low, `z ${z}`).toBeGreaterThan(3.5);
      expect(step, `z ${z}`).toBeLessThan(0.3);
    }
  });

  it('meets the canyon ramp without a lip', () => {
    // A 2.1 m step from the slab's edge down onto the ramp's exposed half, before.
    const { step, low } = worstStep(6, 50, 68, 3);
    expect(low).toBeLessThan(-2.5);
    expect(step).toBeLessThan(0.3);
  });

  it('runs the river in a bed below the water, not flush with it', () => {
    // Water and dirt at the same height is two surfaces fighting for the same pixels.
    expect(heightfieldHeight(ground, 46, 10)).toBeLessThan(-1);
  });

  it('rolls, but never steeper than a player can walk up, where a player can walk', () => {
    let rolling = 0;
    let steepest = 0;
    for (let x = -40; x <= 30; x += 0.5) {
      for (let z = -55; z <= 55; z += 0.5) {
        const h = heightfieldHeight(ground, x, z);
        if (Math.abs(h) > 0.25) rolling++;
        const dx = (heightfieldHeight(ground, x + 0.25, z) - heightfieldHeight(ground, x - 0.25, z)) / 0.5;
        const dz = (heightfieldHeight(ground, x, z + 0.25) - heightfieldHeight(ground, x, z - 0.25)) / 0.5;
        steepest = Math.max(steepest, Math.atan(Math.hypot(dx, dz)));
      }
    }
    expect(rolling).toBeGreaterThan(5000);
    // The capsule stands on anything with a normal over 0.6 (53°); the open floor stays well under.
    expect((steepest * 180) / Math.PI).toBeLessThan(30);
  });

  it('is part of the fingerprint the server sends, heights and all', () => {
    const copy = { ...level, colliders: level.colliders.map((c) => (c === ground ? { ...ground, heights: ground.heights.map((h, i) => (i === 700 ? h + 0.5 : h)) } : c)) };
    expect(levelFingerprint(copy)).not.toBe(levelFingerprint(level));
  });
});
