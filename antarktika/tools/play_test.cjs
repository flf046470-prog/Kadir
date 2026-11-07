/* End-to-end test of the 3D vertical slice in headless Chromium (software WebGL).
 * Usage: node tools/play_test.cjs [outDir]
 * Writes screenshots + report.json to outDir. Frame rates measured here are CPU
 * software rendering (SwiftShader) and are NOT representative of an iPhone GPU. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const serve = require('./serve.cjs');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'test-output'));
fs.mkdirSync(out, { recursive: true });
const report = { started: new Date().toISOString(), checks: [], shots: [], perf: {}, console: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + JSON.stringify(detail) : '')); };

(async () => {
  const srv = await serve(8765);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 576 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) report.console.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => report.console.push('pageerror: ' + e.message));
  const url = 'http://localhost:8765/index.html?forcewebgl=1&perf=1';
  await page.goto(url);
  await page.waitForFunction(() => window.ANTARKTIKA3D && ['ready', 'failed', 'unavailable'].includes(window.ANTARKTIKA3D.status), null, { timeout: 120000 });
  const a3 = await page.evaluate(() => ({ status: ANTARKTIKA3D.status, error: ANTARKTIKA3D.error, loadMs: ANTARKTIKA3D.loadMs }));
  check('GLB models load (station, ice cave, explorer)', a3.status === 'ready', a3);
  report.perf.loadMs = a3.loadMs;
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) { /* */ } });

  // helpers ---------------------------------------------------------------------
  const place = (p, extra = {}) => page.evaluate(([p, extra]) => {
    ICEWALK_ENGINE.continueFrom({ player: p, mission: extra.mission || 0, elapsed: 60, torch: !!extra.torch }, () => {
      ICEWALK_PROLOGUE.restore(extra.prologue || { active: false, stage: -1, completed: true });
      ANTARKTIKA3D.restore(extra.a3d || null);
    });
  }, [p, extra]);
  const diag = () => page.evaluate(() => ICEWALK_DIAGNOSTICS());
  const notice = () => page.evaluate(() => document.getElementById('notice').textContent);
  const press = async (k, ms = 60) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
  // Advance the simulation deterministically (software WebGL renders ~1 frame/s).
  const sim = (seconds) => page.evaluate((n) => ICEWALK_ENGINE.step(1 / 30, n), Math.round(seconds * 30));
  const hold = async (k, seconds) => { await page.keyboard.down(k); await sim(seconds); await page.keyboard.up(k); };
  const shot = async (name, settle = 1800) => {
    await page.waitForTimeout(settle);
    const f = path.join(out, name + '.png');
    await page.screenshot({ path: f, timeout: 180000 });
    const p = await page.evaluate(() => ({ fps: ANTARKTIKA_PERF.fps, p95: ANTARKTIKA_PERF.p95, draws: ANTARKTIKA_PERF.draws, tris: ANTARKTIKA_PERF.tris, a3dDraws: ANTARKTIKA3D.stats.draws, a3dTris: ANTARKTIKA3D.stats.tris, culled: ANTARKTIKA3D.stats.culled, lights: ANTARKTIKA3D.stats.lights }));
    report.shots.push({ name, file: path.basename(f), ...p });
  };

  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await diag()).mode !== 'play') { await page.click('#startBtn'); await page.waitForTimeout(300); }

  // 1. visual tour --------------------------------------------------------------
  await place({ x: -2, z: 33, yaw: 1.35, pitch: 0.02 }); await shot('01_station_exterior');
  await place({ x: 13.4, z: 27.0, yaw: Math.PI / 2, pitch: 0 }); await shot('02_airlock_dark');
  await place({ x: 17.0, z: 25.4, yaw: 2.0, pitch: -0.08 }, { a3d: { power: true } }); await shot('03_lab_powered');
  await place({ x: 26.0, z: 28.4, yaw: 1.25, pitch: -0.05 }, { a3d: { power: true } }); await shot('04_control_room');
  await place({ x: -7.0, z: -14, yaw: -0.05, pitch: 0.02 }); await shot('05_cave_outside');
  await place({ x: -8.4, z: -31.5, yaw: 0, pitch: 0.05 }, { torch: true }); await shot('06_cave_tunnel_torch');
  await place({ x: -8.2, z: -42.0, yaw: 0.05, pitch: 0.1 }, { torch: true }); await shot('07_cave_chamber');
  await place({ x: -8.2, z: -42.0, yaw: 0.05, pitch: 0.1 }, { torch: true, a3d: { crystals: 3, caveSolved: true } }); await shot('08_cave_chamber_solved');
  await place({ x: 17.6, z: 21.0, yaw: 0, pitch: -0.12 }); await page.evaluate(() => ANTARKTIKA3D.npcPlace(17.5, 18.2, 0.05)); await shot('09_npc_selin', 2600);
  await place({ x: -1.5, z: 31.5, yaw: 1.2, pitch: 0.0 }, { torch: true }); await page.evaluate(() => { ICEWALK_IMMERSIVE.toggle(); }); await shot('11_first_person_hands', 2200); await page.evaluate(() => { ICEWALK_IMMERSIVE.toggle(); });

  // 2. collisions, door, ramp ---------------------------------------------------
  await place({ x: 14.0, z: 26.0, yaw: 0, pitch: 0 }); await hold('w', 2.5);
  let d = await diag();
  check('wall blocks player inside the airlock (north wall z≈23.3)', d.position[1] > 23.4, { z: d.position[1] });
  await place({ x: 3.0, z: 27.0, yaw: Math.PI / 2, pitch: 0 });
  const y0 = await page.evaluate(() => ANTARKTIKA3D.groundY(3, 27));
  await hold('w', 2.2);
  d = await diag();
  const y1 = await page.evaluate(([x, z]) => ANTARKTIKA3D.groundY(x, z), d.position);
  check('ramp lifts the player toward floor height', y1 > y0 + 1.2, { from: y0, to: y1, pos: d.position });
  await hold('w', 2.6);
  d = await diag();
  check('sliding door opens and the player walks into the airlock', d.position[0] > 12.4 && d.a3d.zone === 'indoor', { pos: d.position, zone: d.a3d.zone });
  await place({ x: 6.0, z: 27.0, yaw: 0, pitch: 0 }); await hold('w', 1.5);
  d = await diag();
  check('ramp railing stops sideways exit', d.position[1] > 25.9, { z: d.position[1] });

  // 3. prologue radio gating + generator puzzle ----------------------------------
  await place({ x: 30.6, z: 28.6, yaw: 1.0, pitch: 0 }, { prologue: { active: true, stage: 1, completed: false } });
  await press('e'); await page.waitForTimeout(200);
  check('radio refuses without power', /ENERJİSİZ/.test(await notice()), await notice());
  const gen = await page.evaluate(() => ANTARKTIKA3D.world.anchors.find((a) => a.id === 'generator'));
  await place({ x: gen.x, z: gen.z, yaw: Math.PI / 2, pitch: 0 }, { prologue: { active: true, stage: 1, completed: false } });
  await press('e'); await page.waitForTimeout(200);
  d = await diag();
  check('generator starts station power', d.a3d.state.power === true, await notice());
  await place({ x: 30.6, z: 28.6, yaw: 1.0, pitch: 0 }, { prologue: { active: true, stage: 1, completed: false }, a3d: { power: true } });
  await press('e'); await page.waitForTimeout(300);
  d = await diag();
  check('powered radio completes prologue step 2', d.prologue.stage === 2, d.prologue);

  // 4. frequency puzzle completes mission 03 --------------------------------------
  await place({ x: 29.0, z: 25.2, yaw: 0, pitch: 0 }, { mission: 2, a3d: { power: true } });
  await press('e'); await page.waitForTimeout(150);
  check('generic E does not skip the cipher mission', (await diag()).mission === 2, await notice());
  for (let i = 0; i < 2; i++) { await press('e'); await page.waitForTimeout(150); }
  check('third channel is 3.17 MHz and locks', /3\.17/.test(await notice()), await notice());
  await sim(2.0);
  d = await diag();
  check('decoded broadcast advances to mission 04', d.mission === 3 && d.a3d.state.freqSolved, { mission: d.mission });

  // 5. crystal sequence puzzle ------------------------------------------------------
  const anchors = await page.evaluate(() => Object.fromEntries(ANTARKTIKA3D.world.anchors.map((a) => [a.id, a])));
  const at = (id, st) => place({ x: anchors[id].x, z: anchors[id].z, yaw: 0, pitch: 0 }, { a3d: st });
  await place({ x: anchors.crystal2.x, z: anchors.crystal2.z, yaw: 0, pitch: 0 });
  await press('e'); await page.waitForTimeout(150);
  check('wrong crystal first resets the sequence', /ÇAKIŞMA/.test(await notice()), await notice());
  for (const id of ['crystal1', 'crystal2', 'crystal3']) {
    const st = await page.evaluate(() => ANTARKTIKA3D.serialize());
    await at(id, st); await press('e'); await page.waitForTimeout(200);
  }
  d = await diag();
  check('blue → gold → violet wakes the crystals and frees the A1 core', d.a3d.state.caveSolved === true, await notice());

  // 6. NPC: patrols, stops and faces the player, talks ---------------------------------
  const n0 = await page.evaluate(() => ANTARKTIKA3D.npc);
  await place({ x: 60, z: 60, yaw: 0, pitch: 0 }); await sim(9);
  const n1 = await page.evaluate(() => ANTARKTIKA3D.npc);
  check('Dr. Selin walks her patrol path', Math.hypot(n1.x - n0.x, n1.z - n0.z) > 1.0 || n1.clip === 'Walk', { n0, n1 });
  await place({ x: n1.x, z: n1.z + 2.2, yaw: 0, pitch: 0 }); await sim(0.6);
  await page.evaluate(() => ICEWALK_MESHY.setPlaying(true));
  await press('e'); await sim(0.4);
  const n2 = await page.evaluate(() => ANTARKTIKA3D.npc);
  check('talking to Dr. Selin plays the Interact animation', n2.clip === 'Interact', { clip: n2.clip, notice: await notice() });

  // 7. save → reload → continue ------------------------------------------------------
  await place({ x: 24.0, z: 27.5, yaw: 1.0, pitch: 0 }, { mission: 3, a3d: { power: true, freqSolved: true } });
  await page.evaluate(() => { ICEWALK_JOURNAL.collect(2); ICEWALK_FIELD.restore({ known: ['B7'], taken: ['A1'], shards: 1, insulated: false }); });
  const saved = await page.evaluate(() => ANTARKTIKA_SAVE.save('test'));
  await page.reload();
  await page.waitForFunction(() => window.ANTARKTIKA3D && window.ANTARKTIKA3D.status === 'ready', null, { timeout: 120000 });
  await page.waitForTimeout(600);
  const contVisible = await page.evaluate(() => { const b = document.getElementById('continueBtn'); return b && !b.hidden ? b.textContent : null; });
  check('continue button appears after reload', saved && !!contVisible, contVisible);
  await page.click('#continueBtn'); await page.waitForTimeout(800);
  d = await diag();
  const journalCount = await page.evaluate(() => document.querySelectorAll('#journalEntries article').length);
  check('continue restores position, mission, puzzles, relics and journal', Math.abs(d.position[0] - 24) < 0.5 && d.mission === 3 && d.a3d.state.freqSolved && d.field.taken.includes('A1') && journalCount >= 2,
    { pos: d.position, mission: d.mission, a3d: d.a3d.state, taken: d.field.taken, journal: journalCount });
  await shot('10_after_continue', 1200);

  // 8. quality levels -----------------------------------------------------------------
  for (const q of ['low', 'balanced', 'cinematic']) {
    await page.evaluate((q) => { ICEWALK_VISUALS.quality = q; }, q);
    await place({ x: -2, z: 33, yaw: 1.35, pitch: 0.02 }); await page.waitForTimeout(2500);
    report.perf['quality_' + q] = await page.evaluate(() => ({ canvas: [document.getElementById('world').width, document.getElementById('world').height], draws: ANTARKTIKA_PERF.draws, a3dLights: ANTARKTIKA3D.stats.lights, fps: ANTARKTIKA_PERF.fps }));
  }
  check('three quality levels change render resolution', report.perf.quality_low.canvas[0] < report.perf.quality_cinematic.canvas[0], report.perf);

  report.a3d = (await diag()).a3d;
  report.finished = new Date().toISOString();
  report.passed = report.checks.filter((c) => c.ok).length;
  report.failed = report.checks.filter((c) => !c.ok).length;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('passed', report.passed, 'failed', report.failed, 'console', report.console.length);
  if (report.console.length) console.log(report.console.slice(0, 12).join('\n'));
  await browser.close(); srv.close();
  process.exit(report.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
