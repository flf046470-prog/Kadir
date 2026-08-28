/**
 * FioreMatch service worker.
 *
 * The job here is narrow on purpose: make the shell load instantly and make a
 * dropped connection say so, without ever putting one member's data somewhere
 * another person — or a later session on a shared phone — can read it.
 *
 * WHAT IS NEVER CACHED, AND WHY
 *
 *  - Anything under `/api/`. These are private per-member reads: the
 *    conversation, the feed, the reward ledger. A cached copy would survive
 *    logout on a shared device.
 *  - `/api/photos/` in particular. Photos are deliberately served through an
 *    app route rather than a bucket URL so moderation is re-checked on every
 *    single read. A cache entry would serve a photo that has since been taken
 *    down — it would quietly undo the moderation system.
 *
 * Those two are why this file does not use a "cache everything same-origin"
 * strategy. Getting it wrong is not a performance regression, it is a leak.
 */

// Bump to invalidate. The suffix is the only thing that needs to change when
// the precached set does.
const CACHE = "fiorematch-v1";

const OFFLINE_URL = "/offline.html";

/** The smallest set that makes an offline navigation say something useful. */
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  // Deliberately no skipWaiting(). Swapping the worker under a page that is
  // already running means the next lazily-loaded chunk it asks for may no
  // longer exist in the new build — a blank screen mid-conversation. The new
  // worker takes over on the next cold start instead.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/** True for requests that must always go to the network and never be stored. */
function isPrivate(url) {
  return url.pathname.startsWith("/api/");
}

/** Content-hashed build output: the URL changes when the bytes do. */
function isImmutable(url) {
  return url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET. A POST is an action; replaying one from a cache would send a
  // message or spend a boost the member did not ask for twice.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Someone else's origin — fonts, anything embedded. Left entirely to the
  // browser: caching opaque responses costs storage and buys nothing here.
  if (url.origin !== self.location.origin) return;

  if (isPrivate(url)) return;

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationWithOfflineFallback(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Pages come from the network, so a member never reads a stale conversation
 * list. The cached copy is a fallback for a dropped connection, not a fast
 * path — showing yesterday's page instantly is worse than showing today's a
 * moment later.
 */
async function navigationWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return (await caches.match(OFFLINE_URL)) ?? Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    // Offline with nothing cached: let the caller's own error handling run
    // rather than throwing out of the worker.
    .catch(() => cached ?? Response.error());

  return cached ?? network;
}
