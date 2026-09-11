import { NextResponse } from "next/server";
import { currentUser } from "@/auth/guard";
import { canServe } from "@/db/photos";
import { storage } from "@/lib/storage";

/**
 * Serves a photo.
 *
 * Objects are served through this route rather than a static mount so
 * moderation state is checked on every read. A static directory would make an
 * un-screened photo reachable by anyone who learned its URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);

  const user = await currentUser();
  if (!(await canServe(key, user?.id ?? null))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await storage().get(key);
  if (!body) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": "image/webp",
      // Content-addressed keys never change contents, so this is safe to cache
      // hard — but privately, since visibility depends on the viewer.
      "cache-control": "private, max-age=31536000, immutable"
    }
  });
}
