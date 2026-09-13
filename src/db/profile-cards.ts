import { eq, inArray, and } from "drizzle-orm";
import { db } from "./client";
import { profiles, profileAttributes, profileVisibility, users } from "./schema";
import { ageOn } from "@/lib/domain/age";
import { canSee, defaultVisibility, type ProfileVisibility } from "@/lib/domain/profile";
import type { RelationshipGoalId } from "@/lib/domain/taxonomies";

/**
 * The display side of a profile.
 *
 * `profile-repository` deliberately loads a narrow, matching-only view that has
 * no name and no bio, so scoring physically cannot use them. Rendering needs
 * different fields, so it gets a different loader rather than widening that
 * one — and this is then the single place where "what does one member see of
 * another?" is answered.
 *
 * Everything optional is gated on the subject's own visibility settings, and
 * the gating happens here rather than in the component: a UI bug should not be
 * able to leak a field a member chose to hide.
 */

export type ProfileCard = {
  id: string;
  displayName: string;
  /** Derived from the birthdate on every read, so it is never a day stale. */
  age: number | null;
  bio: string | null;
  cityId: string | null;
  countryId: string | null;
  relationshipGoal: RelationshipGoalId | null;
  languagesSpoken: string[];
  interests: string[];
};

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
 * Loads cards for a set of members as one viewer would see them.
 *
 * `matchedIds` decides the "matches only" fields; a viewer who is not matched
 * with the subject never receives them at all.
 */
export async function loadProfileCards(
  userIds: string[],
  matchedIds: ReadonlySet<string> = new Set()
): Promise<Map<string, ProfileCard>> {
  if (userIds.length === 0) return new Map();

  const [rows, visibilityRows, attributeRows] = await Promise.all([
    db
      .select({
        id: profiles.userId,
        displayName: users.displayName,
        birthdate: users.birthdate,
        bio: profiles.bio,
        cityId: profiles.cityId,
        countryId: profiles.countryId,
        relationshipGoal: profiles.relationshipGoal
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(inArray(profiles.userId, userIds)),
    db.select().from(profileVisibility).where(inArray(profileVisibility.userId, userIds)),
    db
      .select()
      .from(profileAttributes)
      .where(
        and(
          inArray(profileAttributes.userId, userIds),
          inArray(profileAttributes.kind, ["language_spoken", "interest"])
        )
      )
  ]);

  const visibilityByUser = new Map(visibilityRows.map((row) => [row.userId, row]));

  const attributesByUser = new Map<string, { languages: string[]; interests: string[] }>();
  for (const row of attributeRows) {
    const entry = attributesByUser.get(row.userId) ?? { languages: [], interests: [] };
    if (row.kind === "language_spoken") entry.languages.push(row.value);
    else entry.interests.push(row.value);
    attributesByUser.set(row.userId, entry);
  }

  const cards = new Map<string, ProfileCard>();

  for (const row of rows) {
    const visibility = visibilityFrom(visibilityByUser.get(row.id));
    const isMutualMatch = matchedIds.has(row.id);
    const visible = (field: keyof ProfileVisibility) =>
      canSee({ visibility }, field, isMutualMatch);
    const attributes = attributesByUser.get(row.id) ?? { languages: [], interests: [] };

    cards.set(row.id, {
      id: row.id,
      displayName: row.displayName,
      age: ageOn(row.birthdate),
      bio: row.bio,
      // City and country share one setting: hiding the city but publishing the
      // country would still be a location, just a coarser one, and members read
      // "hidden" as hidden.
      cityId: visible("location") ? row.cityId : null,
      countryId: visible("location") ? row.countryId : null,
      relationshipGoal: visible("relationshipGoal")
        ? (row.relationshipGoal as RelationshipGoalId)
        : null,
      languagesSpoken: visible("languages") ? attributes.languages : [],
      interests: attributes.interests
    });
  }

  return cards;
}
