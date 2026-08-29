#!/usr/bin/env node
/**
 * Prepare the Meta Quest / Horizon Store PWA package.
 *
 * This renders the Bubblewrap project config and checks the things that are cheap to get wrong
 * and expensive to discover after a store rejection. It deliberately stops short of running
 * `bubblewrap build`: that needs the JDK, the Android SDK and — critically — the signing key,
 * which must never live in a repo. The final two commands are printed instead.
 *
 * Usage:
 *   npm run pack:quest -- --domain kangaroochase.example
 *   npm run pack:quest -- --domain <host> --package-id net.example.kangaroochase
 *   npm run pack:quest -- --check          # validate the manifest/icons only
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = path.join(root, 'packages', 'client', 'public');
const outDir = path.join(root, 'packaging', 'meta-quest');

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

/** Meta requires an icon of at least 512x512; maskable is what the launcher actually crops. */
const REQUIRED_ICONS = [
  { src: '/icons/icon-192.png', size: 192, purpose: 'any' },
  { src: '/icons/icon-512.png', size: 512, purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', size: 512, purpose: 'maskable' },
];

/** Read an IHDR width/height straight out of the PNG header. */
async function pngSize(file) {
  const buf = await readFile(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function validate() {
  const manifestPath = path.join(publicDir, 'manifest.webmanifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  // An immersive WebXR PWA must not show browser chrome.
  if (!['fullscreen', 'standalone'].includes(manifest.display)) {
    problem(`manifest display is "${manifest.display}"; Horizon requires fullscreen or standalone`);
  }
  for (const field of ['name', 'short_name', 'start_url', 'scope', 'id']) {
    if (!manifest[field]) problem(`manifest is missing "${field}"`);
  }
  if (manifest.name && manifest.name.length > 45) {
    problem(`manifest name is ${manifest.name.length} chars; store listings truncate past ~45`);
  }

  for (const required of REQUIRED_ICONS) {
    const entry = manifest.icons?.find((i) => i.src === required.src && (i.purpose ?? 'any').includes(required.purpose));
    if (!entry) {
      problem(`manifest has no ${required.purpose} icon at ${required.src}`);
      continue;
    }
    const file = path.join(publicDir, required.src);
    try {
      await access(file);
    } catch {
      problem(`${required.src} is referenced by the manifest but missing on disk`);
      continue;
    }
    const size = await pngSize(file);
    if (!size) problem(`${required.src} is not a valid PNG`);
    else if (size.width !== required.size || size.height !== required.size) {
      problem(`${required.src} is ${size.width}x${size.height}; manifest declares ${required.size}x${required.size}`);
    }
  }

  const sw = path.join(publicDir, 'sw.js');
  try {
    await access(sw);
  } catch {
    problem('sw.js is missing; the PWA cannot start offline from the headset library');
  }

  return manifest;
}

async function render() {
  if (!DOMAIN) {
    problem('--domain is required to render the Bubblewrap config (the TWA is bound to one origin)');
    return;
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(DOMAIN)) {
    problem(`--domain "${DOMAIN}" does not look like a bare host (no scheme, no path)`);
    return;
  }

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  // Reverse-DNS from the host, which is the Android convention: kangaroochase.example ->
  // example.kangaroochase. A segment starting with a digit is illegal in a Java package name,
  // and a single-segment id is rejected outright, so both are repaired here.
  const segments = DOMAIN.toLowerCase()
    .split('.')
    .reverse()
    .map((s) => s.replace(/[^a-z0-9_]/g, '_'))
    .map((s) => (/^[0-9]/.test(s) ? `x${s}` : s));
  if (segments.length < 2) segments.push('kangaroochase');
  const packageId = PACKAGE_ID ?? segments.join('.');

  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/.test(packageId)) {
    problem(`derived packageId "${packageId}" is not a valid Android package name; pass --package-id`);
    return;
  }
  const template = await readFile(path.join(outDir, 'twa-manifest.template.json'), 'utf8');

  const rendered = JSON.parse(
    template.replaceAll('__DOMAIN__', DOMAIN).replaceAll('__PACKAGE_ID__', packageId).replaceAll('__VERSION__', pkg.version),
  );
  delete rendered.$comment;

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'twa-manifest.json'), `${JSON.stringify(rendered, null, 2)}\n`);

  note(`\nWrote packaging/meta-quest/twa-manifest.json`);
  note(`  host        ${DOMAIN}`);
  note(`  packageId   ${packageId}`);
  note(`  mode        ${rendered.horizonOSAppMode} (launches straight into WebXR)`);

  note(`\nNext, with the JDK + Android SDK installed:`);
  note(`  npm install --global @meta-quest/bubblewrap-cli`);
  note(`  cd packaging/meta-quest && bubblewrap init --manifest=https://${DOMAIN}/manifest.webmanifest --metaquest`);
  note(`  bubblewrap build            # -> app-release-signed.apk / .aab`);
  note(`\nThen publish the Digital Asset Links file so the TWA verifies:`);
  note(`  keytool -list -v -keystore ./android.keystore -alias android   # take the SHA-256`);
  note(`  bubblewrap fingerprint add <sha256>`);
  note(`  serve the generated assetlinks.json at https://${DOMAIN}/.well-known/assetlinks.json`);
  note(`\nWithout a verified assetlinks.json the app launches with a browser URL bar, which the`);
  note(`Horizon Store rejects for an immersive title.`);
}

const manifest = await validate();
if (!CHECK_ONLY) await render();

if (problems.length > 0) {
  console.error(`\n\x1b[31m${problems.length} problem(s):\x1b[0m`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  note(`\nPWA checks passed — "${manifest.name}", display=${manifest.display}, ${manifest.icons.length} icons.`);
}
