import { and, asc, eq } from "drizzle-orm";
import { db } from "./client";
import { dailySuggestions } from "./schema";
import {
  findCandidateIds,
  loadMatchProfile,
  loadMatchProfiles,
  matchedUserIds
} from "./profile-repository";
import { loadProfileCards, type ProfileCard } from "./profile-cards";
import { listVisiblePhotos } from "./photos";
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
  photos: Awaited<ReturnType<typeof listVisiblePhotos>>;
  rank: number;
};

/** `2026-08-23` in UTC — the day boundary everyone shares, not the server's locale. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

type StoredRow = { suggestedUserId: string; score: number; reasons: string; rank: number };

async function readStored(userId: string, forDate: string): Promise<StoredRow[]> {
  return db
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

async function choose(userId: string, forDate: string): Promise<StoredRow[]> {
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
    locations
  });

  const rows = chosen.map((suggestion, index) => ({
    suggestedUserId: suggestion.profileId,
    score: Math.round(suggestion.score * 100),
    reasons: JSON.stringify(suggestion.reasons),
    rank: index
  }));

  if (rows.length > 0) {
    await db
      .insert(dailySuggestions)
      .values(rows.map((row) => ({ userId, forDate, ...row })))
      // Two tabs opening the page at once both try to write the day's list.
      // The first one wins; the second is a no-op rather than an error.
      .onConflictDoNothing();

    // Read back rather than trusting the local copy: if another request won
    // the race, its list is the day's list and this one must agree with it.
    return readStored(userId, forDate);
  }

  return rows;
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
  const rows = stored.length > 0 ? stored : await choose(userId, forDate);
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.suggestedUserId);
  const matched = new Set(await matchedUserIds(userId));

  const [cards, photoEntries] = await Promise.all([
    loadProfileCards(ids, matched),
    Promise.all(ids.map(async (id) => [id, await listVisiblePhotos(id, userId)] as const))
  ]);
  const photos = new Map(photoEntries);

  return rows.map((row) => ({
    profileId: row.suggestedUserId,
    profile: cards.get(row.suggestedUserId) ?? null,
    score: row.score / 100,
    reasons: parseReasons(row.reasons),
    photos: photos.get(row.suggestedUserId) ?? [],
    rank: row.rank
  }));
}
