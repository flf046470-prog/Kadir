import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { emailVerificationTokens, users } from "@/db/schema";
import { createTestUser, resetDatabase } from "@/db/test-helpers";
import {
  emailVerified,
  issueVerificationToken,
  purgeExpiredVerificationTokens,
  verifyEmailToken
} from "./email-verification";
import { hashToken } from "./session";
import { deleteAccount } from "./accounts";

beforeEach(async () => {
  await resetDatabase();
});

/** The member's own address, read back rather than reconstructed. */
async function emailOf(userId: string): Promise<string> {
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return rows[0].email;
}

async function issueFor(userId: string) {
  return issueVerificationToken(userId, await emailOf(userId));
}

describe("verifying an address", () => {
  it("marks the member verified", async () => {
    const userId = await createTestUser();
    expect(await emailVerified(userId)).toBe(false);

    const { token } = await issueFor(userId);
    const result = await verifyEmailToken(token);

    expect(result).toEqual({ ok: true, userId, alreadyVerified: false });
    expect(await emailVerified(userId)).toBe(true);
  });

  /**
   * The prefetch case, which is the normal case for anybody whose employer
   * scans their mail: the link is fetched by a machine, and the member's own
   * click is the second request. Answering the second one with an error would
   * make the feature look broken to exactly those members.
   */
  it("treats a replayed link as already verified, not as an error", async () => {
    const userId = await createTestUser();
    const { token } = await issueFor(userId);

    await verifyEmailToken(token);
    const [first] = await db
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId));

    const second = await verifyEmailToken(token);

    expect(second).toEqual({ ok: true, userId, alreadyVerified: true });

    // And the original timestamp is untouched: the date somebody first proved
    // they own the address is what answers a dispute, so a second click must
    // not move it forward.
    const [after] = await db
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId));
    expect(after.verifiedAt).toEqual(first.verifiedAt);
  });

  it("stores only the hash, never the token itself", async () => {
    const userId = await createTestUser();
    const { token } = await issueFor(userId);

    const rows = await db
      .select({ tokenHash: emailVerificationTokens.tokenHash })
      .from(emailVerificationTokens);

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].tokenHash).not.toBe(token);
  });

  it("invalidates the previous link when a new one is issued", async () => {
    const userId = await createTestUser();
    const first = await issueFor(userId);
    const second = await issueFor(userId);

    // Pressing resend three times must not leave three working links in three
    // separate mails; the newest is the one that works.
    expect(await verifyEmailToken(first.token)).toEqual({ ok: false, reason: "unknown" });
    expect(await verifyEmailToken(second.token)).toMatchObject({ ok: true });
  });

  /**
   * Issuing a new token clears the unused ones but must not clear the record
   * of a verification that already happened — that row is the one answer to
   * "we never signed up for this", and `purgeExpiredVerificationTokens` keeps
   * it on purpose. Two functions disagreeing about it is the kind of thing
   * nobody notices until the record is needed.
   */
  it("keeps the consumed record when a later token is issued", async () => {
    const userId = await createTestUser();

    const used = await issueFor(userId);
    await verifyEmailToken(used.token);

    await issueFor(userId);

    const rows = await db
      .select({
        tokenHash: emailVerificationTokens.tokenHash,
        consumedAt: emailVerificationTokens.consumedAt
      })
      .from(emailVerificationTokens);

    const consumed = rows.filter((row) => row.consumedAt !== null);
    expect(consumed).toHaveLength(1);
    expect(consumed[0].tokenHash).toBe(hashToken(used.token));
    // And the fresh one is there beside it, unused.
    expect(rows).toHaveLength(2);
  });
});

describe("refusing a link", () => {
  it("refuses an unknown token", async () => {
    expect(await verifyEmailToken("not-a-real-token")).toEqual({
      ok: false,
      reason: "unknown"
    });
  });

  it("refuses an empty token without touching the database", async () => {
    expect(await verifyEmailToken("")).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses an expired token", async () => {
    const userId = await createTestUser();
    const { token } = await issueFor(userId);

    await db
      .update(emailVerificationTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailVerificationTokens.tokenHash, hashToken(token)));

    expect(await verifyEmailToken(token)).toEqual({ ok: false, reason: "expired" });
    expect(await emailVerified(userId)).toBe(false);
  });

  /**
   * The attack this closes: register with a mailbox you control, change the
   * address on the account to somebody else's, then click your own link. The
   * account would end up holding a verified address its owner never consented
   * to — and on a product where the address is the recovery channel, that is
   * an account takeover primitive rather than a cosmetic flaw.
   */
  it("refuses a token issued for an address the account no longer uses", async () => {
    const userId = await createTestUser();
    const { token } = await issueFor(userId);

    await db.update(users).set({ email: "someone.else@example.com" }).where(eq(users.id, userId));

    expect(await verifyEmailToken(token)).toEqual({ ok: false, reason: "email_changed" });
    expect(await emailVerified(userId)).toBe(false);
  });

  /**
   * A deleted account answers exactly as an unknown token does. Telling the
   * two apart would turn this endpoint into a way to ask whether a given
   * account still exists.
   */
  it("refuses a token belonging to a deleted account, indistinguishably", async () => {
    const userId = await createTestUser();
    const { token } = await issueFor(userId);

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));

    expect(await verifyEmailToken(token)).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("housekeeping", () => {
  it("goes away with the account", async () => {
    const userId = await createTestUser();
    await issueFor(userId);

    await deleteAccount(userId);

    expect(await db.select().from(emailVerificationTokens)).toHaveLength(0);
  });

  it("purges expired unused tokens and keeps the consumed ones", async () => {
    const used = await createTestUser();
    const abandoned = await createTestUser();

    const usedToken = await issueFor(used);
    await verifyEmailToken(usedToken.token);

    const abandonedToken = await issueFor(abandoned);
    await db
      .update(emailVerificationTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailVerificationTokens.tokenHash, hashToken(abandonedToken.token)));

    await purgeExpiredVerificationTokens();

    const remaining = await db
      .select({ userId: emailVerificationTokens.userId })
      .from(emailVerificationTokens);

    // The consumed row is the evidence that a given address was verified from a
    // given mail, which is what answers "we never signed up". The expired
    // unused one proves nothing.
    expect(remaining).toEqual([{ userId: used }]);
  });
});
