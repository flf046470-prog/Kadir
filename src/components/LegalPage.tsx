import type { ReactNode } from "react";
import { PageHero } from "@/components/PageHero";

export function LegalPage({
  title,
  updated,
  intro,
  children
}: {
  title: string;
  updated: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHero eyebrow="Legal" title={title} subtitle={intro} />
      <article className="container-fm max-w-3xl space-y-8 py-16 text-ink/80">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/40">Last updated: {updated}</p>
        {children}
        <div className="rounded-xl border border-black/10 bg-bloom-50 p-5 text-sm text-ink/70">
          This page is a good-faith starting framework, written to reflect GDPR, KVKK, and
          general global privacy principles. It is not a substitute for jurisdiction-specific
          legal review before production launch — see the project README roadmap.
        </div>
      </article>
    </>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
