import { describe, expect, it } from "vitest";
import {
  defaultFilters,
  filtersToParams,
  isDefault,
  MAX_AGE,
  MAX_FILTER_VALUES,
  MIN_AGE,
  parseFilters
} from "./filters";

/**
 * Filters come from a member — or from anyone who can type a URL. Everything
 * here is about the boundary: what reaches a query is a value from a closed
 * vocabulary, or it does not reach the query at all.
 */

const parse = (query: string) => parseFilters(new URLSearchParams(query));

describe("parseFilters", () => {
  it("returns the unfiltered set for an empty query", () => {
    expect(parse("")).toEqual(defaultFilters);
    expect(isDefault(parse(""))).toBe(true);
  });

  it("keeps values that are in the taxonomy", () => {
    const filters = parse("goals=marriage,long_term&intents=language_exchange&cultures=turkish");
    expect(filters.relationshipGoals).toEqual(["marriage", "long_term"]);
    expect(filters.matchIntents).toEqual(["language_exchange"]);
    expect(filters.cultureInterests).toEqual(["turkish"]);
  });

  it("drops values that are not, rather than passing them through", () => {
    const filters = parse("goals=marriage,' OR 1=1--,soulmate&intents=<script>&cultures=..%2F..");
    expect(filters.relationshipGoals).toEqual(["marriage"]);
    expect(filters.matchIntents).toEqual([]);
    expect(filters.cultureInterests).toEqual([]);
  });

  it("accepts only two-letter language tags", () => {
    const filters = parse("languages=tr, EN ,english,d,%20,zz9");
    expect(filters.languages).toEqual(["tr", "en"]);
  });

  it("deduplicates and caps list length", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      String.fromCharCode(97 + (index % 26)) + "a"
    ).join(",");
    const filters = parse(`languages=${many}`);

    expect(filters.languages.length).toBeLessThanOrEqual(MAX_FILTER_VALUES);
    expect(new Set(filters.languages).size).toBe(filters.languages.length);
  });

  it("slugifies places so the filter matches what profiles store", () => {
    const filters = parse("countryId=United+States&cityId=%C4%B0stanbul");
    expect(filters.countryId).toBe("united-states");
    expect(filters.cityId).toBe("istanbul");
  });

  it("drops a place that slugifies to nothing", () => {
    expect(parse("countryId=!!!").countryId).toBeNull();
  });

  it("clamps ages into the legal range", () => {
    const under = parse("minAge=13&maxAge=200");
    expect(under.minAge).toBe(MIN_AGE);
    expect(under.maxAge).toBe(MAX_AGE);
  });

  it("never produces a window below the minimum age", () => {
    for (const query of ["minAge=0", "minAge=-40", "minAge=abc", "minAge=17.9"]) {
      expect(parse(query).minAge).toBeGreaterThanOrEqual(MIN_AGE);
    }
  });

  it("orders a reversed range instead of returning an empty one", () => {
    const filters = parse("minAge=50&maxAge=30");
    expect(filters).toMatchObject({ minAge: 30, maxAge: 50 });
  });

  it("falls back to the default range for unparseable ages", () => {
    expect(parse("minAge=&maxAge=")).toMatchObject({ minAge: MIN_AGE, maxAge: MAX_AGE });
    expect(parse("minAge=NaN&maxAge=Infinity")).toMatchObject({
      minAge: MIN_AGE,
      maxAge: MAX_AGE
    });
  });
});

describe("filtersToParams", () => {
  it("omits everything at its default", () => {
    expect(filtersToParams(defaultFilters).toString()).toBe("");
  });

  it("round-trips a filter set through the query string", () => {
    const filters = parse(
      "minAge=25&maxAge=40&countryId=germany&cityId=berlin&languages=de,en&goals=long_term&intents=serious_relationship&cultures=turkish"
    );

    expect(parseFilters(filtersToParams(filters))).toEqual(filters);
  });

  it("marks a set with any narrowing as non-default", () => {
    expect(isDefault(parse("minAge=25"))).toBe(false);
    expect(isDefault(parse("cityId=berlin"))).toBe(false);
    expect(isDefault(parse("goals=marriage"))).toBe(false);
  });
});
