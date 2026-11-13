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

const { SHOTS, camAt } = require('./shots.cjs');
const TOUCH = !(argv.includes('--touch') && argv[argv.indexOf('--touch') + 1] === 'off');   // off for Steam / Meta footage
const PORT = 8800 + Math.floor(Math.random() * 90);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(PORT);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: TOUCH });
  page.setDefaultTimeout(300000);
  await page.goto('http://localhost:' + PORT + '/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 180000 });
  await page.evaluate((q) => { localStorage.clear(); ICEWALK_VISUALS.quality = q; }, argv.includes('--hq') ? 'cinematic' : 'balanced');
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') { await page.click('#startBtn'); await page.waitForTimeout(300); }
  const meta = [];
  for (const shot of SHOTS) {
    if (ONLY && !ONLY.includes(shot.id)) continue;
    const dir = path.join(OUT, shot.id); fs.mkdirSync(dir, { recursive: true });
    const want = Math.round(shot.secs * FPS);
    // resumable: a shot whose frames are all on disk is kept (a restart of the machine loses only the shot in progress)
    if (fs.existsSync(path.join(dir, 'done')) && fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length === want) {
      meta.push({ id: shot.id, frames: want, secs: shot.secs, hud: shot.hud }); console.log('kept', shot.id); continue;
    }
    const k0 = camAt(shot.keys, 0);
    await page.evaluate(([s, k0]) => {
      ICEWALK_ENGINE.continueFrom({ player: { x: k0.x, z: k0.z, yaw: k0.yaw, pitch: k0.pitch }, mission: s.mission, elapsed: 300, torch: !!s.torch },
        () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(s.a3d); });
      document.getElementById('storyRadio')?.classList.remove('visible'); document.getElementById('notice').classList.remove('show');
      if (ICEWALK_IMMERSIVE.enabled === s.hud) ICEWALK_IMMERSIVE.toggle();   // immersive = HUD hidden
      if (s.warmth !== undefined) ICEWALK_ENGINE.player.warmth = s.warmth;
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
      await page.evaluate(([c, evs, dt, warm]) => {
        const p = ICEWALK_ENGINE.player; const ox = p.x, oz = p.z;
        p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = c.pitch;
        for (const [, ev] of evs) {
          if (ev.startsWith('crystal')) { const a = ANTARKTIKA3D.world.anchors.find((q) => q.id === ev); p.x = a.x; p.z = a.z; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'e' })); p.x = c.x; p.z = c.z; }
          else { window.dispatchEvent(new KeyboardEvent('keydown', { key: ev })); window.dispatchEvent(new KeyboardEvent('keyup', { key: ev })); }
        }
        ICEWALK_ENGINE.step(dt, 1);
        p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = c.pitch;   // keep the scripted camera exact
        if (warm !== undefined) p.warmth = warm;
        ICEWALK_ENGINE.renderView();
      }, [c, evs, 1 / FPS, shot.warmth]);
      await page.screenshot({ path: path.join(dir, String(f + 1).padStart(5, '0') + '.png') });
    }
    fs.writeFileSync(path.join(dir, 'done'), '');
    meta.push({ id: shot.id, frames: n, secs: shot.secs, hud: shot.hud });
    console.log('captured', shot.id, n);
    await page.evaluate(() => { window.ANTARKTIKA_XR.active = false; });
  }
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ fps: FPS, size: [W, H], shots: meta }, null, 2));
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
