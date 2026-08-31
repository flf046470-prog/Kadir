import sharp from "sharp";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Play's phone screenshots.
 *
 * Play takes a raw capture as it is — 1080×1920 sits inside its 320–3840px
 * bounds at a 16:9 ratio it accepts — so this copies rather than composes.
 * It exists anyway so that `mobile/play-store/assets/` is the folder you drag
 * into Play Console and nothing else, and so that regenerating it is one
 * command rather than a remembered `cp`.
 *
 * The App Store cannot do this, and `mobile/app-store/screenshots.mjs` is the
 * other half of the story.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(here, "..", "captures");
const OUT = join(here, "assets");

await mkdir(OUT, { recursive: true });

const captures = (await readdir(CAPTURES)).filter((f) => f.endsWith(".png")).sort();
if (captures.length === 0) throw new Error(`No captures in ${CAPTURES}`);

for (const name of captures) {
  const image = sharp(join(CAPTURES, name));
  const { width, height } = await image.metadata();

  // Play rejects a side below 320 or above 3840, and anything past a 2:1
  // ratio. Checked here rather than discovered in the console.
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (Math.min(width, height) < 320 || Math.max(width, height) > 3840 || ratio > 2) {
    throw new Error(`${name} is ${width}×${height} (ratio ${ratio.toFixed(2)}) — Play will refuse it`);
  }

  await writeFile(join(OUT, name), await image.png({ compressionLevel: 9 }).toBuffer());
  console.log(`  ${name.padEnd(24)} ${width}×${height}`);
}

console.log(`\n${captures.length} phone screenshots ready in mobile/play-store/assets/`);
