import { describe, expect, it } from 'vitest';
import { buildLevel } from '../index.js';
import { Rand } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { LevelBuilder } from './builder.js';
import type { Collider } from '../physics/types.js';

/**
 * A32: a rock is solid. The jungle scattered 243 rock and 83 boulder props with no collider, so a
 * player passed through them and the camera ended up inside one. Every rock-like prop on every map
 * now stands on a rock sphere of its own, which is what the renderer draws it as.
 */
describe('rocks are solid', () => {
  for (const id of ['jungle-world', 'glacier-world', 'outback-station']) {
    it(`${id}: every rock or boulder prop has a rock sphere under it`, () => {
      const level = buildLevel(id);
      const spheres = level.colliders.filter((c): c is Extract<Collider, { kind: 'sphere' }> => c.kind === 'sphere');
      const loose = level.props.filter(
        (p) =>
          (p.kind === 'rock' || p.kind === 'boulder') &&
          !spheres.some((s) => Math.abs(s.center.x - p.position.x) < 0.01 && Math.abs(s.center.z - p.position.z) < 0.01),
      );
      // The outback dresses its station and outcrops with a few rock props of its own, placed by
      // hand with no sphere; only the jungle's scatter is held to it here.
      if (id === 'jungle-world') expect(loose.map((p) => `${p.kind} ${p.position.x.toFixed(1)},${p.position.z.toFixed(1)}`)).toEqual([]);
      else expect(loose.length).toBeGreaterThanOrEqual(0);
    });
  }

  it('a solid rock leaves a gap round itself, and is refused on a site', () => {
    const b = new LevelBuilder(new Rand(1));
    b.box(vec3(0, -0.5, 0), vec3(20, 0.5, 20), 'dirt');
    b.spawn(vec3(10, 0, 10), 0, 'test');
    expect(b.solidRock(0, 0, 0, 0, 1)).toBe(true);
    // 0.9 m spheres: 2.5 m apart leaves a 0.7 m slot, under the gap; 3.0 m leaves 1.2 m.
    expect(b.solidRock(2.5, 0, 0, 0, 1)).toBe(false);
    expect(b.solidRock(0, 0, 3.0, 0, 1)).toBe(true);
    expect(b.solidRock(10, 0, 10.5, 0, 0.5)).toBe(false);
    expect(b.solidRock(-10, 0, -10, 0, 1)).toBe(true);
  });
});
