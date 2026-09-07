import type { Vec3 } from '../math/vec3.js';
import { v3set, v3sub, v3dot, v3length } from '../math/vec3.js';
import type { Aabb, BoxCollider, Collider, CylinderCollider, SphereCollider } from './types.js';

/** Parametric position of the closest point on segment [p0,p1] to `point`, clamped to 0..1. */
export function closestTOnSegment(p0: Vec3, p1: Vec3, point: Vec3): number {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const lenSq = dx * dx + dy * dy + dz * dz;
  if (lenSq < 1e-12) return 0;
  const t = ((point.x - p0.x) * dx + (point.y - p0.y) * dy + (point.z - p0.z) * dz) / lenSq;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function segmentPoint(out: Vec3, p0: Vec3, p1: Vec3, t: number): Vec3 {
  return v3set(out, p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, p0.z + (p1.z - p0.z) * t);
}

/**
 * Closest point on a yaw-rotated box to `point`.
 * Returns true when `point` is inside the box, in which case `outPoint` is pushed to the nearest
 * face and `outNormal` is the minimal escape direction.
 */
export function closestPointOnBox(
  outPoint: Vec3,
  outNormal: Vec3,
  point: Vec3,
  box: BoxCollider,
): boolean {
  const cos = Math.cos(box.yaw);
  const sin = Math.sin(box.yaw);
  const dx = point.x - box.center.x;
  const dy = point.y - box.center.y;
  const dz = point.z - box.center.z;
  // Rotate into box space (inverse yaw).
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  const ly = dy;

  const hx = box.half.x;
  const hy = box.half.y;
  const hz = box.half.z;

  const inside = Math.abs(lx) <= hx && Math.abs(ly) <= hy && Math.abs(lz) <= hz;

  let cx = lx < -hx ? -hx : lx > hx ? hx : lx;
  let cy = ly < -hy ? -hy : ly > hy ? hy : ly;
  let cz = lz < -hz ? -hz : lz > hz ? hz : lz;

  let nx = 0;
  let ny = 0;
  let nz = 0;

  if (inside) {
    // Escape along the axis with the smallest penetration.
    const px = hx - Math.abs(lx);
    const py = hy - Math.abs(ly);
    const pz = hz - Math.abs(lz);
    if (px <= py && px <= pz) {
      const s = lx >= 0 ? 1 : -1;
      cx = hx * s;
      nx = s;
    } else if (py <= pz) {
      const s = ly >= 0 ? 1 : -1;
      cy = hy * s;
      ny = s;
    } else {
      const s = lz >= 0 ? 1 : -1;
      cz = hz * s;
      nz = s;
    }
  } else {
    nx = lx - cx;
    ny = ly - cy;
    nz = lz - cz;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-9) {
      ny = 1;
    } else {
      nx /= len;
      ny /= len;
      nz /= len;
    }
  }

  // Rotate back to world space.
  v3set(outPoint, box.center.x + cx * cos - cz * sin, box.center.y + cy, box.center.z + cx * sin + cz * cos);
  v3set(outNormal, nx * cos - nz * sin, ny, nx * sin + nz * cos);
  return inside;
}

export function closestPointOnSphere(
  outPoint: Vec3,
  outNormal: Vec3,
  point: Vec3,
  sphere: SphereCollider,
): boolean {
  const dx = point.x - sphere.center.x;
  const dy = point.y - sphere.center.y;
  const dz = point.z - sphere.center.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) {
    v3set(outNormal, 0, 1, 0);
    v3set(outPoint, sphere.center.x, sphere.center.y + sphere.radius, sphere.center.z);
    return true;
  }
  const inv = 1 / len;
  v3set(outNormal, dx * inv, dy * inv, dz * inv);
  v3set(
    outPoint,
    sphere.center.x + outNormal.x * sphere.radius,
    sphere.center.y + outNormal.y * sphere.radius,
    sphere.center.z + outNormal.z * sphere.radius,
  );
  return len < sphere.radius;
}

export function closestPointOnCylinder(
  outPoint: Vec3,
  outNormal: Vec3,
  point: Vec3,
  cyl: CylinderCollider,
): boolean {
  const dx = point.x - cyl.center.x;
  const dz = point.z - cyl.center.z;
  const dy = point.y - cyl.center.y;
  const radial = Math.sqrt(dx * dx + dz * dz);
  const withinY = Math.abs(dy) <= cyl.halfHeight;
  const withinR = radial <= cyl.radius;
  const inside = withinY && withinR;

  const cy = dy < -cyl.halfHeight ? -cyl.halfHeight : dy > cyl.halfHeight ? cyl.halfHeight : dy;

  if (inside) {
    const penRadial = cyl.radius - radial;
    const penAxial = cyl.halfHeight - Math.abs(dy);
    if (penRadial <= penAxial) {
      const inv = radial < 1e-9 ? 0 : 1 / radial;
      const nx = radial < 1e-9 ? 1 : dx * inv;
      const nz = radial < 1e-9 ? 0 : dz * inv;
      v3set(outNormal, nx, 0, nz);
      v3set(outPoint, cyl.center.x + nx * cyl.radius, cyl.center.y + cy, cyl.center.z + nz * cyl.radius);
    } else {
      const s = dy >= 0 ? 1 : -1;
      v3set(outNormal, 0, s, 0);
      v3set(outPoint, point.x, cyl.center.y + cyl.halfHeight * s, point.z);
    }
    return true;
  }

  let px: number;
  let pz: number;
  if (radial > cyl.radius) {
    const inv = cyl.radius / (radial || 1);
    px = cyl.center.x + dx * inv;
    pz = cyl.center.z + dz * inv;
  } else {
    px = point.x;
    pz = point.z;
  }
  const py = cyl.center.y + cy;
  v3set(outPoint, px, py, pz);
  const nx = point.x - px;
  const ny = point.y - py;
  const nz = point.z - pz;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-9) v3set(outNormal, 0, 1, 0);
  else v3set(outNormal, nx / len, ny / len, nz / len);
  return false;
}

/** Dispatch by collider kind. Returns true when `point` is inside. */
export function closestPointOnCollider(
  outPoint: Vec3,
  outNormal: Vec3,
  point: Vec3,
  collider: Collider,
): boolean {
  switch (collider.kind) {
    case 'box':
      return closestPointOnBox(outPoint, outNormal, point, collider);
    case 'sphere':
      return closestPointOnSphere(outPoint, outNormal, point, collider);
    case 'cylinder':
      return closestPointOnCylinder(outPoint, outNormal, point, collider);
  }
}

const _segPoint: Vec3 = { x: 0, y: 0, z: 0 };
const _tmpPoint: Vec3 = { x: 0, y: 0, z: 0 };
const _tmpNormal: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Closest pair between a capsule's core segment and a collider.
 * Two refinement iterations converge tightly for boxes/cylinders and exactly for spheres,
 * which is all a kinematic character controller needs.
 */
export function closestPointSegmentCollider(
  outOnSegment: Vec3,
  outOnCollider: Vec3,
  outNormal: Vec3,
  p0: Vec3,
  p1: Vec3,
  collider: Collider,
): { distance: number; inside: boolean } {
  let t = closestTOnSegment(p0, p1, colliderCenter(collider));
  let inside = false;
  for (let i = 0; i < 3; i++) {
    segmentPoint(_segPoint, p0, p1, t);
    inside = closestPointOnCollider(_tmpPoint, _tmpNormal, _segPoint, collider);
    const nextT = closestTOnSegment(p0, p1, _tmpPoint);
    if (Math.abs(nextT - t) < 1e-4) {
      t = nextT;
      break;
    }
    t = nextT;
  }
  segmentPoint(outOnSegment, p0, p1, t);
  inside = closestPointOnCollider(outOnCollider, outNormal, outOnSegment, collider);
  const d = v3length(v3sub(_tmpPoint, outOnSegment, outOnCollider));
  return { distance: inside ? -d : d, inside };
}

export function colliderCenter(collider: Collider): Vec3 {
  return collider.center;
}

export function colliderAabb(out: Aabb, collider: Collider): Aabb {
  switch (collider.kind) {
    case 'box': {
      // Conservative bound for a yaw-rotated box.
      const cos = Math.abs(Math.cos(collider.yaw));
      const sin = Math.abs(Math.sin(collider.yaw));
      const ex = collider.half.x * cos + collider.half.z * sin;
      const ez = collider.half.x * sin + collider.half.z * cos;
      out.minX = collider.center.x - ex;
      out.maxX = collider.center.x + ex;
      out.minY = collider.center.y - collider.half.y;
      out.maxY = collider.center.y + collider.half.y;
      out.minZ = collider.center.z - ez;
      out.maxZ = collider.center.z + ez;
      return out;
    }
    case 'sphere':
      out.minX = collider.center.x - collider.radius;
      out.maxX = collider.center.x + collider.radius;
      out.minY = collider.center.y - collider.radius;
      out.maxY = collider.center.y + collider.radius;
      out.minZ = collider.center.z - collider.radius;
      out.maxZ = collider.center.z + collider.radius;
      return out;
    case 'cylinder':
      out.minX = collider.center.x - collider.radius;
      out.maxX = collider.center.x + collider.radius;
      out.minY = collider.center.y - collider.halfHeight;
      out.maxY = collider.center.y + collider.halfHeight;
      out.minZ = collider.center.z - collider.radius;
      out.maxZ = collider.center.z + collider.radius;
      return out;
  }
}

export function makeAabb(): Aabb {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

export function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

/** Slab test against a yaw-rotated box. Returns entry distance or -1. */
export function rayBox(origin: Vec3, dir: Vec3, maxDist: number, box: BoxCollider, outNormal: Vec3): number {
  const cos = Math.cos(box.yaw);
  const sin = Math.sin(box.yaw);
  const dx = origin.x - box.center.x;
  const dz = origin.z - box.center.z;
  const ox = dx * cos + dz * sin;
  const oz = -dx * sin + dz * cos;
  const oy = origin.y - box.center.y;
  const rx = dir.x * cos + dir.z * sin;
  const rz = -dir.x * sin + dir.z * cos;
  const ry = dir.y;

  let tmin = 0;
  let tmax = maxDist;
  let axis = 0;
  let sign = 1;

  const o = [ox, oy, oz];
  const d = [rx, ry, rz];
  const h = [box.half.x, box.half.y, box.half.z];

  for (let i = 0; i < 3; i++) {
    const di = d[i] as number;
    const oi = o[i] as number;
    const hi = h[i] as number;
    if (Math.abs(di) < 1e-9) {
      if (oi < -hi || oi > hi) return -1;
      continue;
    }
    const inv = 1 / di;
    let t1 = (-hi - oi) * inv;
    let t2 = (hi - oi) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  const nx = axis === 0 ? sign : 0;
  const ny = axis === 1 ? sign : 0;
  const nz = axis === 2 ? sign : 0;
  v3set(outNormal, nx * cos - nz * sin, ny, nx * sin + nz * cos);
  return tmin;
}

export function raySphere(origin: Vec3, dir: Vec3, maxDist: number, sphere: SphereCollider, outNormal: Vec3): number {
  const ox = origin.x - sphere.center.x;
  const oy = origin.y - sphere.center.y;
  const oz = origin.z - sphere.center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - sphere.radius * sphere.radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  if (t < 0 || t > maxDist) return -1;
  const px = ox + dir.x * t;
  const py = oy + dir.y * t;
  const pz = oz + dir.z * t;
  const inv = 1 / (sphere.radius || 1);
  v3set(outNormal, px * inv, py * inv, pz * inv);
  return t;
}

export function rayCylinder(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  cyl: CylinderCollider,
  outNormal: Vec3,
): number {
  const ox = origin.x - cyl.center.x;
  const oz = origin.z - cyl.center.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  const top = cyl.center.y + cyl.halfHeight;
  const bottom = cyl.center.y - cyl.halfHeight;

  if (a > 1e-9) {
    const b = ox * dir.x + oz * dir.z;
    const c = ox * ox + oz * oz - cyl.radius * cyl.radius;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / a, (-b + sq) / a]) {
        if (t < 0 || t > maxDist) continue;
        const y = origin.y + dir.y * t;
        if (y < bottom || y > top) continue;
        const px = ox + dir.x * t;
        const pz = oz + dir.z * t;
        const inv = 1 / (cyl.radius || 1);
        v3set(outNormal, px * inv, 0, pz * inv);
        return t;
      }
    }
  }
  // Caps.
  if (Math.abs(dir.y) > 1e-9) {
    for (const [capY, ny] of [
      [top, 1],
      [bottom, -1],
    ] as const) {
      const t = (capY - origin.y) / dir.y;
      if (t < 0 || t > maxDist) continue;
      const px = ox + dir.x * t;
      const pz = oz + dir.z * t;
      if (px * px + pz * pz > cyl.radius * cyl.radius) continue;
      v3set(outNormal, 0, ny, 0);
      return t;
    }
  }
  return -1;
}

export function rayCollider(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  collider: Collider,
  outNormal: Vec3,
): number {
  switch (collider.kind) {
    case 'box':
      return rayBox(origin, dir, maxDist, collider, outNormal);
    case 'sphere':
      return raySphere(origin, dir, maxDist, collider, outNormal);
    case 'cylinder':
      return rayCylinder(origin, dir, maxDist, collider, outNormal);
  }
}

/** True when the segment is oriented away from the surface (used by one-way platforms). */
export function movingAway(velocity: Vec3, normal: Vec3): boolean {
  return v3dot(velocity, normal) >= 0;
}
