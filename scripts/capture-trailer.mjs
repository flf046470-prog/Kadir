#!/usr/bin/env node
/**
 * Drive the real game in a browser and capture frames for a trailer.
 *
 * A trailer made from the actual build is the only kind worth having: it cannot show a feature
 * that does not exist, and it goes stale the moment the game does, which is the point. Nothing
 * here is staged — it plays the game through the same path a player takes, and screenshots what
 * comes out.
 *
 * Frames land as PNGs; `tools/make-gif.py` assembles them, because encoding a GIF in Node without
 * a dependency is a worse use of an afternoon than shelling out to Pillow.
 *
 * Usage: npm run build && npm run capture:trailer
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('capture:trailer — playwright is not installed; skipping.');
  process.exit(0);
}

const OUT = path.resolve('dist/trailer/frames');
const PORT = 8912;
const WIDTH = 960;
const HEIGHT = 540;
/** 12 fps is plenty for a loop and keeps a GIF under a few megabytes. */
const FPS = 12;

rmSync(path.dirname(OUT), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    KC_DATA_DIR: '/tmp/kc-trailer',
    KC_PUBLIC_DIR: path.resolve('dist/client'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(base);
    if (r.ok) break;
  } catch {}
  await sleep(150);
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
const page = await (await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })).newPage();

let frame = 0;
const shoot = async () => {
  await page.screenshot({ path: path.join(OUT, `f${String(frame++).padStart(4, '0')}.png`) });
};
/**
 * Capture for `seconds`, turning the camera a little between every frame.
 *
 * The turn has to happen *inside* the loop. The first version panned first and then recorded, so
 * the camera was already still by the time anything was captured — measuring the result showed
 * twelve of twenty-five sampled frames identical to the one before, which is not a trailer, it is
 * a slideshow with a long exposure. `turn` is the total degrees-ish to sweep across the whole
 * take, dealt out one step per frame.
 */
/**
 * A virtual cursor, moved relatively and never re-centred.
 *
 * The game holds pointer lock during a match, so the camera follows mouse *deltas* and the
 * absolute position is meaningless. The first version re-centred before each frame's drag —
 * `move(centre)`, `down()`, `move(centre + step)`, `up()` — and under pointer lock that first
 * call is itself a delta, back to the centre from wherever the cursor was. Across 170 frames the
 * asymmetry accumulated: the camera drifted upwards until the horizon sat 63% down the frame and
 * two thirds of the trailer was empty sky. Neutral framing puts it at 18%.
 */
let cursorX = WIDTH / 2;
let cursorY = HEIGHT / 2;

const record = async (seconds, turn = 0, rise = 0) => {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const stepX = turn / frames;
  const stepY = rise / frames;
  for (let i = 0; i < frames; i++) {
    if (stepX !== 0 || stepY !== 0) {
      cursorX += stepX;
      cursorY += stepY;
      await page.mouse.move(cursorX, cursorY);
    }
    await shoot();
    await sleep(1000 / FPS);
  }
};

await page.goto(base, { waitUntil: 'load' });
await sleep(1500);
await page.locator('input[type=text]').first().fill('Kadir');
await page.locator('button', { hasText: 'Start' }).first().click();
await sleep(2500);
if (await page.locator('button', { hasText: 'Got it' }).count()) {
  await page.locator('button', { hasText: 'Got it' }).first().click();
  await sleep(1200);
}

// The menu, briefly — it establishes that this is a game and not a tech demo.
await record(1.2);

await page.locator('button', { hasText: 'Practice with bots' }).first().click();
await sleep(6500);

/**
 * A lap of the clearing, not a straight line out of it.
 *
 * The first route held W for two sprints and the player left the jungle entirely, arriving in the
 * cave — which is deliberately dark, at 0.75 zone darkness — around frame 55 and staying there for
 * the remaining two thirds of the take. Measured across the frames, mean brightness dropped from
 * ~145 to ~52 and never recovered. Nothing was broken; the camera had simply walked out of the
 * part of the map worth filming. Short bursts with a turn between each keep it in the clearing.
 */
await record(1.6, 45); // the world at the start, drifting right

await page.keyboard.down('w');
await record(1.3, -60);
await page.keyboard.up('w');
await record(0.8, 110);

// A hop, the thing the game is named after.
await page.keyboard.down('Space');
await sleep(120);
await page.keyboard.up('Space');
await record(1.2, 20);

await page.keyboard.down('w');
await record(1.4, 130);
await page.keyboard.up('w');
await record(0.9, 40);

// A sprint, short enough to stay among the trees.
await page.keyboard.down('w');
await page.keyboard.down('Shift');
await record(1.5, -150);
await page.keyboard.up('Shift');
await page.keyboard.up('w');
await record(1.0, -40);

await page.keyboard.down('Space');
await sleep(120);
await page.keyboard.up('Space');
await record(1.1, 60);

await page.keyboard.down('w');
await record(1.2, 140);
await page.keyboard.up('w');
await record(1.4, 90);

console.log(`${frame} frames at ${WIDTH}x${HEIGHT} → ${path.relative(process.cwd(), OUT)}`);
console.log(`assemble with: python3 tools/make-gif.py ${path.relative(process.cwd(), OUT)} dist/trailer/kangaroo-chase-trailer.gif --fps ${FPS}`);

await browser.close();
server.kill();
