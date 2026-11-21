import { describe, expect, it } from 'vitest';
import { BACKDROP_EVERY, drawsFrame } from './backdrop.js';

describe('the world behind a menu', () => {
  it('is drawn every frame when nothing covers it', () => {
    for (let frame = 0; frame < 12; frame++) expect(drawsFrame(frame, false, false)).toBe(true);
  });

  it('is drawn one frame in BACKDROP_EVERY under a menu, starting with the first', () => {
    const drawn = Array.from({ length: BACKDROP_EVERY * 3 }, (_, frame) => drawsFrame(frame, true, false));
    expect(drawn[0]).toBe(true);
    expect(drawn.filter(Boolean)).toHaveLength(3);
  });

  it('is drawn every frame in a headset, menu or not', () => {
    for (let frame = 0; frame < 12; frame++) expect(drawsFrame(frame, true, true)).toBe(true);
  });
});
