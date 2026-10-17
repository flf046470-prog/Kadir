// Renders the store screenshots and the key-art plates straight from the game, at fixed viewpoints.
// Usage (from the repository root, after `python3 DerinlikWeb/build.py --offline --out dist/offline/index.html`):
//   node DerinlikSteam/tools/capture.mjs DerinlikWeb/dist/offline/index.html DerinlikSteam [--only s01,k_gate]
// Writes <out>/screenshots/sNN_*.png (1920x1080, in-game HUD as the player sees it) and
// <out>/tools/plates/k_*.png (3840x2160, no HUD: backgrounds for the capsules in compose.mjs).
// Rendering uses the browser's software GPU when there is no real one: slow, but deterministic (time is stepped).
import { chromium } from 'playwright';
import fs from 'fs'; import http from 'http'; import path from 'path';

const [,, htmlPath, outRoot, ...rest] = process.argv;
const only = rest.includes('--only') ? new Set(rest[rest.indexOf('--only') + 1].split(',')) : null;

// at: [chapter, x, z, lookX, lookZ, lookY]; torch / cam on or off; run: seconds of game time before the frame.
// Viewpoints come from the gallery regression (every one of them is a place the player can stand).
const SHOTS = [
  { name: 's01_sakarya_basement', at: [0, .5, 3.0, -2.6, 3.2, 1.0], torch: true, run: .6 },
  { name: 's02_sakarya_sigil_camcorder', at: [0, 0, 16.2, 0, 17.985, 1.25], cam: true, run: .6 },
  { name: 's03_sakarya_gate', at: [0, 0, 30.0, 0, 32.55, 1.2], open: [-1.0, 30.3, -2.0, 30.285, .79], run: .6 },
  { name: 's04_nevsehir_hall', at: [1, 0, 8.0, 0, 17, 1.6], run: .6 },
  { name: 's05_nevsehir_other_camcorder', at: [1, 0, 24.0, 2.2, 27.55, 1.0], cam: true, run: .6 },
  { name: 's06_kola_corridor', at: [2, 0, 2.0, 0, 20, 1.5], run: .6 },
  { name: 's07_kola_copy', at: [2, 3.2, 12.0, .2, 12.0, 1.2], enemy: true, run: 5.0 },
  { name: 's08_paris_catacombs', at: [3, 0, 1.0, 0, 13, 1.3], run: .6 },
  { name: 's09_paris_final_chamber', at: [3, 0, 26.0, 0, 36.6, 2.6], warm: [0, 24.0, 0, 36.6, 2.6], run: .4 },
  // key-art plates: same places, no HUD, 4K
  { name: 'k_gate', plate: true, at: [0, 0, 29.2, 0, 32.55, 1.25], open: [-1.0, 30.3, -2.0, 30.285, .79], run: .6 },
  { name: 'k_kola', plate: true, at: [2, 0, 2.0, 0, 20, 1.5], run: .6 },
  { name: 'k_copy', plate: true, at: [2, 3.2, 12.0, .2, 12.0, 1.2], enemy: true, run: 5.0 },
  { name: 'k_paris', plate: true, at: [3, 0, 1.0, 0, 13, 1.3], run: .6 },
].filter((s) => !only || only.has(s.name));

fs.mkdirSync(path.join(outRoot, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(outRoot, 'tools', 'plates'), { recursive: true });
const html = fs.readFileSync(htmlPath);
const server = http.createServer((req, res) => { if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); } res.writeHead(404); res.end(); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function open(plate) {
  // plates: 2560x1440 CSS px at the game's maximum pixel ratio (1.5) = 3840x2160 rendered pixels
  const page = await browser.newPage(plate ? { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1.5 } : { viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', (r) => (r.request().url().startsWith(url) || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.addInitScript(() => { try { localStorage.setItem('derinlik.quality', 'high'); } catch (_) {} });
  await page.goto(url);
  await page.waitForFunction(() => window.__derinlik, null, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.click('#startBtn');
  await page.evaluate(() => { const d = window.__derinlik; d.DEBUG.manual = true; d.DEBUG.enemyOff = true; d.advance(5.5); });
  return page;
}

const pages = {};
for (const s of SHOTS) {
  const kind = s.plate ? 'plate' : 'shot';
  if (!pages[kind]) pages[kind] = await open(s.plate);
  const page = pages[kind];
  await page.evaluate((s) => {
    const d = window.__derinlik;
    const place = ([ch, x, z, lx, lz, ly], rebuild) => {
      if (rebuild) d.buildChapter(ch);
      d.player.enabled = true; d.player.crouched = false; d.player.x = x; d.player.z = z; d.player.eye = 1.64; d.face(lx, lz, ly); d.advance(1 / 30);
    };
    if (d.state.camRaised) d.toggleCam();
    d.DEBUG.enemyOff = !s.enemy;
    place(s.at, true);
    // the Sakarya gate only glows after the control room's breaker is thrown
    if (s.open) { place([s.at[0], ...s.open], false); d.doInteract(); for (let t = 0; t < 17.5; t += .5) d.advance(.5); place(s.at, false); }
    if (s.warm) { place([s.at[0], ...s.warm], false); d.advance(3); place(s.at, false); }
    if (d.torch.visible !== !!s.torch) { d.torch.visible = !!s.torch; d.FX.emit('torch', d.torch.visible); }
  }, s);
  for (let t = 0; t < s.run - 1e-6; t += .5) await page.evaluate((dt) => window.__derinlik.advance(dt), Math.min(.5, s.run - t));
  await page.evaluate((s) => {
    const d = window.__derinlik;
    if (s.cam && !d.state.camRaised) { d.toggleCam(); d.advance(.4); }
    if (s.enemy && d.enemy) d.face(d.enemy.x, d.enemy.z, 1.5);
    // transient pop-ups never; the HUD, the camcorder OSD and subtitles only on screenshots, never on plates
    for (const id of ['toast', 'prompt']) document.getElementById(id).style.visibility = 'hidden';
    for (const id of ['hud', 'cam', 'subs']) document.getElementById(id).style.visibility = s.plate ? 'hidden' : '';
    d.advance(1 / 30);
  }, s);
  await page.waitForTimeout(400);
  const file = s.plate ? path.join(outRoot, 'tools', 'plates', `${s.name}.png`) : path.join(outRoot, 'screenshots', `${s.name}.png`);
  await page.screenshot({ path: file, timeout: 300000 });
  console.log('wrote', path.relative(process.cwd(), file));
}
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'console errors: 0');
await browser.close(); server.close();
