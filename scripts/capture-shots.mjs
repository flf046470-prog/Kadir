#!/usr/bin/env node
/**
 * Capture still screenshots of the real build — the ones a store listing and a README need.
 *
 * Separate from `capture:trailer` because they want opposite things. A trailer wants motion and
 * is judged across a sequence; a screenshot wants one composed, legible frame and is judged on its
 * own. Sharing a script would mean one set of camera moves serving neither.
 *
 * Every shot is taken by driving the game the way a player does — no debug camera, no posed
 * scene, nothing that can show a feature the build does not have.
 *
 * Each shot is scored before it is kept. That is not ceremony: the whole history of capturing
 * this game is frames that looked fine in a filename and were empty sky, a brown hillside, or the
 * inside of a rock. A shot with almost no edges in it is not a screenshot of a game, and this
 * refuses to hand one over silently.
 *
 * Usage: npm run build && npm run capture:shots
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('capture:shots — playwright is not installed; skipping.');
  process.exit(0);
}

const OUT = path.resolve('dist/shots');
const PORT = 8917;
const WIDTH = 1280;
const HEIGHT = 720;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    KC_DATA_DIR: '/tmp/kc-shots',
    KC_PUBLIC_DIR: path.resolve('dist/client'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await sleep(150);
}

const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })).newPage();

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const shots = [];
const shoot = async (name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(name);
  console.log(`  ${name}.png`);
};

/**
 * A virtual cursor, moved relatively and never re-centred.
 *
 * Under pointer lock the camera follows mouse *deltas*, so an absolute `move(centre)` is itself a
 * delta back from wherever the cursor was. Re-centring before each drag made the trailer's camera
 * drift upward until two thirds of every frame was sky; the same mistake would ruin these.
 */
let cursorX = WIDTH / 2;
let cursorY = HEIGHT / 2;
const look = async (dx, dy = 0, steps = 8) => {
  for (let i = 0; i < steps; i++) {
    cursorX += dx / steps;
    cursorY += dy / steps;
    await page.mouse.move(cursorX, cursorY);
    await sleep(40);
  }
};
/**
 * Click Back, exactly.
 *
 * `hasText: 'Back'` is a case-insensitive substring match, and the Customise screen has a
 * cosmetic slot called **backpack**. So the first "Back" on that screen was the backpack button:
 * every attempt to leave Customise opened a slot instead, and the run died thirty seconds later
 * looking for a menu it had never returned to.
 */
const back = () => page.locator('button', { hasText: /^Back$/ }).first().click();

const walk = async (key, ms) => {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  await sleep(400);
};

await page.goto(base, { waitUntil: 'load' });
await sleep(1600);
await page.locator('input[type=text]').first().fill('Kadir');
await page.locator('button', { hasText: 'Start' }).first().click();
await sleep(2600);
if (await page.locator('button', { hasText: 'Got it' }).count()) {
  await page.locator('button', { hasText: 'Got it' }).first().click();
  await sleep(1200);
}

// The menus, which are as much of the product as the world is.
await shoot('01-menu');

await page.locator('button', { hasText: 'Game modes' }).first().click();
await sleep(800);
await shoot('02-game-modes');
await back();
await sleep(500);

await page.locator('button', { hasText: 'Season pass' }).first().click();
await sleep(800);
await shoot('03-season-pass');
await back();
await sleep(500);

await page.locator('button', { hasText: 'Customise' }).first().click();
await sleep(900);
await shoot('04-customise');
await back();
await sleep(500);

// Into a real round against bots.
await page.locator('button', { hasText: 'Practice with bots' }).first().click();
await sleep(6500);
// Tilt down a little before anything is captured. Measured on the first pass: with the camera at
// its default pitch the horizon sat near the top of frame and roughly half of every world shot
// was flat sky, which scores well on brightness and shows nothing.
await look(0, 70, 6);
await shoot('05-jungle');

// Turn rather than travel. Measured across five earlier captures: the scenery is dense around the
// spawn and thins out in every direction, so a camera that covers ground ends up somewhere empty.
await look(240);
await shoot('06-clearing');

await walk('w', 420);
await look(-180, 20);
await shoot('07-chase');

// The hop the game is named after, caught at the top of its arc.
await page.keyboard.down('Space');
await sleep(130);
await page.keyboard.up('Space');
await sleep(220);
await shoot('08-hop');

await look(200, 20);
await walk('w', 380);
await shoot('09-undergrowth');

// The pause menu, on the same round it is pausing.
await page.keyboard.press('Escape');
await sleep(700);
await shoot('10-pause-menu');

/**
 * The lobby, in a real room rather than in solo practice.
 *
 * Practice against bots has no room and no lobby, so the panel there was headed "Room · public ·
 * 0/0 ready" over an empty list — a screenshot of a feature that was not running. A private room
 * with the host in it is the smallest honest version: a real code, a real row, a real count.
 */
await page.locator('button', { hasText: 'Leave match' }).first().click();
await sleep(900);
await page.locator('button', { hasText: 'Private room' }).first().click();
await sleep(600);
await page.locator('button', { hasText: 'Create a private room' }).first().click();
await sleep(5000);
// The camera resets on entering a new match, so it needs tilting down again here.
await look(0, 70, 6);
await page.keyboard.press('Tab');
await sleep(900);
if ((await page.locator('.kc-lobby:not(.kc-hidden)').count()) === 0) {
  errors.push('the lobby never opened in a private room');
} else {
  await shoot('11-lobby');
}

await browser.close();
server.kill();

console.log(`\n${shots.length} shots → ${path.relative(process.cwd(), OUT)}`);
if (errors.length) {
  console.log(`\n${errors.length} console error(s) while capturing:`);
  for (const e of errors.slice(0, 5)) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('score them with: python3 tools/frame-stats.py dist/shots');
