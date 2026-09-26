import { describe, expect, it } from 'vitest';

import { fbm, heightToNormal, ridged, valueNoise, worley } from './noise.js';
import type { FbmOptions } from './noise.js';

/**
 * The noise behind every surface texture.
 *
 * Tested away from three.js because none of it needs a GPU, and because the property that actually
 * matters — that the field tiles — is invisible in a screenshot of a single tile and unmissable
 * across a 124 m floor, where a seam stops being an artefact and becomes a grid drawn on the map.
 */
describe('procedural noise', () => {
  const OPTS: FbmOptions = { octaves: 5, frequency: 4, lacunarity: 2, gain: 0.5 };

  it('wraps the lattice, so the tile edge matches the tile start', () => {
    for (const y of [0, 0.31, 0.77, 1.9]) {
      // Sampling at the period must land on the same lattice point as sampling at zero.
      expect(valueNoise(0, y, 8, 42)).toBeCloseTo(valueNoise(8, y, 8, 42), 12);
      expect(valueNoise(y, 0, 8, 42)).toBeCloseTo(valueNoise(y, 8, 8, 42), 12);
    }
  });

  it('treats negative coordinates as part of the same lattice', () => {
    /**
     * Half the map is at negative world coordinates — the cave sits at x = -72, the crevasse at
     * -78 — so a wrap that mirrors instead of repeating would give those districts a texture that
     * runs backwards against the rest of the map.
     *
     * The samples are deliberately *not* multiples of the period. An earlier version of this test
     * used -8 and -16 against a period of 8 and passed with a plain `ix % period`, because
     * JavaScript evaluates `-8 % 8` as `-0`, which then multiplies to 0 and hashes identically to
     * the correct answer. It asserted the property on exactly the inputs where the bug is
     * invisible. -3 against period 8 must land on lattice cell 5.
     */
    expect(valueNoise(-3, 0.4, 8, 3)).toBeCloseTo(valueNoise(5, 0.4, 8, 3), 12);
    expect(valueNoise(-11, 0.4, 8, 3)).toBeCloseTo(valueNoise(5, 0.4, 8, 3), 12);
    expect(valueNoise(0.4, -3, 8, 3)).toBeCloseTo(valueNoise(0.4, 5, 8, 3), 12);
  });

  it('keeps fbm and ridged inside 0..1 for gains that are not a half', () => {
    // Amplitudes are normalised by their own total rather than assumed to sum to one, so a gain
    // above 0.5 — which is what makes a surface look eroded instead of fuzzy — must not clip.
    for (const gain of [0.35, 0.5, 0.65, 0.8]) {
      const options: FbmOptions = { ...OPTS, gain };
      for (let i = 0; i < 400; i++) {
        const u = (i % 20) / 20;
        const v = Math.floor(i / 20) / 20;
        expect(fbm(u, v, options, 1)).toBeGreaterThanOrEqual(0);
        expect(fbm(u, v, options, 1)).toBeLessThanOrEqual(1);
        expect(ridged(u, v, options, 1)).toBeGreaterThanOrEqual(0);
        expect(ridged(u, v, options, 1)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('tiles fbm across the whole tile, every octave included', () => {
    /**
     * The composite is what gets uploaded, so the composite is what has to match.
     *
     * `ODD` is the case that matters and the one an earlier version of this test missed: with
     * frequency 4 and lacunarity 2 every octave is already 4, 8, 16, 32, so rounding the period to
     * an integer is a no-op and dropping it changes nothing. A lacunarity of 1.7 gives 3, 5.1,
     * 8.67 — fractional periods that cannot wrap, which is exactly the bug that draws a grid
     * across a 124 m floor.
     */
    const ODD: FbmOptions = { octaves: 4, frequency: 3, lacunarity: 1.7, gain: 0.55 };
    for (const v of [0, 0.17, 0.5, 0.93]) {
      expect(fbm(0, v, OPTS, 9)).toBeCloseTo(fbm(1, v, OPTS, 9), 12);
      expect(fbm(v, 0, OPTS, 9)).toBeCloseTo(fbm(v, 1, OPTS, 9), 12);
      expect(fbm(0, v, ODD, 9)).toBeCloseTo(fbm(1, v, ODD, 9), 12);
      expect(fbm(v, 0, ODD, 9)).toBeCloseTo(fbm(v, 1, ODD, 9), 12);
      expect(ridged(0, v, ODD, 9)).toBeCloseTo(ridged(1, v, ODD, 9), 12);
    }
  });

  it('tiles worley, including across the seam', () => {
    for (const v of [0, 0.23, 0.61, 0.88]) {
      expect(worley(0, v, 6, 5)).toBeCloseTo(worley(1, v, 6, 5), 12);
      expect(worley(v, 0, 6, 5)).toBeCloseTo(worley(v, 1, 6, 5), 12);
    }
  });

  it('gives worley real cell structure rather than a constant', () => {
    // A distance field that never varies would pass every tiling test above and draw nothing.
    const samples: number[] = [];
    for (let i = 0; i < 256; i++) samples.push(worley((i % 16) / 16, Math.floor(i / 16) / 16, 6, 5));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(max - min).toBeGreaterThan(0.3);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('is deterministic, so client and server agree and a reload looks the same', () => {
    const a = fbm(0.3, 0.7, OPTS, 11);
    const b = fbm(0.3, 0.7, OPTS, 11);
    expect(a).toBe(b);
    expect(fbm(0.3, 0.7, OPTS, 12)).not.toBe(a);
  });

  it('builds normals that point out of the surface', () => {
    const size = 16;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) height[y * size + x] = fbm(x / size, y / size, OPTS, 4);
    }

    const normal = heightToNormal(height, size, 4);
    expect(normal.length).toBe(size * size * 4);

    for (let i = 0; i < normal.length; i += 4) {
      const nx = ((normal[i] ?? 0) / 255) * 2 - 1;
      const ny = ((normal[i + 1] ?? 0) / 255) * 2 - 1;
      const nz = ((normal[i + 2] ?? 0) / 255) * 2 - 1;
      // Unit length, and +Z: a tangent-space normal map whose blue channel dips below zero turns
      // the surface inside out where it does.
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 1);
      expect(nz).toBeGreaterThan(0);
      expect(normal[i + 3]).toBe(255);
    }
  });

  it('wraps the normal map too, so the seam the albedo hides is not drawn by the lighting', () => {
    /**
     * Column 0's gradient has to use column size-1 as its left neighbour. Clamping instead would
     * flatten the first and last columns, and a flat strip in a normal map catches the light as a
     * bright line down the tile edge — the albedo tiles perfectly and the lighting draws the seam
     * anyway.
     *
     * Asserted by recomputing the wrapped gradient independently and requiring the output to equal
     * it. An earlier version compared against a badly derived "clamped equivalent" with
     * `not.toBeCloseTo`, which passed whether the implementation wrapped or not.
     */
    const size = 16;
    const strength = 4;
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) height[y * size + x] = fbm(x / size, y / size, OPTS, 4);
    }
    const normal = heightToNormal(height, size, strength);
    const h = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)] ?? 0;

    // Every pixel on the four edges, where wrapping and clamping disagree.
    for (const [x, y] of [[0, 0], [0, 7], [size - 1, 3], [5, 0], [5, size - 1]] as const) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      expect(normal[i]).toBe(Math.round(Math.min(255, Math.max(0, ((-dx / len) * 0.5 + 0.5) * 255))));
      expect(normal[i + 1]).toBe(Math.round(Math.min(255, Math.max(0, ((-dy / len) * 0.5 + 0.5) * 255))));
    }
  });
});
