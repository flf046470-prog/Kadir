import { NextResponse } from "next/server";
import { getCommunityStats, getVoteTallies } from "@/lib/community";
import { seedIfEmpty } from "@/lib/seed";

export const dynamic = "force-dynamic";

/**
 * Aggregate community numbers for the front end. Counts only — no names, no
 * email addresses, and no per-person records ever leave the server.
 */
export function GET() {
  seedIfEmpty();
  const stats = getCommunityStats();
  const { total, tallies } = getVoteTallies();

  return NextResponse.json(
    {
      feedback: { total, tallies },
      ideas: stats.ideas,
      subscribers: stats.members,
      earlyAccess: stats.earlyAccess,
      countries: stats.countries,
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
