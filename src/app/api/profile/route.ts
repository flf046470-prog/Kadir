import { NextResponse, type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { slugifyPlace } from "@/lib/domain/places";
import { db } from "@/db/client";
import { profiles, profileAttributes, profileVisibility } from "@/db/schema";
import { loadMatchProfile, genderPreferenceOf } from "@/db/profile-repository";
import {
  cultures,
  genders,
  idealDates,
  isGender,
  matchIntents,
  relationshipGoals,
  communicationStyles
} from "@/lib/domain/taxonomies";

/**
 * Profile read and update.
 *
 * Every incoming list is validated against the taxonomies before it is stored.
 * Unknown values are dropped rather than persisted, so a crafted request cannot
 * inject a value that later flows into matching or renders untranslated.
 */

const MAX_BIO = 500;
const MAX_LIST = 20;

const VALID_GOALS = new Set<string>(relationshipGoals.map((goal) => goal.id));
const VALID_INTENTS = new Set<string>(matchIntents.map((intent) => intent.id));
const VALID_IDEAL_DATES = new Set<string>(idealDates.map((date) => date.id));
const VALID_CULTURES = new Set<string>(cultures);
const VALID_COMMS = new Set<string>(communicationStyles);
const VALID_MODES = new Set(["dating", "language_exchange", "both"]);
const VALID_VISIBILITY = new Set(["everyone", "matches", "hidden"]);
const LANGUAGE_TAG = /^[a-z]{2}$/;

export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const [profile, gender] = await Promise.all([
    loadMatchProfile(auth.user.id),
    genderPreferenceOf(auth.user.id)
  ]);
  if (!profile) return apiError("profile_not_found", 404);

  /**
   * Gender rides alongside `MatchProfile` rather than inside it, deliberately.
   *
   * `MatchProfile` is what the matching *engine* receives, and gender is a hard
   * filter applied in SQL before scoring ever happens — not a signal. Putting
   * it in that type would place it in front of `scoreMatch`, where a later
   * signal could start scoring on it, which is scoring on gender.
   * `docs/AI_SAFETY.md` draws that line; this keeps it drawn.
   *
   * The member's own screen still needs both values to render, which is what
   * this is for.
   */
  return NextResponse.json({ ...profile, gender: gender.gender, seeking: gender.seeking });
}

function cleanList(value: unknown, allowed: Set<string> | RegExp): string[] {
  if (!Array.isArray(value)) return [];
  const test = (item: string) =>
    allowed instanceof RegExp ? allowed.test(item) : allowed.has(item);

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0 && test(item))
    )
  ].slice(0, MAX_LIST);
}

/** Free-form interests aren't a closed set, so they're length-capped instead. */
function cleanInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0 && item.length <= 40)
    )
  ].slice(0, MAX_LIST);
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const input = body as Record<string, unknown>;
  const userId = auth.user.id;

  const profileUpdate: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date() };

  if (typeof input.bio === "string") profileUpdate.bio = input.bio.trim().slice(0, MAX_BIO);
  /**
   * Places are stored slugified. Discovery compares country and city ids
   * directly, so "Germany" and "germany" must not be two different places —
   * normalising on write is what keeps the LOCAL and COUNTRY modes and the
   * discovery filters honest.
   */
  if (typeof input.cityId === "string") profileUpdate.cityId = slugifyPlace(input.cityId);
  if (typeof input.countryId === "string") {
    const countryId = slugifyPlace(input.countryId);
    if (countryId) profileUpdate.countryId = countryId;
  }
  if (typeof input.relationshipGoal === "string" && VALID_GOALS.has(input.relationshipGoal)) {
    profileUpdate.relationshipGoal = input.relationshipGoal;
  }
  if (typeof input.connectionMode === "string" && VALID_MODES.has(input.connectionMode)) {
    profileUpdate.connectionMode = input.connectionMode;
  }
  if (typeof input.openToOtherCultures === "boolean") {
    profileUpdate.openToOtherCultures = input.openToOtherCultures;
  }
  /**
   * Gender can be set, and can be cleared back to unanswered.
   *
   * `null` is a meaningful value here rather than a missing one, so a member
   * who answered by accident — or who would rather not say — can go back.
   * Anything outside the taxonomy is ignored, like every other closed
   * vocabulary in this handler.
   */
  if (input.gender === null) {
    profileUpdate.gender = null;
  } else if (typeof input.gender === "string" && isGender(input.gender)) {
    profileUpdate.gender = input.gender;
  }
  if (input.markComplete === true) profileUpdate.completedAt = new Date();

  const attributeUpdates: { kind: string; values: string[] }[] = [];
  const addIf = (key: string, kind: string, allowed: Set<string> | RegExp) => {
    if (input[key] !== undefined) attributeUpdates.push({ kind, values: cleanList(input[key], allowed) });
  };

  if (input.interests !== undefined) {
    attributeUpdates.push({ kind: "interest", values: cleanInterests(input.interests) });
  }
  addIf("idealDates", "ideal_date", VALID_IDEAL_DATES);
  addIf("matchIntents", "match_intent", VALID_INTENTS);
  addIf("cultureInterests", "culture_interest", VALID_CULTURES);
  addIf("communicationStyles", "communication_style", VALID_COMMS);
  addIf("languagesSpoken", "language_spoken", LANGUAGE_TAG);
  addIf("languagesLearning", "language_learning", LANGUAGE_TAG);
  // Sending `seeking: []` clears it, which reads as "no preference" rather than
  // "nobody" — see `discoverableBy`.
  addIf("seeking", "seeking", new Set<string>(genders));

  const visibilityUpdate: Record<string, string> = {};
  const visibilityFields = [
    "location",
    "travelPlans",
    "futureLocation",
    "languages",
    "cultureInterests",
    "relationshipGoal"
  ] as const;

  const rawVisibility = input.visibility as Record<string, unknown> | undefined;
  if (rawVisibility && typeof rawVisibility === "object") {
    for (const field of visibilityFields) {
      const value = rawVisibility[field];
      if (typeof value === "string" && VALID_VISIBILITY.has(value)) {
        visibilityUpdate[field] = value;
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(profiles).set(profileUpdate).where(eq(profiles.userId, userId));

    // Replace-per-kind: a member sending `interests: []` means "clear them",
    // and only the kinds actually present in the request are touched.
    for (const update of attributeUpdates) {
      await tx
        .delete(profileAttributes)
        .where(and(eq(profileAttributes.userId, userId), eq(profileAttributes.kind, update.kind)));

      if (update.values.length > 0) {
        await tx
          .insert(profileAttributes)
          .values(update.values.map((value) => ({ userId, kind: update.kind, value })));
      }
    }

    if (Object.keys(visibilityUpdate).length > 0) {
      await tx
        .update(profileVisibility)
        .set(visibilityUpdate)
        .where(eq(profileVisibility.userId, userId));
    }
  });

  const updated = await loadMatchProfile(userId);
  return NextResponse.json(updated);
}
