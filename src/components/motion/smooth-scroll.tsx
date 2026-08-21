"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Smooth scrolling, tied into GSAP's ticker so scrubbed animations stay in
 * lockstep with the wheel instead of chasing it.
 *
 * Touch scrolling is left to the browser: hijacking it costs more in feel and
 * battery than it gains. Mounted once from the site layout; a visitor who
 * prefers reduced motion gets the platform's own scrolling untouched.
 */
export function SmoothScroll() {
  const pathname = usePathname();
  const lenis = useRef<{ scrollTo: (t: number, o?: object) => void } | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const start = async () => {
      const [{ default: Lenis }, { gsap }, { ScrollTrigger }] = await Promise.all([
        import("lenis"),
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled) return;

      gsap.registerPlugin(ScrollTrigger);

      const lenisInstance = new Lenis({
        duration: 1.05,
        // A long, flat tail: the page keeps gliding after the wheel stops.
        easing: (t: number) => 1 - Math.pow(1 - t, 3.4),
        smoothWheel: true,
        syncTouch: false,
        wheelMultiplier: 0.95,
        // In-page links (including the skip link) glide instead of jumping,
        // and, more importantly, are not fought by the animation loop.
        anchors: { offset: -80 },
      });
      lenis.current = lenisInstance;

      lenisInstance.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenisInstance.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      // Anchor links inside the page should glide too, not jump.
      document.documentElement.classList.add("lenis-on");

      cleanup = () => {
        gsap.ticker.remove(tick);
        gsap.ticker.lagSmoothing(500, 33);
        document.documentElement.classList.remove("lenis-on");
        lenis.current = null;
        lenisInstance.destroy();
      };
    };

    void start();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Route changes land at the top of the new page, without a visible glide
  // back up through the old one. It has to go through Lenis: its loop owns the
  // scroll position while it runs, and would pull a plain scrollTo straight
  // back to where it thinks the page is.
  useEffect(() => {
    if (lenis.current) lenis.current.scrollTo(0, { immediate: true });
    else window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);

  return null;
}
