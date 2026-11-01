#!/usr/bin/env node
/**
 * Generate the Steam and Epic Games Store *listing* art for a Coming Soon page: capsules, library
 * art, logos, offer images, icons and screenshots, at the sizes each store's upload form checks.
 *
 * Different job from `pack:steam`, which builds the app. Nothing here goes near a player's PC; it
 * is what somebody browsing a store sees before they ever install it. The copy that goes with it,
 * and where every number below comes from, is `docs/PC_LISTINGS.md`.
 *
 * Steam (partner.steamgames.com/doc/store/assets, read 2026-10-03):
 *
 *   Header capsule      920x430    Small capsule     462x174   — the logo should nearly fill it
 *   Main capsule       1232x706    Vertical capsule  748x896
 *   Library capsule     600x900    Library header    920x430
 *   Library hero      3840x1240   — artwork only, no text and no logo; Steam lays the logo over it
 *   Library logo      1280x720    — transparent PNG
 *   Shortcut icon      512x512     App icon          184x184 JPG
 *   Screenshots     5 x 1920x1080
 *
 * Capsules may carry the game's name and artwork and nothing else — no tagline, no review score, no
 * "wishlist now" — so `renderCover` is called here without the tagline Meta's covers carry.
 *
 * Epic (dev.epicgames.com/docs/epic-games-store, storefront media guide):
 *
 *   Product logo        960x540   — PNG, at most 1 MB
 *   Landscape offer   2560x1440   — "the product logo is in the center of the image"
 *   Portrait offer    1200x1600
 *   Media carousel  5 x 1920x1080 — at most 4 MB each
 *   Social preview    1200x1200   — JPG, optional
 *
 * The kangaroo in every piece is the game's own model, posed from its own run clip
 * (`renderModel`), and every backdrop is a frame of the real built game with the interface hidden.
 *
 * Usage:
 *   npm run build:client && npm run pack:pc:listing
 *   npm run pack:pc:listing -- --check     # sizes, the spec table and the browser-free icon only
 *   npm run pack:pc:listing -- --art       # key art and icons; keeps the screenshots already there
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BACKGROUND,
  brandGlyph,
  captureBestHeldFrame,
  enterMatch,
  hideInterface,
  hideSelf,
  imageDataUri,
  jpegSize,
  pinStoreQuality,
  releaseKeys,
  renderCover,
  renderLogo,
  renderModel,
  rollPastCountdown,
  serveDist,
  toJpeg,
} from './lib/listing.mjs';
import { timeControlSource } from './lib/trailer.mjs';
import { compose, decodePng, encodePng, encodePngRGB } from './lib/png.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist', 'client');
const THREE = path.join(root, 'node_modules', 'three');
const OUT = {
  steam: path.join(root, 'packaging', 'steam', 'listing'),
  epic: path.join(root, 'packaging', 'epic', 'listing'),
};

const CHECK_ONLY = process.argv.includes('--check');
// The five screenshots are most of a run's hour under swiftshader, and the key art is what gets
// iterated on. Skipping them leaves whatever screenshots are on disk untouched.
const ART_ONLY = process.argv.includes('--art');
const MB = 1024 * 1024;

const problems = [];
const problem = (m) => {
  problems.push(m);
  console.error(`pack:pc:listing — problem: ${m}`);
};
const written = [];

/**
 * Every drawn piece. `kind` decides how it is drawn: `cover` (name and kangaroo over a gameplay
 * frame, `row` or `column`), `logo` (the logo alone, centred and scaled to fill), or `hero`
 * (the gameplay frame alone). `alpha` keeps transparency; everything else is opaque.
 */
const ART = [
  { store: 'steam', file: 'store/header_capsule.png', width: 920, height: 430, kind: 'cover', layout: 'row' },
  { store: 'steam', file: 'store/small_capsule.png', width: 462, height: 174, kind: 'logo', fill: 0.9 },
  { store: 'steam', file: 'store/main_capsule.png', width: 1232, height: 706, kind: 'cover', layout: 'row' },
  { store: 'steam', file: 'store/vertical_capsule.png', width: 748, height: 896, kind: 'cover', layout: 'column' },
  { store: 'steam', file: 'library/library_capsule.png', width: 600, height: 900, kind: 'cover', layout: 'column' },
  { store: 'steam', file: 'library/library_header.png', width: 920, height: 430, kind: 'cover', layout: 'row' },
  { store: 'steam', file: 'library/library_hero.png', width: 3840, height: 1240, kind: 'hero' },
  { store: 'steam', file: 'library/library_logo.png', width: 1280, height: 720, kind: 'logo', alpha: true, fill: 0.94 },
  { store: 'epic', file: 'logo.png', width: 960, height: 540, kind: 'logo', alpha: true, fill: 0.94, maxBytes: 1 * MB },
  // Epic: "the product logo is in the center of the image" — so the offers are the logo, centred.
  { store: 'epic', file: 'offer_landscape.png', width: 2560, height: 1440, kind: 'logo', fill: 0.62 },
  { store: 'epic', file: 'offer_portrait.png', width: 1200, height: 1600, kind: 'logo', fill: 0.8 },
  { store: 'epic', file: 'social_preview.jpg', width: 1200, height: 1200, kind: 'cover', layout: 'column' },
];

/**
 * Five screenshots, one per mode, the same five frames on both stores: a chase, the hunter, the
 * team ball game, a contested objective and the fistfight — the widest spread of what the game
 * does. Steam gets PNGs; Epic's carousel gets JPEGs, because a busy 1920x1080 PNG can pass its
 * 4 MB ceiling and a JPEG at this quality never comes near it.
 */
// Which map each mode is shot on is measured, not picked for variety alone: the share of
// player-seconds with somebody within 12 m and in sight (`captureViewOf`, six bots, 4 seeds × 90 s).
// Conversion Duel on the outback was 26 %, and its screenshot was red earth with a penguin on the
// horizon; on the glacier it is 44 %. King of the Hill is 71 % on the glacier. It was tried on the
// outback (62 % for the bots) and the player started 140 m from everybody, in a rock corner it
// never got out of: a bots' average says nothing about where the one player who films starts.
const SHOTS = [
  { name: '01-kangaroo-chase', mode: 'Kangaroo Chase', map: 'Jungle World' },
  { name: '02-the-hunt', mode: 'The Hunt', map: 'Outback Station' },
  { name: '03-roo-ball', mode: 'Roo Ball', map: 'Jungle World' },
  { name: '04-king-of-the-hill', mode: 'King of the Hill', map: 'Glacier World' },
  { name: '05-conversion-duel', mode: 'Conversion Duel', map: 'Glacier World' },
];
const SHOT_SIZE = { width: 1920, height: 1080 };
const CAROUSEL_MAX = 4 * MB;

/** What the art table must satisfy before a browser is ever started. */
function checkTable() {
  const seen = new Set();
  for (const spec of ART) {
    const key = `${spec.store}/${spec.file}`;
    if (seen.has(key)) problem(`${key} is listed twice`);
    seen.add(key);
    if (spec.alpha && !spec.file.endsWith('.png')) problem(`${key} keeps transparency, so it must be a PNG`);
    if (spec.kind === 'cover' && !['row', 'column'].includes(spec.layout)) problem(`${key} needs a row or column layout`);
  }
  if (SHOTS.length !== 5) problem(`Steam asks for at least 5 screenshots; ${SHOTS.length} are listed`);
}

// --- inputs -----------------------------------------------------------------------------------

let icon;
try {
  icon = await brandGlyph();
} catch (error) {
  problem(`could not read assets/brand/kangaroo.png (npm run icons): ${error?.message ?? error}`);
}

/** The kangaroo on the game's green, as every other store's icon is. */
function iconImage(size) {
  return compose(icon, { width: size, height: size, background: BACKGROUND, padding: 0.12 });
}

async function writeShortcutIcon() {
  const file = path.join(OUT.steam, 'icons', 'shortcut_icon.png');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, encodePngRGB(iconImage(512)));
  return file;
}

// --- verification -----------------------------------------------------------------------------

/** Decode what was written and hold it to the size, format and weight the store checks. */
async function verify(store, file, { width, height, alpha = false, maxBytes = 20 * MB }) {
  const bytes = await readFile(file);
  const name = `${store}/${path.relative(OUT[store], file)}`;
  let size;
  if (file.endsWith('.jpg')) {
    size = jpegSize(bytes);
  } else {
    const image = decodePng(bytes);
    size = image;
    let clear = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] < 255) clear++;
    if (alpha && clear === 0) problem(`${name} should be transparent around the logo and is opaque everywhere`);
    if (!alpha && bytes[25] !== 2) problem(`${name} should be an opaque 24-bit PNG (colour type 2), is type ${bytes[25]}`);
  }
  if (size.width !== width || size.height !== height) problem(`${name} is ${size.width}x${size.height}, must be ${width}x${height}`);
  if (bytes.length > maxBytes) problem(`${name} is ${(bytes.length / MB).toFixed(2)} MB, over the ${(maxBytes / MB).toFixed(0)} MB limit`);
  return { name, width: size.width, height: size.height, bytes: bytes.length };
}

checkTable();

if (CHECK_ONLY) {
  if (icon) {
    const file = await writeShortcutIcon();
    await verify('steam', file, { width: 512, height: 512 });
  }
  report(`Steam/Epic listing checks passed — ${ART.length} art specs, ${SHOTS.length} screenshots per store, shortcut icon generated.`);
  process.exit(problems.length > 0 ? 1 : 0);
}

// --- capture ----------------------------------------------------------------------------------

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('pack:pc:listing — playwright is not installed; writing only the shortcut icon.');
  if (icon) console.log(`\nWrote ${path.relative(root, await writeShortcutIcon())}`);
  process.exit(problems.length > 0 ? 1 : 0);
}

try {
  await readFile(path.join(DIST, 'index.html'));
  await readFile(path.join(DIST, 'models', 'kangaroo.glb'));
} catch {
  console.error('pack:pc:listing — dist/client (with its models) is missing. Run `npm run build:client` first.');
  process.exit(1);
}

const server = await serveDist(DIST, THREE);
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Open a page at a size, run `fn`, and always close it. One page at a time: two swiftshader pages starve each other. */
async function withPage(size, fn) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  await pinStoreQuality(context);
  await context.addInitScript(timeControlSource());
  const page = await context.newPage();
  // At the fixed high tier a 2560x1440 frame takes swiftshader longer than Playwright's default
  // 30 s to draw, and a screenshot waits for one.
  page.setDefaultTimeout(180_000);
  try {
    return await fn(page);
  } finally {
    await releaseKeys(page);
    await context.close();
  }
}

async function save(store, file, bytes) {
  const full = path.join(OUT[store], file);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return full;
}

// The kangaroo at the top of a bound — feet tucked, tail out — turned three-quarters to face left,
// towards the name in the side-by-side layouts.
const roo = imageDataUri(await renderModel(browser, server.base, { clip: 'run', t: 0.7, yaw: 40, pitch: 6, size: 1400 }));

/**
 * A frame of the real game with the interface hidden, at `size`.
 *
 * Held clock, menus driven at 1280x720, the window grown only for the frame itself. Measured with
 * the clock running: at 3840x1240 the page was too busy drawing to take a click ("Got it" timed
 * out with the button visible, enabled and stable), and at the fixed high tier one 2560x1440
 * screenshot took 29.6 s.
 */
async function cleanFrame(size, mode, map, { self = true } = {}) {
  try {
    return await withPage({ width: 1280, height: 720 }, async (page) => {
      await enterMatch(page, server.base, mode, problem, map, { held: true });
      await hideInterface(page);
      if (!self) await hideSelf(page);
      if (!(await rollPastCountdown(page))) problem(`${mode} on ${map}: the round never left its countdown`);
      return await captureBestHeldFrame(page, size, 5);
    });
  } catch (error) {
    problem(`gameplay frame ${size.width}x${size.height}: ${String(error).split('\n')[0]}`);
    return null;
  }
}

console.log('pack:pc:listing — gameplay frames (slow under swiftshader)…');
// Without the player's own kangaroo: the covers draw a kangaroo over this frame, and the third-person
// camera puts the player's, from behind, right where the vertical layouts stand the rendered one.
const backdropFrame = await cleanFrame({ width: 2560, height: 1440 }, 'Kangaroo Chase', 'Jungle World', { self: false });
const heroFrame = await cleanFrame({ width: 3840, height: 1240 }, 'Kangaroo Chase', 'Glacier World');
// The backdrop is darkened under the name, so JPEG keeps it small enough to inline without loss anyone could see.
const backdrop = backdropFrame
  ? await withPage({ width: 64, height: 64 }, async (page) => `data:image/jpeg;base64,${(await toJpeg(page, backdropFrame, 0.9)).toString('base64')}`)
  : null;

console.log('pack:pc:listing — key art…');
for (const spec of ART) {
  try {
    const full = await withPage({ width: spec.width, height: spec.height }, async (page) => {
      if (spec.kind === 'hero') {
        if (!heroFrame) throw new Error('no gameplay frame to draw it from');
        return save(spec.store, spec.file, encodePngRGB(decodePng(heroFrame)));
      }
      if (spec.kind === 'cover') await renderCover(page, roo, { veryWide: spec.layout === 'row', backdrop });
      else await renderLogo(page, roo, { backdrop: spec.alpha ? null : backdrop, transparent: Boolean(spec.alpha), fill: spec.fill });
      const shot = await page.screenshot({ animations: 'disabled', omitBackground: Boolean(spec.alpha) });
      if (spec.file.endsWith('.jpg')) return save(spec.store, spec.file, await toJpeg(page, shot, 0.92));
      return save(spec.store, spec.file, spec.alpha ? encodePng(decodePng(shot)) : encodePngRGB(decodePng(shot)));
    });
    written.push({ ...(await verify(spec.store, full, spec)), note: spec.kind });
  } catch (error) {
    problem(`${spec.store}/${spec.file}: ${String(error).split('\n')[0]}`);
  }
}

// Icons: the shortcut icon needs no browser; the app icon is a JPG, which only the browser encodes.
if (icon) {
  written.push({ ...(await verify('steam', await writeShortcutIcon(), { width: 512, height: 512 })), note: 'shortcut icon' });
  const jpg = await withPage({ width: 64, height: 64 }, (page) => toJpeg(page, encodePngRGB(iconImage(184)), 0.95));
  written.push({ ...(await verify('steam', await save('steam', 'icons/app_icon.jpg', jpg), { width: 184, height: 184 })), note: 'app icon' });
}

// Screenshots: the HUD stays on — it is what the player sees — and nothing is drawn over the frame.
for (const shot of ART_ONLY ? [] : SHOTS) {
  console.log(`pack:pc:listing — screenshot: ${shot.mode}${shot.map ? ` on ${shot.map}` : ''}`);
  try {
    const frame = await withPage({ width: 1280, height: 720 }, async (page) => {
      await enterMatch(page, server.base, shot.mode, problem, shot.map, { held: true });
      if (!(await rollPastCountdown(page))) problem(`${shot.mode} on ${shot.map}: the round never left its countdown`);
      return captureBestHeldFrame(page, SHOT_SIZE);
    });
    const png = await save('steam', `screenshots/${shot.name}.png`, encodePngRGB(decodePng(frame)));
    written.push({ ...(await verify('steam', png, SHOT_SIZE)), note: shot.mode });
    const jpg = await withPage({ width: 64, height: 64 }, (page) => toJpeg(page, frame, 0.92));
    const full = await save('epic', `carousel/${shot.name}.jpg`, jpg);
    written.push({ ...(await verify('epic', full, { ...SHOT_SIZE, maxBytes: CAROUSEL_MAX })), note: shot.mode });
  } catch (error) {
    problem(`${shot.name}: ${String(error).split('\n')[0]}`);
  }
}

await browser.close();
await server.close();
report();

function report(extra) {
  if (written.length > 0) {
    console.log(`\nWrote ${written.length} files to packaging/steam/listing/ and packaging/epic/listing/`);
    for (const w of written) {
      console.log(`  ${w.name.padEnd(42)} ${`${w.width}x${w.height}`.padEnd(10)} ${(w.bytes / 1024).toFixed(0).padStart(6)} KB  ${w.note ?? ''}`);
    }
    console.log('\nCopy, tags and what each store still needs from an account holder: docs/PC_LISTINGS.md.');
  }
  if (extra && problems.length === 0) console.log(`\n${extra}`);
  if (problems.length > 0) {
    console.error(`\n\x1b[31m${problems.length} problem(s):\x1b[0m`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  }
}
