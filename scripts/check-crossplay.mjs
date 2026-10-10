#!/usr/bin/env node
/**
 * Prove a PC player and a browser player can play in the same room.
 *
 * Until this, they could not, and nothing said so. A Steam or Epic install serves the game from a
 * server bundled into the app on `127.0.0.1`, and the page connected to whatever served it — so
 * every PC player was alone on their own computer, and the hosted server where browser players
 * meet never saw one of them. `docs/PC_LISTINGS.md` and the store copy had to call online play a
 * promise for release.
 *
 * Three processes, laid out as they ship: the hosted server (serving the browser build, with
 * `KC_ALLOWED_ORIGINS` set as a production server sets it), and a PC build's bundled server
 * pointed at it with `KC_ONLINE_ORIGIN` — the variable `main.cjs` sets, which `check:shell`
 * proves. Two browser pages: one loads the game from the bundled server like the Electron window
 * does, one loads the hosted origin like a browser player. Everything is done by clicking what a
 * player clicks, and what is read back is what a player can read: the room code and player count
 * in the HUD.
 *
 * Then the hosted server goes away, and the PC page must still start — on the server it carries,
 * saying why.
 *
 * Usage: npm run build && npm run check:crossplay
 */

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('check:crossplay — playwright is not installed; skipping.');
  process.exit(0);
}

const HOSTED_PORT = 8897;
const PC_PORT = 8898;
const hosted = `http://127.0.0.1:${HOSTED_PORT}`;
const pc = `http://127.0.0.1:${PC_PORT}`;

const logs = [];
const children = [];
// A run killed by a timeout must not leave a server on the port for the next run to test.
process.on('exit', () => children.forEach((c) => c.kill()));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    children.forEach((c) => c.kill());
    process.exit(1);
  });
}

function server(name, port, env) {
  const data = `/tmp/kc-crossplay-${name}`;
  rmSync(data, { recursive: true, force: true });
  const child = spawn(process.execPath, ['dist/server/main.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', KC_DATA_DIR: data, KC_PUBLIC_DIR: path.resolve('dist/client'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(`[${name}] ${d}`));
  child.stderr.on('data', (d) => logs.push(`[${name}] ${d}`));
  children.push(child);
  return child;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function up(base) {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`${base} did not start`);
}
const rooms = async (base) => (await (await fetch(`${base}/api/health`)).json()).rooms;

const hostedServer = server('hosted', HOSTED_PORT, { KC_ALLOWED_ORIGINS: hosted });
server('pc', PC_PORT, { KC_ONLINE_ORIGIN: hosted });
await up(hosted);
await up(pc);

const errors = [];
const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] };
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(launch);

async function player(name, base) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  // Two games rendering in software starve each other (see check:party); nothing here is pixels.
  await context.addInitScript(() => {
    localStorage.setItem(
      'kc.settings.v1',
      JSON.stringify({ graphics: { quality: 'low', shadows: false, postProcessing: false, renderScale: 0.5, sceneryDetail: 0.25 } }),
    );
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('console', (m) => {
    // The fallback stage takes the hosted server away on purpose; its refused requests are the
    // point, not a failure.
    if (m.type() === 'error' && !stage.expectRefusals) errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(base, { waitUntil: 'load' });
  await enterName(page, name);
  return page;
}

async function enterName(page, name) {
  await page.locator('input[placeholder="Your name"]').waitFor();
  await page.locator('input[placeholder="Your name"]').fill(name);
  await page.locator('button', { hasText: 'Start' }).first().click();
  await sleep(2400);
  if (await page.locator('button', { hasText: 'Got it' }).count()) {
    await page.locator('button', { hasText: 'Got it' }).first().click();
    await sleep(800);
  }
}

const stage = { expectRefusals: false };
const text = (page) => page.evaluate(() => document.body.innerText);
const roomOf = async (page) => ((await text(page)).match(/KANG-[A-Z0-9]{4}/) ?? [])[0] ?? null;
async function until(label, test, deadlineMs = 15_000) {
  const start = Date.now();
  for (;;) {
    if (await test()) return Date.now() - start;
    if (Date.now() - start > deadlineMs) {
      errors.push(`${label}: not within ${deadlineMs / 1000}s`);
      return -1;
    }
    await sleep(250);
  }
}
const step = (line) => console.log(`· ${line}`);

/**
 * Stop at the first stage that did not happen, saying what the player saw. Every later stage
 * measures through the earlier ones, so carrying on only buries the cause under timeouts.
 */
async function stop(reason) {
  errors.push(reason);
  console.log(`errors: ${errors.length}\n  - ${errors.join('\n  - ')}`);
  console.log('--- server log ---\n' + logs.join('').slice(-3000));
  await browser.close();
  process.exit(1);
}
const FELL_BACK = /online server could not be reached|do not match/;

step('1. A PC player opens a private room');
const pcPage = await player('SteamRoo', pc);
const seen = await text(pcPage);
if (FELL_BACK.test(seen)) await stop(`the PC page could not use the hosted server and fell back: "${seen.match(FELL_BACK)?.[0]}"`);
await pcPage.locator('button', { hasText: 'Private room' }).first().click();
await sleep(400);
await pcPage.locator('button', { hasText: 'Create a private room' }).first().click();
let code = null;
await until('the PC player gets a room code', async () => (code = await roomOf(pcPage)) !== null);
console.log(`  room ${code} · rooms on the hosted server ${await rooms(hosted)}, on the bundled one ${await rooms(pc)}`);
if ((await rooms(pc)) !== 0) await stop('the PC player opened their room on the bundled server, where nobody else can reach it');
if (!code) await stop('the PC player never got a room code');

step('2. A browser player joins it by code');
const webPage = await player('WebRoo', hosted);
await webPage.locator('button', { hasText: 'Private room' }).first().click();
await sleep(400);
await webPage.locator('input[type=text]').first().fill(code ?? '');
await webPage.locator('button', { hasText: 'Join room' }).first().click();
await until('the browser player is in the same room', async () => (await roomOf(webPage)) === code);
const metMs = await until('the PC player sees them arrive', async () => (await text(pcPage)).includes(`${code} (private) · 2 players`), 10_000);
if (metMs < 0) await stop('the two players never ended up in one room');

step('3. The hosted server goes away; the PC build still starts');
stage.expectRefusals = true;
hostedServer.kill();
await sleep(500);
const reloadStart = Date.now();
await pcPage.reload({ waitUntil: 'load' });
// No session on the bundled server yet, but the name was chosen once and is not asked for again:
// straight to the menu, with the reason on it.
await until('the PC page says why it is playing alone', async () => /online server could not be reached/.test(await text(pcPage)));
const fallbackMs = Date.now() - reloadStart;
await until('the PC player is in the menu on the bundled server', async () => (await pcPage.locator('button', { hasText: 'Practice with bots' }).count()) > 0);
if ((await pcPage.locator('input[placeholder="Your name"]').count()) > 0) errors.push('the PC player was asked for their name again');
// One session per server: the hosted one from stage 1, and one the bundled server just issued.
const kept = await pcPage.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('kc.session')).sort());
console.log(`  sessions kept: ${kept.join(', ')}`);
if (!kept.includes('kc.session.v1') || !kept.includes(`kc.session.v1@${hosted}`)) errors.push(`expected a session for each server, found: ${kept.join(', ')}`);
// Its rooms have no bots and nobody else can reach them: the menu must not offer them as play.
for (const label of ['Play', 'Friends & party']) {
  if ((await pcPage.locator('.kc-menu button', { hasText: new RegExp(`^${label}$`) }).count()) > 0) errors.push(`the fallback menu still offers "${label}"`);
}
if (!/online server could not be reached/.test(await text(pcPage))) errors.push('the fallback menu does not say why it is offline');
await pcPage.screenshot({ path: process.env.KC_CROSSPLAY_SHOT ?? '/tmp/kc-crossplay-fallback.png' });

console.log(`timings: met after ${metMs} ms · fallback screen ${fallbackMs} ms after reload`);
await browser.close();
console.log(`errors: ${errors.length}${errors.length ? `\n  - ${errors.join('\n  - ')}` : ''}`);
if (errors.length) console.log('--- server log ---\n' + logs.join('').slice(-3000));
process.exit(errors.length === 0 ? 0 : 1);
