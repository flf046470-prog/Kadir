import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_CODES, negotiateLocale } from "@/lib/i18n";

const LOCALE_COOKIE = "pu_locale";

/** Paths that are served as-is, without a locale prefix. */
const BYPASS = /^\/(?:_next|api|admin|uploads|favicon\.ico|icon\.svg|robots\.txt|sitemap\.xml|opengraph-image)/;

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (BYPASS.test(pathname) || pathname.includes(".")) return NextResponse.next();

  const segments = pathname.split("/");
  const first = segments[1];
  if ((LOCALE_CODES as readonly string[]).includes(first)) {
    const response = NextResponse.next();
    // Remember the visitor's choice so "/" lands them in the same language.
    if (request.cookies.get(LOCALE_COOKIE)?.value !== first) {
      response.cookies.set(LOCALE_COOKIE, first, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    return response;
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale =
    saved && (LOCALE_CODES as readonly string[]).includes(saved)
      ? saved
      : negotiateLocale(request.headers.get("accept-language")) || DEFAULT_LOCALE;

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
