import { describe, expect, it } from 'vitest';

import { sunPositionFor } from './Renderer.js';

/**
 * The sun's angle, tested away from the renderer because this half has a right answer and the
 * other half needs a GPU (see darkness.test.ts's note on the same split).
 *
 * The sun used to sit at elevation 55.7° (`atan(80 / hypot(48, 26))`), written once in the
 * constructor and once again, by hand, in `updateShadowFocus`. Measured on an isolated boulder
 * held clear of the ice floor it sits on: at 55.7° the cast shadow is a sliver mostly hidden
 * behind the boulder's own silhouette from an ordinary play-height camera — 74,903 shadow-coloured
 * pixels in an 800×450 frame. Lowering it to this file's angle measured 98,450 in the same frame,
 * an unmistakable elongated patch rather than a sliver, on every map at once because every level
 * shares one `Renderer`.
 */
describe('sunPositionFor', () => {
  it('sits well below the old 55.7° — every object should read as grounded, not overhead-lit', () => {
    const pos = sunPositionFor(0, 0);
    const elevationDeg = (Math.atan2(pos.y, Math.hypot(pos.x, pos.z)) * 180) / Math.PI;
    expect(elevationDeg).toBeLessThan(45);
    expect(elevationDeg).toBeGreaterThan(20); // not so low it grazes the horizon or clips a map edge
  });

  it('keeps the same azimuth family, so the change is depth rather than direction', () => {
    const pos = sunPositionFor(0, 0);
    const azimuthDeg = (Math.atan2(pos.z, pos.x) * 180) / Math.PI;
    // The original was ~28.5°; every level's geometry and existing screenshots were built around
    // roughly this compass direction, so only the elevation was meant to move.
    expect(azimuthDeg).toBeGreaterThan(15);
    expect(azimuthDeg).toBeLessThan(40);
  });

  it('offsets by a fixed amount as the focus point moves, the way updateShadowFocus relies on', () => {
    // This is the guarantee that replaced two hand-written positions: whatever point the shadow
    // frustum is re-centred on, the sun keeps the same relative offset from it.
    const origin = sunPositionFor(0, 0);
    const moved = sunPositionFor(30, -12);
    expect(moved.x - origin.x).toBeCloseTo(30, 10);
    expect(moved.z - origin.z).toBeCloseTo(-12, 10);
    expect(moved.y).toBe(origin.y);
  });
});
