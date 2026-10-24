import { describe, expect, it } from 'vitest';

import { EVENTS } from '../content/rewards.js';
import type { EventDef } from '../content/rewards.js';
import { ACHIEVEMENTS } from '../content/achievements.js';
import { createProfile } from './profile.js';
import { enterActiveEvents, evaluateEvents, eventProgress, isCountableMetric, occurrenceAt } from './events.js';
import { migrateProfile } from '../save/index.js';
import { applyMatchStats, evaluateAchievements } from './achievements.js';
import type { MatchResult } from '../modes/types.js';

/**
 * Events: counted only while they run, paid once per occurrence, and back every year.
 *
 * `EVENTS` was declared with dates and challenges and read by nothing. These tests hold the rules
 * that make reading it worth anything — above all that a stat earned *before* an event cannot
 * complete it, or a veteran with 40 km on the clock would be paid for Snow Miles on login.
 */
const at = (iso: string): number => Date.parse(iso);

const HILL: EventDef = {
  id: 'hill-week',
  name: 'Hill Week',
  startsAt: '2026-03-01T00:00:00.000Z',
  endsAt: '2026-03-07T23:59:59.000Z',
  yearly: true,
  challenges: [
    { id: 'hill_climb', name: 'Up', description: 'Climb 50 m.', metric: 'climbMetres', threshold: 50, rewardCoins: 300 },
    { id: 'hill_tags', name: 'Tag', description: 'Tag 3.', metric: 'tags', threshold: 3, rewardCoins: 100 },
  ],
};
const ONLY = [HILL];

describe('events', () => {
  it('counts only what happens after the player joins the event', () => {
    const profile = createProfile('p', 'P');
    profile.stats.climbMetres = 900; // a veteran climber, before the event
    expect(enterActiveEvents(profile, at('2026-03-02T12:00:00Z'), ONLY)).toBe(true);
    expect(evaluateEvents(profile, at('2026-03-02T12:00:00Z'), ONLY)).toEqual([]);

    profile.stats.climbMetres += 49;
    expect(evaluateEvents(profile, at('2026-03-03T12:00:00Z'), ONLY)).toEqual([]);
    expect(eventProgress(profile, at('2026-03-03T12:00:00Z'), ONLY)[0]?.challenges[0]?.value).toBe(49);

    profile.stats.climbMetres += 1;
    const coins = profile.coins;
    const paid = evaluateEvents(profile, at('2026-03-03T13:00:00Z'), ONLY);
    expect(paid.map((u) => u.challenge.id)).toEqual(['hill_climb']);
    expect(profile.coins).toBe(coins + 300);
  });

  it('pays a challenge once', () => {
    const profile = createProfile('p', 'P');
    const now = at('2026-03-02T12:00:00Z');
    enterActiveEvents(profile, now, ONLY);
    profile.stats.tags += 10;
    expect(evaluateEvents(profile, now, ONLY)).toHaveLength(1);
    const coins = profile.coins;
    profile.stats.tags += 10;
    expect(evaluateEvents(profile, now, ONLY)).toEqual([]);
    expect(profile.coins).toBe(coins);
  });

  it('does nothing outside the dates', () => {
    const profile = createProfile('p', 'P');
    const before = at('2026-02-20T00:00:00Z');
    expect(enterActiveEvents(profile, before, ONLY)).toBe(false);
    profile.stats.tags += 10;
    expect(evaluateEvents(profile, before, ONLY)).toEqual([]);
    expect(profile.events).toEqual({});

    // Joined during the event, then the event ends: progress made after the end does not pay.
    enterActiveEvents(profile, at('2026-03-05T00:00:00Z'), ONLY);
    profile.stats.climbMetres += 500;
    expect(evaluateEvents(profile, at('2026-03-09T00:00:00Z'), ONLY)).toEqual([]);
  });

  it('comes back next year with nothing already done, and forgets last year', () => {
    const profile = createProfile('p', 'P');
    enterActiveEvents(profile, at('2026-03-02T00:00:00Z'), ONLY);
    profile.stats.tags += 5;
    expect(evaluateEvents(profile, at('2026-03-02T00:00:00Z'), ONLY)).toHaveLength(1);
    expect(Object.keys(profile.events)).toEqual(['hill-week@2026']);

    // A year on, the same challenge is there to earn again — keyed by id alone it would read "done".
    const nextYear = at('2027-03-02T00:00:00Z');
    enterActiveEvents(profile, nextYear, ONLY);
    expect(Object.keys(profile.events)).toEqual(['hill-week@2027']);
    profile.stats.tags += 5;
    expect(evaluateEvents(profile, nextYear, ONLY).map((u) => u.challenge.id)).toEqual(['hill_tags']);
  });

  it('keeps a finished event for a month, then drops it', () => {
    const profile = createProfile('p', 'P');
    enterActiveEvents(profile, at('2026-03-02T00:00:00Z'), ONLY);
    expect(enterActiveEvents(profile, at('2026-03-20T00:00:00Z'), ONLY)).toBe(false);
    expect(profile.events['hill-week@2026']).toBeDefined();
    expect(enterActiveEvents(profile, at('2026-04-10T00:00:00Z'), ONLY)).toBe(true);
    expect(profile.events).toEqual({});
  });

  it('finds the winter event on both sides of New Year', () => {
    const winter = EVENTS.find((e) => e.id === 'winter')!;
    expect(occurrenceAt(winter, at('2026-12-20T00:00:00Z'))?.key).toBe('winter@2026');
    expect(occurrenceAt(winter, at('2027-01-03T00:00:00Z'))?.key).toBe('winter@2026');
    expect(occurrenceAt(winter, at('2028-01-03T00:00:00Z'))?.key).toBe('winter@2027');
    expect(occurrenceAt(winter, at('2027-06-01T00:00:00Z'))).toBeUndefined();
  });

  it('shows the next event when none is running, and still does after the last dated one', () => {
    const profile = createProfile('p', 'P');
    const [next] = eventProgress(profile, at('2026-09-28T00:00:00Z'));
    expect(next?.id).toBe('halloween');
    expect(next?.active).toBe(false);
    expect(next?.challenges.every((c) => c.value === 0 && !c.done)).toBe(true);
    // The shipped list's dates are all 2026–27; every event recurs, so the screen is never empty.
    const [later] = eventProgress(profile, at('2029-08-01T00:00:00Z'));
    expect(later?.id).toBe('halloween');
    expect(later?.startsAt).toBe('2029-10-24T00:00:00.000Z');
  });
});

describe('the event and achievement catalog', () => {
  it('only counts totals, never a best time', () => {
    for (const event of EVENTS) {
      for (const challenge of event.challenges) expect(isCountableMetric(challenge.metric), challenge.id).toBe(true);
    }
  });

  it('has unique challenge ids, because the results screen names them by id', () => {
    const ids = EVENTS.flatMap((e) => e.challenges.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pays something real for every goal', () => {
    const fresh = createProfile('fresh', 'F');
    for (const def of ACHIEVEMENTS) {
      expect(def.rewardCoins, def.id).toBeGreaterThan(0);
      // Six used to name launch cosmetics every account owns from creation — a reward of nothing.
      if (def.rewardCosmeticId) expect(fresh.ownedCosmetics, def.id).not.toContain(def.rewardCosmeticId);
    }
    for (const challenge of EVENTS.flatMap((e) => e.challenges)) expect(challenge.rewardCoins, challenge.id).toBeGreaterThan(0);
  });
});

describe('event records from a save', () => {
  it('keeps well-formed records and drops the rest', () => {
    const raw = JSON.parse(`{
      "version": 3,
      "events": {
        "hill-week@2026": { "endsAt": 1772927999000, "baseline": { "tags": 4, "climbMetres": "lots", "nope": 3 }, "done": ["hill_tags", 7] },
        "no-end@2026": { "baseline": { "tags": 1 }, "done": [] },
        "bad-end@2026": { "endsAt": "soon", "baseline": {}, "done": [] },
        "no-baseline@2026": { "endsAt": 1, "done": [] },
        "__proto__": { "endsAt": 1, "baseline": {}, "done": [] }
      }
    }`) as unknown;
    const profile = migrateProfile(raw, 'p');
    expect(Object.keys(profile.events)).toEqual(['hill-week@2026']);
    expect(profile.events['hill-week@2026']).toEqual({ endsAt: 1772927999000, baseline: { tags: 4 }, done: ['hill_tags'] });
    expect(Object.getPrototypeOf(profile.events)).toBe(Object.prototype);
  });

  it('gives an old save no events rather than failing', () => {
    expect(migrateProfile({ version: 3, coins: 10 }, 'p').events).toEqual({});
    expect(migrateProfile({ version: 3, events: [1, 2] }, 'p').events).toEqual({});
  });
});

/** A one-player round won with an escape, in the given mode. */
const escapedRound = (modeId: string): MatchResult => ({
  modeId,
  levelId: 'jungle-world',
  durationTicks: 600,
  winnerIds: ['p'],
  players: [{ playerId: 'p', name: 'P', animalId: 'kangaroo', placement: 1, score: 10, tags: 0, escapes: 1, survivalTicks: 600, bestLapTicks: -1, won: true }],
});

describe('Survivor', () => {
  it('counts only the last survivors of Infection, as its description says', () => {
    const profile = createProfile('p', 'P');
    for (let round = 0; round < 10; round++) applyMatchStats(profile, escapedRound('kangaroo-chase'), 'p');
    expect(profile.stats.escapes).toBe(10);
    expect(evaluateAchievements(profile).map((u) => u.def.id)).not.toContain('survivor');
    for (let round = 0; round < 10; round++) applyMatchStats(profile, escapedRound('infection'), 'p');
    expect(profile.stats.infectionSurvivals).toBe(10);
    expect(evaluateAchievements(profile).map((u) => u.def.id)).toContain('survivor');
  });

  it('starts at zero on a save written before it existed', () => {
    expect(migrateProfile({ version: 3, stats: { escapes: 40 } }, 'p').stats.infectionSurvivals).toBe(0);
  });
});
