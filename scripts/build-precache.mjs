#!/usr/bin/env node
/**
 * Emit `dist/client/precache.json` — the list the service worker installs on first run.
 *
 * Without this the PWA cannot start offline, and the reason is subtle enough to be worth
 * writing down: a service worker activates *after* the page that registered it has already
 * fetched its scripts. Those first fetches never pass through the worker, so a runtime
 * cache-on-fetch strategy leaves the hashed bundle uncached until a second visit. Reload with
 * no network before that and you get the shell HTML with a dead <script> — worse than no
 * offline support, because it looks like a broken app rather than an offline one.
 *
 * So the worker precaches from an explicit list instead. Vite's filenames are content-hashed
 * and unknown until the build finishes, which is why this runs after it rather than being a
 * constant in sw.js.
 *
 * Models are deliberately excluded: a WebXR PWA launches straight into immersive mode and
 * anything fetched up front counts against Meta's startup-time requirement. Art packs are
 * optional anyway, so they stay lazy and are cached on first use.
 */

import { readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'client');

/** Everything needed to boot, relative to the site root. Never anything under /models/. */
const ROOTS = ['index.html', 'manifest.webmanifest', 'favicon.svg'];
const DIRS = ['assets', 'icons'];

async function listDir(rel) {
  const abs = path.join(dist, rel);
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) out.push(...(await listDir(child)));
      else out.push(child);
    }
    return out;
  } catch {
    return [];
  }
}

const files = [...ROOTS];
for (const dir of DIRS) files.push(...(await listDir(dir)));

const present = [];
let bytes = 0;
for (const file of files) {
  try {
    const info = await stat(path.join(dist, file));
    present.push(`/${file}`);
    bytes += info.size;
  } catch {
    // A root that a given build did not emit is not fatal; the worker tolerates gaps too.
  }
}

// "/" and "/index.html" are distinct cache keys: navigations are matched against "/".
const urls = ['/', ...present];

await writeFile(path.join(dist, 'precache.json'), `${JSON.stringify({ version: Date.now(), urls }, null, 2)}\n`);
console.log(`precache.json — ${urls.length} entries, ${(bytes / 1024).toFixed(0)} kB (models excluded)`);
