import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHttpHandler } from './http.js';
import type { ServerConfig } from './config.js';

/**
 * What the server answers for a file that is not there.
 *
 * The static handler ended every miss with the SPA fallback — `index.html`, 200, `text/html`, for
 * any path at all. Two things broke on that, and both of them fail somewhere far from here:
 *
 * `/.well-known/assetlinks.json` is how Android verifies a Trusted Web Activity. It fetches that
 * URL and parses it as JSON; it got 1241 bytes of HTML, so verification failed, so the app
 * launched with a browser URL bar across the top — which the Horizon Store rejects outright for
 * an immersive title. The 200 is what makes it invisible: every check that asks "does the URL
 * answer" passes, and the first thing that disagrees is a headset on submission day.
 *
 * And a missing `.glb` handed `GLTFLoader` an HTML document, so a path typo surfaced as a parse
 * error inside three.js rather than as a missing file.
 */

let server: Server;
let base: string;
let dir: string;

const config = (overrides: Partial<ServerConfig>): ServerConfig =>
  ({
    port: 0,
    host: '127.0.0.1',
    tickRate: 60,
    snapshotRate: 20,
    maxRooms: 4,
    maxPlayersPerRoom: 4,
    dataDir: 'data-test',
    sessionSecret: 'test-secret',
    clientTimeoutSeconds: 30,
    messageRateLimit: 90,
    allowedOrigins: [],
    publicDir: 'dist/client',
    assetLinksFile: '',
    stores: { metaAppId: '', metaAppSecret: '', steamAppId: '', steamWebApiKey: '', playPackageName: '' },
    allowDevPurchases: true,
    databaseUrl: '',
    ...overrides,
  }) as ServerConfig;

/** A statement pair as the two Android builds write it: same origin, two apps, two certificates. */
const quest = {
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: 'net.example.kc', sha256_cert_fingerprints: ['AA:BB'] },
};
const phone = {
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: 'net.example.kc', sha256_cert_fingerprints: ['CC:DD'] },
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kc-http-'));
  await mkdir(join(dir, 'public'), { recursive: true });
  await writeFile(join(dir, 'public', 'index.html'), '<!doctype html><title>app shell</title>');
  await writeFile(join(dir, 'quest.json'), JSON.stringify([quest]));
  await writeFile(join(dir, 'phone.json'), JSON.stringify([phone]));
  await writeFile(join(dir, 'broken.json'), '{ not json');

  // Only `config` is touched by the paths under test; the game services are not on this route.
  const handler = createHttpHandler({
    config: config({
      publicDir: join(dir, 'public'),
      assetLinksFile: `${join(dir, 'quest.json')},${join(dir, 'phone.json')}`,
    }),
  } as unknown as Parameters<typeof createHttpHandler>[0]);

  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

describe('/.well-known/', () => {
  it('serves asset links as JSON rather than as the app shell', async () => {
    const response = await fetch(`${base}/.well-known/assetlinks.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toBeInstanceOf(Array);
  });

  it('merges the statements of every app served from this origin', async () => {
    /**
     * `build:quest` and `build:phone` each write a single-element array into their own packaging
     * directory, signed with their own key. One origin serves both apps, and serving one file
     * verifies one app and silently fails the other — a URL bar on whichever one you forgot.
     */
    const statements = (await (await fetch(`${base}/.well-known/assetlinks.json`)).json()) as typeof quest[];
    expect(statements).toHaveLength(2);
    const prints = statements.flatMap((s) => s.target.sha256_cert_fingerprints);
    expect(prints).toContain('AA:BB');
    expect(prints).toContain('CC:DD');
  });

  it('404s anything else under it instead of answering with HTML', async () => {
    // RFC 8615 paths are machine-readable. A consumer that asks for one it cannot have must be
    // told so, not handed a web page with a 200 on it.
    const response = await fetch(`${base}/.well-known/security.txt`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toContain('text/html');
  });

  it('404s asset links when none are configured', async () => {
    const handler = createHttpHandler({
      config: config({ publicDir: join(dir, 'public') }),
    } as unknown as Parameters<typeof createHttpHandler>[0]);
    const bare = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => bare.listen(0, '127.0.0.1', resolve));
    const address = bare.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/assetlinks.json`);
    expect(response.status).toBe(404);
    bare.close();
  });

  it('takes the statements inline, for a host with no file to point at', async () => {
    /**
     * The asset-links file is written next to the keystore that signed it and is gitignored, so
     * it never enters the container image — and a container host has no filesystem to put it on.
     * A path-only setting would be one that cannot be used in the place it is needed.
     */
    const handler = createHttpHandler({
      config: config({ publicDir: join(dir, 'public'), assetLinksFile: JSON.stringify([quest, phone]) }),
    } as unknown as Parameters<typeof createHttpHandler>[0]);
    const inline = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => inline.listen(0, '127.0.0.1', resolve));
    const address = inline.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/.well-known/assetlinks.json`);
    expect(response.headers.get('content-type')).toContain('application/json');
    // Not comma-split: the commas inside the array are its own, and a path cannot start with `[`.
    await expect(response.json()).resolves.toHaveLength(2);
    inline.close();
  });

  it('404s rather than serving a file it could not parse', async () => {
    // A malformed asset-links file fails Android's verification in a way that reads as a network
    // problem. Refusing to serve it is the difference between a wrong answer and no answer.
    const handler = createHttpHandler({
      config: config({ publicDir: join(dir, 'public'), assetLinksFile: join(dir, 'broken.json') }),
    } as unknown as Parameters<typeof createHttpHandler>[0]);
    const bad = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => bad.listen(0, '127.0.0.1', resolve));
    const address = bad.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    expect((await fetch(`http://127.0.0.1:${port}/.well-known/assetlinks.json`)).status).toBe(404);
    bad.close();
  });
});

describe('the SPA fallback', () => {
  it('still answers a route with the app shell', async () => {
    // The reason the fallback exists: the client routes its own deep links, and the server has
    // no router.
    const response = await fetch(`${base}/play/jungle-world`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('404s a missing file instead of handing its loader an HTML document', async () => {
    for (const path of ['/models/does-not-exist.glb', '/assets/missing.js', '/nope.json']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type'), path).not.toContain('text/html');
    }
  });

  it('serves a file that does exist', async () => {
    const response = await fetch(`${base}/index.html`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('app shell');
  });
});
