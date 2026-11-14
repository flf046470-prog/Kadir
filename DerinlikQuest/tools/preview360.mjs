// Renders the Meta Horizon Store 360° preview from the game itself: the six cube faces of the Paris seal chamber,
// seen from the player's eye height, with the game's own renderer (no post-processing, as in the headset).
// Usage (repository root, after the offline build):
//   node DerinlikQuest/tools/preview360.mjs DerinlikWeb/dist/offline/index.html <out dir> [face px = 2048]
// Writes <out dir>/face_{px,nx,py,ny,pz,nz}.png and faces.json (each face's forward/up vectors), which
// tools/preview360.py turns into the equirectangular image the store takes.
// Meta's rules for the preview (developers.meta.com/vr/resources/asset-guidelines, "360 previews"): no title text,
// no characters, camera at least 1.67 m above the floor, a place that shows the experience's scale.
import { chromium } from 'playwright';
import fs from 'fs'; import http from 'http'; import path from 'path';

const [,, htmlPath, outDir, pxArg = '2048'] = process.argv;
const PX = +pxArg;
fs.mkdirSync(outDir, { recursive: true });
const html = fs.readFileSync(htmlPath);
const server = http.createServer((req, res) => { if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); } res.writeHead(404); res.end(); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: PX, height: PX } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.addInitScript(() => { try { localStorage.setItem('derinlik.quality', 'high'); localStorage.setItem('derinlik.lang', 'en'); } catch (_) {} delete window.AudioContext; delete window.webkitAudioContext; });
await page.goto(url, { timeout: 180000 });
await page.waitForFunction(() => window.__derinlik && window.__derinlik.W.group.children.length > 10, null, { timeout: 180000 });

// the seal chamber under Paris (14 x 16 m, 7 m high): all four seals lit, the great gate awake, nobody in the room
const EYE = [0, 1.7, 28.4];
await page.evaluate((eye) => {
  const d = window.__derinlik;
  d.DEBUG.manual = true; d.DEBUG.enemyOff = true;
  d.state.started = true; for (const s of ['sakarya', 'nevsehir', 'kola', 'paris']) d.state.seals.add(s);
  d.buildChapter(3, { persist: false });
  d.player.x = 0; d.player.z = 24; d.player.enabled = true;  // step into the chamber's entry zone: it wakes the gate
  for (let i = 0; i < 150; i++) d.advance(1 / 30);
  d.player.x = eye[0]; d.player.z = eye[2];
  for (let i = 0; i < 60; i++) d.advance(1 / 30);
  for (const id of ['hud', 'subs', 'card', 'prompt', 'toast', 'start', 'touch', 'objective']) { const e = document.getElementById(id); if (e) e.hidden = true; }
  d.torch.visible = false;                                  // a hand torch would turn with each face and leave seams
  for (const f of d.W.figures) f.group.visible = false;
}, EYE);
await page.waitForTimeout(6000);                             // PBR textures attach asynchronously

const FACES = { px: [[1, 0, 0], [0, 1, 0]], nx: [[-1, 0, 0], [0, 1, 0]], py: [[0, 1, 0], [0, 0, 1]], ny: [[0, -1, 0], [0, 0, -1]], pz: [[0, 0, 1], [0, 1, 0]], nz: [[0, 0, -1], [0, 1, 0]] };
for (const [name, [f, up]] of Object.entries(FACES)) {
  const png = await page.evaluate(([eye, f, up, px]) => {
    const d = window.__derinlik, cam = d.camera, r = d.renderer;
    const parent = cam.parent; if (parent && parent !== d.scene) d.scene.attach(cam);
    r.setPixelRatio(1); r.setSize(px, px, false);
    cam.fov = 90; cam.aspect = 1; cam.updateProjectionMatrix();
    cam.position.set(...eye); cam.up.set(...up); cam.lookAt(eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]); cam.updateMatrixWorld(true);
    r.render(d.scene, cam);
    return r.domElement.toDataURL('image/png');
  }, [EYE, f, up, PX]);
  fs.writeFileSync(path.join(outDir, `face_${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  console.log('face', name);
}
fs.writeFileSync(path.join(outDir, 'faces.json'), JSON.stringify({ eye: EYE, faces: FACES }, null, 1));
await browser.close(); server.close();
