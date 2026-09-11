import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, isDenied } from "@/auth/moderator";
import { apiError } from "@/auth/guard";
import { isWindowName, productMetrics, windowFor } from "@/db/analytics";

export const dynamic = "force-dynamic";

/**
 * How the product is doing.
 *
 * Admin only, and 404 to everyone else — including moderators, who have a
 * different job. See `requireAdmin` for why those two roles are not ranks of
 * the same one.
 *
 * Everything returned is a count or a rate computed on demand from tables the
 * product already keeps. There is no analytics store to query, nothing is
 * recorded by asking, and no vendor receives anything: the reasoning is in
 * `lib/analytics/metrics.ts`, and it is the reason this endpoint can exist at
 * all for a product holding dating profiles.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (isDenied(auth)) return auth.response;

  /**
   * A fixed set of windows rather than arbitrary dates.
   *
   * Free-form `from` and `to` would turn an aggregate endpoint into a way to
   * narrow a bucket until only one person is in it — ask for a single hour and
   * the suppression threshold protects almost nothing. Three windows answer the
   * questions anyone actually has and cannot be sharpened into a probe.
   */
  const requested = request.nextUrl.searchParams.get("window") ?? "month";
  if (!isWindowName(requested)) return apiError("unknown_window", 400);

  return NextResponse.json(await productMetrics(windowFor(requested)));
}
