import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./i18n/locales";
import { publicSiteEnabled } from "./lib/site";

const intl = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
  localeDetection: true
});

/**
 * Paths that stay reachable when the marketing site is switched off.
 *
 * None of these are optional. Google Play refuses a listing without a publicly
 * accessible privacy policy URL, and Apple asks for terms; both have to answer
 * to a browser with no app installed. Sign-in and registration stay because a
 * deep link — a referral link, a push notification opened on a device without
 * the app — can land there, and a 404 would turn an invitation into a dead end.
 *
 * Pricing stays because the app links into it: the locked "who liked you" and
 * "visitors" lists offer an upgrade, and that button pointed at a page this
 * switch had just made 404. It is also where the subscription terms live,
 * which both stores expect a buyer to be able to read. It is product, not
 * marketing.
 */
const ALWAYS_PUBLIC = [
  /^\/legal(\/|$)/,
  /^\/login$/,
  /^\/register$/,
  /^\/pricing$/
];

/** Everything the signed-in product needs, which is the point of the deploy. */
const APP_PATHS = [/^\/app(\/|$)/];

function isMarketing(pathname: string): boolean {
  // Strip the locale segment: /tr/pricing → /pricing
  const withoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "") || "/";

  if (APP_PATHS.some((re) => re.test(withoutLocale))) return false;
  if (ALWAYS_PUBLIC.some((re) => re.test(withoutLocale))) return false;

  // The root is handled by the page itself, which renders a pointer to the
  // stores rather than the marketing home — a 404 on the bare domain looks
  // broken to anyone who types it, reviewers included.
  if (withoutLocale === "/") return false;

  return true;
}

export default function middleware(request: NextRequest) {
  if (!publicSiteEnabled() && isMarketing(request.nextUrl.pathname)) {
    // Rewritten rather than redirected: a redirect would announce that
    // something exists at the original address.
    return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
  }

  return intl(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"]
};
