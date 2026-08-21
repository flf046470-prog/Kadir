import { AndesScene } from "./scene/andes-scene";
import { ContourField, RidgeScene } from "./visuals";

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

      {/* The concept, waiting under the landscape. */}
      <div
        data-motion="hero-concept"
        className="pointer-events-none absolute inset-0 opacity-0"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-basalt/85" />
        <ContourField className="absolute inset-x-0 bottom-0 w-full text-fog/[0.09]" />
        <svg
          viewBox="0 0 1440 860"
          preserveAspectRatio="xMidYMid slice"
          className="absolute inset-0 h-full w-full"
        >
          <g
            transform="translate(720 560)"
            fill="none"
            stroke="#cfd5cd"
            strokeOpacity="0.5"
            strokeWidth="1.2"
          >
            {/* the shoulder, cut and re-covered */}
            <path d="M-620 0 H620" strokeOpacity="0.25" />
            <path d="M-360 0 C -300 -150, 300 -150, 360 0" />
            <path d="M-300 0 C -250 -120, 250 -120, 300 0" strokeOpacity="0.3" />
            <path d="M-360 0 v70 M360 0 v70" strokeOpacity="0.25" />
            {/* the glazed face toward the valley */}
            <path d="M-150 -96 v96 M-50 -119 v119 M50 -119 v119 M150 -96 v96" strokeOpacity="0.35" />
            <circle cx="0" cy="-40" r="6" fill="#d98b52" stroke="none" fillOpacity="0.8" />
          </g>
        </svg>
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
