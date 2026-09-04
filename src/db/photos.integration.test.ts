import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";
import { createTestUser, resetDatabase } from "./test-helpers";
import {
  approvePhoto,
  canServe,
  deletePhoto,
  listVisiblePhotos,
  listVisiblePhotosFor,
  pendingPhotos,
  rejectPhoto,
  uploadPhoto,
  MAX_PHOTOS_PER_USER
} from "./photos";
import { hasExif, processUpload, sniffFormat, MIN_DIMENSION } from "@/lib/photos/process";
import { setStorageDriver } from "@/lib/storage";
import { LocalStorageDriver } from "@/lib/storage/local";

const TEST_ROOT = join(process.cwd(), ".storage-test");

beforeEach(async () => {
  await resetDatabase();
  setStorageDriver(new LocalStorageDriver(TEST_ROOT));
});

afterAll(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
  setStorageDriver(null);
});

/** A valid JPEG carrying EXIF, including GPS coordinates. */
async function photoWithGps(size = 800): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 200, g: 120, b: 150 } }
  })
    // sharp's `Exif` type names only the IFD blocks, but it passes any group
    // straight to exiftool, and GPS is the one this test exists to strip.
    .withExif({
      IFD0: { Copyright: "Test" },
      GPS: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" }
    } as Parameters<Sharp["withExif"]>[0])
    .jpeg()
    .toBuffer();
}

async function plainPhoto(width = 800, height = 800): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 90, b: 200 } }
  })
    .jpeg()
    .toBuffer();
}

describe("format sniffing", () => {
  it("identifies formats from magic bytes, not the declared type", async () => {
    expect(sniffFormat(await plainPhoto())).toBe("jpeg");
    expect(
      sniffFormat(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } }).png().toBuffer())
    ).toBe("png");
  });

  it("rejects a non-image whatever it claims to be", () => {
    // A shell script that a client might upload as image/jpeg.
    expect(sniffFormat(Buffer.from("#!/bin/sh\nrm -rf /\n"))).toBeNull();
    expect(sniffFormat(Buffer.from("<?php system($_GET['c']); ?>"))).toBeNull();
  });
});

describe("processing", () => {
  it("strips EXIF, including GPS coordinates", async () => {
    const original = await photoWithGps();
    expect(await hasExif(original)).toBe(true);

    const result = await processUpload(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The whole point: a phone photo's location must not survive onto a profile.
    expect(await hasExif(result.photo.body)).toBe(false);
  });

  it("re-encodes to webp", async () => {
    const result = await processUpload(await plainPhoto());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.photo.contentType).toBe("image/webp");
    expect(sniffFormat(result.photo.body)).toBe("webp");
  });

  it("caps dimensions while keeping the aspect ratio", async () => {
    const result = await processUpload(await plainPhoto(4000, 2000));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.photo.width).toBeLessThanOrEqual(2048);
    expect(result.photo.height).toBeLessThanOrEqual(2048);
    expect(result.photo.width / result.photo.height).toBeCloseTo(2, 1);
  });

  it("rejects images below the minimum size", async () => {
    const result = await processUpload(await plainPhoto(MIN_DIMENSION - 50, MIN_DIMENSION - 50));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_small");
  });

  it("rejects corrupt and non-image input", async () => {
    const notAnImage = await processUpload(Buffer.from("definitely not an image"));
    expect(notAnImage.ok).toBe(false);
    if (!notAnImage.ok) expect(notAnImage.reason).toBe("unsupported_format");

    // Valid header, truncated body.
    const truncated = (await plainPhoto()).subarray(0, 40);
    const result = await processUpload(truncated);
    expect(result.ok).toBe(false);
  });

  it("gives identical bytes the same hash", async () => {
    const source = await plainPhoto();
    const [first, second] = await Promise.all([processUpload(source), processUpload(source)]);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.photo.hash).toBe(second.photo.hash);
  });
});

describe("upload and visibility", () => {
  it("stores an uploaded photo as pending", async () => {
    const userId = await createTestUser();
    const result = await uploadPhoto(userId, await plainPhoto());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.photo.moderationStatus).toBe("pending");
  });

  it("hides a pending photo from everyone but its owner", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    await uploadPhoto(owner, await plainPhoto());

    expect(await listVisiblePhotos(owner, owner)).toHaveLength(1);
    expect(await listVisiblePhotos(owner, stranger)).toHaveLength(0);
    expect(await listVisiblePhotos(owner, null)).toHaveLength(0);
  });

  /**
   * The batched form is what every multi-member screen actually calls, so its
   * visibility rule has to be the *same* rule, not a similar one. One predicate
   * covering "approved, or the viewer's own" is easy to get subtly wrong in the
   * direction that leaks, so this asserts both halves in a single call.
   */
  it("applies the same visibility rule when asked about many members at once", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const stranger = await createTestUser();

    await uploadPhoto(owner, await plainPhoto());
    const approved = await uploadPhoto(other, await plainPhoto(801));
    if (!approved.ok) throw new Error("expected ok");
    await approvePhoto(approved.photo.id);

    const asStranger = await listVisiblePhotosFor([owner, other], stranger);
    expect(asStranger.get(owner)).toHaveLength(0);
    expect(asStranger.get(other)).toHaveLength(1);

    // The owner still sees their own unapproved photo — in the same call that
    // withholds it from everyone else.
    const asOwner = await listVisiblePhotosFor([owner, other], owner);
    expect(asOwner.get(owner)).toHaveLength(1);
    expect(asOwner.get(other)).toHaveLength(1);

    const signedOut = await listVisiblePhotosFor([owner, other], null);
    expect(signedOut.get(owner)).toHaveLength(0);
    expect(signedOut.get(other)).toHaveLength(1);
  });

  it("gives every member asked about an entry, even with no photos", async () => {
    const nobody = await createTestUser();

    const result = await listVisiblePhotosFor([nobody], nobody);

    // "No photos" and "not asked about" have to stay distinguishable, or a
    // caller cannot tell a member with none from one it forgot to ask about.
    expect(result.has(nobody)).toBe(true);
    expect(result.get(nobody)).toEqual([]);
    expect(await listVisiblePhotosFor([], nobody)).toEqual(new Map());
  });

  it("returns each member's photos in display order", async () => {
    const owner = await createTestUser();
    const first = await uploadPhoto(owner, await plainPhoto());
    const second = await uploadPhoto(owner, await plainPhoto(801));
    if (!first.ok || !second.ok) throw new Error("expected ok");

    const result = await listVisiblePhotosFor([owner], owner);

    expect(result.get(owner)?.map((photo) => photo.position)).toEqual([0, 1]);
  });

  it("shows a photo to others once approved", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();

    const uploaded = await uploadPhoto(owner, await plainPhoto());
    if (!uploaded.ok) throw new Error("expected ok");

    await approvePhoto(uploaded.photo.id);
    expect(await listVisiblePhotos(owner, stranger)).toHaveLength(1);
  });

  it("keeps a rejected photo hidden from others", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();

    const uploaded = await uploadPhoto(owner, await plainPhoto());
    if (!uploaded.ok) throw new Error("expected ok");

    await rejectPhoto(uploaded.photo.id, "does not meet guidelines");
    expect(await listVisiblePhotos(owner, stranger)).toHaveLength(0);
  });

  it("will not serve an unapproved photo to a stranger", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();

    const uploaded = await uploadPhoto(owner, await plainPhoto());
    if (!uploaded.ok) throw new Error("expected ok");

    const key = decodeURIComponent(uploaded.photo.url.replace("/api/photos/", ""));

    expect(await canServe(key, owner)).toBe(true);
    expect(await canServe(key, stranger)).toBe(false);
    expect(await canServe(key, null)).toBe(false);

    await approvePhoto(uploaded.photo.id);
    expect(await canServe(key, stranger)).toBe(true);
  });

  it("caps how many photos a member can upload", async () => {
    const userId = await createTestUser();

    for (let i = 0; i < MAX_PHOTOS_PER_USER; i++) {
      // Vary the image so each upload is distinct content.
      const result = await uploadPhoto(userId, await plainPhoto(800 + i * 10, 800));
      expect(result.ok).toBe(true);
    }

    const overflow = await uploadPhoto(userId, await plainPhoto(1200, 900));
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.reason).toBe("too_many_photos");
  });

  it("lists pending photos for the moderation queue", async () => {
    const userId = await createTestUser();
    await uploadPhoto(userId, await plainPhoto());

    expect(await pendingPhotos()).toHaveLength(1);
  });
});

describe("deletion", () => {
  it("removes the member's own photo", async () => {
    const userId = await createTestUser();
    const uploaded = await uploadPhoto(userId, await plainPhoto());
    if (!uploaded.ok) throw new Error("expected ok");

    expect(await deletePhoto(userId, uploaded.photo.id)).toBe(true);
    expect(await listVisiblePhotos(userId, userId)).toHaveLength(0);
  });

  it("will not let someone delete another member's photo", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();

    const uploaded = await uploadPhoto(owner, await plainPhoto());
    if (!uploaded.ok) throw new Error("expected ok");

    expect(await deletePhoto(stranger, uploaded.photo.id)).toBe(false);
    expect(await listVisiblePhotos(owner, owner)).toHaveLength(1);
  });
});

describe("storage driver", () => {
  it("refuses a key that escapes the storage root", async () => {
    const driver = new LocalStorageDriver(TEST_ROOT);
    await expect(driver.put("../../escaped.webp", Buffer.from("x"), "image/webp")).rejects.toThrow();
  });
});
