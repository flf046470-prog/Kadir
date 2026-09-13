import { describe, expect, it } from "vitest";
import {
  AWAKE_FROM,
  AWAKE_UNTIL,
  CITY_ZONES,
  COUNTRY_ZONES,
  MULTI_ZONE_COUNTRIES,
  GUARANTEED_OVERLAP_HOURS,
  awakeOverlap,
  hourIn,
  localTimeIn,
  zoneFor
} from "./timezones";

/** A winter instant and a summer one, to catch offset arithmetic. */
const JANUARY = new Date("2027-01-15T12:00:00.000Z");
const JULY = new Date("2027-07-15T12:00:00.000Z");

describe("resolving a zone", () => {
  it("prefers the city, which is the more specific claim", () => {
    // Same country, two zones — only the city can tell them apart.
    expect(zoneFor("new-york", "usa")).toBe("America/New_York");
    expect(zoneFor("los-angeles", "usa")).toBe("America/Los_Angeles");
  });

  it("falls back to the country when the city is unknown", () => {
    expect(zoneFor("kadikoy", "turkey")).toBe("Europe/Istanbul");
  });

  /**
   * The case the whole file is shaped around. Place ids are free text, so most
   * of what arrives here will not be in either map, and a guess would be worse
   * than nothing: the feature exists to answer "are they awake", and a
   * confidently wrong answer replaces one question with a worse one.
   */
  it("returns null rather than guessing", () => {
    expect(zoneFor("bahnhofsviertel", "atlantis")).toBeNull();
    expect(zoneFor(null, null)).toBeNull();
    expect(zoneFor(undefined, undefined)).toBeNull();
  });

  /**
   * A country default would be hours wrong for a large share of these
   * countries' members, so they resolve by city or not at all.
   */
  it.each(MULTI_ZONE_COUNTRIES)("has no country-wide default for %s", (country) => {
    expect(COUNTRY_ZONES[country]).toBeUndefined();
    expect(zoneFor(null, country)).toBeNull();
  });

  it("still resolves a multi-zone country through its cities", () => {
    expect(zoneFor("toronto", "canada")).toBe("America/Toronto");
    expect(zoneFor("vancouver", "canada")).toBe("America/Vancouver");
  });

  /** A city on a different zone from its country's default must win. */
  it("lets a city correct its country's default", () => {
    expect(COUNTRY_ZONES.spain).toBe("Europe/Madrid");
    expect(zoneFor("las-palmas", "spain")).toBe("Atlantic/Canary");
  });
});

describe("every zone in the maps is one the platform knows", () => {
  /**
   * A typo in an IANA name does not throw at import; it throws the first time
   * a member from that place opens a conversation. Checking the whole table
   * here means a bad entry fails in CI instead.
   */
  it.each(Object.entries(COUNTRY_ZONES))("resolves the country zone %s → %s", (_country, zone) => {
    expect(hourIn(zone, JANUARY)).not.toBeNull();
  });

  it.each(Object.entries(CITY_ZONES))("resolves the city zone %s → %s", (_city, zone) => {
    expect(hourIn(zone, JANUARY)).not.toBeNull();
  });
});

describe("reading a clock", () => {
  it("gives the local hour, not the UTC one", () => {
    // 12:00 UTC in January: Istanbul is UTC+3 all year.
    expect(hourIn("Europe/Istanbul", JANUARY)).toBe(15);
  });

  /**
   * Daylight saving is the reason this goes through `Intl` rather than a
   * stored offset. Berlin moves and Istanbul does not, so the gap between them
   * is not a constant — arithmetic on a fixed offset is wrong for months of
   * the year.
   */
  it("follows daylight saving where it applies", () => {
    expect(hourIn("Europe/Berlin", JANUARY)).toBe(13);
    expect(hourIn("Europe/Berlin", JULY)).toBe(14);
    // Istanbul does not observe it, so the Berlin gap changes across the year.
    expect(hourIn("Europe/Istanbul", JULY)).toBe(15);
  });

  /** Southern hemisphere moves the other way, in the other months. */
  it("handles the southern hemisphere", () => {
    expect(hourIn("Australia/Sydney", JANUARY)).toBe(23);
    expect(hourIn("Australia/Sydney", JULY)).toBe(22);
  });

  it("returns null for a zone the platform does not know", () => {
    expect(hourIn("Mars/Olympus_Mons", JANUARY)).toBeNull();
    expect(localTimeIn("Mars/Olympus_Mons", "en")).toBeNull();
  });

  it("formats a time for the reader's locale", () => {
    expect(localTimeIn("Europe/Istanbul", "en-GB", JANUARY)).toContain("15");
  });
});

describe("when both people are awake", () => {
  it("finds a wide window for neighbours", () => {
    const overlap = awakeOverlap("Europe/Istanbul", "Europe/Berlin", JANUARY);
    // Two hours apart, so almost the whole waking day is shared.
    expect(overlap!.hours).toBeGreaterThanOrEqual(12);
  });

  /**
   * The case that matters, and the one a naive scan gets wrong: the shared
   * window straddles midnight UTC, so treating the day as a line rather than a
   * circle reports half of it.
   */
  it("finds the window across a large gap without splitting it", () => {
    const overlap = awakeOverlap("Europe/Istanbul", "America/Los_Angeles", JANUARY);
    expect(overlap).not.toBeNull();
    expect(overlap!.hours).toBeGreaterThan(0);
    // Ten hours apart leaves a real but narrow window, in Istanbul's evening.
    expect(overlap!.startHour).toBeGreaterThanOrEqual(AWAKE_FROM);
    expect(overlap!.startHour).toBeLessThan(AWAKE_UNTIL);
  });

  it("reports the window in the viewer's hours, so it is theirs to read", () => {
    const fromIstanbul = awakeOverlap("Europe/Istanbul", "Asia/Tokyo", JANUARY)!;
    const fromTokyo = awakeOverlap("Asia/Tokyo", "Europe/Istanbul", JANUARY)!;

    // Same overlap, each expressed locally — so the two start hours differ.
    expect(fromIstanbul.hours).toBe(fromTokyo.hours);
    expect(fromIstanbul.startHour).not.toBe(fromTokyo.startHour);
  });

  it("is the whole waking day when both are in the same zone", () => {
    const overlap = awakeOverlap("Europe/Istanbul", "Europe/Istanbul", JANUARY)!;
    expect(overlap.hours).toBe(AWAKE_UNTIL - AWAKE_FROM);
    expect(overlap.startHour).toBe(AWAKE_FROM);
  });

  /**
   * There is no pair of cities with nothing in common, and that is arithmetic
   * rather than luck: two fifteen-hour windows on a twenty-four hour circle
   * must overlap by at least six hours wherever they sit.
   *
   * This started life as a test asserting the opposite — that Auckland and Los
   * Angeles would have no overlap — which was simply wrong. UTC+13 and UTC-8
   * are twenty-one hours apart one way round the clock and three the other,
   * and it is the short way that decides.
   */
  it.each([
    ["Pacific/Auckland", "America/Los_Angeles"],
    ["Pacific/Auckland", "Europe/London"],
    ["Asia/Tokyo", "America/Chicago"],
    ["Europe/Istanbul", "Pacific/Auckland"],
    ["America/Sao_Paulo", "Asia/Seoul"]
  ])("always share the guaranteed hours: %s and %s", (a, b) => {
    const overlap = awakeOverlap(a, b, JANUARY);
    expect(overlap).not.toBeNull();
    expect(overlap!.totalHours).toBeGreaterThanOrEqual(GUARANTEED_OVERLAP_HOURS);
    // And the longest single stretch is always something, even when the total
    // arrives in two pieces.
    expect(overlap!.hours).toBeGreaterThan(0);
  });

  /**
   * The distinction the bound is about. Auckland and London share six hours a
   * day, but as a two-hour morning and a four-hour evening — so the longest
   * usable stretch is smaller than the total, and naming only one of the two
   * would either overstate what can be planned or understate the distance.
   */
  it("separates the longest stretch from the total", () => {
    const overlap = awakeOverlap("Pacific/Auckland", "Europe/London", JANUARY)!;
    expect(overlap.totalHours).toBeGreaterThan(overlap.hours);
    expect(overlap.totalHours).toBeGreaterThanOrEqual(GUARANTEED_OVERLAP_HOURS);
  });

  it("states the guarantee the constants actually produce", () => {
    expect(GUARANTEED_OVERLAP_HOURS).toBe(2 * (AWAKE_UNTIL - AWAKE_FROM) - 24);
    expect(GUARANTEED_OVERLAP_HOURS).toBeGreaterThan(0);
  });

  it("returns null rather than throwing on an unknown zone", () => {
    expect(awakeOverlap("Europe/Istanbul", "Mars/Olympus_Mons", JANUARY)).toBeNull();
  });
});
