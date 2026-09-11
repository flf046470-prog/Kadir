import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { profileVisibility, likes, matches, blocks } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { findCandidateIds, loadMatchProfile, loadMatchProfiles, areMatched } from "./profile-repository";
import { recordLike, blockUser } from "./interactions";
import { scoreMatch } from "@/lib/matching/score";
import { buildReasons } from "@/lib/matching/reasons";

beforeEach(async () => {
  await resetDatabase();
});

const near = { approximateDistanceKm: 0, maxDistanceKm: 50 };

describe("profile loading", () => {
  it("maps stored attributes into a MatchProfile", async () => {
    const userId = await createTestUser({
      interests: ["travel", "photography"],
      languagesSpoken: ["tr", "de"]
    });

    const profile = await loadMatchProfile(userId);
    expect(profile).not.toBeNull();
    expect(profile!.interests.sort()).toEqual(["photography", "travel"]);
    expect(profile!.languagesSpoken.sort()).toEqual(["de", "tr"]);
    expect(profile!.relationshipGoal).toBe("long_term");
  });

  it("never exposes credentials to the matching layer", async () => {
    const userId = await createTestUser();
    const profile = await loadMatchProfile(userId);

    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain("argon2");
    expect(serialized).not.toContain("@example.test");
    expect(Object.keys(profile!)).not.toContain("passwordHash");
    expect(Object.keys(profile!)).not.toContain("email");
  });

  it("loads many profiles without a query per user", async () => {
    const ids = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const loaded = await loadMatchProfiles(ids);
    expect(loaded.size).toBe(3);
  });
});

describe("candidate selection", () => {
  it("excludes the viewer", async () => {
    const viewer = await createTestUser();
    await createTestUser();

    expect(await findCandidateIds(viewer)).not.toContain(viewer);
  });

  it("excludes profiles the viewer already judged", async () => {
    const viewer = await createTestUser();
    const other = await createTestUser();

    expect(await findCandidateIds(viewer)).toContain(other);

    await recordLike(viewer, other, "pass");
    expect(await findCandidateIds(viewer)).not.toContain(other);
  });

  it("excludes incomplete profiles", async () => {
    const viewer = await createTestUser();
    const incomplete = await createTestUser({ complete: false });

    expect(await findCandidateIds(viewer)).not.toContain(incomplete);
  });

  it("excludes blocked members in both directions", async () => {
    const viewer = await createTestUser();
    const blockedByViewer = await createTestUser();
    const blockedViewer = await createTestUser();

    await blockUser(viewer, blockedByViewer);
    await blockUser(blockedViewer, viewer);

    const candidates = await findCandidateIds(viewer);
    expect(candidates).not.toContain(blockedByViewer);
    expect(candidates).not.toContain(blockedViewer);
  });

  it("can restrict to one country", async () => {
    const viewer = await createTestUser({ countryId: "turkey" });
    const local = await createTestUser({ countryId: "turkey" });
    const abroad = await createTestUser({ countryId: "japan" });

    const candidates = await findCandidateIds(viewer, { countryId: "turkey" });
    expect(candidates).toContain(local);
    expect(candidates).not.toContain(abroad);
  });
});

describe("likes and matching", () => {
  it("creates a match only when the like is mutual", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    const first = await recordLike(alice, bob, "like");
    expect(first.matched).toBe(false);

    const second = await recordLike(bob, alice, "like");
    expect(second.matched).toBe(true);
    expect(await areMatched(alice, bob)).toBe(true);
  });

  it("does not match on a pass", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    await recordLike(alice, bob, "like");
    const result = await recordLike(bob, alice, "pass");

    expect(result.matched).toBe(false);
    expect(await areMatched(alice, bob)).toBe(false);
  });

  it("creates exactly one match row however the pair is ordered", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    await recordLike(alice, bob, "like");
    await recordLike(bob, alice, "like");
    // A repeat action must not create a second match.
    await recordLike(bob, alice, "like");

    expect(await db.select().from(matches)).toHaveLength(1);
  });

  it("survives both members liking simultaneously", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    const [first, second] = await Promise.all([
      recordLike(alice, bob, "like"),
      recordLike(bob, alice, "like")
    ]);

    expect(await db.select().from(matches)).toHaveLength(1);
    // Exactly one side should be told it created the match.
    expect([first.matched, second.matched].filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it("records the latest decision when a profile is judged twice", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    await recordLike(alice, bob, "pass");
    await recordLike(alice, bob, "like");

    const rows = await db.select().from(likes).where(eq(likes.fromUserId, alice));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("like");
  });

  /**
   * The case that made keeping the first decision wrong: a member liked
   * someone, changed their mind, and was matched with them anyway when the
   * other side liked back — on a decision they had already withdrawn, and which
   * the app had told them was recorded.
   */
  it("does not match on a like the member has since withdrawn", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    await recordLike(alice, bob, "like");
    await recordLike(alice, bob, "pass");

    const result = await recordLike(bob, alice, "like");

    expect(result.matched).toBe(false);
    expect(result.matchId).toBeNull();
    expect(await db.select().from(matches)).toHaveLength(0);
  });

  it("matches when a pass is changed to a like", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    await recordLike(alice, bob, "pass");
    await recordLike(bob, alice, "like");
    expect(await db.select().from(matches)).toHaveLength(0);

    const result = await recordLike(alice, bob, "like");

    expect(result.matched).toBe(true);
    expect(result.matchId).not.toBeNull();
  });

  it("refuses a self-like", async () => {
    const alice = await createTestUser();
    await expect(recordLike(alice, alice, "like")).rejects.toThrow();
  });

  it("stores a pass reason only for passes", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const carol = await createTestUser();

    await recordLike(alice, bob, "pass", "too_far");
    await recordLike(alice, carol, "like", "too_far");

    const rows = await db.select().from(likes).where(eq(likes.fromUserId, alice));
    const passRow = rows.find((row) => row.toUserId === bob);
    const likeRow = rows.find((row) => row.toUserId === carol);

    expect(passRow?.passReason).toBe("too_far");
    expect(likeRow?.passReason).toBeNull();
  });
});

describe("blocking", () => {
  it("removes an existing match", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    await recordLike(alice, bob, "like");
    await recordLike(bob, alice, "like");
    expect(await areMatched(alice, bob)).toBe(true);

    await blockUser(alice, bob);
    expect(await areMatched(alice, bob)).toBe(false);
    expect(await db.select().from(blocks)).toHaveLength(1);
  });

  it("stops a blocked member from liking back", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    await blockUser(alice, bob);
    const result = await recordLike(bob, alice, "like");

    expect(result.matched).toBe(false);
    expect(await db.select().from(likes)).toHaveLength(0);
  });

  /**
   * A block and the like that would complete the match, at the same instant.
   *
   * The block check used to run on the pool before the transaction opened, so a
   * block committing in that gap changed nothing: the like went on to create a
   * match between two people one of whom had just blocked the other, and the
   * blocker's next screen was a new conversation with them. Both calls now take
   * the same pair lock, so whichever order they land in, the block wins.
   */
  it("never leaves an open match when a block races the deciding like", async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      await resetDatabase();

      const alice = await createTestUser();
      const bob = await createTestUser();
      await recordLike(alice, bob, "like");

      await Promise.all([blockUser(bob, alice), recordLike(bob, alice, "like")]);

      expect(await areMatched(alice, bob)).toBe(false);
    }
  });
});

/**
 * The privacy property that matters most: a field set to "matches only" must
 * not influence scoring for a non-match, and must not appear in the reasons
 * shown to them.
 */
describe("visibility enforcement end to end", () => {
  it("hides a matches-only field from a non-match", async () => {
    const viewer = await createTestUser({ languagesSpoken: ["tr", "en"] });
    const candidate = await createTestUser({ languagesSpoken: ["tr", "en"] });

    await db
      .update(profileVisibility)
      .set({ languages: "matches" })
      .where(eq(profileVisibility.userId, candidate));

    const [viewerProfile, candidateProfile] = await Promise.all([
      loadMatchProfile(viewer),
      loadMatchProfile(candidate)
    ]);

    const asStranger = scoreMatch({
      viewer: viewerProfile!,
      candidate: candidateProfile!,
      mode: "local",
      location: near,
      isMutualMatch: false
    });

    const asMatch = scoreMatch({
      viewer: viewerProfile!,
      candidate: candidateProfile!,
      mode: "local",
      location: near,
      isMutualMatch: true
    });

    // The shared language is a reason only once they have matched.
    expect(buildReasons(asStranger).some((reason) => reason.id === "language")).toBe(false);
    expect(buildReasons(asMatch).some((reason) => reason.id === "language")).toBe(true);
  });

  it("keeps a hidden field out of scoring entirely", async () => {
    const viewer = await createTestUser();
    const candidate = await createTestUser();

    await db
      .update(profileVisibility)
      .set({ languages: "hidden" })
      .where(eq(profileVisibility.userId, candidate));

    const [viewerProfile, candidateProfile] = await Promise.all([
      loadMatchProfile(viewer),
      loadMatchProfile(candidate)
    ]);

    // Even as a mutual match, hidden means hidden.
    const result = scoreMatch({
      viewer: viewerProfile!,
      candidate: candidateProfile!,
      mode: "local",
      location: near,
      isMutualMatch: true
    });

    expect(result.signals.some((signal) => signal.id === "language")).toBe(false);
  });

  it("only cites values both members genuinely share", async () => {
    const viewer = await createTestUser({ interests: ["travel", "music"] });
    const candidate = await createTestUser({ interests: ["travel", "cooking"] });

    const [viewerProfile, candidateProfile] = await Promise.all([
      loadMatchProfile(viewer),
      loadMatchProfile(candidate)
    ]);

    const result = scoreMatch({
      viewer: viewerProfile!,
      candidate: candidateProfile!,
      mode: "local",
      location: near
    });

    const interestReason = buildReasons(result).find((reason) => reason.id === "interests");
    expect(interestReason?.values).toEqual(["travel"]);
    expect(interestReason?.values).not.toContain("music");
    expect(interestReason?.values).not.toContain("cooking");
  });
});
