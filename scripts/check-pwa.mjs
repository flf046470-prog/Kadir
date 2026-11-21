#!/usr/bin/env node
/**
 * Drive the built client in a real browser and prove the PWA claims are true.
 *
 * Checking a manifest by reading it only proves it parses. What matters for a Horizon Store
 * listing is behaviour: the worker has to reach `activated`, and the app has to come back up
 * with the network gone — a headset launches the PWA from its library, not from a tab. So this
 * boots `dist/client`, waits for the worker, kills the server, and reloads.
 *
 * Playwright is not a declared dependency (it would pull a browser download into every CI run
 * for a check that is not part of `verify`), so this skips cleanly when it is absent.
 *
 * Usage: npm run build:client && npm run check:pwa
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist', 'client');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('check:pwa — playwright is not installed; skipping.');
  console.log('  npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

try {
  await readFile(path.join(DIST, 'index.html'));
} catch {
  console.error('check:pwa — dist/client is missing. Run `npm run build:client` first.');
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
    try {
      // SPA fallback, matching the rewrite in vercel.json.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(path.join(DIST, 'index.html')));
    } catch {
      res.writeHead(404).end('not found');
    }
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const launch = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {};
const browser = await chromium.launch(launch);
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();

const errors = [];
/**
 * Flipped once the server is deliberately closed.
 *
 * After that point the client's own calls to /api/* are *supposed* to fail — that is the whole
 * scenario — so a refused connection is the test working, not a defect. Everything else is still
 * collected: a real script error offline is exactly what this check exists to catch.
 */
let expectNetworkFailures = false;
const IGNORED_OFFLINE = /ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource/i;

page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (expectNetworkFailures && IGNORED_OFFLINE.test(m.text())) return;
  errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const manifest = JSON.parse(await readFile(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
console.log(`manifest       name="${manifest.name}" display=${manifest.display} icons=${manifest.icons.length}`);

const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { registered: false, state: 'none' };
  await navigator.serviceWorker.ready;
  return { registered: true, state: reg.active?.state ?? 'none' };
});
console.log(`service worker registered=${sw.registered} state=${sw.state}`);

const booted = ((await page.textContent('body')) ?? '').includes('Kangaroo Chase');
console.log(`boot           firstScreenRendered=${booted}`);

// The real test: no server at all, exactly like a headset launch with no Wi-Fi.
expectNetworkFailures = true;
await new Promise((resolve) => server.close(resolve));
let offline = false;
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
  offline = ((await page.textContent('body')) ?? '').includes('Kangaroo Chase');
} catch (error) {
  offline = false;
  errors.push(`offline reload: ${error.message.split('\n')[0]}`);
}
console.log(`offline        shellServedFromCache=${offline}`);

/**
 * With no server, the menu must offer only what can actually work.
 *
 * Booting offline is not the same as being usable offline. The menu used to show every online
 * entry point regardless: pressing Play sat on "Waiting for players (0/2)" forever, with nothing
 * on screen saying it never would. And until the catalogue was served locally, Game modes and
 * Customise were empty — a game that looked broken rather than one that looked offline.
 */
let menuHonest = false;
if (offline) {
  try {
    await page.fill('.kc-field input', 'Roo');
    await page.click('button.kc-btn--primary');
    await page.waitForTimeout(2500);
    const gotIt = page.getByRole('button', { name: 'Got it' });
    if (await gotIt.count()) {
      await gotIt.click();
      await page.waitForTimeout(1000);
    }

    const labels = await page.locator('.kc-root button:visible').allInnerTexts();
    const hasPlay = labels.some((l) => l.trim() === 'Play');
    const hasPractice = labels.some((l) => l.includes('Practice with bots'));

    // The catalogue has to come from the compiled-in registries, not the unreachable server.
    await page.getByRole('button', { name: 'Game modes' }).click();
    await page.waitForTimeout(800);
    const modeCards = await page.locator('.kc-root .kc-card').count();

    menuHonest = !hasPlay && hasPractice && modeCards > 0;
    console.log(`offline menu   play=${hasPlay ? 'OFFERED (wrong)' : 'hidden'} practice=${hasPractice} modes=${modeCards}`);
    if (hasPlay) errors.push('offline menu still offers Play, which can never fill a match');
    if (!hasPractice) errors.push('offline menu has no Practice with bots — nothing is playable');
    if (modeCards === 0) errors.push('offline Game modes screen is empty; the local catalogue was not used');
  } catch (error) {
    errors.push(`offline menu: ${error.message.split('\n')[0]}`);
  }
}

console.log(`console errors ${errors.length}${errors.length > 0 ? `\n  - ${errors.join('\n  - ')}` : ''}`);

await browser.close();

const ok = sw.registered && sw.state === 'activated' && booted && offline && menuHonest && errors.length === 0;
console.log(ok ? '\ncheck:pwa OK' : '\ncheck:pwa FAILED');
process.exit(ok ? 0 : 1);
