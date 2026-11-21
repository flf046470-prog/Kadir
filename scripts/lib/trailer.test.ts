import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
// @ts-expect-error — a plain .mjs module with no type declarations, like png.mjs.
import { blockiness, brightest, letterbox, plateFilter, readCaptions, readPlates, timeControlSource, timeline } from './trailer.mjs';

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

  it('takes a crossfade per join: quick between real shots, longer where they turn into the game', () => {
    const { starts, offsets, total } = timeline([3, 2.5, 3.5, 7], [0.3, 0.3, 1.6]);
    expect(starts[1]).toBeCloseTo(2.7, 9);
    expect(starts[2]).toBeCloseTo(4.9, 9);
    // The game shot starts where the long join starts: 1.6 s before the last real shot ends.
    expect(offsets[2]).toBeCloseTo(4.9 + 3.5 - 1.6, 9);
    expect(total).toBeCloseTo(3 + 2.5 + 3.5 + 7 - 0.3 - 0.3 - 1.6, 9);
  });

  it('refuses a segment that both of its joins would overlap, and a join count that does not fit', () => {
    // 1.2 s is longer than either join (0.5, 0.8) but not than both: the two transitions would cross.
    expect(() => timeline([3, 1.2, 3], [0.5, 0.8])).toThrow();
    expect(() => timeline([3, 1.4, 3], [0.5, 0.8])).not.toThrow();
    expect(() => timeline([3, 3], [0.5, 0.5])).toThrow();
  });
});

describe('the real footage', () => {
  const manifest = JSON.parse(readFileSync(root + 'assets/trailer/plates.json', 'utf8'));
  type Plate = Record<string, unknown> & { id: string; transfer: string; frames: number; startFrame: number; push?: Record<string, number> };
  const plates = readPlates(manifest) as Plate[];
  const plain = { ...plates.find((p) => !p.push), transfer: 'bt709' } as Plate;
  const pushed = plates.find((p) => p.push) as Plate;

  it('says where every plate came from, under which licence, and which bytes', () => {
    expect(plates.length).toBeGreaterThanOrEqual(3);
    expect(manifest.licence.name).toBe('Pexels License');
    for (const plate of plates) {
      expect(plate.page).toMatch(/^https:\/\/www\.pexels\.com\/video\//);
      expect(plate.url).toMatch(/^https:\/\/videos\.pexels\.com\//);
    }
  });

  it('refuses a plate with no creator, no checksum, or no date its licence was read', () => {
    const without = (key: string) => ({ ...manifest, plates: [{ ...manifest.plates[0], [key]: undefined }] });
    expect(() => readPlates(without('creator'))).toThrow(/creator/);
    expect(() => readPlates({ ...manifest, plates: [{ ...manifest.plates[0], sha256: 'abc' }] })).toThrow(/sha256/);
    expect(() => readPlates({ ...manifest, licence: { ...manifest.licence, read: undefined } })).toThrow(/licence/);
  });

  it('takes exactly its frames, one source frame to each trailer frame', () => {
    // From a start that is not the first frame: from 0, the end frame and the frame count agree,
    // and a filter that ends at `frames` instead of `start + frames` would look right.
    const filter = plateFilter({ ...plain, startFrame: 13, frames: 80 }) as string;
    expect(filter.startsWith('trim=start_frame=13:end_frame=93,setpts=N/30/TB,')).toBe(true);
    expect(filter).toContain('scale=1920:1080');
  });

  it('tone-maps HLG to BT.709, and nothing else', () => {
    expect(plateFilter({ ...plain, transfer: 'arib-std-b67' })).toMatch(/zscale=t=linear.*tonemap=.*zscale=t=bt709:m=bt709/);
    expect(plateFilter(plain)).not.toContain('tonemap');
    // An HDR transfer it was never taught is refused, not decoded as if it were SDR.
    expect(() => plateFilter({ ...plain, transfer: 'smpte2084' })).toThrow(/smpte2084/);
  });

  it('pushes in from one zoom to the other over exactly the plate', () => {
    const zoom = (plateFilter(pushed) as string).match(/zoompan=z='([^']+)'/)?.[1] ?? '';
    // The expression in terms of `on`, zoompan's output frame number, evaluated at both ends.
    const at = (on: number): number => Function('on', `return ${zoom};`)(on) as number;
    expect(at(0)).toBeCloseTo(pushed.push!.from!, 6);
    expect(at(pushed.frames - 1)).toBeCloseTo(pushed.push!.to!, 3);
  });
});

describe('measuring the finished cut', () => {
  const width = 108;
  const height = 60;
  /** A grey frame of noise, or of 54-pixel blocks — what the pixelize transition draws at its middle. */
  const frame = (block: number): Uint8Array => {
    const out = new Uint8Array(width * height);
    let seed = 7;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 255;
    const colour = new Map<string, number>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${Math.floor(x / block)},${Math.floor(y / block)}`;
        if (block === 1 || !colour.has(key)) colour.set(key, rand());
        out[y * width + x] = colour.get(key)!;
      }
    }
    return out;
  };

  it('tells a picture broken into blocks from one with detail in it', () => {
    expect(blockiness(frame(54), width, 0, height)).toBeGreaterThan(0.95);
    expect(blockiness(frame(1), width, 0, height)).toBeLessThan(0.1);
  });

  it('tells a black bar from a picture', () => {
    const picture = frame(1);
    picture.fill(0, 0, width * 6);
    expect(brightest(picture, width, 0, 6)).toBe(0);
    expect(brightest(picture, width, 6, 12)).toBeGreaterThan(30);
  });

  it('slides the bars off between the times it is given, and lays them over the whole video', () => {
    const graph = letterbox('in', 'out', { bar: 60, from: 7.5, to: 8.7, total: 45 }) as string;
    expect(graph).toContain('color=c=black:s=1920x60:r=30:d=45.000');
    expect(graph.match(/overlay=/g)).toHaveLength(2);
    expect(graph).toContain('clip((t-7.500)/1.200,0,1)');
    expect(graph.startsWith('color=') && graph.includes('[in]') && graph.endsWith('[out]')).toBe(true);
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
