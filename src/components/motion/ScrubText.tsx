import { Fragment, type ElementType } from "react";

/**
 * Text that lights up word by word as the surrounding `ScrollScene` advances.
 *
 * This is a *server* component on purpose. The sentence ships as ordinary words
 * in the static HTML — every word is real text a crawler indexes and a screen
 * reader reads in order. The only thing the client adds is the number in
 * `--scene`; the reveal itself is arithmetic in a stylesheet.
 *
 * Each word carries its index, the line carries the total, and the CSS lights
 * word `i` once `scene × total` has passed it. That means the effect scrubs
 * both ways — scroll back up and the sentence dims again — without a single
 * event listener of its own.
 *
 * The separating space is a text node *between* the spans, never inside one.
 * Each word is an inline-block, and a browser trims whitespace at the edge of
 * an inline-block, so a space kept inside the box disappears and the sentence
 * renders as one run-on word.
 *
 * Splitting on whitespace is safe for the Latin and Turkish copy this is used
 * for. Wrapping whole words leaves shaping intact for cursive scripts, so this
 * stays correct in Arabic — but never lower the split to characters, which
 * would break joining forms.
 *
 * `dir="auto"` is load-bearing, not decoration. Each word is an inline-block,
 * and an inline-block is an atomic box: the bidi algorithm stops seeing one
 * continuous Latin run and instead lays 24 separate boxes out in the
 * *container's* direction. In an RTL locale that renders the sentence
 * backwards, word by word. Letting the element pick its direction from its own
 * first strong character keeps English fallback copy LTR inside an RTL page,
 * and genuine Arabic copy RTL — which matters here because most locales fall
 * back to English.
 */
export function ScrubText({
  children,
  className = "",
  as: Tag = "p"
}: {
  children: string;
  className?: string;
  as?: ElementType;
}) {
  const words = children.split(/\s+/).filter(Boolean);

  return (
    <Tag
      dir="auto"
      className={`fm-scrub ${className}`}
      style={{ "--n": words.length } as React.CSSProperties}
    >
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className="fm-scrub__word" style={{ "--i": index } as React.CSSProperties}>
            {word}
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </Tag>
  );
}
