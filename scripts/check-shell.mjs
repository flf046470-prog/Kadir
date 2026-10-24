#!/usr/bin/env node
/**
 * Prove the PC build's launcher keeps a player's game from one launch to the next, and sends them
 * online.
 *
 * `main.cjs` is the one file between the Steam/Epic player and everything the unit suite covers,
 * and nothing ran it: it needs Electron, which is a 200 MB download per platform that no CI
 * machine makes. So it went unexercised while it asked the OS for a new port on every launch —
 * a new origin, so empty storage — and handed the server a new random session secret, so the
 * token the page kept was dead anyway. Measured over three launches: asked for a name three times,
 * three accounts, everything earned on the one before unreachable.
 *
 * Electron here is a stand-in written to a temporary `node_modules`: `app`, `BrowserWindow`,
 * `dialog`, `Menu` and `shell` with exactly the methods `main.cjs` calls, recording what it was
 * asked to do. Everything else is real: the packed app directory, the shell bundle, the server it
 * spawns, the HTTP calls a page makes.
 *
 * Usage: npm run build && npm run check:shell
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const HOSTED = 'https://play.kangaroo.example';
const work = mkdtempSync(path.join(tmpdir(), 'kc-shell-'));
// Packed into the scratch folder: a copy with a test origin in it must never sit in
// `dist/steam-app`, which is what gets shipped.
const app = path.join(work, 'steam-app');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The app directory exactly as it ships, packed from this build.
const pack = spawnSync(process.execPath, [path.join(root, 'scripts', 'pack-steam.mjs'), '--online', HOSTED, '--out', app], { cwd: root, encoding: 'utf8' });
if (pack.status !== 0) {
  console.error(pack.stdout, pack.stderr);
  console.error('check:shell — pack:steam refused to pack (its reasons are above; a missing dist/ needs `npm run build`).');
  process.exit(1);
}

const userData = path.join(work, 'userData');
const fake = path.join(work, 'node_modules', 'electron');
mkdirSync(fake, { recursive: true });
writeFileSync(
  path.join(fake, 'index.js'),
  `'use strict';
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const log = (event) => fs.appendFileSync(process.env.KC_FAKE_LOG, JSON.stringify(event) + '\\n');
class App extends EventEmitter {
  getPath(name) {
    if (name !== 'userData') throw new Error('unexpected getPath(' + name + ')');
    return process.env.KC_FAKE_USERDATA;
  }
  whenReady() { return Promise.resolve(); }
  requestSingleInstanceLock() { return true; }
  quit() {
    if (this.quitting) return;
    this.quitting = true;
    this.emit('before-quit');
    log({ quit: true });
    setTimeout(() => process.exit(0), 100);
  }
}
const app = new App();
process.on('SIGTERM', () => app.quit());
class BrowserWindow {
  constructor() { this.webContents = { setWindowOpenHandler() {}, executeJavaScript: async () => {} }; }
  once() {}
  isMinimized() { return false; }
  restore() {}
  focus() {}
  loadURL(url) { log({ loadURL: url }); return Promise.resolve(); }
}
module.exports = {
  app,
  BrowserWindow,
  dialog: { showErrorBox: (title, message) => log({ errorBox: message }), showMessageBox: async () => ({}) },
  Menu: { setApplicationMenu() {}, buildFromTemplate: (template) => template },
  shell: { openExternal: async () => {} },
};
`,
);

/** One launch: start the launcher, wait for the window it opens, hand back its URL and a way to quit. */
async function launch(name, env = {}) {
  const logFile = path.join(work, `${name}.log`);
  const child = spawn(process.execPath, [path.join(app, 'main.cjs')], {
    cwd: app,
    env: {
      ...process.env,
      NODE_PATH: path.join(work, 'node_modules'),
      KC_FAKE_LOG: logFile,
      KC_FAKE_USERDATA: userData,
      KC_SESSION_SECRET: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (d) => output.push(String(d)));
  child.stderr.on('data', (d) => output.push(String(d)));
  process.on('exit', () => child.kill('SIGKILL'));
  for (let i = 0; i < 200; i++) {
    const events = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const opened = events.find((e) => e.loadURL);
    const failed = events.find((e) => e.errorBox);
    if (failed) throw new Error(`${name}: launcher reported "${failed.errorBox}"\n${output.join('')}`);
    if (opened) {
      return {
        url: opened.loadURL.replace(/\/$/, ''),
        child,
        quit: async () => {
          child.kill('SIGTERM');
          await new Promise((r) => child.once('exit', r));
        },
      };
    }
    await sleep(100);
  }
  throw new Error(`${name}: no window opened within 20 s\n${output.join('')}`);
}

async function answers(url) {
  try {
    return (await fetch(`${url}/api/health`)).ok;
  } catch {
    return false;
  }
}

try {
  console.log('check:shell — the PC launcher, twice, with one user folder');

  // Launch 1: a first-time player creates their account, as the name screen does.
  const first = await launch('first');
  const page = await (await fetch(`${first.url}/`)).text();
  check(page.includes(`<meta name="kc-online-origin" content="${HOSTED}"`), `the page it serves is told to play online on ${HOSTED}`);
  const guest = await (await fetch(`${first.url}/api/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Skippy' }) })).json();
  check(typeof guest.token === 'string', 'a first-time player gets an account on the bundled server');
  await first.quit();
  await sleep(300);
  check(!(await answers(first.url)), 'quitting the launcher stops the server it started');

  // Launch 2: same player, same computer.
  const second = await launch('second');
  check(second.url === first.url, `the second launch serves the game from the same origin (${first.url} → ${second.url})`);
  const profile = await fetch(`${second.url}/api/profile`, { headers: { authorization: `Bearer ${guest.token}` } });
  const body = profile.ok ? await profile.json() : null;
  check(profile.status === 200 && body?.profile?.name === 'Skippy', `the token kept from the first launch still opens the same account (HTTP ${profile.status})`);

  // A launcher killed outright — a crash, or Task Manager — must not leave its server on the port.
  const server = Number(spawnSync('pgrep', ['-P', String(second.child.pid)], { encoding: 'utf8' }).stdout.trim().split('\n')[0]);
  second.child.kill('SIGKILL');
  await sleep(1500);
  const orphaned = await answers(second.url);
  check(!orphaned, 'a launcher that is killed outright takes its server with it');
  // Failing that, do not leave the orphan for the next run to trip over.
  if (orphaned && server) process.kill(server, 'SIGKILL');

  // And a tester can run the packed build offline-only without repacking it.
  const offline = await launch('offline', { KC_ONLINE_ORIGIN: '' });
  check(offline.url === first.url, 'the launch after a crash is still on the same origin');
  check(!(await (await fetch(`${offline.url}/`)).text()).includes('kc-online-origin'), 'KC_ONLINE_ORIGIN= runs the packed build offline-only');
  await offline.quit();
} catch (error) {
  failures.push(String(error.message ?? error));
  console.error(error);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\ncheck:shell — ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\ncheck:shell — passed');
