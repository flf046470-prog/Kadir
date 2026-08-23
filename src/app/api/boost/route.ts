import { NextResponse } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { currentBoost, startBoost } from "@/db/entitlements";
import { walletFor } from "@/db/referral";
import { checkRateLimit } from "@/lib/rate-limit";

/** How many boosts this member has, and whether one is running. */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const [running, wallet] = await Promise.all([
    currentBoost(auth.user.id),
    walletFor(auth.user.id)
  ]);

  return NextResponse.json(
    {
      available: wallet.find((entry) => entry.rewardId === "boost")?.quantity ?? 0,
      expiresAt: running?.expiresAt.toISOString() ?? null
    },
    { headers: { "cache-control": "private, no-store" } }
  );
}

/**
 * Starts a Boost.
 *
 * The two refusals are distinct on purpose: "you have none" sends a member to
 * where they can get one, "one is already running" tells them to wait. Folding
 * both into a generic error would make the second look like a failure when it
 * is the feature working.
 */
export async function POST() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`boost:${auth.user.id}`, { max: 10, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const result = await startBoost(auth.user.id);
  if (!result.ok) {
    return apiError(result.reason, result.reason === "none_available" ? 402 : 409);
  }

  return NextResponse.json({ expiresAt: result.expiresAt.toISOString() }, { status: 201 });
}
