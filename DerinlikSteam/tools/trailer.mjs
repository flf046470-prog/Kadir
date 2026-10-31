// Renders the Steam trailer frames straight from the game: every frame advances game time by exactly 1/30 s, so the
// result is the same on any machine (the software GPU here renders far below real time).
// Usage (repository root, after the offline build):
//   node DerinlikSteam/tools/trailer.mjs DerinlikWeb/dist/offline/index.html <frames dir>
// Writes <frames dir>/00001.jpg ... and <frames dir>/timeline.json (shot starts, for the soundtrack and the edit).
// Then: python3 DerinlikSteam/tools/soundtrack.py <frames dir>/timeline.json <frames dir>/soundtrack.wav and the
// ffmpeg line in DerinlikSteam/README.md.
import { chromium } from 'playwright';
import fs from 'fs'; import http from 'http'; import path from 'path';

const [,, htmlPath, outDir, ...rest] = process.argv;
// --stride N: a quick look at the cut, keeping only every Nth frame (game time still advances frame by frame)
const STRIDE = rest.includes('--stride') ? +rest[rest.indexOf('--stride') + 1] : 1;
const FPS = 30;
fs.mkdirSync(outDir, { recursive: true });
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'art', 'library_logo_1280.png')).toString('base64');

// k: [x, z, lookX, lookZ, lookY] keyframes spread evenly over the shot (lookX null: look at the Copy); setup runs before
// the first frame (not filmed). cam: camcorder up, from the start or at camAt (a fraction of the shot). choices: decisions
// already made, so the chapter is built in that state (DerinlikWeb/game.html CHOICES).
const SHOTS = [
  { card: 'SAKARYA', sub: '2028', dur: 2.2 },
  { ch: 0, dur: 4.2, torch: true, k: [[-.6, 1.2, .4, 8, 1.25], [-.25, 3.0, .2, 8, 1.3]] },
  // the locked pump-room door: someone is knocking from the other side
  { ch: 0, dur: 4.2, torch: true, k: [[-.4, 30.4, -3.1, 31.8, 1.1], [-1.2, 30.9, -3.1, 31.8, 1.1]] },
  { ch: 0, dur: 3.6, choices: { power: 'relay' }, warm: 3.0, k: [[0, 28.9, 0, 32.55, 1.15], [0, 30.0, 0, 32.55, 1.2]] },
  { card: 'NEVŞEHİR', dur: 1.8 },
  { ch: 1, dur: 4.2, k: [[0, 7.6, 0, 17, 1.6], [0, 10.2, 0, 17, 1.55]] },
  // the camcorder: bare plaques, then it comes up and the glyphs are there
  { ch: 1, dur: 4.2, cam: true, camAt: .45, k: [[0, 10.2, 0, 16.9, 3.0], [0, 10.8, 0, 16.9, 3.1]] },
  { ch: 1, dur: 3.2, cam: true, k: [[.6, 24.0, 2.2, 27.55, .8], [.9, 24.6, 2.2, 27.55, .8]] },
  { card: 'KOLA', sub: '1986', dur: 1.8 },
  { ch: 2, dur: 4.2, k: [[0, 1.6, 0, 20, 1.5], [0, 4.2, 0, 20, 1.45]] },
  { ch: 2, dur: 4.0, enemy: true, warm: 4.0, k: [[3.2, 12.0, null], [3.2, 11.6, null]] },
  { card: 'PARIS', dur: 1.8 },
  { ch: 3, dur: 5.2, k: [[0, .9, 0, 13, 1.35], [0, 4.4, 0, 13, 1.3]] },
  { ch: 3, dur: 4.0, warm: 3.0, warmAt: [0, 24.0, 0, 36.6, 2.6], k: [[0, 25.6, 0, 36.6, 2.6], [0, 27.4, 0, 36.6, 2.7]] },
  { ch: 3, dur: .7, pulse: true, warm: 3.0, warmAt: [0, 24.0, 0, 36.6, 2.6], k: [[0, 29.0, 0, 36.6, 2.6], [0, 29.2, 0, 36.6, 2.6]] },
  { ch: 2, dur: .6, pulse: true, k: [[0, 3.0, 0, 20, 1.5], [0, 3.3, 0, 20, 1.5]] },
  { ch: 0, dur: .6, pulse: true, choices: { power: 'relay' }, warm: 3.0, k: [[0, 30.6, 0, 32.55, 1.2], [0, 30.8, 0, 32.55, 1.2]] },
  { end: true, dur: 4.6 },
];

const html = fs.readFileSync(htmlPath);
const server = http.createServer((req, res) => { if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); } res.writeHead(404); res.end(); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/*', (r) => (r.request().url().startsWith(url) || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
await page.addInitScript((LANG) => { try { localStorage.setItem('derinlik.quality', 'high'); localStorage.setItem('derinlik.lang', LANG); } catch (_) {} }, process.env.LANG_UI || 'en'); // on-screen text language: LANG_UI=tr node capture.mjs
// pictures only (the soundtrack is made separately); without a sound device the headless browser's Web Audio grows by gigabytes
await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
await page.goto(url);
await page.waitForFunction(() => window.__derinlik, null, { timeout: 120000 });
await page.evaluate(() => document.fonts.ready);
await page.click('#startBtn');
await page.evaluate((logo) => {
  const d = window.__derinlik; d.DEBUG.manual = true; d.DEBUG.enemyOff = true; d.advance(5.5);
  for (const id of ['hud', 'toast', 'prompt', 'subs']) document.getElementById(id).style.visibility = 'hidden';
  const css = document.createElement('style');
  css.textContent = `#tl{position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;color:#e4ded2;font-family:"IBM Plex Sans Condensed",sans-serif;pointer-events:none;opacity:0}
    #tl .t{font-weight:300;font-size:120px;letter-spacing:.32em;margin-right:-.32em}#tl .s{font-family:VT323,monospace;font-size:54px;letter-spacing:.2em;color:#e3312b;margin-top:28px}
    #tl img{width:1180px}#tl .cs{font-weight:400;font-size:40px;letter-spacing:.5em;margin:56px -.5em 0 0;color:#c9c1b2}
    #fadeT{position:fixed;inset:0;z-index:98;background:#000;pointer-events:none;opacity:0}`;
  document.head.appendChild(css);
  const tl = document.createElement('div'); tl.id = 'tl'; document.body.appendChild(tl);
  const f = document.createElement('div'); f.id = 'fadeT'; document.body.appendChild(f);
  window.__logo = logo;
}, logo);

const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
let frame = 0;
const timeline = [];
const snap = async () => { frame++; if ((frame - 1) % STRIDE) return; await page.screenshot({ path: path.join(outDir, String(frame).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92, timeout: 300000 }); };
const stepGame = (dt) => page.evaluate((dt) => window.__derinlik.advance(dt), dt);
const place = (p, rebuild, ch, choices = {}) => page.evaluate(([[x, z, lx, lz, ly], rebuild, ch, choices]) => {
  const d = window.__derinlik;
  if (rebuild) { for (const k of Object.keys(d.choices)) delete d.choices[k]; Object.assign(d.choices, choices); d.buildChapter(ch); }
  d.player.enabled = true; d.player.crouched = false; d.player.x = x; d.player.z = z; d.player.eye = 1.64;
  if (lx === null && d.enemy) d.face(d.enemy.x, d.enemy.z, 1.5); else d.face(lx, lz, ly);
}, [p, rebuild, ch, choices]);

for (const s of SHOTS) {
  const n = Math.round(s.dur * FPS);
  timeline.push({ start: frame / FPS, dur: n / FPS, kind: s.card ? 'card' : s.end ? 'end' : s.pulse ? 'pulse' : s.cam ? 'cam' : s.enemy ? 'enemy' : 'shot', label: s.card ?? null, camAt: s.camAt != null ? (frame + Math.round(s.camAt * n)) / FPS : null, ch: s.ch ?? null });
  if (s.card || s.end) {
    await page.evaluate((s) => {
      const tl = document.getElementById('tl');
      tl.innerHTML = s.end ? `<img src="${window.__logo}"><div class="cs">COMING SOON</div>` : `<div class="t">${s.card}</div>${s.sub ? `<div class="s">${s.sub}</div>` : ''}`;
      tl.style.background = '#000';
    }, s);
    for (let i = 0; i < n; i++) {
      // fade the words in and out over the black (the end card stays)
      const a = s.end ? Math.min(1, i / 18) : Math.min(1, i / 10, (n - 1 - i) / 10);
      await page.evaluate(([a]) => { const tl = document.getElementById('tl'); tl.style.opacity = '1'; for (const c of tl.children) c.style.opacity = String(a); }, [a]);
      await snap();
    }
    await page.evaluate(() => { document.getElementById('tl').style.opacity = '0'; });
    continue;
  }
  // set the scene up off camera
  await page.evaluate((s) => { const d = window.__derinlik; if (d.state.camRaised) d.toggleCam(); d.DEBUG.enemyOff = !s.enemy; }, s);
  await place(s.k[0], true, s.ch, s.choices);
  if (s.warmAt) { await place(s.warmAt, false, s.ch); for (let t = 0; t < s.warm; t += .5) await stepGame(.5); }
  else if (s.warm) for (let t = 0; t < s.warm; t += .5) await stepGame(.5);
  // the Copy walks into its doorway during the warm-up, then holds there, facing the lens, for the whole shot
  if (s.enemy) await page.evaluate(([x, z]) => { const d = window.__derinlik, e = d.enemy; d.DEBUG.enemyOff = true; e.heading = Math.atan2(-(x - e.x), -(z - e.z)); e.place(); }, s.k[0]);
  await page.evaluate((s) => {
    const d = window.__derinlik;
    const on = !!s.torch; if (d.torch.visible !== on) { d.torch.visible = on; d.FX.emit('torch', on); }
    for (const id of ['toast', 'prompt', 'subs']) document.getElementById(id).style.visibility = 'hidden';
  }, s);
  await place(s.k[0], false, s.ch);
  if (s.cam && s.camAt == null) await page.evaluate(() => { const d = window.__derinlik; if (!d.state.camRaised) { d.toggleCam(); d.advance(.4); } });
  if (s.pulse) await page.evaluate(() => window.__derinlik.FX.emit('say', 'İkinci Ses', '', 1000));
  for (let i = 0; i < n; i++) {
    const t = ease(n > 1 ? i / (n - 1) : 0), a = s.k[0], b = s.k[s.k.length - 1];
    const p = a[2] === null ? [lerp(a[0], b[0], t), lerp(a[1], b[1], t), null] : a.map((v, j) => lerp(v, b[j], t));
    await place(p, false, s.ch);
    if (s.camAt != null && i === Math.round(s.camAt * n)) await page.evaluate(() => { const d = window.__derinlik; if (!d.state.camRaised) d.toggleCam(); });
    await stepGame(1 / FPS);
    const fade = s.pulse ? 0 : Math.max(0, 1 - Math.min(i / 8, (n - 1 - i) / 8));   // dip to black at cuts, not on the fast cuts
    await page.evaluate((f) => { document.getElementById('fadeT').style.opacity = String(f); }, fade);
    await snap();
  }
  await page.evaluate(() => { document.getElementById('fadeT').style.opacity = '0'; });
  console.log(`shot ${timeline.length}/${SHOTS.length}: ${frame} frames`);
}
fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ fps: FPS, frames: frame, shots: timeline }, null, 1));
console.log(`frames: ${frame} (${(frame / FPS).toFixed(1)} s)`, errors.length ? `page errors:\n${errors.join('\n')}` : 'page errors: 0');
await browser.close(); server.close();
