import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { containsForbiddenTrustClaim, earnedBadges, primaryBadge } from "./trust-profile";
import { canTransition, containsForbiddenEmergencyClaim, resolveShare, type DatePlan } from "./date-safety";

describe("trust profile", () => {
  it("only badges verifications that actually completed", () => {
    const badges = earnedBadges([
      { id: "email", verifiedAt: "2026-01-01T00:00:00Z" },
      { id: "phone", verifiedAt: null },
      { id: "photo", verifiedAt: "2026-02-01T00:00:00Z" }
    ]);

    expect(badges).toEqual(["email", "photo"]);
  });

  it("gives an unverified member no badges at all", () => {
    const states = [
      { id: "email" as const, verifiedAt: null },
      { id: "phone" as const, verifiedAt: null }
    ];
    expect(earnedBadges(states)).toEqual([]);
    expect(primaryBadge(states)).toBeNull();
  });

  it("features the strongest earned verification", () => {
    expect(
      primaryBadge([
        { id: "email", verifiedAt: "2026-01-01T00:00:00Z" },
        { id: "identity", verifiedAt: "2026-01-01T00:00:00Z" }
      ])
    ).toBe("identity");
  });
});

describe("date safety", () => {
  const plan: DatePlan = {
    id: "plan-1",
    matchProfileId: "match-1",
    scheduledFor: "2026-09-01T18:00:00Z",
    locationLabel: "Kadıköy, a busy café",
    status: "planned",
    sharedWith: { name: "Ayşe", channel: "sms", destination: "+900000000000" },
    startedAt: null,
    completedAt: null
  };

  it("shares nothing without an explicit opt-in", () => {
    expect(resolveShare(plan, false)).toEqual({ notify: false, fields: [] });
  });

  it("shares nothing when no trusted contact was chosen", () => {
    expect(resolveShare({ ...plan, sharedWith: null }, true).notify).toBe(false);
  });

  it("shares only the agreed fields when opted in", () => {
    const decision = resolveShare(plan, true);
    expect(decision.notify).toBe(true);
    expect(decision.fields).toEqual(["matchFirstName", "scheduledFor", "locationLabel"]);
  });

  it("enforces a sane status lifecycle", () => {
    expect(canTransition("planned", "started")).toBe(true);
    expect(canTransition("started", "completed")).toBe(true);
    expect(canTransition("completed", "started")).toBe(false);
    expect(canTransition("planned", "completed")).toBe(false);
  });
});

/**
 * Copy guard. These claims are product-safety commitments, so they are checked
 * against the shipped source rather than left to review discipline.
 */
describe("copy guards", () => {
  function collectText(dir: string): string {
    let text = "";
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        text += collectText(full);
      } else if (/\.(tsx?|json)$/.test(entry) && !entry.endsWith(".test.ts")) {
        text += readFileSync(full, "utf8");
      }
    }
    return text;
  }

  // Scoped to member-facing copy: translation catalogs, pages, and components.
  // `src/lib/safety` is excluded because it *defines* the forbidden phrases.
  const source = ["i18n/messages", "app", "components"]
    .map((dir) => collectText(join(process.cwd(), "src", dir)))
    .join("\n");

  it("never claims a member is completely safe", () => {
    expect(containsForbiddenTrustClaim(source)).toBe(false);
  });

  it("never presents FioreMatch as an emergency service", () => {
    expect(containsForbiddenEmergencyClaim(source)).toBe(false);
  });

  it("catches the claims it is meant to catch", () => {
    expect(containsForbiddenTrustClaim("This profile is 100% safe")).toBe(true);
    expect(containsForbiddenTrustClaim("Your safety score is 92")).toBe(true);

    expect(containsForbiddenEmergencyClaim("FioreMatch is an emergency service")).toBe(true);
    expect(containsForbiddenEmergencyClaim("We will call the police for you")).toBe(true);
    expect(containsForbiddenEmergencyClaim("We monitor your date in real time")).toBe(true);
  });

  it("still allows pointing members at real emergency services", () => {
    const good = "If you're in immediate danger, contact local emergency services first.";
    expect(containsForbiddenEmergencyClaim(good)).toBe(false);
  });

  it("allows copy that explicitly disclaims the forbidden claim", () => {
    expect(
      containsForbiddenTrustClaim("There is no overall safety score on FioreMatch.")
    ).toBe(false);
    expect(
      containsForbiddenTrustClaim("We never claim any member is guaranteed safe.")
    ).toBe(false);

    expect(
      containsForbiddenEmergencyClaim(
        "FioreMatch is not an emergency service: it does not monitor your date."
      )
    ).toBe(false);
  });
});
