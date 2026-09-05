import { eq, and, inArray, ne, or, notInArray, sql, gte, lte } from "drizzle-orm";
import { db } from "./client";
import {
  profiles,
  profileAttributes,
  profileVisibility,
  quizAnswers,
  travelPlans,
  likes,
  blocks,
  matches,
  users
} from "./schema";
import { defaultFilters, type DiscoveryFilters } from "@/lib/matching/filters";
import type { GenderPreference } from "@/lib/matching/gender";
import { genders, isGender } from "@/lib/domain/taxonomies";
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
/**
 * One member's gender and who they are seeking.
 *
 * Both may be unanswered, and the shape says so rather than substituting a
 * default — the whole filter depends on being able to tell "no preference" from
 * "seeking nobody".
 */
export async function genderPreferenceOf(userId: string): Promise<GenderPreference> {
  const [profile, seeking] = await Promise.all([
    db
      .select({ gender: profiles.gender })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1),
    db
      .select({ value: profileAttributes.value })
      .from(profileAttributes)
      .where(and(eq(profileAttributes.userId, userId), eq(profileAttributes.kind, "seeking")))
  ]);

  const gender = profile[0]?.gender ?? null;

  return {
    // A value the taxonomy no longer knows is treated as unanswered rather than
    // trusted into a filter, the way every other closed vocabulary here is read.
    gender: gender && isGender(gender) ? gender : null,
    seeking: seeking.map((row) => row.value).filter(isGender)
  };
}

export async function findCandidateIds(
  viewerId: string,
  options: { countryId?: string; limit?: number; filters?: DiscoveryFilters } = {}
): Promise<string[]> {
  const limit = options.limit ?? 200;
  const filters = options.filters ?? defaultFilters;

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

  // A discovery mode may pin the country; an explicit filter overrides it.
  const countryId = filters.countryId ?? options.countryId;
  if (countryId) conditions.push(eq(profiles.countryId, countryId));
  if (filters.cityId) conditions.push(eq(profiles.cityId, filters.cityId));

  if (filters.relationshipGoals.length > 0) {
    conditions.push(inArray(profiles.relationshipGoal, filters.relationshipGoals));
  }

  /**
   * Age is derived from `users.birthdate` rather than stored, so it cannot go
   * stale. Comparing against a computed birthdate window keeps the predicate
   * sargable — `age(birthdate)` on every row would not be.
   */
  const today = new Date();
  const oldestBirthdate = new Date(
    Date.UTC(today.getUTCFullYear() - filters.maxAge - 1, today.getUTCMonth(), today.getUTCDate() + 1)
  );
  const youngestBirthdate = new Date(
    Date.UTC(today.getUTCFullYear() - filters.minAge, today.getUTCMonth(), today.getUTCDate())
  );

  conditions.push(gte(users.birthdate, oldestBirthdate.toISOString().slice(0, 10)));
  conditions.push(lte(users.birthdate, youngestBirthdate.toISOString().slice(0, 10)));
  // A suspended member never appears in anyone's feed.
  conditions.push(sql`${users.suspendedAt} is null`);
  conditions.push(sql`${users.deletedAt} is null`);

  // Attribute filters are AND-of-ORs: a candidate must have at least one of the
  // requested values in each requested category.
  for (const [kind, values] of [
    ["language_spoken", filters.languages],
    ["match_intent", filters.matchIntents],
    ["culture_interest", filters.cultureInterests]
  ] as const) {
    if (values.length === 0) continue;

    const holders = db
      .select({ id: profileAttributes.userId })
      .from(profileAttributes)
      .where(and(eq(profileAttributes.kind, kind), inArray(profileAttributes.value, values)));

    conditions.push(inArray(profiles.userId, holders));
  }

  /**
   * Gender, both ways round.
   *
   * `discoverableBy` in `lib/matching/gender.ts` states the rule and is the
   * readable version of it; this is the same rule pushed into SQL, so the
   * database filters rather than the engine discarding rows afterwards. The two
   * have to agree, and `gender.integration.test.ts` checks them against each
   * other rather than trusting that they do.
   *
   * Each half is skipped when the relevant side has not answered. That is what
   * keeps every existing member's feed working on the deploy that adds this.
   */
  const viewer = await genderPreferenceOf(viewerId);

  /**
   * The viewer is seeking the candidate's gender — unless the viewer stated no
   * preference, or the candidate has not stated one this taxonomy still knows.
   *
   * `not in (genders)` rather than `is null` alone, because `genderPreferenceOf`
   * reads a retired value back as *unanswered* and this has to agree with it.
   * Testing only for null would make an out-of-taxonomy row invisible here
   * while `discoverableBy` showed it to everyone — the two expressions of one
   * rule disagreeing, in opposite directions.
   */
  if (viewer.seeking.length > 0) {
    conditions.push(
      or(
        sql`${profiles.gender} is null`,
        notInArray(profiles.gender, genders as string[]),
        inArray(profiles.gender, viewer.seeking)
      )!
    );
  }

  // The candidate is seeking the viewer's gender — unless the candidate stated
  // no preference at all, which is what the `not in` half means.
  if (viewer.gender !== null) {
    // Only rows the taxonomy still knows count as having stated a preference,
    // for the same reason as above: `genderPreferenceOf` discards the rest, and
    // a candidate whose only preference is a retired value has, as far as
    // everything else is concerned, stated none.
    const statedAPreference = db
      .select({ id: profileAttributes.userId })
      .from(profileAttributes)
      .where(
        and(
          eq(profileAttributes.kind, "seeking"),
          inArray(profileAttributes.value, genders as string[])
        )
      );

    const seeksTheViewer = db
      .select({ id: profileAttributes.userId })
      .from(profileAttributes)
      .where(
        and(eq(profileAttributes.kind, "seeking"), eq(profileAttributes.value, viewer.gender))
      );

    conditions.push(
      or(
        notInArray(profiles.userId, statedAPreference),
        inArray(profiles.userId, seeksTheViewer)
      )!
    );
  }

  const rows = await db
    .select({ id: profiles.userId })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
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
