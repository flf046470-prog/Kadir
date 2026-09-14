import { describe, expect, it } from 'vitest';

import { MENU_STARTS_A_ROUND, menuEntries } from './Shell.js';
import type { MenuAction } from './Shell.js';

/**
 * The main menu's rules, checked away from the DOM.
 *
 * These are asserted against the decision rather than the rendered buttons because the decision is
 * the part that was wrong, and because the failure it guards is one no screenshot shows: on a
 * phone, a menu with no way back is indistinguishable from a menu with one until a thumb tries it.
 *
 * Measured before the fix, on a 390x844 viewport, mid-round: nine buttons on screen and zero of
 * them returned to the match. Escape was the only route back and a phone has no Escape key.
 */
describe('menuEntries', () => {
  const actions = (state: { inMatch: boolean; online: boolean }): MenuAction[] =>
    menuEntries(state).map((entry) => entry.action);

  describe('in a match', () => {
    const online = { inMatch: true, online: true };
    const offline = { inMatch: true, online: false };

    it('always offers a way back into the round', () => {
      for (const state of [online, offline]) {
        expect(actions(state)).toContain('resume');
      }
    });

    it('puts resume first and makes it the primary action', () => {
      // First, because a thumb reaching a pause menu is usually reaching for "go back". Primary,
      // because the round is still running while this menu is being read.
      const [first] = menuEntries(online);
      expect(first?.action).toBe('resume');
      expect(first?.variant).toBe('primary');
    });

    it('offers exactly one way back and exactly one way out', () => {
      // Two buttons that both resume, or two that both leave, is a menu that has to be read
      // rather than recognised.
      const list = actions(online);
      expect(list.filter((a) => a === 'resume')).toHaveLength(1);
      expect(list.filter((a) => a === 'leave')).toHaveLength(1);
    });

    it('offers nothing that would throw the round away without asking', () => {
      // The other half of the same bug: pressing Play mid-match reconnected over a live match with
      // no warning at all, and Practice rebuilt the simulation underneath it.
      const offending = actions(online).filter((a) => MENU_STARTS_A_ROUND.has(a));
      expect(offending).toEqual([]);
    });

    it('marks leaving as destructive', () => {
      expect(menuEntries(online).find((e) => e.action === 'leave')?.variant).toBe('danger');
    });

    it('still allows the things that are safe mid-round', () => {
      // Settings especially: sensitivity and comfort options are exactly what a player opens a
      // pause menu to change, and a VR player may need them urgently.
      const list = actions(online);
      expect(list).toContain('settings');
      expect(list).toContain('customize');
    });
  });

  describe('outside a match', () => {
    const online = { inMatch: false, online: true };
    const offline = { inMatch: false, online: false };

    it('offers no resume and no leave, which would refer to nothing', () => {
      for (const state of [online, offline]) {
        expect(actions(state)).not.toContain('resume');
        expect(actions(state)).not.toContain('leave');
      }
    });

    it('leads with Play when there is a server', () => {
      const [first] = menuEntries(online);
      expect(first?.action).toBe('play');
      expect(first?.variant).toBe('primary');
    });

    it('offers practice instead of play when there is no server, and makes it the primary', () => {
      // Without this the offline menu's only primary button starts an online match that can never
      // fill, and the player waits on "Waiting for players (0/2)" forever.
      const list = actions(offline);
      expect(list).not.toContain('play');
      expect(menuEntries(offline).find((e) => e.action === 'practice')?.variant).toBe('primary');
    });

    it('reaches every screen the menu is the only entry point for', () => {
      const list = actions(online);
      for (const action of ['modes', 'room', 'customize', 'store', 'settings', 'tutorial'] as const) {
        expect(list).toContain(action);
      }
    });
  });

  it('never renders the same action twice', () => {
    for (const inMatch of [true, false]) {
      for (const online of [true, false]) {
        const list = actions({ inMatch, online });
        expect(new Set(list).size, `${JSON.stringify({ inMatch, online })} → ${list.join(',')}`).toBe(list.length);
      }
    }
  });

  it('gives every entry a non-empty label', () => {
    for (const inMatch of [true, false]) {
      for (const online of [true, false]) {
        for (const entry of menuEntries({ inMatch, online })) {
          expect(entry.label.trim().length, `${entry.action} has no label`).toBeGreaterThan(0);
        }
      }
    }
  });
});
