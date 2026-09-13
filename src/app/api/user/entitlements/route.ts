import { NextResponse } from "next/server";
import { requireUser, isUnauthorized } from "@/auth/guard";
import {
  entitlementsOf,
  likeAllowance,
  translationAllowance,
  virtualDateAllowance
} from "@/db/entitlements";
import { enabledFeaturesFor } from "@/lib/flags/server";

export const dynamic = "force-dynamic";

/**
 * What this member may do, in one request.
 *
 * Every client asks the same question at launch — web, the Capacitor shells,
 * and eventually a VR client that cannot share a React hook with any of them.
 * Before this, each surface worked it out from whatever it happened to have:
 * the pages read `entitlementsOf` server-side and the native shells had no way
 * to ask at all. One endpoint means one answer, and a client that disagrees
 * with the server is a client that is out of date rather than one that is
 * reading a different table.
 *
 * **The client is told, not asked.** Nothing here is a permission the caller
 * can assert; every gate that spends money or grants access re-checks
 * server-side at the moment it acts. This exists so a client can render the
 * right screen — grey out what is not available, show what a limit is, stop
 * offering an upgrade to someone who already bought it — not so it can decide
 * anything. A VR headset is the easiest thing in this product to tamper with,
 * and it will be reading this.
 */
export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const { tier, entitlements } = await entitlementsOf(auth.user.id);

  /**
   * The live counters, alongside the static ceilings.
   *
   * The ceiling on its own is not enough to render with: "15 translations a
   * day" and "you have 2 left" are different screens, and a client that only
   * knows the first has to discover the second by being refused. All three are
   * computed the same way the gates compute them, so what the client shows and
   * what the server enforces cannot drift.
   */
  const [likes, translations, virtualDates] = await Promise.all([
    likeAllowance(auth.user.id),
    translationAllowance(auth.user.id),
    virtualDateAllowance(auth.user.id)
  ]);

  return NextResponse.json(
    {
      plan: tier,
      entitlements,
      allowances: { likes, translations, virtualDates },
      /**
       * Feature flags, so a client can hide what is not rolled out to this
       * member. Names only — the percentages are an operational detail and
       * publishing them would tell every member how large each cohort is.
       */
      features: enabledFeaturesFor(auth.user.id)
    },
    {
      /**
       * Never cached, and never by a shared cache.
       *
       * This is per-member and changes the moment a purchase lands or an
       * allowance is spent. A CDN holding one member's entitlements and serving
       * them to another is the worst possible caching bug in this file.
       */
      headers: { "cache-control": "private, no-store" }
    }
  );
}
