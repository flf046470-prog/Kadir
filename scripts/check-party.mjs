#!/usr/bin/env node
/**
 * Prove friends and parties work between two real players, through the real menus.
 *
 * The unit suite covers the rules; it cannot cover the loop that makes a party worth having: two
 * people who met in a room add each other from the Players screen, one invites the other, and when
 * the leader moves to a new room the member's client *follows on its own*. That path runs through
 * the poller, the follow rule, a socket being closed and another opened, and the server's own
 * matchmaking — none of which a unit test exercises together.
 *
 * Two browser pages, one server. Every step is done by clicking what a player clicks, and the only
 * thing read back is what the player can read on screen: the room code in the HUD.
 *
 * Usage: npm run build && npm run check:party
 */

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('check:party — playwright is not installed; skipping.');
  process.exit(0);
}

const PORT = 8895;
const DATA = '/tmp/kc-party';
rmSync(DATA, { recursive: true, force: true });
const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KC_DATA_DIR: DATA, KC_PUBLIC_DIR: path.resolve('dist/client') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
// A run killed by a timeout used to leave this child listening, and the next run then talked to
// the stale server — which is exactly how a check ends up testing yesterday's build.
process.on('exit', () => server.kill());
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.kill();
    process.exit(1);
  });
}
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await sleep(150);
}

const errors = [];
const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] };
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(launch);

async function player(name) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  // Two games rendering in software at once starve each other's main thread: measured, a single
  // `evaluate` took up to 3.3 s at default quality, and a click waiting for a stable element timed
  // out. Nothing here is about pixels, so both players run the lowest settings the game offers.
  await context.addInitScript(() => {
    localStorage.setItem(
      'kc.settings.v1',
      JSON.stringify({ graphics: { quality: 'low', shadows: false, postProcessing: false, renderScale: 0.5, sceneryDetail: 0.25 } }),
    );
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(base, { waitUntil: 'load' });
  await sleep(1400);
  await page.locator('input[type=text]').first().fill(name);
  await page.locator('button', { hasText: 'Start' }).first().click();
  await sleep(2400);
  if (await page.locator('button', { hasText: 'Got it' }).count()) {
    await page.locator('button', { hasText: 'Got it' }).first().click();
    await sleep(800);
  }
  return page;
}

/** The room code the player can see — the HUD status line or lobby names it. */
const roomOf = async (page) => ((await page.evaluate(() => document.body.innerText)).match(/KANG-[A-Z0-9]{4}/) ?? [])[0] ?? null;

const step = (text) => console.log(`· ${text}`);

/** Wait for a condition, polling, and say how long it took; fail at the deadline. */
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

async function createPrivateRoom(page) {
  await page.locator('button', { hasText: 'Private room' }).first().click();
  await sleep(400);
  await page.locator('button', { hasText: 'Create a private room' }).first().click();
  let code = null;
  await until('host gets a room code', async () => (code = await roomOf(page)) !== null);
  return code;
}

async function menu(page, entry) {
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.locator('button', { hasText: entry }).first().click();
  await sleep(500);
}

const host = await player('PartyHost');
const guest = await player('PartyGuest');

step('1. Meet');
// 1. Meet: one private room, both in it.
const first = await createPrivateRoom(host);
await guest.locator('button', { hasText: 'Private room' }).first().click();
await sleep(400);
await guest.locator('input[type=text]').first().fill(first ?? '');
await guest.locator('button', { hasText: 'Join room' }).first().click();
await until('guest joins the first room', async () => (await roomOf(guest)) === first);

step('2. Add each other');
// 2. Add each other, from the Players screen and the Friends screen.
await menu(host, 'Players & safety');
await until('host sees the guest on the Players screen', async () => (await host.locator('.kc-safety-row', { hasText: 'PartyGuest' }).count()) > 0);
await host.locator('.kc-safety-row', { hasText: 'PartyGuest' }).locator('button', { hasText: 'Add friend' }).first().click();
await until('host sees "Request sent"', async () => (await host.locator('.kc-safety-row', { hasText: 'Request sent' }).count()) > 0, 6_000);

await menu(guest, 'Friends & party');
const requestMs = await until('guest receives the request', async () => (await guest.locator('button', { hasText: 'Accept' }).count()) > 0);
await guest.locator('.kc-safety-row', { hasText: 'PartyHost' }).locator('button', { hasText: 'Accept' }).first().click();
await until('guest lists the host as a friend', async () => (await guest.locator('.kc-safety-row', { hasText: 'PartyHost' }).locator('button', { hasText: 'Remove' }).count()) > 0, 6_000);

step('3. A party');
// 3. A party: the host starts one by inviting the guest, the guest accepts.
await host.locator('button', { hasText: 'Back' }).first().click();
await sleep(300);
await host.locator('button', { hasText: 'Friends & party' }).first().click();
const friendMs = await until('host lists the guest as a friend', async () => (await host.locator('button', { hasText: 'Start a party' }).count()) > 0);
await host.locator('button', { hasText: 'Start a party' }).first().click();
const inviteMs = await until('guest receives the party invite', async () => (await guest.locator('button', { hasText: 'Join party' }).count()) > 0);
await guest.locator('button', { hasText: 'Join party' }).first().click();
await until('guest is in the party', async () => (await guest.locator('text=Your party (2/8)').count()) > 0, 6_000);
const shot = process.env.KC_PARTY_SHOT ?? '/tmp/kc-party-friends.png';
await guest.screenshot({ path: shot });
await host.screenshot({ path: shot.replace(/\.png$/, '-host.png') });

step('4. The leader moves');
// 4. The leader moves to a new room; the member follows without touching anything.
await host.locator('button', { hasText: 'Back' }).first().click();
await sleep(300);
await host.locator('button', { hasText: 'Leave match' }).first().click();
await sleep(600);
const second = await createPrivateRoom(host);
if (second === first) errors.push('host created the same room twice');
const followMs = await until('guest follows the leader into the new room', async () => (await roomOf(guest)) === second, 20_000);

step('5. And the member');
// 5. And the member is really in it: the host's own status line counts them.
await until('the host sees the guest arrive', async () => (await host.evaluate(() => document.body.innerText)).includes(`${second} (private) · 2 players`), 10_000);

console.log(`rooms: first=${first} second=${second} · guest now in ${await roomOf(guest)}`);
console.log(
  `timings: request arrived ${requestMs} ms · friend shown ${friendMs} ms · invite arrived ${inviteMs} ms · follow ${followMs} ms`,
);

await browser.close();
server.kill();
console.log(`errors: ${errors.length}${errors.length ? `\n  - ${errors.join('\n  - ')}` : ''}`);
if (errors.length) console.log('--- server log ---\n' + serverLog.join('').slice(-3000));
process.exit(errors.length === 0 ? 0 : 1);
