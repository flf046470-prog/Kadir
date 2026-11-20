/* Chapter 4 (lake basin, crystal language, three answers) gameplay test.
 * node tools/chapter4_test.cjs [shotDir] */
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve.cjs');
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
(async () => {
  const srv = await serve(8777);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 443 } });
  page.setDefaultTimeout(240000);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8777/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') await page.click('#startBtn');
  const place = (x, z, a3d) => page.evaluate(([x, z, a3d]) => ICEWALK_ENGINE.continueFrom({ player: { x, z, yaw: 0, pitch: 0 }, mission: 3, elapsed: 60 },
    () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(a3d); }), [x, z, a3d]);
  const st = () => page.evaluate(() => ANTARKTIKA3D.serialize());
  const E = (x, z) => page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [x, z]);
  const Q = (x, z) => page.evaluate(([x, z]) => ANTARKTIKA3D.onScan(x, z), [x, z]);
  const P = () => page.evaluate(() => ({ x: ICEWALK_ENGINE.player.x, z: ICEWALK_ENGINE.player.z, zone: ANTARKTIKA3D.diagnostics().zone }));
  const step = (n = 2) => page.evaluate((n) => ICEWALK_ENGINE.step(1 / 30, n), n);
  const walk = (x0, z0, dx, dz, n) => page.evaluate(([x0, z0, dx, dz, n]) => { let p = [x0, z0]; for (let i = 0; i < n; i++) p = ANTARKTIKA3D.collide(p[0], p[1], p[0] + dx, p[1] + dz, 0.32); return p; }, [x0, z0, dx, dz, n]);
  const A = await page.evaluate(() => Object.fromEntries(ANTARKTIKA3D.world.anchors.map((a) => [a.id, { x: a.x, y: a.y, z: a.z, layer: a.layer }])));
  check('basin loaded: exit, spawn, three symbol stones, bridge stone, spire', ['city_exit', 'city_spawn', 'sym1', 'sym2', 'sym3', 'bridgestone', 'spire'].every((k) => A[k] && A[k].layer === 'city'));

  const ch3 = { power: true, freqSolved: true, crystals: 3, caveSolved: true, glyphRead: true, bb: [1, 1, 1, 1], bbSeen: [1, 1, 1, 1], ch2: true, inHall: true, kaanSeen: true, heatCell: 2, kaanFree: true, kaanTalk: 3, kaanTrust: 1, steles: [1, 1, 1, 1, 1], stars: [1, 3, 0, 4], ch3: true, tutorial: { hall: 1 } };
  await place(A.gate4.x, A.gate4.z + 1, { ...ch3, ch3: false, stars: [] });
  check('three-ring gate stays sealed before chapter 3 is done', /Mühürlü/.test((await E(A.gate4.x, A.gate4.z)) || '') && !(await st()).inCity);
  await place(A.spire.x, A.spire.z, { ...ch3, inHall: false });
  check('basin anchors are inert outside the basin', (await E(A.spire.x, A.spire.z)) == null);

  await place(A.gate4.x, A.gate4.z + 1, ch3);
  const enter = await E(A.gate4.x, A.gate4.z); await step(3);
  let pl = await P(), s = await st();
  const gy = await page.evaluate(([x, z]) => ANTARKTIKA3D.groundY(x, z), [pl.x, pl.z]);
  check('gate opens into the lake basin (chapter 4 starts)', s.inCity && !s.inHall && /BÖLÜM 4/.test(enter || '') && pl.zone === 'city', { enter, pl });
  check('player stands on the entry terrace (not on the surface)', Math.abs(gy - A.city_spawn.y) < 0.2, { gy, spawn: A.city_spawn.y });
  // ramp: walking down from the terrace reaches the quay level
  const rampMid = await page.evaluate(([x, z]) => ANTARKTIKA3D.groundY(x, z), [A.city_spawn.x, A.city_spawn.z - 22]);
  check('ramp descends from the terrace to the quay', rampMid < A.city_spawn.y - 1 && rampMid > A.sym1.y + 0.5, { rampMid, terrace: A.city_spawn.y, quay: A.sym1.y });
  // before the bridge: the lake edge blocks the way to the island
  const blocked = await walk(A.bridgestone.x + 3.2, A.bridgestone.z, 0, -0.1, 140);
  check('lake edge blocks the way to the island before the bridge', blocked[1] > A.bridgestone.z - 4.5, blocked);
  const early = await E(A.bridgestone.x, A.bridgestone.z);
  check('bridge stone waits for two symbol stones', /Kıyıdaki iki sembol taşını oku/.test(early || '') && !(await st()).bridge, early);
  const r1 = await E(A.sym1.x, A.sym1.z);
  const r2 = await Q(A.sym2.x, A.sym2.z);
  s = await st();
  check('symbol stones teach the crystal language (E and scanner)', /BİZ/.test(r1 || '') && /SU/.test(r1 || '') && /ZAMAN/.test(r2 || '') && s.syms.slice(0, 4).every(Boolean) && !s.syms[4], { r1, r2, syms: s.syms });
  const br = await E(A.bridgestone.x, A.bridgestone.z);
  const opened = await walk(A.bridgestone.x + 3.2, A.bridgestone.z, 0, -0.1, 140);
  const bridgeY = await page.evaluate(([x, z]) => ANTARKTIKA3D.groundY(x, z), [A.bridgestone.x + 3.2, A.bridgestone.z - 6]);
  check('bridge rises and carries the player to the island', (await st()).bridge && /KÖPRÜ/.test(br || '') && opened[1] < A.bridgestone.z - 8 && bridgeY > A.sym1.y - 0.1, { br, opened, bridgeY });
  const v1 = await E(A.spire.x, A.spire.z);
  const v2a = await E(A.spire.x, A.spire.z);
  check('spire speaks; an unknown symbol leaves the line untranslated', /zamanı tutarız/.test(v1 || '') && /çeviri eksik/.test(v2a || '') && (await st()).voice === 1, { v1, v2a });
  const r3 = await E(A.sym3.x, A.sym3.z);
  const v2 = await E(A.spire.x, A.spire.z);
  const v3 = await E(A.spire.x, A.spire.z);
  check('island stone completes the dictionary; the spire is understood', /Sözlük 6\/6/.test(r3 || '') && /kapısını açtınız/.test(v2 || '') && /Seçim sizin/.test(v3 || ''), { r3, v2, v3 });
  await E(A.spire.x, A.spire.z);
  const buttons = await page.$$eval('#a3dChoice button', (b) => b.map((x) => x.textContent));
  await page.click('#a3dChoice button >> nth=1', { timeout: 8000 });
  s = await st();
  const card = await page.isVisible('#a3dEndCard');
  const cardText = card ? await page.textContent('#a3dEndCard') : '';
  check('three answers offered; choosing one completes chapter 4 with an end card', buttons.length === 3 && s.ch4 && s.ending4 === 'cevap' && card && /CEVAP VER/.test(cardText) && /uydu|Antlaşma/.test(cardText), { buttons, ending: s.ending4 });
  await page.click('#a3dEndCard button');
  check('end card closes', !(await page.isVisible('#a3dEndCard')));
  const hud = await page.evaluate(() => new Promise((r) => { ICEWALK_ENGINE.step(1 / 30, 1); setTimeout(() => r(document.getElementById('temperature')?.textContent), 30); }));
  check('basin HUD temperature (geothermal lake, −4°C)', /−4°C/.test(hud || ''), hud);
  const stats = await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; p.yaw = 0; p.pitch = 0.05; ICEWALK_ENGINE.step(1 / 30, 2); ICEWALK_ENGINE.renderView(); return ANTARKTIKA3D.diagnostics().stats; }, [A.city_spawn.x, A.city_spawn.z - 10]);
  check('basin renders (draw calls, lights)', stats.draws > 5 && stats.lights > 0, stats);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'city_terrace.png') });
  // back to the hall and save/continue in the basin
  const back = await E(A.city_exit.x, A.city_exit.z); await step(2); pl = await P(); s = await st();
  check('return portal leads back to the hall', s.inHall && !s.inCity && pl.zone === 'hall' && /SALON/.test(back || ''), { back, pl });
  await E(A.gate4.x, A.gate4.z); await step(2);
  await page.evaluate(() => ANTARKTIKA_SAVE.save());
  await page.reload();
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.click('#continueBtn'); await page.waitForTimeout(600); await step(2);
  s = await st(); pl = await P();
  check('chapter 4 progress (in the basin) survives save/continue', s.ch4 && s.inCity && s.bridge && s.ending4 === 'cevap' && pl.zone === 'city', { ch4: s.ch4, inCity: s.inCity, zone: pl.zone });
  check('no page errors', errs.length === 0, errs);
  console.log('passed', pass, 'failed', fail);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
