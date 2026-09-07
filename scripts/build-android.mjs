#!/usr/bin/env node
/**
 * Build a signed Android package (.aab + .apk) for either store.
 *
 * Two targets, one script, because the Quest and phone builds differ only in which packaging
 * directory they use and which store the output goes to. Everything below — the loopback icon
 * server, the version-name flag, the SDK-layout check, the asset-links emission — was learned
 * once and applies to both; a second copy would only drift.
 *
 *   --target quest   Meta Horizon Store, immersive WebXR   (packaging/meta-quest)
 *   --target phone   Google Play, landscape touch          (packaging/android-phone)
 *
 * `pack-quest.mjs` / `pack-phone.mjs` render and validate the Bubblewrap config; this drives the
 * actual Android build. It is separate because it needs a toolchain CI does not have — a JDK, the Android SDK
 * and a signing key — and because everything here was learned the hard way:
 *
 *  - Bubblewrap fetches the icons and web manifest over HTTP at generation time and bakes them
 *    into the APK. Pointing it at the real host means you cannot build until the site is live,
 *    and then you ship whatever that host happened to be serving. So this serves `dist/client`
 *    on loopback and generates from *the build you just made*. `host` still names the real
 *    origin — that is what the intent filter and the asset-links check use.
 *  - `--skipVersionUpgrade` writes an empty `versionName` into build.gradle, which the store
 *    rejects. Passing `--appVersionName` explicitly is the path that produces a real version.
 *  - `--skipPwaValidation` skips a PageSpeed round-trip against the live host, which does not
 *    exist yet at first build and would only re-check what `pack:quest` already checked.
 *  - Bubblewrap's SDK validation predates the current SDK layout: it wants `<sdk>/tools` or
 *    `<sdk>/bin`, while modern installs only have `<sdk>/cmdline-tools/latest/bin`. Rather than
 *    fail with "the provided androidSdk isn't correct", this checks and explains.
 *
 * Usage:
 *   npm run build
 *   npm run build:quest -- --domain play.example.com
 *   npm run build:phone -- --domain play.example.com
 *   npm run build:quest -- --domain play.example.com --keystore ~/keys/kangaroo.keystore
 *
 * Environment:
 *   ANDROID_HOME / ANDROID_SDK_ROOT   Android SDK (needs build-tools 36.1.0, platform 36)
 *   JAVA_HOME                         JDK 17
 *   KC_KEYSTORE_PASSWORD              store password (prompted-free, required for CI)
 *   KC_KEY_PASSWORD                   key password (defaults to KC_KEYSTORE_PASSWORD)
 */

import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const clientDir = path.join(root, 'dist', 'client');

const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Which store this build is for. Everything target-specific hangs off this one table. */
const TARGETS = {
  quest: {
    dir: 'meta-quest',
    packScript: 'pack-quest.mjs',
    store: 'Horizon Store',
    bundleNote: 'upload this to the Horizon Store',
  },
  phone: {
    dir: 'android-phone',
    packScript: 'pack-phone.mjs',
    store: 'Google Play',
    bundleNote: 'upload this to Google Play',
  },
};

const TARGET_NAME = value('--target') ?? 'quest';
const TARGET = TARGETS[TARGET_NAME];
if (!TARGET) {
  console.error(`Unknown --target "${TARGET_NAME}". Expected one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}
const outDir = path.join(root, 'packaging', TARGET.dir);

const DOMAIN = value('--domain');
const PACKAGE_ID = value('--package-id');
const KEYSTORE = path.resolve(value('--keystore') ?? path.join(outDir, 'android.keystore'));
const ALIAS = value('--alias') ?? 'android';
const BUBBLEWRAP = value('--bubblewrap') ?? '@bubblewrap/cli@1.25.0';

const JDK = value('--jdk') ?? process.env.JAVA_HOME;
const SDK = value('--sdk') ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;

const STORE_PASSWORD = process.env.KC_KEYSTORE_PASSWORD;
const KEY_PASSWORD = process.env.KC_KEY_PASSWORD ?? STORE_PASSWORD;

const die = (message) => {
  console.error(`\x1b[31merror\x1b[0m ${message}`);
  process.exit(1);
};

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Async on purpose. The icon server below runs in *this* process, so a synchronous
 * `execFileSync` would block the event loop and the loopback requests Bubblewrap makes during
 * generation would never be answered — a deadlock that looks exactly like a slow build.
 */
function run(cmd, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: 'inherit', cwd: outDir, ...opts });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${argv.join(' ')} exited with ${code}`)),
    );
  });
}

/** Serve the built client so Bubblewrap reads icons from this build, not from the internet. */
function serveClient(dir) {
  const TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(path.resolve(dir))) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function ensureKeystore() {
  if (await exists(KEYSTORE)) return;
  if (!STORE_PASSWORD) die('KC_KEYSTORE_PASSWORD is not set and no keystore exists to reuse');

  console.log(`\n\x1b[33mNo keystore at ${KEYSTORE} — generating one.\x1b[0m`);
  console.log('The store binds this listing to this key permanently. Back it up now, off this');
  console.log('machine. Losing it means never shipping an update to the listing again.\n');

  await mkdir(path.dirname(KEYSTORE), { recursive: true });
  await run(path.join(JDK, 'bin', 'keytool'), [
    '-genkeypair', '-v',
    '-keystore', KEYSTORE,
    '-alias', ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-storepass', STORE_PASSWORD,
    '-keypass', KEY_PASSWORD,
    '-dname', 'CN=Kangaroo Chase, OU=Games, O=Kangaroo Chase, L=-, S=-, C=US',
  ]);
}

/** The SHA-256 of the signing certificate is what Digital Asset Links binds the origin to. */
function certFingerprint() {
  const out = execFileSync(
    path.join(JDK, 'bin', 'keytool'),
    ['-list', '-v', '-keystore', KEYSTORE, '-alias', ALIAS, '-storepass', STORE_PASSWORD],
    { encoding: 'utf8' },
  );
  const match = out.match(/SHA256:\s*([0-9A-F:]{95})/i);
  return match?.[1] ?? null;
}

async function main() {
  if (!DOMAIN) die('--domain is required (the TWA is bound to exactly one origin)');
  if (!JDK) die('JAVA_HOME is not set; Bubblewrap needs a JDK 17');
  if (!SDK) die('ANDROID_HOME is not set; Bubblewrap needs the Android SDK');
  if (!(await exists(clientDir))) die('dist/client is missing — run `npm run build` first');
  console.log(`=> target ${TARGET_NAME} (${TARGET.store})`);
  if (!(await exists(path.join(SDK, 'bin'))) && !(await exists(path.join(SDK, 'tools')))) {
    die(
      `Bubblewrap will reject this SDK: it looks for <sdk>/bin or <sdk>/tools, and ${SDK} has neither.\n` +
        `  Modern installs only create cmdline-tools/latest/bin. Link it:\n` +
        `    ln -s "${SDK}/cmdline-tools/latest/bin" "${SDK}/bin"\n` +
        `    ln -s "${SDK}/cmdline-tools/latest/lib" "${SDK}/lib"`,
    );
  }

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  // Render + validate through the existing gate, so the store checks cannot be bypassed here.
  console.log(`=> ${TARGET.packScript} (render + validate)`);
  await run(process.execPath, [
    path.join(root, 'scripts', TARGET.packScript),
    '--domain', DOMAIN,
    ...(PACKAGE_ID ? ['--package-id', PACKAGE_ID] : []),
  ], { cwd: root });

  await ensureKeystore();

  // Bubblewrap resolves the JDK and SDK from its own config, not from the environment.
  const bwConfig = path.join(process.env.HOME ?? '/root', '.bubblewrap', 'config.json');
  await mkdir(path.dirname(bwConfig), { recursive: true });
  await writeFile(bwConfig, `${JSON.stringify({ jdkPath: JDK, androidSdkPath: SDK }, null, 2)}\n`);

  const manifestPath = path.join(outDir, 'twa-manifest.json');
  const shipped = JSON.parse(await readFile(manifestPath, 'utf8'));

  const { server, port } = await serveClient(clientDir);
  const local = `http://127.0.0.1:${port}`;
  console.log(`=> serving dist/client on ${local} for icon generation`);

  try {
    // Generation-time only: the icons and manifest come from this build. `host`, `startUrl` and
    // `fullScopeUrl` still point at the real origin, which is what actually ends up in the APK.
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...shipped,
          iconUrl: `${local}/icons/icon-512.png`,
          maskableIconUrl: `${local}/icons/icon-maskable-512.png`,
          webManifestUrl: `${local}/manifest.webmanifest`,
          signingKey: { path: KEYSTORE, alias: ALIAS },
        },
        null,
        2,
      )}\n`,
    );

    console.log('=> bubblewrap update');
    await run('npx', ['--yes', BUBBLEWRAP, 'update', '--appVersionName', pkg.version], {
      env: { ...process.env, JAVA_HOME: JDK, ANDROID_HOME: SDK },
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    console.log('=> bubblewrap build');
    await run('npx', ['--yes', BUBBLEWRAP, 'build', '--skipPwaValidation'], {
      env: {
        ...process.env,
        JAVA_HOME: JDK,
        ANDROID_HOME: SDK,
        BUBBLEWRAP_KEYSTORE_PASSWORD: STORE_PASSWORD,
        BUBBLEWRAP_KEY_PASSWORD: KEY_PASSWORD,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } finally {
    server.close();
    // Put the shipped URLs back so the file on disk describes the real origin, not loopback.
    await writeFile(manifestPath, `${JSON.stringify(shipped, null, 2)}\n`);
  }

  // Without a verified assetlinks.json a TWA launches with a URL bar across the top. Play
  // tolerates it and reviewers usually do not; the Horizon Store rejects it outright for an
  // immersive title. Either way, emit the exact file that has to be served.
  const fingerprint = certFingerprint();
  if (fingerprint) {
    const assetlinks = [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: shipped.packageId,
          sha256_cert_fingerprints: [fingerprint],
        },
      },
    ];
    const out = path.join(outDir, 'assetlinks.json');
    await writeFile(out, `${JSON.stringify(assetlinks, null, 2)}\n`);
    console.log(`\nWrote ${path.relative(root, out)}`);
    console.log(`  serve it at https://${DOMAIN}/.well-known/assetlinks.json`);
  } else {
    console.log('\nCould not read the certificate fingerprint; generate assetlinks.json manually.');
  }

  for (const [file, what] of [
    ['app-release-bundle.aab', TARGET.bundleNote],
    ['app-release-signed.apk', 'sideload: adb install -r <file>'],
  ]) {
    const full = path.join(outDir, file);
    if (await exists(full)) console.log(`  ${file.padEnd(26)} ${what}`);
  }

  console.log('\nNow run `npm run pack:release` to collect the artifacts.');
}

await main();
