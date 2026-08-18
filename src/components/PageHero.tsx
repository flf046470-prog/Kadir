import type { ReactNode } from "react";

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
    <section className="bg-aurora border-b border-black/5">
      <div className="container-fm py-16 sm:py-20">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          {title}
        </h1>
        {subtitle && <p className="mt-5 max-w-2xl text-lg text-ink/70">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}
