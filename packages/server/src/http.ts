import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  claimDaily,
  claimSeasonRewards,
  dailyPreview,
  achievementProgress,
  equipAnimal,
  equipCosmetic,
  getSeasonProgress,
  listAnimals,
  listCosmetics,
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

    await serveStatic(deps.config, path, res);
  };
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
      store: listStoreItems(),
      modes: listModes(),
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
    json(res, 200, { entries: deps.leaderboard.top(levelId, 20) });
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
      personal: deps.leaderboard.personalBest(levelId, playerId),
      world: deps.leaderboard.best(levelId),
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
    // SPA fallback so deep links work without a router on the server.
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
