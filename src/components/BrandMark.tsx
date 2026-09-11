import { GRADIENT, GRID, markPath } from "../../scripts/brand-mark.mjs";

/**
 * The bloom, as a component.
 *
 * The geometry is imported rather than written out: it lives once in
 * `scripts/brand-mark.mjs`, which is also what the PWA icons, the favicon, the
 * Android launcher, the Microsoft tiles and the Play feature graphic are drawn
 * from. That module is pure arithmetic with no Node builtins, so it bundles
 * for the browser like any other module.
 *
 * The gradient needs an id, and two of these can appear on one page — the
 * header lockup and a page's own mark — so the id is a prop rather than a
 * constant. Two `<linearGradient id="g">` in one document is one gradient,
 * whichever rendered first, and the second mark silently inherits it.
 */
export function BrandMark({
  className = "",
  gradientId,
  title
}: {
  className?: string;
  /** Unique per instance within a page. */
  gradientId: string;
  /** Given a title the mark is exposed as an image; without one it is decorative. */
  title?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${GRID} ${GRID}`}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1={GRADIENT.x1}
          y1={GRADIENT.y1}
          x2={GRADIENT.x2}
          y2={GRADIENT.y2}
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={GRADIENT.from} />
          <stop offset="1" stopColor={GRADIENT.to} />
        </linearGradient>
      </defs>
      <path d={markPath()} fill={`url(#${gradientId})`} />
    </svg>
  );
}
