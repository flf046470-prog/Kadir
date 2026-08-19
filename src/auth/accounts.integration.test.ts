import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  users,
  profiles,
  profileAttributes,
  profileVisibility,
  likes,
  matches,
  sessions
} from "@/db/schema";
import {
  ageOn,
  authenticate,
  changePassword,
  deleteAccount,
  register,
  validateRegistration
} from "./accounts";
import { createSession, resolveSession, destroySession } from "./session";
import { createTestUser, resetDatabase, uniqueEmail } from "@/db/test-helpers";
import { recordLike } from "@/db/interactions";

beforeEach(async () => {
  await resetDatabase();
});

describe("age check", () => {
  it("computes whole years, not rounded ones", () => {
    const asOf = new Date("2026-06-14T00:00:00Z");
    // Birthday is tomorrow, so still 17.
    expect(ageOn("2008-06-15", asOf)).toBe(17);
    expect(ageOn("2008-06-14", asOf)).toBe(18);
  });

  it("rejects impossible and future dates", () => {
    expect(ageOn("2000-02-31")).toBeNull();
    expect(ageOn("not-a-date")).toBeNull();
    expect(ageOn("2099-01-01")).toBeNull();
  });

  it("refuses registration under 18", () => {
    const errors = validateRegistration({
      email: "a@example.test",
      password: "correct-horse-battery",
      displayName: "Someone",
      birthdate: "2015-01-01",
      countryId: "turkey"
    });
    expect(errors).toContainEqual({ field: "birthdate", code: "underage" });
  });
});

describe("registration", () => {
  it("creates a user with a profile and visibility row", async () => {
    const result = await register({
      email: uniqueEmail(),
      password: "correct-horse-battery",
      displayName: "Ada",
      birthdate: "1990-01-01",
      countryId: "germany"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const profile = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, result.userId));
    const visibility = await db
      .select()
      .from(profileVisibility)
      .where(eq(profileVisibility.userId, result.userId));

    expect(profile).toHaveLength(1);
    expect(visibility).toHaveLength(1);
  });

  it("never stores the password in a readable form", async () => {
    const email = uniqueEmail();
    const password = "correct-horse-battery";
    await register({
      email,
      password,
      displayName: "Ada",
      birthdate: "1990-01-01",
      countryId: "turkey"
    });

    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row.passwordHash).not.toContain(password);
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("rejects a duplicate email regardless of casing", async () => {
    const email = uniqueEmail();
    const base = {
      password: "correct-horse-battery",
      displayName: "Ada",
      birthdate: "1990-01-01",
      countryId: "turkey"
    };

    expect((await register({ ...base, email })).ok).toBe(true);

    const duplicate = await register({ ...base, email: email.toUpperCase() });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors).toContainEqual({ field: "email", code: "taken" });
    }
  });

  it("rejects weak passwords", async () => {
    const result = await register({
      email: uniqueEmail(),
      password: "password123",
      displayName: "Ada",
      birthdate: "1990-01-01",
      countryId: "turkey"
    });
    expect(result.ok).toBe(false);
  });
});

describe("authentication", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const email = uniqueEmail();
    await register({
      email,
      password: "correct-horse-battery",
      displayName: "Ada",
      birthdate: "1990-01-01",
      countryId: "turkey"
    });

    expect(await authenticate(email, "correct-horse-battery")).not.toBeNull();
    expect(await authenticate(email, "wrong-password-here")).toBeNull();
  });

  it("does not reveal whether an email exists", async () => {
    const email = uniqueEmail();
    await register({
      email,
      password: "correct-horse-battery",
      displayName: "Ada",
      birthdate: "1990-01-01",
      countryId: "turkey"
    });

    // Both must be null — an unknown email and a wrong password are the same
    // outcome to the caller.
    expect(await authenticate(email, "wrong-password-here")).toBeNull();
    expect(await authenticate("nobody@example.test", "wrong-password-here")).toBeNull();
  });

  it("is case-insensitive on the email", async () => {
    const email = uniqueEmail();
    await register({
      email,
      password: "correct-horse-battery",
      displayName: "Ada",
      birthdate: "1990-01-01",
      countryId: "turkey"
    });

    expect(await authenticate(email.toUpperCase(), "correct-horse-battery")).not.toBeNull();
  });
});

describe("sessions", () => {
  it("resolves a live session and rejects a destroyed one", async () => {
    const userId = await createTestUser();
    const { token } = await createSession(userId);

    expect((await resolveSession(token))?.id).toBe(userId);

    await destroySession(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const userId = await createTestUser();
    const { token } = await createSession(userId);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toHaveLength(64);
  });

  it("rejects an expired session", async () => {
    const userId = await createTestUser();
    const { token } = await createSession(userId);

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, userId));

    expect(await resolveSession(token)).toBeNull();
  });

  it("revokes every session when the password changes", async () => {
    const userId = await createTestUser();
    const first = await createSession(userId);
    const second = await createSession(userId);

    await changePassword(userId, "a-new-strong-password");

    expect(await resolveSession(first.token)).toBeNull();
    expect(await resolveSession(second.token)).toBeNull();
  });
});

describe("account deletion", () => {
  it("removes every trace of the member", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    // Give Alice data in as many tables as possible before deleting.
    await createSession(alice);
    await recordLike(alice, bob, "like");
    await recordLike(bob, alice, "like");

    const matchesBefore = await db.select().from(matches);
    expect(matchesBefore).toHaveLength(1);

    await deleteAccount(alice);

    const remaining = await Promise.all([
      db.select().from(users).where(eq(users.id, alice)),
      db.select().from(profiles).where(eq(profiles.userId, alice)),
      db.select().from(profileAttributes).where(eq(profileAttributes.userId, alice)),
      db.select().from(profileVisibility).where(eq(profileVisibility.userId, alice)),
      db.select().from(sessions).where(eq(sessions.userId, alice)),
      db.select().from(likes).where(eq(likes.fromUserId, alice)),
      db.select().from(likes).where(eq(likes.toUserId, alice)),
      db.select().from(matches)
    ]);

    for (const rows of remaining) {
      expect(rows).toHaveLength(0);
    }
  });

  it("leaves the other member's account intact", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    await recordLike(alice, bob, "like");

    await deleteAccount(alice);

    const bobRows = await db.select().from(users).where(eq(users.id, bob));
    expect(bobRows).toHaveLength(1);
  });

  it("stops a deleted member's session from working", async () => {
    const userId = await createTestUser();
    const { token } = await createSession(userId);

    await deleteAccount(userId);
    expect(await resolveSession(token)).toBeNull();
  });
});
