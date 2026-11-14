// Visual regression gallery: the same viewpoints in every chapter, rendered from the game itself, so a realism change can
// be judged before and after on identical frames.
// Usage (repository root, after `python3 DerinlikWeb/build.py --offline --out <html>`):
//   node DerinlikSteam/tools/gallery.mjs <html> <out dir> [--only g01,g05] [--size 1280x720] [--quality high]
// Writes <out dir>/gNN_*.png and <out dir>/sheet.jpg-ready PNGs; the stats per view (draw calls, triangles, lights) go
// to <out dir>/stats.json, so a change that costs too much for the headset shows up as a number too.
import { chromium } from 'playwright';
import fs from 'fs'; import http from 'http'; import path from 'path';

const [,, htmlPath, outDir, ...rest] = process.argv;
const arg = (k, d) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d);
const only = arg('--only') ? new Set(arg('--only').split(',')) : null;
const [W, H] = arg('--size', '1280x720').split('x').map(Number);
const QUALITY = arg('--quality', 'high');

// at: [chapter, x, z, lookX, lookZ, lookY]; torch on/off; cam: camcorder raised; choices: decisions already made
const VIEWS = [
  { name: 'g01_sakarya_basement', at: [0, -.6, 1.4, .4, 8, 1.25] },
  { name: 'g02_sakarya_shelves_torch', at: [0, .5, 3.0, -2.6, 3.2, 1.0], torch: true },
  { name: 'g03_sakarya_corridorA_torch', at: [0, 0, 9.0, 0, 18, 1.0], torch: true },
  { name: 'g04_sakarya_wheel', at: [0, -.2, 15.9, .35, 17.8, 1.1], torch: true },
  { name: 'g05_sakarya_corridorB_torch', at: [0, 0, 19.0, 0, 27, 1.2], torch: true },
  { name: 'g06_sakarya_gate', at: [0, 0, 28.0, 0, 32.55, 1.2], choices: { power: 'relay' } },
  { name: 'g07_nevsehir_entry', at: [1, 0, .8, 0, 7, 1.4], torch: true },
  { name: 'g08_nevsehir_hall', at: [1, 0, 8.0, 0, 17, 1.6] },
  { name: 'g09_nevsehir_hall_back', at: [1, 3.5, 16.2, -2, 7.5, 1.5] },
  { name: 'g10_nevsehir_archive', at: [1, 0, 22.0, 0, 29, 1.3], torch: true },
  { name: 'g11_kola_entry', at: [2, 0, .6, 0, 3, 1.5] },
  { name: 'g12_kola_corridor', at: [2, 0, 4.0, 0, 20, 1.5] },
  { name: 'g13_kola_sideroom_torch', at: [2, -.6, 8.75, -2.6, 8.75, 1.0], torch: true },
  { name: 'g14_kola_hall', at: [2, 0, 24.0, 0, 32, 1.6] },
  { name: 'g15_paris_ossuary', at: [3, 0, 1.0, 0, 13, 1.3] },
  { name: 'g16_paris_ossuary_torch', at: [3, 0, 6.0, .7, 8.0, 1.0], torch: true },
  { name: 'g17_paris_archive', at: [3, 0, 15.0, -2, 20, 1.4] },
  { name: 'g18_paris_chamber', at: [3, 0, 24.0, 0, 36.6, 2.6] },
  { name: 'g19_paris_chamber_side', at: [3, -5.5, 30.0, 4, 27, 1.2] },
].filter((v) => !only || only.has(v.name.split('_')[0]) || only.has(v.name));

fs.mkdirSync(outDir, { recursive: true });
const html = fs.readFileSync(htmlPath);
const server = http.createServer((req, res) => { if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); } res.writeHead(404); res.end(); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
await page.addInitScript((Q) => { try { localStorage.setItem('derinlik.quality', Q); localStorage.setItem('derinlik.lang', 'en'); } catch (_) {} delete window.AudioContext; delete window.webkitAudioContext; }, QUALITY);
await page.goto(url, { timeout: 180000 });
await page.waitForFunction(() => window.__derinlik, null, { timeout: 180000 });
await page.click('#startBtn');
await page.evaluate(() => { const d = window.__derinlik; d.DEBUG.manual = true; d.DEBUG.enemyOff = true; d.advance(5.5); });
const step = async (sec) => { for (let t = 0; t < sec - 1e-6; t += .5) await page.evaluate((dt) => window.__derinlik.advance(dt), Math.min(.5, sec - t)); };
const stats = {};
for (const v of VIEWS) {
  await page.evaluate(([[ch, x, z, lx, lz, ly], v]) => {
    const d = window.__derinlik;
    if (d.state.camRaised) d.toggleCam();
    for (const k of Object.keys(d.choices)) delete d.choices[k]; Object.assign(d.choices, v.choices || {});
    d.buildChapter(ch, { persist: false });
    d.player.enabled = true; d.player.crouched = false; d.player.x = x; d.player.z = z; d.player.eye = 1.64; d.face(lx, lz, ly); d.advance(1 / 30);
    if (d.torch.visible !== !!v.torch) { d.torch.visible = !!v.torch; d.FX.emit('torch', d.torch.visible); }
  }, [v.at, v]);
  await step(.8);
  await page.waitForTimeout(2500);                                  // PBR textures attach asynchronously
  stats[v.name] = await page.evaluate((v) => {
    const d = window.__derinlik, [, , , lx, lz, ly] = v.at; d.face(lx, lz, ly);
    if (v.cam && !d.state.camRaised) d.toggleCam();
    for (const id of ['toast', 'prompt', 'subs', 'card']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
    const r = d.renderer; r.info.autoReset = false; r.info.reset(); d.draw(1 / 30);
    let lights = 0; d.scene.traverse((o) => { if (o.isLight && o.visible && o.intensity > 0) lights++; });
    const s = { calls: r.info.render.calls, triangles: r.info.render.triangles, lights }; r.info.autoReset = true; d.advance(1 / 30); return s;
  }, v);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, `${v.name}.png`), timeout: 300000 });
  console.log(v.name, JSON.stringify(stats[v.name]));
}
fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 1));
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'console errors: 0');
await browser.close(); server.close();
