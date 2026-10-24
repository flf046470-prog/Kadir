import { describe, expect, it } from 'vitest';

import { buildJungleWorld } from './jungle.js';
import type { BoxCollider, HeightfieldCollider } from '../physics/types.js';
import { heightfieldHeight, heightfieldMaxX, heightfieldMaxZ } from '../physics/heightfield.js';
import type { PropInstance } from './level.js';

/**
 * Every decorative prop stands on ground, and none stands inside a wall.
 *
 * Both are invisible from the middle of the map and obvious from anywhere near the edge, which is
 * the worst combination a defect can have — and both have already happened. Scattering the
 * undergrowth in a circle of radius 78 across a floor that is a 62-metre *square* left fifteen
 * bushes hanging over the void; the fix was to let the floors decide the shape, and this is what
 * keeps them deciding it.
 *
 * Checked against the built world rather than against the scatter function, because the bug was
 * never in the scattering — it was in the numbers handed to it, and only the finished level knows
 * whether those were right.
 */
describe('jungle world props', () => {
  const level = buildJungleWorld();
  const boxes = level.colliders.filter((c): c is BoxCollider => c.kind === 'box');

  /** A box whose top is at or just below `y` — something a prop at that height could rest on. */
  const floorsUnder = (y: number): BoxCollider[] => boxes.filter((c) => c.center.y + c.half.y <= y + 0.8);
  const covers = (list: BoxCollider[], p: PropInstance, pad: number): boolean =>
    list.some(
      (c) =>
        Math.abs(p.position.x - c.center.x) <= c.half.x + pad && Math.abs(p.position.z - c.center.z) <= c.half.z + pad,
    );

  it('places enough of them to furnish three districts', () => {
    // A floor rule that passes by placing nothing would be worthless.
    expect(level.props.length).toBeGreaterThan(400);
  });

  const terrains = level.colliders.filter((c): c is HeightfieldCollider => c.kind === 'heightfield');
  /** Terrain under the prop whose surface is at or just below it — the floor is terrain now. */
  const onTerrain = (p: PropInstance): boolean =>
    terrains.some(
      (t) =>
        p.position.x >= t.minX &&
        p.position.x <= heightfieldMaxX(t) &&
        p.position.z >= t.minZ &&
        p.position.z <= heightfieldMaxZ(t) &&
        heightfieldHeight(t, p.position.x, p.position.z) <= p.position.y + 0.8,
    );

  it('gives every prop ground to stand on', () => {
    const floating = level.props.filter((p) => !covers(floorsUnder(p.position.y), p, 0.6) && !onTerrain(p));
    expect(
      floating.map((p) => `${p.kind} at ${p.position.x.toFixed(0)},${p.position.y.toFixed(0)},${p.position.z.toFixed(0)}`),
    ).toEqual([]);
  });

  it('keeps ground props out of the walls they would grow through', () => {
    // Only the decorative scatter is checked. Props placed deliberately on top of a collider — the
    // village banners on their platforms, the log lying over its own cylinder — are meant to
    // coincide with one, and are identified by sitting above the floor rather than on it.
    const ground = level.props.filter((p) => p.position.y <= -3.5 || Math.abs(p.position.y) < 0.35);
    const inside = ground.filter((p) => {
      // Solid *at the prop's own height*, not merely somewhere above it. A ceiling is above every
      // prop in the cave and obstructs none of them.
      const solid = boxes.filter(
        (c) => c.center.y - c.half.y < p.position.y + 2 && c.center.y + c.half.y > p.position.y + 0.2,
      );
      return covers(solid, p, -0.6);
    });
    expect(inside.map((p) => `${p.kind} at ${p.position.x.toFixed(0)},${p.position.z.toFixed(0)}`)).toEqual([]);
  });

  it('sets every ground prop down on the terrain, not under it or over a hollow', () => {
    // Scattered onto the ground as it finally is: a bush on a swell stands on the swell. A prop a
    // few centimetres into a hollow, or buried in a rise, is the defect this would show.
    const ground = level.props.filter((p) => {
      const t = terrains.find((c) => p.position.x >= c.minX && p.position.x <= heightfieldMaxX(c) && p.position.z >= c.minZ && p.position.z <= heightfieldMaxZ(c));
      return t && Math.abs(p.position.y - heightfieldHeight(t, p.position.x, p.position.z)) < 1.6 && p.kind !== 'tree' && p.kind !== 'vine' && p.kind !== 'banner';
    });
    expect(ground.length).toBeGreaterThan(200);
    const off = ground.filter((p) => {
      const t = terrains[0] as HeightfieldCollider;
      return Math.abs(p.position.y - heightfieldHeight(t, p.position.x, p.position.z)) > 1e-6;
    });
    expect(off.map((p) => `${p.kind} at ${p.position.x.toFixed(1)},${p.position.y.toFixed(2)},${p.position.z.toFixed(1)}`)).toEqual([]);
  });

  it('furnishes the cave and the canyon, not only the jungle', () => {
    // The two outlying districts were bare while the jungle was dense, which is exactly backwards:
    // they are where a chase ends up.
    const inCave = level.props.filter((p) => p.position.x < -50).length;
    const inCanyon = level.props.filter((p) => p.position.x > 50).length;
    expect(inCave).toBeGreaterThan(60);
    expect(inCanyon).toBeGreaterThan(60);
  });

  it('is identical for the same seed', () => {
    // Client and server build the world independently from the seed. A scatter that consumed a
    // different number of random values on each run would desynchronise them.
    const again = buildJungleWorld();
    expect(again.props.length).toBe(level.props.length);
    expect(again.props.map((p) => `${p.kind}:${p.position.x.toFixed(3)}:${p.position.z.toFixed(3)}`)).toEqual(
      level.props.map((p) => `${p.kind}:${p.position.x.toFixed(3)}:${p.position.z.toFixed(3)}`),
    );
  });
});
