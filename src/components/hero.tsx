import { RidgeScene } from "./visuals";

/**
 * Cinematic hero. The ridge settles back and the words lift away as the page
 * scrolls — both scrubbed from <ScrollMotion />, which is also what skips them
 * for visitors who prefer reduced motion.
 */
export function HeroBackdrop() {
  return (
    <div data-motion="hero-backdrop" className="absolute inset-0 will-change-transform">
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
