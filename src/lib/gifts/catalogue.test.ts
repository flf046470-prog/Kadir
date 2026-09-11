import { describe, expect, it } from "vitest";
import { GIFTS, giftById, giftIds, isGiftId } from "./catalogue";

describe("the gift catalogue", () => {
  it("has no duplicate ids", () => {
    expect(new Set(giftIds).size).toBe(giftIds.length);
  });

  it("has no duplicate emoji, so two gifts never look identical", () => {
    const emoji = GIFTS.map((gift) => gift.emoji);
    expect(new Set(emoji).size).toBe(emoji.length);
  });

  it("gives every gift something to render", () => {
    for (const gift of GIFTS) expect(gift.emoji.length).toBeGreaterThan(0);
  });

  it("accepts only ids in the catalogue", () => {
    expect(isGiftId("rose")).toBe(true);
    expect(isGiftId("diamond_ring")).toBe(false);
    expect(isGiftId("")).toBe(false);
  });

  it("resolves every id it claims to know", () => {
    for (const id of giftIds) expect(giftById(id).id).toBe(id);
  });

  it("fails loudly rather than rendering nothing for a bad cast", () => {
    expect(() => giftById("yacht" as never)).toThrow("Unknown gift");
  });
});
