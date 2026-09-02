/**
 * A very small PNG reader, resizer and writer.
 *
 * The Microsoft Store wants around fifteen tile and logo images at fixed sizes, several of them
 * non-square, and the repository has exactly one square source icon. That is an image-processing
 * job, and the obvious answer is to add `sharp` — except `sharp` ships prebuilt native binaries
 * per platform, and pulling one in so a packaging script can shrink an icon is a poor trade for
 * a repo whose other tooling (`fetch-assets`, `lib/twa`) has no dependencies at all.
 *
 * So: decode, box-filter, compose, encode. Node already has zlib, which is the only genuinely
 * hard part of PNG. Scope is deliberately narrow — 8-bit RGBA/RGB, non-interlaced, which is what
 * every icon in this project is and what any exporter produces by default. Anything else is
 * rejected loudly rather than mangled quietly.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @typedef {{ width: number, height: number, data: Uint8Array }} Image RGBA, 4 bytes per pixel. */

/** Undo one scanline's filter, in place. `bpp` is bytes per pixel (4 here). */
function unfilter(type, line, previous, bpp) {
  switch (type) {
    case 0:
      break;
    case 1:
      for (let i = bpp; i < line.length; i++) line[i] = (line[i] + line[i - bpp]) & 0xff;
      break;
    case 2:
      for (let i = 0; i < line.length; i++) line[i] = (line[i] + (previous[i] ?? 0)) & 0xff;
      break;
    case 3:
      for (let i = 0; i < line.length; i++) {
        const left = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((left + (previous[i] ?? 0)) >> 1)) & 0xff;
      }
      break;
    case 4:
      for (let i = 0; i < line.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = previous[i] ?? 0;
        const c = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i] + pred) & 0xff;
      }
      break;
    default:
      throw new Error(`unknown PNG filter type ${type}`);
  }
}

/** @returns {Image} */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let pos = 8;
  let header = null;
  const idat = [];
  let palette = null;
  let transparency = null;

  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'tRNS') transparency = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    pos += 12 + length;
  }

  if (!header) throw new Error('PNG has no IHDR');
  if (header.depth !== 8) throw new Error(`PNG bit depth ${header.depth} unsupported (need 8)`);
  if (header.interlace !== 0) throw new Error('interlaced PNG unsupported');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error(`PNG colour type ${header.colorType} unsupported`);
  if (header.colorType === 3 && !palette) throw new Error('indexed PNG without a palette');

  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const data = new Uint8Array(width * height * 4);

  let previous = new Uint8Array(stride);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[offset++];
    const line = Uint8Array.prototype.slice.call(raw, offset, offset + stride);
    offset += stride;
    unfilter(filterType, line, previous, channels);
    previous = line;

    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      switch (header.colorType) {
        case 0:
          data[dst] = data[dst + 1] = data[dst + 2] = line[src];
          data[dst + 3] = 255;
          break;
        case 2:
          data[dst] = line[src];
          data[dst + 1] = line[src + 1];
          data[dst + 2] = line[src + 2];
          data[dst + 3] = 255;
          break;
        case 3: {
          const index = line[src];
          data[dst] = palette[index * 3];
          data[dst + 1] = palette[index * 3 + 1];
          data[dst + 2] = palette[index * 3 + 2];
          data[dst + 3] = transparency?.[index] ?? 255;
          break;
        }
        case 4:
          data[dst] = data[dst + 1] = data[dst + 2] = line[src];
          data[dst + 3] = line[src + 1];
          break;
        default:
          data[dst] = line[src];
          data[dst + 1] = line[src + 1];
          data[dst + 2] = line[src + 2];
          data[dst + 3] = line[src + 3];
      }
    }
  }

  return { width, height, data };
}

/**
 * Resize with a box filter, averaging in premultiplied alpha.
 *
 * Premultiplying is not a nicety. Averaging straight RGBA lets fully transparent pixels — which
 * are usually black — drag the colour of their neighbours down, and the result is a dark fringe
 * around every icon at small sizes. It is the single most visible way a hand-rolled resizer
 * looks worse than a real one.
 *
 * @param {Image} image
 * @returns {Image}
 */
export function resize(image, width, height) {
  const out = new Uint8Array(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * scaleY));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * scaleX));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < Math.min(y1, image.height); sy++) {
        for (let sx = x0; sx < Math.min(x1, image.width); sx++) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.data[i + 3] / 255;
          r += image.data[i] * alpha;
          g += image.data[i + 1] * alpha;
          b += image.data[i + 2] * alpha;
          a += image.data[i + 3];
          n++;
        }
      }
      if (n === 0) n = 1;

      const dst = (y * width + x) * 4;
      const outAlpha = a / n;
      out[dst + 3] = Math.round(outAlpha);
      // Undo the premultiply. A fully transparent block has no colour to recover, so leave it 0.
      const k = outAlpha > 0 ? 255 / outAlpha : 0;
      out[dst] = Math.min(255, Math.round((r / n) * k));
      out[dst + 1] = Math.min(255, Math.round((g / n) * k));
      out[dst + 2] = Math.min(255, Math.round((b / n) * k));
    }
  }
  return { width, height, data: out };
}

/** Parse `#rrggbb` into [r, g, b]. */
export function parseHex(hex) {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) throw new Error(`bad colour "${hex}"`);
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}

/**
 * Place a logo on a canvas of a given size and background.
 *
 * `padding` is the fraction of the *short* side left as margin. Windows tiles are read at a
 * glance from a Start menu full of other tiles, and Microsoft's own guidance is that the icon
 * should not run to the edges — an icon that fills its tile looks cramped next to ones that do
 * not.
 *
 * @param {Image} logo
 * @returns {Image}
 */
export function compose(logo, { width, height, background, padding = 0.16, transparent = false }) {
  const out = new Uint8Array(width * height * 4);
  const [br, bg, bb] = background ? parseHex(background) : [0, 0, 0];
  if (!transparent) {
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = br;
      out[i * 4 + 1] = bg;
      out[i * 4 + 2] = bb;
      out[i * 4 + 3] = 255;
    }
  }

  const short = Math.min(width, height);
  const target = Math.max(1, Math.round(short * (1 - padding * 2)));
  const scaled = resize(logo, target, target);
  const offsetX = Math.round((width - target) / 2);
  const offsetY = Math.round((height - target) / 2);

  for (let y = 0; y < target; y++) {
    const dy = y + offsetY;
    if (dy < 0 || dy >= height) continue;
    for (let x = 0; x < target; x++) {
      const dx = x + offsetX;
      if (dx < 0 || dx >= width) continue;
      const s = (y * target + x) * 4;
      const d = (dy * width + dx) * 4;
      const alpha = scaled.data[s + 3] / 255;
      if (alpha === 0) continue;
      // Source-over onto whatever is already there.
      const inv = 1 - alpha;
      out[d] = Math.round(scaled.data[s] * alpha + out[d] * inv);
      out[d + 1] = Math.round(scaled.data[s + 1] * alpha + out[d + 1] * inv);
      out[d + 2] = Math.round(scaled.data[s + 2] * alpha + out[d + 2] * inv);
      out[d + 3] = Math.min(255, Math.round(scaled.data[s + 3] + out[d + 3] * inv));
    }
  }
  return { width, height, data: out };
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** @param {Image} image */
export function encodePng(image) {
  const { width, height, data } = image;
  const stride = width * 4;
  // Filter type 0 on every line. These are icons of a few hundred pixels; the bytes saved by
  // picking filters per line are not worth the code that picks them.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
