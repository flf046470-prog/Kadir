/* In-engine views of the chapter 3 hall (visual check / store shots).
 * node tools/hall_shots.cjs <outDir> [WxH] */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const serve = require('./serve.cjs');
const OUT = path.resolve(process.argv[2] || 'hall_shots');
const [W, H] = (process.argv[3] || '960x443').split('x').map(Number);
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(8776);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true });
  page.setDefaultTimeout(300000);
  await page.goto('http://localhost:8776/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 300000 });
  await page.evaluate(() => { localStorage.clear(); ICEWALK_VISUALS.quality = 'balanced'; });
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') await page.click('#startBtn');
  const A = await page.evaluate(() => Object.fromEntries(ANTARKTIKA3D.world.anchors.map((a) => [a.id, { x: a.x, z: a.z }])));
  const base = { power: true, freqSolved: true, crystals: 3, caveSolved: true, glyphRead: true, bb: [1, 1, 1, 1], bbSeen: [1, 1, 1, 1], ch2: true, inHall: true, tutorial: { hall: 1, kaanHint: 1 } };
  const shots = [
    ['kaan_frozen', { ...base, kaanSeen: true }, A.kaan.x - 1.6, A.kaan.z + 0.6, Math.PI / 2 + 0.3, -0.18],
    ['kaan_free', { ...base, kaanSeen: true, heatCell: 2, kaanFree: true, kaanTalk: 3, kaanTrust: 1 }, A.kaan.x - 1.5, A.kaan.z - 0.5, Math.PI / 2 - 0.35, -0.2],
    ['hall_wide', { ...base, kaanSeen: true }, A.hall_spawn.x + 1.5, A.hall_spawn.z - 3, -0.12, 0.12],
    ['hall_done', { ...base, kaanSeen: true, heatCell: 2, kaanFree: true, kaanTalk: 3, kaanTrust: 1, stars: [1, 3, 0, 4], steles: [1, 1, 1, 1, 1], ch3: true }, A.dais.x - 2, A.dais.z + 7, 0.1, 0.1],
  ];
  for (const [name, st, x, z, yaw, pitch] of shots) {
    await page.evaluate(([st, x, z, yaw, pitch]) => {
      ICEWALK_ENGINE.continueFrom({ player: { x, z, yaw, pitch }, mission: 3, elapsed: 300 },
        () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(st); });
      document.getElementById('storyRadio')?.classList.remove('visible'); document.getElementById('notice')?.classList.remove('show');
      window.ANTARKTIKA_XR = window.ANTARKTIKA_XR || {}; window.ANTARKTIKA_XR.active = true;
      const p = ICEWALK_ENGINE.player; ICEWALK_ENGINE.step(1 / 30, 20); p.x = x; p.z = z; p.yaw = yaw; p.pitch = pitch;
      ICEWALK_ENGINE.step(1 / 30, 1); p.yaw = yaw; p.pitch = pitch; ICEWALK_ENGINE.renderView();
    }, [st, x, z, yaw, pitch]);
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    const hud = await page.evaluate(() => ['missionName', 'distance', 'temperature'].map((id) => document.getElementById(id)?.textContent));
    console.log(name, JSON.stringify(hud));
    await page.evaluate(() => { window.ANTARKTIKA_XR.active = false; });
  }
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
