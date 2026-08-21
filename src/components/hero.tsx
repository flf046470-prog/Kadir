import Image from "next/image";
import { AndesScene } from "./scene/andes-scene";
import { RidgeScene } from "./visuals";

/**
 * The opening frame: the cordillera at dusk, with the project as one lit window
 * in the hillside.
 *
 * Three layers sit here. The SVG ridge is the floor — it is in the HTML, so the
 * hero is never empty before scripts run. The canvas draws the range properly
 * over it. And a drawing of the buried house waits at zero opacity: as the page
 * scrolls, <ScrollMotion /> dissolves the landscape into it, which is the whole
 * argument of the project in one move.
 */
export function HeroBackdrop() {
  return (
    <div data-motion="hero-backdrop" className="absolute inset-0 will-change-transform">
      <RidgeScene className="absolute inset-0 h-full w-full" />
      <AndesScene className="absolute inset-0 h-full w-full" />

      {/* The project, waiting under the landscape: as the page scrolls, the
          drawn range dissolves into the house that would sit in it. */}
      <div
        data-motion="hero-concept"
        className="pointer-events-none absolute inset-0 opacity-0"
        aria-hidden="true"
      >
        <Image
          src="/project/exterior-night.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>

      {/* Scrims: bottom-weighted, so the range keeps its sky. */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-basalt via-basalt/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-basalt/80 via-basalt/15 to-transparent md:via-transparent" />
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
