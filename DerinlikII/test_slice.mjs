// Plays DERİNLİK II chapter 1 through in headless Chromium: log, the figure in the storm, the cold, Hartmann, the fuel
// decision, the lift and the slice end. Usage (repository root, after python3 DerinlikII/make.py --offline):
//   node DerinlikII/test_slice.mjs DerinlikII/dist/index.html [generator|lift] [legacy ending, e.g. tanik] [shots dir]
import { chromium } from 'playwright';
import fs from 'fs'; import http from 'http'; import path from 'path';

const [,, htmlPath, fuel = 'generator', legacy = '', shots = ''] = process.argv;
const html = fs.readFileSync(htmlPath);
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); }).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = []; page.on('pageerror', (e) => { if (!/AudioContext/.test(e.message)) errors.push(e.message); });   // audio is removed on purpose (headless)
await page.addInitScript((lg) => {
  localStorage.setItem('derinlik.quality', 'medium'); localStorage.setItem('derinlik.lang', 'tr');
  if (lg) localStorage.setItem('derinlik.legacy.v1', JSON.stringify({ ending: lg, choices: {}, time: 0 }));
}, legacy);
await page.goto(`http://127.0.0.1:${server.address().port}/`, { timeout: 180000 });
await page.waitForFunction(() => window.__derinlik, null, { timeout: 180000 });
const title = await page.title();
await page.click('#startBtn');
await page.waitForFunction(() => window.__derinlik.state.started, null, { timeout: 180000 });   // begin() runs once the assets are ready
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => { const d = window.__derinlik; d.DEBUG.manual = true; d.DEBUG.enemyOff = true; d.advance(5.5); });
for (let i = 0; i < 40 && !(await ev(() => window.__derinlik.player.enabled && !document.getElementById('hud').hidden)); i++) await ev(() => window.__derinlik.advance(.5));   // the intro hands control over
const run = async (sec) => { for (let t = 0; t < sec; t += .5) await ev((dt) => window.__derinlik.advance(dt), .5); };
const shot = async (name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(shots, name + '.png') }); } };
// stand at x,z, look at lx,ly,lz and press E (twice for a decision); returns the prompt seen
const use = async (x, z, lx, lz, ly, twice = false) => ev(([x, z, lx, lz, ly, twice]) => {
  const d = window.__derinlik; d.player.x = x; d.player.z = z; d.face(lx, lz, ly); d.advance(1 / 30);
  const p = d.state.focus ? d.state.focus.prompt : null; d.doInteract(); if (twice) { d.advance(.2); d.doInteract(); }
  if (d.state.reading) d.closeReader(); return p;
}, [x, z, lx, lz, ly, twice]);
const log = [];
const check = (name, ok, extra = '') => { log.push(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); };

check('title', title.includes('DERİNLİK II'), title);
await shot('01_hut');
check('read station log', (await use(.9, 3.1, 2.0, 3.1, .78)) !== null);
await run(1);
check('evidence stationLog', await ev(() => window.__derinlik.state.evidence.has('stationLog')));
// out through the airlock (open it), into the storm
check('airlock prompt', (await use(0, 6.3, 0, 7.1, 1.1)) !== null);
await run(1.5);
await ev(() => { const d = window.__derinlik; d.player.x = 0; d.player.z = 14.8; d.face(3.4, 17.6, 1.2); });
await run(2);
check('fog thickens outside', await ev(() => window.__derinlik.scene.fog.density > .12), await ev(() => window.__derinlik.scene.fog.density.toFixed(3)));
await shot('02_storm');
await ev(() => window.__derinlik.toggleCam()); await run(2.5); await ev(() => window.__derinlik.toggleCam());
check('figure filmed', await ev(() => window.__derinlik.state.evidence.has('whiteout')));
// the cold: stay out and you are dragged back to the hut
await run(42);
check('cold respawn to hut', await ev(() => window.__derinlik.player.z < 7), await ev(() => window.__derinlik.player.z.toFixed(1)));
await run(2);
// hut B: open its door from outside, then Hartmann, drum, decision, lift
check('hall door prompt', (await use(0, 20.9, 0, 21.9, 1.1)) !== null);
await run(1.5);
await ev(() => { const d = window.__derinlik; d.player.x = 0; d.player.z = 23.5; }); await run(1);
await shot('03_hall');
check('Hartmann', (await use(2.4, 26.2, 3.5, 26.2, 1.3)) !== null);
await run(1);
check('drum', (await use(-2.3, 30.8, -3.2, 30.8, .5)) !== null);
const target = fuel === 'generator' ? [-1.0, 25.4, -1.88, 25.4, .8] : [.7, 30.7, 1.48, 30.7, .6];
check(`fuel → ${fuel}`, (await use(...target, true)) !== null);
check('choice saved', await ev(() => window.__derinlik.state.choices.fuel), await ev(() => window.__derinlik.state.choices.fuel));
await run(fuel === 'generator' ? 12 : 4);
await shot('04_after_fuel');
check('lift prompt', (await use(0, 30.5, -1.01, 30.5, 1.3)) !== null);
await run(8);
check('slice end screen', await ev(() => !document.getElementById('end').hidden && document.getElementById('endTitle').textContent === 'DERİNLİK II'));
const endText = await ev(() => document.getElementById('endText').textContent + ' | ' + document.getElementById('endStats').textContent);
await shot('05_end');
if (legacy) check('legacy ending shown', endText.includes('Önceki son'));
check('first game storage untouched', await ev(() => localStorage.getItem('derinlik.save.v2') === null));
console.log(log.join('\n')); console.log('end:', endText);
console.log('page errors:', errors.length ? errors.join(' | ') : 0);
console.log(log.some((l) => l.startsWith('FAIL')) || errors.length ? 'RESULT: FAIL' : 'RESULT: PASS');
await browser.close(); server.close();
