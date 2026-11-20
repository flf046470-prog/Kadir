#!/usr/bin/env node
/**
 * The whole game from a controller, in a real browser, with no keyboard and no mouse.
 *
 * `navigator.getGamepads` is replaced by one standard-mapping pad the script presses buttons on
 * (the Gamepad API cannot be driven any other way in a page). From a fresh page it must get
 * through the name screen and the tutorial, find "Practice with bots" with the D-pad, start a
 * round, play (A is a jump), pause with Start, not jump behind the menu while it is up, change a
 * slider in Settings, come back with B, and resume with Start. Every step is read off the page or
 * off `__kcSelf` (webdriver only, read only), never assumed from a click succeeding.
 *
 * The unit tests (`ui/padNav.test.ts`) cover the edge detection and the spatial choice; this
 * covers whether a pad reaches the menus at all, which is what a console store tests first.
 *
 * Zero console errors is a pass condition. Skips cleanly without Playwright, as check:smoke does.
 *
 * Usage: npm run build && npm run check:pad
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('check:pad — playwright is not installed; skipping.');
  process.exit(0);
}

const PORT = 8875;
const PUBLIC_DIR = path.resolve('dist/client');
const ART_INSTALLED =
  existsSync(path.join(PUBLIC_DIR, 'models')) &&
  readdirSync(path.join(PUBLIC_DIR, 'models'), { recursive: true }).some((f) => String(f).endsWith('.glb'));
const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KC_DATA_DIR: '/tmp/kc-pad', KC_PUBLIC_DIR: PUBLIC_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stopServer = () => {
  if (!server.killed) server.kill();
};
process.on('exit', stopServer);
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 150));
}

const launch = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(launch);

const results = [];
const errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAD = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const JUMP = 1;

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem(
      'kc.settings.v1',
      JSON.stringify({ graphics: { quality: 'low', shadows: false, postProcessing: false, renderScale: 0.5, sceneryDetail: 0.25 } }),
    );
    // One standard-mapping controller, 17 buttons and four axes, that the script presses.
    const state = { buttons: Array.from({ length: 17 }, () => false), axes: [0, 0, 0, 0] };
    window.__pad = state;
    navigator.getGamepads = () => [
      {
        id: 'Test controller (STANDARD GAMEPAD)',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: performance.now(),
        axes: state.axes,
        buttons: state.buttons.map((pressed) => ({ pressed, touched: pressed, value: pressed ? 1 : 0 })),
      },
    ];
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('console', (m) => {
    if (m.type() !== 'error' || /Failed to load resource/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const at = new URL(r.url()).pathname;
    if (at.startsWith('/.well-known/appspecific/')) return;
    if (!ART_INSTALLED && at.startsWith('/models/')) return;
    errors.push(`${r.status()} ${at}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const setButton = (i, v) => page.evaluate(([i, v]) => (window.__pad.buttons[i] = v), [i, v]);
  /** Press and release, holding each long enough for the page's own frame loop to see it. */
  const press = async (i, hold = 400) => {
    await setButton(i, true);
    await wait(hold);
    await setButton(i, false);
    await wait(250);
  };
  const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  const screenHas = (text) => page.locator('.kc-root button', { hasText: text }).first().isVisible().catch(() => false);
  const until = async (test, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await test()) return true;
      await wait(200);
    }
    return false;
  };
  const self = () => page.evaluate(() => window.__kcSelf?.() ?? null);
  /**
   * The smallest text on screen, in CSS px at the Steam Deck's 1280x800 (this page's viewport), with
   * where it is. Valve's Deck Verified rule is 9 px minimum, 12 recommended.
   */
  const smallestText = () =>
    page.evaluate(() => {
      let min = Infinity;
      let where = '';
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent?.trim();
        const el = n.parentElement;
        if (!text || !el) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
        if (el.closest('.kc-hidden')) continue;
        const size = parseFloat(style.fontSize);
        if (size < min) {
          min = size;
          where = `${el.className || el.tagName}: "${text.slice(0, 30)}"`;
        }
      }
      return { min, where };
    });
  const fontReport = [];
  /**
   * Walk the focus to the control labelled `text` with the D-pad alone, pressing towards where it
   * sits on screen as a player looking at it would. True once it has focus.
   */
  const goTo = async (text, steps = 16) => {
    for (let i = 0; i < steps; i++) {
      const where = await page.evaluate((text) => {
        const a = document.activeElement;
        const t = [...document.querySelectorAll('.kc-root button, .kc-root input, .kc-root select')].find(
          (b) => b.textContent?.trim() === text && b.getClientRects().length > 0,
        );
        if (!a || !t) return null;
        if (a === t) return 'here';
        const ra = a.getBoundingClientRect();
        const rt = t.getBoundingClientRect();
        return { dx: rt.left + rt.width / 2 - (ra.left + ra.width / 2), dy: rt.top + rt.height / 2 - (ra.top + ra.height / 2) };
      }, text);
      if (where === 'here') return true;
      if (!where) return false;
      const vertical = Math.abs(where.dy) > 8;
      await press(vertical ? (where.dy > 0 ? PAD.DOWN : PAD.UP) : where.dx > 0 ? PAD.RIGHT : PAD.LEFT, 200);
    }
    return (await focusedText()) === text;
  };
  /**
   * Every control on the current screen that the D-pad cannot reach from the focused one. Walks
   * the same graph the navigator walks — `pickNext` over the controls' boxes, in the page — so a
   * control nothing points at is found without pressing a thousand buttons under swiftshader.
   */
  const unreachable = () =>
    page.evaluate(() => {
      const nav = window.__kcPadNav;
      if (!nav) return ['(no navigator hook)'];
      return nav.unreachable();
    });

  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.locator('input[type=text]').first().waitFor();

  // Name screen: Start is focused for the pad, and an empty name plays as "Roo".
  await until(async () => (await focusedText()) === 'Start', 5000);
  check('the name screen focuses Start for a pad', (await focusedText()) === 'Start', `focused "${await focusedText()}"`);
  await press(PAD.A);
  const tutorial = await until(() => screenHas('Got it'));
  check('A/Cross confirms the name', tutorial);
  await until(async () => (await focusedText()) === 'Got it', 5000);
  await press(PAD.A);
  const menu = await until(() => screenHas('Practice with bots'));
  check('A/Cross dismisses the tutorial', menu);

  const menuGaps = await unreachable();
  check('every control on the main menu is reachable with the D-pad', menuGaps.length === 0, menuGaps.join(', '));
  // Every screen the main menu opens: reached, swept for unreachable controls, and left with B.
  const destinations = await page.evaluate(() =>
    [...document.querySelectorAll('.kc-root button')]
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => t && !/^(Play|Quick play|Practice with bots|Resume|Leave match|Claim daily reward)/.test(t)),
  );
  const swept = [];
  for (const label of destinations) {
    if (!(await goTo(label))) {
      check(`the D-pad reaches "${label}"`, false, `focused "${await focusedText()}"`);
      continue;
    }
    await press(PAD.A);
    await wait(500);
    fontReport.push({ screen: label, ...(await smallestText()) });
    const gaps = await unreachable();
    if (gaps.length) check(`every control on "${label}" is reachable`, false, gaps.join(', '));
    else swept.push(label);
    await press(PAD.B);
    if (!(await until(() => screenHas('Practice with bots'), 6000))) {
      check(`B/Circle leaves "${label}"`, false);
      break;
    }
  }
  check('every screen off the main menu is reachable and left with the pad', swept.length === destinations.length, `${swept.length}/${destinations.length}: ${swept.join(', ')}`);

  // Find Practice with bots with the D-pad alone.
  const found = await goTo('Practice with bots');
  check('the D-pad reaches "Practice with bots"', found, `focused "${await focusedText()}"`);
  const highlighted = await page.evaluate(() => document.activeElement?.classList.contains('kc-pad-focus') ?? false);
  check('the focused control is highlighted', highlighted);
  await press(PAD.A);
  const playing = await until(async () => (await page.evaluate(() => document.querySelector('.kc-root')?.childElementCount ?? 1)) === 0 && (await self()) !== null, 40_000);
  check('A/Cross starts a practice round', playing);

  await wait(1500);
  fontReport.push({ screen: 'HUD in a round', ...(await smallestText()) });
  // In play, A is a jump: the intent carries it.
  await setButton(PAD.A, true);
  const jumped = await until(async () => (((await self())?.buttons ?? 0) & JUMP) !== 0, 8000);
  await setButton(PAD.A, false);
  check('A/Cross jumps in a round', jumped);
  await wait(400);

  // Start pauses.
  await press(PAD.START);
  const paused = await until(() => screenHas('Resume'));
  check('Start/Options opens the menu in a round', paused);

  // Behind the menu the pad is the menu's: Y (an emote in play, nothing in a menu) reaches nobody.
  await setButton(3, true);
  let leaked = false;
  for (let i = 0; i < 10; i++) {
    if (((await self())?.buttons ?? 0) !== 0) leaked = true;
    await wait(150);
  }
  await setButton(3, false);
  await wait(300);
  check('the pad does not reach the player behind a menu', !leaked);

  // Settings: reach it, change a slider with right, come back with B.
  let atSettings = await goTo('Settings');
  if (atSettings) {
    await press(PAD.A);
    atSettings = await until(() => page.locator('.kc-root input[type=range]').first().isVisible().catch(() => false), 5000);
  }
  check('the D-pad reaches Settings', atSettings, `focused "${await focusedText()}"`);
  if (atSettings) {
    const settingsGaps = await unreachable();
    check('every control in Settings is reachable with the D-pad', settingsGaps.length === 0, settingsGaps.join(', '));
    // Down until a slider has focus.
    let slider = false;
    for (let i = 0; i < 25 && !slider; i++) {
      slider = await page.evaluate(() => document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range');
      if (!slider) await press(PAD.DOWN, 150);
    }
    const before = await page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? Number(document.activeElement.value) : NaN));
    await press(PAD.RIGHT, 150);
    const after = await page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? Number(document.activeElement.value) : NaN));
    check('right on a slider changes its value', slider && after > before, `${before} → ${after}`);
    await press(PAD.B);
    const backAtMenu = await until(() => screenHas('Resume'), 5000);
    check('B/Circle goes back a screen', backAtMenu);
  }

  // A on Resume closes the menu, and the A still held is not a jump.
  check('the D-pad reaches Resume', await goTo('Resume'), `focused "${await focusedText()}"`);
  await setButton(PAD.A, true);
  const closed = await until(async () => (await page.evaluate(() => document.querySelector('.kc-root')?.childElementCount ?? 1)) === 0, 8000);
  let carried = false;
  for (let i = 0; i < 8; i++) {
    if ((((await self())?.buttons ?? 0) & JUMP) !== 0) carried = true;
    await wait(150);
  }
  await setButton(PAD.A, false);
  check('A/Cross on Resume closes the menu', closed);
  check('the press that closed the menu is not a jump', closed && !carried);
  await wait(300);

  // Start pauses and resumes.
  await press(PAD.START);
  const pausedAgain = await until(() => screenHas('Resume'), 8000);
  await press(PAD.START);
  const resumed = await until(async () => (await page.evaluate(() => document.querySelector('.kc-root')?.childElementCount ?? 1)) === 0, 8000);
  check('Start/Options closes the menu and resumes', pausedAgain && resumed);
  await setButton(PAD.A, true);
  const jumpsAgain = await until(async () => (((await self())?.buttons ?? 0) & JUMP) !== 0, 8000);
  await setButton(PAD.A, false);
  check('the pad plays again after resuming', jumpsAgain);
  fontReport.push({ screen: 'main menu', ...(await page.evaluate(() => null)) });
  fontReport.pop();
  for (const f of fontReport) console.log(`  text ${String(f.min).padStart(5)} px  ${f.screen}  (${f.where})`);
  const worst = fontReport.reduce((a, b) => (b.min < a.min ? b : a), { min: Infinity });
  check('no text under 12 px at 1280x800 (Steam Deck: 9 required, 12 recommended)', worst.min >= 12, `${worst.min} px on ${worst.screen}: ${worst.where}`);
} catch (error) {
  check('the run completed', false, String(error?.message ?? error));
} finally {
  await browser.close();
  stopServer();
}

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\ncheck:pad ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
