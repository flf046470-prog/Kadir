import { NextResponse, type NextRequest } from "next/server";
import { requireUser, isUnauthorized, apiError } from "@/auth/guard";
import { uploadPhoto, listVisiblePhotos, deletePhoto, MAX_PHOTOS_PER_USER } from "@/db/photos";
import { MAX_UPLOAD_BYTES } from "@/lib/photos/process";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET() {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  return NextResponse.json({
    photos: await listVisiblePhotos(auth.user.id, auth.user.id),
    max: MAX_PHOTOS_PER_USER
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const limit = checkRateLimit(`photos:${auth.user.id}`, { max: 20, windowMs: 3_600_000 });
  if (!limit.allowed) return apiError("rate_limited", 429);

  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");

  if (!(file instanceof File)) return apiError("invalid_body", 400);

  // Check the declared size before reading the body into memory.
  if (file.size > MAX_UPLOAD_BYTES) return apiError("too_large", 413);

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await uploadPhoto(auth.user.id, buffer);

  /**
   * 503 for a deployment that cannot screen, 400 for everything else.
   *
   * The member did nothing wrong and retrying with a different photo will not
   * help, so this is the server saying it is not open for uploads — the same
   * distinction `/billing` draws between a refused purchase and an unconfigured
   * store. A 400 would send someone into a loop cropping a photo that was never
   * the problem.
   */
  if (!result.ok) {
    return apiError(result.reason, result.reason === "screening_unavailable" ? 503 : 400);
  }

  return NextResponse.json({ photo: result.photo }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (isUnauthorized(auth)) return auth.response;

  const photoId = request.nextUrl.searchParams.get("id");
  if (!photoId) return apiError("invalid_body", 400);

  const deleted = await deletePhoto(auth.user.id, photoId);
  if (!deleted) return apiError("not_found", 404);

  return NextResponse.json({ ok: true });
}
