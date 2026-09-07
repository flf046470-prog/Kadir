#!/usr/bin/env node
/**
 * Build the uploadable .msix from what `pack:msstore` rendered.
 *
 * `pack:msstore` writes the manifest and the tile art and then stops, because the usual next step
 * is `makeappx.exe` and that only runs on Windows. This finishes the job here: an MSIX is an OPC
 * package, `scripts/lib/msix.mjs` writes one, and the result is the same file Partner Center
 * expects. No Windows SDK, no PWABuilder round trip, no third-party service holding the identity.
 *
 * The package is deliberately unsigned. Partner Center re-signs every submission with its own
 * certificate and rejects packages signed by anyone else; signing is only for sideloading during
 * testing, and that is a Windows-side step.
 *
 * Everything it writes, it then reads back and checks: the archive through the system `unzip`,
 * the block map by re-hashing the bytes actually stored, and the manifest by confirming every
 * image it names is really in the package. A package that is wrong in a way only Partner Center
 * notices costs a submission round trip.
 *
 * Usage:
 *   npm run pack:msstore -- --domain <host> --identity-name <name> --publisher "CN=<guid>"
 *   npm run pack:msstore:msix
 */

import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blocksOf, buildMsix, readZip } from './lib/msix.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'packaging', 'microsoft-store');
const buildDir = path.join(outDir, 'build');

const problems = [];
const problem = (m) => problems.push(m);

/** Every file under a directory, POSIX-relative, sorted so the package is reproducible. */
async function collect(dir, prefix = '') {
  const found = [];
  for (const entry of (await readdir(dir)).sort()) {
    const full = path.join(dir, entry);
    const name = prefix ? `${prefix}/${entry}` : entry;
    if ((await stat(full)).isDirectory()) found.push(...(await collect(full, name)));
    else found.push({ name, data: await readFile(full) });
  }
  return found;
}

let payload;
try {
  payload = await collect(buildDir);
} catch {
  console.error('build-msix — packaging/microsoft-store/build is missing.');
  console.error('Run `npm run pack:msstore -- --domain <host> --identity-name <name> --publisher "CN=<guid>"` first.');
  process.exit(1);
}

const manifestFile = payload.find((f) => f.name === 'AppxManifest.xml');
if (!manifestFile) {
  console.error('build-msix — build/AppxManifest.xml is missing; `pack:msstore --check` does not write it.');
  process.exit(1);
}
const manifest = manifestFile.data.toString('utf8');

const identity = /<Identity\b[^>]*>/.exec(manifest)?.[0] ?? '';
const attribute = (name) => new RegExp(`${name}="([^"]*)"`).exec(identity)?.[1] ?? '';
const name = attribute('Name');
const publisher = attribute('Publisher');
const version = attribute('Version');
const architecture = attribute('ProcessorArchitecture') || 'neutral';

if (!name || !publisher || !version) problem('AppxManifest.xml has no usable <Identity>; re-run pack:msstore');

/**
 * Every image the manifest points at has to exist, under the exact name it uses.
 *
 * Windows resolves these paths case-insensitively and Partner Center does not; a manifest that
 * names a file the package does not contain fails validation on upload, which is the slowest
 * possible way to find a typo.
 */
const referenced = [...manifest.matchAll(/"(images\\[^"]+\.png)"/g), ...manifest.matchAll(/<Logo>(images\\[^<]+\.png)<\/Logo>/g)]
  .map((m) => m[1].replaceAll('\\', '/'));
const present = new Set(payload.map((f) => f.name));
for (const image of new Set(referenced)) {
  if (!present.has(image)) problem(`AppxManifest.xml names ${image}, which is not in the package`);
}

const packageFile = path.join(outDir, `KangarooChase_${version}_${architecture}.msix`);
const bytes = buildMsix(payload);
await writeFile(packageFile, bytes);

// --- Now check what was actually written, not what was meant to be. ---

const entries = readZip(await readFile(packageFile));
const byName = new Map(entries.map((f) => [f.name, f.data]));

for (const required of ['[Content_Types].xml', 'AppxBlockMap.xml', 'AppxManifest.xml']) {
  if (!byName.has(required)) problem(`the package is missing ${required}`);
}

// Re-hash the stored bytes and compare against what the block map claims about them.
const blockMap = byName.get('AppxBlockMap.xml')?.toString('utf8') ?? '';
let checked = 0;
for (const file of entries) {
  if (file.name === 'AppxBlockMap.xml' || file.name === '[Content_Types].xml') continue;
  const escaped = file.name.replaceAll('/', '\\').replaceAll('\\', '\\\\');
  const declared = new RegExp(`<File Name="${escaped}" Size="(\\d+)"[^>]*>((?:<Block Hash="[^"]+"/>)*)</File>`).exec(blockMap);
  if (!declared) {
    problem(`${file.name} is in the package but not in the block map`);
    continue;
  }
  if (Number(declared[1]) !== file.data.length) problem(`${file.name}: block map says ${declared[1]} bytes, package holds ${file.data.length}`);
  const hashes = [...declared[2].matchAll(/Hash="([^"]+)"/g)].map((m) => m[1]);
  if (hashes.join() !== blocksOf(file.data).join()) problem(`${file.name}: block hashes do not match the stored bytes`);
  checked++;
}

// An external opinion on the archive itself: unzip -t verifies every entry's CRC.
let unzipVerdict = 'not available';
try {
  unzipVerdict = /No errors detected/.test(execFileSync('unzip', ['-t', packageFile], { encoding: 'utf8' })) ? 'no errors' : 'REPORTED ERRORS';
  if (unzipVerdict !== 'no errors') problem('unzip -t reported errors in the package');
} catch (error) {
  if (error?.code !== 'ENOENT') problem(`unzip -t failed: ${error?.message ?? error}`);
}

const size = (bytes.length / 1024).toFixed(0);
console.log(`\nWrote ${path.relative(root, packageFile)}  (${size} KB, ${entries.length} entries)`);
console.log(`  identity    ${name}`);
console.log(`  publisher   ${publisher}`);
console.log(`  version     ${version}  (${architecture})`);
console.log(`  verified    ${checked} payload files re-hashed against the block map; unzip -t: ${unzipVerdict}`);
console.log(`  unsigned    on purpose — Partner Center re-signs, and rejects a package signed by anyone else`);

if (problems.length > 0) {
  console.error(`\n\x1b[31m${problems.length} problem(s):\x1b[0m`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\nUpload it at https://partner.microsoft.com/dashboard → your app → Packages.`);
}
