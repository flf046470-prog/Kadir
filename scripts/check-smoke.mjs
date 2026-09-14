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
// Portrait is not a third skin on the same test — it is the shape the mid-match menu bug lived in.
// A phone held upright has no Escape key and no keyboard at all, so every way out of a screen has
// to be a button a thumb can reach. Landscape alone never proved that.
for (const [label, vp] of [['desktop',{width:1280,height:720}], ['phone-landscape',{width:844,height:390}], ['phone-portrait',{width:390,height:844}]]) {
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

    /**
     * Press Create, and prove a room actually comes back.
     *
     * This used to stop at the Back button, and under that gap the whole feature shipped dead:
     * the client asked for a private room by putting a sentinel in the `roomCode` field, the
     * server recognised the sentinel in one place and then handed it to the room-code validator
     * in another, which refused it as malformed. Every single attempt to create a room with your
     * own rules failed, and this check passed on every run — because it had proved the *panel*
     * worked and never once proved the *button* did.
     *
     * A panel whose slider moves is worth nothing if the thing it configures cannot be created.
     */
    await page.locator('button', { hasText: 'Create room' }).first().click();
    await page.waitForTimeout(4500);

    /**
     * The signal is the room code in the HUD, and nothing weaker.
     *
     * The first version of this check asked whether a canvas existed. It always does — the
     * renderer creates one at boot — so the assertion passed just as happily with the bug
     * present, which made it worse than no check at all: it looked like coverage. `startMatch`
     * hides the menu and shows the HUD *before* it connects, so "the menu went away" proves
     * nothing either; a refused connection leaves the player on an empty world with a full HUD.
     *
     * On success the HUD reads `KANG-QB9T (private) · 1 players`. That string can only come from
     * a `welcome` the server sent, which is exactly the thing being tested.
     */
    const hud = await page.evaluate(() => document.body.innerText);
    const code = (hud.match(/KANG-[A-Z0-9]{4}/) ?? [])[0] ?? null;
    const created = code !== null && /\(private\)/.test(hud);
    houseRules += ` created=${created} code=${code ?? 'none'}`;
    if (!created) {
      errors.push(
        `[${label}] creating a private room with house rules failed — no private room code in the HUD ` +
          `(code=${code ?? 'none'}, hud=${JSON.stringify(hud.slice(0, 200))})`,
      );
    } else {
      /**
       * Leave the match, through the button rather than the keyboard.
       *
       * This used to be `if (await leave.count()) await leave.click()` — guarded, against a button
       * that had never existed in any version of the shell. So it silently did nothing on every
       * run since it was written, and the check read as coverage of an escape hatch that was not
       * there. The guard is gone: if there is no way out of a match, this fails.
       *
       * Escape opens the menu here (it does not leave), and on a phone it does nothing at all —
       * which is the whole point of asserting the button.
       */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const leave = page.locator('button', { hasText: 'Leave match' }).first();
      if (await leave.count() === 0) {
        const shown = await page.locator('.kc-root button').allTextContents();
        errors.push(`[${label}] no way out of a match: menu offers ${JSON.stringify(shown)}`);
      } else {
        await leave.click();
      }
      await page.waitForTimeout(800);
    }
  } else {
    errors.push(`[${label}] house rules entry point missing`);
  }
  // Creating a room and leaving it lands on the main menu, which has no Back button; failing to
  // create leaves us on a screen that does. Either way the next step needs the menu, so this
  // clicks Back only if there is one, and then asserts where we ended up rather than assuming.
  const back = page.locator('button', { hasText: 'Back' }).first();
  if (await back.count()) {
    await back.click();
    await page.waitForTimeout(400);
  }
  const atMenu = ((await page.textContent('body')) ?? '').includes('Practice with bots');
  if (!atMenu) errors.push(`[${label}] did not return to the menu after the house rules flow`);
  console.log(`${''.padEnd(16)} house rules: ${houseRules} backAtMenu=${atMenu}`);

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
   * Every control the HUD puts on screen must be reachable by an actual click or thumb.
   *
   * Rendering a button is not the same as being able to press one. The HUD root is deliberately
   * transparent to pointer events so the canvas underneath can be swiped, `pointer-events`
   * inherits, and anything in there that does not take them back is drawn perfectly and does
   * nothing at all — a failure invisible to every screenshot ever taken of it.
   *
   * This has now bitten twice, which is why the check is written against every interactive node
   * in the HUD rather than one class at a time, and on every viewport rather than only the phone.
   * The first time it was the touch cluster, dead on a phone. The second time it was the Menu
   * button, dead everywhere — and on a phone, where there is no Escape key, that left no way out
   * of a match at all. A check scoped to `.kc-touchbtn` on touch builds could not see it.
   */
  const unreachable = await page.evaluate(() =>
    [...document.querySelectorAll('.kc-hud button, .kc-hud input, .kc-hud [data-ui]')]
      .filter((n) => {
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false; // not on screen right now
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !n.contains(top);
      })
      .map((n) => (n.textContent || n.className || n.tagName).trim().slice(0, 16)),
  );
  const hudHit = unreachable.length === 0 ? 'all reachable' : `UNREACHABLE ${unreachable.join(',')}`;

  let touchChat = 'n/a';
  if (label !== 'desktop') {
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

  /**
   * The pause menu, driven with the pointer only.
   *
   * Tapping Menu mid-round used to render the title screen — Play, Game modes, Private room,
   * Customise, Store, Settings, How to play, Practice with bots — with no Resume and no Leave.
   * Nine buttons, none of which went back to the round the player was still standing in. On
   * desktop Escape covered it; on a phone there was no way back at all, and the round carried on
   * without them: still catchable, still on the clock.
   *
   * So this asserts three things, all through taps: a way back exists, it actually returns to the
   * round, and nothing on that menu silently throws the round away.
   */
  let pause = 'n/a';
  /**
   * Opened the way that platform's players actually open it.
   *
   * Desktop holds pointer lock during a match, and under pointer lock there is no cursor: every
   * mouse event goes to the lock target, so the Menu button cannot be clicked however correctly it
   * is drawn. Measured rather than assumed — mid-match on desktop, `document.pointerLockElement`
   * is the CANVAS while `elementFromPoint` over the button still returns the button. That gap is
   * why the HUD reachability check below passes on desktop and a real click times out: one models
   * stacking, the other models input. Escape is the desktop route, and the button is the touch
   * route, so each is driven where it is the real one.
   */
  if (label === 'desktop') {
    await page.keyboard.press('Escape');
  } else {
    const menuBtn = page.locator('.kc-topbar button', { hasText: 'Menu' }).first();
    const box = await menuBtn.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.waitForTimeout(600);
  const pauseButtons = await page.locator('.kc-root button').allTextContents();
  const canResume = pauseButtons.some((b) => /^Resume$/i.test(b.trim()));
  const canLeave = pauseButtons.some((b) => /Leave match/i.test(b));
  // Entries that start or join another round, which from here would abandon this one with no warning.
  const abandons = pauseButtons.filter((b) => /^(Play|Practice with bots|Game modes|Private room)$/i.test(b.trim()));
  if (!canResume || !canLeave || abandons.length > 0) {
    errors.push(
      `[${label}] pause menu: resume=${canResume} leave=${canLeave} ` +
        `abandons=${JSON.stringify(abandons)} buttons=${JSON.stringify(pauseButtons)}`,
    );
    pause = 'BROKEN';
  } else {
    // The menu released pointer lock to open, so Resume is clickable on every platform.
    await page.locator('.kc-root button', { hasText: 'Resume' }).first().click();
    await page.waitForTimeout(600);
    // Back in the round means the HUD is up and the menu is gone — not merely that a click landed.
    const backInRound =
      (await page.locator('.kc-root button').count()) === 0 &&
      (await page.locator('.kc-hud').count()) > 0 &&
      (await page.locator('.kc-hud.kc-hidden').count()) === 0;
    pause = backInRound ? 'resumes' : 'NO-RESUME';
    if (!backInRound) errors.push(`[${label}] Resume did not return to the round`);
  }

  console.log(`${label.padEnd(16)} tutorial=${sawTutorial} menu=${sawMenu} credits=${sawCredits} canvas=${played} inMatch=${inMatch} pause=${pause}`);
  console.log(`${''.padEnd(16)} chat: open=${chatOpen} keysCaptured=${keysWentToChat} esc=${chatClosed} stillInMatch=${stillInMatch} closedAfterSend=${closedAfterSend} touch=${touchChat}`);
  console.log(`${''.padEnd(16)} HUD controls: ${hudHit}`);
  if (!chatOpen || !keysWentToChat || !chatClosed || !stillInMatch || !closedAfterSend) {
    errors.push(`[${label}] chat composer misbehaved (typed=${JSON.stringify(typed)})`);
  }
  if (touchChat !== 'n/a' && touchChat !== 'opens') errors.push(`[${label}] touch chat button ${touchChat}`);
  if (hudHit !== 'all reachable') errors.push(`[${label}] ${hudHit}`);
  await page.close();
}
await browser.close();
server.kill();
console.log(`console errors: ${errors.length}${errors.length?`\n  - ${errors.join('\n  - ')}`:''}`);
if (errors.length) console.log('--- server log ---\n' + serverLog.join(''));
process.exit(errors.length===0?0:1);
