import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, profiles, profileVisibility } from "@/db/schema";
import { hashPassword, validatePassword, verifyPassword, type PasswordProblem } from "./password";
import { destroyAllSessions } from "./session";

/**
 * Account creation, authentication, and deletion.
 *
 * Two properties this module is responsible for:
 *
 *  - **No user enumeration.** Login failures are indistinguishable whether the
 *    email exists or not, including in timing: a miss still performs a hash
 *    verification against a dummy hash.
 *  - **Deletion means deletion.** Removing the `users` row cascades to every
 *    table holding member data, so erasure cannot drift out of sync with the
 *    schema.
 */

export const MINIMUM_AGE = 18;

export type RegistrationInput = {
  email: string;
  password: string;
  displayName: string;
  /** ISO date, YYYY-MM-DD. */
  birthdate: string;
  countryId: string;
  locale?: string;
};

export type RegistrationError =
  | { field: "email"; code: "invalid" | "taken" }
  | { field: "password"; code: PasswordProblem }
  | { field: "displayName"; code: "invalid" }
  | { field: "birthdate"; code: "invalid" | "underage" };

export type RegistrationResult =
  | { ok: true; userId: string }
  | { ok: false; errors: RegistrationError[] };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DISPLAY_NAME = 40;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Whole years old on `asOf`, computed without date-library rounding surprises. */
export function ageOn(birthdate: string, asOf: Date = new Date()): number | null {
  const parts = birthdate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;

  const [year, month, day] = parts;
  const born = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(born.getTime())) return null;
  // Reject a date that rolled over, e.g. 2000-02-31 becoming March 2nd.
  if (born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) return null;
  if (born.getTime() > asOf.getTime()) return null;

  let age = asOf.getUTCFullYear() - year;
  const monthDelta = asOf.getUTCMonth() - (month - 1);
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getUTCDate() < day)) age -= 1;

  return age;
}

export function validateRegistration(input: RegistrationInput): RegistrationError[] {
  const errors: RegistrationError[] = [];

  if (!EMAIL_PATTERN.test(normalizeEmail(input.email))) {
    errors.push({ field: "email", code: "invalid" });
  }

  const passwordProblem = validatePassword(input.password);
  if (passwordProblem) errors.push({ field: "password", code: passwordProblem });

  const name = input.displayName.trim();
  if (name.length === 0 || name.length > MAX_DISPLAY_NAME) {
    errors.push({ field: "displayName", code: "invalid" });
  }

  const age = ageOn(input.birthdate);
  if (age === null) errors.push({ field: "birthdate", code: "invalid" });
  else if (age < MINIMUM_AGE) errors.push({ field: "birthdate", code: "underage" });

  return errors;
}

export async function register(input: RegistrationInput): Promise<RegistrationResult> {
  const errors = validateRegistration(input);
  if (errors.length > 0) return { ok: false, errors };

  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          birthdate: input.birthdate,
          displayName: input.displayName.trim(),
          locale: input.locale ?? "en"
        })
        .returning({ id: users.id });

      // A member always has a profile and a visibility row, so later code never
      // has to handle their absence.
      await tx.insert(profiles).values({ userId: created.id, countryId: input.countryId });
      await tx.insert(profileVisibility).values({ userId: created.id });

      return { ok: true as const, userId: created.id };
    });
  } catch (error) {
    // The unique index is the authority on whether an email is taken; checking
    // first would leave a race between the check and the insert.
    if (isUniqueViolation(error)) {
      return { ok: false, errors: [{ field: "email", code: "taken" }] };
    }
    throw error;
  }
}

/**
 * Postgres unique-violation check.
 *
 * Drizzle wraps driver errors, so the SQLSTATE lives on the cause rather than
 * the error we catch. Walking the chain means this keeps working whether or not
 * a given call path wraps.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object" && "code" in current && current.code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * A valid argon2id hash of a random value, used to equalise timing when an
 * email doesn't exist. Without this, a failed lookup returns measurably faster
 * than a wrong password and leaks which emails are registered.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`nonexistent-${Math.random()}`);
  return dummyHashPromise;
}

export async function authenticate(
  email: string,
  password: string
): Promise<{ userId: string } | null> {
  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      deletedAt: users.deletedAt,
      suspendedAt: users.suspendedAt
    })
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  const row = rows[0];

  // Deleted and suspended accounts fail exactly like a wrong password, and take
  // the same time to do it — the response must not reveal an account's state.
  if (!row || row.deletedAt || row.suspendedAt) {
    await verifyPassword(await dummyHash(), password);
    return null;
  }

  const valid = await verifyPassword(row.passwordHash, password);
  return valid ? { userId: row.id } : null;
}

export async function changePassword(userId: string, newPassword: string): Promise<boolean> {
  if (validatePassword(newPassword)) return false;

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));

  // Any session an attacker may hold dies with the old password.
  await destroyAllSessions(userId);
  return true;
}

/**
 * Full account deletion. The `users` row cascades to profiles, attributes,
 * visibility, quiz answers, travel plans, likes, matches, blocks, weights,
 * suggestions, and sessions — so this is complete by construction rather than
 * by a list someone maintains. Tested in `accounts.integration.test.ts`.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
