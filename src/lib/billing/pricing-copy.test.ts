import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import tr from "@/i18n/messages/tr.json";
import { ENTITLEMENTS, ANNUAL_PRICE_CENTS, TIERS, type Tier } from "./tiers";

/**
 * The pricing page against the entitlement table.
 *
 * Nothing else connects them. `ENTITLEMENTS` is what the app enforces and the
 * pricing copy is a list of strings in a translation file, so the two can
 * disagree indefinitely without a type error, a lint warning, or a failing
 * test — and the disagreement is only ever found by a member who paid for
 * something they already had.
 *
 * That is not hypothetical. Giving free members a translation allowance made
 * `dailyTranslations` a number on every tier, and the pricing page went on
 * listing "in-chat message translation" as a PLUS feature and omitting it from
 * Free entirely. The store listing led on translation at the same time. So the
 * three surfaces said three different things: the listing promised it to
 * everyone, the pricing page sold it as an upgrade, and the code gave it away
 * fifteen times a day.
 *
 * These tests are deliberately about *numbers and unlimitedness* rather than
 * wording. Asserting exact sentences would make every copy edit a test failure,
 * which trains people to update the expectation without reading it.
 */

type PricingCopy = {
  freeFeatures: string[];
  plusFeatures: string[];
  vipFeatures: string[];
  plusPrice: string;
  vipPrice: string;
  freePrice: string;
};

const LOCALES: Record<string, PricingCopy> = {
  en: en.pricing as PricingCopy,
  tr: tr.pricing as PricingCopy
};

const featuresFor = (copy: PricingCopy, tier: Tier): string[] =>
  tier === "free" ? copy.freeFeatures : tier === "plus" ? copy.plusFeatures : copy.vipFeatures;

/** Every number written anywhere in a tier's feature list. */
function numbersIn(lines: string[]): number[] {
  return lines.flatMap((line) => (line.match(/\d+/g) ?? []).map(Number));
}

describe.each(Object.entries(LOCALES))("the %s pricing page", (_locale, copy) => {
  /**
   * The allowance a free member actually has, stated on the page.
   *
   * A limit the product enforces and does not disclose is the one that gets
   * read as a bug: the fifteenth translation stops working and nothing on the
   * page ever said it would.
   */
  it("tells free members how many translations they get", () => {
    const limit = ENTITLEMENTS.free.dailyTranslations;
    expect(limit).not.toBeNull();
    expect(numbersIn(copy.freeFeatures)).toContain(limit);
  });

  /**
   * And does not re-sell it.
   *
   * A paid tier whose list repeats a number is a tier advertising a ceiling it
   * does not have. PLUS and VIP have `dailyTranslations: null`, so whatever
   * their lists say about translation, it must not be fifteen of anything.
   */
  it.each(["plus", "vip"] as const)("does not quote a translation limit on %s", (tier) => {
    expect(ENTITLEMENTS[tier].dailyTranslations).toBeNull();
    expect(numbersIn(featuresFor(copy, tier))).not.toContain(
      ENTITLEMENTS.free.dailyTranslations
    );
  });

  /**
   * The likes ladder, which is the other number the page quotes.
   *
   * Free and PLUS have finite allowances and both are advertised; VIP's is
   * unlimited, so the check is that its list does not quote PLUS's number back
   * at someone paying more than PLUS.
   */
  it("quotes the like allowance each finite tier actually has", () => {
    for (const tier of ["free", "plus"] as const) {
      const limit = ENTITLEMENTS[tier].dailyLikes;
      expect(limit).not.toBeNull();
      expect(numbersIn(featuresFor(copy, tier))).toContain(limit);
    }

    expect(ENTITLEMENTS.vip.dailyLikes).toBeNull();
    expect(numbersIn(copy.vipFeatures)).not.toContain(ENTITLEMENTS.plus.dailyLikes);
  });

  /**
   * The prices, against the constant the stores are configured from.
   *
   * `ANNUAL_PRICE_CENTS` is what the store product tiers must match. The page
   * renders its own string, so a reprice that misses the translation files
   * shows the old number beside the new charge — which is a refund and a
   * one-star review rather than a rendering bug.
   */
  it("prints the price the billing table charges", () => {
    expect(copy.plusPrice).toContain((ANNUAL_PRICE_CENTS.plus / 100).toFixed(2));
    expect(copy.vipPrice).toContain((ANNUAL_PRICE_CENTS.vip / 100).toFixed(2));
    expect(copy.freePrice).toContain("0");
  });

  it("lists something for every tier", () => {
    for (const tier of TIERS) expect(featuresFor(copy, tier).length).toBeGreaterThan(0);
  });
});

/**
 * The two locales against each other.
 *
 * Turkish and English are both fully translated, so a feature added to one and
 * not the other is a member in Istanbul reading a shorter list than a member in
 * London for the same money.
 */
describe("the translated pricing pages", () => {
  it.each(TIERS)("advertise the same number of %s features in both locales", (tier) => {
    expect(featuresFor(LOCALES.tr, tier)).toHaveLength(featuresFor(LOCALES.en, tier).length);
  });
});
