/**
 * Tiling procedural noise, as plain numbers.
 *
 * Separated from anything that touches a canvas or a GPU for the same reason `darknessValues` is
 * separated from the renderer: this is the half with a right answer, and it can be tested in a
 * process with no DOM. The half that uploads the result is four lines and needs a browser.
 *
 * Everything here is *periodic*. A 124 m floor repeats its texture dozens of times, so a seam is
 * not a subtle artefact — it is a grid drawn across the map. Lattice coordinates wrap at the
 * period, which makes the field genuinely tileable rather than tileable-looking.
 */

/**
 * Hash of a wrapped lattice point.
 *
 * Integer mixing rather than `Math.sin(x * 43758.5)`, the usual shader trick, because that one is
 * only pseudo-random over a narrow input range and visibly repeats once coordinates get large —
 * which they do, immediately, at world scale.
 */
function hash2(ix: number, iy: number, period: number, seed: number): number {
  // Wrap first. `((n % p) + p) % p` rather than `n % p` so negative world coordinates — half the
  // map — land on the same lattice as their positive counterparts instead of mirroring.
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Smoothstep, so the lattice grid does not show as diamond creases between cells. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise on a wrapped lattice. Returns 0..1. */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);

  const n00 = hash2(x0, y0, period, seed);
  const n10 = hash2(x0 + 1, y0, period, seed);
  const n01 = hash2(x0, y0 + 1, period, seed);
  const n11 = hash2(x0 + 1, y0 + 1, period, seed);

  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

export interface FbmOptions {
  octaves: number;
  /** Frequency of the first octave, in lattice cells across the tile. */
  frequency: number;
  /** Frequency multiplier per octave. */
  lacunarity: number;
  /** Amplitude multiplier per octave. */
  gain: number;
}

/**
 * Fractal sum of value noise, normalised to 0..1.
 *
 * `u` and `v` are 0..1 across the tile; each octave's period is its own frequency, so every octave
 * tiles at the tile edge and so does their sum. Normalising by the total amplitude rather than
 * assuming it sums to 1 keeps the output in range for any `gain`, including the gains above 0.5
 * that make a surface look eroded rather than fuzzy.
 */
export function fbm(u: number, v: number, options: FbmOptions, seed: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = options.frequency;

  for (let octave = 0; octave < options.octaves; octave++) {
    // Period is rounded because a lattice has to be an integer number of cells to wrap cleanly;
    // a fractional period is the classic cause of a texture that *almost* tiles.
    const period = Math.max(1, Math.round(frequency));
    sum += valueNoise(u * period, v * period, period, seed + octave * 101) * amplitude;
    total += amplitude;
    amplitude *= options.gain;
    frequency *= options.lacunarity;
  }

  return total > 0 ? sum / total : 0;
}

/**
 * Ridged noise — `1 - |2n - 1|` — which turns smooth blobs into creases.
 *
 * What cracked ice and weathered rock actually look like. Plain fBm gives clouds, and clouds
 * painted on a boulder read as dirt rather than stone.
 */
export function ridged(u: number, v: number, options: FbmOptions, seed: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = options.frequency;

  for (let octave = 0; octave < options.octaves; octave++) {
    const period = Math.max(1, Math.round(frequency));
    const n = valueNoise(u * period, v * period, period, seed + octave * 101);
    sum += (1 - Math.abs(2 * n - 1)) * amplitude;
    total += amplitude;
    amplitude *= options.gain;
    frequency *= options.lacunarity;
  }

  return total > 0 ? sum / total : 0;
}

/**
 * Worley / cellular noise, returning distance to the nearest feature point, 0..1.
 *
 * Gives the one thing fBm cannot: *cells* with edges. Snow grains, the facets in glazed ice and
 * the pebbles in packed dirt are all cell structures, and a surface built only from fractal noise
 * never quite reads as granular.
 */
export function worley(u: number, v: number, cells: number, seed: number): number {
  const cx = Math.floor(u * cells);
  const cy = Math.floor(v * cells);
  let nearest = Number.POSITIVE_INFINITY;

  // The 3×3 neighbourhood is enough: a feature point lives inside its own cell, so nothing outside
  // one cell of the sample can be nearer than something inside it.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const px = (gx + hash2(gx, gy, cells, seed)) / cells;
      const py = (gy + hash2(gx, gy, cells, seed + 7919)) / cells;
      // Compare in tile space with wrap-around, so cells at the edge pair with cells at the far
      // side and the tile seam has the same grain as the middle.
      let ddx = px - u;
      let ddy = py - v;
      if (ddx > 0.5) ddx -= 1;
      if (ddx < -0.5) ddx += 1;
      if (ddy > 0.5) ddy -= 1;
      if (ddy < -0.5) ddy += 1;
      const d = ddx * ddx + ddy * ddy;
      if (d < nearest) nearest = d;
    }
  }

  // Scaled by the cell size so the result is roughly 0..1 whatever the cell count.
  return Math.min(1, Math.sqrt(nearest) * cells);
}

/**
 * Turn a height field into a tangent-space normal map, in place, as RGB bytes.
 *
 * Central differences rather than a Sobel kernel: the height field here is already smooth (it came
 * from interpolated noise), so the extra taps of a Sobel buy nothing and cost a third more time on
 * a 1024² map generated during a loading screen.
 *
 * Neighbours wrap, because the height field tiles and a normal map that does not would draw a
 * bright seam exactly where the albedo hides one.
 */
export function heightToNormal(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)] ?? 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;

      // The normal of a height field is (-dx, -dy, 1), normalised.
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      out[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      out[i + 3] = 255;
    }
  }

  return out;
}
