#!/usr/bin/env node
/**
 * Prepare the Microsoft Store (MSIX) package.
 *
 * The third store, and the third wrapper around the same web build. Windows takes a Progressive
 * Web App from the Store as a hosted app: the MSIX carries the manifest and the tile art, and
 * points at the deployed origin — the same shape as the Trusted Web Activity that goes to Meta
 * and Google, which is why this script looks like its siblings and shares their manifest checks.
 *
 * What it does:
 *   - validates the web manifest and icons (shared with the TWA targets)
 *   - generates the full Windows tile and logo set from the source icon
 *   - renders AppxManifest.xml from the template
 *
 * Like `pack:quest` and `pack:phone` it deliberately stops before building the package itself.
 * `makeappx` and `signtool` ship with the Windows SDK and only run on Windows, and the identity
 * it must be built against is issued per-app by Partner Center. The final commands are printed.
 *
 * Usage:
 *   npm run pack:msstore -- --domain kangaroochase.example \
 *       --identity-name 12345Publisher.KangarooChase \
 *       --publisher "CN=ABCDEF12-3456-7890-ABCD-EF1234567890" \
 *       --publisher-display "Your Studio"
 *   npm run pack:msstore -- --check          # validate inputs and art only
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compose, decodePng, encodePng } from './lib/png.mjs';
import { isBareHost, validateManifest } from './lib/twa.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = path.join(root, 'packages', 'client', 'public');
const outDir = path.join(root, 'packaging', 'microsoft-store');
/**
 * `makeappx pack /d <dir>` packages *everything* under the directory it is given, so the payload
 * gets its own folder. Pointing it at packaging/microsoft-store directly would ship the template
 * and this script's own scratch files inside the MSIX.
 */
const buildDir = path.join(outDir, 'build');
const imagesDir = path.join(buildDir, 'images');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const CHECK_ONLY = flag('--check');
const DOMAIN = value('--domain');
const IDENTITY_NAME = value('--identity-name');
const PUBLISHER = value('--publisher');
const PUBLISHER_DISPLAY = value('--publisher-display') ?? 'Kangaroo Chase';

const problems = [];
const note = (m) => console.log(m);
const problem = (m) => problems.push(m);

/** Brand colours. The dark green is the game's own ground colour, so tiles match the splash. */
const BACKGROUND = '#1d3a24';

/**
 * Every image an MSIX submission is expected to carry.
 *
 * Scale-200 variants are included because Windows picks by DPI and a 150 % or 200 % display is
 * the common case on laptops — without them Windows upscales the 100 % art and the tile looks
 * soft next to every other app on the Start menu. `targetsize` variants are the taskbar and
 * Start list icons; `altform-unplated` is the one shown without Windows' coloured plate behind
 * it, so it needs a transparent background rather than the brand green.
 */
const IMAGES = [
  { file: 'StoreLogo.png', w: 50, h: 50 },
  { file: 'StoreLogo.scale-200.png', w: 100, h: 100 },
  { file: 'Square44x44Logo.png', w: 44, h: 44, padding: 0.08 },
  { file: 'Square44x44Logo.scale-200.png', w: 88, h: 88, padding: 0.08 },
  { file: 'Square44x44Logo.targetsize-24_altform-unplated.png', w: 24, h: 24, padding: 0, transparent: true },
  { file: 'Square44x44Logo.targetsize-44_altform-unplated.png', w: 44, h: 44, padding: 0, transparent: true },
  { file: 'Square44x44Logo.targetsize-256_altform-unplated.png', w: 256, h: 256, padding: 0, transparent: true },
  { file: 'Square71x71Logo.png', w: 71, h: 71 },
  { file: 'Square71x71Logo.scale-200.png', w: 142, h: 142 },
  { file: 'Square150x150Logo.png', w: 150, h: 150 },
  { file: 'Square150x150Logo.scale-200.png', w: 300, h: 300 },
  { file: 'Square310x310Logo.png', w: 310, h: 310 },
  { file: 'Square310x310Logo.scale-200.png', w: 620, h: 620 },
  { file: 'Wide310x150Logo.png', w: 310, h: 150 },
  { file: 'Wide310x150Logo.scale-200.png', w: 620, h: 300 },
  { file: 'SplashScreen.png', w: 620, h: 300, padding: 0.22 },
  { file: 'SplashScreen.scale-200.png', w: 1240, h: 600, padding: 0.22 },
];

/**
 * Partner Center issues the publisher as a distinguished name, and people reliably paste their
 * company name instead. That mistake is only caught at upload, after a signing round trip.
 */
function isPublisherDn(publisher) {
  return /^CN=/i.test(publisher);
}

/** Store package names are alphanumeric with dots and dashes, and are reserved, never invented. */
function isIdentityName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/.test(name);
}

/**
 * The Store version: four parts, and the last must be 0 because the Store owns that field.
 * package.json is semver, so it is widened rather than reinvented.
 */
function storeVersion(semver) {
  const [major = '0', minor = '0', patch = '0'] = semver.split('-')[0].split('.');
  return `${Number(major)}.${Number(minor)}.${Number(patch)}.0`;
}

async function generateImages() {
  const source = decodePng(await readFile(path.join(publicDir, 'icons', 'icon-1024.png')));
  await mkdir(imagesDir, { recursive: true });

  for (const spec of IMAGES) {
    const image = compose(source, {
      width: spec.w,
      height: spec.h,
      background: spec.transparent ? undefined : BACKGROUND,
      padding: spec.padding ?? 0.16,
      transparent: spec.transparent ?? false,
    });
    await writeFile(path.join(imagesDir, spec.file), encodePng(image));
  }
  return IMAGES.length;
}

async function render() {
  if (!DOMAIN) {
    problem('--domain is required: the package points at one deployed origin');
    return;
  }
  if (!isBareHost(DOMAIN)) {
    problem(`--domain "${DOMAIN}" does not look like a bare host (no scheme, no path)`);
    return;
  }
  if (!IDENTITY_NAME) {
    problem('--identity-name is required — copy it from Partner Center → Product identity');
    return;
  }
  if (!isIdentityName(IDENTITY_NAME)) {
    problem(`--identity-name "${IDENTITY_NAME}" is not a valid package name`);
    return;
  }
  if (!PUBLISHER) {
    problem('--publisher is required — the "CN=..." string from Partner Center, not a company name');
    return;
  }
  if (!isPublisherDn(PUBLISHER)) {
    problem(`--publisher "${PUBLISHER}" must be the distinguished name from Partner Center, starting "CN="`);
    return;
  }

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
  const version = storeVersion(pkg.version);

  // The template's comments explain the template. They are three kilobytes of our own build notes
  // and they have no business being shipped inside a Store package, so the render drops them.
  const template = (await readFile(path.join(outDir, 'AppxManifest.template.xml'), 'utf8'))
    .replaceAll(/<!--[\s\S]*?-->\n?/g, '')
    .replaceAll(/\n{3,}/g, '\n\n');
  const rendered = template
    .replaceAll('__IDENTITY_NAME__', IDENTITY_NAME)
    .replaceAll('__PUBLISHER__', escapeXml(PUBLISHER))
    .replaceAll('__PUBLISHER_DISPLAY_NAME__', escapeXml(PUBLISHER_DISPLAY))
    .replaceAll('__VERSION__', version)
    .replaceAll('__DOMAIN__', DOMAIN)
    .replaceAll('__DISPLAY_NAME__', escapeXml(manifest.name))
    .replaceAll('__SHORT_NAME__', escapeXml(manifest.short_name ?? manifest.name))
    .replaceAll('__DESCRIPTION__', escapeXml(manifest.description ?? manifest.name))
    .replaceAll('__BACKGROUND__', BACKGROUND);

  await mkdir(buildDir, { recursive: true });
  await writeFile(path.join(buildDir, 'AppxManifest.xml'), rendered);
  const count = await generateImages();

  note(`\nWrote packaging/microsoft-store/build/AppxManifest.xml`);
  note(`  origin      https://${DOMAIN}/`);
  note(`  identity    ${IDENTITY_NAME}`);
  note(`  publisher   ${PUBLISHER}`);
  note(`  version     ${version}   (the Store owns the fourth part; it stays 0)`);
  note(`  images      ${count} tile and logo files generated from icons/icon-1024.png`);

  note(`\nBuild the package on Windows, with the Windows SDK on PATH:`);
  note(`  makeappx pack /d packaging\\microsoft-store\\build /p packaging\\microsoft-store\\KangarooChase.msix /o`);
  note(`\nThen upload KangarooChase.msix to Partner Center. Do not sign it yourself for Store`);
  note(`submission — the Store re-signs with its own certificate, and a self-signed package is`);
  note(`rejected. Sign only for sideloading during testing:`);
  note(`  signtool sign /fd SHA256 /a /f test.pfx /p <password> KangarooChase.msix`);
  note(`\nIf you would rather not install the SDK, PWABuilder produces the same kind of package`);
  note(`from the deployed URL: https://www.pwabuilder.com/  → enter https://${DOMAIN}/ → Windows.`);
  note(`This script exists so the manifest, capabilities and tile art are ours rather than`);
  note(`whatever a generator guessed — point PWABuilder at the site, then compare.`);
}

function escapeXml(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const manifest = await validateManifest(publicDir, problem);

// The Store shows the description on the listing page and in the app's own tile tooltip.
if (!manifest.description) problem('manifest has no "description"; the Store listing needs one');
if (manifest.short_name && manifest.short_name.length > 13) {
  problem(`manifest short_name is ${manifest.short_name.length} chars; Windows tiles truncate past 13`);
}

if (CHECK_ONLY) {
  // Prove the art can actually be produced, without writing the identity-bearing manifest.
  try {
    const count = await generateImages();
    note(`Generated ${count} Windows tile images from icons/icon-1024.png`);
  } catch (error) {
    problem(`could not generate tile art: ${error?.message ?? error}`);
  }
} else {
  await render();
}

if (problems.length > 0) {
  console.error(`\n[31m${problems.length} problem(s):[0m`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  note(`\nMicrosoft Store checks passed — "${manifest.name}", ${IMAGES.length} tile images.`);
}
