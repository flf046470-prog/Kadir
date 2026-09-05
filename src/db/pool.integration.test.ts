import { describe, expect, it, beforeEach } from "vitest";
import { db } from "./client";
import { subscriptions, virtualDateInvites } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordLike } from "./interactions";
import { inviteToVirtualDate, respondToInvite } from "./virtual-dates";

/**
 * The connection pool is a shared, exhaustible resource, and a transaction that
 * needs a *second* connection while holding its first can deadlock against
 * itself at scale.
 *
 * The shape is easy to write by accident: a charging path opens a transaction,
 * passes its `tx` to an allowance function so the count and the write are
 * atomic — and that function reads the subscription on the pool. Every open
 * transaction then waits for a connection that only another open transaction
 * can release. `DATABASE_POOL_MAX` defaults to ten, so nine concurrent charges
 * are fine and eleven hang the route completely. Nothing below the pool size
 * reveals it, which is exactly why it needs a test that goes above it.
 *
 * Each test here runs more concurrent charges than the pool has connections and
 * asserts they finish. The timeout is the assertion: a deadlocked pool does not
 * fail, it waits forever.
 */

const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 10);
const OVER_POOL = POOL_MAX * 2;
const PATIENCE_MS = 20_000;

beforeEach(async () => {
  await resetDatabase();
});

/** Resolves to "done" only if the work finished; "timeout" means deadlock. */
async function within<T>(work: Promise<T>): Promise<"done" | "timeout"> {
  return Promise.race([
    work.then(() => "done" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), PATIENCE_MS))
  ]);
}

describe("charging paths under pool pressure", () => {
  it("records more concurrent likes than the pool has connections", async () => {
    const me = await createTestUser();
    const targets = await Promise.all(
      Array.from({ length: OVER_POOL }, () => createTestUser())
    );

    const outcome = await within(
      Promise.all(targets.map((target) => recordLike(me, target, "like")))
    );

    expect(outcome).toBe("done");
  }, 40_000);

  it("answers more concurrent virtual date invitations than the pool has connections", async () => {
    const pairs = await Promise.all(
      Array.from({ length: OVER_POOL }, async () => {
        const a = await createTestUser();
        const b = await createTestUser();
        await recordLike(a, b, "like");
        const matched = await recordLike(b, a, "like");
        if (!matched.matchId) throw new Error("expected a match");

        // VIP on both sides: the allowance still runs, it just never refuses,
        // so what is under test is the connection use rather than the ceiling.
        const periodEnd = new Date(Date.now() + 30 * 86_400_000);
        await db.insert(subscriptions).values([
          { userId: a, tier: "vip", status: "active", currentPeriodEnd: periodEnd },
          { userId: b, tier: "vip", status: "active", currentPeriodEnd: periodEnd }
        ]);

        const invite = await inviteToVirtualDate(a, matched.matchId);
        if (!invite.ok) throw new Error("expected an invitation");
        return { b, inviteId: invite.inviteId };
      })
    );

    const outcome = await within(
      Promise.all(pairs.map((pair) => respondToInvite(pair.b, pair.inviteId, "accept")))
    );

    expect(outcome).toBe("done");

    const answered = await db.select().from(virtualDateInvites);
    expect(answered.every((row) => row.status === "accepted")).toBe(true);
  }, 60_000);
});
