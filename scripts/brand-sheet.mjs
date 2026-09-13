import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { GRADIENT, GRID, GROUND, PETALS, markPath } from "./brand-mark.mjs";

/**
 * The brand sheet: one page showing what the mark is and how it behaves.
 *
 * Generated rather than drawn, like every other image in this repository, and
 * for the same reason — a brand sheet that is a hand-made file is out of date
 * the first time anyone touches the mark, and being out of date is worse than
 * not existing, because people trust it. This one is drawn from
 * `brand-mark.mjs`, so it cannot disagree with the icons.
 *
 * It exists to answer three questions someone will actually ask: what is the
 * lockup, does the mark survive small sizes on both grounds, and what are the
 * colours.
 *
 *   npm run brand:sheet
 */

const WIDTH = 1200;
const HEIGHT = 760;
const INK = "#171123";
const DARK = "#241634";

const path = markPath();

/** One gradient per instance: several `<linearGradient id="g">` in a document is one gradient. */
const gradient = (id) =>
  `<linearGradient id="${id}" x1="${GRADIENT.x1}" y1="${GRADIENT.y1}" x2="${GRADIENT.x2}" y2="${GRADIENT.y2}" gradientUnits="userSpaceOnUse">` +
  `<stop stop-color="${GRADIENT.from}" /><stop offset="1" stop-color="${GRADIENT.to}" /></linearGradient>`;

const mark = (x, y, size, id) =>
  `<g transform="translate(${x} ${y}) scale(${size / GRID})"><path d="${path}" fill="url(#${id})" /></g>`;

/**
 * A row of the mark at increasing sizes, sitting on one baseline.
 *
 * Bottom-aligned rather than top-aligned: laid out from the top, each mark
 * starts where the last one did and they stagger down the page, which reads as
 * a mistake rather than as a size ramp.
 */
const ramp = (x, baseline, sizes, id, pitch = 96) =>
  sizes.map((size, i) => mark(x + i * pitch, baseline - size, size, id)).join("");

const SIZES = [16, 24, 32, 48, 64];
const SANS = "system-ui,-apple-system,'Segoe UI',sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,monospace";

const label = (x, y, text, fill = INK, opacity = 0.5) =>
  `<text x="${x}" y="${y}" font-size="13" letter-spacing="2" fill="${fill}" opacity="${opacity}" font-family="${SANS}">${text}</text>`;

const swatch = (x, value, stroke = false) =>
  `<circle cx="${x}" cy="706" r="9" fill="${value}"${stroke ? ` stroke="${INK}" stroke-opacity=".2"` : ""} />` +
  `<text x="${x + 20}" y="712" font-size="15" fill="${INK}" opacity=".7" font-family="${MONO}">${value}</text>`;

const notes = [
  `${PETALS} yaprak · Bugünün 5'i — günde beş kişi, sonsuz deste değil`,
  "Her yaprak bir vesica — eşit iki çemberin kesişimi; yani bir eşleşme",
  "Merkez açık — 16 pikselde bile leke değil, çiçek"
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Georgia, 'Times New Roman', serif">
  <defs>${gradient("a")}${gradient("b")}${gradient("c")}</defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${GROUND}" />

  ${label(64, 72, "FIOREMATCH · MARKA İŞARETİ")}

  ${mark(64, 110, 160, "a")}
  <text x="260" y="196" font-size="58" fill="${INK}">FioreMatch</text>
  <text x="262" y="232" font-size="17" fill="${INK}" opacity=".6" font-family="${SANS}">Sınırların ötesinde tanış</text>

  <line x1="64" y1="320" x2="${WIDTH - 64}" y2="320" stroke="${INK}" stroke-opacity=".12" />

  ${label(64, 362, "AÇIK ZEMİN")}
  ${ramp(64, 456, SIZES, "b")}

  <rect x="560" y="340" width="${WIDTH - 624}" height="150" rx="16" fill="${DARK}" />
  ${label(592, 376, "KOYU ZEMİN", "#ffffff", 0.55)}
  ${ramp(592, 466, SIZES, "c")}

  <line x1="64" y1="540" x2="${WIDTH - 64}" y2="540" stroke="${INK}" stroke-opacity=".12" />

  ${label(64, 582, "YAPI")}
  ${notes
    .map(
      (line, i) =>
        `<text x="64" y="${614 + i * 28}" font-size="16" fill="${INK}" opacity=".78" font-family="${SANS}">${line}</text>`
    )
    .join("\n  ")}

  ${swatch(64, GRADIENT.from)}
  ${swatch(210, GRADIENT.to)}
  ${swatch(356, GROUND, true)}
</svg>`;

const out = join(process.cwd(), "mobile", "assets");
await mkdir(out, { recursive: true });

const file = join(out, "brand-sheet.png");
const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
await sharp(png).toFile(file);

console.log(`${file} — ${WIDTH}×${HEIGHT}, ${Math.round(png.length / 1024)} kB`);
