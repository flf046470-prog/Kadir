/* Drives the VR (WebXR) path in headless Chromium with a mock immersive-vr session:
 * two eye views side by side, a head pose, two controllers (left stick pushed
 * forward, right trigger pressed once). Verifies stereo frames render, the player
 * walks head-relative, interaction fires, and saves a side-by-side screenshot.
 * This exercises the code path only; comfort and frame rate need a real headset. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const serve = require('./serve.cjs');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'test-output'));
fs.mkdirSync(out, { recursive: true });

const MOCK = () => {
  const persp = (fovy, asp, n, f) => { const q = 1 / Math.tan(fovy / 2), o = new Float32Array(16); o[0] = q / asp; o[5] = q; o[10] = -(f + n) / (f - n); o[11] = -1; o[14] = -2 * f * n / (f - n); return o; };
  const T = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const pad = (axes, buttons) => ({ axes, buttons: buttons.map((p) => ({ pressed: p, value: p ? 1 : 0 })) });
  const left = { handedness: 'left', gripSpace: { id: 'L' }, targetRaySpace: { id: 'L' }, gamepad: pad([0, 0, 0, -1], [false, false, false, false, false, false]) };
  const right = { handedness: 'right', gripSpace: { id: 'R' }, targetRaySpace: { id: 'R' }, gamepad: pad([0, 0, 0, 0], [false, false, false, false, false, false]) };
  window.__xrMock = { left, right, frames: 0 };
  class Layer { constructor(s, gl) { this.framebuffer = null; this.w = gl.drawingBufferWidth; this.h = gl.drawingBufferHeight; } getViewport(v) { const w = this.w / 2; return { x: v.eye === 'left' ? 0 : w, y: 0, width: w, height: this.h }; } }
  window.XRWebGLLayer = Layer;
  const session = {
    inputSources: [left, right], renderState: {}, listeners: {},
    updateRenderState(s) { Object.assign(this.renderState, s); },
    async requestReferenceSpace() { return { type: 'local-floor' }; },
    requestAnimationFrame(cb) { return requestAnimationFrame((t) => { window.__xrMock.frames++; cb(t, frame); }); },
    addEventListener(n, f) { this.listeners[n] = f; },
    end() { this.listeners.end && this.listeners.end(); },
  };
  const frame = {
    session,
    getViewerPose() {
      const asp = (session.renderState.baseLayer.w / 2) / session.renderState.baseLayer.h;
      return { transform: { matrix: T(0, 1.65, 0) }, views: ['left', 'right'].map((eye, i) => ({ eye, transform: { matrix: T(i ? 0.032 : -0.032, 1.65, 0) }, projectionMatrix: persp(1.6, asp, 0.05, 900) })) };
    },
    getPose(space) { return { transform: { matrix: space.id === 'R' ? T(0.22, 1.25, -0.38) : T(-0.22, 1.25, -0.38) } }; },
  };
  Object.defineProperty(navigator, 'xr', { value: { isSessionSupported: async () => true, requestSession: async () => session } });
  const proto = WebGLRenderingContext.prototype;
  proto.makeXRCompatible = function () { return Promise.resolve(); };
};

(async () => {
  const srv = await serve(8768);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 400 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(MOCK);
  await page.goto('http://localhost:8768/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready' && document.getElementById('vrBtn'), null, { timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') { await page.click('#startBtn'); await page.waitForTimeout(300); }
  await page.evaluate(() => ICEWALK_ENGINE.continueFrom({ player: { x: -2, z: 33, yaw: 0, pitch: 0 }, mission: 0, torch: true }, () => ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true })));
  const p0 = await page.evaluate(() => ICEWALK_DIAGNOSTICS().position);
  await page.evaluate(() => window.ANTARKTIKA_XR.enter());
  await page.waitForFunction(() => window.__xrMock.frames >= 6, null, { timeout: 300000 });
  await page.evaluate(() => { window.__xrMock.right.gamepad.buttons[0].pressed = true; });
  await page.waitForFunction(() => window.__xrMock.frames >= 8, null, { timeout: 300000 });
  await page.evaluate(() => { window.__xrMock.right.gamepad.buttons[0].pressed = false; });
  const r = await page.evaluate(() => ({ xr: window.ANTARKTIKA_XR.stats, active: window.ANTARKTIKA_XR.active, pos: ICEWALK_DIAGNOSTICS().position, notice: document.getElementById('notice').textContent, a3dDraws: ANTARKTIKA3D.stats.draws }));
  await page.screenshot({ path: path.join(out, 'xr_stereo.png'), timeout: 180000 });
  const moved = Math.hypot(r.pos[0] - p0[0], r.pos[1] - p0[1]);
  const checks = [
    ['VR session renders stereo frames (2 views per frame)', r.active && r.xr.frames >= 6 && r.xr.views >= r.xr.frames * 2 - 2, r.xr],
    ['left stick walks the player head-relative (forward = -z)', moved > 0.05 && r.pos[1] < p0[1], { from: p0, to: r.pos }],
    ['A3D world and controller hands draw in VR', r.a3dDraws > 4, { draws: r.a3dDraws }],
    ['no page errors in the VR path', errors.length === 0, errors.slice(0, 5)],
  ];
  for (const [n, ok, d] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + n + ' — ' + JSON.stringify(d));
  fs.writeFileSync(path.join(out, 'xr_report.json'), JSON.stringify({ checks: checks.map(([name, ok, detail]) => ({ name, ok, detail })) }, null, 2));
  await browser.close(); srv.close();
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
