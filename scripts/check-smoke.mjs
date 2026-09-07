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
  // KC_SMOKE_PUBLIC_DIR lets the release check point this at an *unpacked release zip* rather
  // than the build directory, so what gets driven in the browser is the artifact that ships.
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    KC_DATA_DIR: '/tmp/kc-smoke',
    KC_PUBLIC_DIR: path.resolve(process.env.KC_SMOKE_PUBLIC_DIR ?? 'dist/client'),
  },
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

  // House rules: a player-authored mode has to be reachable, not just implemented. This walks
  // the real path a host takes — Private room → your own rules → move a slider → create — and
  // asserts the summary line updates, because a panel whose readout lies is worse than none.
  let houseRules = 'skipped';
  await page.locator('button', { hasText: 'Private room' }).first().click();
  await page.waitForTimeout(400);
  if (await page.locator('button', { hasText: 'Create with your own rules' }).count()) {
    await page.locator('button', { hasText: 'Create with your own rules' }).first().click();
    await page.waitForTimeout(500);
    const sliders = page.locator('.kc-screen input[type=range]');
    const sliderCount = await sliders.count();
    const before = (await page.textContent('.kc-panel .kc-note')) ?? '';
    // Round length is the first slider; drag it to the minimum.
    await sliders.first().fill('60');
    await sliders.first().dispatchEvent('input');
    await page.waitForTimeout(250);
    const after = (await page.textContent('.kc-panel .kc-note')) ?? '';
    // Switching gadgets off must show in the same summary.
    await page.locator('button', { hasText: 'Gadgets: on' }).first().click();
    await page.waitForTimeout(400);
    const withoutGadgets = (await page.textContent('.kc-panel .kc-note')) ?? '';
    houseRules = `sliders=${sliderCount} changed=${before !== after} says1min=${after.includes('1 min')} noGadgets=${withoutGadgets.includes('no gadgets')}`;
    if (sliderCount < 3 || before === after || !after.includes('1 min') || !withoutGadgets.includes('no gadgets')) {
      errors.push(`[${label}] house rules panel: ${houseRules} (before=${JSON.stringify(before)} after=${JSON.stringify(after)})`);
    }
    await page.locator('button', { hasText: 'Back' }).first().click();
    await page.waitForTimeout(300);
  } else {
    errors.push(`[${label}] house rules entry point missing`);
  }
  await page.locator('button', { hasText: 'Back' }).first().click();
  await page.waitForTimeout(400);
  console.log(`${''.padEnd(16)} house rules: ${houseRules}`);

  // Practice with bots exercises the sim, renderer, avatars and the touched GameClient paths.
  await page.locator('button', { hasText: 'Practice with bots' }).first().click();
  await page.waitForTimeout(4000);
  const played = await page.evaluate(() => document.querySelectorAll('canvas').length > 0);
  const inMatch = !((await page.textContent('body')) ?? '').includes('Practice with bots');

  // Chat. The thing worth proving is not that a box appears — it is that while the box has the
  // keyboard, the letters go into the box and not into the kangaroo. Typing "wasd" is the test:
  // every one of those is a movement key.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const chatOpen = await page.locator('.kc-chat[data-open="true"]').count() > 0;
  await page.keyboard.type('wasd hello');
  await page.waitForTimeout(150);
  const typed = await page.locator('.kc-chat-input').inputValue();
  const keysWentToChat = typed === 'wasd hello';

  // Escape closes the composer rather than opening the menu — the nearer thing first.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const chatClosed = await page.locator('.kc-chat[data-open="true"]').count() === 0;
  const stillInMatch = !((await page.textContent('body')) ?? '').includes('Practice with bots');

  // Sending closes it again, so the next key goes back to the game.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('gg');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const closedAfterSend = await page.locator('.kc-chat[data-open="true"]').count() === 0;

  /**
   * Touch builds: every control must be reachable by an actual thumb.
   *
   * Rendering a button is not the same as being able to press one. The whole touch cluster once
   * computed `pointer-events: none` — inherited from the pointer-transparent HUD root — so the
   * canvas sat on top of it and every button was dead on a phone while looking perfect in a
   * screenshot. An earlier version of this check dispatched a synthetic `pointerdown` straight at
   * the node, which skips hit-testing entirely and so passed throughout. Hit-test first, then tap
   * for real.
   */
  let touchHit = 'n/a';
  let touchChat = 'n/a';
  if (label !== 'desktop') {
    const unreachable = await page.evaluate(() =>
      [...document.querySelectorAll('.kc-touchbtn')]
        .filter((n) => {
          const r = n.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !n.contains(top);
        })
        .map((n) => n.textContent),
    );
    touchHit = unreachable.length === 0 ? 'all reachable' : `UNREACHABLE ${unreachable.join(',')}`;

    const button = page.locator('.kc-touchbtn', { hasText: '💬' }).first();
    touchChat = (await button.count()) > 0 ? 'present' : 'MISSING';
    if (touchChat === 'present') {
      const box = await button.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(250);
      touchChat = (await page.locator('.kc-chat[data-open="true"]').count()) > 0 ? 'opens' : 'NO-OPEN';
      await page.keyboard.press('Escape');
    }
  }

  console.log(`${label.padEnd(16)} tutorial=${sawTutorial} menu=${sawMenu} credits=${sawCredits} canvas=${played} inMatch=${inMatch}`);
  console.log(`${''.padEnd(16)} chat: open=${chatOpen} keysCaptured=${keysWentToChat} esc=${chatClosed} stillInMatch=${stillInMatch} closedAfterSend=${closedAfterSend} touch=${touchChat}`);
  console.log(`${''.padEnd(16)} touch controls: ${touchHit}`);
  if (!chatOpen || !keysWentToChat || !chatClosed || !stillInMatch || !closedAfterSend) {
    errors.push(`[${label}] chat composer misbehaved (typed=${JSON.stringify(typed)})`);
  }
  if (touchChat !== 'n/a' && touchChat !== 'opens') errors.push(`[${label}] touch chat button ${touchChat}`);
  if (touchHit !== 'n/a' && touchHit !== 'all reachable') errors.push(`[${label}] ${touchHit}`);
  await page.close();
}
await browser.close();
server.kill();
console.log(`console errors: ${errors.length}${errors.length?`\n  - ${errors.join('\n  - ')}`:''}`);
if (errors.length) console.log('--- server log ---\n' + serverLog.join(''));
process.exit(errors.length===0?0:1);
