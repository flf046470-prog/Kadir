import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- the packaging scripts are plain ESM JavaScript, deliberately un-typed.
import { compose, decodePng, encodePng, parseHex, resize } from './png.mjs';

/**
 * The hand-rolled PNG codec, tested because it is hand-rolled.
 *
 * This exists so the Microsoft Store tile art can be generated without adding a native image
 * dependency, and the risk that buys is obvious: a codec written from the spec can be subtly
 * wrong in ways that produce a *plausible* image. A wrong Paeth predictor gives smeared colour,
 * a missing premultiply gives dark fringes, an off-by-one in the box filter shifts everything
 * half a pixel. All of those still write a valid PNG and still upload to the Store.
 *
 * So the tests check arithmetic, not "did it write a file".
 */

const root = fileURLToPath(new URL('../..', import.meta.url));
const icon = () => decodePng(readFileSync(path.join(root, 'packages/client/public/icons/icon-1024.png')));

/** Build a flat RGBA image, for tests that need known pixel values. */
function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

function pixel(image: { width: number; data: Uint8Array }, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]] as number[];
}

describe('decoding and encoding', () => {
  it('reads the project icon', () => {
    const image = icon();
    expect(image.width).toBe(1024);
    expect(image.height).toBe(1024);
    expect(image.data.length).toBe(1024 * 1024 * 4);
  });

  /**
   * The strongest single check available: encode what was decoded and decode it again. It
   * exercises every filter type the source uses, the inflate/deflate pair, the CRCs and the
   * chunk framing at once, and it is exact — one wrong byte anywhere shows up here.
   */
  it('round-trips a real image byte for byte', () => {
    const original = icon();
    const again = decodePng(encodePng(original));

    expect(again.width).toBe(original.width);
    expect(again.height).toBe(original.height);
    let differences = 0;
    for (let i = 0; i < original.data.length; i++) {
      if (original.data[i] !== again.data[i]) differences++;
    }
    expect(differences).toBe(0);
  });

  it('refuses input that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('definitely not a png'))).toThrow(/not a PNG/);
  });

  /**
   * Check the checksums against an implementation that is not ours.
   *
   * The round-trip test above cannot catch a broken CRC table, because our own decoder does not
   * verify CRCs — encode and decode would agree with each other while every file we write was
   * quietly corrupt to anyone strict about it, which the Store's packaging tools are. Node ships
   * `zlib.crc32`, so the oracle is free.
   */
  it('writes chunk checksums that an independent implementation agrees with', () => {
    const encoded = encodePng(compose(icon(), { width: 64, height: 64, background: '#1d3a24' }));

    let pos = 8;
    const seen: string[] = [];
    while (pos + 12 <= encoded.length) {
      const length = encoded.readUInt32BE(pos);
      const type = encoded.toString('ascii', pos + 4, pos + 8);
      const body = encoded.subarray(pos + 4, pos + 8 + length); // type + data, as the spec covers
      const stored = encoded.readUInt32BE(pos + 8 + length);
      expect(stored, `${type} checksum`).toBe(crc32(body) >>> 0);
      seen.push(type);
      pos += 12 + length;
    }
    expect(seen).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('writes a file other decoders can recognise', () => {
    const encoded = encodePng(solid(4, 4, [10, 20, 30, 255]));
    expect([...encoded.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(encoded.toString('ascii', 12, 16)).toBe('IHDR');
    // IEND is a 12-byte chunk: a 4-byte length, the 4-byte type, no payload, a 4-byte CRC.
    expect(encoded.subarray(-12).toString('ascii', 4, 8)).toBe('IEND');
  });
});

describe('resizing', () => {
  it('produces exactly the requested size', () => {
    const small = resize(icon(), 44, 44);
    expect(small.width).toBe(44);
    expect(small.height).toBe(44);
    expect(small.data.length).toBe(44 * 44 * 4);
  });

  it('keeps a flat colour flat', () => {
    // A box filter over one colour must return that colour — not something a rounding error off.
    const small = resize(solid(64, 64, [200, 100, 50, 255]), 8, 8);
    for (let i = 0; i < 8 * 8; i++) {
      expect([small.data[i * 4], small.data[i * 4 + 1], small.data[i * 4 + 2], small.data[i * 4 + 3]]).toEqual([
        200, 100, 50, 255,
      ]);
    }
  });

  /**
   * The failure this guards against is the classic one. Transparent pixels in an icon are
   * usually stored as transparent *black*; averaging straight RGBA lets that black bleed into
   * the visible edge, and every downscaled icon picks up a dark halo. Averaging in premultiplied
   * alpha is the fix, and this is the test that says so.
   */
  it('does not let transparent black darken its neighbours', () => {
    // Half opaque white, half fully transparent black.
    const image = solid(2, 1, [255, 255, 255, 255]);
    image.data.set([0, 0, 0, 0], 4);

    const [r, g, b, a] = pixel(resize(image, 1, 1), 0, 0);
    // Alpha halves, but the surviving colour is still white — not grey.
    expect(a).toBe(128);
    expect(r).toBeGreaterThan(250);
    expect(g).toBeGreaterThan(250);
    expect(b).toBeGreaterThan(250);
  });

  it('averages two opaque colours rather than picking one', () => {
    const image = solid(2, 1, [0, 0, 0, 255]);
    image.data.set([200, 200, 200, 255], 4);
    const [r] = pixel(resize(image, 1, 1), 0, 0);
    expect(r).toBe(100);
  });
});

describe('composing a tile', () => {
  it('fills the background and centres the logo', () => {
    const tile = compose(icon(), { width: 620, height: 300, background: '#1d3a24' });
    expect(tile.width).toBe(620);
    expect(tile.height).toBe(300);

    // Corners are background; the middle is not.
    expect(pixel(tile, 0, 0)).toEqual([0x1d, 0x3a, 0x24, 255]);
    expect(pixel(tile, 619, 299)).toEqual([0x1d, 0x3a, 0x24, 255]);
    expect(pixel(tile, 310, 150)).not.toEqual([0x1d, 0x3a, 0x24, 255]);
  });

  it('leaves the margin the padding asks for', () => {
    // With 25 % padding on each side of a 100-wide square tile, the logo occupies the middle
    // half, so a pixel a fifth of the way in must still be background.
    const tile = compose(icon(), { width: 100, height: 100, background: '#ffffff', padding: 0.25 });
    expect(pixel(tile, 20, 50)).toEqual([255, 255, 255, 255]);
  });

  it('keeps the background transparent for unplated icons', () => {
    // Windows draws its own plate behind these; a filled background would show as a square.
    const tile = compose(icon(), { width: 48, height: 48, padding: 0, transparent: true });
    expect(pixel(tile, 0, 0)[3]).toBe(0);
  });

  it('never emits a tile the Store would reject as the wrong size', () => {
    for (const [w, h] of [
      [44, 44],
      [50, 50],
      [150, 150],
      [310, 150],
      [620, 300],
    ] as const) {
      const tile = compose(icon(), { width: w, height: h, background: '#1d3a24' });
      expect([tile.width, tile.height]).toEqual([w, h]);
      expect(tile.data.length).toBe(w * h * 4);
    }
  });
});

describe('colour parsing', () => {
  it('reads hex with and without the hash', () => {
    expect(parseHex('#1d3a24')).toEqual([0x1d, 0x3a, 0x24]);
    expect(parseHex('1d3a24')).toEqual([0x1d, 0x3a, 0x24]);
  });

  it('refuses anything else rather than rendering a black tile', () => {
    expect(() => parseHex('green')).toThrow(/bad colour/);
    expect(() => parseHex('#fff')).toThrow(/bad colour/);
  });
});
