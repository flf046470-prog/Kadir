import type { Metadata } from "next";
import { Reveal } from "@/components/reveal";
import { CtaLink, PageHeader, PhaseTimeline, SectionHeading } from "@/components/ui";
import { getCurrentPhase, getPhases, getPosts } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "Follow the journey — project progress";
  const description =
    "The seven phases of Patagonia Underground, from idea to opening, each with its real status. Nothing is marked complete before it is complete.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/progress"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/progress"), settings) },
  };
}

export default async function ProgressPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t, path } = await getPageContext(params);
  const phases = getPhases();
  const current = getCurrentPhase(phases);
  const updates = getPosts("all", { limit: 4 });

  return (
    <>
      <PageHeader
        kicker="Follow the journey"
        title="Seven phases from idea to open doors"
        intro="This is the whole route. A phase changes status here on the day it actually changes — not before."
        aside={
          current ? (
            <p className="label text-ember">Current phase — {current.name}</p>
          ) : null
        }
      />

      <div className="shell py-20 md:py-28">
        <PhaseTimeline phases={phases} headingLevel={2} />

        <Reveal className="mt-20 border-t border-fog/10 pt-16">
          <SectionHeading kicker="Recorded" title="What has actually been published" />
          {updates.length > 0 ? (
            <ul className="mt-8 divide-y divide-fog/10 border-y border-fog/10">
              {updates.map((post) => (
                <li key={post.id} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-5">
                  <time dateTime={post.entry_date} className="label w-32 shrink-0 text-ember">
                    {formatDate(post.entry_date)}
                  </time>
                  <span className="text-mist">{post.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="prose-valley mt-6 max-w-2xl text-fog">
              No entries have been published yet. The first one will appear here — with its date —
              when there is something real to record.
            </p>
          )}
        </Reveal>

        <Reveal className="mt-16 flex flex-wrap gap-3">
          <CtaLink href={path("/join")}>{t("cta.keepPosted")}</CtaLink>
          <CtaLink href={path("/transparency")} variant="ghost">
            {t("nav.transparency")}
          </CtaLink>
        </Reveal>
      </div>
    </>
  );
}
