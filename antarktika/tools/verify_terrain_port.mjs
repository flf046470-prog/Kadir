// Compares the Python terrain port (blender/scripts/terrain.py) with the
// JavaScript terrain code inside the original game file, at 2000 random points.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
const here = path.dirname(url.fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'original', 'index.html'), 'utf8');
const payload = html.match(/const terrainPayload="([A-Za-z0-9+/=]+)"/)[1];
const block = html.slice(html.indexOf('window.ICEWALK_TERRAIN=(()=>{'), html.indexOf('window.ICEWALK_IMMERSIVE'));
const fnStart = html.indexOf('function terrainY(x,z){');
const fnEnd = html.indexOf('function normalAt(');
const terrainFn = html.slice(fnStart, fnEnd);
const window = {};
const atob = (s) => Buffer.from(s, 'base64').toString('binary');
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const terrainPayload = payload;
eval(block);
const terrainY = eval('(' + terrainFn.replace('function terrainY', 'function') + ')');
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pts = [];
for (let i = 0; i < 2000; i++) pts.push([+(rnd() * 700 - 350).toFixed(3), +(rnd() * 560 - 410).toFixed(3)]);
const js = pts.map(([x, z]) => terrainY(x, z));
fs.writeFileSync('/tmp/claude-0/terrain_pts.json', JSON.stringify(pts));
const py = JSON.parse(execFileSync('python3', [path.join(here, '..', 'blender', 'scripts', 'terrain.py'), fs.readFileSync('/tmp/claude-0/terrain_pts.json', 'utf8')]).toString());
let maxErr = 0; for (let i = 0; i < pts.length; i++) maxErr = Math.max(maxErr, Math.abs(js[i] - py[i]));
console.log(JSON.stringify({ points: pts.length, maxAbsError: maxErr, sample: pts.slice(0, 3).map((p, i) => ({ p, js: js[i], py: py[i] })) }));
if (maxErr > 1e-4) { console.error('MISMATCH'); process.exit(1); }
