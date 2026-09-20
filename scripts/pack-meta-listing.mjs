#!/usr/bin/env node
/**
 * Generate the Meta Horizon Store *listing* art: the app icon, key art and screenshots uploaded
 * in the Developer Dashboard under App Submissions → Assets.
 *
 * Different job from `pack:quest`, which builds the installable APK/AAB. Nothing here goes near
 * a device; it is what a person browsing the Store sees before they ever launch the app.
 *
 * Sizes and format come from Meta's own asset design guidelines
 * (developers.meta.com/horizon/resources/asset-guidelines/) and are not ours to round off:
 *
 *   App icon           512x512   24-bit PNG, squared corners, solid fill (no transparency)
 *   Screenshots         5 x     2560x1440, 16:9, 24-bit PNG, no duplicates, no marketing text
 *   Hero cover art     3000x900  10:3
 *   Cover, landscape   2560x1440  16:9
 *   Cover, square      1440x1440  1:1
 *   Cover, portrait    1008x1440  7:10
 *   Cover, mini        1080x360   3:1
 *   Trailer cover      2560x1440  16:9
 *
 * "24-bit PNG" is a bit-depth term, not a description of "looks opaque" — an opaque RGBA file is
 * 32-bit and fails it literally. `encodePngRGB` in `lib/png.mjs` writes true colour-type-2 PNGs
 * for exactly this reason; every file this script writes goes through it, never `encodePng`.
 *
 * Two things this script does **not** produce, and why:
 *
 *   - The 180x180 spatialized icon (foreground + background, hover shadow). It is explicitly
 *     optional on Meta's own guidelines page, and it is a different kind of asset — two layered
 *     images with real transparency — rather than a size variant of the flat icon this script
 *     already makes. Skipped rather than faked.
 *   - The trailer video. Meta wants 30s–2min of MP4/H.264/AAC; what this repository can produce
 *     without a real edit pass is a 12 fps GIF assembled from swiftshader frames
 *     (`capture:trailer`), which is not that file. The trailer *cover image* — a static PNG,
 *     genuinely producible here — is generated below; the video itself is a real gap, recorded
 *     as one rather than shipped as a GIF pretending to qualify.
 *
 * Meta prefers first-person POV screenshots ("1-2 third-person/mixed reality shots allowed").
 * There is no headset in this environment and there never will be (see CLAUDE.md), so these are
 * captured from the desktop third-person camera every non-VR platform actually uses — genuine
 * gameplay, not a mockup, but not the headset's own view either. Said plainly rather than passed
 * off as first-person.
 *
 * Usage:
 *   npm run build:client && npm run pack:meta:listing
 *   npm run pack:meta:listing -- --check     # verify sizes and inputs only
 */

import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compose, decodePng, encodePngRGB, keyOut, trim } from './lib/png.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist', 'client');
const publicDir = path.join(root, 'packages', 'client', 'public');
const outDir = path.join(root, 'packaging', 'meta-quest', 'listing');

const CHECK_ONLY = process.argv.includes('--check');

/** The game's own ground green. Every drawn asset in every store listing sits on this. */
const BACKGROUND = '#1d3a24';
/** Meta's own limit is per-asset and generous (50 MB for screenshots); this catches a runaway
 *  capture rather than approximating Meta's actual ceiling. */
const MAX_BYTES = 20 * 1024 * 1024;

const problems = [];
const problem = (m) => problems.push(m);
const written = [];

/**
 * Key art. `style: 'cover'` is drawn — it carries the title, which is normal for a Store's own
 * logo-grid images — and `style: 'capture'` would be a bare frame of the game, but Meta draws no
 * automatic text over these the way some storefronts do over hero art, so every size here is
 * drawn rather than captured: it is what makes the five sizes read as one piece of key art
 * rather than four crops of a screenshot plus one drawing.
 */
const KEY_ART = [
  { file: 'HeroCover-3000x900.png', width: 3000, height: 900, note: '10:3 hero cover art' },
  { file: 'CoverLandscape-2560x1440.png', width: 2560, height: 1440, note: '16:9 cover art' },
  { file: 'CoverSquare-1440x1440.png', width: 1440, height: 1440, note: '1:1 cover art' },
  { file: 'CoverPortrait-1008x1440.png', width: 1008, height: 1440, note: '7:10 cover art' },
  { file: 'CoverMini-1080x360.png', width: 1080, height: 360, note: '3:1 mini cover art' },
  { file: 'TrailerCover-2560x1440.png', width: 2560, height: 1440, note: 'trailer cover image (the trailer video itself is not built here — see the file header)' },
];

/**
 * Screenshots, one per mode — exactly five, as required, chosen for the widest spread of what
 * the game actually does: a chase, a ranged economy mode, a team-survival mode, a contested
 * objective, and a 1-on-1 fight. Infection, Parkour Race, VR Boxing and the Training Room are
 * real modes too; five slots is the constraint, not a judgement about the other four.
 */
const SHOTS = [
  { file: '01-kangaroo-chase.png', mode: 'Kangaroo Chase' },
  { file: '02-the-hunt.png', mode: 'The Hunt' },
  { file: '03-freeze-tag.png', mode: 'Freeze Tag' },
  { file: '04-king-of-the-hill.png', mode: 'King of the Hill' },
  { file: '05-conversion-duel.png', mode: 'Conversion Duel' },
];
const SHOT_SIZE = { width: 2560, height: 1440 };

// --- inputs -----------------------------------------------------------------------------------

const iconPath = path.join(publicDir, 'icons', 'icon-1024.png');
let icon;
try {
  icon = decodePng(await readFile(iconPath));
} catch (error) {
  problem(`could not read ${path.relative(root, iconPath)}: ${error?.message ?? error}`);
}

/**
 * The 512x512 app icon needs no browser, so it is produced whether or not one is available.
 *
 * Composed from the *keyed-out and trimmed* glyph, not the raw `icon-1024.png` directly. That
 * source file already carries its own safe-zone padding baked in — it is drawn to survive an OS
 * cropping it to a rounded square or a circle — so handing it straight to `compose` pads a
 * glyph that is already padded, and the kangaroo ends up occupying under a third of the canvas.
 * Measured: composing the raw icon at `padding: 0.08` still leaves the kangaroo roughly the size
 * a `padding: 0.4` composition of the *trimmed* glyph would. Meta's guidance calls the icon a
 * "solid filled asset" that "must maintain legibility" and never crops it, so this store gets
 * the same trim-to-bounds treatment the cover art below already uses, at a padding chosen for
 * this canvas rather than inherited from one built for a different shape.
 */
async function writeIcon() {
  await mkdir(outDir, { recursive: true });
  const glyphImage = trim(keyOut(icon, BACKGROUND));
  const image = compose(glyphImage, { width: 512, height: 512, background: BACKGROUND, padding: 0.14 });
  const file = path.join(outDir, 'AppIcon-512x512.png');
  await writeFile(file, encodePngRGB(image));
  return file;
}

// --- verification -----------------------------------------------------------------------------

/** Decode what was written and check it against the size Meta's upload form enforces. */
async function verify(file, width, height) {
  const bytes = await readFile(file);
  const image = decodePng(bytes);
  const name = path.relative(outDir, file);
  if (image.width !== width || image.height !== height) {
    problem(`${name} is ${image.width}x${image.height}, must be ${width}x${height}`);
  }
  if (bytes.length > MAX_BYTES) problem(`${name} is ${(bytes.length / 1e6).toFixed(1)} MB — larger than expected for this asset`);
  return { name, width: image.width, height: image.height, bytes: bytes.length };
}

if (CHECK_ONLY) {
  if (icon) {
    const file = await writeIcon();
    await verify(file, 512, 512);
  }
  report(`Meta Horizon listing checks passed — ${KEY_ART.length} key art specs + ${SHOTS.length} screenshot specs (exactly 5, as required), icon generated.`);
  process.exit(problems.length > 0 ? 1 : 0);
}

// --- capture ----------------------------------------------------------------------------------

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('pack:meta:listing — playwright is not installed; capturing only the icon.');
  console.log('  npm i -D playwright && npx playwright install chromium');
  if (icon) console.log(`\nWrote ${path.relative(root, await writeIcon())}`);
  process.exit(problems.length > 0 ? 1 : 0);
}

try {
  await readFile(path.join(DIST, 'index.html'));
} catch {
  console.error('pack:meta:listing — dist/client is missing. Run `npm run build:client` first.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  let file = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (file === '/') file = '/index.html';
  try {
    const body = await readFile(path.join(DIST, file));
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(path.join(DIST, 'index.html')));
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const launch = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {};
const browser = await chromium.launch(launch);

/** The kangaroo alone, as a data URI — the same glyph the app icon is built from. */
const glyph = `data:image/png;base64,${Buffer.from(encodePngRGB(trim(keyOut(icon, BACKGROUND)))).toString('base64')}`;

/** Boot the game and get into a live round of `mode`, ready to photograph. */
async function enterMatch(page, mode) {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.locator('input[type=text]').first().fill('Roo');
  await page.locator('button', { hasText: 'Start' }).first().click();
  await page.waitForTimeout(2500);

  const gotIt = page.locator('button', { hasText: 'Got it' });
  if (await gotIt.count()) {
    await gotIt.first().click();
    await page.waitForTimeout(1200);
  }

  await page.locator('button', { hasText: 'Game modes' }).first().click();
  await page.waitForTimeout(1000);
  const cards = page.locator('.kc-root .kc-card');
  let found = false;
  for (let i = 0; i < (await cards.count()); i++) {
    if ((await cards.nth(i).locator('h3').innerText()).trim() !== mode) continue;
    const button = cards.nth(i).locator('button').first();
    // A mode that is not the current one shows "Select" first, then becomes the play button.
    if ((await button.innerText()).trim() === 'Select') {
      await button.click();
      await page.waitForTimeout(600);
    }
    await cards.nth(i).locator('button').first().click();
    found = true;
    break;
  }
  if (!found) problem(`no game mode card named "${mode}"`);
  // Long enough for the world to stream in, the bots to spread out and the round to start.
  await page.waitForTimeout(9000);
}

/** Swing the view. Dragging rather than nudging, so this works whether or not pointer lock took. */
async function lookAround(page, dx, dy = 0) {
  const size = page.viewportSize();
  const cx = size.width / 2;
  const cy = size.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
  await page.mouse.up();
}

/**
 * Walk the map, look around, and keep the busiest frame — the one with the most going on, by
 * compressed size. See `pack-msstore-listing.mjs` for the measurement behind that proxy: an
 * empty-field frame deflates to a fraction of the size a frame with terrain, props and other
 * players does, and the ranking it produces matches picking by eye.
 */
async function captureBestFrame(page, candidates = 7) {
  let best = null;
  for (let i = 0; i < candidates; i++) {
    await page.keyboard.down('w');
    await page.waitForTimeout(1100);
    await page.keyboard.up('w');
    await lookAround(page, 620, i === 0 ? 90 : 0);
    await page.waitForTimeout(350);

    // Shoot at the top of a hop: the signature move, and the only pose that reads as movement.
    await page.keyboard.down('Space');
    await page.waitForTimeout(300);
    await page.keyboard.up('Space');
    await page.waitForTimeout(210);

    const frame = await page.screenshot({ animations: 'disabled' });
    if (!best || frame.length > best.length) best = frame;
  }
  return best;
}

async function releaseKeys(page) {
  await page.keyboard.up('w').catch(() => {});
  await page.keyboard.up('Space').catch(() => {});
}

/**
 * Draw one piece of key art: the kangaroo, the name, on the game's own colours.
 *
 * `.text` and `.roo` are always siblings, never one nested inside the other, and `.text` always
 * gets an *explicit* height rather than one derived from its own content. Both are load-bearing,
 * and both come from a version of this that shipped briefly with an invisible title:
 *
 *   - `container-type: size` — what makes the title's `cqmin` units scale with the text block
 *     instead of the viewport — requires the container to have a definite size, not one that
 *     depends on its own content's layout. `.text` was briefly `width: 100%` with no explicit
 *     height, so it could wrap around the kangaroo it then contained; a container whose size
 *     depends on its content cannot also size that content by container query, so every `cqmin`
 *     value inside it — the title, the rule, the tagline — resolved to zero instead. The rule
 *     line was the only thing still visible, because it has a `min-height` fallback in pixels.
 *   - With the kangaroo *inside* `.text` instead of beside it, the image's box was whatever a
 *     hand-picked padding percentage left over, which is exactly the "guessed per shape" failure
 *     this was already rewritten once to avoid — it read as correct in isolation and was wrong
 *     the moment `.text`'s own height changed.
 *
 * So: `.text` gets a fixed height (a percentage of the 100vh body, which is itself definite,
 * making the percentage definite too), and `.roo` is a sibling with `flex: 1` in the same flex
 * column, taking whatever height `.text` did not use rather than a number guessed per shape.
 *
 * The two most extreme ratios — 3:1 and 10:3 — are wide enough that a full-height column would
 * put a narrow sliver of kangaroo next to a wall of text, so those two alone go side by side,
 * with both `.text` and `.roo` given their own explicit sizes instead.
 */
async function renderCover(page, glyphDataUri, { veryWide }) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; }
    body {
      height: 100vh; display: flex; flex-direction: ${veryWide ? 'row' : 'column'}; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif;
      background: radial-gradient(circle at 50% 40%, #3c8a4c 0%, #1d3a24 48%, #0b160e 100%);
    }
    .text {
      ${veryWide ? 'height: 100%; width: 62%;' : 'width: 100%; height: 38%;'}
      box-sizing: border-box; padding: ${veryWide ? '0 4%' : '6% 8% 0'};
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      container-type: size;
    }
    h1 {
      margin: 0; color: #fff; font-weight: 800; letter-spacing: .045em; line-height: 1.02;
      text-align: center; font-size: 15cqmin;
      text-shadow: 0 2px 16px rgba(0,0,0,.55);
    }
    .rule { width: 22%; height: 1.4cqmin; min-height: 3px; border-radius: 999px; background: #ffd166; margin: 4% 0 3%; }
    p { margin: 0; color: #ffe9b8; font-weight: 600; text-align: center; font-size: 5.4cqmin; }
    .roo {
      ${veryWide ? 'height: 74%; width: 34%; margin: 0 4% 0 0;' : 'flex: 1; min-height: 0; width: 100%; padding: 0 12% 6%; box-sizing: border-box;'}
      object-fit: contain;
      filter: drop-shadow(0 2.5cqmin 4cqmin rgba(0,0,0,.5));
    }
  </style></head><body>
    <div class="text">
      <h1>KANGAROO CHASE</h1>
      <div class="rule"></div>
      <p>Tag, parkour and traps &mdash; hands-first in VR</p>
    </div>
    <img class="roo" src="${glyphDataUri}" alt="">
  </body></html>`);
  await page.waitForTimeout(300);
}

// Key art: one capture per size, so each is framed for its own aspect rather than cropped.
for (const spec of KEY_ART) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    // Only the two extreme aspect ratios (10:3 hero, 3:1 mini) get the side-by-side layout; a
    // 16:9 cover is wide but not so wide that a full-height column reads as a wall of text.
    await renderCover(page, glyph, { veryWide: spec.width / spec.height >= 2.5 });
    const frame = await page.screenshot({ animations: 'disabled' });

    await mkdir(outDir, { recursive: true });
    const file = path.join(outDir, spec.file);
    // The browser hands back RGBA; re-encoded through the 24-bit path for the same reason the
    // icon is — "24-bit PNG" is what Meta's upload form actually checks.
    await writeFile(file, encodePngRGB(decodePng(frame)));
    written.push({ ...(await verify(file, spec.width, spec.height)), note: spec.note });
  } catch (error) {
    problem(`${spec.file}: ${String(error).split('\n')[0]}`);
  } finally {
    await context.close();
  }
}

// Screenshots: the HUD stays on — it is what the player actually sees, not marketing material —
// and nothing is drawn over the frame.
for (const shot of SHOTS) {
  const context = await browser.newContext({ viewport: SHOT_SIZE, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await enterMatch(page, shot.mode);
    const frame = await captureBestFrame(page);

    await mkdir(outDir, { recursive: true });
    const file = path.join(outDir, shot.file);
    await writeFile(file, encodePngRGB(decodePng(frame)));
    written.push({ ...(await verify(file, SHOT_SIZE.width, SHOT_SIZE.height)), note: shot.mode });
  } catch (error) {
    problem(`${shot.file}: ${String(error).split('\n')[0]}`);
  } finally {
    await releaseKeys(page);
    await context.close();
  }
}

await browser.close();
await new Promise((resolve) => server.close(resolve));

if (icon) {
  const file = await writeIcon();
  written.push({ ...(await verify(file, 512, 512)), note: 'app icon' });
}

report();

function report(extra) {
  if (written.length > 0) {
    console.log(`\nWrote ${written.length} images to packaging/meta-quest/listing/`);
    for (const w of written) {
      console.log(`  ${w.name.padEnd(32)} ${`${w.width}x${w.height}`.padEnd(11)} ${(w.bytes / 1024).toFixed(0).padStart(5)} KB  ${w.note ?? ''}`);
    }
    console.log(`\nUpload at the Developer Dashboard → your app → App Submissions → Assets.`);
    console.log(`Copy for the name/description/category fields is in docs/META_LISTING.md.`);
  }
  if (extra && problems.length === 0) console.log(`\n${extra}`);
  if (problems.length > 0) {
    console.error(`\n\x1b[31m${problems.length} problem(s):\x1b[0m`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  }
}
