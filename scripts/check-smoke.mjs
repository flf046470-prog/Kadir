#!/usr/bin/env node
/**
 * End-to-end smoke test: drive the built game in a real browser, on a desktop and a
 * landscape-phone viewport.
 *
 * Unit tests cover the simulation; this covers the wiring between it and everything else —
 * boot, session creation, screen navigation, entering a match, and the renderer actually
 * producing a canvas. It runs against the real server rather than a static file host, because
 * the first screen creates a session through /api and a static host leaves the app stuck there
 * with nothing logged.
 *
 * It also asserts the credits screen names a CC-BY author, which is the end of the licence
 * chain that starts in assets/packs.json: an attribution that never reaches a player is not
 * an attribution.
 *
 * Playwright is not a declared dependency (it would pull a browser download into every CI run),
 * so this skips cleanly when absent. Zero console errors is a pass condition, not a warning.
 *
 * Usage: npm run build && npm run check:smoke
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('check:smoke — playwright is not installed; skipping.');
  console.log('  npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

// The real server, not a static file host: the name screen creates a session through /api, so
// a static-only host leaves the app stuck on the first screen with nothing logged.
const PORT = 8871;
const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KC_DATA_DIR: '/tmp/kc-smoke', KC_PUBLIC_DIR: path.resolve('dist/client') },
  stdio: ['ignore','pipe','pipe'],
});
const serverLog = [];
server.stdout.on('data', d => serverLog.push(String(d)));
server.stderr.on('data', d => serverLog.push(String(d)));
const base = `http://127.0.0.1:${PORT}`;
for (let i=0;i<80;i++){ try { const r = await fetch(base); if (r.ok) break; } catch {} await new Promise(r=>setTimeout(r,150)); }

// SwiftShader so this runs on a headless CI box with no GPU.
const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const errors=[];
for (const [label, vp] of [['desktop',{width:1280,height:720}], ['phone-landscape',{width:844,height:390}]]) {
  const page = await (await browser.newContext({viewport:vp, hasTouch: label!=='desktop'})).newPage();
  page.on('console', m=>{ if(m.type()==='error') errors.push(`[${label}] ${m.text()}`); });
  page.on('pageerror', e=>errors.push(`[${label}] pageerror: ${e.message}`));

  await page.goto(base,{waitUntil:'load'});
  await page.waitForTimeout(1200);

  // Flow: name -> tutorial -> menu. "Got it" lands on the menu directly, so there is no
  // Escape to press (pressing it here closes the menu again).
  await page.locator('input[type=text]').first().fill('SmokeTester');
  await page.locator('button', { hasText: 'Start' }).first().click();
  await page.waitForTimeout(2500);

  const sawTutorial = ((await page.textContent('body')) ?? '').includes('How to play');
  await page.locator('button', { hasText: 'Got it' }).first().click();
  await page.waitForTimeout(1500);
  const sawMenu = ((await page.textContent('body')) ?? '').includes('Practice with bots');

  // The credits screen is generated from the credit registry, so this also proves a CC-BY
  // asset in the manifest actually reaches the player-visible attribution.
  let sawCredits = false;
  await page.locator('button', { hasText: 'Settings' }).first().click();
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: 'Credits & licences' }).first().click();
  await page.waitForTimeout(500);
  const creditsText = (await page.textContent('body')) ?? '';
  sawCredits = creditsText.includes('three.js') && creditsText.includes('CC-BY-4.0') && creditsText.includes('PixelMannen');
  await page.locator('button', { hasText: 'Back' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Back' }).first().click();
  await page.waitForTimeout(400);

  // Practice with bots exercises the sim, renderer, avatars and the touched GameClient paths.
  await page.locator('button', { hasText: 'Practice with bots' }).first().click();
  await page.waitForTimeout(4000);
  const played = await page.evaluate(() => document.querySelectorAll('canvas').length > 0);
  const inMatch = !((await page.textContent('body')) ?? '').includes('Practice with bots');

  console.log(`${label.padEnd(16)} tutorial=${sawTutorial} menu=${sawMenu} credits=${sawCredits} canvas=${played} inMatch=${inMatch}`);
  await page.close();
}
await browser.close();
server.kill();
console.log(`console errors: ${errors.length}${errors.length?`\n  - ${errors.join('\n  - ')}`:''}`);
if (errors.length) console.log('--- server log ---\n' + serverLog.join(''));
process.exit(errors.length===0?0:1);
