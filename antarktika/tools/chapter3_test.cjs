/* Chapter 3 (HELIKON hall) gameplay test. node tools/chapter3_test.cjs [shotDir] */
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve.cjs');
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
(async () => {
  const srv = await serve(8774);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 443 } });
  page.setDefaultTimeout(240000);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8774/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') await page.click('#startBtn');
  const place = (x, z, a3d) => page.evaluate(([x, z, a3d]) => ICEWALK_ENGINE.continueFrom({ player: { x, z, yaw: 0, pitch: 0 }, mission: 3, elapsed: 60 },
    () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(a3d); }), [x, z, a3d]);
  const st = () => page.evaluate(() => ANTARKTIKA3D.serialize());
  const E = (x, z) => page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [x, z]);
  const Q = (x, z) => page.evaluate(([x, z]) => ANTARKTIKA3D.onScan(x, z), [x, z]);
  const P = () => page.evaluate(() => ({ x: ICEWALK_ENGINE.player.x, z: ICEWALK_ENGINE.player.z, warmth: ICEWALK_ENGINE.player.warmth, zone: ANTARKTIKA3D.diagnostics().zone }));
  const step = (n = 2) => page.evaluate((n) => ICEWALK_ENGINE.step(1 / 30, n), n);
  const A = await page.evaluate(() => Object.fromEntries(ANTARKTIKA3D.world.anchors.map((a) => [a.id, { x: a.x, y: a.y, z: a.z, layer: a.layer }])));
  check('hall loaded: portal, Kaan, vent, dais, gate and five steles', ['hall_exit', 'hall_spawn', 'kaan', 'vent', 'dais', 'gate4', 'stele1', 'stele2', 'stele3', 'stele4', 'stele5'].every((k) => A[k] && A[k].layer === 'hall'));

  const ch2 = { power: true, freqSolved: true, crystals: 3, caveSolved: true, glyphRead: true, bb: [1, 1, 1, 1], bbSeen: [1, 1, 1, 1] };
  await place(A.glyph.x, A.glyph.z + 1.5, { ...ch2, ch2: false });
  const locked = await E(A.glyph.x, A.glyph.z);
  check('glyph gate stays shut before chapter 2 is done', /önce kara kutu/.test(locked || '') && !(await st()).inHall, locked);
  // hall anchors are not reachable from the surface, even standing on their x/z
  await place(A.kaan.x, A.kaan.z, { ...ch2, ch2: true });
  check('hall anchors are inert outside the hall', (await E(A.kaan.x, A.kaan.z)) == null);

  await place(A.glyph.x, A.glyph.z + 1.5, { ...ch2, ch2: true });
  const enter = await E(A.glyph.x, A.glyph.z); await step(3);
  let pl = await P(), s = await st();
  const gy = await page.evaluate(([x, z]) => ANTARKTIKA3D.groundY(x, z), [pl.x, pl.z]);
  check('glyph wall opens into the hall (chapter 3 starts)', s.inHall && /BÖLÜM 3/.test(enter || '') && pl.zone === 'hall' && Math.hypot(pl.x - A.hall_spawn.x, pl.z - A.hall_spawn.z) < 1.5, { enter, pl });
  check('hall floor carries the player (not the terrain above)', Math.abs(gy - A.hall_spawn.y) < 0.2, { gy, floor: A.hall_spawn.y });
  // walking: hall walls block, the surface terrain does not
  const walked = await page.evaluate(([x, z]) => { let p = [x, z]; for (let i = 0; i < 300; i++) p = ANTARKTIKA3D.collide(p[0], p[1], p[0] - 0.1, p[1], 0.32); return p; }, [pl.x, pl.z - 10]);   // walk 30 m west in 10 cm steps
  check('hall walls stop the player', walked[0] > A.hall_spawn.x - 11.7, walked);
  const pr = await page.evaluate(() => ANTARKTIKA3D.hallPressure());
  check('hall is cold (adds storm pressure)', pr > 0.2, pr);

  const frozen = await E(A.kaan.x, A.kaan.z);
  const silent = await E(A.stele1.x, A.stele1.z);
  check('Kaan is frozen and asks for the heat cell; steles stay silent', /ISI HÜCRES/.test(frozen || '') && /sessiz/.test(silent || '') && (await st()).kaanSeen, { frozen, silent });
  const back = await E(A.hall_exit.x, A.hall_exit.z); await step(2); pl = await P();
  check('return portal leads back to the cave', !(await st()).inHall && pl.zone === 'cave' && /MAĞARA/.test(back || ''), { back, pl });
  const cell = await E(A.generator.x, A.generator.z);
  check('generator yields the spare heat cell', (await st()).heatCell === 1 && /ISI HÜCRES/.test(cell || ''), cell);
  await E(A.glyph.x, A.glyph.z); await step(2);
  const thaw = await E(A.kaan.x, A.kaan.z);
  const ice = await page.evaluate(() => { ICEWALK_ENGINE.step(1 / 30, 1); ICEWALK_ENGINE.renderView(); return ANTARKTIKA3D.world.draw.filter((e) => e.ex.a3d_group === 'kaan_ice').map((e) => e.visible); });
  check('heat cell thaws Kaan (ice block disappears)', (await st()).kaanFree && /ERİTTİ/.test(thaw || '') && ice.length && ice.every((v) => !v), { thaw, ice });
  const lines = []; for (let i = 0; i < 3; i++) lines.push(await E(A.kaan.x, A.kaan.z));
  check('Kaan talks', lines.every((l) => /^KAAN/.test(l || '')), lines);
  await E(A.kaan.x, A.kaan.z);
  const hasChoice = await page.isVisible('#a3dChoice');
  const probe = await page.evaluate(() => { const b = document.querySelectorAll('#a3dChoice button')[1]; const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { rect: [r.x, r.y, r.width, r.height], hit: h && h.tagName + '#' + h.id, scroll: [scrollX, scrollY], vis: getComputedStyle(document.getElementById('a3dChoice')).visibility, lock: !!document.pointerLockElement, mode: ICEWALK_DIAGNOSTICS().mode }; });
  console.log('choice probe', JSON.stringify(probe));
  await page.click('#a3dChoice button >> nth=1', { timeout: 8000 });
  check('trust choice panel works (touch/click)', hasChoice && (await st()).kaanTrust === -1, await st().then((x) => x.kaanTrust));
  const scan3 = await Q(A.stele3.x, A.stele3.z);
  check('scanner reads a stele (constellation + clock mark)', /TERAZİ/.test(scan3 || '') && /03:41/.test(scan3 || ''), scan3);
  // wrong: the future clock
  await page.evaluate(() => { ICEWALK_ENGINE.player.warmth = 80; });
  const ok1 = await E(A.stele2.x, A.stele2.z);
  const bad = await E(A.stele3.x, A.stele3.z);
  pl = await P(); s = await st();
  check('lighting 03:41 (the future) resets the map and costs warmth', /1\/4/.test(ok1 || '') && /HENÜZ OLMADI/.test(bad || '') && s.stars.length === 0 && pl.warmth < 75, { ok1, bad, warmth: pl.warmth });
  const seq = [];
  for (const k of ['stele2', 'stele4', 'stele1', 'stele5']) seq.push(await E(A[k].x, A[k].z));
  s = await st();
  check('steles in clock order complete chapter 3', s.ch3 && s.stars.join() === '1,3,0,4' && /BÖLÜM 3 TAMAMLANDI/.test(seq[3] || ''), seq);
  const gate = await E(A.gate4.x, A.gate4.z);
  check('three-ring gate is awake (chapter 4 teaser)', /ÜÇ CEVAP KAPISI/.test(gate || ''), gate);
  // vent warms
  await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; p.warmth = 40; }, [A.vent.x, A.vent.z]);
  await step(60); pl = await P();
  check('the vent warms the player', pl.warmth > 44, pl.warmth);
  // a rendered frame inside the hall
  const stats = await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; p.yaw = 0; p.pitch = 0.05; ICEWALK_ENGINE.step(1 / 30, 2); ICEWALK_ENGINE.renderView(); return ANTARKTIKA3D.diagnostics().stats; }, [A.hall_spawn.x, A.hall_spawn.z]);
  check('hall renders (draw calls, lights)', stats.draws > 5 && stats.lights > 0, stats);
  if (SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'hall_entry.png') });
    await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; p.yaw = 0; p.pitch = 0.08; ICEWALK_ENGINE.step(1 / 30, 2); ICEWALK_ENGINE.renderView(); }, [A.dais.x, A.dais.z + 6]);
    await page.screenshot({ path: path.join(SHOTS, 'hall_dais.png') });
    await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; p.yaw = Math.PI / 2; p.pitch = -0.12; ICEWALK_ENGINE.step(1 / 30, 2); ICEWALK_ENGINE.renderView(); }, [A.kaan.x - 0.6, A.kaan.z]);
    await page.screenshot({ path: path.join(SHOTS, 'hall_kaan.png') });
  }
  // save / continue inside the hall
  await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z; ANTARKTIKA_SAVE.save(); }, [A.dais.x, A.dais.z + 4]);
  await page.reload();
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.click('#continueBtn'); await page.waitForTimeout(600); await step(2);
  s = await st(); pl = await P();
  check('chapter 3 progress (in the hall) survives save/continue', s.ch3 && s.inHall && s.kaanFree && pl.zone === 'hall', { ch3: s.ch3, inHall: s.inHall, zone: pl.zone });
  check('no page errors', errs.length === 0, errs);
  console.log('passed', pass, 'failed', fail);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
