/**
 * The Play Store feature graphic, 1024×500.
 *
 * Play crops this differently in every surface it appears in and overlays the
 * app icon and title on some of them, so the safe move is a composition that
 * survives losing its edges: the mark and the wordmark sit inside the middle
 * half, and nothing load-bearing goes near a corner.
 *
 * Drawn from `scripts/brand-mark.mjs` like every other icon, so the graphic
 * cannot drift from the launcher icon it sits next to in the listing.
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { markSvg } from "../../scripts/brand-mark.mjs";

const WIDTH = 1024;
const HEIGHT = 500;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The aurora from the marketing site's hero, at this canvas size.
 *
 * Reproduced rather than imported because the site expresses it as Tailwind
 * `backgroundImage` CSS, which sharp cannot render. The stops are the same.
 */
const background = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="a" cx="0.15" cy="0.2" r="0.55">
      <stop offset="0%" stop-color="#fb6f92" stop-opacity="0.38" />
      <stop offset="100%" stop-color="#fb6f92" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="b" cx="0.88" cy="0.05" r="0.6">
      <stop offset="0%" stop-color="#8360f5" stop-opacity="0.36" />
      <stop offset="100%" stop-color="#8360f5" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="c" cx="0.55" cy="1" r="0.7">
      <stop offset="0%" stop-color="#e6e0ff" stop-opacity="0.62" />
      <stop offset="100%" stop-color="#e6e0ff" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fff5f7" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#a)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#b)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#c)" />
</svg>`;

/**
 * Wordmark and line, as paths-free text.
 *
 * Fraunces is not installed on most machines that would run this, and a
 * silently substituted face is worse than an honest system serif — so the
 * stack names real fallbacks and the size is chosen to work with any of them.
 */
const words = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <text x="${WIDTH / 2}" y="318" text-anchor="middle"
        font-family="Fraunces, Georgia, 'Times New Roman', serif"
        font-size="78" font-weight="600" fill="#171123" letter-spacing="-1.5">FioreMatch</text>
  <text x="${WIDTH / 2}" y="368" text-anchor="middle"
        font-family="Inter, system-ui, 'Helvetica Neue', Arial, sans-serif"
        font-size="27" font-weight="500" fill="#5f5568">Sınırların ötesinde tanış</text>
</svg>`;

const mark = Buffer.from(markSvg({ width: 200, height: 200, scale: 1, ground: "none" }));

const graphic = await sharp(Buffer.from(background))
  .composite([
    { input: await sharp(mark).png().toBuffer(), top: 78, left: (WIDTH - 200) / 2 },
    { input: Buffer.from(words), top: 0, left: 0 }
  ])
  .png()
  .toBuffer();

const out = join(here, "assets", "feature-graphic-1024x500.png");
await writeFile(out, graphic);

const meta = await sharp(graphic).metadata();
console.log(`${out} — ${meta.width}×${meta.height}, ${(graphic.length / 1024).toFixed(0)} kB`);
