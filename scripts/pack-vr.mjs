#!/usr/bin/env node
/**
 * Build a self-contained VR package: the game, its server, and instructions for a headset.
 *
 * This exists because the two things that already build are each half an answer:
 *
 *   - `pack:quest` renders a Bubblewrap/TWA project. A TWA is a thin native shell that opens one
 *     URL, so it needs a domain you own, a published site, and a signing key that must never live
 *     in a repo. Until those exist the APK it produces points at a placeholder host and shows a
 *     blank screen in the headset — which is worse than no file, because it looks finished.
 *   - `pack:release` emits the web bundle, which *is* the game, but with no server and no word
 *     about the one browser rule that decides whether VR works at all.
 *
 * What ships here is the thing a person can actually put on a Quest today. Verified by serving
 * the bundle from a host with no `/api` at all and driving it in a real browser: the player
 * reaches the menu, enters a match, and the models load — practice is fully offline by design,
 * and only multiplayer needs the server.
 *
 * The one hard constraint is not ours: **WebXR requires a secure context.** A browser will not
 * enter VR from `http://192.168.x.x`, however well the page works. That is a browser rule, it
 * cannot be worked around from inside the page, and it is the single thing most likely to waste
 * an afternoon — so it is the first thing the README says.
 *
 * Usage: npm run build && npm run pack:vr
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'vr-package');
/**
 * Its own directory, not `dist/release`.
 *
 * `pack:release` deletes and recreates `dist/release` before it collects anything, so a VR
 * package written there vanished the moment anyone ran the release step afterwards — silently,
 * because nothing about either script says it owns that folder. Separate outputs cannot race.
 */
const outDir = path.join(dist, 'vr');

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const zipName = `kangaroo-chase-vr-${version}.zip`;

const problems = [];
const need = (p, what) => {
  if (!existsSync(p)) problems.push(`${what} is missing (${path.relative(root, p)}) — run \`npm run build\` first`);
};
need(path.join(dist, 'client', 'index.html'), 'the web build');
need(path.join(dist, 'server', 'main.js'), 'the server build');

const models = path.join(dist, 'client', 'models');
if (!existsSync(models)) {
  // Not fatal: the game falls back to procedural avatars. But a VR package with no models is
  // almost certainly a build that skipped `npm run assets:build`, and shipping it silently would
  // hand someone a headset build that looks worse than the one on their desk.
  problems.push('dist/client/models is missing — run `npm run assets:build` (Blender) before packing');
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(path.join(dist, 'client'), path.join(stage, 'client'), { recursive: true });
cpSync(path.join(dist, 'server'), path.join(stage, 'server'), { recursive: true });

/**
 * Vendor the server's runtime dependencies, so the package runs with `node` and nothing else.
 *
 * The server bundle leaves `ws` external, so the first version of this package shipped a
 * `main.js` that died on launch with ERR_MODULE_NOT_FOUND — a file that looks like a server and
 * is not one. Requiring `npm install` instead would work, but it turns "unzip and run" into
 * "unzip, install Node, install dependencies, then run" for someone whose actual goal is to put
 * a game on a headset.
 *
 * `ws` is 204 KB with no dependencies of its own, so vendoring it costs almost nothing. It is
 * read from the repository's own `node_modules`, which means the packaged copy is the version
 * this build was tested against rather than whatever a later install would resolve to.
 *
 * Checked rather than assumed: a silently-missing dependency is exactly the failure this is
 * fixing, and the check is one `existsSync`.
 */
const RUNTIME_DEPS = ['ws'];
const vendorRoot = path.join(stage, 'server', 'node_modules');
for (const dep of RUNTIME_DEPS) {
  const from = path.join(root, 'node_modules', dep);
  if (!existsSync(from)) {
    console.error(`cannot vendor ${dep}: ${path.relative(root, from)} is missing — run \`npm ci\``);
    process.exit(1);
  }
  cpSync(from, path.join(vendorRoot, dep), { recursive: true, dereference: true });
}
// The bundle is ESM and Node decides that from the nearest package.json, so the vendored tree
// needs one or `main.js` is parsed as CommonJS and fails on its first `import`.
writeFileSync(
  path.join(stage, 'server', 'package.json'),
  `${JSON.stringify({ name: 'kangaroo-chase-server', private: true, version, type: 'module' }, null, 2)}\n`,
);

writeFileSync(
  path.join(stage, 'start-server.sh'),
  `#!/bin/sh
# Multiplayer. Solo practice needs none of this — see README.txt.
export PORT=\${PORT:-8080}
export HOST=\${HOST:-0.0.0.0}
export KC_PUBLIC_DIR="$(dirname "$0")/client"
exec node "$(dirname "$0")/server/main.js"
`,
  { mode: 0o755 },
);
writeFileSync(
  path.join(stage, 'start-server.cmd'),
  `@echo off\r\nrem Multiplayer. Solo practice needs none of this - see README.txt.\r\nset PORT=8080\r\nset HOST=0.0.0.0\r\nset KC_PUBLIC_DIR=%~dp0client\r\nnode "%~dp0server\\main.js"\r\n`,
);

writeFileSync(
  path.join(stage, 'README.txt'),
  `Kangaroo Chase ${version} — VR package
=========================================

WHAT IS IN HERE
  client/   the whole game: menus, simulation, renderer, and the animal and prop models
  server/   the multiplayer server (Node 20+). Only needed to play with other people.

────────────────────────────────────────────────────────────────────────
READ THIS FIRST: VR NEEDS HTTPS
────────────────────────────────────────────────────────────────────────
Browsers refuse to enter VR from an insecure page. That means a plain
http://192.168.x.x address will load the game and play it flat, and the
"Enter VR" button will do nothing at all. This is a browser rule, not a
setting in the game, and there is no way around it from inside the page.

So one of these has to be true before a headset can enter VR:
  * the page is served over https://, or
  * the address is exactly http://localhost (which browsers trust), or
  * you are using a tunnel that terminates HTTPS for you.

────────────────────────────────────────────────────────────────────────
FASTEST WAY TO PLAY IN A HEADSET (solo, no server)
────────────────────────────────────────────────────────────────────────
Practice against bots is fully offline — it needs no server and no
account. Upload the contents of client/ to any static host that serves
HTTPS, then open that address in the headset browser.

Anything works: GitHub Pages, Netlify, Cloudflare Pages, Vercel, an S3
bucket with a certificate. There is no build step; the folder is the site.

The game will say "Playing offline — the server could not be reached."
That is expected and correct: menus, animals, props, every mode against
bots, and VR all work. Only playing with other people needs the server.

────────────────────────────────────────────────────────────────────────
PLAYING WITH OTHER PEOPLE
────────────────────────────────────────────────────────────────────────
1. Install Node 20 or newer.
2. Run start-server.sh (macOS/Linux) or start-server.cmd (Windows).
3. It listens on port 8080 and serves the game itself, so the client/
   folder does not need a separate host.
4. Everyone opens the address in a browser. Remember the HTTPS rule above
   — for VR, put the server behind a tunnel or a reverse proxy with a
   certificate. A flat-screen player on the same LAN can use the plain
   http:// address without any of that.

Set PORT or HOST before starting to change where it listens.

────────────────────────────────────────────────────────────────────────
A NATIVE STORE BUILD
────────────────────────────────────────────────────────────────────────
The Meta Horizon Store takes an Android package that wraps your published
site, so it cannot be built until the site has a real address. It needs
three things this repository deliberately does not contain:

  * a domain you control, serving the contents of client/ over HTTPS
  * an Android signing key — which must never be committed, and which you
    must keep forever, because losing it means you can never update the
    app again
  * the Android SDK and JDK, to run the packaging step

With the domain in hand:  npm run pack:quest -- --domain <your-host>

Until then this package is the working VR build, and a store build would
only be the same game inside an icon.

────────────────────────────────────────────────────────────────────────
CONTROLS IN VR
────────────────────────────────────────────────────────────────────────
Movement is hand- and physics-driven rather than joystick-first: you
swing your arms to run and push off to hop, and comfort options (vignette,
snap turn, seated height) are in Settings. Both hands are tracked, so
controllers and hand tracking both work.
`,
);

// A checksum, so a download can be verified — the same courtesy pack:release extends.
mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, zipName);
rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-q', '-X', zipPath, 'vr-package'], { cwd: dist });

const sum = execFileSync('sha256sum', [zipPath]).toString().split(' ')[0];
writeFileSync(path.join(outDir, `${zipName}.sha256`), `${sum}  ${zipName}\n`);

const mb = (statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n${zipName}  (${mb} MB)`);
console.log(`  sha256 ${sum}`);
console.log(`  → ${path.relative(root, zipPath)}`);
console.log('\nContains the game, the server, and the headset instructions.');
console.log('Solo VR needs only an HTTPS static host; multiplayer needs the server.');
