/* Chapter 2 (black box) gameplay test. node tools/chapter2_test.cjs */
const { chromium } = require('playwright');
const serve = require('./serve.cjs');
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
(async () => {
  const srv = await serve(8772);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.setDefaultTimeout(180000);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8772/index.html?forcewebgl=1');
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 180000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('#skipPrologue'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => ICEWALK_DIAGNOSTICS().mode)) !== 'play') await page.click('#startBtn');
  const place = (x, z, a3d) => page.evaluate(([x, z, a3d]) => ICEWALK_ENGINE.continueFrom({ player: { x, z, yaw: 0, pitch: 0 }, mission: 3, elapsed: 60 },
    () => { ICEWALK_PROLOGUE.restore({ active: false, stage: -1, completed: true }); ANTARKTIKA3D.restore(a3d); }), [x, z, a3d]);
  const st = () => page.evaluate(() => ANTARKTIKA3D.serialize());
  const anchors = await page.evaluate(() => Object.fromEntries(ANTARKTIKA3D.world.anchors.map((a) => [a.id, { x: a.x, z: a.z }])));
  check('four black-box anchors exist', ['bb0', 'bb1', 'bb2', 'bb3'].every((k) => anchors[k]), Object.keys(anchors).filter((k) => k.startsWith('bb')));
  // before the cave is solved the scanner says nothing about the black box
  await place(anchors.bb0.x + 6, anchors.bb0.z, { power: true });
  check('black box locked before chapter 1 ends', (await page.evaluate(([x, z]) => ANTARKTIKA3D.onScan(x, z), [anchors.bb0.x + 6, anchors.bb0.z])) == null);
  const solved = { power: true, freqSolved: true, crystals: 3, caveSolved: true, glyphRead: true };
  await place(0, 0, solved);
  let radio = await page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [anchors.radio.x, anchors.radio.z]);
  check('radio reports missing fragments', /0\/4/.test(radio || ''), radio);
  const pr0 = await page.evaluate(([x, z]) => { ICEWALK_ENGINE.player.x = x; ICEWALK_ENGINE.player.z = z; ICEWALK_ENGINE.step(1 / 30, 2); return ANTARKTIKA3D.chapter2Pressure(); }, [anchors.bb0.x + 30, anchors.bb0.z]);
  for (let i = 0; i < 4; i++) {
    const a = anchors['bb' + i];
    const far = await page.evaluate(([x, z]) => ANTARKTIKA3D.onScan(x, z), [a.x + 30, a.z]);
    const hidden = await page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [a.x, a.z]);
    const near = await page.evaluate(([x, z]) => ANTARKTIKA3D.onScan(x, z), [a.x + 4, a.z]);
    const dig = await page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [a.x, a.z]);
    check('fragment ' + (i + 1) + ': scan gives bearing, then E digs it out', /SİNYALİ/.test(far || '') && hidden == null && /Yakında/.test(near || '') && new RegExp((i + 1) + '/4').test(dig || ''), { far, near, dig });
  }
  const pr4 = await page.evaluate(([x, z]) => { ICEWALK_ENGINE.player.x = x; ICEWALK_ENGINE.player.z = z; ICEWALK_ENGINE.step(1 / 30, 2); return ANTARKTIKA3D.chapter2Pressure(); }, [anchors.bb0.x + 30, anchors.bb0.z]);
  check('storm thickens as fragments are collected (03:17 approaches)', pr0 > 0 && pr4 > pr0 + 0.15, { pr0, pr4 });
  radio = await page.evaluate(([x, z]) => ANTARKTIKA3D.interact(x, z), [anchors.radio.x, anchors.radio.z]);
  const s = await st();
  const prDone = await page.evaluate(() => ANTARKTIKA3D.chapter2Pressure());
  check('storm pressure lifts once the recording is assembled', prDone === 0, prDone);
  check('radio assembles the recording and completes chapter 2', s.ch2 === true && /BÖLÜM 2/.test(radio || ''), radio);
  const j = await page.evaluate(() => document.body.innerText.includes('GELECEKTEN YAYIN') || JSON.stringify(window.ICEWALK_JOURNAL?.serialize?.() || '').includes('GELECEKTEN'));
  check('journal entry written', j);
  // save / restore
  await page.evaluate(() => { ANTARKTIKA_SAVE.save(); });
  await page.reload();
  await page.waitForFunction(() => window.ANTARKTIKA3D && ANTARKTIKA3D.status === 'ready', null, { timeout: 180000 });
  await page.click('#continueBtn'); await page.waitForTimeout(500);
  const s2 = await st();
  check('chapter 2 progress survives save/continue', s2.ch2 === true && s2.bb.every(Boolean), { ch2: s2.ch2, bb: s2.bb });
  check('no page errors', errs.length === 0, errs);
  console.log('passed', pass, 'failed', fail);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
