import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GRADIENT, GRID, PETALS, markPath, markSvg } from "../../scripts/brand-mark.mjs";

/**
 * The mark, and the one thing about it that must not drift.
 *
 * The path used to be written out in three places — the generator, this
 * component, and `public/icon.svg` — so the tab icon, the app icon and the
 * header were the same flower only for as long as somebody remembered to edit
 * all three. Two of those are now derived. This is what keeps the third one
 * honest, and what stops the petal count from being quietly restyled: five is
 * Today's 5, not a decoration.
 */

const path = markPath();

/** `M…Z` per petal, so counting the closepaths counts the petals. */
const subpaths = path.match(/Z/g) ?? [];

describe("the FioreMatch mark", () => {
  it("has one petal per person in Today's 5", () => {
    expect(PETALS).toBe(5);
    expect(subpaths).toHaveLength(5);
  });

  /**
   * Each petal is a vesica: two arcs of *equal* radius between the same two
   * points, bulging opposite ways. If a future edit makes the two radii differ
   * the shape stops being the intersection of two equal circles and becomes an
   * ordinary leaf — the thing the mark means stops being true of it.
   */
  it("draws every petal as two arcs of one radius", () => {
    const radii = [...path.matchAll(/A([\d.]+) ([\d.]+) /g)].map(([, rx, ry]) => {
      expect(rx).toBe(ry);
      return rx;
    });

    expect(radii).toHaveLength(PETALS * 2);
    expect(new Set(radii).size).toBe(1);
  });

  it("is rotationally symmetric about the centre", () => {
    // Every tip sits at the same distance from the centre, one fifth of a turn
    // apart. Read back off the path rather than recomputed, so a typo in the
    // construction cannot agree with itself.
    const tips = [...path.matchAll(/A[\d.]+ [\d.]+ 0 0 1 ([\d.]+) ([\d.]+)A/g)].map(
      ([, x, y]) => Math.hypot(Number(x) - GRID / 2, Number(y) - GRID / 2)
    );

    expect(tips).toHaveLength(PETALS);
    for (const distance of tips) expect(distance).toBeCloseTo(tips[0], 1);
  });

  it("leaves the centre open, so it survives a favicon", () => {
    // Petal bases stop short of the centre; that gap is the star of negative
    // space that keeps 16px from turning into a blob.
    const bases = [...path.matchAll(/M([\d.]+) ([\d.]+)A/g)].map(([, x, y]) =>
      Math.hypot(Number(x) - GRID / 2, Number(y) - GRID / 2)
    );

    expect(bases).toHaveLength(PETALS);
    for (const distance of bases) expect(distance).toBeGreaterThan(0);
  });

  it("renders the same flower into the generated favicon", () => {
    const icon = readFileSync(join(process.cwd(), "public", "icon.svg"), "utf8");

    expect(icon).toContain(path);
    expect(icon).toContain(GRADIENT.from);
    expect(icon).toContain(GRADIENT.to);
  });

  /**
   * The offline page is the one place a copy is correct.
   *
   * The service worker serves it when there is no network, and its own comment
   * commits it to no external requests of any kind — so it cannot point an
   * `<img>` at the icon everything else derives from. The copy stays, and this
   * asserts it, which turns "somebody has to remember to edit both" into a
   * failing test.
   */
  it("keeps the offline page's inline copy identical", () => {
    const offline = readFileSync(join(process.cwd(), "public", "offline.html"), "utf8");

    expect(offline).toContain(path);
    expect(offline).toContain(`viewBox="0 0 ${GRID} ${GRID}"`);
    expect(offline).toContain(`x1="${GRADIENT.x1}" y1="${GRADIENT.y1}"`);
    expect(offline).toContain(`stop-color="${GRADIENT.from}"`);
    expect(offline).toContain(`stop-color="${GRADIENT.to}"`);
  });

  it("puts the mark on every canvas the generators ask for", () => {
    // A maskable icon is drawn small on an opaque ground; a bare one is not.
    // Both must still be this path rather than a second drawing of it.
    const maskable = markSvg({ width: 192, scale: 0.56, ground: "square" });
    const bare = markSvg({ width: 192, scale: 0.78 });

    expect(maskable).toContain(path);
    expect(bare).toContain(path);
    expect(maskable).toContain(`fill="#fff5f7"`);
    expect(bare).not.toContain(`fill="#fff5f7"`);
  });
});
