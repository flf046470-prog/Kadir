import { sql } from "drizzle-orm";
import { db } from "./client";
import { register } from "@/auth/accounts";
import { profiles, profileAttributes } from "./schema";
import { eq } from "drizzle-orm";

/**
 * Helpers for integration tests. These run against a real Postgres database —
 * the point is to exercise cascades, unique indexes, and transactions, none of
 * which a mock would test.
 */

let counter = 0;

export function uniqueEmail(): string {
  counter += 1;
  return `test-${Date.now()}-${counter}@example.test`;
}

/** Truncates every table. Cheaper and more thorough than deleting per test. */
export async function resetDatabase(): Promise<void> {
  await db.execute(
    sql`truncate table users, sessions, profiles, profile_attributes, profile_visibility,
        quiz_answers, travel_plans, likes, matches, blocks, signal_weights, daily_suggestions,
        message_translations, translation_usage, virtual_date_usage, virtual_date_invites,
        user_platform_accounts
        restart identity cascade`
  );
}

export type TestUserOptions = {
  countryId?: string;
  cityId?: string;
  relationshipGoal?: string;
  interests?: string[];
  languagesSpoken?: string[];
  matchIntents?: string[];
  cultureInterests?: string[];
  /** ISO date. Drives the age filter, which reads `users.birthdate`. */
  birthdate?: string;
  complete?: boolean;
};

/** Creates a registered member with a usable profile. */
export async function createTestUser(options: TestUserOptions = {}): Promise<string> {
  const result = await register({
    email: uniqueEmail(),
    password: "correct-horse-battery",
    displayName: "Test Member",
    birthdate: options.birthdate ?? "1995-06-15",
    countryId: options.countryId ?? "turkey"
  });

  if (!result.ok) {
    throw new Error(`Test user creation failed: ${JSON.stringify(result.errors)}`);
  }

  const userId = result.userId;

  await db
    .update(profiles)
    .set({
      cityId: options.cityId ?? "istanbul",
      relationshipGoal: options.relationshipGoal ?? "long_term",
      completedAt: options.complete === false ? null : new Date()
    })
    .where(eq(profiles.userId, userId));

  const attributes: { userId: string; kind: string; value: string }[] = [];
  for (const interest of options.interests ?? ["travel", "music"]) {
    attributes.push({ userId, kind: "interest", value: interest });
  }
  for (const language of options.languagesSpoken ?? ["tr", "en"]) {
    attributes.push({ userId, kind: "language_spoken", value: language });
  }
  for (const intent of options.matchIntents ?? ["serious_relationship"]) {
    attributes.push({ userId, kind: "match_intent", value: intent });
  }
  for (const culture of options.cultureInterests ?? []) {
    attributes.push({ userId, kind: "culture_interest", value: culture });
  }

  await db.insert(profileAttributes).values(attributes);

  return userId;
}
