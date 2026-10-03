import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs modules with no type declarations, like png.mjs.
import { encodePng } from './png.mjs';
// @ts-expect-error — see above.
import { frameScore } from './listing.mjs';

/** A 384x216 frame filled by `shade(x, y)`, as PNG bytes the way a screenshot arrives. */
function frame(shade: (x: number, y: number) => number): Uint8Array {
  const width = 384;
  const height = 216;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = shade(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return encodePng({ width, height, data });
}

describe('choosing the store frame', () => {
  it('scores a view above a close-up wall, however much detail the wall has', () => {
    // A wall a metre away: fine, high-contrast texture everywhere. The old proxy (file size)
    // ranked exactly this first; at 96x54 it averages out to one grey.
    const wall = frame((x, y) => (((x * 7) ^ (y * 13)) & 1 ? 40 : 200));
    // A view: bright sky over darker ground, the large-scale contrast a screenshot is made of.
    const view = frame((_, y) => (y < 90 ? 210 : 90));
    expect(wall.length).toBeGreaterThan(view.length);
    expect(frameScore(view)).toBeGreaterThan(frameScore(wall) * 3);
  });

  it('gives a flat frame nothing', () => {
    expect(frameScore(frame(() => 128))).toBeLessThan(0.5);
  });
});
