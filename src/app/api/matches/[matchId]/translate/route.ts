import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { translateConversation } from "@/db/translations";
import { translationEnabled } from "@/lib/translate";
import { translationAllowance } from "@/db/entitlements";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Translations for one conversation.
 *
 * Separate from the message poll on purpose. Translation is opt-in — it sends
 * what two people wrote to a third party — so it has to be something a member
 * asks for, not something that rides along with every read of the thread.
 *
 * The rate limit is tighter than messaging's because a cache miss here costs
 * real money, not just a database round trip.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  // Only one reason left for translation to be absent: the deployment has no
  // provider configured. Paying is no longer the gate — every member has an
  // allowance, and what a subscription buys is the removal of its ceiling.
  if (!translationEnabled()) {
    return NextResponse.json({
      available: false,
      translations: {},
      degraded: false,
      limitReached: false
    });
  }

  const limit = checkRateLimit(`translate:${auth.user.id}`, { max: 30, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  /**
   * What this call may buy from the provider, resolved before the work.
   *
   * A member already at zero still reaches the translation rather than a 402:
   * everything already cached is theirs to read, and the response says the
   * limit was reached so the conversation can state it once instead of quietly
   * showing untranslated text and looking broken.
   */
  const allowance = await translationAllowance(auth.user.id);
  const budget =
    allowance.limit === null ? null : Math.max(allowance.limit - allowance.used, 0);

  const { matchId } = await params;
  const target = request.nextUrl.searchParams.get("to") ?? auth.user.locale ?? "en";

  const result = await translateConversation(auth.user.id, matchId, target, budget);
  if (result === null) return apiError("not_found", 404);

  return NextResponse.json(
    { available: true, ...result },
    { headers: { "cache-control": "private, no-store" } }
  );
}
