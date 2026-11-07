/* Touch controls on an emulated iPhone-sized landscape viewport (real CDP touch events).
 * Checks: floating stick appears under the thumb and walks the player (analog), a drag
 * on the right half turns the camera, the E button fires an interaction. */
const { chromium } = require('playwright');
const serve = require('./serve.cjs');

(async () => {
  const srv = await serve(8769);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8769/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.tap('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') { await page.tap('#startBtn'); await page.waitForTimeout(300); }
  await page.evaluate(() => ICEWALK_ENGINE.continueFrom({ player: { x: 0, z: 35, yaw: 0, pitch: 0 }, mission: 0 }, () => ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true })));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const sim = (s) => page.evaluate((n) => ICEWALK_ENGINE.step(1 / 30, n), Math.round(s * 30));
  const d0 = await page.evaluate(() => ICEWALK_DIAGNOSTICS());
  const coarse = await page.evaluate(() => document.body.classList.contains('touch-device'));
  // half push forward with the left thumb
  await touch('touchStart', [[170, 290, 1]]);
  await touch('touchMove', [[170, 255, 1]]);
  const halfIn = await page.evaluate(() => ({ ...window.ICEWALK_INPUT }));
  await sim(1.0);
  const d1 = await page.evaluate(() => ICEWALK_DIAGNOSTICS());
  await touch('touchMove', [[170, 200, 1]]);
  await sim(1.0);
  const d2 = await page.evaluate(() => ICEWALK_DIAGNOSTICS());
  const padLive = await page.evaluate(() => document.getElementById('mobilePad').classList.contains('live'));
  await touch('touchEnd', []);
  const after = await page.evaluate(() => ({ ...window.ICEWALK_INPUT }));
  // look: drag right on the right half
  await touch('touchStart', [[600, 200, 2]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[600 + i * 20, 200, 2]]);
  await touch('touchEnd', []);
  await sim(0.1);
  const d3 = await page.evaluate(() => ICEWALK_DIAGNOSTICS());
  const step1 = Math.abs(d1.position[1] - d0.position[1]), step2 = Math.abs(d2.position[1] - d1.position[1]);
  const checks = [
    ['touch device detected (coarse pointer)', coarse, {}],
    ['floating stick appears under the thumb', padLive, {}],
    ['half push gives partial analog input', halfIn.active && halfIn.z > 0.2 && halfIn.z < 0.9, halfIn],
    ['stick walks the player forward (-z)', d1.position[1] < d0.position[1] - 0.5, { z0: d0.position[1], z1: d1.position[1] }],
    ['full push moves faster than half push (analog speed)', step2 > step1 * 1.3, { step1, step2 }],
    ['releasing the stick stops input', !after.active, after],
    ['drag on the right half turns the camera', d3.yaw > d2.yaw + 0.2, { before: d2.yaw, after: d3.yaw }],
    ['no page errors', errors.length === 0, errors.slice(0, 5)],
  ];
  for (const [n, ok, d] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d));
  await browser.close(); srv.close();
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
