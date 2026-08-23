import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { translateConversation } from "@/db/translations";
import { translationEnabled } from "@/lib/translate";
import { entitlementsOf } from "@/db/entitlements";
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

  // Two independent reasons there may be no translation: the deployment has no
  // provider, or this member has not paid for it. Both answer "unavailable"
  // rather than distinguishing themselves, because the control is simply
  // absent in either case and a 402 here would tell a free member that the
  // feature exists behind a paywall in a place they never asked.
  const { entitlements } = await entitlementsOf(auth.user.id);
  if (!translationEnabled() || !entitlements.messageTranslation) {
    return NextResponse.json({ available: false, translations: {}, degraded: false });
  }

  const limit = checkRateLimit(`translate:${auth.user.id}`, { max: 30, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const { matchId } = await params;
  const target = request.nextUrl.searchParams.get("to") ?? auth.user.locale ?? "en";

  const result = await translateConversation(auth.user.id, matchId, target);
  if (result === null) return apiError("not_found", 404);

  return NextResponse.json(
    { available: true, ...result },
    { headers: { "cache-control": "private, no-store" } }
  );
}
