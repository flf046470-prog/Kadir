import { NextResponse } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { todaysFive } from "@/db/daily-suggestions";
import { loadMatchProfile } from "@/db/profile-repository";

/**
 * Today's 5.
 *
 * Unlike Discover, this takes no parameters: the whole point is that the day's
 * list is not something a member can re-roll. Filters, modes and limits would
 * turn it back into a feed, so none are accepted — the selection is made once
 * per day and read back thereafter.
 */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  // A member who has not finished setting up has nothing to match against, and
  // would otherwise get an empty list with no explanation of why.
  const viewer = await loadMatchProfile(auth.user.id);
  if (!viewer) return apiError("profile_not_found", 404);

  const suggestions = await todaysFive(auth.user.id);

  return NextResponse.json(
    { suggestions },
    {
      // The list is fixed for the day, but it is per-member and reflects
      // moderation state, so it must never land in a shared cache.
      headers: { "cache-control": "private, no-store" }
    }
  );
}
