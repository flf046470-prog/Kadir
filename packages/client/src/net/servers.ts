import { PROTOCOL_VERSION } from '@kc/net';

/**
 * Which server this page plays on.
 *
 * A page plays on the server that served it — except a PC build's. Steam and Epic run a server
 * bundled into the app on `127.0.0.1` and load the game from it, and a page that played there was
 * a game nobody else could ever join: every install its own private world. That server now names
 * the hosted one in the app shell (`KC_ONLINE_ORIGIN` on the server, `<meta name=
 * "kc-online-origin">` here), and the page plays there when it can.
 *
 * When it cannot — no network, or a version the hosted server no longer speaks — the bundled
 * server is still there, so the player keeps the game they had, with their profile on this
 * computer, instead of a dead menu.
 */

export const ONLINE_ORIGIN_META = 'kc-online-origin';

/** How long the hosted server gets to answer before the page settles for the one it carries. */
export const PROBE_TIMEOUT_MS = 4000;

/** The hosted server named by the server that served this page, if it named one. */
export function onlineOriginOf(doc: Pick<Document, 'querySelector'>): string | null {
  const content = doc.querySelector(`meta[name="${ONLINE_ORIGIN_META}"]`)?.getAttribute('content');
  if (!content) return null;
  try {
    const url = new URL(content);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** What asking a server "can I play on you" found. */
export type ProbeResult = 'ok' | 'unreachable' | 'mismatch';

export interface ServerChoice {
  /** The origin the API and the game socket use. */
  origin: string;
  /** Why the hosted server was passed over, when it was; null when it was used or never named. */
  fallback: Exclude<ProbeResult, 'ok'> | null;
}

/**
 * The hosted server if it answers and speaks this build's protocol, else the page's own.
 *
 * A page whose server named nobody else is not probed at all: the browser build and every store
 * that loads the hosted origin directly pay nothing for this at boot.
 */
export async function chooseServer(
  pageOrigin: string,
  online: string | null,
  probe: (origin: string) => Promise<ProbeResult>,
): Promise<ServerChoice> {
  if (!online || online === pageOrigin) return { origin: pageOrigin, fallback: null };
  const result = await probe(online);
  return result === 'ok' ? { origin: online, fallback: null } : { origin: pageOrigin, fallback: result };
}

/**
 * Ask `/api/health`. A server on another protocol counts as a reason to fall back, not a place to
 * go: it would refuse this build at `hello`, after the menus had already promised online play.
 */
export async function probeServer(origin: string, fetchImpl: typeof fetch = fetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/api/health`, { signal: controller.signal });
    if (!response.ok) return 'unreachable';
    const body = (await response.json()) as { protocol?: unknown };
    return body.protocol === PROTOCOL_VERSION ? 'ok' : 'mismatch';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

/** The game socket on `origin`. */
export function socketUrlFor(origin: string): string {
  const url = new URL('/ws', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** What the menu says when the hosted server was passed over. */
export function fallbackNotice(reason: Exclude<ProbeResult, 'ok'>): string {
  const where = 'Playing on this computer: practice works, but nobody else can join.';
  return reason === 'mismatch'
    ? `This version and the online server do not match — an update is needed to play online. ${where}`
    : `The online server could not be reached. ${where}`;
}
