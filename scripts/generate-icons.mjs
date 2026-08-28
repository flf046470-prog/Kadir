import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Renders the app icons from the same heart the site uses.
 *
 * Three shapes rather than one file at three sizes, because the platforms
 * genuinely want different pictures:
 *
 *  - **any** — the mark on a transparent ground, for contexts that draw their
 *    own container.
 *  - **maskable** — Android crops this to whatever shape the launcher uses
 *    (circle, squircle, teardrop). Anything outside the inner 80% circle can
 *    be cut, so the mark is drawn at 56% and the ground is opaque: a
 *    transparent maskable icon gets a black square behind it on some
 *    launchers.
 *  - **apple-touch** — iOS ignores transparency and composites on black, so
 *    this one is flattened onto the brand ground itself and carries no
 *    rounding of its own (iOS applies the squircle).
 */

const OUT = join(process.cwd(), "public", "icons");

const HEART = `
  <path
    d="M14 24.5s-9.5-5.86-9.5-13.02C4.5 7.4 7.55 4.5 11.1 4.5c1.99 0 3.7 1 4.9 2.62A6.02 6.02 0 0 1 20.9 4.5c3.55 0 6.6 2.9 6.6 6.98C27.5 18.64 18 24.5 14 24.5Z"
    fill="url(#g)"
  />`;

const GRADIENT = `
  <linearGradient id="g" x1="4.5" y1="4.5" x2="27.5" y2="24.5" gradientUnits="userSpaceOnUse">
    <stop stop-color="#fb6f92" />
    <stop offset="1" stop-color="#8360f5" />
  </linearGradient>`;

/** `scale` is the fraction of the canvas the mark occupies. */
function icon({ size, scale, background }) {
  const mark = size * scale;
  const offset = (size - mark) / 2;
  const ground = background
    ? `<rect width="${size}" height="${size}" fill="${background}" />`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>${GRADIENT}</defs>
  ${ground}
  <g transform="translate(${offset} ${offset}) scale(${mark / 28})">${HEART}</g>
</svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, scale: 0.78 },
  { file: "icon-512.png", size: 512, scale: 0.78 },
  // 56% keeps the whole mark inside the inner 80% circle every launcher mask
  // is guaranteed to preserve.
  { file: "maskable-192.png", size: 192, scale: 0.56, background: "#fff5f7" },
  { file: "maskable-512.png", size: 512, scale: 0.56, background: "#fff5f7" },
  { file: "apple-touch-icon.png", size: 180, scale: 0.72, background: "#fff5f7" }
];

await mkdir(OUT, { recursive: true });

for (const target of targets) {
  const svg = icon(target);
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(OUT, target.file), png);
  console.log(`${target.file}  ${png.length} bytes`);
}
