/**
 * The Steam store art, at Valve's sizes.
 *
 * Steam asks for the same picture eleven times because it shows the product in
 * eleven places — a 231×87 row in a list, a 3840×1240 hero across the top of a
 * library page — and it does not scale one image to fill them. The composition
 * has to change with the shape, which is what `lockup` in
 * `scripts/brand-canvas.mjs` is for; this file is the size table and nothing
 * else.
 *
 * Everything is drawn from `scripts/brand-mark.mjs`, so the capsules cannot
 * drift from the app icon or from the marketing site.
 *
 *   npm run store:steam
 *
 * **What this does not produce, and cannot:** the build. Steam distributes an
 * executable and FioreMatch has no desktop or VR build — see submission.md.
 * These are the store-page images, which are needed whenever that question is
 * answered and cost nothing to have ready in the meantime.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { markSvg } from "../../scripts/brand-mark.mjs";
import { lockup } from "../../scripts/brand-canvas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "assets");
const TAGLINE = "Sınırların ötesinde tanış";

const TARGETS = [
  { file: "header-capsule-460x215.png", width: 460, height: 215, layout: "stacked" },
  { file: "small-capsule-231x87.png", width: 231, height: 87, layout: "row" },
  { file: "main-capsule-616x353.png", width: 616, height: 353, layout: "stacked", tagline: TAGLINE },
  { file: "vertical-capsule-374x448.png", width: 374, height: 448, layout: "stacked", tagline: TAGLINE },
  { file: "library-capsule-600x900.png", width: 600, height: 900, layout: "stacked", tagline: TAGLINE },
  { file: "library-header-460x215.png", width: 460, height: 215, layout: "stacked" },
  { file: "library-hero-3840x1240.png", width: 3840, height: 1240, layout: "hero", dark: true, tagline: TAGLINE },
  { file: "library-logo-1280x720.png", width: 1280, height: 720, layout: "stacked", transparent: true },
  { file: "page-background-1438x810.png", width: 1438, height: 810, layout: "none", dark: true },
  { file: "community-icon-184x184.png", width: 184, height: 184, layout: "markOnly" },
  { file: "client-icon-32x32.png", width: 32, height: 32, layout: "markOnly" }
];

await mkdir(OUT, { recursive: true });

for (const target of TARGETS) {
  const png = await lockup({ sharp, markSvg, ...target });
  await writeFile(join(OUT, target.file), png);
  console.log(`  ${target.file.padEnd(34)} ${target.width}×${target.height}  ${Math.round(png.length / 1024)} kB`);
}

console.log(`\n${TARGETS.length} Steam images in mobile/steam/assets/`);
console.log("The client icon needs converting to .ico before upload — Valve takes no PNG there.");
console.log("No build is produced: Steam distributes an executable. See submission.md.");
