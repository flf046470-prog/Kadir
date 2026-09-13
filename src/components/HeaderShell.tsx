"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Header chrome.
 *
 * At the top of the page the header floats over the lit hero with no background,
 * so the hero reads as one uninterrupted image. Once the page scrolls past the
 * hero it gains a solid surface, because white-on-photo text stops being legible
 * the moment light content scrolls under it.
 *
 * The threshold is generous (80px) so the transition happens deliberately rather
 * than flickering on a trackpad nudge.
 */
export function HeaderShell({ children }: { children: ReactNode }) {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    let frame = 0;

    function update() {
      frame = 0;
      setSolid(window.scrollY > 80);
    }

    function onScroll() {
      if (frame === 0) frame = requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header
      data-solid={solid ? "true" : "false"}
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-500 ${
        solid
          ? "border-b border-black/5 bg-white/90 text-ink backdrop-blur"
          : "border-b border-transparent bg-transparent text-white"
      }`}
    >
      {children}
    </header>
  );
}
