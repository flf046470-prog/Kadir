import type { PlatformKind } from '../platform/Platform.js';

/**
 * Crash reporting.
 *
 * Until now an unhandled error in the client went nowhere: there was no `onerror`, no
 * `unhandledrejection` handler and no reporting of any kind, so the only way to learn that the
 * game had broken on somebody's device was for them to tell you. That is survivable while the
 * only device is the one you are sitting at. It stops being survivable the moment the game is on
 * a store and the first headset sessions are happening in other people's living rooms.
 *
 * Three constraints shape everything here, and all three come from this project rather than from
 * Sentry:
 *
 *  - **It must not cost the startup budget.** An immersive PWA launches straight into the WebXR
 *    session and everything fetched before that counts against Meta's `Quest.Performance.3`. So
 *    the SDK is behind a dynamic `import()` — its own chunk, fetched after the game is running,
 *    never on the boot path — and a failure to fetch it is ignored rather than surfaced.
 *  - **It must not send anything about a person.** See `scrubEvent`. The scrubbing is pure and
 *    tested, rather than trusted to a vendor default, because "we think it does not send that"
 *    is not a thing worth being wrong about.
 *  - **The DSN is not a secret and must not be treated as one.** It is a write-only ingest
 *    address; it cannot read an issue, and every web build in the world ships one in the clear.
 *    That is why it does not contradict this repo's rule about keys in web builds — but it is
 *    also why the *auth token* that uploads source maps must never come near the client.
 */

/** Everything the reporter is told about the build and the device. No part of it is personal. */
export interface ReportingContext {
  platform: PlatformKind;
  /** Build identity, so an issue can be tied to a commit. `dev` outside a release build. */
  release: string;
}

/**
 * A Sentry event, as much of one as this file touches.
 *
 * Declared here rather than imported so the scrubbing can be tested without the SDK present —
 * the tests are about what leaves the device, and they should not need 28 MB of node_modules to
 * make that assertion.
 */
export interface SentryLikeEvent {
  request?: { url?: string; query_string?: unknown; headers?: Record<string, string> };
  user?: unknown;
  server_name?: string;
  contexts?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SentryLikeBreadcrumb {
  category?: string;
  message?: string;
  data?: { url?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Strip a URL down to its path, and strip the path down to its shape.
 *
 * A query string is the one part of a URL in this game that can carry a credential — the guest
 * token travels in one — and a room code identifies a session rather than a person but still has
 * no business in an issue tracker. Both go. What survives is enough to tell a crash on the menu
 * from a crash in a match.
 */
export function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw, 'http://localhost');
    // Room codes look like KANG-AB12 and appear as a path segment. Replaced rather than dropped,
    // so `/play/<code>` still groups as one route instead of fragmenting into one issue per room.
    const path = url.pathname.replace(/\/[A-Z]{2,6}-[A-Z0-9]{4,8}\b/g, '/<room>');
    return path || '/';
  } catch {
    return '<unparsable>';
  }
}

/**
 * What is allowed to leave the device.
 *
 * Sentry's defaults are conservative but not zero: it attaches the request URL with its query
 * string, and its server can infer an IP from the connection. This removes the first and asks it
 * not to keep the second. `user` is deleted rather than never set, because an integration can add
 * one later and a deletion survives that.
 */
export function scrubEvent<T extends SentryLikeEvent>(event: T): T {
  delete event.user;
  delete event.server_name;
  if (event.request) {
    if (typeof event.request.url === 'string') event.request.url = scrubUrl(event.request.url);
    delete event.request.query_string;
    delete event.request.headers;
  }
  return event;
}

/**
 * What is allowed into the trail that comes with a crash.
 *
 * Console breadcrumbs are the danger: anything the game ever logs would ride along, and chat
 * moderation, voice state and player names all pass through code that could one day log them.
 * UI breadcrumbs carry the text of whatever was clicked, which on this game's screens includes
 * player names in the room list. Both are dropped outright rather than filtered, because a filter
 * is a list of the leaks somebody thought of.
 *
 * Network and navigation breadcrumbs stay, with their URLs scrubbed — they are what tells you a
 * crash followed a failed join rather than arriving out of nowhere.
 */
export function scrubBreadcrumb(crumb: SentryLikeBreadcrumb): SentryLikeBreadcrumb | null {
  const category = crumb.category ?? '';
  if (category === 'console' || category.startsWith('ui.')) return null;
  if (crumb.data && typeof crumb.data.url === 'string') crumb.data.url = scrubUrl(crumb.data.url);
  if (category === 'navigation') {
    const data = crumb.data as { from?: string; to?: string } | undefined;
    if (data?.from) data.from = scrubUrl(data.from);
    if (data?.to) data.to = scrubUrl(data.to);
  }
  return crumb;
}

/** The DSN this build was compiled with, or '' when none was supplied. */
export function configuredDsn(): string {
  // `import.meta.env` is Vite's, replaced at build time. Guarded because the unit tests and the
  // headless probes run this file under plain Node, where it does not exist.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_SENTRY_DSN ?? '';
}

/** Build identity for the release tag, or `dev`. */
export function configuredRelease(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_KC_RELEASE || 'dev';
}

/**
 * Whether reporting should run at all.
 *
 * Both halves matter and neither is a formality: without a DSN there is nowhere to send, and a
 * player who turned it off has said no. Separated from the startup call so the decision can be
 * tested without a network or an SDK.
 */
export function reportingEnabled(dsn: string, playerOptedIn: boolean): boolean {
  return dsn.length > 0 && playerOptedIn;
}

let started = false;

/**
 * Load the SDK and start reporting. Safe to call when it should not run — it returns false.
 *
 * Returns whether reporting actually started, so a caller can say so rather than assume. Every
 * failure path is silent to the player: a crash reporter that interrupts the game to complain
 * that it could not report a crash has inverted its own purpose.
 */
export async function startErrorReporting(context: ReportingContext, playerOptedIn: boolean): Promise<boolean> {
  const dsn = configuredDsn();
  if (started || !reportingEnabled(dsn, playerOptedIn)) return false;
  started = true;
  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn,
      release: context.release,
      environment: context.release === 'dev' ? 'development' : 'production',
      // No performance tracing and no session replay. Both are for products where the question is
      // "why is this slow"; here the frame budget is measured directly and a replay of a VR
      // session is a recording of somebody's room.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      // Through `unknown` because the SDK's event type and the structural one above do not
      // overlap by TypeScript's rules — the scrubbing only ever deletes fields and rewrites a
      // string, so the object handed back is the same object the SDK gave.
      beforeSend: (event) => scrubEvent(event as unknown as SentryLikeEvent) as unknown as typeof event,
      beforeBreadcrumb: (crumb) => {
        const kept = scrubBreadcrumb(crumb as unknown as SentryLikeBreadcrumb);
        return kept === null ? null : (kept as unknown as typeof crumb);
      },
    });
    Sentry.setTag('platform', context.platform);
    return true;
  } catch {
    // The chunk did not load, or the SDK threw on init. The game does not care.
    started = false;
    return false;
  }
}

/**
 * Tag the current round, so an issue says where it happened.
 *
 * A no-op when reporting never started, which is the common case in development — the caller
 * should not have to know whether it did.
 */
export async function setRoundContext(levelId: string, modeId: string, tier: string): Promise<void> {
  if (!started) return;
  try {
    const Sentry = await import('@sentry/browser');
    Sentry.setTag('level', levelId);
    Sentry.setTag('mode', modeId);
    Sentry.setTag('tier', tier);
  } catch {
    /* Already loaded once to get here, so this is not worth handling beyond not throwing. */
  }
}

/** Test seam: forget that reporting was started. Not part of the runtime path. */
export function resetErrorReportingForTests(): void {
  started = false;
}
