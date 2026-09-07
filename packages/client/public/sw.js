/**
 * Service worker.
 *
 * Two jobs, and one deliberate non-job.
 *
 *  1. Offline start. A Horizon Store PWA is launched from the headset's library and has to come
 *     up without assuming a network, so the app shell is served from cache when the network is
 *     unavailable.
 *  2. Cheap repeat launches. Vite emits content-hashed filenames under /assets/, so those are
 *     immutable and can be cached indefinitely — a new build produces new URLs.
 *
 * The non-job: **models are never precached.** A WebXR PWA launches straight into immersive
 * mode, and anything fetched before the session is up counts against Meta's startup-time
 * requirement (Quest.Performance.3). Art packs are optional anyway — the game renders
 * procedurally without them — so they are fetched lazily and only cached once actually used.
 *
 * Nothing under /api or /ws is ever cached: match results, profiles, purchases and leaderboards
 * are server-authoritative, and a stale cached answer to any of them is a correctness bug.
 */

const VERSION = 'kc-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const MODEL_CACHE = `${VERSION}-models`;
const CACHES = new Set([SHELL_CACHE, ASSET_CACHE, MODEL_CACHE]);

/** Fallback list, used only when precache.json is unavailable (e.g. the dev server). */
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

/**
 * Precache from the generated list rather than caching on first fetch.
 *
 * A worker activates *after* the page that registered it has already loaded its scripts, so
 * those first requests never pass through `fetch` here. Relying on runtime caching alone would
 * leave the content-hashed bundle uncached until a second visit — and an offline reload before
 * then serves the shell with a dead <script>, which looks broken rather than offline.
 * `scripts/build-precache.mjs` writes the hashed filenames after each build.
 */
async function precacheUrls() {
  try {
    const response = await fetch('/precache.json', { cache: 'no-cache' });
    if (!response.ok) return SHELL;
    const body = await response.json();
    return Array.isArray(body.urls) && body.urls.length > 0 ? body.urls : SHELL;
  } catch {
    return SHELL;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const urls = await precacheUrls();
      const shell = await caches.open(SHELL_CACHE);
      const assets = await caches.open(ASSET_CACHE);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.all(
        urls.map((url) => (url.startsWith('/assets/') ? assets : shell).add(url).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !CACHES.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** Navigations go to the network first so a deploy is picked up, with the shell as the fallback. */
async function navigate(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match('/')) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Server-authoritative data and the game socket must never be served from cache.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (url.pathname.startsWith('/models/')) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
    return;
  }
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.svg') {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});
