import sharp from "sharp";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Microsoft Store screenshots.
 *
 * Cut from `mobile/captures-desktop/` rather than from the phone captures the
 * other two stores use. That is the whole reason this file is not a copy of
 * `play-store/screenshots.mjs`: the Windows listing is for a desktop app, and
 * an upscaled 1080×1920 phone shot on a desktop store page is both obviously
 * a phone shot and, at 1080 wide, under Microsoft's floor anyway.
 *
 * Partner Center wants at least one screenshot and takes up to ten. It scales
 * for display, so the useful range starts at its 1366×768 minimum; anything
 * smaller on either axis is refused at upload.
 *
 * Run: npm run store:microsoft
 */

const here = dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(here, "..", "captures-desktop");
const OUT = join(here, "assets", "screenshots");

/** Microsoft's floor. Both axes, not the larger one. */
const MIN_WIDTH = 1366;
const MIN_HEIGHT = 768;

await mkdir(OUT, { recursive: true });

let captures;
try {
  captures = (await readdir(CAPTURES)).filter((f) => f.endsWith(".png")).sort();
} catch {
  throw new Error(
    `No desktop captures at ${CAPTURES}.\nRun \`npm run capture\` first — see mobile/README.md.`
  );
}

if (captures.length === 0) throw new Error(`No captures in ${CAPTURES}`);

/**
 * Ten is the cap, and it is a cap rather than a target.
 *
 * Exceeding it is not a warning in Partner Center — the eleventh is simply not
 * accepted — so it is checked here, where the fix is obvious, rather than in a
 * browser at the end of a submission.
 */
if (captures.length > 10) {
  throw new Error(`${captures.length} captures; Partner Center takes at most 10`);
}

for (const name of captures) {
  const image = sharp(join(CAPTURES, name));
  const { width, height } = await image.metadata();

  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    throw new Error(
      `${name} is ${width}×${height} — Microsoft's minimum is ${MIN_WIDTH}×${MIN_HEIGHT}. ` +
        `Re-run \`npm run capture\`; the desktop shape is defined in scripts/capture.mjs.`
    );
  }

  await writeFile(join(OUT, name), await image.png({ compressionLevel: 9 }).toBuffer());
  console.log(`  ${name.padEnd(24)} ${width}×${height}`);
}

console.log(`\n${captures.length} screenshots ready in mobile/microsoft-store/assets/screenshots/`);
console.log("Tile and logo images are a separate command: npm run store:microsoft:assets");
