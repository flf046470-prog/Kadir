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
 *
 * **`--n` is what lets the pile recede.** Sticky alone gathers the cards, but
 * a gathered pile of opaque cards on a near-white page is indistinguishable
 * from one card: the last one lands on top and the two beneath it are a pair
 * of 14px slivers of white on white. So the card underneath has to *recede* —
 * scale back and dim — as the next one covers it, and that needs each card to
 * know its share of the section's travel. `--i` gives it its place in the
 * deck; `--n` gives it the size of the deck; the surrounding `ScrollScene`
 * gives it `--scene`, and the arithmetic happens in the stylesheet.
 *
 * Without a `ScrollScene` above it, `--scene` defaults to its finished value
 * and the deck is a plain sticky stack — which is exactly what it was before,
 * so the component stays usable on its own.
 */
export function StackCards({
  children,
  className = ""
}: {
  children: ReactNode[];
  className?: string;
}) {
  return (
    <div className={`fm-stack ${className}`} style={{ "--n": children.length } as React.CSSProperties}>
      {children.map((child, index) => (
        <div key={index} className="fm-stack__item" style={{ "--i": index } as React.CSSProperties}>
          {child}
        </div>
      ))}
    </div>
  );
}
