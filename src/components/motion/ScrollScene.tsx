"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Scroll-linked scene.
 *
 * Publishes one number — the section's own scroll travel, 0 at the moment it
 * enters from below, 1 as it leaves the top — onto a CSS custom property named
 * `--scene`. Everything cinematic downstream is then plain CSS reading that
 * variable, which is what keeps this affordable:
 *
 *  - **No React state.** A `setState` per scroll event would re-render the
 *    subtree sixty times a second. This writes one custom property per frame
 *    and React never learns the page moved.
 *  - **Compositor only.** Consumers animate `transform`, `opacity` and
 *    `filter`. Nothing here may drive width, height, top or margin — the
 *    marketing pages are the SEO surface and a scrubbed layout property is a
 *    failed Core Web Vital, not an effect.
 *  - **Content exists without JavaScript.** `--scene` defaults to a resting
 *    value that renders the finished state, so a crawler, a reader mode, or a
 *    hydration failure all see the real section rather than a blank stage.
 *
 * Under reduced motion the listener is never attached and the resting value
 * stands, so the scene is simply *there* — arrived, not arriving.
 */
export function ScrollScene({
  children,
  className = "",
  as: Tag = "div",
  /**
   * Where the scene finishes relative to its own height. 1 means fully scrolled
   * past; 0.6 finishes the motion while the section is still comfortably in
   * view, which is usually what you want for text that has to stay readable.
   */
  span = 1
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  span?: number;
}) {
  const ref = useRef<HTMLElement>(null);

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
      const travel = (rect.height + window.innerHeight) * span;
      if (travel <= 0) return;

      // 0 when the top edge is one viewport below the fold, 1 once the section
      // has travelled its own height past it.
      const raw = (window.innerHeight - rect.top) / travel;
      const scene = raw < 0 ? 0 : raw > 1 ? 1 : raw;

      host.style.setProperty("--scene", scene.toFixed(4));
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
  }, [span]);

  return (
    <Tag
      ref={ref}
      className={className}
      // The resting value is the *finished* state, not the starting one: if the
      // script never runs, the section reads as arrived rather than half-built.
      style={{ "--scene": "1" } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
