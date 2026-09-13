import { NextResponse } from "next/server";
import { requireUser, isUnauthorized } from "@/auth/guard";
import { linkedPlatforms } from "@/db/platform-accounts";

export const dynamic = "force-dynamic";

/**
 * Which platforms this member has linked.
 *
 * Names and dates only — never the platform id itself. A Steam id is a durable
 * public handle, and putting one in a response that renders on a dating account
 * screen is one screenshot away from linking the two identities in public. The
 * member knows they linked Steam; they do not need the number to be told so.
 */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  return NextResponse.json(
    { platforms: await linkedPlatforms(auth.user.id) },
    { headers: { "cache-control": "private, no-store" } }
  );
}
