import type { VerifiedPurchase } from "./purchase";

/**
 * What a store tells us, unprompted, when a subscription changes.
 *
 * Redemption answers "did this person pay?" once, at the moment they bought.
 * Everything that happens afterwards — the renewal, the cancellation, the
 * refund, the card that stopped working — happens at the store, and the store
 * is the only party that knows. Without a path for it to say so, the server's
 * picture of who is paying is only ever as fresh as the last time that member
 * opened the app.
 *
 * A refund is the case that matters. `subscriptionFor` already knows a refund
 * ends access immediately rather than at the period end, but nothing ever
 * *told* it: the collections query a refunded member fails is only run when
 * that member turns up, and someone who has taken their money back has no
 * reason to. So the entitlement outlives the payment, quietly, for as long as
 * the period had left.
 */

/**
 * One store notification, once its signature has been checked.
 *
 * The driver returns a whole `VerifiedPurchase` rather than a token to look up,
 * because the stores disagree about whether a second call is even possible.
 * Apple signs the transaction into the notification itself; Google sends a
 * purchase token and expects the Android Publisher API to be called with it;
 * Microsoft's collections query needs a Store ID key that only the *client* can
 * obtain, so a notification about a Windows purchase can never be re-verified
 * the way the redemption path verifies one. Pushing that difference into the
 * driver keeps it from becoming everyone's problem — the same split
 * `PurchaseVerifier` makes.
 *
 * Which means the payload is trusted here, and is only safe because it is
 * trusted *after* a signature check. That check is the whole security boundary
 * of this path, and it belongs to the driver.
 */
export type StoreNotification = {
  /**
   * The store's own id for this notification, for replay protection.
   *
   * Apple's `notificationUUID`, Google's Pub/Sub `messageId`, Microsoft's
   * notification id. Only ever compared, never parsed.
   */
  notificationId: string;
  /**
   * When the *store* signed it, not when it arrived.
   *
   * Notifications are not ordered. Every store says so, and both of the
   * mechanisms involved — retries with backoff, and at-least-once delivery —
   * produce overtakes on their own. Arrival order is therefore not evidence of
   * anything, and this is: a notification signed before the one already applied
   * describes an older world and is dropped rather than written.
   *
   * Without it, a renewal that was retried for an hour lands after the refund
   * that followed it and silently restores an entitlement the member has been
   * paid back for.
   */
  signedAt: Date;
  /** What the store now says this subscription is. */
  purchase: VerifiedPurchase;
};

/**
 * A store that can prove a notification came from it.
 *
 * The same shape as `PurchaseVerifier`, and the same contract on the two
 * failure modes, because collapsing them is a real bug in both directions:
 *
 *   `null`  — the notification is not authentic. Someone posted it. Refuse, and
 *             say so with a 4xx so the sender stops.
 *   throws  — authenticity could not be *established*: the certificate chain
 *             could not be fetched, the store's API did not answer. Retryable,
 *             and the store must be told to retry rather than told it lied.
 *
 * `body` is the raw request text rather than parsed JSON, because every one of
 * these signatures is over bytes. Re-serialising a parsed object changes key
 * order and whitespace, and a signature over the result verifies against
 * nothing.
 */
export type NotificationVerifier = {
  readonly name: string;
  verify(body: string, headers: Headers): Promise<StoreNotification | null>;
};

/**
 * The default: no store is configured, so no notification can be believed.
 *
 * Throwing rather than returning `null` keeps the interface's promise — this is
 * "could not check", not "checked and it was forged" — and the route turns it
 * into "not open" before any of that matters.
 */
export class NoNotificationVerifier implements NotificationVerifier {
  readonly name = "none";

  async verify(): Promise<StoreNotification | null> {
    throw new Error("No notification verifier is configured");
  }
}
