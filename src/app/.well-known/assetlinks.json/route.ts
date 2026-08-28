import { NextResponse } from "next/server";
import { assetLinks } from "@/lib/native/app-links";

/**
 * `/.well-known/assetlinks.json` — what Android fetches to decide whether this
 * site's links may open the app without asking.
 *
 * 404 until `ANDROID_CERT_FINGERPRINTS` is set. See `lib/native/app-links` for
 * why a placeholder would be worse than nothing.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const links = assetLinks(process.env.ANDROID_CERT_FINGERPRINTS);
  if (!links) return new NextResponse(null, { status: 404 });

  return NextResponse.json(links, {
    headers: {
      // Verification is re-checked rarely; a long cache here is a long time
      // to be wrong, so keep it short enough to fix a mistake the same day.
      "cache-control": "public, max-age=3600"
    }
  });
}
