import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { markSvg } from "./brand-mark.mjs";

/**
 * Renders the web app icons from the same mark the native app uses.
 *
 * Three shapes rather than one file at three sizes, because the platforms
 * genuinely want different pictures:
 *
 *  - **any** — the mark on a transparent ground, for contexts that draw their
 *    own container.
 *  - **maskable** — Android crops this to whatever shape the launcher uses.
 *    Anything outside the inner 80% circle can be cut, so the mark is drawn at
 *    56% and the ground is opaque: a transparent maskable icon gets a black
 *    square behind it on some launchers.
 *  - **apple-touch** — iOS ignores transparency and composites on black, so
 *    this one is flattened onto the brand ground and carries no rounding of
 *    its own (iOS applies the squircle).
 */

const OUT = join(process.cwd(), "public", "icons");

const targets = [
  { file: "icon-192.png", size: 192, scale: 0.78 },
  { file: "icon-512.png", size: 512, scale: 0.78 },
  // 56% keeps the whole mark inside the inner 80% circle every launcher mask
  // is guaranteed to preserve.
  { file: "maskable-192.png", size: 192, scale: 0.56, ground: "square" },
  { file: "maskable-512.png", size: 512, scale: 0.56, ground: "square" },
  { file: "apple-touch-icon.png", size: 180, scale: 0.72, ground: "square" }
];

await mkdir(OUT, { recursive: true });

for (const target of targets) {
  const svg = markSvg({ width: target.size, scale: target.scale, ground: target.ground });
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(OUT, target.file), png);
  console.log(`${target.file}  ${png.length} bytes`);
}
