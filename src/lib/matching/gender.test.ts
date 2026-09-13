import { describe, expect, it } from "vitest";
import { discoverableBy, hasStatedPreference, type GenderPreference } from "./gender";

const member = (
  gender: GenderPreference["gender"],
  seeking: GenderPreference["seeking"] = []
): GenderPreference => ({ gender, seeking });

describe("who is discoverable by whom", () => {
  it("shows a candidate when both are seeking the other", () => {
    const viewer = member("woman", ["man"]);
    const candidate = member("man", ["woman"]);

    expect(discoverableBy(viewer, candidate)).toBe(true);
  });

  /**
   * The case one-sided filtering gets wrong. The viewer is interested; the
   * candidate could never be. Showing them fills a feed with likes that are
   * dead on arrival, and gives the candidate's side of the product nothing.
   */
  it("hides a candidate who is not seeking the viewer's gender", () => {
    const viewer = member("man", ["man"]);
    const candidate = member("man", ["woman"]);

    expect(discoverableBy(viewer, candidate)).toBe(false);
  });

  it("hides a candidate the viewer is not seeking", () => {
    const viewer = member("woman", ["woman"]);
    const candidate = member("man", ["woman"]);

    expect(discoverableBy(viewer, candidate)).toBe(false);
  });

  it("matches on any of several sought genders", () => {
    const viewer = member("non_binary", ["woman", "non_binary"]);

    expect(discoverableBy(viewer, member("woman", ["non_binary"]))).toBe(true);
    expect(discoverableBy(viewer, member("non_binary", ["non_binary"]))).toBe(true);
    expect(discoverableBy(viewer, member("man", ["non_binary"]))).toBe(false);
  });

  it("includes non-binary members symmetrically", () => {
    const enby = member("non_binary", ["woman"]);
    const woman = member("woman", ["non_binary"]);

    expect(discoverableBy(enby, woman)).toBe(true);
    expect(discoverableBy(woman, enby)).toBe(true);
  });
});

describe("members who have not answered yet", () => {
  /**
   * The migration-safety property. Treating an empty preference as "seeking
   * nobody" would empty Discover for every existing member on the deploy that
   * introduced the field, and the symptom would look like "the app has no
   * users" rather than "a column is null".
   */
  it("lets an unanswered viewer see everyone", () => {
    const viewer = member(null);

    expect(discoverableBy(viewer, member("man", ["woman"]))).toBe(true);
    expect(discoverableBy(viewer, member("non_binary", ["non_binary"]))).toBe(true);
  });

  it("shows an unanswered candidate to everyone", () => {
    const candidate = member(null);

    expect(discoverableBy(member("woman", ["man"]), candidate)).toBe(true);
    expect(discoverableBy(member("man", ["man"]), candidate)).toBe(true);
  });

  it("treats a stated gender with no stated preference as no preference", () => {
    const viewer = member("woman", []);

    expect(discoverableBy(viewer, member("man", ["woman"]))).toBe(true);
    expect(discoverableBy(viewer, member("woman", ["woman"]))).toBe(true);
  });

  it("knows when to ask", () => {
    expect(hasStatedPreference(member("woman", ["man"]))).toBe(true);
    expect(hasStatedPreference(member("woman", []))).toBe(false);
    expect(hasStatedPreference(member(null, ["man"]))).toBe(false);
  });
});
