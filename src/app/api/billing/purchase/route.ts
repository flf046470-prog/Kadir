import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { purchaseVerifier, purchasesEnabled } from "@/lib/billing";
import { isStore, tierForProduct } from "@/lib/billing/purchase";
import { recordPurchase } from "@/db/billing";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Redeeming a store purchase.
 *
 * The client hands over what the store gave it — a purchase token on Android,
 * an original transaction id on iOS, a Store ID key on Windows — and this asks
 * that store whether it is real. The token is never trusted on its own: it
 * arrives from a device, and a device is not a source of truth about whether
 * money changed hands.
 *
 * Safe to call repeatedly, and the app should: the client calls it on every
 * launch to reconcile a subscription whose store notification never arrived.
 * `recordPurchase` converges rather than accumulates, so a replay is a no-op.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`purchase:${auth.user.id}`, { max: 20, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  let body: { token?: unknown; productId?: unknown; store?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const productId = typeof body.productId === "string" ? body.productId.trim() : "";
  if (!token || !productId) return apiError("invalid_body", 400);

  /**
   * Which store sold it, said by the client rather than guessed here.
   *
   * A Play purchase token, an Apple transaction id and a Microsoft Store ID key
   * are all opaque strings, so there is nothing to sniff. Asking the wrong
   * store returns "no such purchase", which is indistinguishable from a forged
   * one — so the client names the store, and an unrecognised name is refused
   * before any store is called.
   */
  const store = typeof body.store === "string" ? body.store.trim() : "";
  if (!isStore(store)) return apiError("unknown_store", 400);

  // Configured per store, not per deployment: the same build serves a phone
  // that bought through Play and a PC that bought through Microsoft, and one
  // being open says nothing about the other.
  if (!purchasesEnabled(store)) {
    return NextResponse.json({ available: false, store }, { status: 503 });
  }

  // The product has to be one we sell. Checked before the store call so an
  // unknown id cannot be spent as an API request, and refused rather than
  // defaulted — see `tierForProduct`.
  if (!tierForProduct(productId)) return apiError("unknown_product", 400);

  let verified;
  try {
    verified = await purchaseVerifier(store).verify(token, productId);
  } catch {
    // The store could not be reached. Distinct from a refusal, because this
    // one is worth retrying and the client should.
    return apiError("verification_unavailable", 502);
  }

  if (!verified) return apiError("invalid_purchase", 402);

  const result = await recordPurchase(auth.user.id, verified);
  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json({
    available: true,
    tier: result.tier,
    status: result.status,
    currentPeriodEnd: result.currentPeriodEnd.toISOString()
  });
}
