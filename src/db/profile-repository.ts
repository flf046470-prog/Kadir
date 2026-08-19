import { eq, and, inArray, ne, or, notInArray, sql } from "drizzle-orm";
import { db } from "./client";
import {
  profiles,
  profileAttributes,
  profileVisibility,
  quizAnswers,
  travelPlans,
  likes,
  blocks,
  matches
} from "./schema";
import { defaultVisibility, type MatchProfile, type ProfileVisibility } from "@/lib/domain/profile";
import type {
  CommunicationStyleId,
  ConnectionModeId,
  CultureId,
  FuturePlanId,
  IdealDateId,
  MatchIntentId,
  RelationshipGoalId,
  TravelStyleId
} from "@/lib/domain/taxonomies";

/**
 * Loads `MatchProfile` values for the matching engine.
 *
 * The engine's input type is deliberately narrow — it never sees an email, a
 * password hash, or anything sensitive — and this is the only place that
 * boundary is crossed. Keeping the mapping in one function means "what can
 * matching see?" has a single, reviewable answer.
 */

type AttributeKind =
  | "interest"
  | "ideal_date"
  | "communication_style"
  | "language_spoken"
  | "language_learning"
  | "culture_interest"
  | "match_intent"
  | "future_plan";

function visibilityFrom(row: typeof profileVisibility.$inferSelect | undefined): ProfileVisibility {
  if (!row) return { ...defaultVisibility };
  return {
    location: row.location as ProfileVisibility["location"],
    travelPlans: row.travelPlans as ProfileVisibility["travelPlans"],
    futureLocation: row.futureLocation as ProfileVisibility["futureLocation"],
    languages: row.languages as ProfileVisibility["languages"],
    cultureInterests: row.cultureInterests as ProfileVisibility["cultureInterests"],
    relationshipGoal: row.relationshipGoal as ProfileVisibility["relationshipGoal"]
  };
}

/**
 * Loads full match profiles for a set of user ids in a fixed number of queries,
 * regardless of how many ids are requested — Discover asks for hundreds of
 * candidates at once, so a per-user query here would be the whole feed's
 * latency.
 */
export async function loadMatchProfiles(userIds: string[]): Promise<Map<string, MatchProfile>> {
  if (userIds.length === 0) return new Map();

  const [profileRows, attributeRows, visibilityRows, quizRows, travelRows] = await Promise.all([
    db.select().from(profiles).where(inArray(profiles.userId, userIds)),
    db.select().from(profileAttributes).where(inArray(profileAttributes.userId, userIds)),
    db.select().from(profileVisibility).where(inArray(profileVisibility.userId, userIds)),
    db.select().from(quizAnswers).where(inArray(quizAnswers.userId, userIds)),
    db.select().from(travelPlans).where(inArray(travelPlans.userId, userIds))
  ]);

  const attributesByUser = new Map<string, Map<AttributeKind, string[]>>();
  for (const row of attributeRows) {
    const byKind = attributesByUser.get(row.userId) ?? new Map<AttributeKind, string[]>();
    const kind = row.kind as AttributeKind;
    byKind.set(kind, [...(byKind.get(kind) ?? []), row.value]);
    attributesByUser.set(row.userId, byKind);
  }

  const visibilityByUser = new Map(visibilityRows.map((row) => [row.userId, row]));

  const quizByUser = new Map<string, Record<string, string>>();
  for (const row of quizRows) {
    quizByUser.set(row.userId, {
      ...(quizByUser.get(row.userId) ?? {}),
      [row.questionId]: row.optionId
    });
  }

  const travelByUser = new Map<string, (typeof travelRows)[number][]>();
  for (const row of travelRows) {
    travelByUser.set(row.userId, [...(travelByUser.get(row.userId) ?? []), row]);
  }

  const result = new Map<string, MatchProfile>();

  for (const profile of profileRows) {
    const attributes = attributesByUser.get(profile.userId) ?? new Map();
    const get = (kind: AttributeKind) => attributes.get(kind) ?? [];

    result.set(profile.userId, {
      id: profile.userId,
      cityId: profile.cityId,
      countryId: profile.countryId,
      relationshipGoal: profile.relationshipGoal as RelationshipGoalId,
      matchIntents: get("match_intent") as MatchIntentId[],
      connectionMode: profile.connectionMode as ConnectionModeId,
      interests: get("interest"),
      idealDates: get("ideal_date") as IdealDateId[],
      communicationStyles: get("communication_style") as CommunicationStyleId[],
      languagesSpoken: get("language_spoken"),
      languagesLearning: get("language_learning"),
      cultureInterests: get("culture_interest") as CultureId[],
      openToOtherCultures: profile.openToOtherCultures,
      travelPlans: (travelByUser.get(profile.userId) ?? []).map((plan) => ({
        destinationCityId: plan.destinationCityId,
        destinationCountryId: plan.destinationCountryId,
        startDate: plan.startDate,
        endDate: plan.endDate,
        travelStyles: plan.styles as TravelStyleId[]
      })),
      futureLocation:
        profile.futureCityId && profile.futureCountryId && profile.futureMonth
          ? {
              cityId: profile.futureCityId,
              countryId: profile.futureCountryId,
              approximateMonth: profile.futureMonth
            }
          : null,
      futurePlans: get("future_plan") as FuturePlanId[],
      quizAnswers: quizByUser.get(profile.userId) ?? {},
      // Verifications are a display concern, not a matching input.
      verifications: [],
      visibility: visibilityFrom(visibilityByUser.get(profile.userId))
    });
  }

  return result;
}

export async function loadMatchProfile(userId: string): Promise<MatchProfile | null> {
  const map = await loadMatchProfiles([userId]);
  return map.get(userId) ?? null;
}

/**
 * Candidate ids for Discover.
 *
 * Exclusions are applied in SQL rather than after loading, so a blocked or
 * already-judged member is never even read into memory — the cheapest place to
 * enforce it and the hardest place to forget.
 */
export async function findCandidateIds(
  viewerId: string,
  options: { countryId?: string; limit?: number } = {}
): Promise<string[]> {
  const limit = options.limit ?? 200;

  const judged = db
    .select({ id: likes.toUserId })
    .from(likes)
    .where(eq(likes.fromUserId, viewerId));

  const blockedByMe = db
    .select({ id: blocks.blockedId })
    .from(blocks)
    .where(eq(blocks.blockerId, viewerId));

  const blockedMe = db
    .select({ id: blocks.blockerId })
    .from(blocks)
    .where(eq(blocks.blockedId, viewerId));

  const conditions = [
    ne(profiles.userId, viewerId),
    // Only members who finished setting up can appear.
    sql`${profiles.completedAt} is not null`,
    notInArray(profiles.userId, judged),
    notInArray(profiles.userId, blockedByMe),
    notInArray(profiles.userId, blockedMe)
  ];

  if (options.countryId) conditions.push(eq(profiles.countryId, options.countryId));

  const rows = await db
    .select({ id: profiles.userId })
    .from(profiles)
    .where(and(...conditions))
    .limit(limit);

  return rows.map((row) => row.id);
}

/** True when the two members have matched — gates "matches only" visibility. */
export async function areMatched(userA: string, userB: string): Promise<boolean> {
  const [low, high] = userA < userB ? [userA, userB] : [userB, userA];
  const rows = await db
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.userAId, low), eq(matches.userBId, high)))
    .limit(1);
  return rows.length > 0;
}

/** All match partner ids for a member. */
export async function matchedUserIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ a: matches.userAId, b: matches.userBId })
    .from(matches)
    .where(or(eq(matches.userAId, userId), eq(matches.userBId, userId)));

  return rows.map((row) => (row.a === userId ? row.b : row.a));
}
