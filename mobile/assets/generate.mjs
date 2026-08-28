import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GROUND, markSvg } from "../../scripts/brand-mark.mjs";

/**
 * Launcher icons and splash for the Android project.
 *
 * Android's adaptive icon is the fussy one: the system hands the launcher a
 * 108dp canvas and guarantees only the inner 72dp — the outer ring is cropped
 * to whatever mask the device uses, and is also what gets parallaxed. So the
 * foreground draws the mark at 44% of the canvas: comfortably inside 72/108
 * (66%) with room for the mask to breathe. Anything larger looks right in a
 * preview and loses its edges on a real launcher.
 *
 * Re-run after `npx cap add android`, which restores Capacitor's placeholders.
 */

const RES = join(process.cwd(), "mobile", "android", "app", "src", "main", "res");

async function png(svg, path) {
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path, buffer);
}

const densities = [
  { dir: "mdpi", legacy: 48, foreground: 108 },
  { dir: "hdpi", legacy: 72, foreground: 162 },
  { dir: "xhdpi", legacy: 96, foreground: 216 },
  { dir: "xxhdpi", legacy: 144, foreground: 324 },
  { dir: "xxxhdpi", legacy: 192, foreground: 432 }
];

for (const { dir, legacy, foreground } of densities) {
  const out = join(RES, `mipmap-${dir}`);
  await png(markSvg({ width: legacy, scale: 0.68, ground: "square" }), join(out, "ic_launcher.png"));
  await png(markSvg({ width: legacy, scale: 0.6, ground: "circle" }), join(out, "ic_launcher_round.png"));
  // Transparent: the adaptive icon's background layer is the colour resource.
  await png(markSvg({ width: foreground, scale: 0.44 }), join(out, "ic_launcher_foreground.png"));
}

// Splash. The mark stays small — it is a held frame, not a poster, and a
// launch image that fills the screen reads as slow even when it is not.
const splashes = [
  { dir: "port-mdpi", w: 320, h: 480 },
  { dir: "port-hdpi", w: 480, h: 800 },
  { dir: "port-xhdpi", w: 720, h: 1280 },
  { dir: "port-xxhdpi", w: 960, h: 1600 },
  { dir: "port-xxxhdpi", w: 1280, h: 1920 }
];

for (const { dir, w, h } of splashes) {
  await png(markSvg({ width: w, height: h, scale: 0.28, ground: "square" }), join(RES, `drawable-${dir}`, "splash.png"));
  const land = dir.replace("port-", "land-");
  await png(markSvg({ width: h, height: w, scale: 0.28, ground: "square" }), join(RES, `drawable-${land}`, "splash.png"));
}

await png(markSvg({ width: 480, height: 800, scale: 0.28, ground: "square" }), join(RES, "drawable", "splash.png"));

await writeFile(
  join(RES, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${GROUND}</color>\n</resources>\n`
);

/**
 * The iOS app icon, as a single 1024×1024 master.
 *
 * Xcode 14+ takes one file and derives every size, so there is no ladder to
 * generate here. It must be fully opaque with no alpha — the App Store rejects
 * an icon with transparency — which is why this is the only target drawn on a
 * square ground with no rounding of its own: iOS applies the squircle.
 */
await png(
  markSvg({ width: 1024, scale: 0.62, ground: "square" }),
  join(process.cwd(), "mobile", "assets", "AppIcon-1024.png")
);

console.log("Android launcher icons + splash, and the iOS 1024 master, regenerated.");
