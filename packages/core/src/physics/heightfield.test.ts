import { describe, expect, it } from 'vitest';

import { Rand } from '../math/rand.js';
import type { Vec3 } from '../math/vec3.js';
import { vec3 } from '../math/vec3.js';
import { DEFAULT_MOVE_PARAMS, makeMoveResult, moveCapsule } from './character.js';
import { closestPointOnCollider, rayCollider } from './geometry.js';
import { HEIGHTFIELD_SEARCH, heightfieldHeight, heightfieldMaxX, heightfieldMaxZ } from './heightfield.js';
import type { HeightfieldCollider } from './types.js';
import { DEFAULT_SURFACE, makeRaycastResult } from './types.js';
import { PhysicsWorld } from './world.js';

/**
 * Terrain against an independent answer.
 *
 * The physics' closest point and ray are fast because they are clever — a bounded window of cells,
 * a grid walk — and clever is where they would be wrong. Every test here compares them with the
 * slow way: every triangle of the grid, done with different arithmetic.
 */
function terrain(opts: { cols: number; rows: number; cell: number; minX?: number; minZ?: number; height: (x: number, z: number) => number; bottom?: number }): HeightfieldCollider {
  const minX = opts.minX ?? 0;
  const minZ = opts.minZ ?? 0;
  const heights: number[] = [];
  for (let j = 0; j < opts.rows; j++) {
    for (let i = 0; i < opts.cols; i++) heights.push(opts.height(minX + i * opts.cell, minZ + j * opts.cell));
  }
  const top = Math.max(...heights);
  const bottom = opts.bottom ?? Math.min(...heights) - 4;
  return {
    kind: 'heightfield',
    id: 0,
    surface: DEFAULT_SURFACE,
    center: vec3(minX + ((opts.cols - 1) * opts.cell) / 2, (top + bottom) / 2, minZ + ((opts.rows - 1) * opts.cell) / 2),
    minX,
    minZ,
    cellSize: opts.cell,
    cols: opts.cols,
    rows: opts.rows,
    heights,
    bottom,
    top,
  };
}

const bumpy = (seed: number): HeightfieldCollider => {
  const rand = new Rand(seed);
  const heights = Array.from({ length: 9 * 9 }, () => rand.range(-1.2, 1.4));
  return terrain({ cols: 9, rows: 9, cell: 2, minX: -8, minZ: -8, height: (x, z) => heights[((z + 8) / 2) * 9 + (x + 8) / 2] as number });
};

/** Every triangle of the grid, on the same (0,0)–(1,1) diagonal the renderer draws. */
function triangles(hf: HeightfieldCollider): [Vec3, Vec3, Vec3][] {
  const out: [Vec3, Vec3, Vec3][] = [];
  const at = (i: number, j: number): Vec3 => vec3(hf.minX + i * hf.cellSize, hf.heights[j * hf.cols + i] as number, hf.minZ + j * hf.cellSize);
  for (let j = 0; j < hf.rows - 1; j++) {
    for (let i = 0; i < hf.cols - 1; i++) {
      out.push([at(i, j), at(i + 1, j + 1), at(i + 1, j)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return out;
}

const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec3): number => Math.sqrt(dot(a, a));

/** Distance from p to a segment, by projection. */
function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / dot(ab, ab)));
  return len(sub(p, vec3(a.x + ab.x * t, a.y + ab.y * t, a.z + ab.z * t)));
}

/** Distance from p to a triangle: to its plane if the foot is inside it, else to the nearest edge. */
function triangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const n = cross(sub(b, a), sub(c, a));
  const unit = 1 / len(n);
  const h = dot(sub(p, a), n) * unit;
  const foot = vec3(p.x - n.x * unit * h, p.y - n.y * unit * h, p.z - n.z * unit * h);
  const s1 = dot(cross(sub(b, a), sub(foot, a)), n);
  const s2 = dot(cross(sub(c, b), sub(foot, b)), n);
  const s3 = dot(cross(sub(a, c), sub(foot, c)), n);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return Math.abs(h);
  return Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
}

describe('heightfield closest point', () => {
  it('agrees with every triangle of the grid, above and below the surface', () => {
    const rand = new Rand(7);
    for (let seed = 1; seed <= 4; seed++) {
      const hf = bumpy(seed);
      const tris = triangles(hf);
      for (let n = 0; n < 400; n++) {
        // Well inside the footprint, so the surface is the only face in reach.
        const x = rand.range(-5, 5);
        const z = rand.range(-5, 5);
        const y = heightfieldHeight(hf, x, z) + rand.range(-1.2, 1.8);
        const p = vec3(x, y, z);
        const expected = Math.min(...tris.map(([a, b, c]) => triangleDistance(p, a, b, c)));
        if (expected > HEIGHTFIELD_SEARCH) continue;
        const q = vec3();
        const normal = vec3();
        const inside = closestPointOnCollider(q, normal, p, hf);
        expect(len(sub(p, q)), `seed ${seed} point ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`).toBeCloseTo(expected, 6);
        expect(inside).toBe(y < heightfieldHeight(hf, x, z));
      }
    }
  });

  it('points out of the ground, the way the capsule solver pushes', () => {
    const hf = bumpy(3);
    const q = vec3();
    const normal = vec3();
    // Above: from the surface towards the point.
    closestPointOnCollider(q, normal, vec3(1.1, heightfieldHeight(hf, 1.1, -0.7) + 0.3, -0.7), hf);
    expect(normal.y).toBeGreaterThan(0.3);
    // Just below: out through the top face, not down through a floor four metres thick.
    const inside = closestPointOnCollider(q, normal, vec3(1.1, heightfieldHeight(hf, 1.1, -0.7) - 0.1, -0.7), hf);
    expect(inside).toBe(true);
    expect(normal.y).toBeGreaterThan(0.3);
  });

  it('has sides and an underside, not just a surface', () => {
    const hf = terrain({ cols: 5, rows: 5, cell: 2, height: () => 1, bottom: -3 });
    const q = vec3();
    const normal = vec3();
    // Beside the slab, below its top: the side wall, straight across.
    closestPointOnCollider(q, normal, vec3(-0.5, 0, 4), hf);
    expect(q).toEqual(vec3(0, 0, 4));
    expect(normal).toEqual(vec3(-1, 0, 0));
    // Under it.
    closestPointOnCollider(q, normal, vec3(4, -3.5, 4), hf);
    expect(q.y).toBe(-3);
    expect(normal.y).toBe(-1);
    // Inside, nearer the side than the top: out through the side.
    const inside = closestPointOnCollider(q, normal, vec3(7.8, -1, 4), hf);
    expect(inside).toBe(true);
    expect(normal).toEqual(vec3(1, 0, 0));
  });
});

describe('heightfield raycast', () => {
  /** The slow way: every triangle, then the four sides and the underside by plane intersection. */
  function bruteRay(hf: HeightfieldCollider, o: Vec3, d: Vec3, max: number): number {
    let best = Infinity;
    for (const [a, b, c] of triangles(hf)) {
      const n = cross(sub(b, a), sub(c, a));
      const denom = dot(n, d);
      if (Math.abs(denom) < 1e-12) continue;
      const t = dot(n, sub(a, o)) / denom;
      if (t < 0 || t > max) continue;
      const p = vec3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      if (triangleDistance(p, a, b, c) < 1e-7) best = Math.min(best, t);
    }
    const maxX = heightfieldMaxX(hf);
    const maxZ = heightfieldMaxZ(hf);
    for (const [axis, plane] of [['x', hf.minX], ['x', maxX], ['z', hf.minZ], ['z', maxZ]] as const) {
      const dk = d[axis];
      if (Math.abs(dk) < 1e-12) continue;
      const t = (plane - o[axis]) / dk;
      if (t < 0 || t > max) continue;
      const p = vec3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      const other = axis === 'x' ? p.z : p.x;
      const lo = axis === 'x' ? hf.minZ : hf.minX;
      const hi = axis === 'x' ? maxZ : maxX;
      if (other < lo || other > hi) continue;
      if (p.y >= hf.bottom && p.y < heightfieldHeight(hf, p.x, p.z)) best = Math.min(best, t);
    }
    if (Math.abs(d.y) > 1e-12) {
      const t = (hf.bottom - o.y) / d.y;
      const p = vec3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      if (t >= 0 && t <= max && p.x >= hf.minX && p.x <= maxX && p.z >= hf.minZ && p.z <= maxZ) best = Math.min(best, t);
    }
    return best === Infinity ? -1 : best;
  }

  it('meets the same point as every triangle and side, from every direction', () => {
    const rand = new Rand(11);
    let hits = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const hf = bumpy(seed);
      for (let n = 0; n < 500; n++) {
        const o = vec3(rand.range(-14, 14), rand.range(-7, 8), rand.range(-14, 14));
        // Skip origins inside the solid; that case answers 0 by definition and is tested below.
        const within = o.x > hf.minX && o.x < heightfieldMaxX(hf) && o.z > hf.minZ && o.z < heightfieldMaxZ(hf);
        if (within && o.y > hf.bottom && o.y < heightfieldHeight(hf, o.x, o.z)) continue;
        const target = vec3(rand.range(-9, 9), rand.range(-3, 3), rand.range(-9, 9));
        const dir = sub(target, o);
        const l = len(dir);
        const d = vec3(dir.x / l, dir.y / l, dir.z / l);
        const expected = bruteRay(hf, o, d, 40);
        const got = rayCollider(o, d, 40, hf, vec3());
        if (expected >= 0) hits++;
        expect(got, `seed ${seed} ray ${n}`).toBeCloseTo(expected, 6);
      }
    }
    // The comparison is only worth something if most rays actually hit.
    expect(hits).toBeGreaterThan(1000);
  });

  it('lands a straight-down ray exactly on the drawn surface', () => {
    const hf = bumpy(2);
    const ray = makeRaycastResult();
    const world = new PhysicsWorld([hf]);
    for (const [x, z] of [[0.3, 0.9], [-3.7, 2.2], [5.5, -6.1], [-7.9, 7.9]] as const) {
      world.raycast(ray, vec3(x, 20, z), vec3(0, -1, 0), 40);
      expect(ray.hit).toBe(true);
      expect(ray.point.y).toBeCloseTo(heightfieldHeight(hf, x, z), 9);
      expect(ray.normal.y).toBeGreaterThan(0);
    }
  });

  it('meets a ray that starts inside the ground at distance 0, as a box does', () => {
    const hf = bumpy(2);
    const d = rayCollider(vec3(0.5, heightfieldHeight(hf, 0.5, 0.5) - 0.5, 0.5), vec3(0, -1, 0), 10, hf, vec3());
    expect(d).toBe(0);
  });
});

describe('a capsule on terrain', () => {
  const shape = { radius: 0.35, height: 1.6 };

  function walk(hf: HeightfieldCollider, start: Vec3, velocity: Vec3, ticks: number, each?: (p: Vec3, grounded: boolean) => void): Vec3 {
    const world = new PhysicsWorld([hf]);
    const position = { ...start };
    const vel = { ...velocity };
    const out = makeMoveResult();
    let grounded = true;
    const dt = 1 / 60;
    for (let t = 0; t < ticks; t++) {
      vel.y -= 24 * dt;
      vel.x = velocity.x;
      vel.z = velocity.z;
      moveCapsule(world, position, vel, shape, dt, DEFAULT_MOVE_PARAMS, out, grounded);
      grounded = out.grounded;
      each?.(position, grounded);
    }
    return position;
  }

  it('walks over a rolling hill with its feet on the ground the whole way', () => {
    // Swells 1.2 m high and 24 m long: 17° at the steepest, like the jungle floor.
    const hf = terrain({ cols: 41, rows: 11, cell: 1.5, minX: -30, minZ: -7.5, height: (x) => 1.2 * Math.sin((x / 24) * Math.PI * 2) });
    let worst = 0;
    let airborne = 0;
    const end = walk(hf, vec3(-28, heightfieldHeight(hf, -28, 0), 0), vec3(4, 0, 0), 60 * 12, (p, grounded) => {
      if (!grounded) airborne++;
      else worst = Math.max(worst, Math.abs(p.y - heightfieldHeight(hf, p.x, p.z)));
    });
    // 12 s at 4 m/s, a little slower up each rise: well past the second crest.
    expect(end.x).toBeGreaterThan(15);
    expect(airborne).toBe(0);
    expect(worst).toBeLessThan(0.03);
  });

  it('stands still on a walkable slope instead of sliding down it', () => {
    // 20°, steeper than anything the maps build. Friction is the locomotion's job; the solver must
    // at least not push a resting capsule downhill on its own.
    const slope = Math.tan((20 * Math.PI) / 180);
    const hf = terrain({ cols: 11, rows: 11, cell: 2, minX: -10, minZ: -10, height: (x) => x * slope });
    const start = vec3(0, 0, 0);
    let grounded = 0;
    const end = walk(hf, start, vec3(0, 0, 0), 60 * 3, (_p, g) => {
      if (g) grounded++;
    });
    expect(grounded).toBe(60 * 3);
    // The capsule solver alone may creep a little: gravity's downhill share is what friction takes
    // out of it in the real game. What it must not do is fall through or skate away.
    expect(end.y).toBeGreaterThan(heightfieldHeight(hf, end.x, end.z) - 0.02);
  });

  it('cannot walk up a slope steeper than the walkable limit', () => {
    // 60°: past `minGroundNormalY` (0.6 ≈ 53°).
    const slope = Math.tan((60 * Math.PI) / 180);
    const hf = terrain({ cols: 21, rows: 5, cell: 1, minX: -10, minZ: -2, height: (x) => Math.max(0, x) * slope });
    const end = walk(hf, vec3(-3, 0, 0), vec3(3, 0, 0), 60 * 4);
    expect(end.y).toBeLessThan(1.2);
  });
});
