import { describe, expect, it } from 'vitest';
import { ROLES } from '@kc/net';
import { ROLE_BADGES, roleBadge, roleBadgeClass } from './roles.js';

describe('the role badge', () => {
  it('names every role the wire can carry', () => {
    // WARM-UP is the label of `idle` alone; any other role reading it is a role nobody labelled.
    for (const role of ROLES) {
      if (role === 'idle') continue;
      expect(roleBadge(role).label, role).not.toBe('WARM-UP');
    }
    expect(Object.keys(ROLE_BADGES).toSorted()).toEqual([...ROLES].toSorted());
  });

  it("tells the Hunt's hunter they are the threat and a survivor they are prey", () => {
    expect(roleBadge('hunter')).toEqual({ label: 'HUNTER', tone: 'threat' });
    expect(roleBadge('survivor')).toEqual({ label: 'SURVIVOR', tone: 'prey' });
    expect(roleBadgeClass('hunter')).toBe('kc-role kc-role--chaser');
    expect(roleBadgeClass('survivor')).toBe('kc-role kc-role--runner');
  });

  it("calls Conversion Duel's sides what the mode calls them, and keeps their colours", () => {
    expect(roleBadge('runner', 'duel')).toEqual({ label: 'HUMAN', tone: 'prey' });
    expect(roleBadge('chaser', 'duel')).toEqual({ label: 'KANGAROO', tone: 'threat' });
    // Every other mode, and a role the duel does not rename, keeps the role's own name.
    expect(roleBadge('runner', 'kangaroo-chase').label).toBe('RUNNER');
    expect(roleBadge('fighter', 'duel').label).toBe('FIGHTER');
    expect(roleBadge('runner').label).toBe('RUNNER');
  });

  it('falls back to WARM-UP only for a string that is not a role', () => {
    expect(roleBadge('converted:human').label).toBe('WARM-UP');
  });
});
