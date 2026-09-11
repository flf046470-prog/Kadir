import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { listMessages, markRead, sendMessage } from "@/db/messaging";
import { presenceFor, touchPresence } from "@/db/presence";
import { listGifts } from "@/db/gifts";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Conversation messages.
 *
 * A member who is not part of the match gets 404, not 403 — telling a stranger
 * "this conversation exists but isn't yours" confirms a match they have no
 * business knowing about.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { matchId } = await params;
  const messages = await listMessages(auth.user.id, matchId);
  if (messages === null) return apiError("not_found", 404);

  // A poll is not a read. The conversation polls in the background whether or
  // not anyone is looking at it, so marking everything read on every GET would
  // make the receipt the other side sees a lie. The client asserts `seen=1`
  // only while the tab is actually visible.
  const seen = request.nextUrl.searchParams.get("seen") === "1";
  if (seen) {
    await markRead(auth.user.id, matchId);
    await touchPresence(auth.user.id, matchId);
  }

  // Gifts ride along rather than getting their own poll: they belong to the
  // same timeline, and a second request every 2.5 seconds would double the
  // conversation's load to fetch something that changes far less often.
  const [presence, gifts] = await Promise.all([
    presenceFor(auth.user.id, matchId),
    listGifts(auth.user.id, matchId)
  ]);

  return NextResponse.json(
    { messages, gifts: gifts ?? [], presence },
    { headers: { "cache-control": "private, no-store" } }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`messages:${auth.user.id}`, { max: 60, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const { matchId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_body", 400);
  }

  const input = body as Record<string, unknown>;
  if (typeof input.body !== "string") return apiError("invalid_body", 400);

  const result = await sendMessage(
    auth.user.id,
    matchId,
    input.body,
    typeof input.language === "string" ? input.language : undefined
  );

  if (!result.ok) {
    if (result.reason === "not_a_match") return apiError("not_found", 404);
    /**
     * A throttle, not a malformed request.
     *
     * 429 rather than 400 because the message was fine and will be accepted
     * later — and the cap travels in the body so the client can name it. A
     * limit whose size the member cannot see reads as the app being broken,
     * which is the most likely way this feature fails.
     */
    if (result.reason === "new_account_limit") {
      return NextResponse.json({ error: result.reason, limit: result.limit }, { status: 429 });
    }
    return apiError(result.reason, 400);
  }

  // Stop the partner's "typing…" the instant the message lands, rather than
  // leaving it to time out several seconds after it arrived.
  await touchPresence(auth.user.id, matchId, { typing: false });

  return NextResponse.json({ ok: true, messageId: result.messageId }, { status: 201 });
}
