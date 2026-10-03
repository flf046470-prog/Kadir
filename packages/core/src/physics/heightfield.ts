import type { Vec3 } from '../math/vec3.js';
import { v3set } from '../math/vec3.js';
import type { HeightfieldCollider } from './types.js';

/**
 * Terrain: a grid of heights, solid from the surface down to `bottom`.
 *
 * Every other collider is a box, a sphere or a cylinder, so until this existed every floor in the
 * game was a plane and every way between two heights was a stair of boxes. Measured on the jungle
 * before it: the ramp into the cave was buried in the jungle floor along its whole length — every
 * point over it read the floor's own 0.00 — and the real way in was a 4 m sheer drop.
 *
 * Each cell is two triangles split along the diagonal from its (0, 0) corner to its (1, 1) corner.
 * `LevelRenderer` builds its mesh on the same diagonal, and `heightfield.test.ts` holds the
 * physics to the triangles the renderer draws: a player stands on what they see.
 */

/** How far round a point the closest-point search looks, in metres. */
export const HEIGHTFIELD_SEARCH = 2.5;

export function heightfieldMaxX(hf: HeightfieldCollider): number {
  return hf.minX + (hf.cols - 1) * hf.cellSize;
}

export function heightfieldMaxZ(hf: HeightfieldCollider): number {
  return hf.minZ + (hf.rows - 1) * hf.cellSize;
}

function sample(hf: HeightfieldCollider, i: number, j: number): number {
  return hf.heights[j * hf.cols + i] as number;
}

/** Cell index and local coordinates of a point already clamped to the footprint. */
function locate(hf: HeightfieldCollider, x: number, z: number): { i: number; j: number; u: number; v: number } {
  const fx = (x - hf.minX) / hf.cellSize;
  const fz = (z - hf.minZ) / hf.cellSize;
  const i = Math.min(hf.cols - 2, Math.max(0, Math.floor(fx)));
  const j = Math.min(hf.rows - 2, Math.max(0, Math.floor(fz)));
  return { i, j, u: fx - i, v: fz - j };
}

/** Surface height at (x, z), clamped to the footprint. Exact on the two triangles of each cell. */
export function heightfieldHeight(hf: HeightfieldCollider, x: number, z: number): number {
  const cx = Math.min(heightfieldMaxX(hf), Math.max(hf.minX, x));
  const cz = Math.min(heightfieldMaxZ(hf), Math.max(hf.minZ, z));
  const { i, j, u, v } = locate(hf, cx, cz);
  const h00 = sample(hf, i, j);
  const h10 = sample(hf, i + 1, j);
  const h01 = sample(hf, i, j + 1);
  const h11 = sample(hf, i + 1, j + 1);
  return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01);
}

/** Upward unit normal of the triangle under (x, z). */
export function heightfieldNormal(out: Vec3, hf: HeightfieldCollider, x: number, z: number): Vec3 {
  const cx = Math.min(heightfieldMaxX(hf), Math.max(hf.minX, x));
  const cz = Math.min(heightfieldMaxZ(hf), Math.max(hf.minZ, z));
  const { i, j, u, v } = locate(hf, cx, cz);
  return triangleNormal(out, hf, i, j, u >= v);
}

function triangleNormal(out: Vec3, hf: HeightfieldCollider, i: number, j: number, first: boolean): Vec3 {
  const cs = hf.cellSize;
  const h00 = sample(hf, i, j);
  const h10 = sample(hf, i + 1, j);
  const h01 = sample(hf, i, j + 1);
  const h11 = sample(hf, i + 1, j + 1);
  const dx = first ? (h10 - h00) / cs : (h11 - h01) / cs;
  const dz = first ? (h11 - h10) / cs : (h01 - h00) / cs;
  const len = Math.sqrt(dx * dx + 1 + dz * dz);
  return v3set(out, -dx / len, 1 / len, -dz / len);
}

// Scratch for the triangle corners; the physics is single-threaded and allocation-free.
const _a: Vec3 = { x: 0, y: 0, z: 0 };
const _b: Vec3 = { x: 0, y: 0, z: 0 };
const _c: Vec3 = { x: 0, y: 0, z: 0 };
const _q: Vec3 = { x: 0, y: 0, z: 0 };
const _n: Vec3 = { x: 0, y: 0, z: 0 };

/** The three corners of one triangle of cell (i, j): the (0,0)–(1,1) diagonal and one more. */
function corners(hf: HeightfieldCollider, i: number, j: number, first: boolean): void {
  const cs = hf.cellSize;
  const x0 = hf.minX + i * cs;
  const z0 = hf.minZ + j * cs;
  v3set(_a, x0, sample(hf, i, j), z0);
  v3set(_b, x0 + cs, sample(hf, i + 1, j + 1), z0 + cs);
  if (first) v3set(_c, x0 + cs, sample(hf, i + 1, j), z0);
  else v3set(_c, x0, sample(hf, i, j + 1), z0 + cs);
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection §5.1.5). */
function closestOnTriangle(out: Vec3, p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return v3set(out, a.x, a.y, a.z);
  const bpx = p.x - b.x, bpy = p.y - b.y, bpz = p.z - b.z;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return v3set(out, b.x, b.y, b.z);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return v3set(out, a.x + abx * t, a.y + aby * t, a.z + abz * t);
  }
  const cpx = p.x - c.x, cpy = p.y - c.y, cpz = p.z - c.z;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return v3set(out, c.x, c.y, c.z);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return v3set(out, a.x + acx * t, a.y + acy * t, a.z + acz * t);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return v3set(out, b.x + (c.x - b.x) * t, b.y + (c.y - b.y) * t, b.z + (c.z - b.z) * t);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return v3set(out, a.x + abx * v + acx * w, a.y + aby * v + acy * w, a.z + abz * v + acz * w);
}

/**
 * Closest point of the terrain solid to `point`. Returns true when `point` is inside it, in which
 * case `outNormal` is the direction out of the nearest face; otherwise it points from the surface
 * towards `point`, as for every other collider.
 *
 * The search is bounded. A surface point closer than the one straight below (or beside) `point`
 * lies within that distance of it horizontally, so only the cells inside that radius — capped at
 * `HEIGHTFIELD_SEARCH` — can hold the answer. Past the cap the result is an upper bound, which is
 * all a contact query needs: every caller asks about distances well under it.
 */
export function closestPointOnHeightfield(outPoint: Vec3, outNormal: Vec3, point: Vec3, hf: HeightfieldCollider): boolean {
  const maxX = heightfieldMaxX(hf);
  const maxZ = heightfieldMaxZ(hf);
  const cx = Math.min(maxX, Math.max(hf.minX, point.x));
  const cz = Math.min(maxZ, Math.max(hf.minZ, point.z));
  const within = cx === point.x && cz === point.z;
  const surface = heightfieldHeight(hf, cx, cz);
  const inside = within && point.y < surface && point.y > hf.bottom;

  // Start from the surface point straight below (or at the nearest edge of) the footprint.
  v3set(outPoint, cx, surface, cz);
  heightfieldNormal(_n, hf, cx, cz);
  let faceX = _n.x;
  let faceY = _n.y;
  let faceZ = _n.z;
  let best = distanceSq(point, outPoint);

  const reach = Math.min(Math.sqrt(best), HEIGHTFIELD_SEARCH);
  const i0 = Math.max(0, Math.floor((point.x - reach - hf.minX) / hf.cellSize));
  const i1 = Math.min(hf.cols - 2, Math.floor((point.x + reach - hf.minX) / hf.cellSize));
  const j0 = Math.max(0, Math.floor((point.z - reach - hf.minZ) / hf.cellSize));
  const j1 = Math.min(hf.rows - 2, Math.floor((point.z + reach - hf.minZ) / hf.cellSize));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      for (let k = 0; k < 2; k++) {
        corners(hf, i, j, k === 0);
        closestOnTriangle(_q, point, _a, _b, _c);
        const d = distanceSq(point, _q);
        if (d < best) {
          best = d;
          v3set(outPoint, _q.x, _q.y, _q.z);
          triangleNormal(_n, hf, i, j, k === 0);
          faceX = _n.x;
          faceY = _n.y;
          faceZ = _n.z;
        }
      }
    }
  }

  // The sides of the slab, down to `bottom`. Only reachable within `best` of an edge.
  const bestDist = Math.sqrt(best);
  for (let side = 0; side < 4; side++) {
    const alongX = side < 2;
    const edge = alongX ? (side === 0 ? hf.minX : maxX) : side === 2 ? hf.minZ : maxZ;
    const across = alongX ? point.x : point.z;
    if (Math.abs(across - edge) >= bestDist) continue;
    const qx = alongX ? edge : cx;
    const qz = alongX ? cz : edge;
    const qy = Math.min(heightfieldHeight(hf, qx, qz), Math.max(hf.bottom, point.y));
    const d = (point.x - qx) ** 2 + (point.y - qy) ** 2 + (point.z - qz) ** 2;
    if (d < best) {
      best = d;
      v3set(outPoint, qx, qy, qz);
      const s = side % 2 === 0 ? -1 : 1;
      faceX = alongX ? s : 0;
      faceY = 0;
      faceZ = alongX ? 0 : s;
    }
  }
  // And its underside.
  if (within && (point.y - hf.bottom) ** 2 < best && point.y < surface) {
    best = (point.y - hf.bottom) ** 2;
    v3set(outPoint, point.x, hf.bottom, point.z);
    faceX = 0;
    faceY = -1;
    faceZ = 0;
  }

  if (inside) {
    v3set(outNormal, faceX, faceY, faceZ);
    return true;
  }
  const nx = point.x - outPoint.x;
  const ny = point.y - outPoint.y;
  const nz = point.z - outPoint.z;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-9) v3set(outNormal, faceX, faceY, faceZ);
  else v3set(outNormal, nx / len, ny / len, nz / len);
  return false;
}

function distanceSq(a: Vec3, b: Vec3): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

/** Ray against one triangle (Möller–Trumbore), both faces. Distance along the ray or -1. */
function rayTriangle(origin: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
  const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const px = dir.y * e2z - dir.z * e2y;
  const py = dir.z * e2x - dir.x * e2z;
  const pz = dir.x * e2y - dir.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = origin.x - a.x, ty = origin.y - a.y, tz = origin.z - a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dir.x * qx + dir.y * qy + dir.z * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/**
 * Ray against the terrain solid: its surface, its four sides and its underside. Returns the entry
 * distance or -1. A ray that starts inside meets it at 0, as a ray inside a box does — `enclose`
 * relies on that to merge a solid with the one above it.
 */
export function rayHeightfield(origin: Vec3, dir: Vec3, maxDist: number, hf: HeightfieldCollider, outNormal: Vec3): number {
  const maxX = heightfieldMaxX(hf);
  const maxZ = heightfieldMaxZ(hf);
  const withinStart = origin.x >= hf.minX && origin.x <= maxX && origin.z >= hf.minZ && origin.z <= maxZ;
  if (withinStart && origin.y > hf.bottom && origin.y < heightfieldHeight(hf, origin.x, origin.z)) {
    v3set(outNormal, 0, 1, 0);
    return 0;
  }

  // Clip the ray to the slab's bounding box.
  let tmin = 0;
  let tmax = maxDist;
  let enterAxis = -1;
  let enterSign = 0;
  const lo = [hf.minX, hf.bottom, hf.minZ];
  const hi = [maxX, hf.top, maxZ];
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  for (let k = 0; k < 3; k++) {
    const dk = d[k] as number;
    const ok = o[k] as number;
    if (Math.abs(dk) < 1e-12) {
      if (ok < (lo[k] as number) || ok > (hi[k] as number)) return -1;
      continue;
    }
    let t1 = ((lo[k] as number) - ok) / dk;
    let t2 = ((hi[k] as number) - ok) / dk;
    let sign = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      enterAxis = k;
      enterSign = sign;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Entering through a side below the surface there, or through the underside, is a hit on it.
  if (enterAxis === 0 || enterAxis === 2 || (enterAxis === 1 && enterSign < 0)) {
    const ex = origin.x + dir.x * tmin;
    const ey = origin.y + dir.y * tmin;
    const ez = origin.z + dir.z * tmin;
    if (enterAxis === 1 ? ey <= heightfieldHeight(hf, ex, ez) : ey < heightfieldHeight(hf, ex, ez)) {
      v3set(outNormal, enterAxis === 0 ? enterSign : 0, enterAxis === 1 ? -1 : 0, enterAxis === 2 ? enterSign : 0);
      return tmin;
    }
  }

  // Walk the cells under the clipped ray (Amanatides & Woo), nearest first.
  const cs = hf.cellSize;
  const sx = origin.x + dir.x * tmin;
  const sz = origin.z + dir.z * tmin;
  let i = Math.min(hf.cols - 2, Math.max(0, Math.floor((sx - hf.minX) / cs)));
  let j = Math.min(hf.rows - 2, Math.max(0, Math.floor((sz - hf.minZ) / cs)));
  const stepI = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepJ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
  const nextX = hf.minX + (stepI > 0 ? i + 1 : i) * cs;
  const nextZ = hf.minZ + (stepJ > 0 ? j + 1 : j) * cs;
  let tMaxX = stepI !== 0 ? (nextX - origin.x) / dir.x : Infinity;
  let tMaxZ = stepJ !== 0 ? (nextZ - origin.z) / dir.z : Infinity;
  const tDeltaX = stepI !== 0 ? cs / Math.abs(dir.x) : Infinity;
  const tDeltaZ = stepJ !== 0 ? cs / Math.abs(dir.z) : Infinity;

  for (let guard = 0; guard < hf.cols + hf.rows + 2; guard++) {
    let hit = -1;
    for (let k = 0; k < 2; k++) {
      corners(hf, i, j, k === 0);
      const t = rayTriangle(origin, dir, _a, _b, _c);
      if (t >= tmin - 1e-7 && t <= tmax + 1e-7 && (hit < 0 || t < hit)) {
        hit = t;
        triangleNormal(outNormal, hf, i, j, k === 0);
      }
    }
    if (hit >= 0) return Math.max(0, hit);
    const leave = Math.min(tMaxX, tMaxZ);
    if (leave > tmax) break;
    if (tMaxX < tMaxZ) {
      i += stepI;
      tMaxX += tDeltaX;
    } else {
      j += stepJ;
      tMaxZ += tDeltaZ;
    }
    if (i < 0 || j < 0 || i > hf.cols - 2 || j > hf.rows - 2) break;
  }
  return -1;
}
