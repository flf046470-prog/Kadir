import sharp from "sharp";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The App Store's screenshots, composed rather than copied.
 *
 * Apple will not take the Play captures. It asks for exact pixel dimensions per
 * device class, and 1080×1920 is not one of them — nor can it be scaled into
 * one, because 9:19.5 is a taller frame than 9:16 and fitting one inside the
 * other either bars the top and bottom or crops the sides off the app.
 *
 * So each capture is *placed* on a canvas the size Apple asks for, inside a
 * device frame on the product's own aurora ground. That is what most listings
 * ship anyway, and it is honest: the pixels inside the frame are the untouched
 * capture, and the surround is plainly a surround rather than a pretend screen.
 *
 * There is no text on these. The listing copy carries the words, and burning an
 * English caption into the image would put English in front of someone browsing
 * the Turkish storefront.
 *
 * These stand in until the app runs against a real database and can be captured
 * on a simulator at native size. They are compliant, not final.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(here, "..", "captures");
const OUT = join(here, "assets");

/** The two sets App Store Connect requires for an iPhone-only submission. */
const SIZES = [
  { name: "6.9-inch", width: 1290, height: 2796 },
  { name: "6.5-inch", width: 1242, height: 2688 }
];

const GROUND = "#fff5f7";

/**
 * The aurora from `tailwind.config.ts`, as an SVG.
 *
 * Same three washes in the same places, so a screenshot in the store and the
 * app it opens are recognisably the same product. Weakened a little: at full
 * strength it competes with the screen it is framing.
 */
function ground(w, h) {
  const wash = (id, r, g, b, a) => `
      <radialGradient id="${id}">
        <stop offset="0%" stop-color="rgb(${r},${g},${b})" stop-opacity="${a}"/>
        <stop offset="100%" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/>
      </radialGradient>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>${wash("bloom", 251, 111, 146, 0.3)}${wash("dusk", 131, 96, 245, 0.28)}${wash("mist", 230, 224, 255, 0.5)}</defs>
    <rect width="${w}" height="${h}" fill="${GROUND}"/>
    <ellipse cx="${w * 0.15}" cy="${h * 0.16}" rx="${w * 0.75}" ry="${h * 0.34}" fill="url(#bloom)"/>
    <ellipse cx="${w * 0.88}" cy="${h * 0.03}" rx="${w * 0.7}" ry="${h * 0.3}" fill="url(#dusk)"/>
    <ellipse cx="${w * 0.5}"  cy="${h}"        rx="${w * 0.9}" ry="${h * 0.38}" fill="url(#mist)"/>
  </svg>`);
}

/**
 * The device: a soft drop shadow, then the dark bezel it sits in.
 *
 * `pad` is the room the shadow needs outside the bezel, and it is capped by the
 * caller at the margin around the device — a composite wider than the canvas it
 * lands on is an error, not a crop, so on the narrower canvas the shadow gets
 * less room rather than the whole set failing.
 */
function frame(w, h, radius, pad) {
  return {
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}">
      <defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="30"/>
      </filter></defs>
      <rect x="${pad}" y="${pad + 26}" width="${w}" height="${h}" rx="${radius}"
            fill="#171123" opacity="0.26" filter="url(#soft)"/>
      <rect x="${pad}" y="${pad}" width="${w}" height="${h}" rx="${radius}" fill="#0d0a14"/>
    </svg>`),
    pad
  };
}

/** Rounds the capture's corners so it sits inside the bezel, not over it. */
async function rounded(path, w, h, radius) {
  const resized = await sharp(path).resize(w, h, { fit: "fill" }).png().toBuffer();
  return sharp(resized)
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
             <rect width="${w}" height="${h}" rx="${radius}" fill="#fff"/>
           </svg>`
        ),
        blend: "dest-in"
      }
    ])
    .png()
    .toBuffer();
}

const captures = (await readdir(CAPTURES)).filter((f) => f.endsWith(".png")).sort();
if (captures.length === 0) throw new Error(`No captures in ${CAPTURES}`);

// Apple wants between 3 and 10 per device class.
if (captures.length < 3 || captures.length > 10) {
  throw new Error(`${captures.length} captures — App Store Connect takes 3 to 10`);
}

for (const size of SIZES) {
  const dir = join(OUT, size.name);
  await mkdir(dir, { recursive: true });

  const margin = Math.round(size.width * 0.07);
  const bezel = Math.round(size.width * 0.017);
  const outerW = size.width - margin * 2;
  const shotW = outerW - bezel * 2;
  const shotH = Math.round(shotW * (1920 / 1080));
  const outerH = shotH + bezel * 2;
  const outerR = Math.round(outerW * 0.085);

  if (outerH > size.height) {
    throw new Error(`${size.name}: the device is ${outerH}px tall in a ${size.height}px canvas`);
  }

  const top = Math.round((size.height - outerH) / 2);
  // Capped so the shadow can never push the composite past the canvas on
  // either axis.
  const device = frame(outerW, outerH, outerR, Math.min(90, margin, top));

  for (const name of captures) {
    const shot = await rounded(join(CAPTURES, name), shotW, shotH, outerR - bezel);

    const out = await sharp(ground(size.width, size.height))
      .composite([
        { input: device.buffer, left: margin - device.pad, top: top - device.pad },
        { input: shot, left: margin + bezel, top: top + bezel }
      ])
      .png({ compressionLevel: 9 })
      .toBuffer();

    const { width, height } = await sharp(out).metadata();
    if (width !== size.width || height !== size.height) {
      throw new Error(`${name} came out ${width}×${height}, not ${size.width}×${size.height}`);
    }

    await writeFile(join(dir, name), out);
  }

  console.log(`  ${size.name.padEnd(10)} ${size.width}×${size.height}  ${captures.length} screenshots`);
}

console.log(`\nApp Store screenshots ready in mobile/app-store/assets/`);
