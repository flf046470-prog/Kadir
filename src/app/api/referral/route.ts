import { NextResponse } from "next/server";
import { requireUser, isUnauthorized } from "@/auth/guard";
import { referralOverview } from "@/db/referral";

/**
 * The signed-in member's referral state.
 *
 * There is no POST. Nothing about a referral is claimable — the code is minted
 * on read and rewards are granted when a referee qualifies — so a write
 * endpoint here would only be a way to ask for something the server decides on
 * its own.
 */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const overview = await referralOverview(auth.user.id, {
    baseUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
    locale: auth.user.locale ?? "en"
  });

  return NextResponse.json(overview, {
    // A member's own code and reward ledger, so never a shared cache.
    headers: { "cache-control": "private, no-store" }
  });
}
