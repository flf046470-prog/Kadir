#!/usr/bin/env node
/**
 * Prove the lobby shows the other player and that Ready reaches them.
 *
 * A room code is only half of playing with a friend. Before this, a host read out four characters
 * and then both people watched a status line that said "2 players" — with no way to tell whether
 * the second was the friend they invited or a stranger, and no way to say "I'm here, start".
 *
 * The server had stored a `ready` flag per client since the protocol was written. `handleReady`
 * set it on every request and *nothing read it*: it was never sent to anyone, never rendered, and
 * never used to decide anything. A feature wired end to end into a value no one could observe.
 *
 * So the assertions here are about what the *other* player sees, which is the only thing that
 * makes a lobby a lobby: a name arriving, and a tick crossing the wire.
 *
 * Usage: npm run build && npm run check:lobby
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('check:lobby — playwright is not installed; skipping.');
  process.exit(0);
}

const PORT = 8896;
const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    KC_DATA_DIR: '/tmp/kc-lobby',
    KC_PUBLIC_DIR: path.resolve('dist/client'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
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
const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(launch);

async function player(name) {
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 640 } })).newPage();
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
    await sleep(1000);
  }
  return page;
}

const host = await player('Ayse');
const guest = await player('Kerem');

await host.locator('button', { hasText: 'Private room' }).first().click();
await sleep(500);
await host.locator('button', { hasText: 'Create a private room' }).first().click();
await sleep(4500);
const code = ((await host.evaluate(() => document.body.innerText)).match(/KANG-[A-Z0-9]{4}/) ?? [])[0] ?? null;
console.log(`room code: ${code ?? 'NONE'}`);
if (!code) errors.push('host never got a room code');

if (code) {
  await guest.locator('button', { hasText: 'Private room' }).first().click();
  await sleep(500);
  await guest.locator('input[type=text]').first().fill(code);
  await guest.locator('button', { hasText: 'Join room' }).first().click();
  await sleep(5000);

  /**
   * Open the lobby the way a desktop player does, and read it back.
   *
   * Tab, not the Players button. Both exist and both are correct, but the button cannot be the
   * desktop route: pointer lock swallows every mouse event for the whole match, so the control
   * that would release the cursor is itself behind the cursor. Measured with a real
   * browser-level click at the button's own coordinates — zero reached the handler while locked,
   * and the identical click landed immediately after `exitPointerLock`. The panel's own buttons
   * are clickable, because opening it gives the cursor back, and that is asserted below by
   * clicking Ready.
   */
  const openLobby = async (page, label) => {
    if ((await page.locator('.kc-topbar button', { hasText: 'Players' }).count()) === 0) {
      errors.push(`[${label}] no Players button — the lobby never became reachable`);
      return '';
    }
    if ((await page.locator('.kc-lobby:not(.kc-hidden)').count()) === 0) await page.keyboard.press('Tab');
    await sleep(600);
    if ((await page.locator('.kc-lobby:not(.kc-hidden)').count()) === 0) {
      errors.push(`[${label}] Tab did not open the player list`);
      return '';
    }
    return (await page.locator('.kc-lobby').first().innerText()) ?? '';
  };

  const hostLobby = await openLobby(host, 'host');
  const guestLobby = await openLobby(guest, 'guest');
  console.log(`host sees:  ${JSON.stringify(hostLobby.replace(/\n/g, ' | '))}`);
  console.log(`guest sees: ${JSON.stringify(guestLobby.replace(/\n/g, ' | '))}`);

  // Each must see the *other* by name. Seeing only yourself is what "2 players" already told you.
  if (!hostLobby.includes('Kerem')) errors.push('host cannot see the guest by name in the lobby');
  if (!guestLobby.includes('Ayse')) errors.push('guest cannot see the host by name in the lobby');
  if (!hostLobby.includes('(you)')) errors.push('host cannot tell which row is their own');

  // Ready, and prove it crossed to the other player rather than only lighting up locally.
  const beforeOnHost = hostLobby;
  await guest.locator('.kc-lobby button', { hasText: "I'm ready" }).first().click();
  await sleep(2500);
  const afterOnHost = (await host.locator('.kc-lobby').first().innerText()) ?? '';
  console.log(`host after guest readies: ${JSON.stringify(afterOnHost.replace(/\n/g, ' | '))}`);

  if (afterOnHost === beforeOnHost) errors.push("the guest pressing Ready changed nothing on the host's screen");
  if (!/1\/2 ready/.test(afterOnHost)) {
    errors.push(`host does not show 1/2 ready after the guest readied: ${JSON.stringify(afterOnHost)}`);
  }

  // And that it clears again, so the flag is a state rather than a one-way latch.
  await guest.locator('.kc-lobby button', { hasText: 'Not ready' }).first().click();
  await sleep(2500);
  const cleared = (await host.locator('.kc-lobby').first().innerText()) ?? '';
  if (!/0\/2 ready/.test(cleared)) errors.push(`ready did not clear on the host: ${JSON.stringify(cleared)}`);
}

await browser.close();
server.kill();

console.log(`console errors: ${errors.length}${errors.length ? `\n  - ${errors.join('\n  - ')}` : ''}`);
if (errors.length) console.log('--- server log ---\n' + serverLog.join(''));
process.exit(errors.length === 0 ? 0 : 1);
