import type { Metadata } from "next";
import { Reveal } from "@/components/reveal";
import { CtaLink, PageHeader, PhaseTimeline, Prose, SectionHeading } from "@/components/ui";
import { getPhases, getPosts } from "@/lib/content";
import { formatDate, lines } from "@/lib/format";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "Project transparency";
  const description =
    "The project's public record: real phase status, what has been completed, what has not started, and why no budget figures are published yet.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/transparency"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/transparency"), settings) },
  };
}

export default async function TransparencyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { t, settings, path } = await getPageContext(params);
  const phases = getPhases();
  const entries = getPosts("all", { limit: 20 });
  const commitments = lines(settings["transparency.commitments"]);

  const completed = phases.filter((p) => p.status === "completed");
  const inProgress = phases.filter((p) => p.status === "in_progress");
  const notStarted = phases.filter((p) => p.status === "not_started");

  return (
    <>
      <PageHeader
        kicker={t("nav.transparency")}
        title="Project transparency"
        intro={settings["transparency.intro"]}
      />

      <div className="shell py-20 md:py-28">
        <Reveal className="grid gap-6 sm:grid-cols-3">
          {[
            { label: "Completed phases", value: completed.length, tone: "text-moss" },
            { label: "In progress", value: inProgress.length, tone: "text-ember" },
            { label: "Not started", value: notStarted.length, tone: "text-fog" },
          ].map((item) => (
            <div key={item.label} className="card-stone p-6">
              <p className={`font-display text-5xl ${item.tone}`}>{item.value}</p>
              <p className="label mt-3 text-fog/70">{item.label}</p>
            </div>
          ))}
        </Reveal>

        <Reveal className="mt-20">
          <SectionHeading kicker="The record" title="Every phase, with its real status" />
          <div className="mt-12">
            <PhaseTimeline phases={phases} />
          </div>
        </Reveal>

        <Reveal className="mt-20 border-t border-fog/10 pt-16">
          <SectionHeading kicker="Developments" title="What has been published, and when" />
          {entries.length > 0 ? (
            <ul className="mt-8 divide-y divide-fog/10 border-y border-fog/10">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-6 gap-y-2 py-5">
                  <time dateTime={entry.entry_date} className="label w-32 shrink-0 text-ember">
                    {formatDate(entry.entry_date)}
                  </time>
                  <span className="flex-1 text-mist">{entry.title}</span>
                  <span className="label text-fog/50">{entry.kind}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="prose-valley mt-6 max-w-2xl text-fog">
              Nothing has been published yet, because nothing has happened yet that would be honest
              to publish. This list starts on the day it does.
            </p>
          )}
        </Reveal>

        <Reveal className="mt-20 grid gap-12 border-t border-fog/10 pt-16 md:grid-cols-2">
          <div>
            <SectionHeading kicker="Money" title="Financial information" />
            <Prose body={settings["transparency.finance"]} className="mt-6" />
          </div>
          <div>
            <SectionHeading kicker="Rules" title="What this site will not do" />
            <ul className="mt-6 divide-y divide-fog/10 border-y border-fog/10">
              {commitments.map((line) => (
                <li key={line} className="flex gap-4 py-4">
                  <svg
                    viewBox="0 0 24 24"
                    className="mt-1 h-4 w-4 shrink-0 text-moss"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="m4 12.5 5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-sm leading-relaxed text-mist">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal className="mt-16">
          <CtaLink href={path("/join")}>{t("cta.keepPosted")}</CtaLink>
        </Reveal>
      </div>
    </>
  );
}
