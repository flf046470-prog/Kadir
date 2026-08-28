import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Replaces the Capacitor template's placeholder launcher icons and splash with
 * the FioreMatch mark.
 *
 * Android's adaptive icon is the fussy one: the system hands the launcher a
 * 108dp canvas and guarantees only the inner 72dp — the outer ring is cropped
 * to whatever mask the device uses, and is also what gets parallaxed. So the
 * foreground draws the mark at 44% of the canvas: comfortably inside 72/108
 * (66%) with room for the mask to breathe. Anything larger looks fine in the
 * preview and loses its edges on a real launcher.
 *
 * Run after `npx cap add android`, which restores the template's own files.
 */

const RES = join(process.cwd(), "android", "app", "src", "main", "res");
const GROUND = "#fff5f7";

const HEART = `<path
  d="M14 24.5s-9.5-5.86-9.5-13.02C4.5 7.4 7.55 4.5 11.1 4.5c1.99 0 3.7 1 4.9 2.62A6.02 6.02 0 0 1 20.9 4.5c3.55 0 6.6 2.9 6.6 6.98C27.5 18.64 18 24.5 14 24.5Z"
  fill="url(#g)" />`;

const GRADIENT = `<linearGradient id="g" x1="4.5" y1="4.5" x2="27.5" y2="24.5" gradientUnits="userSpaceOnUse">
  <stop stop-color="#fb6f92" /><stop offset="1" stop-color="#8360f5" /></linearGradient>`;

/** @param ground  "none" | "square" | "circle" */
function mark({ width, height = width, scale, ground = "none" }) {
  const size = Math.min(width, height) * scale;
  const x = (width - size) / 2;
  const y = (height - size) / 2;

  const backdrop =
    ground === "square"
      ? `<rect width="${width}" height="${height}" fill="${GROUND}" />`
      : ground === "circle"
        ? `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2}" fill="${GROUND}" />`
        : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${GRADIENT}</defs>${backdrop}
  <g transform="translate(${x} ${y}) scale(${size / 28})">${HEART}</g>
</svg>`;
}

async function png(svg, path) {
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path, buffer);
  return buffer.length;
}

// Legacy launcher icons, plus the adaptive foreground at its own larger canvas.
const densities = [
  { dir: "mdpi", legacy: 48, foreground: 108 },
  { dir: "hdpi", legacy: 72, foreground: 162 },
  { dir: "xhdpi", legacy: 96, foreground: 216 },
  { dir: "xxhdpi", legacy: 144, foreground: 324 },
  { dir: "xxxhdpi", legacy: 192, foreground: 432 }
];

for (const { dir, legacy, foreground } of densities) {
  const out = join(RES, `mipmap-${dir}`);
  await png(mark({ width: legacy, scale: 0.68, ground: "square" }), join(out, "ic_launcher.png"));
  await png(mark({ width: legacy, scale: 0.6, ground: "circle" }), join(out, "ic_launcher_round.png"));
  // Transparent: the adaptive icon's background layer is the colour resource.
  await png(mark({ width: foreground, scale: 0.44 }), join(out, "ic_launcher_foreground.png"));
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
  const svg = mark({ width: w, height: h, scale: 0.28, ground: "square" });
  await png(svg, join(RES, `drawable-${dir}`, "splash.png"));
  // The landscape set is the same picture rotated into a wider frame.
  const land = dir.replace("port-", "land-");
  await png(mark({ width: h, height: w, scale: 0.28, ground: "square" }), join(RES, `drawable-${land}`, "splash.png"));
}

await png(mark({ width: 480, height: 800, scale: 0.28, ground: "square" }), join(RES, "drawable", "splash.png"));

await writeFile(
  join(RES, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${GROUND}</color>\n</resources>\n`
);

console.log("Android launcher icons and splash regenerated.");
