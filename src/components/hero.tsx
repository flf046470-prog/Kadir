"use client";

import { useEffect, useRef } from "react";
import { RidgeScene } from "./visuals";

/**
 * Cinematic hero. The ridge drifts a little slower than the page, which is the
 * only motion effect on the site — and it is skipped entirely for visitors who
 * prefer reduced motion.
 */
export function HeroBackdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const offset = Math.min(window.scrollY, 900);
        node.style.transform = `translate3d(0, ${offset * 0.18}px, 0) scale(${1 + offset * 0.00008})`;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className="absolute inset-0 will-change-transform">
      <RidgeScene className="h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-t from-basalt via-basalt/45 to-basalt/75" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-basalt to-transparent" />
    </div>
  );
}

export function ScrollCue({ label = "Scroll" }: { label?: string }) {
  return (
    <span className="flex items-center gap-3 text-fog/60">
      <span className="label">{label}</span>
      <span aria-hidden="true" className="relative block h-8 w-px overflow-hidden bg-fog/20">
        <span className="absolute inset-x-0 top-0 h-3 animate-[cue_2.4s_ease-in-out_infinite] bg-ember" />
      </span>
      <style>{`@keyframes cue { 0% { transform: translateY(-12px) } 60% { transform: translateY(32px) } 100% { transform: translateY(32px) } }`}</style>
    </span>
  );
}
