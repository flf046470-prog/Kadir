import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { touchPresence } from "@/db/presence";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * "I am typing" / "I have stopped".
 *
 * Its own endpoint rather than a flag on the message poll, because the two run
 * on different clocks: the poll is a steady heartbeat, this fires only while
 * someone is actually at the keyboard.
 *
 * The rate limit is generous but real. The client throttles itself to one ping
 * every few seconds; this is the backstop for a client that does not, since
 * the write lands in the database rather than in memory.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`typing:${auth.user.id}`, { max: 60, windowMs: 60_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const { matchId } = await params;

  let typing = true;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.typing === "boolean") typing = body.typing;
  } catch {
    // A bodyless ping means "still typing", which is the common case.
  }

  const ok = await touchPresence(auth.user.id, matchId, { typing });
  if (!ok) return apiError("not_found", 404);

  return new NextResponse(null, { status: 204 });
}
