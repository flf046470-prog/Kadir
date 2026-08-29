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
 *   npm run build && npm run pack:steam
 *   npm run pack:steam -- --appid 480 --depotid 481   # also render the Steamworks VDFs
 */

import { cp, mkdir, readFile, rm, writeFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const out = path.join(dist, 'steam-app');
const src = path.join(root, 'packaging', 'steam');

const args = process.argv.slice(2);
const value = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPID = value('--appid');
const DEPOTID = value('--depotid');

const problems = [];

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

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const input of INPUTS) {
  await cp(input.from, path.join(out, input.to), { recursive: true });
}
await cp(path.join(src, 'main.cjs'), path.join(out, 'main.cjs'));

// Keep the Electron app version in step with the workspace rather than letting it drift.
const rootPkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const appPkg = JSON.parse(await readFile(path.join(src, 'package.json'), 'utf8'));
appPkg.version = rootPkg.version;
await writeFile(path.join(out, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`);

// The main process resolves these three at require/spawn time; a typo in a path here would only
// surface as a runtime failure on a player's machine, so it is checked now.
const CRITICAL = ['main.cjs', 'package.json', 'resources/shell/index.cjs', 'resources/server/main.js', 'resources/client/index.html'];
for (const file of CRITICAL) {
  if (!(await exists(path.join(out, file)))) problems.push(`packaged app is missing ${file}`);
}

const mainSource = await readFile(path.join(out, 'main.cjs'), 'utf8');
for (const required of ['./resources/shell/index.cjs', 'resources', 'server', 'main.js']) {
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
console.log(`\nPackaged dist/steam-app (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  client  ${(await dirSize(path.join(out, 'resources/client')) / 1024 / 1024).toFixed(1)} MB`);
console.log(`  server  ${((await dirSize(path.join(out, 'resources/server'))) / 1024).toFixed(0)} kB`);
console.log(`  shell   ${((await dirSize(path.join(out, 'resources/shell'))) / 1024).toFixed(0)} kB`);

console.log(`\nRun it locally:`);
console.log(`  npx electron dist/steam-app`);
console.log(`\nBuild the distributable (needs Electron + a code-signing certificate):`);
console.log(`  npx @electron/packager dist/steam-app "Kangaroo Chase" --platform=win32 --arch=x64 --out=dist/steam`);
console.log(`\nThen upload with steamcmd:`);
console.log(`  steamcmd +login <builduser> +run_app_build <abs path>/dist/steam-app/steamworks/app_build.vdf +quit`);
console.log(`\nNote: the Electron window is flat-only — Electron builds Chromium with enable_vr=false,`);
console.log(`so "Play in VR" hands off to Chrome/Edge, where SteamVR's OpenXR runtime drives WebXR.`);
