/* In-engine stills for the App Store screenshots (6.9" iPhone landscape, 2868×1320).
 * Uses the same scripted shots as capture_gameplay.cjs: the game is stepped to time t of
 * each shot (firing its events on the way) and one frame is rendered at device scale 2.
 *
 * node tools/capture_stills.cjs <outDir> [--hq]
 * Writes <outDir>/<nn>_<shot>.png (raw, no captions). Captions: tools/make_store_images.py */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const serve = require('./serve.cjs');
const { SHOTS, camAt } = require('./shots.cjs');
const argv = process.argv.slice(2);
const OUT = path.resolve(argv[0] || 'stills');
// [shot id, t in 0..1] — chosen so each still shows one selling point
const STILLS = [['g2_ramp_door', 0.55], ['g3_generator', 0.8], ['g5_frequency', 0.75], ['g6_cave_torch', 0.6], ['g7_crystals', 0.85], ['g8_selin', 0.7], ['g9_wide', 0.5]];
const STEP = 1 / 10;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(8773);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1434, height: 660 }, deviceScaleFactor: 2, hasTouch: true });
  page.setDefaultTimeout(600000);
  await page.goto('http://localhost:8773/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 300000 });
  await page.evaluate((q) => { localStorage.clear(); ICEWALK_VISUALS.quality = q; }, argv.includes('--hq') ? 'cinematic' : 'balanced');
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') { await page.click('#startBtn'); await page.waitForTimeout(300); }
  let n = 0;
  for (const [id, tEnd] of STILLS) {
    const shot = SHOTS.find((s) => s.id === id);
    const k0 = camAt(shot.keys, 0);
    await page.evaluate(([s, k0]) => {
      ICEWALK_ENGINE.continueFrom({ player: { x: k0.x, z: k0.z, yaw: k0.yaw, pitch: k0.pitch }, mission: s.mission, elapsed: 300, torch: !!s.torch },
        () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(s.a3d); });
      document.getElementById('notice').classList.remove('show');
      if (ICEWALK_IMMERSIVE.enabled === s.hud) ICEWALK_IMMERSIVE.toggle();
      if (s.npc) ANTARKTIKA3D.npcPlace(s.npc[0], s.npc[1], s.npc[2], 30);
      ICEWALK_MESHY.setPlaying(true);
      window.ANTARKTIKA_XR = window.ANTARKTIKA_XR || {}; window.ANTARKTIKA_XR.active = true;
      document.getElementById('perfOverlay') && (document.getElementById('perfOverlay').style.display = 'none');
      ICEWALK_ENGINE.step(1 / 30, 20);
    }, [shot, k0]);
    // step (logic only) up to tEnd, firing the shot's events at their times
    const steps = Math.max(1, Math.round(shot.secs * tEnd / STEP));
    const plan = [];
    const fired = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * tEnd;
      const evs = (shot.events || []).filter(([at], j) => t >= at && !fired.has(j) && fired.add(j)).map((e) => e[1]);
      plan.push([camAt(shot.keys, t), evs]);
    }
    await page.evaluate(([plan, dt]) => {
      const p = ICEWALK_ENGINE.player;
      const key = (k) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); };
      for (const [c, evs] of plan) {
        p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = c.pitch;
        for (const ev of evs) {
          if (ev.startsWith('crystal')) { const a = ANTARKTIKA3D.world.anchors.find((q) => q.id === ev); p.x = a.x; p.z = a.z; key('e'); p.x = c.x; p.z = c.z; }
          else key(ev);
        }
        ICEWALK_ENGINE.step(dt, 1);
        p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = c.pitch;
      }
      ICEWALK_ENGINE.renderView();
    }, [plan, STEP]);
    const file = path.join(OUT, `${String(++n).padStart(2, '0')}_${id}.png`);
    await page.screenshot({ path: file });
    console.log('still', file);
    await page.evaluate(() => { window.ANTARKTIKA_XR.active = false; });
  }
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
