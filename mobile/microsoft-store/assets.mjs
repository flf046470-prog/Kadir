import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUND, markSvg } from "../../scripts/brand-mark.mjs";

/**
 * The Windows visual assets an MSIX carries.
 *
 * Windows does not take one icon and derive the rest the way Xcode does. The
 * package declares seven distinct images, each at five scale factors, and the
 * shell picks by filename — `Square150x150Logo.scale-200.png` is not a
 * convention, it is the lookup. A missing file is not an error at build time;
 * it is a blank tile on somebody's Start menu.
 *
 * PWABuilder will generate this set on its own from the 512 icon. This exists
 * anyway for the same reason the Play and App Store folders do: so what gets
 * uploaded is a folder someone can look at, and so the crop is ours rather
 * than whatever a hosted tool decided that week.
 *
 * Run: npm run store:microsoft
 */

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "assets", "msix");

await mkdir(OUT, { recursive: true });

/**
 * The five scale factors, and what each multiplies by.
 *
 * Windows rounds a fractional scale up, so 71 at 125% is 89 and not 88.75.
 * These are the published values rather than a computed `Math.ceil`, because
 * the shell matches the filename exactly and a rounding disagreement produces
 * a file nothing ever loads.
 */
const SCALES = [100, 125, 150, 200, 400];

const scaled = (base) => ({
  100: base,
  125: Math.ceil(base * 1.25),
  150: Math.ceil(base * 1.5),
  200: base * 2,
  400: base * 4
});

/**
 * Every image the manifest names, with the fraction of the tile the mark fills.
 *
 * The small assets carry a larger fraction on purpose. A 44px app-list icon
 * drawn at the 150px tile's proportions is a heart a few pixels across with a
 * wide margin of nothing, which reads as a missing icon rather than a small
 * one. The large tiles go the other way: at 310px the same fraction is a heart
 * the size of a thumbnail, and the tile looks like a poster.
 */
const IMAGES = [
  { name: "StoreLogo", w: 50, h: 50, scale: 0.66, ground: "square" },
  { name: "Square44x44Logo", w: 44, h: 44, scale: 0.74, ground: "square" },
  { name: "Square71x71Logo", w: 71, h: 71, scale: 0.62, ground: "square" },
  { name: "Square150x150Logo", w: 150, h: 150, scale: 0.5, ground: "square" },
  { name: "Square310x310Logo", w: 310, h: 310, scale: 0.42, ground: "square" },
  { name: "Wide310x150Logo", w: 310, h: 150, scale: 0.52, ground: "square" },
  { name: "SplashScreen", w: 620, h: 300, scale: 0.3, ground: "square" }
];

async function png(svg, path) {
  await writeFile(path, await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
}

let count = 0;

for (const { name, w, h, scale, ground } of IMAGES) {
  const widths = scaled(w);
  const heights = scaled(h);

  for (const factor of SCALES) {
    await png(
      markSvg({ width: widths[factor], height: heights[factor], scale, ground }),
      join(OUT, `${name}.scale-${factor}.png`)
    );
    count += 1;
  }
}

/**
 * The app-list icon again, at the exact pixel sizes Windows asks for by name.
 *
 * `targetsize-*` is a separate axis from `scale-*`: the scale ladder is for
 * tiles the shell resizes, and these are for the places it does not — the
 * taskbar, Alt-Tab, the file association list, the 256px icon Explorer shows.
 * Naming one and omitting the other leaves those surfaces falling back to a
 * downscaled tile, which is the blurry-icon-in-the-taskbar look.
 *
 * Each comes twice. The plated form sits on the accent-coloured square Windows
 * draws behind it; the unplated form is what the taskbar uses, and it must be
 * transparent — a tile-coloured square on a dark taskbar is the single most
 * visible way to look like a port of something.
 */
const TARGET_SIZES = [16, 24, 32, 48, 256];

for (const size of TARGET_SIZES) {
  await png(
    markSvg({ width: size, scale: 0.74, ground: "square" }),
    join(OUT, `Square44x44Logo.targetsize-${size}.png`)
  );
  await png(
    markSvg({ width: size, scale: 0.86 }),
    join(OUT, `Square44x44Logo.targetsize-${size}_altform-unplated.png`)
  );
  count += 2;
}

/**
 * The listing logo, which is not any of the above.
 *
 * Partner Center asks for a 300×300 separately from everything in the package:
 * the ones above are what Windows draws once the app is installed, and this is
 * what the store page shows to someone deciding whether to install it. They are
 * uploaded in different places and are easy to confuse, so it is written to the
 * listing folder rather than into `msix/`.
 */
const LISTING = join(here, "assets", "listing");
await mkdir(LISTING, { recursive: true });

await png(
  markSvg({ width: 300, scale: 0.62, ground: "square" }),
  join(LISTING, "store-logo-300.png")
);

console.log(`  ${count} MSIX images in mobile/microsoft-store/assets/msix/`);
console.log(`  store-logo-300.png in mobile/microsoft-store/assets/listing/`);
console.log(`\nBackgroundColor in the package manifest is ${GROUND} — see submission.md.`);
