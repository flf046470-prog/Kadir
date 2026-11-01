#!/usr/bin/env node
/**
 * Put the Steam and Epic Coming Soon material into one folder per store, laid out in the order the
 * portal asks for it, and zip each one.
 *
 * Nothing here makes art or writes copy. The art is `pack:pc:listing` and `pack:trailer`, the copy
 * and the portal steps are `docs/PC_LISTINGS.md`, and both stay the source: the kit's text files
 * are cut from that doc's fenced blocks with the same parser `copy.test.ts` holds to the game, and
 * its CHECKLIST.md is that doc's own sections. So the kit cannot say something the doc does not.
 *
 * It exists because the art is gitignored and generated in a container that is thrown away: the
 * account holder needs the files *off* the machine, in one piece, with nothing to work out about
 * which file goes in which slot.
 *
 * It refuses when a file is missing, and says loudly when the art is older than the game code it
 * was shot from — the art in this repo once sat two weeks behind four visible changes (tree
 * boughs, ground and ice, water, planted feet), and nothing said so.
 *
 * Usage:
 *   npm run pack:pc:kit        # → dist/store-kit/{steam,epic}/ and their .zip
 */

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseListing, section } from './lib/copy.mjs';
import { CHECKLIST, FILES, TEXT } from './lib/kit.mjs';
import { jpegSize } from './lib/listing.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DOC = path.join(root, 'docs', 'PC_LISTINGS.md');
const LISTING = {
  steam: path.join(root, 'packaging', 'steam', 'listing'),
  epic: path.join(root, 'packaging', 'epic', 'listing'),
};
const OUT = path.join(root, 'dist', 'store-kit');

/** Width x height read from the file itself, or the file's type for anything that is not an image. */
async function describe(file) {
  const bytes = await readFile(file);
  if (file.endsWith('.png')) return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
  if (file.endsWith('.jpg')) {
    const { width, height } = jpegSize(bytes);
    return `${width}x${height}`;
  }
  return 'video';
}

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
// The last commit that changed what the game draws or how it moves.
const codeTime = Number(git('log', '-1', '--format=%ct', '--', 'packages/client', 'packages/core', 'assets')) * 1000;
const commit = git('rev-parse', '--short', 'HEAD');

const markdown = await readFile(DOC, 'utf8');
const blocks = new Map(parseListing(markdown).map((s) => [s.heading, s.text]));
const problems = [];
const stale = [];

await rm(OUT, { recursive: true, force: true });

for (const store of ['steam', 'epic']) {
  const dir = path.join(OUT, store);
  const manifest = [];
  for (const [to, from] of Object.entries(FILES[store])) {
    const source = path.join(LISTING[store], from);
    const info = await stat(source).catch(() => null);
    if (!info) {
      problems.push(`${store}: ${path.relative(root, source)} is missing — run pack:pc:listing / pack:trailer`);
      continue;
    }
    if (info.mtimeMs < codeTime) stale.push(`${store}/${to}`);
    await mkdir(path.dirname(path.join(dir, to)), { recursive: true });
    await copyFile(source, path.join(dir, to));
    const size = (info.size / 1024 / 1024).toFixed(2);
    manifest.push(`| \`${to}\` | ${await describe(source)} | ${size} MB | ${new Date(info.mtimeMs).toISOString().slice(0, 10)} |`);
  }
  for (const [to, heading] of Object.entries(TEXT[store])) {
    const text = blocks.get(heading);
    if (!text) {
      problems.push(`${store}: docs/PC_LISTINGS.md has no block under "## ${heading}"`);
      continue;
    }
    await mkdir(path.dirname(path.join(dir, to)), { recursive: true });
    await writeFile(path.join(dir, to), `${text}\n`);
  }
  const sections = CHECKLIST[store].map((heading) => {
    const text = section(markdown, heading);
    if (!text) problems.push(`${store}: docs/PC_LISTINGS.md has no section "## ${heading}"`);
    return text ?? '';
  });
  const title = store === 'steam' ? 'Steam' : 'Epic Games Store';
  await writeFile(
    path.join(dir, 'CHECKLIST.md'),
    [
      `# Kangaroo Chase — ${title} Coming Soon kit`,
      '',
      `Built from commit \`${commit}\` on ${new Date().toISOString().slice(0, 10)}. The folders are`,
      'numbered in the order the portal asks for them; paste the `.txt` files as they are.',
      '',
      '| File | Size | Weight | Shot on |',
      '| --- | --- | --- | --- |',
      ...manifest,
      '',
      ...sections.flatMap((s) => [s, '']),
    ].join('\n'),
  );
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

for (const store of ['steam', 'epic']) {
  const zip = path.join(OUT, `kangaroo-chase-${store}-coming-soon.zip`);
  // Images and video are compressed already; storing them saves minutes and loses nothing.
  execFileSync('zip', ['-r', '-q', '-n', '.png:.jpg:.mp4', zip, store], { cwd: OUT });
  const { size } = await stat(zip);
  console.log(`${path.relative(root, zip)} — ${(size / 1024 / 1024).toFixed(1)} MB`);
}

if (stale.length) {
  console.warn(
    `\n⚠ ${stale.length} file(s) are older than the last change to the game (${new Date(codeTime).toISOString().slice(0, 10)}):` +
      `\n  ${stale.join('\n  ')}\n  Re-shoot with pack:pc:listing and pack:trailer before uploading.`,
  );
}
