"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll-linked reveal.
 *
 * The cinematic quality we want comes from *restraint* in the easing, not from
 * distance travelled: a short rise with a long, decelerating curve reads like a
 * camera settling, while a big jump reads like a slide transition.
 *
 * Three constraints this respects:
 *
 *  - **No layout shift.** The element occupies its final space from first
 *    paint; only opacity and transform change, both compositor-only properties.
 *    Animating height or margin here would wreck CLS on pages built for SEO.
 *  - **Content is present without JavaScript.** The initial state is visible,
 *    and the hidden state is applied on mount only when we know we can animate
 *    it back. A crawler, a reader-mode parser, or a failed hydration all see the
 *    real content.
 *  - **Reduced motion means no motion.** Not slower — none. The element simply
 *    appears.
 */

type Direction = "up" | "down" | "left" | "right" | "none";

const OFFSETS: Record<Direction, string> = {
  up: "translate3d(0, 28px, 0)",
  down: "translate3d(0, -28px, 0)",
  left: "translate3d(28px, 0, 0)",
  right: "translate3d(-28px, 0, 0)",
  none: "none"
};

export function Reveal({
  children,
  direction = "up",
  delay = 0,
  className = ""
}: {
  children: ReactNode;
  direction?: Direction;
  /** Milliseconds. Stagger siblings by 60–90ms; more starts to feel sluggish. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"initial" | "hidden" | "shown">("initial");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setState("shown");
      return;
    }

    // Already in view on load (above the fold): show it without the hidden
    // frame, so the first paint isn't a flash of blank hero.
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.85) {
      setState("shown");
      return;
    }

    setState("hidden");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setState("shown");
            observer.disconnect();
          }
        }
      },
      // Trigger a little before the element reaches the viewport edge, so the
      // motion finishes as it settles into view rather than after.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hidden = state === "hidden";

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: hidden ? 0 : 1,
        transform: hidden ? OFFSETS[direction] : "none",
        transition:
          state === "initial"
            ? undefined
            : `opacity 900ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, transform 900ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
        willChange: hidden ? "opacity, transform" : undefined
      }}
    >
      {children}
    </div>
  );
}
