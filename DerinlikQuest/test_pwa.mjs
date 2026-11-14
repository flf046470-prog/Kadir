// Tests the Quest web app as it is served (Meta's WebXR emulator IWER stands in for the headset):
// Chrome reads the manifest without errors, icons/privacy/assetlinks load, a browser tab stays on the start screen,
// and ?autovr (the installed app's path) enters the headset with no click.  Usage: node DerinlikQuest/test_pwa.mjs [web dir]
import { chromium } from 'playwright'; import fs from 'fs'; import http from 'http'; import path from 'path';
const here = new URL('.', import.meta.url).pathname, web = process.argv[2] || here + 'web';
const iwer = fs.readFileSync(here + 'node_modules/iwer/build/iwer.min.js', 'utf8');
const types = { '.html': 'text/html; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };
const srv = http.createServer((q, r) => { let f = path.join(web, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html';
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(8770);
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:8770/', { waitUntil: 'commit', timeout: 120000 }); await p.waitForFunction(() => window.__derinlik, null, { timeout: 120000 });
const cdp = await p.context().newCDPSession(p);
const man = await cdp.send('Page.getAppManifest');
ok(man.url.endsWith('/manifest.webmanifest') && man.errors.length === 0, `manifest read by Chrome, ${man.errors.length} errors ${JSON.stringify(man.errors)}`);
const pm = man.parsed || JSON.parse(man.data);
ok((pm.display || '').includes('standalone') || /standalone/.test(man.data), 'display standalone');
for (const s of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png', '/privacy.html']) {
  const r = await p.request.get('http://localhost:8770' + s); ok(r.status() === 200, `${s} ${r.status()}`);
}
if (fs.existsSync(path.join(web, '.well-known', 'assetlinks.json'))) {   // only once the signing key exists
  const r = await p.request.get('http://localhost:8770/.well-known/assetlinks.json'); ok(r.status() === 200 && Array.isArray(await r.json()), 'assetlinks.json');
}
ok(await p.evaluate(() => !document.getElementById('start').hidden && !window.__derinlik.state.started), 'browser tab (no TWA): stays on the start screen');
// auto-enter path
await p.close();
const q = await b.newPage({ viewport: { width: 960, height: 540 } });
q.on('pageerror', (e) => errs.push(e.message));
await q.addInitScript(iwer + `;window.__dev=new IWER.XRDevice(IWER.metaQuest3);__dev.installRuntime({forceInstall:true});__dev.position.set(0,1.6,0);`);
await q.goto('http://localhost:8770/?autovr', { waitUntil: 'commit', timeout: 120000 });
await q.waitForFunction(() => window.__derinlik && window.__derinlik.state.started && window.__derinlik.FX.xr.on, null, { timeout: 120000 });
ok(true, '?autovr: in the headset and playing without a click');
console.log('ERRORS', errs.length); errs.slice(0, 6).forEach((e) => console.log('  ', e.slice(0, 200)));
await b.close(); srv.close();
