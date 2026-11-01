import * as THREE from 'three';
import { fractalNoise2 } from '@kc/core';
import type { BoxCollider } from '@kc/core';

/**
 * The walls round the edge of every map, drawn as rock.
 *
 * `LevelBuilder.enclose` walls each edge that drops to the kill plane with a run of thin boxes, each
 * 8–14 m long with its own height — which is right for physics and was drawn literally: a flat slab
 * of stone with a crenellated top, a castle wall round a jungle, a glacier and the outback. It was
 * the most artificial thing on every map, and it is in view from almost everywhere.
 *
 * Two rules keep the drawing honest about what you collide with:
 *
 *  - **Carved, never built out.** Faces are only ever displaced *into* their box (`CARVE`), so the
 *    rock never stands in front of the wall: at worst you stop a hand's width short of a hollow.
 *  - **Never lower than the wall.** The crest only rises above the box top. The top is out of reach
 *    by `CLIFF_CLEARANCE`, so rock drawn above it costs nothing, and rock drawn below it would leave
 *    an invisible wall over the visible one.
 *
 * Between those, the steps go: the crest follows the tallest wall nearby and falls away from it no
 * steeper than `SKYLINE_FALL`, with a ragged edge on top. Everything is a function of world position
 * and the level's seed, so two faces that meet carve and crest identically and leave no seam, and
 * every client draws the same rock.
 */

/** Spacing of the rock's grid, metres. */
export const CLIFF_CELL = 3;
/**
 * Deepest a face is carved into its wall, metres. Inward only, and never more than a third of the
 * wall's thickness: `enclose` leaves slivers a centimetre wide at the ends of its runs, and carving
 * one of those by a full depth went straight through it and out the far side.
 *
 * The carving fades out towards each end of a face. Where two walls meet, the end of one stands
 * flush against the face of the next; carved right up to the join, the uncarved end stood proud of
 * the hollow beside it, and every join showed as a thin vertical fin.
 */
export const CARVE = 1;
/** How steeply the crest may fall from a taller wall towards a shorter one: rise over run (35°). */
export const SKYLINE_FALL = 0.7;
/** The ragged edge above the smoothed crest, metres. */
export const CREST = 2.5;
const CREST_SALT = 0x63726573;
const CARVE_SALT = 0x63617276;

interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

function footprint(c: BoxCollider): Footprint {
  return {
    minX: c.center.x - c.half.x,
    maxX: c.center.x + c.half.x,
    minZ: c.center.z - c.half.z,
    maxZ: c.center.z + c.half.z,
    top: c.center.y + c.half.y,
  };
}

/**
 * The crest's height at (x, z): the tallest wall's top less `SKYLINE_FALL` per metre away from it,
 * plus a ragged edge that only ever adds. At a point on a wall's own top this is at least that top.
 */
export function cliffCrest(walls: readonly BoxCollider[], seed: number): (x: number, z: number) => number {
  const prints = walls.map(footprint);
  return (x, z) => {
    let best = -Infinity;
    for (const f of prints) {
      const dx = Math.max(f.minX - x, 0, x - f.maxX);
      const dz = Math.max(f.minZ - z, 0, z - f.maxZ);
      best = Math.max(best, f.top - SKYLINE_FALL * Math.hypot(dx, dz));
    }
    const ragged = 0.5 + 0.5 * fractalNoise2(seed ^ CREST_SALT, x, z, 9, 3, 0.5);
    return best + CREST * Math.min(1, Math.max(0, ragged));
  };
}

/**
 * How far into its wall a face is carved at a point on it: noise up to `CARVE`, none at the crest
 * or under the floor (so it meets the top and the buried part whole), none at either end of the
 * face (so a join is flush), and never more than `limit` — a third of the wall's thickness.
 */
export function faceCarve(
  seed: number,
  along: number,
  y: number,
  axis: number,
  at: { top: number; floor: number; end: number; limit: number },
): number {
  const n = fractalNoise2((seed ^ CARVE_SALT) + axis * 7919, along, y, 5, 3, 0.55);
  const noise = CARVE * Math.min(1, Math.max(0, 0.5 + 0.6 * n));
  const fade =
    Math.min(1, Math.max(0, (at.top - y) / CLIFF_CELL)) *
    Math.min(1, Math.max(0, (y - at.floor) / CLIFF_CELL)) *
    Math.min(1, Math.max(0, at.end / CLIFF_CELL));
  return Math.min(noise * fade, Math.max(0, at.limit));
}

/**
 * One merged mesh of every wall, non-indexed so a flat-shaded material shades each facet.
 *
 * Each box gives its four sides and its top. A side is a grid: columns every `CLIFF_CELL` along it,
 * rows at fixed *world* heights every `CLIFF_CELL` from the floor up, clamped to the crest — fixed
 * world heights rather than a share of each face, so two walls side by side put their shared edge's
 * vertices in the same places and leave no crack between them.
 */
export function cliffGeometry(walls: readonly BoxCollider[], seed: number): THREE.BufferGeometry {
  const crest = cliffCrest(walls, seed);
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  };

  for (const wall of walls) {
    const f = footprint(wall);
    const bottom = wall.center.y - wall.half.y;
    // `enclose` sinks every wall 8 m under the floor it stands on; the rock starts a metre under it.
    const floor = bottom + 7;
    // Each side runs so that (along × up) is its outward normal: the triangles face out.
    const sides: { from: [number, number]; to: [number, number]; inward: [number, number]; axis: number }[] = [
      { from: [f.maxX, f.minZ], to: [f.minX, f.minZ], inward: [0, 1], axis: 0 },
      { from: [f.minX, f.maxZ], to: [f.maxX, f.maxZ], inward: [0, -1], axis: 0 },
      { from: [f.maxX, f.maxZ], to: [f.maxX, f.minZ], inward: [-1, 0], axis: 1 },
      { from: [f.minX, f.minZ], to: [f.minX, f.maxZ], inward: [1, 0], axis: 1 },
    ];
    for (const side of sides) {
      const length = Math.hypot(side.to[0] - side.from[0], side.to[1] - side.from[1]);
      const cols = Math.max(1, Math.round(length / CLIFF_CELL));
      const limit = (side.axis === 0 ? wall.half.z : wall.half.x) * (2 / 3);
      const column = (i: number): { x: number; z: number; top: number; end: number } => {
        const t = i / cols;
        const x = side.from[0] + (side.to[0] - side.from[0]) * t;
        const z = side.from[1] + (side.to[1] - side.from[1]) * t;
        return { x, z, top: crest(x, z), end: Math.min(t, 1 - t) * length };
      };
      const vertex = (col: { x: number; z: number; top: number; end: number }, y: number): number[] => {
        const h = Math.min(y, col.top);
        const along = side.axis === 0 ? col.x : col.z;
        const depth = faceCarve(seed, along, h, side.axis, { top: col.top, floor, end: col.end, limit });
        return [col.x + side.inward[0] * depth, h, col.z + side.inward[1] * depth];
      };
      const highest = Math.max(...Array.from({ length: cols + 1 }, (_, i) => column(i).top));
      const levels = [bottom, floor];
      for (let y = floor + CLIFF_CELL; y < highest; y += CLIFF_CELL) levels.push(y);
      levels.push(highest);
      for (let i = 0; i < cols; i++) {
        const left = column(i);
        const right = column(i + 1);
        for (let k = 0; k + 1 < levels.length; k++) {
          const y0 = levels[k] as number;
          const y1 = levels[k + 1] as number;
          // Wholly above the crest on both edges: nothing to draw. Partly above it: clamped.
          if (y0 >= left.top && y0 >= right.top) break;
          quad(vertex(left, y0), vertex(right, y0), vertex(right, y1), vertex(left, y1));
        }
      }
    }
    // The top: a strip along the wall's length, at the crest, across its thickness.
    const longX = wall.half.x >= wall.half.z;
    const length = (longX ? wall.half.x : wall.half.z) * 2;
    const cols = Math.max(1, Math.round(length / CLIFF_CELL));
    for (let i = 0; i < cols; i++) {
      const a = i / cols;
      const b = (i + 1) / cols;
      const corners = longX
        ? [[f.minX + (f.maxX - f.minX) * a, f.minZ], [f.minX + (f.maxX - f.minX) * b, f.minZ], [f.minX + (f.maxX - f.minX) * b, f.maxZ], [f.minX + (f.maxX - f.minX) * a, f.maxZ]]
        : [[f.minX, f.minZ + (f.maxZ - f.minZ) * a], [f.maxX, f.minZ + (f.maxZ - f.minZ) * a], [f.maxX, f.minZ + (f.maxZ - f.minZ) * b], [f.minX, f.minZ + (f.maxZ - f.minZ) * b]];
      const [p, q, r, s] = corners.map(([x, z]) => [x as number, crest(x as number, z as number), z as number]) as number[][];
      // Wound to face up, like the sides face out.
      quad(p as number[], s as number[], r as number[], q as number[]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // The collider material blends its triplanar detail by the vertex normal and falls back to "up"
  // without one — every face would be lit as a flat top. See `fillUnitCube`.
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
