import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { photos } from "./schema";
import { storage } from "@/lib/storage/local";
import { contentKey } from "@/lib/storage/driver";
import { processUpload, type ProcessError } from "@/lib/photos/process";

/**
 * Profile photos.
 *
 * Visibility fails closed: `listVisiblePhotos` returns only approved photos to
 * anyone but the owner, so a photo that has not been screened cannot reach
 * another member even if a UI forgets to filter.
 */

export const MAX_PHOTOS_PER_USER = 6;

export type PhotoRecord = {
  id: string;
  url: string;
  width: number;
  height: number;
  position: number;
  moderationStatus: string;
};

export type UploadResult =
  | { ok: true; photo: PhotoRecord }
  | { ok: false; reason: ProcessError | "too_many_photos" };

export async function uploadPhoto(userId: string, input: Buffer): Promise<UploadResult> {
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(photos)
    .where(eq(photos.userId, userId));

  if ((existing[0]?.count ?? 0) >= MAX_PHOTOS_PER_USER) {
    return { ok: false, reason: "too_many_photos" };
  }

  const processed = await processUpload(input);
  if (!processed.ok) return { ok: false, reason: processed.reason };

  const key = contentKey(processed.photo.hash, processed.photo.extension);
  await storage().put(key, processed.photo.body, processed.photo.contentType);

  const [created] = await db
    .insert(photos)
    .values({
      userId,
      storageKey: key,
      width: processed.photo.width,
      height: processed.photo.height,
      position: existing[0]?.count ?? 0
      // moderationStatus defaults to "pending" — deliberately not set here.
    })
    .returning();

  return {
    ok: true,
    photo: {
      id: created.id,
      url: storage().urlFor(created.storageKey),
      width: created.width,
      height: created.height,
      position: created.position,
      moderationStatus: created.moderationStatus
    }
  };
}

/**
 * Photos of `ownerId` that `viewerId` may see.
 *
 * The owner sees their own pending photos so they know the upload worked and
 * that review is outstanding. Everyone else sees approved photos only.
 */
export async function listVisiblePhotos(
  ownerId: string,
  viewerId: string | null
): Promise<PhotoRecord[]> {
  const isOwner = viewerId === ownerId;

  const rows = await db
    .select()
    .from(photos)
    .where(
      isOwner
        ? eq(photos.userId, ownerId)
        : and(eq(photos.userId, ownerId), eq(photos.moderationStatus, "approved"))
    )
    .orderBy(asc(photos.position));

  return rows.map((row) => ({
    id: row.id,
    url: storage().urlFor(row.storageKey),
    width: row.width,
    height: row.height,
    position: row.position,
    moderationStatus: row.moderationStatus
  }));
}

/** Whether a photo may be served to a given viewer. Used by the media route. */
export async function canServe(storageKey: string, viewerId: string | null): Promise<boolean> {
  const rows = await db
    .select({ userId: photos.userId, status: photos.moderationStatus })
    .from(photos)
    .where(eq(photos.storageKey, storageKey))
    .limit(1);

  const row = rows[0];
  if (!row) return false;
  if (row.status === "approved") return true;

  // Pending and rejected photos are visible to their owner only.
  return row.userId === viewerId;
}

export async function deletePhoto(userId: string, photoId: string): Promise<boolean> {
  const rows = await db
    .delete(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .returning({ storageKey: photos.storageKey });

  const row = rows[0];
  if (!row) return false;

  // Content-addressed keys are shared by identical uploads, so only remove the
  // object when no other row still points at it.
  const stillUsed = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(photos)
    .where(eq(photos.storageKey, row.storageKey));

  if ((stillUsed[0]?.count ?? 0) === 0) {
    await storage().delete(row.storageKey);
  }

  return true;
}

/**
 * Moderator approval.
 *
 * **This is where automated NSFW and CSAM screening must run before public
 * launch.** Nothing in this repository performs that screening; a photo becomes
 * visible to other members only by passing through here, which is why the hook
 * lives at exactly this point.
 */
export async function approvePhoto(photoId: string, note?: string): Promise<void> {
  await db
    .update(photos)
    .set({ moderationStatus: "approved", moderationNote: note ?? null, reviewedAt: new Date() })
    .where(eq(photos.id, photoId));
}

export async function rejectPhoto(photoId: string, note: string): Promise<void> {
  await db
    .update(photos)
    .set({ moderationStatus: "rejected", moderationNote: note, reviewedAt: new Date() })
    .where(eq(photos.id, photoId));
}

/** The moderation queue, oldest first. */
export async function pendingPhotos(limit = 50) {
  return db
    .select()
    .from(photos)
    .where(eq(photos.moderationStatus, "pending"))
    .orderBy(asc(photos.createdAt))
    .limit(limit);
}
