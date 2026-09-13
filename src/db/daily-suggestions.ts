import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { dailySuggestions } from "./schema";
import { advisoryLockKey } from "./advisory-lock";
import {
  findCandidateIds,
  loadMatchProfile,
  loadMatchProfiles,
  matchedUserIds
} from "./profile-repository";
import { loadProfileCards, type ProfileCard } from "./profile-cards";
import { listVisiblePhotosFor, type PhotoRecord } from "./photos";
import { loadLearnedWeights } from "./signal-weights";
import { selectTodaysFive } from "@/lib/matching/todays-five";
import { locationContext } from "@/lib/matching/location-context";
import type { MatchReason } from "@/lib/matching/reasons";
import type { LocationContext } from "@/lib/matching/signals";

/**
 * Today's 5.
 *
 * The product promise is "don't swipe forever", so the day's list has to be a
 * *decision*, not a feed: the same five people all day, in the same order,
 * however many times the page is opened. That is why the selection is written
 * down rather than recomputed — recomputing would reshuffle the list every
 * time anyone new joined, and the promise would quietly become another feed.
 *
 * Chosen once per member per day, then read back. The engine itself stays a
 * pure function; everything database-shaped happens here.
 */

/** The mode Today's 5 selects in. Local first — proximity is the strongest signal we hold. */
const DAILY_MODE = "local" as const;

export type DailySuggestion = {
  profileId: string;
  profile: ProfileCard | null;
  /** 0–1, as the engine produces it. Stored as an integer percentage. */
  score: number;
  reasons: MatchReason[];
  photos: PhotoRecord[];
  rank: number;
};

/** `2026-08-23` in UTC — the day boundary everyone shares, not the server's locale. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

type StoredRow = { suggestedUserId: string; score: number; reasons: string; rank: number };

async function readStored(
  userId: string,
  forDate: string,
  executor: Pick<typeof db, "select"> = db
): Promise<StoredRow[]> {
  return executor
    .select({
      suggestedUserId: dailySuggestions.suggestedUserId,
      score: dailySuggestions.score,
      reasons: dailySuggestions.reasons,
      rank: dailySuggestions.rank
    })
    .from(dailySuggestions)
    .where(and(eq(dailySuggestions.userId, userId), eq(dailySuggestions.forDate, forDate)))
    .orderBy(asc(dailySuggestions.rank));
}

/**
 * Reasons round-trip as JSON in a text column.
 *
 * A malformed row must not take the whole day's list down with it, so a parse
 * failure degrades to "no reasons shown" rather than throwing — the suggestion
 * is still worth showing without its explanation.
 */
function parseReasons(raw: string): MatchReason[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MatchReason[]) : [];
  } catch {
    return [];
  }
}

/**
 * Picks and stores the day's list.
 *
 * Exported for the concurrency test rather than for callers — `todaysFive` is
 * the entry point. The guarantee worth testing is that a second selection
 * racing a first *adopts* the stored list instead of adding to it, and that
 * cannot be forced through `todaysFive`, which reads the stored list first and
 * only reaches here when it is empty.
 */
export async function chooseForDay(userId: string, forDate: string): Promise<StoredRow[]> {
  const viewer = await loadMatchProfile(userId);
  if (!viewer) return [];

  // `findCandidateIds` already drops anyone judged, blocked, or incomplete.
  const candidateIds = await findCandidateIds(userId, {
    countryId: viewer.countryId,
    limit: 200
  });
  if (candidateIds.length === 0) return [];

  const candidates = await loadMatchProfiles(candidateIds);

  const locations: Record<string, LocationContext> = {};
  for (const candidate of candidates.values()) {
    locations[candidate.id] = locationContext(viewer.cityId, candidate.cityId, DAILY_MODE);
  }

  const chosen = selectTodaysFive({
    viewer,
    candidates: [...candidates.values()],
    mode: DAILY_MODE,
    locations,
    // The same learned multipliers Discover uses. A member who has taught the
    // engine something should not have to teach it twice per screen.
    learnedAdjustments: await loadLearnedWeights(userId)
  });

  const rows = chosen.map((suggestion, index) => ({
    suggestedUserId: suggestion.profileId,
    score: Math.round(suggestion.score * 100),
    reasons: JSON.stringify(suggestion.reasons),
    rank: index
  }));

  if (rows.length === 0) return rows;

  /**
   * The day's list is written all at once or not at all.
   *
   * `onConflictDoNothing` was not enough, and the reason is the key: the
   * primary key is (member, date, *suggested member*), not (member, date,
   * rank). Two tabs opening the page at the same instant both compute a list,
   * and those lists need not agree — `findCandidateIds` drops anyone the
   * viewer has judged, so a pass in one tab is enough to change what the other
   * one picks, and a new signup does it too. The overlap then conflicted and
   * was skipped while the differences inserted, so the day ended up with eight
   * rows carrying duplicate ranks: "Today's 5" became Today's 8, in an order
   * that depended on which row the database returned first.
   *
   * That is precisely the promise this file exists to keep — "the same five
   * people all day, in the same order, however many times the page is opened"
   * — so the check and the write are one step under a lock on the member's day.
   * The scoring above stays outside it: it loads two hundred profiles and runs
   * the engine, and holding a connection through that is what
   * `db/pool.integration.test.ts` exists to catch.
   */
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${advisoryLockKey(`daily:${userId}:${forDate}`)})`
    );

    // Another request may have won while this one was scoring. Its list is the
    // day's list, and this one agrees with it rather than adding to it.
    const existing = await readStored(userId, forDate, tx);
    if (existing.length > 0) return existing;

    await tx.insert(dailySuggestions).values(rows.map((row) => ({ userId, forDate, ...row })));

    return rows;
  });
}

/**
 * The day's suggestions, hydrated for display.
 *
 * Cards and photos load through the same functions Discover uses, so a member
 * sees exactly what they would see there — visibility settings applied
 * server-side, and only moderation-approved photos.
 */
export async function todaysFive(
  userId: string,
  forDate: string = utcDay()
): Promise<DailySuggestion[]> {
  const stored = (await readStored(userId, forDate)) ?? [];
  const rows = stored.length > 0 ? stored : await chooseForDay(userId, forDate);
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.suggestedUserId);
  const matched = new Set(await matchedUserIds(userId));

  const [cards, photos] = await Promise.all([
    loadProfileCards(ids, matched),
    listVisiblePhotosFor(ids, userId)
  ]);

  return rows.map((row) => ({
    profileId: row.suggestedUserId,
    profile: cards.get(row.suggestedUserId) ?? null,
    score: row.score / 100,
    reasons: parseReasons(row.reasons),
    photos: photos.get(row.suggestedUserId) ?? [],
    rank: row.rank
  }));
}
