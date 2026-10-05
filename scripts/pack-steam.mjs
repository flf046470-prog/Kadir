#!/usr/bin/env node
/**
 * Assemble the Steam application directory from the built output.
 *
 * Produces `dist/steam-app/`, which is a runnable Electron app directory:
 *
 *   dist/steam-app/
 *     main.cjs                 Electron main process
 *     package.json
 *     resources/client/        the web build (served over localhost, not file://)
 *     resources/server/        the authoritative game server
 *     resources/shell/         OpenXR + browser-handoff logic, unit tested in @kc/shell
 *
 * It stops before producing the platform binary. Packaging that needs Electron itself — a
 * ~200 MB download per target platform — and code signing, so the final command is printed
 * rather than run. What this script *does* do is verify the directory is complete and
 * self-consistent, which is the part that silently breaks when a build step is skipped.
 *
 * Usage:
 *   npm run build && npm run pack:steam -- --online https://play.example.com
 *   npm run pack:steam -- --appid 480 --depotid 481   # also render the Steamworks VDFs
 *
 * `--online` is the hosted server the build plays online on. Without it the build plays only on
 * the server it carries, on `127.0.0.1` — a game in which no two players can ever meet — so the
 * script says so loudly. The same directory is the Epic build.
 */

import { cp, mkdir, readFile, rm, writeFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
// `--out` is for `check:shell`, which packs a throwaway copy with a test origin in it rather than
// leaving one in `dist/steam-app` where it could be shipped.
const outArg = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined;
const out = outArg ? path.resolve(outArg) : path.join(dist, 'steam-app');
const shown = path.relative(root, out) || '.';
const src = path.join(root, 'packaging', 'steam');

const args = process.argv.slice(2);
const value = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPID = value('--appid');
const DEPOTID = value('--depotid');
const ONLINE = value('--online');

const problems = [];

/**
 * The hosted origin, or '' for an offline-only build. Plain http is refused for anything but this
 * machine: the session token and every intent would cross the internet in the clear.
 */
function onlineOrigin(raw) {
  if (raw === undefined) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    problems.push(`--online is not a URL: ${raw}`);
    return '';
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) problems.push(`--online must be https (got ${url.protocol}//${url.host})`);
  return url.origin;
}
const ONLINE_ORIGIN = onlineOrigin(ONLINE);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

// Each of these is produced by a different build step, and a missing one produces a package that
// launches to a blank window rather than an error — so they are checked explicitly.
const INPUTS = [
  { from: path.join(dist, 'client'), to: 'resources/client', needs: 'npm run build:client' },
  { from: path.join(dist, 'server'), to: 'resources/server', needs: 'npm run build:server' },
  { from: path.join(dist, 'shell'), to: 'resources/shell', needs: 'npm run build:shell' },
];

for (const input of INPUTS) {
  if (!(await exists(input.from))) problems.push(`${path.relative(root, input.from)} is missing — run \`${input.needs}\``);
}
if (problems.length > 0) {
  console.error('\x1b[31mcannot package:\x1b[0m');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// `out` is deleted before packing, so `--out` gets the care any `rm -rf` of a user-supplied path
// deserves: never the repo or anything holding it, and never a folder that is not an earlier pack.
if (outArg) {
  const inside = path.relative(out, root);
  if (inside === '' || !inside.startsWith('..')) {
    console.error(`\x1b[31mrefusing --out ${outArg}:\x1b[0m it is this repository or contains it, and packing deletes it first`);
    process.exit(1);
  }
  if ((await exists(out)) && (await readdir(out)).length > 0 && !(await exists(path.join(out, 'main.cjs')))) {
    console.error(`\x1b[31mrefusing --out ${outArg}:\x1b[0m it is not empty and is not an earlier pack (no main.cjs), and packing deletes it first`);
    process.exit(1);
  }
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const input of INPUTS) {
  await cp(input.from, path.join(out, input.to), { recursive: true });
}
await cp(path.join(src, 'main.cjs'), path.join(out, 'main.cjs'));

/**
 * The packages the server bundle imports rather than contains (`ws`), with their dependencies.
 *
 * Without them the bundled server cannot start on a player's machine — and nothing noticed,
 * because inside this repository Node finds a missing package by walking up into the repo's own
 * `node_modules`. Every measurement of the Steam package so far ran it from `dist/steam-app`,
 * inside the repo; `check:shell` packs it into a scratch folder and found `Cannot find package
 * 'ws'`. The hosted image has them from `npm ci --omit=dev`; this package has nothing else.
 */
function bareImports(source) {
  const names = new Set();
  for (const match of source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
    const spec = match[1];
    if (spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/')) continue;
    names.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
  }
  return [...names];
}
const serverDir = path.join(out, 'resources', 'server');
const serverImports = bareImports(await readFile(path.join(serverDir, 'main.js'), 'utf8'));
const shipped = new Set();
async function shipPackage(name) {
  if (shipped.has(name)) return;
  shipped.add(name);
  const from = path.join(root, 'node_modules', name);
  if (!(await exists(path.join(from, 'package.json')))) {
    problems.push(`the server imports "${name}", which is not installed — run \`npm ci\``);
    return;
  }
  await cp(from, path.join(serverDir, 'node_modules', name), { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(from, 'package.json'), 'utf8'));
  // `dependencies` only: optional and peer dependencies (`ws`'s native accelerators) are loaded in
  // a try/catch by the package itself and are absent from this repo too.
  for (const dependency of Object.keys(manifest.dependencies ?? {})) await shipPackage(dependency);
}
for (const name of serverImports) await shipPackage(name);

// Keep the Electron app version in step with the workspace rather than letting it drift.
const rootPkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const appPkg = JSON.parse(await readFile(path.join(src, 'package.json'), 'utf8'));
appPkg.version = rootPkg.version;
// Read by main.cjs (`onlineOriginFor` in @kc/shell) and handed to the bundled server, which writes
// it into the page it serves.
if (ONLINE_ORIGIN) appPkg.kangarooChase = { ...appPkg.kangarooChase, onlineOrigin: ONLINE_ORIGIN };
else delete appPkg.kangarooChase;
await writeFile(path.join(out, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`);

// The main process resolves these three at require/spawn time; a typo in a path here would only
// surface as a runtime failure on a player's machine, so it is checked now.
const CRITICAL = ['main.cjs', 'package.json', 'resources/shell/index.cjs', 'resources/server/main.js', 'resources/client/index.html'];
for (const file of CRITICAL) {
  if (!(await exists(path.join(out, file)))) problems.push(`packaged app is missing ${file}`);
}

// Checked inside the package itself, never by resolving: resolution walks up out of it, and from
// `dist/steam-app` it finds the repo's own `node_modules` — exactly how this went unnoticed.
for (const name of serverImports) {
  if (!(await exists(path.join(serverDir, 'node_modules', name, 'package.json')))) problems.push(`packaged server cannot import "${name}"`);
}

const mainSource = await readFile(path.join(out, 'main.cjs'), 'utf8');
for (const required of ['./resources/shell/index.cjs', 'resources', 'server', 'main.js', 'KC_ONLINE_ORIGIN', 'requestSingleInstanceLock']) {
  if (!mainSource.includes(required)) problems.push(`main.cjs no longer references "${required}"`);
}

if (APPID || DEPOTID) {
  if (!APPID || !DEPOTID) problems.push('pass both --appid and --depotid, or neither');
  else {
    const vdfOut = path.join(out, 'steamworks');
    await mkdir(vdfOut, { recursive: true });
    for (const name of ['app_build.vdf', 'depot_build.vdf']) {
      const text = await readFile(path.join(src, 'steamworks', name), 'utf8');
      await writeFile(path.join(vdfOut, name), text.replaceAll('__APPID__', APPID).replaceAll('__DEPOTID__', DEPOTID));
    }
    console.log(`Rendered steamworks/*.vdf for appid ${APPID}, depot ${DEPOTID}`);
  }
}

if (problems.length > 0) {
  console.error('\x1b[31mpackage is incomplete:\x1b[0m');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const size = await dirSize(out);
console.log(`\nPackaged ${shown} (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  client  ${(await dirSize(path.join(out, 'resources/client')) / 1024 / 1024).toFixed(1)} MB`);
console.log(`  server  ${((await dirSize(path.join(out, 'resources/server'))) / 1024).toFixed(0)} kB (with ${[...shipped].join(', ') || 'no packages'})`);
console.log(`  shell   ${((await dirSize(path.join(out, 'resources/shell'))) / 1024).toFixed(0)} kB`);

if (ONLINE_ORIGIN) {
  console.log(`  online  ${ONLINE_ORIGIN} (falls back to the bundled server when unreachable)`);
} else {
  console.log(`\n\x1b[33mOFFLINE-ONLY BUILD:\x1b[0m no --online origin, so every install plays on its own computer and`);
  console.log(`no two players can ever meet. Pass --online https://<hosted server> for a release.`);
}

console.log(`\nRun it locally:`);
console.log(`  npx electron dist/steam-app`);
console.log(`\nBuild the distributable (downloads Electron; needs a code-signing certificate to ship):`);
// The app name must stay "KangarooChase" with no space: it becomes the executable name, and
// pack-release.mjs collects dist/steam/KangarooChase-<platform>-<arch>. Renaming it here
// silently breaks the release step.
console.log(`  npx @electron/packager dist/steam-app KangarooChase \\`);
console.log(`    --platform=win32,linux --arch=x64 --electron-version=44.0.0 --out=dist/steam`);
console.log(`  npm run pack:release        # zips each one into dist/release`);
console.log(`\nThen upload with steamcmd:`);
console.log(`  steamcmd +login <builduser> +run_app_build <abs path>/dist/steam-app/steamworks/app_build.vdf +quit`);
console.log(`\nNote: the Electron window is flat-only — Electron builds Chromium with enable_vr=false,`);
console.log(`so "Play in VR" hands off to Chrome/Edge, where SteamVR's OpenXR runtime drives WebXR.`);
