/* Chapter 7 ("03:17": tower clock, goodwill, three endings) gameplay test.
 * node tools/chapter7_test.cjs [shotDir] */
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve.cjs');
const SHOTS = process.argv[2] || null;
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
(async () => {
  const srv = await serve(8782);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 443 } });
  page.setDefaultTimeout(240000);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8782/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') await page.click('#startBtn');
  const place = (x, z, a3d) => page.evaluate(([x, z, a3d]) => ICEWALK_ENGINE.continueFrom({ player: { x, z, yaw: 0, pitch: 0 }, mission: 3, elapsed: 60 },
    () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(a3d); }), [x, z, a3d]);
  const st = () => page.evaluate(() => ANTARKTIKA3D.serialize());
  const E = (x, z) => page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [x, z]);
  const P = () => page.evaluate(() => ({ x: ICEWALK_ENGINE.player.x, z: ICEWALK_ENGINE.player.z, zone: ANTARKTIKA3D.diagnostics().zone }));
  const step = (n = 2) => page.evaluate((n) => ICEWALK_ENGINE.step(1 / 30, n), n);
  const hud = (id) => page.evaluate((id) => new Promise((r) => { ICEWALK_ENGINE.step(1 / 30, 1); setTimeout(() => r(document.getElementById(id)?.textContent), 30); }), id);
  const clock = () => page.evaluate(() => ANTARKTIKA3D.clockMinutes());
  const stepToClock = (target) => page.evaluate((target) => { let n = 0; while (Math.abs(ANTARKTIKA3D.clockMinutes() - target) > 0.2 && n++ < 600) ICEWALK_ENGINE.step(1 / 30, 1); return ANTARKTIKA3D.clockMinutes(); }, target);
  const A = await page.evaluate(() => Object.fromEntries(ANTARKTIKA3D.world.anchors.map((a) => [a.id, { x: a.x, y: a.y, z: a.z, layer: a.layer }])));
  const ch6 = { power: true, freqSolved: true, crystals: 3, caveSolved: true, glyphRead: true, bb: [1, 1, 1, 1], bbSeen: [1, 1, 1, 1], ch2: true, kaanSeen: true, heatCell: 2, kaanFree: true, kaanTalk: 3, kaanTrust: 1, steles: [1, 1, 1, 1, 1], stars: [1, 3, 0, 4], ch3: true, syms: [1, 1, 1, 1, 1, 1], stones: [1, 1, 1], bridge: true, voice: 3, ch4: true, ending4: 'cevap', plane5: 1, cable5: 1, grid5: true, ch5: true, load5: 'denge', dials: [1, 2, 0], pump6: 2, relay6: 1, soldier6: 'save', spill6: 0, spot6: 0, ch6: true, tutorial: { hall: 1, city: 1, grid: 1, camp: 1 } };
  const atTower = (extra = {}) => place(A.spire.x, A.spire.z, { ...ch6, inCity: true, ...extra });
  const runClock = async () => {
    const first = await E(A.spire.x, A.spire.z);   // starts the tower clock
    await step(2);
    const target = await stepToClock(197);
    return { first, target };
  };

  // ---- before the tower
  await place(A.core.x, A.core.z + 2, { ...ch6, inGrid: true }); await step(2);
  const goal = await hud('missionName');
  check('after chapter 6 the HUD sends the player to the crystal tower', /BÖLÜM 7/.test(goal || '') && /KRİSTAL KULE/.test(goal || ''), goal);
  await place(A.radio.x, A.radio.z, { ...ch6 });
  const radio = await E(A.radio.x, A.radio.z);
  check('radio: August, first sun, the 03:17 recording is due', /Ağustos/.test(radio || '') && /03:17/.test(radio || ''), radio);
  await place(A.spire.x, A.spire.z, { ...ch6 });
  check('the tower is inert outside the basin', (await E(A.spire.x, A.spire.z)) == null);

  // ---- the tower clock
  await atTower();
  const first = await E(A.spire.x, A.spire.z); await step(2);
  check('first E starts the tower clock (03:10 → 03:24 loop)', /03:17/.test(first || '') && (await clock()) >= 190 && (await clock()) < 192, { first, clock: await clock() });
  check('the clock overlay is on screen', await page.isVisible('#a3dClock'));
  const early = await E(A.spire.x, A.spire.z);
  check('pressing E too early resets the clock', /erken/.test(early || '') && (await clock()) < 191 && !(await st()).ch7, early);
  await step(250);
  const late = await E(A.spire.x, A.spire.z);
  check('pressing E too late resets it as well', /geç|erken/.test(late || '') && !(await st()).ch7, late);
  const walkedAway = await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x + 20; p.z = z; ICEWALK_ENGINE.step(1 / 30, 2); return ANTARKTIKA3D.clockMinutes(); }, [A.spire.x, A.spire.z]);
  check('walking away from the tower stops the clock and hides the overlay', walkedAway === null && !(await page.isVisible('#a3dClock').catch(() => false)));

  // ---- ending A: good faith (4/4) → treaty available
  await atTower();
  let r = await runClock();
  await page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [A.spire.x, A.spire.z]);
  let buttons = await page.$$eval('#a3dChoice button', (b) => b.map((x) => x.textContent));
  let q = await page.textContent('#a3dChoice');
  check('at 03:17 the broadcast choice appears; with 4/4 goodwill the treaty option is offered', Math.abs(r.target - 197) <= 0.9 && buttons.length === 3 && /Antlaşma/.test(buttons[0]) && /4\/4/.test(q), { target: r.target, buttons });
  await page.click('#a3dChoice button >> nth=0');
  let s = await st();
  let card = (await page.isVisible('#a3dEndCard')) ? await page.textContent('#a3dEndCard') : '';
  check('ending ANTLAŞMA: ATCM live link, protected area under Madrid Protocol Annex V', s.ch7 && s.ending7 === 'antlasma' && /ANTLAŞMA/.test(card) && /Ek V/.test(card) && /1\/3/.test(card), { ending: s.ending7 });
  await page.click('#a3dEndCard button');
  const hudEnd = await hud('missionName');
  check('HUD shows the game completed with the ending', /OYUN TAMAMLANDI/.test(hudEnd || '') && /ANTLAŞMA/.test(hudEnd || ''), hudEnd);
  const tower = await E(A.spire.x, A.spire.z);
  check('after the ending the tower is silent', /Sustu/.test(tower || ''), tower);

  // ---- ending B: bad faith (0/4) → no treaty, only seal or loop
  await atTower({ soldier6: 'leave', spill6: 1, load5: 'tam', spot6: 3 });
  r = await runClock();
  await page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [A.spire.x, A.spire.z]);
  buttons = await page.$$eval('#a3dChoice button', (b) => b.map((x) => x.textContent));
  q = await page.textContent('#a3dChoice');
  check('with 0/4 goodwill the treaty option is withheld and the reason is shown', buttons.length === 2 && !buttons.some((b) => /Antlaşma/.test(b)) && /0\/4/.test(q) && /yetmiyor/.test(q), { buttons });
  await page.click('#a3dChoice button >> nth=0');
  s = await st();
  card = (await page.isVisible('#a3dEndCard')) ? await page.textContent('#a3dEndCard') : '';
  check('ending MÜHÜR: the city seals itself under the ice', s.ending7 === 'muhur' && /MÜHÜR/.test(card) && /sondaj kazası/.test(card) && /2\/3/.test(card), { ending: s.ending7 });
  await page.click('#a3dEndCard button');

  // ---- ending C: the loop
  await atTower({ soldier6: 'save', spill6: 0, load5: 'sinir', spot6: 1 });
  r = await runClock();
  await page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [A.spire.x, A.spire.z]);
  buttons = await page.$$eval('#a3dChoice button', (b) => b.map((x) => x.textContent));
  await page.click('#a3dChoice button >> nth=' + (buttons.length - 1));
  s = await st();
  card = (await page.isVisible('#a3dEndCard')) ? await page.textContent('#a3dEndCard') : '';
  check('ending DÖNGÜ: the recording was the player’s own voice, sent 72 hours back', s.ending7 === 'dongu' && /DÖNGÜ/.test(card) && /72 saat/.test(card) && /3\/3/.test(card), { buttons, ending: s.ending7 });
  await page.click('#a3dEndCard button');
  const gallery = await page.evaluate(() => JSON.parse(localStorage.getItem('antarktika_endings') || '[]'));
  check('the ending gallery remembers all three endings', gallery.length === 3 && ['antlasma', 'muhur', 'dongu'].every((k) => gallery.includes(k)), gallery);

  // ---- déjà vu on the next fresh game after the loop ending
  await page.evaluate(() => { ANTARKTIKA3D.resetState(); });
  const dejaBefore = await page.evaluate(() => document.getElementById('journalList')?.innerText || '');
  await place(A.generator.x, A.generator.z + 3, {}); await step(5);
  const s2 = await st();
  check('a fresh game after the loop ending writes a déjà vu note (tutorial.deja)', s2.tutorial && s2.tutorial.deja === 1, s2.tutorial);

  // ---- render, save/continue
  await atTower({ ch7: true, ending7: 'antlasma' });
  const stats = await page.evaluate(([x, z]) => { const p = ICEWALK_ENGINE.player; p.x = x; p.z = z + 6; p.yaw = 0; p.pitch = 0.1; ICEWALK_ENGINE.step(1 / 30, 2); ICEWALK_ENGINE.renderView(); return ANTARKTIKA3D.diagnostics().stats; }, [A.spire.x, A.spire.z]);
  check('the tower renders (draw calls, lights)', stats.draws > 5 && stats.lights > 0, stats);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tower_end.png') });
  await page.evaluate(() => ANTARKTIKA_SAVE.save());
  await page.reload();
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 240000 });
  await page.click('#continueBtn'); await page.waitForTimeout(600); await step(2);
  s = await st(); const pl = await P();
  check('chapter 7 progress (ending, in the basin) survives save/continue', s.ch7 && s.ending7 === 'antlasma' && s.inCity && pl.zone === 'city', { ch7: s.ch7, ending: s.ending7, zone: pl.zone });
  check('no page errors', errs.length === 0, errs);
  console.log('passed', pass, 'failed', fail);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
