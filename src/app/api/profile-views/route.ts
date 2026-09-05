import { NextResponse } from "next/server";
import { requireUser, isUnauthorized } from "@/auth/guard";
import { recordProfileView, visitorsOf } from "@/db/profile-views";
import { loadProfileCards } from "@/db/profile-cards";
import { listVisiblePhotosFor } from "@/db/photos";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Profile visitors — VIP.
 *
 * Same shape as `/api/likes/received` and the same rule: locked means the
 * count and nothing else crosses the wire.
 */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const visitors = await visitorsOf(auth.user.id);
  if (visitors.locked) {
    return NextResponse.json({ locked: true, total: visitors.total, results: [] });
  }

  const ids = visitors.visitors.map((visitor) => visitor.userId);
  const cards = await loadProfileCards(ids);
  const photos = await listVisiblePhotosFor(ids, auth.user.id);

  return NextResponse.json({
    locked: false,
    total: visitors.total,
    results: visitors.visitors.map((visitor) => ({
      profile: cards.get(visitor.userId) ?? null,
      photos: photos.get(visitor.userId) ?? [],
      viewCount: visitor.viewCount,
      lastViewedAt: visitor.lastViewedAt.toISOString()
    }))
  });
}

/**
 * Records that the signed-in member opened someone's profile.
 *
 * Called when a card becomes the one on screen in Discover, not when it enters
 * the deck: "who looked at me" has to mean someone actually looked, or the
 * list degrades into "everyone you were shown to" and stops being worth
 * reading. The client only calls this while the tab is visible, for the same
 * reason read receipts do — a backgrounded polling tab is not a person
 * looking.
 *
 * Fire-and-forget by design. A failed write loses one row from a convenience
 * surface; it must never take down the feed that triggered it, so the client
 * ignores the response and this returns 204 regardless.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  let subjectId: unknown;
  try {
    subjectId = (await request.json())?.userId;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (typeof subjectId === "string" && UUID.test(subjectId)) {
    // Blocks are enforced on read, not here: refusing to record would leak
    // whether a block exists to whoever is probing this endpoint.
    await recordProfileView(subjectId, auth.user.id).catch(() => {});
  }

  return new NextResponse(null, { status: 204 });
}
