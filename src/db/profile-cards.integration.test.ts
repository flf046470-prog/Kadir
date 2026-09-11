import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { profiles, profileVisibility } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { loadProfileCards } from "./profile-cards";
import { ageOn } from "@/lib/domain/age";

/**
 * What one member is allowed to see of another.
 *
 * Every optional field on a card is gated on the subject's own visibility
 * setting, and the gate is here rather than in the component: these tests are
 * what makes "hidden means hidden" a property of the server, not a promise the
 * UI makes.
 */

beforeEach(async () => {
  await resetDatabase();
});

async function setVisibility(
  userId: string,
  values: Partial<typeof profileVisibility.$inferInsert>
) {
  await db.update(profileVisibility).set(values).where(eq(profileVisibility.userId, userId));
}

async function card(subjectId: string, matched: string[] = []) {
  const cards = await loadProfileCards([subjectId], new Set(matched));
  return cards.get(subjectId)!;
}

describe("profile cards", () => {
  it("carries the fields a viewer needs to decide", async () => {
    const subject = await createTestUser({ cityId: "istanbul", countryId: "turkey" });
    await db.update(profiles).set({ bio: "Coffee and long walks." }).where(eq(profiles.userId, subject));

    const result = await card(subject);

    expect(result.displayName).toBe("Test Member");
    expect(result.bio).toBe("Coffee and long walks.");
    expect(result.cityId).toBe("istanbul");
    expect(result.countryId).toBe("turkey");
    expect(result.relationshipGoal).toBe("long_term");
    expect(result.languagesSpoken.sort()).toEqual(["en", "tr"]);
  });

  it("derives age from the birthdate rather than storing it", async () => {
    const birthdate = "1990-03-04";
    const subject = await createTestUser({ birthdate });

    expect((await card(subject)).age).toBe(ageOn(birthdate));
  });

  it("never carries a credential or an email", async () => {
    const subject = await createTestUser();
    const serialised = JSON.stringify(await card(subject));

    expect(serialised).not.toContain("@example.test");
    expect(serialised).not.toContain("argon2");
    expect(Object.keys(await card(subject))).not.toContain("passwordHash");
  });
});

describe("visibility", () => {
  it("withholds location entirely when it is hidden", async () => {
    const subject = await createTestUser({ cityId: "berlin", countryId: "germany" });
    await setVisibility(subject, { location: "hidden" });

    const result = await card(subject);
    expect(result.cityId).toBeNull();
    // The country is part of the same choice: a coarser location is still a
    // location, and "hidden" has to mean hidden.
    expect(result.countryId).toBeNull();
  });

  it("gives a matches-only field to a match and to nobody else", async () => {
    const subject = await createTestUser({ cityId: "berlin" });
    await setVisibility(subject, { location: "matches" });

    expect((await card(subject)).cityId).toBeNull();
    expect((await card(subject, [subject])).cityId).toBe("berlin");
  });

  it("withholds languages when they are hidden", async () => {
    const subject = await createTestUser({ languagesSpoken: ["tr", "de"] });
    await setVisibility(subject, { languages: "hidden" });

    expect((await card(subject)).languagesSpoken).toEqual([]);
  });

  it("withholds the relationship goal when it is hidden", async () => {
    const subject = await createTestUser({ relationshipGoal: "marriage" });
    await setVisibility(subject, { relationshipGoal: "hidden" });

    expect((await card(subject)).relationshipGoal).toBeNull();
  });

  it("applies each subject's own setting, not one setting for the batch", async () => {
    const open = await createTestUser({ cityId: "istanbul" });
    const private_ = await createTestUser({ cityId: "izmir" });
    await setVisibility(private_, { location: "hidden" });

    const cards = await loadProfileCards([open, private_]);

    expect(cards.get(open)!.cityId).toBe("istanbul");
    expect(cards.get(private_)!.cityId).toBeNull();
  });
});

describe("batch loading", () => {
  it("returns nothing for an empty request without querying", async () => {
    expect((await loadProfileCards([])).size).toBe(0);
  });

  it("skips ids that do not exist rather than failing", async () => {
    const subject = await createTestUser();
    const cards = await loadProfileCards([subject, "00000000-0000-0000-0000-000000000000"]);

    expect(cards.size).toBe(1);
    expect(cards.has(subject)).toBe(true);
  });
});
