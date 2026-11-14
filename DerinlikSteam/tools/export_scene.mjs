// Exports one chapter's built world from the game as a GLB (geometry, materials, the baked PBR textures) plus its
// lamps as JSON, so Blender can render the same place photorealistically (tools/prologue_blender.py).
// Usage (repository root, after the offline build):
//   node DerinlikSteam/tools/export_scene.mjs DerinlikWeb/dist/offline/index.html <out dir> [chapter]
// Writes <out dir>/chapter<N>.glb and <out dir>/chapter<N>_lights.json. Coordinates are the game's (three.js, Y up);
// Blender's glTF importer turns them Z up.
import { chromium } from 'playwright';
import fs from 'fs'; import http from 'http'; import path from 'path'; import { execFileSync } from 'child_process';

const [,, htmlPath, outDir, chArg = '0'] = process.argv;
const CH = +chArg;
const here = path.dirname(new URL(import.meta.url).pathname), web = path.join(here, '..', '..', 'DerinlikWeb');
fs.mkdirSync(outDir, { recursive: true });
// three's GLTFExporter, bundled on its own: it recognises objects by their isMesh/isMaterial flags, so a second copy of
// three works on the game's objects
const exporter = execFileSync(path.join(web, 'node_modules', '.bin', 'esbuild'), ['--bundle', '--format=iife', '--log-level=warning'], {
  cwd: web, input: "import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'; window.GLTFExporter = GLTFExporter;",
}).toString();

const html = fs.readFileSync(htmlPath);
const server = http.createServer((req, res) => { if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); } res.writeHead(404); res.end(); }).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.route('**/*', (r) => (r.request().url().startsWith(url) || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
await page.addInitScript(() => { try { localStorage.setItem('derinlik.quality', 'high'); localStorage.setItem('derinlik.lang', 'en'); } catch (_) {} delete window.AudioContext; delete window.webkitAudioContext; });
await page.goto(url);
await page.waitForFunction(() => window.__derinlik && window.__derinlik.W.group.children.length > 10, null, { timeout: 180000 });
await page.evaluate((ch) => { const d = window.__derinlik; if (ch !== 0) d.buildChapter(ch, { persist: false }); }, CH);
await page.waitForTimeout(8000); // the PBR sets decode and attach asynchronously (fx-materials)
await page.addScriptTag({ content: exporter });
const out = await page.evaluate(async () => {
  const d = window.__derinlik, g = d.W.group; g.updateMatrixWorld(true);
  // ray targets the game never draws (hit planes: material.visible false) would come out as opaque cards
  const hidden = []; g.traverse((o) => { if (o.isMesh && o.visible && [].concat(o.material).every((m) => m.visible === false)) { o.visible = false; hidden.push(o); } });
  const glb = await new window.GLTFExporter().parseAsync(g, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
  for (const o of hidden) o.visible = true;
  let s = ''; const b = new Uint8Array(glb); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  const lights = [];
  d.scene.traverse((o) => {
    if (!o.isLight || o.isAmbientLight || o === d.torch) return;
    const p = o.getWorldPosition(new o.position.constructor());
    lights.push({ type: o.type, pos: p.toArray(), color: o.color.getHex(), intensity: o.intensity, distance: o.distance ?? 0, decay: o.decay ?? 2, visible: o.visible && (!o.parent || o.parent.visible !== false), angle: o.angle ?? null });
  });
  const t = d.torch;
  return { glb: btoa(s), lights, fov: d.camera.fov, torch: { color: t.color.getHex(), intensity: t.intensity, distance: t.distance, decay: t.decay, angle: t.angle, penumbra: t.penumbra, offset: t.position.toArray(), target: t.target.position.toArray() }, fog: [d.scene.fog.color.getHex(), d.scene.fog.density], exposure: d.renderer.toneMappingExposure };
});
fs.writeFileSync(path.join(outDir, `chapter${CH}.glb`), Buffer.from(out.glb, 'base64'));
delete out.glb;
fs.writeFileSync(path.join(outDir, `chapter${CH}_lights.json`), JSON.stringify(out, null, 1));
console.log(`chapter ${CH}: ${(fs.statSync(path.join(outDir, `chapter${CH}.glb`)).size / 1e6).toFixed(1)} MB, ${out.lights.length} lights`);
await browser.close(); server.close();
