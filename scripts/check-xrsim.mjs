#!/usr/bin/env node
/**
 * The desktop VR simulator, driven in a real browser, and the two ways the VR path can fail.
 *
 * Unit tests cover what each key means (`desktopXr.test.ts`). This covers whether a key pressed on
 * the page reaches the simulation: through IWER's emulated headset, WebXR, three.js, `VRInput`
 * and the intent, into the player the simulation holds (`__kcSelf`, webdriver only, read only).
 * A screenshot cannot say a grip closed the left hand; `__kcSelf` can.
 *
 * Three pages:
 * 1. `?xrsim`: boots as VR, enters an emulated session, and every control moves what it should.
 * 2. A browser that says it can present but refuses the session (a PC with an OpenXR runtime and
 *    the headset off): the failure is on screen, and "Play on desktop" gives a playable page.
 * 3. `?xrsim` beside a real headset: the simulator stays off and says so.
 *
 * Zero console errors is a pass condition. Playwright is not a declared dependency, so this skips
 * cleanly without it, as check:smoke does.
 *
 * Usage: npm run build && npm run check:xrsim
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('check:xrsim — playwright is not installed; skipping.');
  process.exit(0);
}

const PORT = 8874;
const PUBLIC_DIR = path.resolve('dist/client');
const ART_INSTALLED =
  existsSync(path.join(PUBLIC_DIR, 'models')) &&
  readdirSync(path.join(PUBLIC_DIR, 'models'), { recursive: true }).some((f) => String(f).endsWith('.glb'));
const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KC_DATA_DIR: '/tmp/kc-xrsim', KC_PUBLIC_DIR: PUBLIC_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));
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

// The game's own bits (`Buttons` in @kc/core), written out so this script needs no TypeScript.
const BIT = { Jump: 1, Sprint: 2, Emote: 64, UseGadget: 512, CycleGadget: 1024, Shop: 2048, Talk: 4096 };
const LEFT = 0;
const RIGHT = 1;

/** A fresh page, through the name screen and the tutorial to the main menu. */
async function openGame(label, query, { initScript, settings } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((seed) => {
    // Lowest graphics: swiftshader draws a frame a second at the default tier.
    localStorage.setItem(
      'kc.settings.v1',
      JSON.stringify({
        graphics: { quality: 'low', shadows: false, postProcessing: false, renderScale: 0.5, sceneryDetail: 0.25 },
        ...seed,
      }),
    );
  }, settings ?? {});
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('console', (m) => {
    if (m.type() !== 'error' || /Failed to load resource/.test(m.text())) return;
    errors.push(`[${label}] ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const at = new URL(r.url()).pathname;
    if (at.startsWith('/.well-known/appspecific/')) return;
    if (!ART_INSTALLED && at.startsWith('/models/')) return;
    errors.push(`[${label}] ${r.status()} ${at}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  await page.goto(`${base}/${query}`, { waitUntil: 'load' });
  await page.locator('input[type=text]').first().fill('XrSimTester');
  await page.locator('button', { hasText: 'Start' }).first().click();
  await page.locator('button', { hasText: 'Got it' }).first().click();
  await page.locator('button', { hasText: 'Practice with bots' }).first().waitFor();
  return { page, context };
}

const self = (page) => page.evaluate(() => window.__kcSelf?.() ?? null);
/** Hold `press` until `test(self)` holds or `ms` passes; true if it held. */
async function holdUntil(page, press, release, test, ms = 4000) {
  await press();
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await self(page);
    if (last && test(last)) break;
    await wait(80);
  }
  await release();
  return last && test(last) ? last : null;
}

try {
  // ── 1. The simulator ──────────────────────────────────────────────────────────────────────────
  {
    // Assisted movement, so the sticks and the hop are live; arms-first takes both away by design.
    const { page } = await openGame('xrsim', '?xrsim', { settings: { comfort: { vrLocomotion: 'assisted' } } });
    const emulated = await page.evaluate(() => Boolean(document.getElementById('kc-xrsim')) && Boolean(navigator.xr));
    check('?xrsim installs the emulated runtime and its controls', emulated);
    const enter = page.locator('button', { hasText: 'Enter VR' });
    check('the page booted as VR (an "Enter VR" button)', (await enter.count()) > 0);

    await page.locator('button', { hasText: 'Practice with bots' }).first().click();
    await wait(1500);
    await enter.first().click();
    await page.waitForFunction(() => /In VR/.test(document.getElementById('kc-xrsim')?.textContent ?? ''), null, { timeout: 15000 });
    check('Enter VR starts an emulated session', true);
    const start = await page.waitForFunction(() => {
      const view = window.__kcSelf?.();
      return view && view.hands[0].tracked && view.hands[1].tracked ? view : null;
    }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
    check('both controllers reach the simulation as tracked hands', Boolean(start));

    // The picture: an emulated session that drew nothing is the black screen this exists to catch.
    await wait(1500);
    const shot = await page.screenshot({ path: path.join(process.env.KC_XRSIM_SHOTS ?? '/tmp', 'xrsim-session.png') });
    const lit = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 36;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return sum / (d.length / 4);
    }, shot.toString('base64'));
    check('the emulated session draws the world, not a black screen', lit > 25, `mean luminance ${lit.toFixed(1)}`);

    // Look.
    let mouseX = 640;
    await page.mouse.move(mouseX, 360);
    const before = await self(page);
    for (let x = mouseX + 20; x <= mouseX + 200; x += 20) await page.mouse.move(x, 360);
    mouseX += 200;
    const turned = await holdUntil(page, async () => {}, async () => {}, (s) => s.yaw - before.yaw < -0.25, 6000);
    const after = turned ?? (await self(page));
    check('moving the mouse right turns the head right', Boolean(turned), `yaw ${before.yaw.toFixed(2)} → ${after.yaw.toFixed(2)}`);

    // Grips, each on its own hand. The sim's hands[0] is its LEFT hand.
    const rightGrip = await holdUntil(page, () => page.mouse.down({ button: 'right' }), () => page.mouse.up({ button: 'right' }), (s) => s.hands[RIGHT].gripHeld);
    check('right mouse closes the right hand, and only it', Boolean(rightGrip) && !rightGrip.hands[LEFT].gripHeld);
    const leftGrip = await holdUntil(page, () => page.keyboard.down('KeyE'), () => page.keyboard.up('KeyE'), (s) => s.hands[LEFT].gripHeld);
    check('E closes the left hand, and only it', Boolean(leftGrip) && !leftGrip.hands[RIGHT].gripHeld);

    // Buttons, through VR_BINDINGS into the intent.
    const button = async (name, bit, press, release) => {
      const got = await holdUntil(page, press, release, (s) => (s.buttons & bit) !== 0);
      check(`${name}`, Boolean(got));
    };
    await button('left mouse is the right trigger (Use gadget)', BIT.UseGadget, () => page.mouse.down(), () => page.mouse.up());
    await button('Q is the left trigger (Next gadget)', BIT.CycleGadget, () => page.keyboard.down('KeyQ'), () => page.keyboard.up('KeyQ'));
    await button('Space is A (Hop)', BIT.Jump, () => page.keyboard.down('Space'), () => page.keyboard.up('Space'));
    await button('F is X (Shop / board)', BIT.Shop, () => page.keyboard.down('KeyF'), () => page.keyboard.up('KeyF'));
    await button('R is B (Emote)', BIT.Emote, () => page.keyboard.down('KeyR'), () => page.keyboard.up('KeyR'));
    await button('Shift is the right stick press (Sprint)', BIT.Sprint, () => page.keyboard.down('ShiftLeft'), () => page.keyboard.up('ShiftLeft'));
    await button('V is the left stick press (Talk)', BIT.Talk, () => page.keyboard.down('KeyV'), () => page.keyboard.up('KeyV'));

    // Moving with the left stick. Polled, not timed: under swiftshader a session draws about two
    // frames a second and each frame steps at most 100 ms of game, so wall time says little.
    const from = (await self(page)).position;
    const walkedTo = await holdUntil(
      page,
      () => page.keyboard.down('KeyW'),
      () => page.keyboard.up('KeyW'),
      (s) => Math.hypot(s.position.x - from.x, s.position.z - from.z) > 1,
      15000,
    );
    const walked = walkedTo ? Math.hypot(walkedTo.position.x - from.x, walkedTo.position.z - from.z) : 0;
    check('W walks with the left thumbstick', walked > 1, `${walked.toFixed(2)} m`);
    // Which way. The simulator's head looks down -z turned by its yaw, and nothing has snap-turned
    // the rig yet, so that is the view in the world. The body used to face the other way: -1.00.
    if (walkedTo) {
      const headYaw = await page.evaluate(() => window.__kcXrSim.yaw);
      const view = [-Math.sin(headYaw), -Math.cos(headYaw)];
      const along = ((walkedTo.position.x - from.x) * view[0] + (walkedTo.position.z - from.z) * view[1]) / walked;
      check('…the way the head is looking', along > 0.9, `${along.toFixed(2)} along the view`);
    }

    // Turning with the right stick (a snap turn by default).
    const yaw0 = (await self(page)).yaw;
    const snapped = await holdUntil(page, () => page.keyboard.down('ArrowRight'), () => page.keyboard.up('ArrowRight'), (s) => Math.abs(s.yaw - yaw0) > 0.3);
    check('→ turns with the right thumbstick', Boolean(snapped), snapped ? `yaw ${yaw0.toFixed(2)} → ${snapped.yaw.toFixed(2)}` : '');

    // A hand moved on its own: the mouse is where the look test left it, so move on from there.
    // Leaving it to jump back to the middle first moved the hand 200 px the wrong way.
    // Measured in the world, against the view's own right: the player stands still, so the hand's
    // world position moves only because the mouse moved it.
    const viewRight = async () => {
      const headYaw = await page.evaluate(() => window.__kcXrSim.yaw);
      const turn = (await self(page)).yaw - Math.atan2(Math.sin(headYaw + Math.PI), Math.cos(headYaw + Math.PI));
      const yaw = headYaw + turn;
      // Looking down -z turned by `yaw`, a viewer's right is +x turned by the same.
      return [Math.cos(yaw), -Math.sin(yaw)];
    };
    const right = await viewRight();
    const handBefore = (await self(page)).hands[RIGHT].world;
    const sideways = (s) => (s.hands[RIGHT].world.x - handBefore.x) * right[0] + (s.hands[RIGHT].world.z - handBefore.z) * right[1];
    await page.keyboard.down('Digit2');
    for (let x = mouseX + 20; x <= mouseX + 120; x += 20) await page.mouse.move(x, 360);
    mouseX += 120;
    const handMoved = await holdUntil(page, async () => {}, async () => {}, (s) => sideways(s) > 0.12, 6000);
    await page.keyboard.up('Digit2');
    const moved = sideways(handMoved ?? (await self(page)));
    check('holding 2 moves the right hand with the mouse, to the right', Boolean(handMoved), `${moved.toFixed(2)} m to the view's right`);

    // A hand pushed out in front of the body with 2 and the wheel. (The J/K jab is one frame long
    // at the two frames a second this draws here; its 6–12 m/s profile is asserted at a real frame
    // rate in desktopXr.test.ts instead.) In front means forward of the body, which is the half-turn
    // fix again: before it, a hand in front of the face was behind the body.
    await page.keyboard.press('KeyX');
    const restZ = (await holdUntil(page, async () => {}, async () => {}, (s) => s.hands[RIGHT].local.z > 0.2, 6000))?.hands[RIGHT].local.z;
    check('a hand at rest is in front of the body', restZ !== undefined, restZ !== undefined ? `${restZ.toFixed(2)} m forward` : '');
    await page.keyboard.down('Digit2');
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
    const pushed = await holdUntil(page, async () => {}, async () => {}, (s) => s.hands[RIGHT].local.z - (restZ ?? 0) > 0.25, 6000);
    await page.keyboard.up('Digit2');
    check('2 + the wheel pushes the right hand forward', Boolean(pushed), pushed ? `${pushed.hands[RIGHT].local.z.toFixed(2)} m forward` : '');
    await page.keyboard.press('KeyX');

    // Ducking.
    const ducked = await holdUntil(page, () => page.keyboard.down('KeyC'), () => page.keyboard.up('KeyC'), (s) => s.headHeight < 1.15, 8000);
    const standing = (await self(page)).headHeight;
    check('holding C ducks the head below the crouch line', Boolean(ducked), ducked ? `${ducked.headHeight.toFixed(2)} m` : `still ${standing.toFixed(2)} m`);

    // Out again. A captured mouse sends every click to the view, so let it go first, as a tester
    // presses Esc (which the browser keeps for itself and a page cannot press).
    await page.evaluate(() => document.exitPointerLock?.());
    await page.locator('#kc-xrsim button', { hasText: 'Exit VR' }).click();
    await page.waitForFunction(() => /No headset needed/.test(document.getElementById('kc-xrsim')?.textContent ?? ''), null, { timeout: 15000 });
    // In a match the menu that comes back is the pause menu.
    const menuBack = await page.locator('button', { hasText: 'Resume' }).first().isVisible().catch(() => false);
    check('Exit VR ends the session and brings the menu back', menuBack);
  }

  // ── 2. A VR start that fails ─────────────────────────────────────────────────────────────────
  {
    const refuses = () => {
      // What a PC with an OpenXR runtime and the headset off looks like to a page.
      const xr = {
        isSessionSupported: async (mode) => mode === 'immersive-vr',
        requestSession: async () => {
          throw new DOMException('The VR headset is not connected.', 'NotSupportedError');
        },
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
    };
    const { page } = await openGame('fallback', '', { initScript: refuses });
    await page.locator('button', { hasText: 'Enter VR' }).first().click();
    const notice = page.locator('#kc-vr-failed');
    await notice.waitFor({ timeout: 10000 }).catch(() => undefined);
    const text = (await notice.textContent().catch(() => '')) ?? '';
    check('a refused VR session is said on screen, with the reason', text.includes('VR could not start') && text.includes('not connected'));
    await page.locator('#kc-vr-failed button', { hasText: 'Play on desktop' }).click();
    await page.waitForURL(/platform=pc/, { timeout: 15000 });
    await page.locator('button', { hasText: 'Practice with bots' }).first().waitFor();
    const enterGone = (await page.locator('button', { hasText: 'Enter VR' }).count()) === 0;
    const back = await page.locator('button', { hasText: 'Back to VR' }).isVisible().catch(() => false);
    check('"Play on desktop" reloads as the desktop game, with a way back to VR', enterGone && back);
    await page.locator('button', { hasText: 'Practice with bots' }).first().click();
    await wait(1500);
    const flat = await self(page);
    const fromPc = flat?.position;
    const toPc = fromPc
      ? (await holdUntil(page, () => page.keyboard.down('KeyW'), () => page.keyboard.up('KeyW'), (s) => Math.hypot(s.position.x - fromPc.x, s.position.z - fromPc.z) > 1, 15000))?.position
      : null;
    const moved = fromPc && toPc ? Math.hypot(toPc.x - fromPc.x, toPc.z - fromPc.z) : 0;
    check('…and that page is played with the keyboard', Boolean(flat) && !flat.hands[0].tracked && moved > 1, `${moved.toFixed(2)} m`);
  }

  // ── 3. Beside a real headset ─────────────────────────────────────────────────────────────────
  {
    const presents = () => {
      Object.defineProperty(navigator, 'xr', {
        value: { isSessionSupported: async (mode) => mode === 'immersive-vr', requestSession: async () => { throw new Error('not in this check'); }, addEventListener() {}, removeEventListener() {} },
        configurable: true,
      });
    };
    // Read straight after loading: the notice fades after 12 s, and the name screen takes longer.
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(presents);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`[headset] pageerror: ${e.message}`));
    await page.goto(`${base}/?xrsim`, { waitUntil: 'load' });
    const notice = (await page.locator('#kc-xrsim-notice').textContent({ timeout: 10000 }).catch(() => '')) ?? '';
    const overlay = await page.locator('#kc-xrsim').count();
    check('?xrsim beside a real headset stays off and says so', overlay === 0 && notice.includes('can already enter VR'));
  }
} catch (error) {
  check('the check ran to the end', false, String(error?.stack ?? error));
} finally {
  await browser.close();
  stopServer();
}

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\ncheck:xrsim — ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  if (serverLog.length) console.log(serverLog.slice(-20).join(''));
  process.exit(1);
}
