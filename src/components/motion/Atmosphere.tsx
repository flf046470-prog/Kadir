"use client";

import { useEffect, useRef } from "react";

/**
 * Atmospheric light layer.
 *
 * Two soft light sources drift slowly behind the content, at different speeds
 * and scales. The effect reads as depth rather than decoration because the
 * layers move *with* the scroll but slower than it — the same trick a camera
 * dolly uses to separate foreground from background.
 *
 * Implementation notes:
 *  - Position is written straight to a CSS custom property inside a rAF, so
 *    React never re-renders on scroll. A `setState` per scroll event would make
 *    this the most expensive thing on the page.
 *  - `pointer-events: none` and `aria-hidden` — this is atmosphere, and must
 *    never intercept a click or reach a screen reader.
 *  - Under reduced motion the layers render static. They still provide the
 *    colour depth; they just stop moving.
 */
export function Atmosphere({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;

    function update() {
      frame = 0;
      const host = ref.current;
      if (!host) return;

      const rect = host.getBoundingClientRect();
      // -1 when the section is just below the viewport, 1 when just above.
      const progress = (window.innerHeight / 2 - (rect.top + rect.height / 2)) / window.innerHeight;
      host.style.setProperty("--drift", progress.toFixed(4));
    }

    function onScroll() {
      // Coalesce to one write per frame; scroll fires far more often than that.
      if (frame === 0) frame = requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{ "--drift": "0" } as React.CSSProperties}
    >
      <span className="fm-glow fm-glow--warm" />
      <span className="fm-glow fm-glow--cool" />
    </div>
  );
}
