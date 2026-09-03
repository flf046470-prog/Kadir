import { describe, expect, it } from "vitest";
import { TIERS } from "../billing/tiers";
import {
  DEFAULT_ENVIRONMENT,
  ENVIRONMENTS,
  catalogueIsValid,
  environmentById,
  environmentFor,
  environmentsFor
} from "./environments";

describe("the catalogue", () => {
  it("names only real tiers", () => {
    expect(catalogueIsValid()).toBe(true);
  });

  it("has no duplicate ids", () => {
    const ids = ENVIRONMENTS.map((environment) => environment.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * A free tier with no environment would make the whole feature paid, and the
   * lesson from translation is that the thing to sell is the ceiling rather
   * than the feature — someone has to be able to have one real virtual date to
   * find out whether it is worth paying for.
   */
  it("gives the free tier somewhere to go", () => {
    expect(environmentsFor("free").length).toBeGreaterThan(0);
    expect(environmentById(DEFAULT_ENVIRONMENT)?.minimumTier).toBe("free");
  });

  it("never takes an environment away as the tier goes up", () => {
    const free = environmentsFor("free").map((e) => e.id);
    const plus = environmentsFor("plus").map((e) => e.id);
    const vip = environmentsFor("vip").map((e) => e.id);

    for (const id of free) expect(plus).toContain(id);
    for (const id of plus) expect(vip).toContain(id);
    expect(vip).toHaveLength(ENVIRONMENTS.length);
  });

  it("gives every paid tier something the one below does not have", () => {
    expect(environmentsFor("plus").length).toBeGreaterThan(environmentsFor("free").length);
    expect(environmentsFor("vip").length).toBeGreaterThan(environmentsFor("plus").length);
  });
});

describe("resolving a requested environment", () => {
  it("falls back to the default when none is asked for", () => {
    for (const tier of TIERS) {
      expect(environmentFor(null, tier)).toEqual({ ok: true, id: DEFAULT_ENVIRONMENT });
      expect(environmentFor(undefined, tier)).toEqual({ ok: true, id: DEFAULT_ENVIRONMENT });
    }
  });

  it("allows what the tier reaches", () => {
    expect(environmentFor("sunset_beach", "plus")).toEqual({ ok: true, id: "sunset_beach" });
    expect(environmentFor("rooftop", "vip")).toEqual({ ok: true, id: "rooftop" });
  });

  it("locks what it does not", () => {
    expect(environmentFor("sunset_beach", "free")).toEqual({
      ok: false,
      reason: "environment_locked"
    });
    expect(environmentFor("rooftop", "plus")).toEqual({
      ok: false,
      reason: "environment_locked"
    });
  });

  /**
   * Refused rather than defaulted. Substituting the free café for a typo would
   * put two people somewhere neither chose, and would make a locked
   * environment look identical to a misspelling from outside.
   */
  it("refuses an id that is not in the catalogue", () => {
    expect(environmentFor("moon_base", "vip")).toEqual({
      ok: false,
      reason: "unknown_environment"
    });
  });
});
