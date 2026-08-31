import { NoPurchaseVerifier, type PurchaseVerifier } from "./purchase";

/**
 * The store that verifies purchases, chosen by the deployment.
 *
 * Nothing is configured yet, and that is a deliberate state rather than an
 * oversight: neither store's credentials exist until the publishing accounts
 * do. Until then `purchasesEnabled()` is false and the API answers
 * "unavailable" — the same shape translation uses when no provider is set, and
 * for the same reason. A half-wired payment path that accepts a token and
 * silently grants nothing is worse than one that says it is not open.
 *
 * When the accounts exist, a driver goes here per store:
 *
 *   google_play  — a service account with the Android Publisher scope, calling
 *                  purchases.subscriptionsv2.get with the purchase token.
 *   app_store    — a signed JWT against the App Store Server API, reading the
 *                  latest transaction for the original transaction id.
 *
 * Both return the same `VerifiedPurchase`, so nothing above this line changes
 * when the second one lands.
 */
export function purchaseVerifier(): PurchaseVerifier {
  return new NoPurchaseVerifier();
}

/** Whether a purchase can be verified at all in this deployment. */
export function purchasesEnabled(): boolean {
  return purchaseVerifier().name !== "none";
}
