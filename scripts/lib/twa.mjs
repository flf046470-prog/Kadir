/**
 * Shared machinery for the two Trusted Web Activity packages this game ships.
 *
 * Kangaroo Chase is published as a TWA twice: once to the Meta Horizon Store as an immersive
 * WebXR title, and once to Google Play as a landscape phone game. The two differ in four lines
 * of config and share everything that is actually easy to get wrong — the manifest requirements,
 * the icon sizes, the reverse-DNS package id, the Digital Asset Links story.
 *
 * That is why this file exists rather than a second copy of `pack-quest.mjs`. A copy would drift,
 * and the way it would drift is that a fix made after a store rejection lands in one of them.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

/** Both stores require an icon of at least 512×512; maskable is what a launcher actually crops. */
export const REQUIRED_ICONS = [
  { src: '/icons/icon-192.png', size: 192, purpose: 'any' },
  { src: '/icons/icon-512.png', size: 512, purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', size: 512, purpose: 'maskable' },
];

/** Read an IHDR width/height straight out of the PNG header — no image library needed. */
export async function pngSize(file) {
  const buf = await readFile(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Validate the web manifest and the icons it points at.
 *
 * Identical for both targets: a store rejects the same things whether the headset or the phone
 * is doing the installing.
 */
export async function validateManifest(publicDir, problem) {
  const manifestPath = path.join(publicDir, 'manifest.webmanifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (!['fullscreen', 'standalone'].includes(manifest.display)) {
    problem(`manifest display is "${manifest.display}"; a TWA requires fullscreen or standalone`);
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
    problem('sw.js is missing; the app cannot start offline from the device library');
  }

  return manifest;
}

/**
 * Derive an Android package id from a host.
 *
 * Reverse-DNS is the Android convention: `kangaroochase.example` → `example.kangaroochase`. Two
 * things make a derived id illegal and both are repaired here rather than discovered by a build
 * failure twenty minutes later: a segment starting with a digit, and a single-segment result.
 */
export function packageIdForHost(domain, override) {
  const segments = domain
    .toLowerCase()
    .split('.')
    .reverse()
    .map((s) => s.replace(/[^a-z0-9_]/g, '_'))
    .map((s) => (/^[0-9]/.test(s) ? `x${s}` : s));
  if (segments.length < 2) segments.push('kangaroochase');
  return override ?? segments.join('.');
}

export function isValidPackageId(id) {
  return /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/.test(id);
}

export function isBareHost(domain) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain);
}

/** Render a target's template into its `twa-manifest.json`. */
export async function renderTwaManifest({ outDir, domain, packageId, version }) {
  const template = await readFile(path.join(outDir, 'twa-manifest.template.json'), 'utf8');
  const rendered = JSON.parse(
    template.replaceAll('__DOMAIN__', domain).replaceAll('__PACKAGE_ID__', packageId).replaceAll('__VERSION__', version),
  );
  delete rendered.$comment;

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'twa-manifest.json'), `${JSON.stringify(rendered, null, 2)}\n`);
  return rendered;
}

/**
 * The Digital Asset Links reminder, printed for both targets.
 *
 * Without a verified `assetlinks.json` a TWA launches with a browser URL bar across the top.
 * Google Play tolerates that and reviewers usually do not; the Horizon Store rejects it outright
 * for an immersive title. It is the single most common reason a first submission comes back.
 */
export function assetLinksNotes(note, domain) {
  note(`\nThen publish the Digital Asset Links file so the TWA verifies:`);
  note(`  keytool -list -v -keystore ./android.keystore -alias android   # take the SHA-256`);
  note(`  bubblewrap fingerprint add <sha256>`);
  note(`  serve the generated assetlinks.json at https://${domain}/.well-known/assetlinks.json`);
  note(`\nWithout it the app launches with a browser URL bar, which reviewers reject.`);
}
