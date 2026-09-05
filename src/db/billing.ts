import { and, eq, lt, ne } from "drizzle-orm";
import { db } from "./client";
import { subscriptions, storeNotifications } from "./schema";
import { subscriptionFor, type VerifiedPurchase } from "@/lib/billing/purchase";
import type { StoreNotification } from "@/lib/billing/notifications";

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
      providerRef: state.providerRef,
      // Same reason as the update branch below: this row reflects the store's
      // answer as of now, and a notification signed before it is stale.
      notifiedAt: now
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
        /**
         * A redemption is fresher than any notification signed before it, and
         * has to say so.
         *
         * This asked the store directly and got its current answer. Leaving
         * `notifiedAt` alone let a notification signed *earlier* than this call
         * still look new to `applyStoreNotification`, which would then apply
         * older data over it — a member who renewed, whose client reconciled,
         * then had a stale "cancelled" notification arrive and downgrade them.
         *
         * The trade-off is that this is our clock where `signedAt` is the
         * store's, so a store running behind us could have a genuinely fresh
         * notification read as stale. That window is seconds and the failure is
         * to skip one message we already have equal-or-better data than; the
         * bug it replaces was applying strictly worse data. The next
         * notification, or the next launch, corrects either way.
         */
        notifiedAt: now,
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

/**
 * How long a handled notification is remembered.
 *
 * Long enough to cover every store's retry window — Apple gives up after about
 * three days, Google's Pub/Sub subscription after seven — with room for an
 * outage on our side, and no longer. The rows have no use once no store will
 * ever send that id again, and keeping them would turn a dedupe log into a
 * permanent record of when each subscription changed.
 */
export const NOTIFICATION_RETENTION_DAYS = 30;

export type NotificationOutcome =
  | { applied: true; userId: string; tier: string; status: string; currentPeriodEnd: Date }
  /**
   * Handled, but nothing written. All three are successes, not failures — the
   * store should stop asking — and they are kept apart because they mean very
   * different things when this path is being debugged.
   *
   *   duplicate            — seen before. Says the retry machinery works.
   *   stale                — describes an older world than the row already
   *                          holds. Says notifications overtook each other.
   *   unknown_subscription — refers to a purchase this deployment has no row
   *                          for. Says a member bought and never redeemed, or
   *                          deleted their account, or the store account is
   *                          shared with another environment.
   */
  | { applied: false; reason: "duplicate" | "stale" | "unknown_subscription" };

/**
 * Applying a store notification whose signature has already been checked.
 *
 * The whole thing is one transaction around a locked subscription row, because
 * every step can race with another delivery of the same notification and with
 * a *different* notification about the same subscription. Without the lock the
 * staleness check reads a value that a concurrent transaction is in the middle
 * of replacing, and the older of two notifications can be the one that lands.
 *
 * The order of the checks is deliberate:
 *
 *  1. **Find the subscription first.** A notification we cannot attach to
 *     anyone is not recorded as handled, so if the member redeems a moment
 *     later a retry can still land. Recording it would close that door
 *     permanently, which is the one mistake here that cannot be recovered from
 *     by trying again.
 *  2. **Then claim the id.** Two concurrent deliveries both reach this and the
 *     primary key picks one; the loser sees its own insert do nothing and stops
 *     rather than repeating the work.
 *  3. **Then check staleness**, and record the claim either way. A late
 *     notification is genuinely handled — the answer is "we already know
 *     better" — and leaving it unrecorded would invite the store to keep
 *     re-delivering something that will never be applied.
 */
export async function applyStoreNotification(
  notification: StoreNotification,
  now: Date = new Date()
): Promise<NotificationOutcome> {
  const { purchase, notificationId, signedAt } = notification;

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        userId: subscriptions.userId,
        notifiedAt: subscriptions.notifiedAt
      })
      .from(subscriptions)
      .where(eq(subscriptions.providerRef, purchase.providerRef))
      .limit(1)
      // Serialises everything below per subscription. This is money; the cost
      // of the lock is one row for the length of one small transaction.
      .for("update");

    const row = existing[0];
    if (!row) return { applied: false as const, reason: "unknown_subscription" as const };

    const claimed = await tx
      .insert(storeNotifications)
      .values({ provider: purchase.provider, notificationId })
      .onConflictDoNothing()
      .returning({ notificationId: storeNotifications.notificationId });

    if (!claimed[0]) return { applied: false as const, reason: "duplicate" as const };

    /**
     * Signed no later than the notification already applied, so it describes a
     * world at least as old as the row. Dropped rather than written.
     *
     * `<=` rather than `<`: two notifications carrying the same signing instant
     * cannot be ordered by this field, and re-applying one of them is the only
     * choice that could move the row backwards. The one already applied stands.
     */
    if (row.notifiedAt && signedAt.getTime() <= row.notifiedAt.getTime()) {
      return { applied: false as const, reason: "stale" as const };
    }

    // The same function the redemption path uses, so a refund cannot mean one
    // thing when the member reports it and another when the store does.
    const state = subscriptionFor(purchase, now);

    await tx
      .update(subscriptions)
      .set({
        tier: state.tier,
        status: state.status,
        currentPeriodEnd: state.currentPeriodEnd,
        provider: state.provider,
        providerRef: state.providerRef,
        notifiedAt: signedAt,
        updatedAt: now
      })
      .where(eq(subscriptions.userId, row.userId));

    /**
     * Pruning rides along on the path that just wrote a row, rather than
     * needing a scheduler this codebase does not have. It is a range delete
     * over an index on a table that grows by one row per subscription event,
     * and it runs only when something was actually applied — so a flood of
     * duplicates does not turn into a flood of deletes.
     */
    await tx
      .delete(storeNotifications)
      .where(
        lt(
          storeNotifications.receivedAt,
          new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000)
        )
      );

    return {
      applied: true as const,
      userId: row.userId,
      tier: state.tier,
      status: state.status,
      currentPeriodEnd: state.currentPeriodEnd
    };
  });
}
