import { EVENTS } from '../content/rewards.js';
import type { EventChallenge, EventDef } from '../content/rewards.js';
import type { AchievementMetric } from '../content/achievements.js';
import type { PlayerProfile } from './profile.js';

/**
 * Where a player stands in one occurrence of an event: the stats they had when they first played
 * during it, and the challenges already paid. Progress is the rise since then — so only what
 * happens while the event runs counts, from the same server-observed stats the achievements read.
 *
 * Keyed by occurrence (`halloween@2026`), not by event, because a yearly event comes back: keyed by
 * id, last October's paid challenges would still be "done" this October and pay nothing.
 */
export interface EventRecord {
  /** When this occurrence ends, Unix ms — what the record is pruned by. */
  endsAt: number;
  baseline: Partial<Record<AchievementMetric, number>>;
  done: string[];
}

export interface EventOccurrence {
  event: EventDef;
  /** `<event id>@<year it starts>`: the key its record is kept under. */
  key: string;
  start: number;
  end: number;
}

export interface ChallengeProgress {
  challenge: EventChallenge;
  value: number;
  done: boolean;
}

export interface EventProgress {
  id: string;
  name: string;
  /** This occurrence's dates, ISO — a yearly event's own `startsAt` is only its first year. */
  startsAt: string;
  endsAt: string;
  /** Running now on the server's clock; otherwise this is the next one, shown so players can plan. */
  active: boolean;
  challenges: ChallengeProgress[];
}

export interface EventUnlock {
  event: EventDef;
  challenge: EventChallenge;
  coins: number;
}

/** A record is kept this long after its occurrence ends, then dropped — a profile is not an archive. */
const KEEP_AFTER_END_MS = 30 * 24 * 3600 * 1000;

/**
 * Metrics an event can count. `bestLapSeconds` is a best, not a running total: "the rise since the
 * event began" means nothing for it (a faster lap *lowers* it), so a challenge on it would either
 * never pay or pay for getting slower.
 */
export function isCountableMetric(metric: AchievementMetric): boolean {
  return metric !== 'bestLapSeconds';
}

function occurrence(event: EventDef, years: number): EventOccurrence {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  start.setUTCFullYear(start.getUTCFullYear() + years);
  end.setUTCFullYear(end.getUTCFullYear() + years);
  return { event, key: `${event.id}@${start.getUTCFullYear()}`, start: start.getTime(), end: end.getTime() };
}

/** The occurrences that could matter at `now`: last year's (one can span New Year), this year's, next year's. */
function occurrencesNear(event: EventDef, now: number): EventOccurrence[] {
  if (!event.yearly) return [occurrence(event, 0)];
  const first = new Date(event.startsAt).getUTCFullYear();
  const year = new Date(now).getUTCFullYear();
  const out: EventOccurrence[] = [];
  for (let y = Math.max(first, year - 1); y <= year + 1; y++) out.push(occurrence(event, y - first));
  return out;
}

/** The occurrence of `event` running at `now`, if there is one. */
export function occurrenceAt(event: EventDef, now: number): EventOccurrence | undefined {
  return occurrencesNear(event, now).find((o) => o.start <= now && now <= o.end);
}

function nextOccurrence(event: EventDef, now: number): EventOccurrence | undefined {
  return occurrencesNear(event, now).find((o) => o.start > now);
}

export function isEventActive(event: EventDef, now: number): boolean {
  return occurrenceAt(event, now) !== undefined;
}

/**
 * Start counting for every event running now that this profile has not joined yet.
 *
 * Called before a round's stats are applied, so the round that first touches an event counts
 * towards it, and when the profile is loaded, so the player sees their progress start at zero the
 * moment they open the game. Returns whether anything changed.
 */
export function enterActiveEvents(profile: PlayerProfile, now: number, events: readonly EventDef[] = EVENTS): boolean {
  let changed = false;
  for (const event of events) {
    const current = occurrenceAt(event, now);
    if (!current || profile.events[current.key]) continue;
    const baseline: Partial<Record<AchievementMetric, number>> = {};
    for (const challenge of event.challenges) baseline[challenge.metric] = profile.stats[challenge.metric];
    profile.events[current.key] = { endsAt: current.end, baseline, done: [] };
    changed = true;
  }
  for (const [key, record] of Object.entries(profile.events)) {
    if (now - record.endsAt > KEEP_AFTER_END_MS) {
      delete profile.events[key];
      changed = true;
    }
  }
  return changed;
}

function progressOf(profile: PlayerProfile, record: EventRecord, challenge: EventChallenge): number {
  const now = profile.stats[challenge.metric];
  return Math.max(0, now - (record.baseline[challenge.metric] ?? now));
}

/** Pay every challenge of a running event that has been reached and not yet paid. */
export function evaluateEvents(profile: PlayerProfile, now: number, events: readonly EventDef[] = EVENTS): EventUnlock[] {
  const unlocked: EventUnlock[] = [];
  for (const event of events) {
    const current = occurrenceAt(event, now);
    const record = current ? profile.events[current.key] : undefined;
    if (!record) continue;
    for (const challenge of event.challenges) {
      if (record.done.includes(challenge.id)) continue;
      if (progressOf(profile, record, challenge) < challenge.threshold) continue;
      record.done.push(challenge.id);
      profile.coins += challenge.rewardCoins;
      unlocked.push({ event, challenge, coins: challenge.rewardCoins });
    }
  }
  if (unlocked.length > 0) profile.updatedAt = now;
  return unlocked;
}

/** Every running event, or the next one to start when none is — what the challenges screen shows. */
export function eventProgress(profile: PlayerProfile, now: number, events: readonly EventDef[] = EVENTS): EventProgress[] {
  const running = events.map((event) => occurrenceAt(event, now)).filter((o): o is EventOccurrence => o !== undefined);
  const shown = running.length > 0
    ? running
    : events
        .map((event) => nextOccurrence(event, now))
        .filter((o): o is EventOccurrence => o !== undefined)
        .toSorted((a, b) => a.start - b.start)
        .slice(0, 1);
  return shown.map((o) => {
    const record = profile.events[o.key];
    const active = o.start <= now && now <= o.end;
    return {
      id: o.event.id,
      name: o.event.name,
      startsAt: new Date(o.start).toISOString(),
      endsAt: new Date(o.end).toISOString(),
      active,
      challenges: o.event.challenges.map((challenge) => ({
        challenge,
        value: active && record ? Math.min(challenge.threshold, progressOf(profile, record, challenge)) : 0,
        done: record?.done.includes(challenge.id) ?? false,
      })),
    };
  });
}
