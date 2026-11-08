/* Chapter 5 (last aircraft, grid gallery, synchronising two networks) gameplay test.
 * node tools/chapter5_test.cjs [shotDir] */
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve.cjs');
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
(async () => {
  const srv = await serve(8778);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 443 } });
  page.setDefaultTimeout(240000);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8778/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') await page.click('#startBtn');
  const place = (x, z, a3d) => page.evaluate(([x, z, a3d]) => ICEWALK_ENGINE.continueFrom({ player: { x, z, yaw: 0, pitch: 0 }, mission: 3, elapsed: 60 },
    () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(a3d); }), [x, z, a3d]);
  const st = () => page.evaluate(() => ANTARKTIKA3D.serialize());
  const E = (x, z) => page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [x, z]);
  const P = () => page.evaluate(() => ({ x: ICEWALK_ENGINE.player.x, z: ICEWALK_ENGINE.player.z, warmth: ICEWALK_ENGINE.player.warmth, zone: ANTARKTIKA3D.diagnostics().zone }));
  const step = (n = 2) => page.evaluate((n) => ICEWALK_ENGINE.step(1 / 30, n), n);
  const tp = (x, z) => page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; }, [x, z]);
  const hud = (id) => page.evaluate((id) => new Promise((r) => { ICEWALK_ENGINE.step(1 / 30, 1); setTimeout(() => r(document.getElementById(id)?.textContent), 30); }), id);
  const walk = (x0, z0, dx, dz, n) => page.evaluate(([x0, z0, dx, dz, n]) => { let p = [x0, z0]; for (let i = 0; i < n; i++) p = ANTARKTIKA3D.collide(p[0], p[1], p[0] + dx, p[1] + dz, 0.32); return p; }, [x0, z0, dx, dz, n]);
  const A = await page.evaluate(() => Object.fromEntries(ANTARKTIKA3D.world.anchors.map((a) => [a.id, { x: a.x, y: a.y, z: a.z, layer: a.layer }])));
  check('gallery loaded: ladder, spawn, three junctions, cable, synchroscope, core', ['grid_exit', 'grid_spawn', 'j1', 'j2', 'j3', 'cable', 'sync', 'core'].every((k) => A[k] && A[k].layer === 'grid'));

  const ch4 = { power: true, freqSolved: true, crystals: 3, caveSolved: true, glyphRead: true, bb: [1, 1, 1, 1], bbSeen: [1, 1, 1, 1], ch2: true, kaanSeen: true, heatCell: 2, kaanFree: true, kaanTalk: 3, kaanTrust: 1, steles: [1, 1, 1, 1, 1], stars: [1, 3, 0, 4], ch3: true, syms: [1, 1, 1, 1, 1, 1], stones: [1, 1, 1], bridge: true, voice: 3, ch4: true, ending4: 'cevap', tutorial: { hall: 1, city: 1 } };
  // ---- the last aircraft
  await place(A.radio.x, A.radio.z, ch4); await step(2);
  const goal0 = await hud('missionName');
  check('after chapter 4 the HUD sends the player to the radio (last aircraft)', /BÖLÜM 5/.test(goal0 || '') && /TELSİZ/.test(goal0 || ''), goal0);
  await E(A.radio.x, A.radio.z);
  let buttons = await page.$$eval('#a3dChoice button', (b) => b.map((x) => x.textContent));
  await page.click('#a3dChoice button >> nth=1');
  let s = await st();
  let cardText = (await page.isVisible('#a3dEndCard')) ? await page.textContent('#a3dEndCard') : '';
  check('boarding the plane is an ending (AYRILIŞ) that can be undone at the radio', buttons.length === 2 && /AYRILIŞ/.test(cardText) && !s.plane5 && s.left5 === 1, { buttons, cardText: cardText.slice(0, 60) });
  await page.click('#a3dEndCard button');
  await E(A.radio.x, A.radio.z);
  await page.click('#a3dChoice button >> nth=0');
  s = await st();
  const jr = await page.evaluate(() => (ANTARKTIKA_SAVE?.journal?.() || ICEWALK_ENGINE.journal || []).length ?? 0).catch(() => 0);
  check('staying for the winter starts chapter 5', s.plane5 === 1 && !s.ch5, { plane5: s.plane5, jr });
  const radioAfter = await E(A.radio.x, A.radio.z);
  check('radio then points to the gallery (fuel lasts 83 days)', /83 gün/.test(radioAfter || ''), radioAfter);

  // ---- heat well → gallery
  const ventMsg0 = await (async () => { await place(A.vent.x, A.vent.z, { ...ch4, plane5: 0, inHall: true }); return E(A.vent.x, A.vent.z); })();
  check('before staying, the heat well only warms', /ısınıyorsun/.test(ventMsg0 || '') && !(await st()).inGrid, ventMsg0);
  await place(A.vent.x, A.vent.z, { ...ch4, plane5: 1, inHall: true });
  const enter = await E(A.vent.x, A.vent.z); await step(3);
  let pl = await P(); s = await st();
  const gy = await page.evaluate(([x, z]) => ANTARKTIKA3D.groundY(x, z), [pl.x, pl.z]);
  check('heat well leads down into the gallery (layer grid)', s.inGrid && !s.inHall && pl.zone === 'grid' && /GALERİ/.test(enter || '') && Math.abs(gy - A.grid_spawn.y) < 0.2, { enter, pl, gy });
  const side = await walk(A.grid_spawn.x, A.grid_spawn.z - 10, 0.1, 0, 80);
  check('gallery walls hold the player', side[0] < A.grid_spawn.x + 3.0, side);
  const deep = await walk(A.grid_spawn.x, A.grid_spawn.z, 0, -0.1, 600);
  check('the gallery runs ~50 m to the coupling chamber', deep[1] < A.grid_spawn.z - 45, deep);
  const t0 = await hud('temperature');
  check('gallery HUD: geothermal +4°C', /\+4°C/.test(t0 || ''), t0);

  // ---- cable, dials, protection trip
  await tp(A.sync.x, A.sync.z);
  const noCable = await E(A.sync.x, A.sync.z);
  check('synchroscope waits for the station cable', /bağlı değil/.test(noCable || ''), noCable);
  const cab = await E(A.cable.x, A.cable.z);
  check('station cable couples through the 840 m borehole', /KABLO BAĞLANDI/.test(cab || '') && (await st()).cable5 === 1, cab);
  await tp(A.sync.x, A.sync.z);
  const w0 = (await P()).warmth;
  const trip1 = await E(A.sync.x, A.sync.z);
  const tBlack = await hud('temperature');
  check('closing with mismatched settings trips the relay (blackout, cold)', /KARARTMA/.test(trip1 || '') && /UYUŞMUYOR/.test(trip1 || '') && /−18°C/.test(tBlack || '') && (await P()).warmth < w0, { trip1, tBlack });
  check('dials are dead during the blackout', /enerjisiz/.test((await E(A.j1.x, A.j1.z)) || ''));
  await step(190);
  const presses = [3, 2, 2];
  let last = [];
  for (let i = 0; i < 3; i++) { let m; for (let k = 0; k < presses[i]; k++) m = await E(A['j' + (i + 1)].x, A['j' + (i + 1)].z); last.push(m); }
  s = await st();
  check('three junctions set to the station values (400 V · 50 Hz · L1-L2-L3)', /400 V/.test(last[0]) && /50 Hz/.test(last[1]) && /L1-L2-L3/.test(last[2]) && s.dials.join() === '1,2,0', { last, dials: s.dials });

  // ---- synchroscope timing
  await tp(A.sync.x, A.sync.z);
  const start = await E(A.sync.x, A.sync.z);
  await step(1);
  const overlay = await page.isVisible('#a3dSync');
  check('synchronisation starts with a synchroscope needle on screen', /SENKRONİZASYON/.test(start || '') && /İSTASYON 400 V/.test(start || '') && overlay, start);
  await page.evaluate(() => { let n = 0; while (Math.abs(ANTARKTIKA3D.syncAngle()) < 90 && n++ < 200) ICEWALK_ENGINE.step(1 / 30, 1); });
  const ang = await page.evaluate(() => ANTARKTIKA3D.syncAngle());
  const late = await E(A.sync.x, A.sync.z);
  check('closing away from 12 o’clock trips on phase angle', /FAZ AÇISI/.test(late || '') && !(await st()).grid5, { ang, late });
  await step(190);
  await E(A.sync.x, A.sync.z);
  await page.evaluate(() => { let n = 0; while (Math.abs(ANTARKTIKA3D.syncAngle()) > 8 && n++ < 400) ICEWALK_ENGINE.step(1 / 30, 1); });
  const good = await E(A.sync.x, A.sync.z);
  s = await st();
  buttons = await page.$$eval('#a3dChoice button', (b) => b.map((x) => x.textContent));
  check('closing at 12 o’clock couples the networks (first contact pattern)', s.grid5 && /SENKRON/.test(good || '') && /◆ ≈ ◇/.test(good || ''), good);
  check('Selin and Kaan pull the load choice in different directions', buttons.length === 3 && /Selin/.test(buttons[0]) && /Kaan/.test(buttons[2]), buttons);
  await page.click('#a3dChoice button >> nth=1');
  s = await st();
  cardText = (await page.isVisible('#a3dEndCard')) ? await page.textContent('#a3dEndCard') : '';
  check('the load choice completes chapter 5 with an end card', s.ch5 && s.load5 === 'denge' && /PAYLAŞ/.test(cardText) && /Bölüm 6/.test(cardText), { load5: s.load5 });
  await page.click('#a3dEndCard button');
  const t1 = await hud('temperature');
  check('coupled gallery warms up (+9°C)', /\+9°C/.test(t1 || ''), t1);
  const core = await E(A.core.x, A.core.z);
  check('core answers in the crystal language after the choice', /◆ ◇/.test(core || ''), core);
  const stats = await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; p.yaw = 0; p.pitch = 0.02; ICEWALK_ENGINE.step(1 / 30, 2); ICEWALK_ENGINE.renderView(); return ANTARKTIKA3D.diagnostics().stats; }, [A.grid_spawn.x, A.grid_spawn.z - 6]);
  check('gallery renders (draw calls, lights)', stats.draws > 5 && stats.lights > 0, stats);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'grid_gallery.png') });

  // ---- ladder back up; save/continue inside the gallery
  const back = await E(A.grid_exit.x, A.grid_exit.z); await step(2); pl = await P(); s = await st();
  check('ladder leads back to the hall heat well', s.inHall && !s.inGrid && pl.zone === 'hall' && /SALON/.test(back || ''), { back, pl });
  await E(A.vent.x, A.vent.z); await step(2);
  await page.evaluate(() => ANTARKTIKA_SAVE.save());
  await page.reload();
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.click('#continueBtn'); await page.waitForTimeout(600); await step(2);
  s = await st(); pl = await P();
  check('chapter 5 progress (in the gallery) survives save/continue', s.ch5 && s.inGrid && s.grid5 && s.load5 === 'denge' && s.dials.join() === '1,2,0' && pl.zone === 'grid', { ch5: s.ch5, inGrid: s.inGrid, zone: pl.zone });
  check('no page errors', errs.length === 0, errs);
  console.log('passed', pass, 'failed', fail);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
