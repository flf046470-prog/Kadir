/**
 * Smooth 2D value noise, for terrain.
 *
 * Integer hashing and plain arithmetic only — no `Math.sin`, no table built from a random stream —
 * so the server and every client compute the same height at the same point, and shaping a map's
 * ground does not consume the level's `Rand` and move every tree placed after it.
 */
function hash2(seed: number, x: number, z: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise in [-1, 1] with a feature size of one unit, smooth (C1) between lattice points. */
export function valueNoise2(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(seed, x0, z0);
  const b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1);
  const d = hash2(seed, x0 + 1, z0 + 1);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return (top + (bottom - top) * sz) * 2 - 1;
}

/**
 * Layered value noise: `octaves` layers, each at twice the frequency and `gain` of the amplitude of
 * the last. `wavelength` is the size of the broadest feature, in world units. Roughly in [-1, 1].
 */
export function fractalNoise2(seed: number, x: number, z: number, wavelength: number, octaves = 3, gain = 0.45): number {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let frequency = 1 / wavelength;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(seed + o * 1013, x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }
  return sum / norm;
}
