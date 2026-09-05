import type { ReactNode } from "react";

/**
 * Cards that stack instead of scrolling past.
 *
 * Each card sticks a little lower than the one before it, so as the section
 * scrolls the deck gathers into a fanned pile rather than leaving the screen.
 * The offsets come from the card's own index, so the effect scales to any
 * number of children without a magic list of positions.
 *
 * There is no JavaScript here at all — `position: sticky` does the whole thing.
 * That matters beyond bundle size: the cards behave correctly during the gap
 * between first paint and hydration, and they keep behaving correctly if
 * hydration never happens.
 *
 * Sticky needs an ancestor that scrolls but does not clip, which is why the
 * wrapper sets no `overflow`. Adding one anywhere above this breaks the effect
 * silently — the cards simply scroll away as normal.
 */
export function StackCards({
  children,
  className = ""
}: {
  children: ReactNode[];
  className?: string;
}) {
  return (
    <div className={`fm-stack ${className}`}>
      {children.map((child, index) => (
        <div key={index} className="fm-stack__item" style={{ "--i": index } as React.CSSProperties}>
          {child}
        </div>
      ))}
    </div>
  );
}
