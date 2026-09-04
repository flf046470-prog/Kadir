import { NoPurchaseVerifier, type PurchaseVerifier, type StoreId } from "./purchase";
import { NoNotificationVerifier, type NotificationVerifier } from "./notifications";
import { MicrosoftStoreVerifier } from "./microsoft";

/**
 * The store that verifies a purchase, chosen by which store sold it.
 *
 * One verifier per store rather than one for the deployment: the same build
 * serves a phone that bought through Play and a Windows machine that bought
 * through Microsoft, and the token formats are not distinguishable, so the
 * client says which store it is holding a token for.
 *
 * A store with no credentials configured stays `none`, and the API answers
 * "unavailable" for that store alone — the same shape translation uses when no
 * provider is set, and for the same reason. A half-wired payment path that
 * accepts a token and silently grants nothing is worse than one that says it is
 * not open. Microsoft being configured must not make Play look open.
 *
 * Still unwritten, and unwritten rather than stubbed so nothing reads as done:
 *
 *   google_play  — a service account with the Android Publisher scope, calling
 *                  purchases.subscriptionsv2.get with the purchase token.
 *   app_store    — a signed JWT against the App Store Server API, reading the
 *                  latest transaction for the original transaction id.
 *
 * Both return the same `VerifiedPurchase` the Microsoft driver does, so nothing
 * above this line changes when they land.
 */

let microsoft: PurchaseVerifier | null = null;

function microsoftVerifier(): PurchaseVerifier {
  if (microsoft) return microsoft;

  const tenantId = process.env.MICROSOFT_STORE_TENANT_ID;
  const clientId = process.env.MICROSOFT_STORE_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_STORE_CLIENT_SECRET;

  if (!tenantId && !clientId && !clientSecret) return new NoPurchaseVerifier();

  /**
   * A partial configuration throws instead of falling back.
   *
   * Two of the three set is someone in the middle of wiring this up, and the
   * quiet fallback would be a deploy that believes it sells subscriptions on
   * Windows and refuses every one of them. Storage and translation both fail
   * this way for the same reason.
   */
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "MICROSOFT_STORE_TENANT_ID, MICROSOFT_STORE_CLIENT_ID and MICROSOFT_STORE_CLIENT_SECRET must all be set, or none of them."
    );
  }

  microsoft = new MicrosoftStoreVerifier({
    tenantId,
    clientId,
    clientSecret,
    productIds: parseProductIds(process.env.MICROSOFT_STORE_PRODUCT_IDS)
  });

  return microsoft;
}

/**
 * The optional map from our product ids to the Store's own.
 *
 * Malformed JSON throws rather than being ignored: a mistyped map that is
 * silently dropped means every Windows purchase is refused with no indication
 * of why, which is the hardest possible version of this bug to find.
 */
function parseProductIds(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MICROSOFT_STORE_PRODUCT_IDS is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("MICROSOFT_STORE_PRODUCT_IDS must be a JSON object of id → id");
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      throw new Error(`MICROSOFT_STORE_PRODUCT_IDS["${key}"] is not a string`);
    }
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

export function purchaseVerifier(store: StoreId): PurchaseVerifier {
  if (store === "microsoft_store") return microsoftVerifier();
  return new NoPurchaseVerifier();
}

/** Whether purchases from this store can be verified in this deployment. */
export function purchasesEnabled(store: StoreId): boolean {
  return purchaseVerifier(store).name !== "none";
}

/** Test hook, for swapping a driver in without environment variables. */
export function setPurchaseVerifier(next: PurchaseVerifier | null): void {
  microsoft = next;
}

/**
 * The driver that proves a notification came from a given store.
 *
 * None is written, and none is stubbed. Every one of these is a signature check
 * standing between an unauthenticated public endpoint and the table that
 * decides who is paying, and a driver that returned "authentic" without
 * checking would hand anyone on the internet a VIP subscription — or let them
 * expire someone else's. That is a worse failure than having no endpoint, so
 * the endpoint answers "not open" until a real one exists.
 *
 * What each has to do, so the shape of the work is on the record:
 *
 *   app_store       — App Store Server Notifications V2 arrive as a JWS. Verify
 *                     the `x5c` chain up to Apple's published root, check the
 *                     leaf is Apple's, then read `signedTransactionInfo` (also
 *                     a JWS, verified the same way) for the transaction and
 *                     `signedDate` for `signedAt`.
 *   google_play     — Real-time developer notifications arrive over Pub/Sub
 *                     push, authenticated by the OIDC token in the
 *                     `Authorization` header rather than by a body signature:
 *                     verify it against Google's JWKS and check the audience is
 *                     ours. The message body carries only a purchase token, so
 *                     the driver then calls purchases.subscriptionsv2.get for
 *                     the transaction; `eventTimeMillis` is `signedAt`.
 *   microsoft_store — The collections query cannot be used here: it needs a
 *                     Store ID key that only the client can obtain. Refunds
 *                     come from the clawback API, which is polled rather than
 *                     pushed, so this driver is a poller wearing the same
 *                     interface — or this store keeps having no notification
 *                     path, and refunds on Windows keep being invisible.
 *
 * Each returns the same `StoreNotification`, so nothing above this line changes
 * when one lands.
 */
/**
 * Held per store rather than per deployment, for the reason the purchase
 * verifier gives: one store being wired must not make the others look open.
 * Here that matters more, not less — an endpoint that accepted Play's
 * notifications because Apple's driver exists would be accepting unsigned ones.
 */
const notificationVerifiers: Partial<Record<StoreId, NotificationVerifier>> = {};

export function notificationVerifier(store: StoreId): NotificationVerifier {
  return notificationVerifiers[store] ?? new NoNotificationVerifier();
}

/** Whether this deployment can believe a notification from this store. */
export function notificationsEnabled(store: StoreId): boolean {
  return notificationVerifier(store).name !== "none";
}

/** Test hook, matching `setPurchaseVerifier`. */
export function setNotificationVerifier(
  store: StoreId,
  next: NotificationVerifier | null
): void {
  if (next) notificationVerifiers[store] = next;
  else delete notificationVerifiers[store];
}
