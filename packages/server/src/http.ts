import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  claimDaily,
  claimSeasonRewards,
  dailyPreview,
  achievementProgress,
  equipAnimal,
  equipCosmetic,
  equipGadgets,
  listGadgets,
  getSeasonProgress,
  listAnimals,
  listCosmetics,
  listLevels,
  listModes,
  listStoreItems,
  sanitizeName,
} from '@kc/core';
import type { CosmeticSlot, PlayerProfile } from '@kc/core';
import type { AccountService } from './accounts.js';
import type { ServerConfig } from './config.js';
import type { Leaderboard } from './leaderboard.js';
import type { RoomManager } from './rooms.js';
import type { PurchaseService } from './purchases.js';

export interface HttpDeps {
  config: ServerConfig;
  accounts: AccountService;
  rooms: RoomManager;
  leaderboard: Leaderboard;
  purchases: PurchaseService;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  // The models. Served as `application/octet-stream` until now, which `GLTFLoader` tolerates —
  // it sniffs the glTF magic rather than trusting the header — but a CDN, a proxy or a store
  // packager reading the type gets the wrong answer, and the fallback is what a file the table
  // has never heard of looks like.
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/**
 * HTTP API.
 *
 * Everything that changes a profile lives here rather than on the game socket, because these
 * are transactional operations that must be authenticated per request and are safe to retry.
 */
export function createHttpHandler(deps: HttpDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.method === 'OPTIONS') {
      applyCors(res, deps.config, req);
      res.writeHead(204).end();
      return;
    }

    if (path.startsWith('/api/')) {
      applyCors(res, deps.config, req);
      try {
        await handleApi(deps, req, res, path, url);
      } catch (error) {
        json(res, 500, { error: 'internal', message: (error as Error).message });
      }
      return;
    }

    if (path.startsWith('/.well-known/')) {
      await serveWellKnown(deps.config, path, res);
      return;
    }

    await serveStatic(deps.config, path, res);
  };
}

/**
 * `/.well-known/` paths, which are machine-readable and must never fall back to the app shell.
 *
 * Android verifies a Trusted Web Activity by fetching `/.well-known/assetlinks.json` and parsing
 * it as JSON. Left to `serveStatic` it hit the SPA fallback and got `index.html` — 200, HTML,
 * 1241 bytes — so verification failed and the app launched with a browser URL bar on top of it,
 * which the Horizon Store rejects for an immersive title. The 200 is the trap: a smoke check that
 * asserts the URL answers passes, and only a real headset install shows the URL bar.
 *
 * So everything under `/.well-known/` 404s when it is not configured, per RFC 8615. A missing
 * machine-readable endpoint has to say it is missing.
 */
async function serveWellKnown(config: ServerConfig, path: string, res: ServerResponse): Promise<void> {
  if (path !== '/.well-known/assetlinks.json' || !config.assetLinksFile) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  const statements = await assetLinkStatements(config.assetLinksFile);
  if (statements.length === 0) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' });
  res.end(JSON.stringify(statements, null, 2));
}

/**
 * Every asset-link statement the configured value yields, merged and de-duplicated.
 *
 * The value is **either** a JSON array of statements, used as it stands, **or** a comma-separated
 * list of files to read. A path cannot begin with `[`, so the two never collide, and the array
 * form is not comma-split — the commas inside it are its own.
 *
 * Both forms exist because the file and the deployment are in different places. `build:quest` and
 * `build:phone` write a file each, next to the keystore that signed it, and those files are
 * gitignored and never enter the image; a container host has no filesystem to put them on, so a
 * path-only setting would be a setting that cannot be used where it is needed. Locally the paths
 * are what you have.
 *
 * Merged, because one origin can serve more than one app — the Quest TWA and the Play TWA are
 * built from the same `dist/client` and both point at it — and each build writes a
 * **single-element** array signed with its own key. Serving one of them verifies one app and
 * silently fails the other, which shows up as a URL bar on whichever one you did not think of.
 *
 * Read per request rather than cached: the file changes when a build is signed, which is exactly
 * when nobody wants to have to remember to restart the server. It is one small file.
 */
async function assetLinkStatements(value: string): Promise<unknown[]> {
  const trimmed = value.trim();
  const sources: (() => Promise<string>)[] = trimmed.startsWith('[')
    ? [async () => trimmed]
    : trimmed
        .split(',')
        .map((file) => file.trim())
        .filter(Boolean)
        .map((file) => () => readFile(resolve(file), 'utf8'));

  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const read of sources) {
    try {
      const parsed: unknown = JSON.parse(await read());
      // Malformed or not an array: Android's verification fails on it in a way that reads as a
      // networking problem. Skipped rather than served, so the 404 says something is wrong.
      if (!Array.isArray(parsed)) continue;
      for (const statement of parsed) {
        const key = JSON.stringify(statement);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(statement);
      }
    } catch {
      continue;
    }
  }
  return out;
}

async function handleApi(
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (path === '/api/health') {
    json(res, 200, { ok: true, rooms: deps.rooms.roomCount, uptime: process.uptime() });
    return;
  }

  if (path === '/api/content' && method === 'GET') {
    json(res, 200, {
      animals: listAnimals(),
      cosmetics: listCosmetics(),
      gadgets: listGadgets(),
      store: listStoreItems(),
      modes: listModes(),
      levels: listLevels().map((l) => ({ id: l.id, name: l.name, description: l.description })),
      level: { id: deps.rooms.sharedLevel.id, seed: deps.rooms.sharedLevel.seed },
    });
    return;
  }

  if (path === '/api/rooms' && method === 'GET') {
    json(res, 200, { rooms: deps.rooms.list().filter((r) => !r.isPrivate) });
    return;
  }

  if (path.startsWith('/api/leaderboard/') && method === 'GET') {
    const levelId = decodeURIComponent(path.slice('/api/leaderboard/'.length));
    json(res, 200, { entries: await deps.leaderboard.top(levelId, 20) });
    return;
  }

  if (path === '/api/guest' && method === 'POST') {
    const body = await readJson(req);
    const name = sanitizeName(String(body.name ?? 'Roo'));
    const guest = await deps.accounts.createGuest(name);
    json(res, 200, { playerId: guest.playerId, token: guest.token, profile: guest.profile });
    return;
  }

  // Everything below requires a valid session token.
  const playerId = authenticate(deps, req);
  if (!playerId) {
    json(res, 401, { error: 'unauthorized' });
    return;
  }
  const profile = await deps.accounts.loadOrCreate(playerId);

  if (path === '/api/profile' && method === 'GET') {
    json(res, 200, { profile, daily: dailyPreview(profile), season: getSeasonProgress(profile), achievements: achievementProgress(profile) });
    return;
  }

  if (path === '/api/profile/name' && method === 'POST') {
    const body = await readJson(req);
    profile.name = sanitizeName(String(body.name ?? profile.name), profile.name);
    await deps.accounts.save(profile);
    json(res, 200, { profile });
    return;
  }

  if (path === '/api/equip' && method === 'POST') {
    const body = await readJson(req);
    const outcome = body.animalId
      ? equipAnimal(profile, String(body.animalId))
      : equipCosmetic(profile, String(body.slot) as CosmeticSlot, body.cosmeticId === null ? null : String(body.cosmeticId));
    if (!outcome.ok) {
      json(res, 400, { error: outcome.error });
      return;
    }
    await deps.accounts.save(profile);
    json(res, 200, { equipped: profile.equipped });
    return;
  }

  if (path === '/api/loadout' && method === 'POST') {
    const body = await readJson(req);
    // `equipGadgets` filters the request against the owned inventory, so a client asking for
    // something it does not own gets an empty slot and a stated reason — never a 500, and never
    // the gadget. The room revalidates again on join.
    const outcome = equipGadgets(profile, {
      primary: slotValue(body.primary),
      secondary: slotValue(body.secondary),
      armour: slotValue(body.armour),
    });
    await deps.accounts.save(profile);
    json(res, 200, { gadgets: profile.equipped.gadgets, rejected: outcome.problems });
    return;
  }

  if (path === '/api/gadgets' && method === 'GET') {
    json(res, 200, { gadgets: listGadgets(), owned: profile.ownedGadgets, equipped: profile.equipped.gadgets });
    return;
  }

  if (path === '/api/purchase' && method === 'POST') {
    const body = await readJson(req);
    const outcome = await deps.purchases.purchase(profile, String(body.itemId), String(body.receipt ?? ''));
    await finishPurchase(deps, res, profile, outcome);
    return;
  }

  if (path === '/api/purchase/coins' && method === 'POST') {
    const body = await readJson(req);
    const outcome = deps.purchases.purchaseWithCoins(profile, String(body.itemId));
    await finishPurchase(deps, res, profile, outcome);
    return;
  }

  if (path === '/api/daily/claim' && method === 'POST') {
    const claim = claimDaily(profile);
    await deps.accounts.save(profile);
    json(res, claim.ok ? 200 : 409, { claim, coins: profile.coins });
    return;
  }

  if (path === '/api/season/claim' && method === 'POST') {
    const claimed = claimSeasonRewards(profile);
    await deps.accounts.save(profile);
    json(res, 200, { claimed, season: getSeasonProgress(profile) });
    return;
  }

  if (path === '/api/leaderboard/self' && method === 'GET') {
    const levelId = url.searchParams.get('level') ?? deps.rooms.sharedLevel.id;
    json(res, 200, {
      personal: await deps.leaderboard.personalBest(levelId, playerId),
      world: await deps.leaderboard.best(levelId),
    });
    return;
  }

  json(res, 404, { error: 'not-found' });
}

async function finishPurchase(
  deps: HttpDeps,
  res: ServerResponse,
  profile: PlayerProfile,
  outcome: { ok: boolean; error?: string; granted: string[] },
): Promise<void> {
  if (!outcome.ok) {
    json(res, 400, { error: outcome.error });
    return;
  }
  await deps.accounts.save(profile);
  json(res, 200, {
    granted: outcome.granted,
    coins: profile.coins,
    ownedAnimals: profile.ownedAnimals,
    ownedCosmetics: profile.ownedCosmetics,
  });
}

function authenticate(deps: HttpDeps, req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return deps.accounts.verifyToken(header.slice(7));
}

function applyCors(res: ServerResponse, config: ServerConfig, req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (!origin) return;
  if (config.allowedOrigins.length > 0 && !config.allowedOrigins.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', config.allowedOrigins.length > 0 ? origin : '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error('payload too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function serveStatic(config: ServerConfig, path: string, res: ServerResponse): Promise<void> {
  const root = resolve(config.publicDir);
  const requested = path === '/' ? '/index.html' : path;
  const target = resolve(join(root, normalize(requested)));
  // Path traversal guard: the resolved file must stay inside the public root.
  if (!target.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(target).pipe(res);
  } catch {
    /**
     * SPA fallback, for **navigations only**.
     *
     * It used to answer every missing path with `index.html`, which meant a mistyped or
     * not-yet-built asset came back as 200 `text/html`. A missing `.glb` handed `GLTFLoader` an
     * HTML document to parse, so the error a developer saw was a parse failure inside three.js
     * rather than "that file is not there", and a missing texture or JSON did the same.
     *
     * A request with a file extension is asking for a file; only an extension-less path is a
     * route the client's own router should get a chance at.
     */
    if (extname(requested)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    try {
      const index = resolve(join(root, 'index.html'));
      await stat(index);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      createReadStream(index).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
}

/** One loadout slot from an untyped request body: a string, or nothing. */
function slotValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
