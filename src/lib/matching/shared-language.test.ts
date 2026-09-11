import { describe, expect, it } from "vitest";
import { needsTranslation, sharedLanguages } from "./shared-language";

describe("shared languages", () => {
  it("finds the overlap", () => {
    expect(sharedLanguages(["tr", "en"], ["en", "de"])).toEqual(["en"]);
  });

  it("normalises case, whitespace and regional variants", () => {
    expect(sharedLanguages([" TR "], ["tr-TR"])).toEqual(["tr"]);
    // Someone writing pt-BR and someone writing pt-PT can read each other;
    // treating these as different languages would put a machine between two
    // people who do not need one, and bill for it.
    expect(sharedLanguages(["pt-BR"], ["pt_PT"])).toEqual(["pt"]);
  });

  it("returns nothing when there is no overlap", () => {
    expect(sharedLanguages(["tr"], ["ja"])).toEqual([]);
  });
});

describe("deciding to translate", () => {
  it("turns on for a known mismatch", () => {
    expect(needsTranslation(["tr"], ["ja"])).toBe(true);
  });

  it("stays off when they share a language", () => {
    expect(needsTranslation(["tr", "en"], ["ja", "en"])).toBe(false);
  });

  /**
   * The case that decides whether this feature is trustworthy.
   *
   * An unfilled language list is unknown, not empty. Reading it as "speaks
   * nothing in common" would route the private messages of every member who
   * skipped that field through a third-party translator, without being asked.
   */
  it("treats an unknown list as unknown, not as a mismatch", () => {
    expect(needsTranslation([], ["ja"])).toBe(false);
    expect(needsTranslation(["tr"], [])).toBe(false);
    expect(needsTranslation([], [])).toBe(false);
  });
});
