#!/usr/bin/env node
/**
 * Build a playable preview: the whole game as one page plus its files, served from nowhere.
 *
 * A trailer shows what the game looks like; only the game shows what it plays like. This produces
 * a build that runs from a relative path with no server at all, which is exactly what a static
 * host — or an artifact page — can serve.
 *
 * Two things make that possible and both are properties of the game rather than tricks played on
 * it. Practice against bots is fully offline by design, so a missing `/api` costs the menus a
 * profile and nothing else. And model paths now resolve against `import.meta.env.BASE_URL`, so a
 * relative build asks for `./models/...` instead of demanding the host's root.
 *
 * The page it writes is the built `index.html` with its document wrapper removed, because an
 * artifact supplies its own `<!doctype>`, `<head>` and `<body>`.
 *
 * Usage: npm run pack:preview
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'dist', 'preview');
const client = path.join(root, 'packages', 'client');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// A relative base is the whole point: `/assets/...` and `/models/...` are both host-root requests,
// and a page served from anywhere but a root gets a 404 for every one of them.
console.log('building the client with a relative base...');
execFileSync('npx', ['vite', 'build', '--base=./', '--outDir', path.join(out, 'app'), '--emptyOutDir'], {
  cwd: client,
  stdio: 'inherit',
});

const app = path.join(out, 'app');
const models = path.join(root, 'dist', 'client', 'models');
if (!existsSync(models)) {
  console.error('dist/client/models is missing — run `npm run build` (and `npm run assets:build`) first');
  process.exit(1);
}
cpSync(models, path.join(app, 'models'), { recursive: true });

/**
 * Strip the document wrapper.
 *
 * An artifact page is wrapped in its own `<!doctype>…<head>…<body>` at publish time, so shipping
 * a second complete document nests one inside the other. What is wanted is the head's own
 * contents — title, styles, the module script — followed by the body's markup.
 */
const html = readFileSync(path.join(app, 'index.html'), 'utf8');
const head = (/<head>([\s\S]*?)<\/head>/.exec(html) ?? [])[1] ?? '';
const body = (/<body>([\s\S]*?)<\/body>/.exec(html) ?? [])[1] ?? '';

const keep = head
  .split('\n')
  // `<meta charset>` and the viewport are supplied by the wrapper, and a second manifest or icon
  // link would point at files this page does not publish.
  .filter((line) => !/<meta charset|name="viewport"|rel="(icon|manifest)"/.test(line))
  .join('\n')
  .trim();

writeFileSync(
  path.join(out, 'index.html'),
  `${keep}\n${body.trim()}\n`,
);

/** Every file the page needs, at the path the page asks for. */
const files = {};
const walk = (dir, prefix = '') => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(abs, rel);
    else if (entry.name !== 'index.html') files[rel] = abs;
  }
};
walk(app);

writeFileSync(path.join(out, 'files.json'), `${JSON.stringify(files, null, 2)}\n`);

let bytes = 0;
for (const abs of Object.values(files)) bytes += statSync(abs).size;
bytes += statSync(path.join(out, 'index.html')).size;

console.log(`\npreview → ${path.relative(root, out)}`);
console.log(`  page   ${path.relative(root, path.join(out, 'index.html'))}`);
console.log(`  files  ${Object.keys(files).length} (${(bytes / 1024 / 1024).toFixed(1)} MB total)`);
console.log(`  map    ${path.relative(root, path.join(out, 'files.json'))}`);
