import { BrandMark } from "./BrandMark";

/**
 * The header lockup: the bloom, then the name.
 *
 * The mark used to be a copy of the path, pasted here *and* in
 * `public/icon.svg` *and* in `AppOnlyHome.tsx` — four drawings of one shape,
 * which is the drift `scripts/brand-mark.mjs` warns about in its own opening
 * comment: the favicon and the header stop being the same flower, and nobody
 * notices, because nobody sees both at once.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-display text-lg font-semibold text-ink sm:gap-2 sm:text-xl ${className}`}
    >
      <BrandMark gradientId="fm-logo-grad" className="h-[26px] w-[26px] shrink-0" />
      FioreMatch
    </span>
  );
}
