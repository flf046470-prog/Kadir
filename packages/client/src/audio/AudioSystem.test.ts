import { describe, expect, it } from 'vitest';

import { materialPitch } from './AudioSystem.js';
import type { SurfaceMaterial } from '@kc/core';

const ALL_MATERIALS: SurfaceMaterial[] = [
  'dirt', 'rock', 'wood', 'foliage', 'water', 'metal', 'sand', 'stone', 'ice', 'snow', 'redEarth', 'redRock',
];

/**
 * The pitch offset that makes a landing sound like the ground it landed on.
 *
 * `redEarth` and `redRock` are Outback's own materials rather than reused `sand`/`rock` — see the
 * `SurfaceMaterial` doc comment — specifically so the map has its own identity. `materialPitch`
 * had no cases for either, so both fell through to the neutral default and every landing anywhere
 * on `outback-station` sounded exactly like landing on jungle dirt: the one thing the renderer's
 * own material split was built to avoid, reintroduced one layer up in the same game.
 */
describe('materialPitch', () => {
  it('gives every surface material a finite offset', () => {
    for (const material of ALL_MATERIALS) {
      expect(Number.isFinite(materialPitch(material)), material).toBe(true);
    }
  });

  it('gives Outback its own sound rather than borrowing dirt, sand or rock', () => {
    expect(materialPitch('redEarth')).not.toBe(materialPitch('dirt'));
    expect(materialPitch('redEarth')).not.toBe(materialPitch('sand'));
    expect(materialPitch('redRock')).not.toBe(materialPitch('dirt'));
    expect(materialPitch('redRock')).not.toBe(materialPitch('rock'));
  });

  it('keeps the two Outback materials in the same relative family as their nearest cousin', () => {
    // redRock is still a hard surface (positive, like rock and stone) and redEarth is still a soft
    // one (negative, like sand and foliage) — the new values distinguish the map without inventing
    // a material that reads as a different kind of thing entirely.
    expect(materialPitch('redRock')).toBeGreaterThan(0);
    expect(materialPitch('redEarth')).toBeLessThan(0);
  });

  it('falls back to the neutral default for an unrecognised material', () => {
    expect(materialPitch(undefined)).toBe(0);
  });
});
