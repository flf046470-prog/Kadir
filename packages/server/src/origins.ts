/**
 * Which web pages may talk to this server, and which server a page should talk to.
 *
 * Two callers ask "is this origin allowed": the HTTP API's CORS headers and the WebSocket
 * gateway. They used to answer separately, which is the shape this codebase has seen drift before
 * (two sun positions, two binding lists), so both read `originPermitted`.
 */

/**
 * A page served from the player's own machine — the Steam and Epic builds, which run a bundled
 * server on `127.0.0.1` and load the game from it.
 *
 * Always allowed, even on a server that restricts origins with `KC_ALLOWED_ORIGINS`: restricting
 * origins exists to stop *another website* driving this server from a visitor's browser, and a
 * loopback origin can only be software on the player's own computer — which may connect without
 * any Origin header at all, and `originPermitted` has always let that in. Refusing it would turn
 * away exactly the PC players the hosted server is for and protect nothing.
 *
 * DNS rebinding cannot reach this: a rebound page keeps the attacker's hostname in its origin.
 */
export function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
}

/** Whether a request carrying `origin` may use this server. No list means no restriction. */
export function originPermitted(allowed: readonly string[], origin: string | undefined): boolean {
  if (allowed.length === 0) return true;
  // Native clients (the Quest APK, the mobile shell) send no Origin.
  if (!origin) return true;
  return allowed.includes(origin) || isLoopbackOrigin(origin);
}

/**
 * `KC_ONLINE_ORIGIN`: the hosted server a page served by *this* server should play online on.
 *
 * Set only on the server bundled into a PC build. Without it a page plays on the server that
 * served it, which is right for the hosted deployment and is how every PC install used to end up
 * on its own private `127.0.0.1` — a game nobody else could ever join.
 *
 * It is the server's setting, never the page's: a URL parameter naming the backend would let a
 * link point a player, and their microphone, at a server nobody moderates.
 *
 * A malformed value stops the server rather than being ignored, because ignoring it is
 * indistinguishable from the old behaviour — a build that silently plays alone.
 */
export function parseOnlineOrigin(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`KC_ONLINE_ORIGIN is not a URL: ${text}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`KC_ONLINE_ORIGIN must be http(s): ${text}`);
  }
  return url.origin;
}

/** `index.html` as served, telling the page where to play online when that is not here. */
export function withOnlineOrigin(html: string, onlineOrigin: string): string {
  if (!onlineOrigin) return html;
  const meta = `<meta name="kc-online-origin" content="${escapeAttribute(onlineOrigin)}" />`;
  return html.includes('</head>') ? html.replace('</head>', `    ${meta}\n  </head>`) : `${meta}\n${html}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
