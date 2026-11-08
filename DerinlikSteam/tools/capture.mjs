// Renders the store screenshots and the key-art plates straight from the game, at fixed viewpoints.
// Usage (from the repository root, after `python3 DerinlikWeb/build.py --offline --out dist/offline/index.html`):
//   node DerinlikSteam/tools/capture.mjs DerinlikWeb/dist/offline/index.html DerinlikSteam [--only s01,k_gate]
// Writes <out>/screenshots/sNN_*.png (1920x1080, in-game HUD as the player sees it) and
// <out>/tools/plates/k_*.png (3840x2160, no HUD: backgrounds for the capsules in compose.mjs).
// META=1 node capture.mjs ... writes the Meta Horizon Store set instead (see META below).
// Rendering uses the browser's software GPU when there is no real one: slow, but deterministic (time is stepped).
import { chromium } from 'playwright';
import fs from 'fs'; import http from 'http'; import path from 'path';

const [,, htmlPath, outRoot, ...rest] = process.argv;
const only = rest.includes('--only') ? new Set(rest[rest.indexOf('--only') + 1].split(',')) : null;

// at: [chapter, x, z, lookX, lookZ, lookY]; torch / cam on or off; run: seconds of game time before the frame;
// choices: the decisions already made, so the chapter is built in that state (DerinlikWeb/game.html CHOICES).
// Viewpoints come from the gallery regression (every one of them is a place the player can stand).
const SHOTS = [
  { name: 's01_sakarya_basement', at: [0, -.6, 1.4, .4, 8, 1.25], run: .6 },
  { name: 's02_sakarya_wheel', at: [0, -.2, 15.9, .35, 17.8, 1.1], torch: true, run: .6 },
  { name: 's03_sakarya_gate', at: [0, 0, 30.0, 0, 32.55, 1.2], choices: { power: 'relay' }, run: 3 },
  { name: 's04_nevsehir_hall', at: [1, 0, 8.0, 0, 17, 1.6], run: .6 },
  { name: 's05_nevsehir_elise_camcorder', at: [1, 1.0, 24.6, 2.2, 27.55, .8], cam: true, run: .6 },
  { name: 's06_kola_corridor', at: [2, 0, 2.0, 0, 20, 1.5], run: .6 },
  { name: 's07_kola_copy', at: [2, 3.2, 12.0, .2, 12.0, 1.2], enemy: true, run: 1.0, enemyAt: [0, 12.0, .5] },
  { name: 's08_paris_catacombs', at: [3, 0, 1.0, 0, 13, 1.3], run: .6 },
  { name: 's09_paris_final_chamber', at: [3, 0, 26.0, 0, 36.6, 2.6], warm: [0, 24.0, 0, 36.6, 2.6], run: .4 },
  // out of the crawl, the whisper at your back: turn round with the camcorder down (game.html buildSakarya)
  { name: 's10_sakarya_behind_you', at: [0, 0, 15.9, 0, 18, 1.5], torch: true, run: .4, behind: [0, 11, 1.55] },
  // key-art plates: same places, no HUD, 4K
  { name: 'k_gate', plate: true, at: [0, 0, 29.2, 0, 32.55, 1.25], choices: { power: 'relay' }, run: 3 },
  { name: 'k_kola', plate: true, at: [2, 0, 2.0, 0, 20, 1.5], run: .6 },
  { name: 'k_copy', plate: true, at: [2, 3.2, 12.0, .2, 12.0, 1.2], enemy: true, run: 1.0, enemyAt: [0, 12.0, .5] },
  { name: 'k_paris', plate: true, at: [3, 0, 1.0, 0, 13, 1.3], run: .6 },
].filter((s) => !only || only.has(s.name));
// META=1: the Meta Horizon Store screenshots instead (5 at 2560x1440, DerinlikQuest/art/screenshots/). They show the game
// as the headset draws it: the VR quality (low: no post-processing) and no flat-screen HUD, which the headset never shows.
const META = !!process.env.META;
const META_SHOTS = ['s01_sakarya_basement', 's04_nevsehir_hall', 's06_kola_corridor', 's08_paris_catacombs', 's09_paris_final_chamber'];
if (META) SHOTS.splice(0, SHOTS.length, ...SHOTS.filter((s) => META_SHOTS.includes(s.name)));

fs.mkdirSync(path.join(outRoot, 'screenshots'), { recursive: true });
fs.mkdirSync(path.join(outRoot, 'tools', 'plates'), { recursive: true });
const html = fs.readFileSync(htmlPath);
const server = http.createServer((req, res) => { if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); } res.writeHead(404); res.end(); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];

async function open(plate) {
  // plates: 2560x1440 CSS px at the game's maximum pixel ratio (1.5) = 3840x2160 rendered pixels
  const page = await browser.newPage(plate ? { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1.5 } : META ? { viewport: { width: 2560, height: 1440 } } : { viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', (r) => (r.request().url().startsWith(url) || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.addInitScript(([LANG, Q]) => { try { localStorage.setItem('derinlik.quality', Q); localStorage.setItem('derinlik.lang', LANG); } catch (_) {} }, [process.env.LANG_UI || 'en', META ? 'low' : 'high']); // on-screen text language: LANG_UI=tr node capture.mjs
  // pictures only: without a sound device the headless browser's Web Audio grows by gigabytes over a long capture
  await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
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
  // time advances in separate calls: dialogue lines chain through promises, which only settle between calls
  const step = async (sec) => { for (let t = 0; t < sec - 1e-6; t += .5) await page.evaluate((dt) => window.__derinlik.advance(dt), Math.min(.5, sec - t)); };
  const place = (at, rebuild) => page.evaluate(([[ch, x, z, lx, lz, ly], rebuild, choices]) => {
    const d = window.__derinlik;
    if (rebuild) { for (const k of Object.keys(d.choices)) delete d.choices[k]; Object.assign(d.choices, choices); d.buildChapter(ch); }
    d.player.enabled = true; d.player.crouched = false; d.player.x = x; d.player.z = z; d.player.eye = 1.64; d.face(lx, lz, ly); d.advance(1 / 30);
  }, [at, rebuild, s.choices || {}]);
  await page.evaluate((s) => { const d = window.__derinlik; if (d.state.camRaised) d.toggleCam(); d.DEBUG.enemyOff = !s.enemy; d.DEBUG.noViewModel = !!s.plate; }, s); // key art: no camcorder in hand
  await place(s.at, true);
  if (s.warm) { await place([s.at[0], ...s.warm], false); await step(3); await place(s.at, false); }
  await page.evaluate((s) => { const d = window.__derinlik; if (d.torch.visible !== !!s.torch) { d.torch.visible = !!s.torch; d.FX.emit('torch', d.torch.visible); } }, s);
  await step(s.run);
  // enemyAt [x, z, r]: the Copy patrols, so wait (up to 40 s of game time) until its visible body stands there
  if (s.enemyAt) for (let t = 0; t < 40; t += .25) {
    const near = await page.evaluate(([x, z, r]) => { const f = window.__derinlik.enemy?.fig?.position; return !!f && Math.hypot(f.x - x, f.z - z) < r; }, s.enemyAt);
    if (near) break; await step(.25);
  }
  await page.evaluate((s) => {
    const d = window.__derinlik;
    if (s.cam && !d.state.camRaised) { d.toggleCam(); d.advance(.4); }
    // the naked eye sees where the Copy was 1.5 s ago (game.html Copy.place): aim at the body that is drawn
    if (s.enemy && d.enemy) { const f = d.enemy.fig ? d.enemy.fig.position : d.enemy; d.face(f.x, f.z, 1.5); }
    if (s.behind) { d.face(...s.behind); d.advance(1 / 30); d.advance(.12); } // the figure stands for 480 ms
    // transient pop-ups never; the HUD, the camcorder OSD and subtitles only on screenshots, never on plates
    for (const id of ['toast', 'prompt']) document.getElementById(id).style.visibility = 'hidden';
    for (const id of ['hud', 'cam', 'subs']) document.getElementById(id).style.visibility = s.plate || s.meta ? 'hidden' : '';
    d.advance(1 / 30);
  }, { ...s, meta: META });
  await page.waitForTimeout(400);
  if (META) fs.mkdirSync(path.join(outRoot, '..', 'DerinlikQuest', 'art', 'screenshots'), { recursive: true });
  const file = META ? path.join(outRoot, '..', 'DerinlikQuest', 'art', 'screenshots', `${s.name}_2560x1440.png`) : s.plate ? path.join(outRoot, 'tools', 'plates', `${s.name}.png`) : path.join(outRoot, 'screenshots', `${s.name}.png`);
  await page.screenshot({ path: file, timeout: 300000 });
  console.log('wrote', path.relative(process.cwd(), file));
}
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'console errors: 0');
await browser.close(); server.close();
