import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/auth/guard";
import { notificationsEnabled, notificationVerifier } from "@/lib/billing";
import { isStore } from "@/lib/billing/purchase";
import { applyStoreNotification } from "@/db/billing";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Where a store tells us a subscription changed.
 *
 * **This is the only route in the application that writes without a session.**
 * It has to be: a store has no cookie and no member to act as, and it calls
 * hours after anyone was last online — which is the entire point, because the
 * refund the server needs to hear about arrives long after the member stopped
 * opening the app.
 *
 * What replaces the session is the signature, and nothing else does. So the
 * order below is not stylistic: nothing touches the database, and nothing is
 * believed, until `verify` has said the store signed it.
 *
 * The status codes are addressed to a machine that will retry on some of them
 * and give up on others, which makes them part of the behaviour rather than
 * decoration:
 *
 *   200 — handled. Includes "already seen", "too late to matter", and "not
 *         about anyone here": all three are final answers, and a retry would
 *         reach the same one.
 *   400 — not authentic, or not a store we serve. Retrying cannot fix either,
 *         and this is the answer a forger gets.
 *   503 — no driver is configured for this store, or the check could not be
 *         completed. Both are ours to fix and both are worth retrying, which is
 *         why an unverifiable notification must not be answered like a forged
 *         one: doing that would drop every real notification during an outage
 *         and silently keep refunded members subscribed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store } = await params;

  /**
   * An unknown store is 400 rather than 404.
   *
   * The route exists either way, so a 404 would only be pretending otherwise,
   * and the store list is public — it is on the pricing page. There is nothing
   * here worth hiding, and the honest answer is easier to debug against.
   */
  if (!isStore(store)) return apiError("unknown_store", 400);

  /**
   * A crude flood guard, keyed on the caller rather than on the store.
   *
   * Per-store was wrong and dangerously so: one bucket shared by everyone who
   * can reach the endpoint means any anonymous caller can exhaust it and get
   * the store's own notifications 429'd until it gives up — manufacturing
   * exactly the dropped refund this route exists to prevent. Keying on the
   * caller means an abuser can only starve themselves.
   *
   * The limit is far above what a store produces (one request per subscription
   * event) because the cost of being wrong still runs one way: a limit tight
   * enough to bite would drop real notifications during a renewal surge.
   *
   * `x-forwarded-for` is only as trustworthy as the proxy in front of this, so
   * this is a flood guard and not an access control. The signature is the
   * access control.
   */
  const caller = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const limit = checkRateLimit(`store-notification:${store}:${caller}`, {
    max: 600,
    windowMs: 60_000
  });
  if (!limit.allowed) return apiError("rate_limited", 429);

  if (!notificationsEnabled(store)) {
    return NextResponse.json({ available: false, store }, { status: 503 });
  }

  /**
   * Read as text, not JSON.
   *
   * Every one of these signatures covers the bytes that were sent. Parsing and
   * re-serialising changes key order and whitespace, and a signature checked
   * against the result verifies against nothing — a mistake that fails *open*
   * if the driver is written to be forgiving, which is why the raw body never
   * gets parsed on this side of the boundary at all.
   */
  let body: string;
  try {
    body = await request.text();
  } catch {
    return apiError("invalid_body", 400);
  }

  let notification;
  try {
    notification = await notificationVerifier(store).verify(body, request.headers);
  } catch {
    // Could not check — not "checked and it failed". See the note above on why
    // these two must not share a status code.
    return NextResponse.json({ error: "verification_unavailable" }, { status: 503 });
  }

  // Checked, and it was not signed by this store. Nothing is written, and the
  // sender is told plainly enough to stop.
  if (!notification) return apiError("invalid_signature", 400);

  /**
   * The store named itself in the URL and again in the signed payload. They
   * have to agree, or a notification legitimately signed by one store could be
   * replayed at another store's endpoint — which matters the moment two drivers
   * exist, and costs nothing to refuse now.
   */
  if (notification.purchase.provider !== store) {
    return apiError("provider_mismatch", 400);
  }

  const result = await applyStoreNotification(notification);

  /**
   * One outcome is worth a line in the log, and only one.
   *
   * `duplicate` and `stale` are the retry and ordering machinery working as
   * designed, and logging them would bury the case that matters underneath
   * them. `unknown_subscription` is a store telling us about money that found
   * no home here — rare, and the first thing anyone would want to see if
   * entitlements start looking wrong.
   *
   * The store and the reason, and nothing else. The notification id and the
   * provider reference both point at a person through the store's records, and
   * a log line is the easiest place in a system for an identifier to outlive
   * the account it belonged to.
   */
  if (!result.applied && result.reason === "unknown_subscription") {
    console.warn(`Store notification for an unknown subscription: ${store}`);
  }

  /**
   * The outcome is not echoed back.
   *
   * A store does not read it, and this endpoint answers anyone who can reach
   * the port. Which subscription a notification matched — or that it matched
   * none — is not something to confirm to a caller, because a 200 here cannot
   * tell an authentic store from someone who has just guessed a signature
   * wrong and is watching the reply for a hint.
   */
  return NextResponse.json({ ok: true });
}
