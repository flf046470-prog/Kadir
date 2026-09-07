/**
 * Allocation-conscious 3D vector math.
 *
 * Vectors are plain `{x,y,z}` objects so they can be serialised, pooled and compared cheaply.
 * Every operation takes an explicit `out` so hot paths (the simulation runs 60x/second per
 * player) never allocate.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function v3set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function v3copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function v3clone(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function v3zero(out: Vec3): Vec3 {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  return out;
}

export function v3add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function v3sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function v3scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

/** out = a + b * s — the workhorse of every integrator in the sim. */
export function v3addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function v3mul(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x * b.x;
  out.y = a.y * b.y;
  out.z = a.z * b.z;
  return out;
}

export function v3neg(out: Vec3, a: Vec3): Vec3 {
  out.x = -a.x;
  out.y = -a.y;
  out.z = -a.z;
  return out;
}

export function v3dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function v3cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function v3lengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function v3length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function v3distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function v3distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(v3distanceSq(a, b));
}

/** Horizontal (XZ) distance — used by tag range, interest management and grip search. */
export function v3distanceXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function v3normalize(out: Vec3, a: Vec3): Vec3 {
  const len = v3length(a);
  if (len < 1e-9) return v3set(out, 0, 0, 0);
  const inv = 1 / len;
  out.x = a.x * inv;
  out.y = a.y * inv;
  out.z = a.z * inv;
  return out;
}

export function v3lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** Clamp magnitude, preserving direction. Returns true when clamping actually happened. */
export function v3clampLength(out: Vec3, a: Vec3, max: number): boolean {
  const lenSq = v3lengthSq(a);
  if (lenSq <= max * max || lenSq < 1e-12) {
    v3copy(out, a);
    return false;
  }
  const s = max / Math.sqrt(lenSq);
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return true;
}

/** Remove the component of `a` along `n` (n must be normalised). */
export function v3projectOnPlane(out: Vec3, a: Vec3, n: Vec3): Vec3 {
  const d = v3dot(a, n);
  out.x = a.x - n.x * d;
  out.y = a.y - n.y * d;
  out.z = a.z - n.z * d;
  return out;
}

/** Reflect `a` about plane normal `n` with `bounciness` in 0..1 (0 = slide, 1 = perfect bounce). */
export function v3reflect(out: Vec3, a: Vec3, n: Vec3, bounciness: number): Vec3 {
  const d = v3dot(a, n);
  const k = (1 + bounciness) * d;
  out.x = a.x - n.x * k;
  out.y = a.y - n.y * k;
  out.z = a.z - n.z * k;
  return out;
}

export function v3equalsApprox(a: Vec3, b: Vec3, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}

export function v3isFinite(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}

export const V3_UP: Readonly<Vec3> = Object.freeze({ x: 0, y: 1, z: 0 });
export const V3_ZERO: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });
