import { describe, expect, it } from "vitest";
import { MIN_BUCKET, NOT_MEASURED, share, withhold } from "./metrics";

describe("withholding small buckets", () => {
  it("keeps the buckets big enough to be anonymous", () => {
    const result = withhold([
      { key: "basic_cafe", count: MIN_BUCKET },
      { key: "sunset_beach", count: 40 }
    ]);

    expect(result.buckets).toEqual([
      { key: "sunset_beach", count: 40 },
      { key: "basic_cafe", count: MIN_BUCKET }
    ]);
    expect(result.withheld).toBe(0);
  });

  /**
   * The case this exists for. One accepted date in one environment is a fact
   * about a person to anyone who knows a single member — and with a twelve-item
   * catalogue, buckets that small are the normal state of a young product.
   */
  it("withholds a bucket small enough to point at someone", () => {
    const result = withhold([
      { key: "sunset_beach", count: 40 },
      { key: "northern_lights", count: 1 }
    ]);

    expect(result.buckets).toEqual([{ key: "sunset_beach", count: 40 }]);
    expect(result.withheld).toBe(1);
  });

  /**
   * Saying how many were withheld is safe — it is a fact about the catalogue,
   * not about anyone — and without it an empty breakdown and a fully suppressed
   * one look identical, which is what sends someone to the raw table.
   */
  it("distinguishes nothing happened from everything was too small", () => {
    expect(withhold([])).toEqual({ buckets: [], withheld: 0 });
    expect(withhold([{ key: "rose", count: 1 }])).toEqual({ buckets: [], withheld: 1 });
  });

  it("orders by size, then by name so the order is stable", () => {
    const result = withhold([
      { key: "tea", count: 9 },
      { key: "cake", count: 9 },
      { key: "rose", count: 20 }
    ]);

    expect(result.buckets.map((bucket) => bucket.key)).toEqual(["rose", "cake", "tea"]);
  });
});

describe("rates", () => {
  it("rounds to four places", () => {
    expect(share(1, 3)).toBe(0.3333);
  });

  /**
   * Launch day: every denominator is zero. A zero rate would read as a product
   * nobody is converting on, rather than one nobody has used yet.
   */
  it("is unknown rather than zero when there is nothing to divide by", () => {
    expect(share(0, 0)).toBeNull();
    expect(share(5, 0)).toBeNull();
  });

  it("is zero when there genuinely were none", () => {
    expect(share(0, 100)).toBe(0);
  });
});

describe("the metrics that cannot be measured", () => {
  /**
   * Reported rather than returned as `0`, because the difference between
   * "nobody finished a virtual date" and "nothing exists that could record one"
   * is the difference between an emergency and a roadmap item.
   */
  it("names each one and says why", () => {
    expect(NOT_MEASURED.map((entry) => entry.metric)).toEqual([
      "completedDates",
      "averageDateDuration",
      "avatarUsage"
    ]);

    for (const entry of NOT_MEASURED) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});
