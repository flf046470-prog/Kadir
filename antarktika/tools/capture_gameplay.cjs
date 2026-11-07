/* Scripted in-engine capture for the trailer and the App Store app preview.
 * The engine's own loop is paused; every frame is stepped (fixed 1/FPS) and
 * rendered deterministically, then screenshotted with the HUD as the player sees it.
 *
 * node tools/capture_gameplay.cjs <outDir> [--fps 30] [--size 1920x886] [--only g1,g2]
 * Writes <outDir>/<shot>/00001.png ... and shots.json (durations, events). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const serve = require('./serve.cjs');
const argv = process.argv.slice(2);
const OUT = path.resolve(argv[0] || 'capture');
const FPS = +(argv[argv.indexOf('--fps') + 1] || 30) || 30;
const [W, H] = (argv.includes('--size') ? argv[argv.indexOf('--size') + 1] : '1920x886').split('x').map(Number);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

// Each shot: initial game state, a camera path (x,z,yaw,pitch keys) and timed events.
const SHOTS = [
  { id: 'g1_match', secs: 3.5, hud: false, torch: false, mission: 0, a3d: {}, keys: [[0, -2.0, 33.0, 1.35, 0.02], [1, 0.6, 31.2, 1.42, 0.0]] },
  { id: 'g2_ramp_door', secs: 4.5, hud: true, mission: 0, a3d: {}, keys: [[0, 3.0, 27.0, 1.5708, 0.02], [0.75, 11.4, 27.0, 1.5708, 0.0], [1, 13.6, 27.0, 1.62, -0.03]] },
  { id: 'g3_generator', secs: 3.5, hud: true, mission: 0, a3d: {}, keys: [[0, 11.2, 33.8, 1.3, -0.06], [1, 12.6, 34.6, 1.45, -0.04]], events: [[0.45, 'e']] },
  { id: 'g4_lab_power', secs: 3.5, hud: false, mission: 2, a3d: { power: true }, keys: [[0, 16.6, 27.4, 1.9, -0.05], [1, 18.4, 26.4, 2.2, -0.07]] },
  { id: 'g5_frequency', secs: 4.0, hud: true, mission: 2, a3d: { power: true }, keys: [[0, 28.4, 26.8, -0.15, -0.12], [1, 28.9, 25.6, -0.05, -0.18]], events: [[0.15, 'e'], [0.35, 'e'], [0.55, 'e']] },
  { id: 'g6_cave_torch', secs: 4.5, hud: false, torch: true, mission: 3, a3d: { power: true, freqSolved: true }, keys: [[0, -8.6, -29.0, 0.0, 0.04], [1, -8.3, -38.5, 0.04, 0.06]] },
  { id: 'g7_crystals', secs: 4.0, hud: true, torch: true, mission: 3, a3d: { power: true, freqSolved: true, glyphRead: true }, keys: [[0, -8.2, -42.0, 0.05, 0.12], [1, -8.1, -43.4, 0.05, 0.14]], events: [[0.05, 'q'], [0.3, 'crystal1'], [0.5, 'crystal2'], [0.7, 'crystal3']] },
  { id: 'g8_selin', secs: 3.5, hud: true, mission: 3, a3d: { power: true }, npc: [17.5, 18.4, Math.PI], keys: [[0, 17.4, 22.5, 0.0, -0.1], [1, 17.5, 21.3, 0.0, -0.12]], events: [[0.35, 'e']] },
  { id: 'g9_wide', secs: 3.0, hud: false, mission: 3, a3d: { power: true }, keys: [[0, -14, 44, 0.95, 0.05], [1, -12, 42.5, 1.0, 0.06]] },
];

function camAt(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1], u = ease(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
  return { x: lerp(a[1], b[1], u), z: lerp(a[2], b[2], u), yaw: lerp(a[3], b[3], u), pitch: lerp(a[4], b[4], u) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(8770);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  await page.goto('http://localhost:8770/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 180000 });
  await page.evaluate((q) => { localStorage.clear(); ICEWALK_VISUALS.quality = q; }, argv.includes('--hq') ? 'cinematic' : 'balanced');
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') { await page.click('#startBtn'); await page.waitForTimeout(300); }
  const meta = [];
  for (const shot of SHOTS) {
    if (ONLY && !ONLY.includes(shot.id)) continue;
    const dir = path.join(OUT, shot.id); fs.mkdirSync(dir, { recursive: true });
    const k0 = camAt(shot.keys, 0);
    await page.evaluate(([s, k0]) => {
      ICEWALK_ENGINE.continueFrom({ player: { x: k0.x, z: k0.z, yaw: k0.yaw, pitch: k0.pitch }, mission: s.mission, elapsed: 300, torch: !!s.torch },
        () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(s.a3d); });
      document.getElementById('notice').classList.remove('show');
      if (ICEWALK_IMMERSIVE.enabled === s.hud) ICEWALK_IMMERSIVE.toggle();   // immersive = HUD hidden
      if (s.npc) ANTARKTIKA3D.npcPlace(s.npc[0], s.npc[1], s.npc[2], 30);
      ICEWALK_MESHY.setPlaying(true);
      window.ANTARKTIKA_XR = window.ANTARKTIKA_XR || {}; window.ANTARKTIKA_XR.active = true;   // pause the engine's own loop
      document.getElementById('perfOverlay') && (document.getElementById('perfOverlay').style.display = 'none');
    }, [shot, k0]);
    // settle doors, NPC pose and lights before the first captured frame
    await page.evaluate(() => ICEWALK_ENGINE.step(1 / 30, 20));
    const n = Math.round(shot.secs * FPS), fired = new Set();
    for (let f = 0; f < n; f++) {
      const t = f / (n - 1);
      const c = camAt(shot.keys, t);
      const evs = (shot.events || []).filter(([at], i) => t >= at && !fired.has(i) && fired.add(i));
      await page.evaluate(([c, evs, dt]) => {
        const p = ICEWALK_ENGINE.player; const ox = p.x, oz = p.z;
        p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = c.pitch;
        for (const [, ev] of evs) {
          if (ev.startsWith('crystal')) { const a = ANTARKTIKA3D.world.anchors.find((q) => q.id === ev); p.x = a.x; p.z = a.z; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'e' })); p.x = c.x; p.z = c.z; }
          else { window.dispatchEvent(new KeyboardEvent('keydown', { key: ev })); window.dispatchEvent(new KeyboardEvent('keyup', { key: ev })); }
        }
        ICEWALK_ENGINE.step(dt, 1);
        p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = c.pitch;   // keep the scripted camera exact
        ICEWALK_ENGINE.renderView();
      }, [c, evs, 1 / FPS]);
      await page.screenshot({ path: path.join(dir, String(f + 1).padStart(5, '0') + '.png') });
    }
    meta.push({ id: shot.id, frames: n, secs: shot.secs, hud: shot.hud });
    console.log('captured', shot.id, n);
    await page.evaluate(() => { window.ANTARKTIKA_XR.active = false; });
  }
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ fps: FPS, size: [W, H], shots: meta }, null, 2));
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
