import { describe, expect, it } from 'vitest';

import { afterEach, beforeEach } from 'vitest';

import {
  crashNotice,
  installCrashSurface,
  reportingEnabled,
  resetErrorReportingForTests,
  scrubBreadcrumb,
  scrubEvent,
  scrubUrl,
} from './errors.js';

/**
 * What leaves the device.
 *
 * These are the assertions worth having about a crash reporter. Whether Sentry uploads an event
 * is Sentry's problem and cannot be tested here without a network; whether *this game* hands it
 * a player's name, a session token or a room's identity is entirely this file's problem, and the
 * answer should not depend on a vendor default staying the way it is today.
 *
 * Written against a structural type rather than the SDK's own, so they run without it installed.
 */

describe('what a URL is reduced to', () => {
  it('drops the query string, which is where the token travels', () => {
    expect(scrubUrl('https://example.net/api/profile?token=abc123&x=1')).toBe('/api/profile');
  });

  it('drops the origin and the fragment', () => {
    expect(scrubUrl('https://example.net/play/jungle-world#anchor')).toBe('/play/jungle-world');
  });

  it('replaces a room code rather than keeping or dropping it', () => {
    /**
     * A room code identifies a session, not a person, but it has no business in an issue tracker
     * — and deleting the segment entirely would split one route into one issue per room, which
     * is how a crash that happens every match comes to look like a hundred rare ones.
     */
    expect(scrubUrl('https://example.net/play/KANG-B3B9')).toBe('/play/<room>');
    expect(scrubUrl('/room/KANG-DSHR/spectate')).toBe('/room/<room>/spectate');
  });

  it('keeps the path, so a crash in a match is distinguishable from one in the menu', () => {
    expect(scrubUrl('https://example.net/')).toBe('/');
    expect(scrubUrl('https://example.net/settings')).toBe('/settings');
  });

  it('says so rather than throwing on something that is not a URL', () => {
    /**
     * Parsed against a base, so almost anything resolves to a path — `%%%` is a legal, if odd,
     * relative path and comes back as one. The fallback is for the inputs that genuinely fail,
     * which is a much smaller set than it looks: a bare scheme is one.
     */
    expect(scrubUrl('%%%')).toBe('/%%%');
    expect(scrubUrl('http://')).toBe('<unparsable>');
  });
});

describe('what an event is reduced to', () => {
  it('removes the user, the host and the request details', () => {
    const event = scrubEvent({
      user: { id: 'g_ES-wCEIGnN7Z', username: 'Kadir', ip_address: '1.2.3.4' },
      server_name: 'somebodys-quest',
      request: {
        url: 'https://example.net/play/KANG-B3B9?token=secret',
        query_string: 'token=secret',
        headers: { Cookie: 'session=secret' },
      },
      exception: { values: [{ type: 'TypeError' }] },
    });

    expect(event.user).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.headers).toBeUndefined();
    expect(event.request?.url).toBe('/play/<room>');
    // The part that is the whole point still survives.
    expect(event.exception).toBeDefined();
  });

  it('deletes a user rather than declining to set one', () => {
    // An integration added later can attach one; a deletion outlives that, a policy of never
    // setting it does not.
    expect(scrubEvent({ user: { id: 'x' } }).user).toBeUndefined();
  });

  it('does not mind an event with nothing to scrub', () => {
    expect(scrubEvent({ exception: { values: [] } })).toEqual({ exception: { values: [] } });
  });
});

describe('what a breadcrumb is allowed to be', () => {
  it('drops console breadcrumbs outright', () => {
    /**
     * Anything the game ever logs would ride along with a crash, and chat moderation, voice
     * state and player names all pass through code that could one day log them. Dropped as a
     * category rather than filtered, because a filter is a list of the leaks somebody thought of.
     */
    expect(scrubBreadcrumb({ category: 'console', message: 'chat from Kadir: hello' })).toBeNull();
  });

  it('drops UI breadcrumbs, which carry the text of whatever was clicked', () => {
    // The room list is a column of buttons labelled with player names.
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'button[Join Kadir\'s room]' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'ui.input' })).toBeNull();
  });

  it('keeps a network breadcrumb but scrubs its URL', () => {
    // These are what tell you a crash followed a failed join rather than arriving out of nowhere.
    const crumb = scrubBreadcrumb({ category: 'fetch', data: { url: 'https://example.net/api/guest?token=s' } });
    expect(crumb).not.toBeNull();
    expect(crumb?.data?.url).toBe('/api/guest');
  });

  it('scrubs both ends of a navigation', () => {
    const crumb = scrubBreadcrumb({ category: 'navigation', data: { from: '/play/KANG-AAAA', to: '/settings?x=1' } });
    const data = crumb?.data as { from: string; to: string };
    expect(data.from).toBe('/play/<room>');
    expect(data.to).toBe('/settings');
  });
});

describe('whether reporting runs at all', () => {
  it('needs somewhere to send and a player who has not said no', () => {
    expect(reportingEnabled('https://k@o.ingest.sentry.io/1', true)).toBe(true);
    expect(reportingEnabled('https://k@o.ingest.sentry.io/1', false)).toBe(false);
    expect(reportingEnabled('', true)).toBe(false);
    expect(reportingEnabled('', false)).toBe(false);
  });

  it('is inert in a build with no DSN, which is every build until one is configured', () => {
    // The default state of this repository. Nothing is sent, nothing is fetched, and the game
    // does not behave differently for it.
    expect(reportingEnabled('', true)).toBe(false);
  });
});

/**
 * Telling the player, which is a different job from telling an issue tracker.
 *
 * `main()` already catches a failure to start, and says "check the console for details" — advice
 * for somebody at a desk, and a dead end for the one player it is actually written for, who is
 * wearing a headset and has no console to open. Nothing at all handled an error *after* boot: a
 * render loop that throws stops rAF, the picture freezes, and the game says nothing.
 */
describe('the sentence a player gets', () => {
  beforeEach(() => resetErrorReportingForTests());
  afterEach(() => resetErrorReportingForTests());

  it('says what to do, not where to look', () => {
    const notice = crashNotice(new Error('Cannot read properties of null'));
    expect(notice).toContain('reload');
    expect(notice).toContain('Cannot read properties of null');
    expect(notice).not.toContain('console');
  });

  it('still says something when the error carries no message', () => {
    expect(crashNotice(undefined)).toBe('Something went wrong — reload to start again.');
    expect(crashNotice('')).toBe('Something went wrong — reload to start again.');
  });

  it('stays short enough to put on a screen', () => {
    // It goes in a notice bar, not a log. A stack trace pasted into one is unreadable anywhere.
    const notice = crashNotice(new Error('x'.repeat(500)));
    expect(notice.length).toBeLessThan(200);
  });

  it('collapses the whitespace a multi-line error arrives with', () => {
    expect(crashNotice(new Error('first line\n   second line'))).toContain('first line second line');
  });

  /**
   * Each case listens on its own `EventTarget` rather than on the global.
   *
   * Partly because there is no global `addEventListener` under Node, which is what made this
   * untestable before the target became an argument — but mostly because a listener installed on
   * a shared object outlives the case that installed it, and the next case then measures both.
   */
  it('announces once, however many times the loop throws', () => {
    /**
     * The reason this matters: a render loop that throws does it every frame. At 72 Hz that is
     * seventy-two identical notices a second, and after the first there is nothing more to say.
     */
    const target = new EventTarget();
    const seen: string[] = [];
    const remove = installCrashSurface((m) => seen.push(m), target);

    for (let i = 0; i < 5; i++) {
      target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom') }));
    }
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('also boom') }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('boom');
    remove();
  });

  it('listens for a rejection as well as a throw', () => {
    const target = new EventTarget();
    const seen: string[] = [];
    const remove = installCrashSurface((m) => seen.push(m), target);
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('a promise nobody caught') }));
    expect(seen[0]).toContain('a promise nobody caught');
    remove();
  });

  it('falls back to the message when an ErrorEvent carries no error object', () => {
    // A cross-origin script error arrives this way: `error` is null and only `message` is set.
    const target = new EventTarget();
    const seen: string[] = [];
    const remove = installCrashSurface((m) => seen.push(m), target);
    target.dispatchEvent(Object.assign(new Event('error'), { error: null, message: 'Script error.' }));
    expect(seen[0]).toContain('Script error.');
    remove();
  });

  it('stops listening when removed', () => {
    const target = new EventTarget();
    const seen: string[] = [];
    installCrashSurface((m) => seen.push(m), target)();
    // Reset after removal, so the silence below is the listener being gone rather than the
    // once-only latch still being set from a previous case.
    resetErrorReportingForTests();
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('after removal') }));
    expect(seen).toHaveLength(0);
  });
});
