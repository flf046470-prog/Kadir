import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * Is this instance able to serve?
 *
 * A readiness probe, not a liveness one: it reaches the database, because an
 * instance that is running but cannot read `users` serves errors to every
 * signed-in member and should be taken out of rotation rather than left in it.
 *
 * **It says almost nothing.** No version, no commit, no environment, no error
 * text — this answers to anyone who can reach the port, and a version string
 * is a free hint about which advisories apply. A load balancer needs a status
 * code; anyone who needs more than that has the logs.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
