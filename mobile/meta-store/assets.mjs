/**
 * The Meta Horizon Store art, at Meta's sizes.
 *
 * The same lockup as everywhere else, in the six shapes the Quest storefront
 * asks for. Composition comes from `lockup` in `scripts/brand-canvas.mjs`;
 * this file is the size table.
 *
 *   npm run store:meta
 *
 * **What this does not produce, and cannot:** the build. The Horizon Store
 * distributes an Android package built for the headset, and FioreMatch has no
 * Quest build — see submission.md. The store art is needed whenever that
 * question is answered, and costs nothing to have ready now.
 *
 * Meta's covers are shown very large and very close to the eye. The lockup is
 * held off-centre on the hero for the same reason it is on Steam: the
 * storefront draws its own title and buttons over the right of it.
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
  { file: "app-icon-512x512.png", width: 512, height: 512, layout: "markOnly" },
  { file: "cover-landscape-2560x1440.png", width: 2560, height: 1440, layout: "stacked", tagline: TAGLINE },
  { file: "cover-portrait-1008x1440.png", width: 1008, height: 1440, layout: "stacked", tagline: TAGLINE },
  { file: "cover-square-1440x1440.png", width: 1440, height: 1440, layout: "stacked", tagline: TAGLINE },
  { file: "hero-2560x1440.png", width: 2560, height: 1440, layout: "hero", dark: true, tagline: TAGLINE },
  { file: "logo-1440x720.png", width: 1440, height: 720, layout: "stacked", transparent: true }
];

await mkdir(OUT, { recursive: true });

for (const target of TARGETS) {
  const png = await lockup({ sharp, markSvg, ...target });
  await writeFile(join(OUT, target.file), png);
  console.log(`  ${target.file.padEnd(34)} ${target.width}×${target.height}  ${Math.round(png.length / 1024)} kB`);
}

console.log(`\n${TARGETS.length} Horizon Store images in mobile/meta-store/assets/`);
console.log("No build is produced: the store distributes a headset APK. See submission.md.");
