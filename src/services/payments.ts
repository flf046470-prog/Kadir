import "server-only";

import { getPaymentConfig } from "@/lib/config";

/**
 * Payment architecture without a payment screen.
 *
 * No provider is connected in this release, so `createSupportCheckout` always
 * reports that support is closed. When STRIPE_SECRET_KEY and SUPPORT_ENABLED
 * are set, this is the single place that needs a real implementation — the
 * secret key is read here, on the server, and never reaches the browser.
 */
export type CheckoutRequest = {
  amountMinor: number;
  currency: string;
  displayName?: string;
  email?: string;
  listedConsent: boolean;
  locale: string;
};

export type CheckoutResult =
  | { status: "not_configured" }
  | { status: "error"; message: string }
  | { status: "redirect"; url: string };

export async function createSupportCheckout(
  _request: CheckoutRequest,
): Promise<CheckoutResult> {
  const config = getPaymentConfig();
  if (!config.enabled) return { status: "not_configured" };

  // Intentionally unimplemented: connecting a provider is a separate, reviewed
  // change with its own legal and tax questions. Failing loudly is safer than
  // rendering a checkout that cannot take money.
  return {
    status: "error",
    message: "A payment provider is enabled but no checkout implementation is connected yet.",
  };
}
