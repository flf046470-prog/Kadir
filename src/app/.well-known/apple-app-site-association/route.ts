import { NextResponse } from "next/server";
import { appleAppSiteAssociation } from "@/lib/native/app-links";

/**
 * `/.well-known/apple-app-site-association` — the iOS equivalent.
 *
 * Served with no file extension and as `application/json`, which is what Apple
 * requires; it must also be reachable over HTTPS with no redirect.
 *
 * 404 until `APPLE_TEAM_ID` is set.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const association = appleAppSiteAssociation(process.env.APPLE_TEAM_ID);
  if (!association) return new NextResponse(null, { status: 404 });

  return NextResponse.json(association, {
    headers: { "cache-control": "public, max-age=3600" }
  });
}
