import { and, eq, ne } from "drizzle-orm";
import { db } from "./client";
import { subscriptions } from "./schema";
import { subscriptionFor, type VerifiedPurchase } from "@/lib/billing/purchase";

/**
 * Recording a verified store purchase.
 *
 * Everything above this line has already decided *what* the purchase means —
 * `subscriptionFor` turns the store's answer into a row without touching a
 * database. This is only the write, and the write is where the awkward cases
 * live.
 *
 * Both stores deliver the same purchase more than once. Google retries a
 * developer notification until it is acknowledged; Apple resends on its own
 * schedule; and the client calls this again on every launch to reconcile after
 * a notification that never arrived. So this has to be safe to run repeatedly
 * with the same input, and it is: the row is keyed on the member and every
 * field is overwritten from the store's current answer, so a replay converges
 * on the same state rather than accumulating.
 */

export type RecordResult =
  | { ok: true; tier: string; status: string; currentPeriodEnd: Date }
  /**
   * The purchase is already attached to a different account.
   *
   * Not an error to swallow. One subscription entitles one member — that is
   * what the unique index on `provider_ref` enforces — and a token arriving
   * under a second account is either a shared login or someone trying to
   * spread one payment across several. Refusing loudly is the only answer that
   * does not quietly give the product away.
   */
  | { ok: false; reason: "already_redeemed" };

export async function recordPurchase(
  userId: string,
  purchase: VerifiedPurchase,
  now: Date = new Date()
): Promise<RecordResult> {
  const state = subscriptionFor(purchase, now);

  /**
   * Checked before the write rather than caught after it.
   *
   * The unique index would reject this anyway, but as an opaque constraint
   * violation that the caller cannot tell apart from a transient failure —
   * and the difference matters, because one is worth retrying and the other
   * never is.
   */
  const claimed = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(
      and(eq(subscriptions.providerRef, state.providerRef), ne(subscriptions.userId, userId))
    )
    .limit(1);

  if (claimed[0]) return { ok: false, reason: "already_redeemed" };

  await db
    .insert(subscriptions)
    .values({
      userId,
      tier: state.tier,
      status: state.status,
      currentPeriodEnd: state.currentPeriodEnd,
      provider: state.provider,
      providerRef: state.providerRef
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        // Every field comes from the store's current answer. An upgrade from
        // PLUS to VIP, a renewal, a cancellation and a refund all arrive as
        // the same shape of message and all have to land, so none of these is
        // conditional on what was there before.
        tier: state.tier,
        status: state.status,
        currentPeriodEnd: state.currentPeriodEnd,
        provider: state.provider,
        providerRef: state.providerRef,
        updatedAt: now
      }
    });

  return {
    ok: true,
    tier: state.tier,
    status: state.status,
    currentPeriodEnd: state.currentPeriodEnd
  };
}

/**
 * The subscription a store notification refers to.
 *
 * A notification arrives knowing the provider's reference and nothing about
 * our members, which is exactly what the unique index on `provider_ref` is
 * there for.
 */
export async function subscriptionByRef(
  providerRef: string
): Promise<{ userId: string; tier: string; status: string } | null> {
  const rows = await db
    .select({
      userId: subscriptions.userId,
      tier: subscriptions.tier,
      status: subscriptions.status
    })
    .from(subscriptions)
    .where(eq(subscriptions.providerRef, providerRef))
    .limit(1);

  return rows[0] ?? null;
}
