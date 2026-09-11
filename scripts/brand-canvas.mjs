import { GRADIENT, GROUND } from "./brand-mark.mjs";

/**
 * The branded canvas: the marketing hero's light, at any size.
 *
 * Every store wants the same picture at a different aspect ratio — Play's
 * 1024×500 banner, Steam's 374×448 vertical capsule, Meta's 2560×1440 cover —
 * and each of those was going to grow its own copy of the aurora and its own
 * wordmark. That is four copies of one background, which is exactly the drift
 * the mark itself was just rescued from: the day the palette moves, three of
 * the four follow and nobody sees the fourth until it is in a listing.
 *
 * So the two genuinely shared pieces live here and the *composition* stays
 * bespoke per store, because those differ for real reasons: Play crops the
 * centre and overlays its own title, a Steam capsule is 87px tall and can hold
 * a mark and nothing else, and Meta's cover is a 16:9 hero with the logo off to
 * one side.
 */

/**
 * The hero's three lights, sized to the canvas.
 *
 * Reproduced rather than imported because the site expresses it as Tailwind
 * `backgroundImage` CSS, which sharp cannot render. The stops are the same
 * ones, and `GROUND` and the two gradient ends come from the mark's own module
 * so a palette change reaches this without a second edit.
 *
 * @param {{width: number, height: number, dark?: boolean}} options
 */
export function aurora({ width, height, dark = false }) {
  const base = dark ? "#171123" : GROUND;
  const lift = dark ? 0.5 : 0.38;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="a" cx="0.15" cy="0.2" r="0.55">
      <stop offset="0%" stop-color="${GRADIENT.from}" stop-opacity="${lift}" />
      <stop offset="100%" stop-color="${GRADIENT.from}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="b" cx="0.88" cy="0.05" r="0.6">
      <stop offset="0%" stop-color="${GRADIENT.to}" stop-opacity="${lift - 0.02}" />
      <stop offset="100%" stop-color="${GRADIENT.to}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="c" cx="0.55" cy="1" r="0.7">
      <stop offset="0%" stop-color="#e6e0ff" stop-opacity="${dark ? 0.24 : 0.62}" />
      <stop offset="100%" stop-color="#e6e0ff" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${base}" />
  <rect width="${width}" height="${height}" fill="url(#a)" />
  <rect width="${width}" height="${height}" fill="url(#b)" />
  <rect width="${width}" height="${height}" fill="url(#c)" />
</svg>`;
}

/**
 * The wordmark, and optionally the line under it.
 *
 * Fraunces is not installed on most machines that would run this and a
 * silently substituted face is worse than an honest system serif, so the stack
 * names real fallbacks and every caller picks a size that works with any of
 * them.
 *
 * @param {object} options
 * @param {number} options.width   Canvas width; the text is centred in it.
 * @param {number} options.height  Canvas height.
 * @param {number} options.y       Baseline of the wordmark.
 * @param {number} options.size    Wordmark font size.
 * @param {string} [options.tagline]
 * @param {boolean} [options.dark] Light type for a dark ground.
 */
export function wordmark({ width, height, y, size, tagline, dark = false }) {
  const ink = dark ? "#f4f2ff" : "#171123";
  const muted = dark ? "#c9bdff" : "#5f5568";
  const line = tagline
    ? `<text x="${width / 2}" y="${y + size * 0.64}" text-anchor="middle"
        font-family="Inter, system-ui, 'Helvetica Neue', Arial, sans-serif"
        font-size="${Math.round(size * 0.35)}" font-weight="500" fill="${muted}">${tagline}</text>`
    : "";

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${width / 2}" y="${y}" text-anchor="middle"
        font-family="Fraunces, Georgia, 'Times New Roman', serif"
        font-size="${size}" font-weight="600" fill="${ink}"
        letter-spacing="${-size * 0.019}">FioreMatch</text>
  ${line}
</svg>`;
}

/**
 * The wordmark rendered to fit a box exactly, whatever face the machine has.
 *
 * SVG `textLength` is the obvious answer and it does not work here: sharp
 * renders through resvg, which ignores the attribute, so a 231px Steam capsule
 * came out reading "FioreMa" and stopping at the edge. Choosing a font size
 * instead is a guess about metrics — one that fits Fraunces overflows the
 * Georgia most machines substitute, and the failure is silent and only visible
 * in the uploaded image.
 *
 * So nothing here depends on knowing how wide the text will be: it is drawn
 * large on a transparent canvas, trimmed to its own ink, and then scaled into
 * the box. The fit becomes a measured fact rather than a prediction.
 *
 * @param {object} options
 * @param {import("sharp").default} options.sharp
 * @param {number} options.width   Box to fit inside.
 * @param {number} options.height
 * @param {string} options.fill
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
export async function fittedWordmark({ sharp, width, height, fill }) {
  const DRAWN = 400;
  const drawn = `<svg width="4000" height="${DRAWN * 2}" xmlns="http://www.w3.org/2000/svg">
    <text x="20" y="${DRAWN}" font-family="Fraunces, Georgia, 'Times New Roman', serif"
          font-size="${DRAWN}" font-weight="600" fill="${fill}" letter-spacing="-7">FioreMatch</text>
  </svg>`;

  const trimmed = await sharp(Buffer.from(drawn)).trim().png().toBuffer();
  const resized = await sharp(trimmed)
    .resize({ width, height, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();

  const meta = await sharp(resized).metadata();
  return { buffer: resized, width: meta.width ?? width, height: meta.height ?? height };
}

/**
 * A branded lockup composed onto a canvas of any shape.
 *
 * Steam wants eleven sizes and Meta wants six, and they are the same picture:
 * the bloom, the wordmark, sometimes the line under it, on the hero's light.
 * Written per store this is one layout engine copied twice, which is how the
 * two listings end up subtly different after the first edit that only reaches
 * one of them.
 *
 * What genuinely differs is the *shape*, so that is the parameter. The layouts:
 *
 *   row      mark left, wordmark beside it — for wide, short capsules
 *   stacked  mark above a centred wordmark — the default poster shape
 *   hero     lockup held left of centre, because both stores overlay their own
 *            chrome on the right of a hero image
 *   markOnly no type at all; below roughly 200px a wordmark is unreadable and
 *            printing it anyway only makes the tile look muddy
 *   none     the ground alone, for page backgrounds
 *
 * @param {object} options
 * @param {import("sharp").default} options.sharp
 * @param {(o: object) => string} options.markSvg
 * @param {number} options.width
 * @param {number} options.height
 * @param {"row"|"stacked"|"hero"|"markOnly"|"none"} options.layout
 * @param {boolean} [options.dark]
 * @param {boolean} [options.transparent]
 * @param {string} [options.tagline]
 * @returns {Promise<Buffer>} PNG
 */
export async function lockup({
  sharp,
  markSvg,
  width,
  height,
  layout,
  dark = false,
  transparent = false,
  tagline
}) {
  const short = Math.min(width, height);
  const MARK_SCALE = { row: 0.72, stacked: 0.3, hero: 0.46, markOnly: 0.78, none: 0 };

  const canvas = transparent
    ? sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    : sharp(Buffer.from(aurora({ width, height, dark })));

  const ink = dark || transparent ? "#f4f2ff" : "#171123";
  const layers = [];

  if (layout === "markOnly") {
    layers.push({
      input: await sharp(Buffer.from(markSvg({ width, height, scale: MARK_SCALE.markOnly })))
        .png()
        .toBuffer(),
      top: 0,
      left: 0
    });
  } else if (layout === "row") {
    const size = Math.round(short * MARK_SCALE.row);
    const pad = Math.round((height - size) / 2);
    layers.push({
      input: await sharp(Buffer.from(markSvg({ width: size, scale: 1 }))).png().toBuffer(),
      top: pad,
      left: pad
    });

    const textLeft = pad * 2 + size;
    const fitted = await fittedWordmark({
      sharp,
      width: width - textLeft - pad,
      height: Math.round(height * 0.42),
      fill: ink
    });
    layers.push({
      input: fitted.buffer,
      top: Math.round((height - fitted.height) / 2),
      left: textLeft
    });
  } else if (layout === "hero") {
    const size = Math.round(height * MARK_SCALE.hero);
    layers.push({
      input: await sharp(Buffer.from(markSvg({ width: size, scale: 1 }))).png().toBuffer(),
      top: Math.round(height * 0.12),
      left: Math.round(width * 0.14)
    });

    const fitted = await fittedWordmark({
      sharp,
      width: Math.round(width * 0.44),
      height: Math.round(height * 0.19),
      fill: ink
    });
    layers.push({
      input: fitted.buffer,
      top: Math.round(height * 0.62),
      left: Math.round(width * 0.14)
    });

    if (tagline) {
      layers.push({
        input: Buffer.from(
          `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <text x="${Math.round(width * 0.14) + 6}" y="${Math.round(height * 0.88)}"
                  font-family="Inter, system-ui, sans-serif" font-size="${Math.round(height * 0.055)}"
                  font-weight="500" fill="#c9bdff">${tagline}</text>
          </svg>`
        ),
        top: 0,
        left: 0
      });
    }
  } else if (layout === "stacked") {
    const size = Math.round(short * MARK_SCALE.stacked);
    const markTop = Math.round(height * (tagline ? 0.24 : 0.2));
    layers.push({
      input: await sharp(Buffer.from(markSvg({ width: size, scale: 1 }))).png().toBuffer(),
      top: markTop,
      left: Math.round((width - size) / 2)
    });

    /**
     * Both the mark and the wordmark are sized from the *short* side.
     *
     * Tying the type to the canvas width instead made the lockup fall apart as
     * the aspect ratio changed: on a 2560×1440 cover the wordmark grew to
     * nearly two thousand pixels while the mark stayed pinned to the height,
     * so a bloom the size of a thumbnail sat on top of enormous type. Anchoring
     * both to the same dimension is what keeps one lockup recognisable across
     * a 231px capsule and a 2560px cover.
     */
    const fitted = await fittedWordmark({
      sharp,
      width: Math.min(Math.round(width * 0.74), Math.round(short * 1.15)),
      height: Math.round(short * 0.16),
      fill: ink
    });
    layers.push({
      input: fitted.buffer,
      top: markTop + size + Math.round(height * 0.05),
      left: Math.round((width - fitted.width) / 2)
    });

    if (tagline) {
      layers.push({
        input: Buffer.from(
          `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <text x="${width / 2}" y="${markTop + size + Math.round(height * 0.05) + fitted.height + Math.round(short * 0.08)}"
                  text-anchor="middle" font-family="Inter, system-ui, sans-serif"
                  font-size="${Math.round(short * 0.045)}" font-weight="500"
                  fill="${dark || transparent ? "#c9bdff" : "#5f5568"}">${tagline}</text>
          </svg>`
        ),
        top: 0,
        left: 0
      });
    }
  }

  return canvas.composite(layers).png({ compressionLevel: 9 }).toBuffer();
}
