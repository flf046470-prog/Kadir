import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
// @ts-expect-error — a plain .mjs module with no type declarations, like png.mjs.
import { readCaptions, timeControlSource, timeline } from './trailer.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('the trailer timeline', () => {
  it('starts each cut one crossfade before the last one ends', () => {
    const { starts, offsets, total } = timeline([3.5, 6.5, 6.5, 4.5], 0.5);
    expect(starts).toEqual([0, 3, 9, 15]);
    // xfade measures each offset on the output timeline: where the incoming segment begins.
    expect(offsets).toEqual([3, 9, 15]);
    expect(total).toBe(19.5);
  });

  it('refuses a segment no longer than its crossfade', () => {
    expect(() => timeline([3, 0.5, 3], 0.5)).toThrow();
  });
});

describe('the trailer captions', () => {
  it('are read from the PC listing doc: one per shot and one for the end card', () => {
    const captions = readCaptions(readFileSync(root + 'docs/PC_LISTINGS.md', 'utf8')) as string[];
    // `pack-trailer.mjs` films five shots; `copy.test.ts` checks the numbers these lines claim.
    expect(captions).toHaveLength(6);
    for (const caption of captions) expect(caption.length).toBeLessThan(60);
  });
});

describe('the held clock', () => {
  function page() {
    const real: (() => void)[] = [];
    let realTime = 1000;
    const window = {
      requestAnimationFrame: (cb: () => void) => real.push(cb),
      cancelAnimationFrame: () => {},
    } as Record<string, unknown>;
    const performance = { now: () => realTime };
    vm.runInNewContext(timeControlSource(), { window, performance });
    const time = window.__kcTime as { hold(): void; step(ms: number): void };
    return { window, performance, time, real, advanceReal: (ms: number) => (realTime += ms) };
  }

  it('leaves time alone until it is held', () => {
    const p = page();
    p.advanceReal(500);
    expect(p.performance.now()).toBe(1500);
    (p.window.requestAnimationFrame as (cb: () => void) => void)(() => {});
    expect(p.real).toHaveLength(1);
  });

  it('runs exactly one frame per step, at the time it was stepped to', () => {
    const p = page();
    p.time.hold();
    const seen: number[] = [];
    const raf = p.window.requestAnimationFrame as (cb: (t: number) => void) => void;
    const loop = (t: number): void => {
      seen.push(t);
      // A game loop asks for the next frame from inside this one: that must wait for the next step.
      raf(loop);
    };
    raf(loop);
    p.advanceReal(10_000); // however long a frame takes to draw…
    p.time.step(1000 / 30);
    p.time.step(1000 / 30);
    expect(seen).toHaveLength(2);
    // …the game sees exactly 1/30 s pass per frame.
    expect(seen[1]! - seen[0]!).toBeCloseTo(1000 / 30, 9);
    expect(p.performance.now()).toBeCloseTo(1000 + 2000 / 30, 9);
  });
});
