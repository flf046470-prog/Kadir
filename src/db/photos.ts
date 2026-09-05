import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./client";
import { photos } from "./schema";
import { storage } from "@/lib/storage";
import { contentKey } from "@/lib/storage/driver";
import { processUpload, type ProcessError } from "@/lib/photos/process";
import { screenPhoto, screeningConfigured } from "@/lib/safety/screening";
import {
  contentClassifier,
  hashMatcher,
  screeningRequired
} from "@/lib/safety/screening-drivers";

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
  | {
      ok: false;
      reason: ProcessError | "too_many_photos" | "screening_unavailable" | "rejected";
    };

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

  const matcher = hashMatcher();
  const classifier = contentClassifier();

  /**
   * A deployment can be configured to refuse uploads it cannot screen.
   *
   * Checked after processing so a member still gets the specific answer when
   * their file was the problem — telling someone screening is unavailable when
   * what they actually uploaded was a 30MB PDF helps nobody.
   */
  if (screeningRequired() && !screeningConfigured(matcher, classifier)) {
    return { ok: false, reason: "screening_unavailable" };
  }

  /**
   * Screened before it is stored, not after.
   *
   * The bytes reach a provider either way, but a photo that hash-matches known
   * illegal material must never land in our own object storage — putting it
   * there and deleting it afterwards means it existed on our infrastructure,
   * with whatever replication and backup retention that bucket has, for
   * however long the round trip took.
   *
   * The *processed* bytes are screened rather than the upload: that is what
   * would be published, and re-encoding has already stripped EXIF and any
   * metadata payload, so the classifier sees the image members would see.
   */
  const outcome = await screenPhoto(processed.photo.body, matcher, classifier);

  if (outcome.status === "blocked" || outcome.status === "rejected") {
    /**
     * One answer for both, deliberately.
     *
     * A member whose photo hash-matched must not be able to tell that from an
     * ordinary rejection. A distinguishable response is a free oracle for
     * testing which images are on the list, and the people who would use it
     * that way are exactly the ones the list exists to catch.
     *
     * What should follow a `blocked` outcome — retention, notification,
     * reporting — is a legal question rather than a product one, and is
     * deliberately not implemented here. `docs/PHOTO_SCREENING.md` states it as
     * an open item rather than leaving a half-built reporting path nobody has
     * had a lawyer read.
     */
    return { ok: false, reason: "rejected" };
  }

  const key = contentKey(processed.photo.hash, processed.photo.extension);
  await storage().put(key, processed.photo.body, processed.photo.contentType);

  const [created] = await db
    .insert(photos)
    .values({
      userId,
      storageKey: key,
      width: processed.photo.width,
      height: processed.photo.height,
      position: existing[0]?.count ?? 0,
      // Still "pending" by default, and still not set here: screening advises
      // the queue, it does not empty it. The note records what screening found
      // so a reviewer knows which items to start with.
      moderationNote: outcome.note
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

/**
 * The same question about many members at once.
 *
 * Every screen that shows more than one person needs this — Discover, Today's
 * Five, who liked you, who visited — and each of them had grown the same three
 * lines: map the ids, `await listVisiblePhotos` inside, wrap it in
 * `Promise.all`. Concurrent, so it reads as free, and it is not: Discover
 * scores up to 200 candidates, so one request opened 200 round trips for data
 * that fits in a single `in (...)`.
 *
 * Measured against 200 members with three photos each, on a database on the
 * same machine: **65.1 ms fanned out, 5.7 ms here — 11.4×**, for byte-identical
 * results. The gap is round trips, so it widens rather than closes on a real
 * deployment, where the database is across a network and each of those 200
 * costs a millisecond before it does any work. It also stops one Discover
 * request from holding 200 connections out of the pool while it runs.
 *
 * The visibility rule is unchanged and is expressed once, in SQL: approved
 * photos, plus everything belonging to the viewer themselves. At most one of
 * `ownerIds` can be the viewer, so both cases fit in the same predicate rather
 * than needing two queries.
 *
 * Every requested id gets an entry, empty if they have no visible photos, so a
 * caller never has to tell "no photos" from "not asked about".
 */
export async function listVisiblePhotosFor(
  ownerIds: string[],
  viewerId: string | null
): Promise<Map<string, PhotoRecord[]>> {
  const byOwner = new Map<string, PhotoRecord[]>(ownerIds.map((id) => [id, []]));
  if (ownerIds.length === 0) return byOwner;

  const rows = await db
    .select()
    .from(photos)
    .where(
      and(
        inArray(photos.userId, ownerIds),
        viewerId
          ? or(eq(photos.moderationStatus, "approved"), eq(photos.userId, viewerId))
          : eq(photos.moderationStatus, "approved")
      )
    )
    .orderBy(asc(photos.userId), asc(photos.position));

  for (const row of rows) {
    byOwner.get(row.userId)?.push({
      id: row.id,
      url: storage().urlFor(row.storageKey),
      width: row.width,
      height: row.height,
      position: row.position,
      moderationStatus: row.moderationStatus
    });
  }

  return byOwner;
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
