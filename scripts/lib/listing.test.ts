import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs modules with no type declarations, like png.mjs.
import { encodePng } from './png.mjs';
// @ts-expect-error — see above.
import { LOOK_RAD_PER_PX, frameScore, inFrame, levelPixels, pickTarget, playersInShot, pursuit, shotScore, steerPixels } from './listing.mjs';

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

/** A view as `captureView.ts` reports it. */
function view(...others: { id: string; distance: number; bearing: number; visible?: boolean }[]) {
  return { yaw: 0, others: others.map((o) => ({ role: 'runner', visible: true, ...o })) };
}

describe('pointing the camera at somebody', () => {
  it('films the nearest player in sight, and keeps filming them while they stay in sight', () => {
    const v = view(
      { id: 'behind-a-wall', distance: 4, bearing: 0, visible: false },
      { id: 'near', distance: 6, bearing: 1 },
      { id: 'far', distance: 9, bearing: -1 },
    );
    expect(pickTarget(v)?.id).toBe('near');
    expect(pickTarget(v, 'far')?.id).toBe('far');
    expect(pickTarget(v, 'behind-a-wall')?.id).toBe('near');
    expect(pickTarget(view({ id: 'too-close', distance: 1, bearing: 0 }))).toBeNull();
    expect(pickTarget(null)).toBeNull();
  });

  it('runs at the nearest player, seen or not, when asked for anyone and nobody is in sight', () => {
    const v = view({ id: 'over-the-ridge', distance: 40, bearing: 2, visible: false }, { id: 'further', distance: 80, bearing: 0 });
    expect(pickTarget(v)).toBeNull();
    expect(pickTarget(v, null, { anyone: true })?.id).toBe('over-the-ridge');
    // Somebody in sight always wins over somebody nearer behind a wall.
    expect(pickTarget(view({ id: 'hidden', distance: 3, bearing: 0, visible: false }, { id: 'seen', distance: 12, bearing: 0 }), null, { anyone: true })?.id).toBe('seen');
  });

  it('turns towards them, a little at a time, and settles with them beside the kangaroo', () => {
    // A bearing is positive to the left; dragging left (negative pixels) turns left.
    expect(steerPixels({ bearing: 1 } as never)).toBeLessThan(0);
    expect(steerPixels({ bearing: -1 } as never)).toBeGreaterThan(0);
    expect(Math.abs(steerPixels({ bearing: 3 } as never, { maxTurn: 0.06 }))).toBeCloseTo(0.06 / LOOK_RAD_PER_PX, 6);
    // Replaying the turn the way PCInput applies it walks the player to the offset and stops there.
    let bearing = -2.5;
    for (let i = 0; i < 200; i++) bearing += steerPixels({ bearing } as never) * LOOK_RAD_PER_PX;
    expect(bearing).toBeCloseTo(0.14, 6);
  });

  it('levels a tilted view, a little at a time', () => {
    // Looking up (positive pitch) needs a drag down (positive pixels), and the reverse.
    expect(levelPixels(0.4)).toBeGreaterThan(0);
    expect(levelPixels(-0.4)).toBeLessThan(0);
    expect(levelPixels(0)).toBe(0);
    expect(levelPixels(1.2, { maxTurn: 0.08 })).toBeCloseTo(0.08 / LOOK_RAD_PER_PX, 6);
    // Replayed the way PCInput applies a drag, the pitch settles on level.
    let pitch = 0.9;
    for (let i = 0; i < 100; i++) pitch -= levelPixels(pitch) * LOOK_RAD_PER_PX;
    expect(pitch).toBeCloseTo(0, 6);
  });

  it('ranks a frame by who is in it, then by how near they are, then by contrast', () => {
    const near = view({ id: 'fox', distance: 6, bearing: 0.1 });
    const far = view({ id: 'penguin', distance: 20, bearing: 0.1 });
    const two = view({ id: 'a', distance: 20, bearing: 0.1 }, { id: 'b', distance: 21, bearing: -0.2 });
    // A near player beats a far one even in a flatter frame…
    expect(shotScore(near, 20)).toBeGreaterThan(shotScore(far, 50));
    // …but a second player in the frame beats nearness.
    expect(shotScore(two, 20)).toBeGreaterThan(shotScore(near, 50));
    // With nobody in it, contrast alone decides.
    expect(shotScore(view(), 30)).toBe(30);
    expect(shotScore(null, 30)).toBe(30);
  });

  it('starts filming only with somebody near and in the middle of the view', () => {
    expect(inFrame(view({ id: 'fox', distance: 8, bearing: 0.2 }))).toBe(true);
    // In sight but behind the camera, or off to the side: what a shot used to start on.
    expect(inFrame(view({ id: 'fox', distance: 8, bearing: 2.4 }))).toBe(false);
    expect(inFrame(view({ id: 'fox', distance: 8, bearing: -0.4 }))).toBe(false);
    // In the middle but a speck, or behind rock.
    expect(inFrame(view({ id: 'fox', distance: 19, bearing: 0.1 }))).toBe(false);
    expect(inFrame(view({ id: 'fox', distance: 8, bearing: 0.1, visible: false }))).toBe(false);
    expect(inFrame(null)).toBe(false);
  });

  it('closes in from far and stands and watches from near, without stuttering between', () => {
    const at = (distance: number) => ({ id: 'fox', distance, bearing: 0, visible: true }) as never;
    expect(pursuit(at(20), true)).toEqual({ run: true, sprint: true });
    expect(pursuit(at(9), true)).toEqual({ run: true, sprint: false });
    expect(pursuit(at(4), true)).toEqual({ run: false, sprint: false });
    // Stopped at 4 m, the fox drifts to 7 m: still watching, until it is past 8.
    expect(pursuit(at(7), false).run).toBe(false);
    expect(pursuit(at(8.5), false).run).toBe(true);
    // Nobody to film: keep moving, so the shot pans rather than freezing.
    expect(pursuit(null, false)).toEqual({ run: true, sprint: false });
  });

  it('counts only the players a frame actually shows', () => {
    const v = view(
      { id: 'centre', distance: 8, bearing: 0.2 },
      { id: 'off-screen', distance: 8, bearing: 1.4 },
      { id: 'hidden', distance: 8, bearing: 0, visible: false },
      { id: 'a-speck', distance: 60, bearing: 0 },
    );
    expect(playersInShot(v)).toBe(1);
    expect(playersInShot(null)).toBe(0);
  });
});
