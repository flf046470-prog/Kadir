#!/usr/bin/env node
/**
 * Prepare the Google Play (phone / tablet) package.
 *
 * The same web build the Quest package wraps, wrapped for a phone instead: no immersive WebXR
 * launch, landscape only, touch controls. It renders the Bubblewrap project config and checks
 * the things that are cheap to get wrong and expensive to discover after a store rejection.
 *
 * Like `pack:quest`, it deliberately stops short of running `bubblewrap build`: that needs the
 * JDK, the Android SDK and — critically — the signing key, which must never live in a repo. The
 * final commands are printed instead.
 *
 * Usage:
 *   npm run pack:phone -- --domain kangaroochase.example
 *   npm run pack:phone -- --domain <host> --package-id net.example.kangaroochase
 *   npm run pack:phone -- --check          # validate the manifest/icons only
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assetLinksNotes, isBareHost, isValidPackageId, packageIdForHost, renderTwaManifest, validateManifest } from './lib/twa.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = path.join(root, 'packages', 'client', 'public');
const outDir = path.join(root, 'packaging', 'android-phone');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const CHECK_ONLY = flag('--check');
const DOMAIN = value('--domain');
const PACKAGE_ID = value('--package-id');

const problems = [];
const note = (m) => console.log(m);
const problem = (m) => problems.push(m);

async function render() {
  if (!DOMAIN) {
    problem('--domain is required to render the Bubblewrap config (the TWA is bound to one origin)');
    return;
  }
  if (!isBareHost(DOMAIN)) {
    problem(`--domain "${DOMAIN}" does not look like a bare host (no scheme, no path)`);
    return;
  }

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const packageId = packageIdForHost(DOMAIN, PACKAGE_ID);
  if (!isValidPackageId(packageId)) {
    problem(`derived packageId "${packageId}" is not a valid Android package name; pass --package-id`);
    return;
  }

  const rendered = await renderTwaManifest({ outDir, domain: DOMAIN, packageId, version: pkg.version });

  note(`\nWrote packaging/android-phone/twa-manifest.json`);
  note(`  host        ${DOMAIN}`);
  note(`  packageId   ${packageId}`);
  note(`  orientation ${rendered.orientation} (the touch layout assumes it)`);

  note(`\nNext, with the JDK + Android SDK installed:`);
  note(`  npm install --global @bubblewrap/cli`);
  note(`  cd packaging/android-phone && bubblewrap init --manifest=https://${DOMAIN}/manifest.webmanifest`);
  note(`  bubblewrap build            # -> app-release-bundle.aab (Play) + app-release-signed.apk`);
  assetLinksNotes(note, DOMAIN);
  note(`\nPlay wants the .aab. The .apk is for sideloading and for testing on a real device before`);
  note(`you upload anything.`);
}

const manifest = await validateManifest(publicDir, problem);
if (!CHECK_ONLY) await render();

if (problems.length > 0) {
  console.error(`\n\x1b[31m${problems.length} problem(s):\x1b[0m`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  note(`\nPhone PWA checks passed — "${manifest.name}", display=${manifest.display}, ${manifest.icons.length} icons.`);
}
