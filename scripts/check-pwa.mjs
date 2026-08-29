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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
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
console.log(`console errors ${errors.length}${errors.length > 0 ? `\n  - ${errors.join('\n  - ')}` : ''}`);

await browser.close();

const ok = sw.registered && sw.state === 'activated' && booted && offline && errors.length === 0;
console.log(ok ? '\ncheck:pwa OK' : '\ncheck:pwa FAILED');
process.exit(ok ? 0 : 1);
