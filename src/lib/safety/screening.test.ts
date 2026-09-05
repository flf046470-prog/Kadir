import { describe, expect, it } from "vitest";
import {
  NoContentClassifier,
  NoHashMatcher,
  screenPhoto,
  screeningConfigured,
  type ClassifierVerdict,
  type ContentClassifier,
  type HashMatch,
  type HashMatcher
} from "./screening";

const IMAGE = Buffer.from("not really an image, and nothing here decodes it");

function matcherReturning(result: HashMatch, name = "fake"): HashMatcher {
  return { name, match: async () => result };
}

function classifierReturning(result: ClassifierVerdict, name = "fake"): ContentClassifier {
  return { name, classify: async () => result };
}

describe("with nothing configured", () => {
  it("sends the photo to a person rather than approving it", async () => {
    const outcome = await screenPhoto(IMAGE, new NoHashMatcher(), new NoContentClassifier());

    expect(outcome.status).toBe("review");
  });

  it("says in the note that neither check ran", async () => {
    const outcome = await screenPhoto(IMAGE, new NoHashMatcher(), new NoContentClassifier());

    if (outcome.status !== "review") throw new Error("expected review");
    expect(outcome.note).toContain("hash:no_hash_matcher_configured");
    expect(outcome.note).toContain("classifier:no_classifier_configured");
  });

  /**
   * The distinction the whole interface rests on. "We checked and it is not on
   * the list" and "we did not check" must never be the same value: the first
   * may one day feed an automatic-approval path and the second never may.
   */
  it("never reports an unrun hash check as a non-match", async () => {
    const result = await new NoHashMatcher().match();

    expect(result).toEqual({ unavailable: true, reason: "no_hash_matcher_configured" });
    expect("matched" in result).toBe(false);
  });

  it("does not count as screened", () => {
    expect(screeningConfigured(new NoHashMatcher(), new NoContentClassifier())).toBe(false);
  });
});

describe("a hash match", () => {
  it("blocks, and names the list it matched", async () => {
    const outcome = await screenPhoto(
      IMAGE,
      matcherReturning({ matched: true, source: "photodna" }),
      classifierReturning({ decision: "clean" })
    );

    expect(outcome).toEqual({ status: "blocked", source: "photodna" });
  });

  /**
   * Order is not an optimisation. Sending known illegal material to a second
   * commercial provider for a second opinion serves no purpose and widens who
   * is handling it.
   */
  it("short-circuits before the classifier is asked", async () => {
    let asked = false;
    const classifier: ContentClassifier = {
      name: "fake",
      classify: async () => {
        asked = true;
        return { decision: "clean" as const };
      }
    };

    await screenPhoto(IMAGE, matcherReturning({ matched: true, source: "photodna" }), classifier);

    expect(asked).toBe(false);
  });

  it("still blocks when the classifier would have called it clean", async () => {
    const outcome = await screenPhoto(
      IMAGE,
      matcherReturning({ matched: true, source: "photodna" }),
      classifierReturning({ decision: "clean" })
    );

    expect(outcome.status).toBe("blocked");
  });
});

describe("the classifier", () => {
  it("rejects what it is confident about", async () => {
    const outcome = await screenPhoto(
      IMAGE,
      matcherReturning({ matched: false }),
      classifierReturning({ decision: "reject", category: "explicit", confidence: 0.97 })
    );

    expect(outcome).toEqual({ status: "rejected", category: "explicit", confidence: 0.97 });
  });

  /**
   * A swimsuit photo at the beach is an ordinary dating profile photo. Treating
   * `suggestive` as a weak `explicit` would reject a large share of legitimate
   * uploads, so it goes to a person instead.
   */
  it("sends suggestive content to a person rather than refusing it", async () => {
    const outcome = await screenPhoto(
      IMAGE,
      matcherReturning({ matched: false }),
      classifierReturning({ decision: "uncertain", category: "suggestive", confidence: 0.61 })
    );

    expect(outcome.status).toBe("review");
    if (outcome.status !== "review") return;
    expect(outcome.note).toContain("classifier:suggestive@0.61");
  });

  it("still only reaches review on a clean verdict", async () => {
    const outcome = await screenPhoto(
      IMAGE,
      matcherReturning({ matched: false }),
      classifierReturning({ decision: "clean" })
    );

    // The most permissive outcome the pipeline can produce. Automatic approval
    // needs a measured false-negative rate on this product's own uploads, and
    // is deliberately not a default.
    expect(outcome.status).toBe("review");
    if (outcome.status !== "review") return;
    expect(outcome.note).toBe("hash:no_match classifier:clean");
  });

  it("records which half was unavailable when only one is wired", async () => {
    const outcome = await screenPhoto(
      IMAGE,
      matcherReturning({ matched: false }),
      new NoContentClassifier()
    );

    if (outcome.status !== "review") throw new Error("expected review");
    expect(outcome.note).toBe("hash:no_match classifier:no_classifier_configured");
  });
});

describe("screeningConfigured", () => {
  /**
   * Half is not "partly screened". A classifier alone does not detect known
   * illegal material; a hash matcher alone does not detect anything that is not
   * already on a list.
   */
  it("needs both halves", () => {
    const matcher = matcherReturning({ matched: false }, "photodna");
    const classifier = classifierReturning({ decision: "clean" }, "sightengine");

    expect(screeningConfigured(matcher, new NoContentClassifier())).toBe(false);
    expect(screeningConfigured(new NoHashMatcher(), classifier)).toBe(false);
    expect(screeningConfigured(matcher, classifier)).toBe(true);
  });
});
