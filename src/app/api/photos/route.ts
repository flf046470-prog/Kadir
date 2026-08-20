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

  if (!result.ok) return apiError(result.reason, 400);

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
