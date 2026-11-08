/* Chapter 6 (winter siege: coalition drill camp, thermal drones, pump, relay, soldier) gameplay test.
 * node tools/chapter6_test.cjs [shotDir] */
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve.cjs');
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
(async () => {
  const srv = await serve(8780);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 443 } });
  page.setDefaultTimeout(240000);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8780/index.html?forcewebgl=1');
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
  const setWarm = (w) => page.evaluate((w) => { ICEWALK_ENGINE.player.warmth = w; }, w);
  const hud = (id) => page.evaluate((id) => new Promise((r) => { ICEWALK_ENGINE.step(1 / 30, 1); setTimeout(() => r(document.getElementById(id)?.textContent), 30); }), id);
  const walk = (x0, z0, dx, dz, n) => page.evaluate(([x0, z0, dx, dz, n]) => { let p = [x0, z0]; for (let i = 0; i < n; i++) p = ANTARKTIKA3D.collide(p[0], p[1], p[0] + dx, p[1] + dz, 0.32); return p; }, [x0, z0, dx, dz, n]);
  const A = await page.evaluate(() => Object.fromEntries(ANTARKTIKA3D.world.anchors.map((a) => [a.id, { x: a.x, y: a.y, z: a.z, layer: a.layer }])));
  check('camp loaded: tunnel exit, spawn, pump, relay, soldier', ['camp_exit', 'camp_spawn', 'pump', 'relay', 'soldier'].every((k) => A[k] && A[k].layer === 'camp'));
  const cover = await page.evaluate(() => ANTARKTIKA3D.world.volumes.filter((v) => v.zone === 'cover' && v.layer === 'camp').length);
  check('five snow-block windbreaks are cover volumes', cover === 5, cover);

  const ch5 = { power: true, freqSolved: true, crystals: 3, caveSolved: true, glyphRead: true, bb: [1, 1, 1, 1], bbSeen: [1, 1, 1, 1], ch2: true, kaanSeen: true, heatCell: 2, kaanFree: true, kaanTalk: 3, kaanTrust: 1, steles: [1, 1, 1, 1, 1], stars: [1, 3, 0, 4], ch3: true, syms: [1, 1, 1, 1, 1, 1], stones: [1, 1, 1], bridge: true, voice: 3, ch4: true, ending4: 'cevap', plane5: 1, cable5: 1, grid5: true, ch5: true, load5: 'denge', dials: [1, 2, 0], tutorial: { hall: 1, city: 1, grid: 1 } };
  const camp = (extra = {}) => ({ ...ch5, inCamp: true, ...extra });
  const O = { x: A.camp_exit.x, z: A.camp_exit.z - 1.8 };

  // ---- entry from the core chamber
  await place(A.core.x, A.core.z + 2, { ...ch5, inGrid: true }); await step(2);
  const goal = await hud('missionName');
  check('after chapter 5 the HUD sends the player to the core (north tunnel)', /BÖLÜM 6/.test(goal || '') && /TÜNEL/.test(goal || ''), goal);
  await place(A.pump.x, A.pump.z, { ...ch5, inGrid: true });
  check('camp anchors are inert outside the camp', (await E(A.pump.x, A.pump.z)) == null);
  await place(A.core.x, A.core.z + 2, { ...ch5, inGrid: true });
  const enter = await E(A.core.x, A.core.z); await step(3);
  let pl = await P(), s = await st();
  check('the core opens the north tunnel into the camp (layer camp)', s.inCamp && !s.inGrid && pl.zone === 'camp' && /BÖLÜM 6/.test(enter || ''), { enter, pl });
  const temp = await hud('temperature');
  check('camp HUD: −11°C', /−11°C/.test(temp || ''), temp);

  // ---- geometry: tunnel passes, dome rim clamps
  const inside = await walk(A.camp_spawn.x, A.camp_spawn.z, 0, -0.1, 200);
  check('the tunnel leads north into the cavern', inside[1] < A.camp_spawn.z - 15, inside);
  const far = await walk(O.x, O.z - 15, -0.4, -0.1, 400);
  const lx = far[0] - O.x, lz = far[1] - O.z, q = (lx / 20.8) ** 2 + ((lz + 28) / 22.8) ** 2;
  check('the cavern wall holds the player (ellipse clamp)', q <= 1.01 && lz < -5, { lx, lz, q });

  // ---- thermal drones
  const r100 = await page.evaluate(() => [ANTARKTIKA3D.detectRange(100, false), ANTARKTIKA3D.detectRange(100, true), ANTARKTIKA3D.detectRange(30, false)]);
  check('warm bodies are seen farther; cover halves the distance', r100[0] > r100[2] && r100[1] < r100[0] * 0.5 && r100[0] > 11 && r100[2] < 8, r100);
  await place(A.camp_spawn.x, A.camp_spawn.z, camp()); await setWarm(100); await step(90);
  s = await st(); pl = await P();
  check('standing in the tunnel mouth, far from the drones: unseen', s.spot6 === 0 && Math.hypot(pl.x - A.camp_spawn.x, pl.z - A.camp_spawn.z) < 0.5, { spot: s.spot6 });
  const dp0 = await page.evaluate(() => ANTARKTIKA3D.dronePos(0));
  const dp1 = await page.evaluate(() => { ICEWALK_ENGINE.step(1 / 30, 30); return ANTARKTIKA3D.dronePos(0); });
  check('the drone patrols (position changes with time)', Math.hypot(dp0[0] - dp1[0], dp0[1] - dp1[1]) > 1, { dp0, dp1 });
  await page.evaluate(() => { const d = ANTARKTIKA3D.dronePos(0); const p = ICEWALK_ENGINE.player; p.x = d[0]; p.z = d[1]; p.warmth = 100; });
  await step(90);
  s = await st(); pl = await P();
  check('a warm body under a drone is caught and sent back to the tunnel', s.spot6 >= 1 && Math.hypot(pl.x - A.camp_spawn.x, pl.z - A.camp_spawn.z) < 2, { spot6: s.spot6, pl });

  // ---- pump: surge vs safe shutdown
  await place(A.camp_spawn.x, A.camp_spawn.z, camp()); await setWarm(100);
  const stop1 = await E(A.pump.x, A.pump.z);
  const burst = await E(A.pump.x, A.pump.z);
  s = await st();
  check('closing the valve under pressure bursts the hose (water hammer, spill)', /MOTOR DURDU/.test(stop1 || '') && /Hortum patladı/.test(burst || '') && s.pump6 === 3 && s.spill6 === 1, { stop1, burst });
  await place(A.camp_spawn.x, A.camp_spawn.z, camp()); await setWarm(100);
  await E(A.pump.x, A.pump.z);
  await step(60);
  const mid = (await st()).pumpP;
  await step(100);
  const end = (await st()).pumpP;
  const safe = await E(A.pump.x, A.pump.z);
  s = await st();
  check('waiting for the pressure to bleed off allows a clean shutdown', mid > 5 && mid < 30 && end < 1 && /güvenle/.test(safe || '') && s.pump6 === 2 && !s.spill6, { mid, end, safe });

  // ---- relay and soldier
  const relay = await E(A.relay.x, A.relay.z);
  const relay2 = await E(A.relay.x, A.relay.z);
  check('relay: unplugging the Iridium antenna cuts the link', /ANTEN FİŞİ ÇEKİLDİ/.test(relay || '') && /Link kopuk/.test(relay2 || '') && (await st()).relay6 === 1, { relay });
  await setWarm(100);
  await E(A.soldier.x, A.soldier.z);
  const buttons = await page.$$eval('#a3dChoice button', (b) => b.map((x) => x.textContent));
  await page.click('#a3dChoice button >> nth=0');
  s = await st(); pl = await P();
  check('the soldier offers two choices; saving him costs body heat', buttons.length === 2 && s.soldier6 === 'save' && pl.warmth <= 71 && pl.warmth >= 60, { buttons, warmth: pl.warmth });
  const cardA = (await page.isVisible('#a3dEndCard')) ? await page.textContent('#a3dEndCard') : '';
  check('three tasks done → chapter 6 end card (clean run, rescued, unseen)', s.ch6 && /KUTUP GECESİ/.test(cardA) && /tek damla/.test(cardA) && /Dagan nefes alıyor/.test(cardA) && /Bölüm 7/.test(cardA), { s6: s.ch6 });
  await page.click('#a3dEndCard button');

  // ---- the other branch
  await place(A.camp_spawn.x, A.camp_spawn.z, camp({ pump6: 3, spill6: 1, relay6: 1, spot6: 2 }));
  await E(A.soldier.x, A.soldier.z);
  await page.click('#a3dChoice button >> nth=1');
  s = await st();
  const cardB = (await page.isVisible('#a3dEndCard')) ? await page.textContent('#a3dEndCard') : '';
  check('other branch: hose burst, soldier left, spotted twice → different ending text', s.ch6 && s.soldier6 === 'leave' && /kerosen/.test(cardB) && /bıraktın/.test(cardB) && /2 kez/.test(cardB), { cardB: cardB.slice(0, 80) });
  await page.click('#a3dEndCard button');
  const goal6 = await hud('missionName');
  check('HUD shows chapter 6 completed', /BÖLÜM 6 TAMAMLANDI/.test(goal6 || ''), goal6);

  // ---- render, save/continue inside the camp, then leave through the tunnel
  await place(A.camp_spawn.x, A.camp_spawn.z, camp({ pump6: 2, relay6: 1, soldier6: 'save', ch6: true }));
  const stats = await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; p.yaw = 0; p.pitch = 0.02; ICEWALK_ENGINE.step(1 / 30, 2); ICEWALK_ENGINE.renderView(); return ANTARKTIKA3D.diagnostics().stats; }, [A.camp_spawn.x, A.camp_spawn.z - 6]);
  check('camp renders (draw calls, lights)', stats.draws >= 5 && stats.lights > 0, stats);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'camp_view.png') });
  await page.evaluate(() => ANTARKTIKA_SAVE.save());
  await page.reload();
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.click('#continueBtn'); await page.waitForTimeout(600); await step(2);
  s = await st(); pl = await P();
  check('chapter 6 progress (in the camp) survives save/continue', s.ch6 && s.inCamp && s.pump6 === 2 && s.relay6 === 1 && s.soldier6 === 'save' && pl.zone === 'camp', { ch6: s.ch6, inCamp: s.inCamp, zone: pl.zone });
  const back = await E(A.camp_exit.x, A.camp_exit.z); await step(2); pl = await P(); s = await st();
  check('the tunnel leads back to the core chamber', s.inGrid && !s.inCamp && pl.zone === 'grid' && /İLETİM GALERİSİ/.test(back || ''), { back, pl });
  check('no page errors', errs.length === 0, errs);
  console.log('passed', pass, 'failed', fail);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
