#!/usr/bin/env node
/**
 * Generate the Microsoft Store *listing* art: store logos, key art and screenshots.
 *
 * Different job from `pack:msstore`, which makes the tiles that live *inside* the MSIX. These are
 * the images uploaded separately in Partner Center under Store listings, and the Store shows them
 * to people who have not installed anything yet.
 *
 * Sizes come from Microsoft's "App screenshots, images, and trailers" page and are not ours to
 * round off — a 1365-pixel-wide screenshot is rejected on upload:
 *
 *   Desktop screenshots   1366 x 768 or larger (4K supported), .png, max 50 MB, up to 10
 *   2:3 Poster art        720 x 1080    strongly recommended for games; the main logo image
 *   1:1 Box art           1080 x 1080   used when poster art is absent
 *   1:1 App tile icon     300 x 300     takes priority over the icon inside the package
 *   16:9 Super hero art   1920 x 1080   no text, no app UI; needed for trailers to appear
 *
 * Xbox art (584x800, 1920x1080, 1080x1080) and the 2:1 holographic image are deliberately not
 * generated: the manifest targets Windows.Desktop only, and uploading art for a device family
 * the package does not declare is a certification note, not a bonus.
 *
 * Two kinds of image, made two different ways, because they answer different questions.
 *
 * Screenshots and super hero art are captured from the running game. Microsoft asks for "a
 * dynamic image that relates to the app ... avoid stock photography or generic visuals", and a
 * real frame of the real game is exactly that. The hero art is captured with the HUD removed, as
 * the guidance says to avoid showing app UI; screenshots keep it, because showing the app is the
 * whole point of a screenshot.
 *
 * Poster and box art are drawn. For a game they are the Store's *logo* images, sitting in a grid
 * next to every other listing and often small — the first attempt captioned a captured frame and
 * it read as a murky brown field at full size and as nothing at all as a thumbnail. They are
 * built from the app icon's own kangaroo, so the cover and the icon are demonstrably the same
 * artwork rather than two drawings that resemble each other.
 *
 * Playwright is not a declared dependency, so the browser-driven parts skip cleanly when it is
 * absent and the tile icon is still produced.
 *
 * Usage:
 *   npm run build:client && npm run pack:msstore:listing
 *   npm run pack:msstore:listing -- --check     # verify sizes and inputs only
 */

import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compose, decodePng, encodePng, keyOut, trim } from './lib/png.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist', 'client');
const publicDir = path.join(root, 'packages', 'client', 'public');
const outDir = path.join(root, 'packaging', 'microsoft-store', 'listing');

const CHECK_ONLY = process.argv.includes('--check');

/** The game's own ground green. Tiles, splash and listing art all sit on the same colour. */
const BACKGROUND = '#1d3a24';
/** Partner Center rejects anything larger, per image. */
const MAX_BYTES = 50 * 1024 * 1024;

const problems = [];
const problem = (m) => problems.push(m);
/** Everything produced, with the size it actually came out at. Declared here because `--check`
 *  reports long before the capture section further down would otherwise create it. */
const written = [];

/**
 * Key art and logos.
 *
 * `style: 'cover'` is drawn and carries the game's name — poster and box art are allowed to, and
 * it helps them read as a game rather than a utility. `style: 'capture'` is a frame of the game
 * with no text at all, which is what super hero art is required to be.
 */
const KEY_ART = [
  { file: 'PosterArt-720x1080.png', width: 720, height: 1080, style: 'cover', note: '2:3 poster art — main logo image for games' },
  { file: 'BoxArt-1080x1080.png', width: 1080, height: 1080, style: 'cover', note: '1:1 box art' },
  { file: 'SuperHeroArt-1920x1080.png', width: 1920, height: 1080, style: 'capture', note: '16:9 super hero art — no text, no UI' },
];

/**
 * Screenshots, one per mode.
 *
 * Six rather than one: Microsoft recommends five to eight, and this game's modes look different
 * enough from each other that a single shot would undersell it.
 */
const SHOTS = [
  { file: '01-kangaroo-chase.png', mode: 'Kangaroo Chase', caption: 'Hop, climb and vault — the chase that gives the game its name.' },
  { file: '02-the-hunt.png', mode: 'The Hunt', caption: 'Earn cash mid-round and spend it on traps, smoke and armour.' },
  { file: '03-freeze-tag.png', mode: 'Freeze Tag', caption: 'Frozen teammates stay in play until somebody thaws them.' },
  { file: '04-king-of-the-hill.png', mode: 'King of the Hill', caption: 'Hold the hill while everyone else tries to take it.' },
  { file: '05-parkour-race.png', mode: 'Parkour Race', caption: 'A pure movement race — no tagging, just the route.' },
  { file: '06-infection.png', mode: 'Infection', caption: 'One infected player, and a countdown until nobody is left.' },
];
const SHOT_SIZE = { width: 1366, height: 768 };

// --- inputs -----------------------------------------------------------------------------------

const iconPath = path.join(publicDir, 'icons', 'icon-1024.png');
let icon;
try {
  icon = decodePng(await readFile(iconPath));
} catch (error) {
  problem(`could not read ${path.relative(root, iconPath)}: ${error?.message ?? error}`);
}

/** The 300x300 tile icon needs no browser, so it is produced whether or not one is available. */
async function writeTileIcon() {
  await mkdir(path.join(outDir, 'logos'), { recursive: true });
  const image = compose(icon, { width: 300, height: 300, background: BACKGROUND, padding: 0.12 });
  const file = path.join(outDir, 'logos', 'AppTileIcon-300x300.png');
  await writeFile(file, encodePng(image));
  return file;
}

// --- verification -----------------------------------------------------------------------------

/**
 * Check a written file against the size it was supposed to be.
 *
 * By decoding the PNG rather than trusting the capture call: a viewport is a request, and a
 * device pixel ratio or a scrollbar can quietly turn it into different image dimensions. The one
 * thing Partner Center checks first is the pixel size.
 */
async function verify(file, width, height) {
  const bytes = await readFile(file);
  const image = decodePng(bytes);
  const name = path.relative(outDir, file);
  if (image.width !== width || image.height !== height) {
    problem(`${name} is ${image.width}x${image.height}, must be ${width}x${height}`);
  }
  if (bytes.length > MAX_BYTES) problem(`${name} is ${(bytes.length / 1e6).toFixed(1)} MB; the limit is 50 MB`);
  return { name, width: image.width, height: image.height, bytes: bytes.length };
}

if (CHECK_ONLY) {
  if (icon) {
    // Prove the one browser-free asset can actually be produced, and that it comes out right.
    const file = await writeTileIcon();
    await verify(file, 300, 300);
  }
  report(`Microsoft Store listing checks passed — ${KEY_ART.length} key art + ${SHOTS.length} screenshot specs, tile icon generated.`);
  process.exit(problems.length > 0 ? 1 : 0);
}

// --- capture ----------------------------------------------------------------------------------

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('pack:msstore:listing — playwright is not installed; capturing only the tile icon.');
  console.log('  npm i -D playwright && npx playwright install chromium');
  if (icon) console.log(`\nWrote ${path.relative(root, await writeTileIcon())}`);
  process.exit(problems.length > 0 ? 1 : 0);
}

try {
  await readFile(path.join(DIST, 'index.html'));
} catch {
  console.error('pack:msstore:listing — dist/client is missing. Run `npm run build:client` first.');
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

/**
 * The kangaroo alone, as a data URI.
 *
 * Inlined rather than served: the cover is rendered with `setContent` on a blank page, which has
 * no origin to resolve a relative path against, and one base64 string is less machinery than a
 * second route on the static server.
 */
const glyph = `data:image/png;base64,${Buffer.from(encodePng(trim(keyOut(icon, BACKGROUND)))).toString('base64')}`;

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

  if (mode) {
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
  } else {
    await page.locator('button', { hasText: 'Practice with bots' }).first().click();
  }
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
  // In steps, because a single jump is one event and the look integrates movement per event.
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
  await page.mouse.up();
}

/**
 * Walk the map, look around, and keep the best frame.
 *
 * The first pass shot the player wherever they spawned, and half the spawns face the empty edge
 * of the level: flat sky over flat dirt, which is exactly the "empty space" the Store guidance
 * says to avoid. Rather than hand-pick coordinates that the next level change would invalidate,
 * this travels a little, turns, hops, and photographs — then keeps whichever frame carries the
 * most detail.
 *
 * Compressed size is the measure. It is a proxy, but not a vague one: an empty-field frame
 * deflates to about 45 KB and a frame with trees, rocks, buildings and other players to about
 * 200 KB, and the ranking it produced matched the frames picked by eye every time.
 */
async function captureBestFrame(page, candidates = 7) {
  let best = null;
  for (let i = 0; i < candidates; i++) {
    await page.keyboard.down('w');
    await page.waitForTimeout(1100);
    await page.keyboard.up('w');
    // A wide swing each time, tilted a little down so the frame is scenery rather than sky.
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

/** Strip every piece of interface, leaving only the rendered world. */
async function hideInterface(page) {
  await page.evaluate(() => {
    for (const selector of ['.kc-hud', '.kc-root']) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) node.style.display = 'none';
    }
  });
}

/**
 * Draw the cover: the kangaroo, the name, on the game's own colours.
 *
 * Poster and box art are the Store's *logo* images for a game, not screenshots — they sit in a
 * grid next to every other listing, often small. The first attempt overlaid the title on a
 * captured frame and it read as a murky brown field with words on it: legible at full size,
 * mud in a grid. A drawn cover is sharp at any size and unmistakable at thumbnail size, which is
 * the size that decides whether anyone clicks.
 *
 * The kangaroo is the app icon with its tile background keyed out, so the cover and the icon are
 * demonstrably the same artwork rather than two drawings that resemble each other.
 *
 * Everything sits in the top two-thirds: the Store draws its own text across the bottom third.
 */
async function renderCover(page, glyphDataUri) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; }
    body {
      height: 100vh; display: flex; flex-direction: column;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif;
      /* The game's palette: a lit clearing in the dark green it is played in. */
      background: radial-gradient(circle at 50% 40%, #3c8a4c 0%, #1d3a24 48%, #0b160e 100%);
    }
    /* Everything lives in this band, and the band is exactly the top two-thirds. The Store draws
       its own text across the bottom third, so that is the guarantee to make structural rather
       than to approximate with margins — CSS resolves percentage margins against *width*, which
       silently gives a different reserve on a 2:3 image than on a 1:1 one. */
    .band {
      height: 66.6%; box-sizing: border-box; padding: 8% 8% 0;
      display: flex; flex-direction: column; align-items: center;
      /* Type is sized against this band's shorter side, not the viewport's. Sized against width,
         the same rule gave a 90px title on the 2:3 cover and a 134px one on the 1:1 — the square
         is wider for the same height, and the title then crowded the kangaroo out of its own
         cover. Against the band, both covers get the same title and the same balance. */
      container-type: size;
    }
    h1 {
      margin: 0; color: #fff; font-weight: 800; letter-spacing: .045em; line-height: 1.02;
      text-align: center; font-size: 12.4cqmin;
      text-shadow: 0 2px 16px rgba(0,0,0,.55);
    }
    .rule { width: 26%; height: 1.1cqmin; border-radius: 999px; background: #ffd166; margin: 3.2% 0 2.4%; }
    p { margin: 0; color: #ffe9b8; font-weight: 600; text-align: center; font-size: 3.6cqmin; }
    /* Pre-trimmed to the kangaroo's own bounds, so it fills what is left of the band with
       subject rather than with transparent margin. */
    .roo { flex: 1; min-height: 0; width: 100%; object-fit: contain; padding-top: 4%;
           filter: drop-shadow(0 2.5cqmin 4cqmin rgba(0,0,0,.5)); }
  </style></head><body>
    <div class="band">
      <h1>KANGAROO CHASE</h1>
      <div class="rule"></div>
      <p>Tag, parkour and traps &mdash; on your feet</p>
      <img class="roo" src="${glyphDataUri}" alt="">
    </div>
  </body></html>`);
  await page.waitForTimeout(300);
}

// Key art: one capture per size, so each is framed for its own aspect rather than cropped.
for (const spec of KEY_ART) {
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    let frame;
    if (spec.style === 'cover') {
      await renderCover(page, glyph);
      frame = await page.screenshot({ animations: 'disabled' });
    } else {
      await enterMatch(page, 'Kangaroo Chase');
      // Interface off before scouting, so every candidate frame is already the finished image
      // and the one that wins needs no second capture from a position the player has left.
      await hideInterface(page);
      frame = await captureBestFrame(page);
    }

    await mkdir(path.join(outDir, 'logos'), { recursive: true });
    const file = path.join(outDir, 'logos', spec.file);
    await writeFile(file, frame);
    written.push({ ...(await verify(file, spec.width, spec.height)), note: spec.note });
  } catch (error) {
    problem(`${spec.file}: ${String(error).split('\n')[0]}`);
  } finally {
    await releaseKeys(page);
    await context.close();
  }
}

// Screenshots: the interface stays, because that is what a screenshot is for.
for (const shot of SHOTS) {
  const context = await browser.newContext({ viewport: SHOT_SIZE, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await enterMatch(page, shot.mode);
    const frame = await captureBestFrame(page);

    await mkdir(path.join(outDir, 'screenshots'), { recursive: true });
    const file = path.join(outDir, 'screenshots', shot.file);
    await writeFile(file, frame);
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
  const file = await writeTileIcon();
  written.push({ ...(await verify(file, 300, 300)), note: '1:1 app tile icon' });
}

/**
 * The captions belong with the images: Partner Center asks for one per screenshot, and writing
 * them at upload time is how they end up as "Screenshot 3".
 */
await writeFile(
  path.join(outDir, 'captions.txt'),
  [
    'Screenshot captions for Partner Center (200 characters or fewer each).',
    '',
    ...SHOTS.map((s) => `${s.file}\n  ${s.caption}\n`),
  ].join('\n'),
);

report();

function report(extra) {
  if (written.length > 0) {
    console.log(`\nWrote ${written.length} images to packaging/microsoft-store/listing/`);
    for (const w of written) {
      console.log(`  ${w.name.padEnd(38)} ${`${w.width}x${w.height}`.padEnd(11)} ${(w.bytes / 1024).toFixed(0).padStart(5)} KB  ${w.note ?? ''}`);
    }
    console.log(`\nUpload at https://partner.microsoft.com/dashboard → your app → Store listings.`);
    console.log(`Captions for each screenshot are in listing/captions.txt.`);
  }
  // Only when it actually passed. Printing "checks passed" above a list of problems is the kind
  // of output that trains people to stop reading it.
  if (extra && problems.length === 0) console.log(`\n${extra}`);
  if (problems.length > 0) {
    console.error(`\n\x1b[31m${problems.length} problem(s):\x1b[0m`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  }
}
