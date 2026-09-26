import type { Vec3 } from '../math/vec3.js';
import { v3copy, v3set } from '../math/vec3.js';
import {
  aabbOverlaps,
  closestPointSegmentCollider,
  colliderAabb,
  makeAabb,
  rayCollider,
} from './geometry.js';
import type { Aabb, Collider, RaycastResult, SurfaceQueryResult } from './types.js';
import { DEFAULT_SURFACE, SurfaceFlags, hasFlag, isGrabbable } from './types.js';

export interface RaycastOptions {
  /** Ignore colliders whose surface lacks every flag in this mask. 0 = accept all. */
  requireFlags?: number;
  /** Ignore colliders whose surface has any flag in this mask. */
  rejectFlags?: number;
}

/**
 * Static collision world: a uniform XZ grid over the level's colliders.
 *
 * The level is static, so the grid is built once at load and then every query is
 * allocation-free. Dynamic entities (players) are handled separately by the simulation, which
 * keeps this structure cache-friendly and identical on client and server.
 */
export class PhysicsWorld {
  readonly colliders: Collider[];
  readonly cellSize: number;

  private cells = new Map<number, number[]>();
  private bounds: Aabb = makeAabb();
  private stamp: Int32Array;
  private queryId = 0;
  private scratchAabb: Aabb = makeAabb();
  private colliderBounds: Aabb[] = [];

  constructor(colliders: Collider[], cellSize = 6) {
    this.colliders = colliders;
    this.cellSize = cellSize;
    this.stamp = new Int32Array(colliders.length);
    this.rebuild();
  }

  private rebuild(): void {
    this.cells.clear();
    this.colliderBounds = [];
    let first = true;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i] as Collider;
      const box = colliderAabb(makeAabb(), c);
      this.colliderBounds.push(box);
      if (first) {
        this.bounds = { ...box };
        first = false;
      } else {
        this.bounds.minX = Math.min(this.bounds.minX, box.minX);
        this.bounds.minY = Math.min(this.bounds.minY, box.minY);
        this.bounds.minZ = Math.min(this.bounds.minZ, box.minZ);
        this.bounds.maxX = Math.max(this.bounds.maxX, box.maxX);
        this.bounds.maxY = Math.max(this.bounds.maxY, box.maxY);
        this.bounds.maxZ = Math.max(this.bounds.maxZ, box.maxZ);
      }
      const x0 = Math.floor(box.minX / this.cellSize);
      const x1 = Math.floor(box.maxX / this.cellSize);
      const z0 = Math.floor(box.minZ / this.cellSize);
      const z1 = Math.floor(box.maxZ / this.cellSize);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = cellKey(x, z);
          let list = this.cells.get(key);
          if (!list) {
            list = [];
            this.cells.set(key, list);
          }
          list.push(i);
        }
      }
    }
    this.stamp = new Int32Array(this.colliders.length);
  }

  get levelBounds(): Readonly<Aabb> {
    return this.bounds;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Visit every collider whose AABB overlaps `box`. Each collider is visited at most once per
   * query thanks to the stamp array (no Set allocation in the hot path).
   */
  queryAabb(box: Aabb, visit: (index: number, collider: Collider) => void): void {
    const id = ++this.queryId;
    const x0 = Math.floor(box.minX / this.cellSize);
    const x1 = Math.floor(box.maxX / this.cellSize);
    const z0 = Math.floor(box.minZ / this.cellSize);
    const z1 = Math.floor(box.maxZ / this.cellSize);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.cells.get(cellKey(x, z));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const index = list[k] as number;
          if (this.stamp[index] === id) continue;
          this.stamp[index] = id;
          if (!aabbOverlaps(box, this.colliderBounds[index] as Aabb)) continue;
          visit(index, this.colliders[index] as Collider);
        }
      }
    }
  }

  /** Visit colliders near a capsule segment, expanded by `radius`. */
  queryCapsule(p0: Vec3, p1: Vec3, radius: number, visit: (index: number, collider: Collider) => void): void {
    const b = this.scratchAabb;
    b.minX = Math.min(p0.x, p1.x) - radius;
    b.maxX = Math.max(p0.x, p1.x) + radius;
    b.minY = Math.min(p0.y, p1.y) - radius;
    b.maxY = Math.max(p0.y, p1.y) + radius;
    b.minZ = Math.min(p0.z, p1.z) - radius;
    b.maxZ = Math.max(p0.z, p1.z) + radius;
    this.queryAabb(b, visit);
  }

  /**
   * Nearest surface point to `point` within `maxDist`.
   * This is what VR hands, the climb system and grab targeting all run on.
   */
  closestSurface(
    out: SurfaceQueryResult,
    point: Vec3,
    maxDist: number,
    grabbableOnly = false,
  ): SurfaceQueryResult {
    out.hit = false;
    out.colliderIndex = -1;
    out.distance = Infinity;
    out.surface = DEFAULT_SURFACE;

    const b = this.scratchAabb;
    b.minX = point.x - maxDist;
    b.maxX = point.x + maxDist;
    b.minY = point.y - maxDist;
    b.maxY = point.y + maxDist;
    b.minZ = point.z - maxDist;
    b.maxZ = point.z + maxDist;

    this.queryAabb(b, (index, collider) => {
      if (grabbableOnly && !isGrabbable(collider.surface)) return;
      const res = closestPointSegmentCollider(_qSeg, _qPoint, _qNormal, point, point, collider);
      const dist = res.distance;
      if (dist < out.distance) {
        out.distance = dist;
        out.colliderIndex = index;
        out.hit = dist <= maxDist;
        v3copy(out.point, _qPoint);
        v3copy(out.normal, _qNormal);
        out.surface = collider.surface;
      }
    });
    if (!out.hit) out.colliderIndex = -1;
    return out;
  }

  raycast(
    out: RaycastResult,
    origin: Vec3,
    dir: Vec3,
    maxDist: number,
    options: RaycastOptions = {},
  ): RaycastResult {
    out.hit = false;
    out.colliderIndex = -1;
    out.distance = Infinity;
    out.surface = DEFAULT_SURFACE;

    const b = this.scratchAabb;
    b.minX = Math.min(origin.x, origin.x + dir.x * maxDist);
    b.maxX = Math.max(origin.x, origin.x + dir.x * maxDist);
    b.minY = Math.min(origin.y, origin.y + dir.y * maxDist);
    b.maxY = Math.max(origin.y, origin.y + dir.y * maxDist);
    b.minZ = Math.min(origin.z, origin.z + dir.z * maxDist);
    b.maxZ = Math.max(origin.z, origin.z + dir.z * maxDist);

    const requireFlags = options.requireFlags ?? 0;
    const rejectFlags = options.rejectFlags ?? 0;

    this.queryAabb(b, (index, collider) => {
      if (requireFlags !== 0 && (collider.surface.flags & requireFlags) === 0) return;
      if (rejectFlags !== 0 && (collider.surface.flags & rejectFlags) !== 0) return;
      const t = rayCollider(origin, dir, maxDist, collider, _qNormal);
      if (t >= 0 && t < out.distance) {
        out.distance = t;
        out.hit = true;
        out.colliderIndex = index;
        v3copy(out.normal, _qNormal);
        v3set(out.point, origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
        out.surface = collider.surface;
      }
    });
    return out;
  }

  /** Convenience: is this point inside solid geometry? Used by spawn validation. */
  isPointInsideSolid(point: Vec3): boolean {
    let inside = false;
    const b = this.scratchAabb;
    b.minX = point.x - 0.01;
    b.maxX = point.x + 0.01;
    b.minY = point.y - 0.01;
    b.maxY = point.y + 0.01;
    b.minZ = point.z - 0.01;
    b.maxZ = point.z + 0.01;
    this.queryAabb(b, (_index, collider) => {
      if (inside) return;
      if (hasFlag(collider.surface, SurfaceFlags.OneWay)) return;
      const res = closestPointSegmentCollider(_qSeg, _qPoint, _qNormal, point, point, collider);
      if (res.inside) inside = true;
    });
    return inside;
  }
}

const _qSeg: Vec3 = { x: 0, y: 0, z: 0 };
const _qPoint: Vec3 = { x: 0, y: 0, z: 0 };
const _qNormal: Vec3 = { x: 0, y: 0, z: 0 };

function cellKey(x: number, z: number): number {
  // Pack two signed 16-bit cell coordinates into one number key.
  return ((x & 0xffff) << 16) | (z & 0xffff);
}
