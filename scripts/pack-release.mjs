#!/usr/bin/env node
/**
 * Assemble the uploadable release artifacts into `dist/release/`.
 *
 * This script does not build anything itself. It collects what the build steps produced, zips
 * each one in the shape its store actually wants, and records a checksum for every file. The
 * split matters: building needs a toolchain (Electron binaries, the Android SDK, a signing key)
 * that CI does not have, but *checking that a release is complete and self-consistent* should
 * run anywhere. So a missing input is reported with the command that produces it, and only
 * `--require <target>` turns that into a failure.
 *
 * Usage:
 *   npm run pack:release                      # collect whatever is present
 *   npm run pack:release -- --require web     # fail if the web bundle is missing
 *   npm run pack:release -- --version 0.2.0
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const releaseDir = path.join(dist, 'release');

const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const REQUIRED = args.reduce((acc, a, i) => (a === '--require' ? [...acc, args[i + 1]] : acc), []);

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(full) : (await stat(full)).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * `zip -X` drops the platform-specific extra fields. Without it two zips of identical trees
 * differ, which makes the checksum below useless for answering "is this the build I tested?".
 */
function zipDir(cwd, entry, outFile) {
  execFileSync('zip', ['-r', '-q', '-X', outFile, entry], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

const collected = [];
const skipped = [];
const stale = [];

/**
 * Newest mtime anywhere under a path. Used to compare an artifact against its source.
 */
async function newestMtime(target) {
  const info = await stat(target);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = info.mtimeMs;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    newest = Math.max(newest, await newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

/**
 * Refuse to ship an artifact older than what it was built from.
 *
 * This exists because it actually happened: `@electron/packager` writes `resources/app.asar`,
 * and Electron resolves that *before* `resources/app/`. Refreshing the unpacked directory
 * therefore changes nothing, the distributable keeps running a build from days earlier, and
 * `pack:release` cheerfully zips 150 MB of it with a checksum that looks authoritative. The
 * failure is silent in every direction — the zip is valid, the app runs, it is simply the wrong
 * game. A date comparison is a cheap way to never be fooled by it twice.
 */
async function checkFreshness(id, artifact, source) {
  if (!(await exists(source))) return true;
  const [artifactAt, sourceAt] = [await newestMtime(artifact), await newestMtime(source)];
  if (artifactAt >= sourceAt) return true;
  const hours = ((sourceAt - artifactAt) / 3_600_000).toFixed(1);
  stale.push({ id, hours, artifact: path.relative(root, artifact), source: path.relative(root, source) });
  return false;
}

async function collect({ id, title, from, kind, out, note, hint, freshAgainst }) {
  if (!(await exists(from))) {
    skipped.push({ id, title, hint });
    return;
  }
  if (freshAgainst && !(await checkFreshness(id, from, freshAgainst))) return;
  const target = path.join(releaseDir, out);
  await rm(target, { force: true });

  if (kind === 'dir') {
    zipDir(path.dirname(from), path.basename(from), target);
  } else {
    await writeFile(target, await readFile(from));
  }

  const size = (await stat(target)).size;
  collected.push({ id, title, file: out, size, sha256: await sha256(target), note });
  console.log(`  + ${out}  (${mb(size)})`);
}

async function main() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = value('--version') ?? pkg.version;

  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  console.log(`Assembling release ${version}\n`);

  // The web bundle is the keystone, not just one target of three: the Quest app is a thin
  // wrapper around this origin, so nothing ships to Meta until this is hosted somewhere.
  await collect({
    id: 'web',
    title: 'Web / PWA build',
    from: path.join(dist, 'client'),
    kind: 'dir',
    out: `kangaroo-chase-web-${version}.zip`,
    note: 'Upload to any static host. Serve over HTTPS; this origin is what the Quest app wraps.',
    hint: 'npm run build',
  });

  for (const [platform, label] of [
    ['win32-x64', 'win-x64'],
    ['linux-x64', 'linux-x64'],
    ['darwin-arm64', 'macos-arm64'],
  ]) {
    await collect({
      id: `steam-${label}`,
      title: `Steam depot payload (${label})`,
      from: path.join(dist, 'steam', `KangarooChase-${platform}`),
      kind: 'dir',
      out: `kangaroo-chase-steam-${label}-${version}.zip`,
      note: 'Unzip and point the depot at the folder. Steam ships a directory, not an installer.',
      hint: `npx @electron/packager dist/steam-app KangarooChase --platform=${platform.split('-')[0]} --arch=${platform.split('-')[1]} --electron-version=<v> --out=dist/steam`,
      // The packaged app embeds an app.asar; refreshing dist/steam-app alone does not update it.
      freshAgainst: path.join(dist, 'steam-app'),
    });
  }

  const questDir = value('--quest-dir') ?? path.join(root, 'packaging', 'meta-quest');
  await collect({
    id: 'quest-aab',
    title: 'Meta Horizon Store upload',
    from: path.join(questDir, 'app-release-bundle.aab'),
    kind: 'file',
    out: `kangaroo-chase-quest-${version}.aab`,
    note: 'The Horizon Store upload. Signed with the key in twa-manifest.json — keep that key forever.',
    hint: 'npm run pack:quest -- --domain <host>  then  bubblewrap build',
  });
  await collect({
    id: 'quest-apk',
    title: 'Meta Quest sideload build',
    from: path.join(questDir, 'app-release-signed.apk'),
    kind: 'file',
    out: `kangaroo-chase-quest-${version}.apk`,
    note: 'Sideload with: adb install -r <file>. Same binary as the .aab, packaged for direct install.',
    hint: 'npm run pack:quest -- --domain <host>  then  bubblewrap build',
  });

  const phoneDir = value('--phone-dir') ?? path.join(root, 'packaging', 'android-phone');
  await collect({
    id: 'phone-aab',
    title: 'Google Play upload',
    from: path.join(phoneDir, 'app-release-bundle.aab'),
    kind: 'file',
    out: `kangaroo-chase-android-${version}.aab`,
    note: 'The Play upload. Signed with the key in twa-manifest.json — keep that key forever.',
    hint: 'npm run build:phone -- --domain <host>',
  });
  await collect({
    id: 'phone-apk',
    title: 'Android sideload build',
    from: path.join(phoneDir, 'app-release-signed.apk'),
    kind: 'file',
    out: `kangaroo-chase-android-${version}.apk`,
    note: 'Sideload with: adb install -r <file>. Test on a real phone before uploading anything.',
    hint: 'npm run build:phone -- --domain <host>',
  });

  if (stale.length > 0) {
    console.error(`\n\x1b[31m${stale.length} artifact(s) older than what they were built from:\x1b[0m`);
    for (const s of stale) {
      console.error(`  - ${s.id}: ${s.artifact} is ${s.hours}h older than ${s.source}`);
      console.error(`      rebuild it, or it ships the wrong game with a convincing checksum`);
    }
    process.exitCode = 1;
  }

  if (collected.length === 0) {
    console.error('\nNothing to package — run `npm run build` first.');
    process.exitCode = 1;
    return;
  }

  const sums = collected.map((c) => `${c.sha256}  ${c.file}`).join('\n');
  await writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), `${sums}\n`);

  const lines = [
    `Kangaroo Chase ${version} — release artifacts`,
    ''.padEnd(46, '='),
    '',
    ...collected.flatMap((c) => [`${c.file}  (${mb(c.size)})`, `    ${c.title}`, `    ${c.note}`, '']),
  ];
  if (skipped.length > 0) {
    lines.push('Not built in this run:', '');
    for (const s of skipped) lines.push(`  ${s.title}`, `      ${s.hint}`, '');
  }
  lines.push('Verify a download with:  sha256sum -c SHA256SUMS.txt', '');
  await writeFile(path.join(releaseDir, 'README.txt'), lines.join('\n'));

  console.log(`\n${collected.length} artifact(s) in dist/release (${mb(collected.reduce((n, c) => n + c.size, 0))})`);
  for (const s of skipped) console.log(`  ~ ${s.title} not built — ${s.hint}`);

  const missing = REQUIRED.filter((id) => !collected.some((c) => c.id === id));
  if (missing.length > 0) {
    console.error(`\n\x1b[31mmissing required target(s): ${missing.join(', ')}\x1b[0m`);
    process.exitCode = 1;
  }
}

await main();
