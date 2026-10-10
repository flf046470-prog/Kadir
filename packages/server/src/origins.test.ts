import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@kc/net';

import type { ServerConfig } from './config.js';
import { attachGateway } from './gateway.js';
import { createHttpHandler } from './http.js';
import { isLoopbackOrigin, originPermitted, parseOnlineOrigin, withOnlineOrigin } from './origins.js';

/**
 * A PC build is a page served from `127.0.0.1` that plays on the hosted server. Before this, every
 * Steam or Epic install played on the server it carried, so no two of them could ever meet — and
 * the first time one points at the hosted server, the hosted server is the one with
 * `KC_ALLOWED_ORIGINS` set. Everything here is about that page being let in, and being told where
 * to go, without letting anything else in that was not already.
 */

const HOSTED = 'https://play.kangaroo.example';
const PC_PAGE = 'http://127.0.0.1:21787';

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
    onlineOrigin: '',
    publicDir: 'dist/client',
    assetLinksFile: '',
    stores: { metaAppId: '', metaAppSecret: '', steamAppId: '', steamWebApiKey: '', playPackageName: '' },
    allowDevPurchases: true,
    databaseUrl: '',
    ...overrides,
  }) as ServerConfig;

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

async function httpServer(overrides: Partial<ServerConfig>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kc-origins-'));
  await mkdir(join(dir, 'public'), { recursive: true });
  await writeFile(join(dir, 'public', 'index.html'), '<!doctype html>\n<html>\n  <head>\n    <title>app shell</title>\n  </head>\n</html>\n');
  const handler = createHttpHandler({
    config: config({ publicDir: join(dir, 'public'), ...overrides }),
    rooms: { roomCount: 0 },
  } as unknown as Parameters<typeof createHttpHandler>[0]);
  return `http://${await listen(createServer((req, res) => void handler(req, res)))}`;
}

describe('which origins may use the server', () => {
  it('counts only pages served from this machine as loopback', () => {
    for (const origin of ['http://127.0.0.1:21787', 'http://localhost:5173', 'http://[::1]:8787', 'https://localhost']) {
      expect(isLoopbackOrigin(origin), origin).toBe(true);
    }
    // A hostname that merely *contains* a loopback name is somebody's website.
    for (const origin of ['https://127.0.0.1.attacker.example', 'https://localhost.attacker.example', 'file://', 'null', 'chrome-extension://abc', '']) {
      expect(isLoopbackOrigin(origin), origin).toBe(false);
    }
  });

  it('lets a PC build in past a restricted origin list, and nothing else that was not already in', () => {
    const allowed = [HOSTED];
    expect(originPermitted(allowed, HOSTED)).toBe(true);
    expect(originPermitted(allowed, PC_PAGE)).toBe(true);
    expect(originPermitted(allowed, undefined)).toBe(true); // native clients, as before
    expect(originPermitted(allowed, 'https://another-site.example')).toBe(false);
    // No list: no restriction, as before.
    expect(originPermitted([], 'https://another-site.example')).toBe(true);
  });

  it('answers a PC page with CORS headers it can use, on a server that restricts origins', async () => {
    const base = await httpServer({ allowedOrigins: [HOSTED] });
    // The preflight a cross-origin POST with a bearer token makes before `/api/guest`.
    const preflight = await fetch(`${base}/api/guest`, {
      method: 'OPTIONS',
      headers: { origin: PC_PAGE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBe(PC_PAGE);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(preflight.headers.get('vary')).toBe('Origin');

    const foreign = await fetch(`${base}/api/health`, { headers: { origin: 'https://another-site.example' } });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('accepts a PC page on the game socket, on a server that restricts origins', async () => {
    const server = createServer();
    const host = await listen(server);
    const wss = attachGateway(server, config({ allowedOrigins: [HOSTED] }), {} as never, {} as never);
    const closeCode = (origin: string) =>
      new Promise<number | 'open'>((resolve) => {
        const socket = new WebSocket(`ws://${host}/ws`, { origin });
        // A refused origin is closed straight after the handshake, so "open" alone proves
        // nothing (see check:hostile). Wait to see whether the close follows.
        socket.on('open', () => setTimeout(() => {
          resolve('open');
          socket.close();
        }, 150));
        socket.on('close', (code) => resolve(code));
      });
    expect(await closeCode(PC_PAGE)).toBe('open');
    expect(await closeCode('https://another-site.example')).toBe(4003);
    wss.close();
  });
});

describe('telling a page where to play online', () => {
  it('normalises the configured origin and refuses one that is not a web origin', () => {
    expect(parseOnlineOrigin(undefined)).toBe('');
    expect(parseOnlineOrigin('  ')).toBe('');
    expect(parseOnlineOrigin('https://play.kangaroo.example/some/path?x=1')).toBe(HOSTED);
    // Ignoring a bad value would look exactly like the old build: one that silently plays alone.
    expect(() => parseOnlineOrigin('play.kangaroo.example')).toThrow(/not a URL/);
    expect(() => parseOnlineOrigin('ftp://play.kangaroo.example')).toThrow(/http/);
  });

  it('writes it into the app shell, escaped, and leaves the shell alone when unset', () => {
    const shell = '<html><head><title>x</title></head></html>';
    expect(withOnlineOrigin(shell, '')).toBe(shell);
    const html = withOnlineOrigin(shell, HOSTED);
    expect(html).toContain(`<meta name="kc-online-origin" content="${HOSTED}" />`);
    expect(html.indexOf('kc-online-origin')).toBeLessThan(html.indexOf('</head>'));
    expect(withOnlineOrigin(shell, 'https://a"b')).not.toContain('a"b');
  });

  it('serves the shell with the line on every path a navigation takes, and only there', async () => {
    const base = await httpServer({ onlineOrigin: HOSTED });
    for (const path of ['/', '/index.html', '/play/jungle-world']) {
      const response = await fetch(`${base}${path}`);
      expect(response.headers.get('content-type'), path).toContain('text/html');
      expect(response.headers.get('cache-control'), path).toBe('no-cache');
      expect(await response.text(), path).toContain(`content="${HOSTED}"`);
    }
    const plain = await httpServer({});
    expect(await (await fetch(`${plain}/`)).text()).not.toContain('kc-online-origin');
  });

  it("reports the server's protocol, so a page can tell before it opens a socket", async () => {
    const base = await httpServer({});
    const health = (await (await fetch(`${base}/api/health`)).json()) as { ok: boolean; protocol: number };
    expect(health).toMatchObject({ ok: true, protocol: PROTOCOL_VERSION });
  });
});
