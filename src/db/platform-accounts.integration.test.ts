import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { subscriptions, userPlatformAccounts, users } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import {
  accountForPlatformIdentity,
  linkPlatformAccount,
  linkedPlatforms,
  touchPlatformLogin,
  unlinkPlatformAccount
} from "./platform-accounts";
import { tierOf } from "./entitlements";
import type { VerifiedPlatformIdentity } from "@/lib/platforms/verifier";

beforeEach(async () => {
  await resetDatabase();
});

/**
 * An identity as a verifier would return it.
 *
 * Constructed directly here because the point of the separation is that this
 * layer never sees a ticket: it takes an already-proved identity, and a test
 * that went through a fake verifier would be testing the fake.
 */
const steam = (id: string): VerifiedPlatformIdentity => ({
  platform: "steam",
  platformUserId: id
});

describe("linking", () => {
  it("attaches a platform identity to the account", async () => {
    const userId = await createTestUser();

    expect(await linkPlatformAccount(userId, steam("76561198000000001"))).toEqual({ ok: true });
    expect(await accountForPlatformIdentity(steam("76561198000000001"))).toBe(userId);
  });

  it("lets one account link several platforms", async () => {
    const userId = await createTestUser();

    await linkPlatformAccount(userId, steam("s-1"));
    await linkPlatformAccount(userId, { platform: "meta", platformUserId: "m-1" });
    await linkPlatformAccount(userId, { platform: "epic", platformUserId: "e-1" });

    const platforms = (await linkedPlatforms(userId)).map((row) => row.platform).sort();
    expect(platforms).toEqual(["epic", "meta", "steam"]);
  });

  /**
   * The rule that makes cross-platform entitlement safe. Without it a Steam
   * account could sit on two FioreMatch accounts, and a purchase made once
   * would follow it to both.
   */
  it("refuses an identity that belongs to another account", async () => {
    const first = await createTestUser();
    const second = await createTestUser();

    await linkPlatformAccount(first, steam("shared"));

    expect(await linkPlatformAccount(second, steam("shared"))).toEqual({
      ok: false,
      reason: "linked_to_another_account"
    });
    // And the original link is untouched — refusing must not move it.
    expect(await accountForPlatformIdentity(steam("shared"))).toBe(first);
  });

  it("is idempotent for the same account and identity", async () => {
    const userId = await createTestUser();

    await linkPlatformAccount(userId, steam("s-1"));
    expect((await linkPlatformAccount(userId, steam("s-1"))).ok).toBe(true);

    expect(await db.select().from(userPlatformAccounts)).toHaveLength(1);
  });

  /**
   * Replacing rather than accumulating: a member who signs in with a different
   * Steam account has one Steam identity, not two, so "which Steam account is
   * this member" keeps having one answer.
   */
  it("replaces the identity when the member switches accounts on a platform", async () => {
    const userId = await createTestUser();

    await linkPlatformAccount(userId, steam("old"));
    await linkPlatformAccount(userId, steam("new"));

    expect(await db.select().from(userPlatformAccounts)).toHaveLength(1);
    expect(await accountForPlatformIdentity(steam("new"))).toBe(userId);
    expect(await accountForPlatformIdentity(steam("old"))).toBeNull();
  });
});

describe("privacy", () => {
  /**
   * A Steam id is a durable public handle. Returning one on the account screen
   * puts it one screenshot away from linking a dating profile to a gaming
   * identity — a deanonymisation the product has no reason to perform.
   */
  it("never returns the platform id", async () => {
    const userId = await createTestUser();
    await linkPlatformAccount(userId, steam("76561198000000001"));

    const [row] = await linkedPlatforms(userId);
    expect(Object.keys(row).sort()).toEqual(["createdAt", "lastLoginAt", "platform"]);
    expect(JSON.stringify(row)).not.toContain("76561198000000001");
  });

  it("does not show one member another's links", async () => {
    const first = await createTestUser();
    const second = await createTestUser();
    await linkPlatformAccount(first, steam("s-1"));

    expect(await linkedPlatforms(second)).toEqual([]);
  });
});

describe("unlinking", () => {
  it("removes the link", async () => {
    const userId = await createTestUser();
    await linkPlatformAccount(userId, steam("s-1"));

    expect(await unlinkPlatformAccount(userId, "steam")).toEqual({ ok: true });
    expect(await linkedPlatforms(userId)).toEqual([]);
  });

  it("reports nothing to unlink", async () => {
    const userId = await createTestUser();
    expect(await unlinkPlatformAccount(userId, "steam")).toEqual({ ok: false });
  });

  /**
   * Entitlement belongs to the account and was paid for. Unlinking says "stop
   * signing me in this way", not "refund me" — and the purchase's own unique
   * reference is what stops the receipt being redeemed again elsewhere, so
   * nothing is carried away either.
   */
  it("leaves the subscription alone", async () => {
    const userId = await createTestUser();
    await db.insert(subscriptions).values({
      userId,
      tier: "vip",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      provider: "steam",
      providerRef: "steam-order-1"
    });
    await linkPlatformAccount(userId, steam("s-1"));

    await unlinkPlatformAccount(userId, "steam");

    expect(await tierOf(userId)).toBe("vip");
  });

  it("frees the identity for a different account afterwards", async () => {
    const first = await createTestUser();
    const second = await createTestUser();

    await linkPlatformAccount(first, steam("shared"));
    await unlinkPlatformAccount(first, "steam");

    expect((await linkPlatformAccount(second, steam("shared"))).ok).toBe(true);
  });
});

describe("sign-in bookkeeping", () => {
  it("records the last platform login", async () => {
    const userId = await createTestUser();
    await linkPlatformAccount(userId, steam("s-1"));

    const later = new Date(Date.now() + 60_000);
    await touchPlatformLogin(userId, "steam", later);

    const [row] = await linkedPlatforms(userId);
    expect(row.lastLoginAt!.getTime()).toBe(later.getTime());
  });
});

describe("account deletion", () => {
  /**
   * Links cascade from `users`, so deleting an account takes them with it. The
   * schema's promise is that erasure is one delete, and a platform identity
   * left behind would be a record of a person who asked to be forgotten.
   */
  it("takes the links with the account", async () => {
    const userId = await createTestUser();
    await linkPlatformAccount(userId, steam("s-1"));

    await db.delete(users).where(eq(users.id, userId));

    expect(await db.select().from(userPlatformAccounts)).toHaveLength(0);
  });
});
