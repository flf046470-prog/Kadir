import type { ReactNode } from "react";
import { Reveal } from "./motion/Reveal";
import { Atmosphere } from "./motion/Atmosphere";

/**
 * Page hero.
 *
 * Every marketing page opens on the same lit stage, so the header can float
 * over it without a seam and the whole site reads in one register. The heading
 * is padded down to clear the fixed header.
 */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  children
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <section className="fm-stage fm-grain">
      <Atmosphere />
      <div className="container-fm fm-above pb-16 pt-32 sm:pb-20 sm:pt-40">
        {eyebrow && (
          <Reveal direction="none">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-bloom-300">
              {eyebrow}
            </p>
          </Reveal>
        )}
        <Reveal delay={70}>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            {title}
          </h1>
        </Reveal>
        {subtitle && (
          <Reveal delay={140}>
            <p className="mt-5 max-w-2xl text-lg text-dusk-100/85">{subtitle}</p>
          </Reveal>
        )}
        {children && (
          <Reveal delay={210}>
            <div>{children}</div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
