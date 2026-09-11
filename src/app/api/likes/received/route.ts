import { NextResponse } from "next/server";
import { requireUser, isUnauthorized } from "@/auth/guard";
import { likesReceived } from "@/db/likes-received";
import { loadProfileCards } from "@/db/profile-cards";
import { listVisiblePhotosFor } from "@/db/photos";

export const dynamic = "force-dynamic";

/**
 * Who liked you — PLUS and above.
 *
 * When locked, the response carries the count and no identities at all. Not a
 * blurred list or placeholder rows: anything the client receives is something
 * a member can read out of the network tab, so the gate has to hold on the
 * wire rather than in the rendering.
 */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const received = await likesReceived(auth.user.id);
  if (received.locked) {
    return NextResponse.json({ locked: true, total: received.total, results: [] });
  }

  const ids = received.likes.map((like) => like.userId);
  const cards = await loadProfileCards(ids);
  const photos = await listVisiblePhotosFor(ids, auth.user.id);

  return NextResponse.json({
    locked: false,
    total: received.total,
    results: received.likes.map((like) => ({
      profile: cards.get(like.userId) ?? null,
      photos: photos.get(like.userId) ?? [],
      superLike: like.superLike,
      likedAt: like.likedAt.toISOString()
    }))
  });
}
