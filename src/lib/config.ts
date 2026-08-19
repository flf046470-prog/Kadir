import "server-only";

/**
 * Integration points. Everything here degrades to "not configured" rather than
 * pretending a service exists — the UI reads these flags to decide whether to
 * show a working control or an honest "not open yet" message.
 */

export type PaymentConfig = {
  enabled: boolean;
  provider: "stripe" | "none";
  currencies: string[];
  defaultCurrency: string;
  presetAmounts: number[];
};

export function getPaymentConfig(): PaymentConfig {
  // The secret key is read on the server only and is never sent to the client.
  const enabled = Boolean(process.env.STRIPE_SECRET_KEY && process.env.SUPPORT_ENABLED === "true");
  const currencies = (process.env.SUPPORT_CURRENCIES ?? "USD,EUR,ARS")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  return {
    enabled,
    provider: enabled ? "stripe" : "none",
    currencies,
    defaultCurrency: currencies[0] ?? "USD",
    presetAmounts: (process.env.SUPPORT_AMOUNTS ?? "10,25,50,100")
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  };
}

/** The Airbnb listing does not exist yet; the button appears only once it does. */
export function getAirbnbUrl(): string {
  const url = (process.env.AIRBNB_URL ?? "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function getEmailProvider(): string {
  return (process.env.EMAIL_PROVIDER ?? "log").trim().toLowerCase();
}
