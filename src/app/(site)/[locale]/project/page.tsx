import type { Metadata } from "next";
import { CrossSectionDiagram } from "@/components/visuals";
import { Reveal } from "@/components/reveal";
import { CtaLink, PageHeader, PhaseBadge, Prose, SectionHeading } from "@/components/ui";
import { getCurrentPhase, getPhases } from "@/lib/content";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "The project — an earth-sheltered house in Trevelin";
  const description =
    "What Patagonia Underground is, why it is being built in Trevelin, Chubut, how the earth-sheltered concept works, and exactly what stage it is at today.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/project"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/project"), settings) },
  };
}

export default async function ProjectPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t, settings, path } = await getPageContext(params);
  const phases = getPhases();
  const current = getCurrentPhase(phases);

  const sections = [
    { kicker: "01", title: "The purpose", body: settings["project.purpose"] },
    { kicker: "02", title: "Why Patagonia", body: settings["project.whyPatagonia"] },
    { kicker: "03", title: "The architectural idea", body: settings["project.architecture"] },
    { kicker: "04", title: "Relationship with nature", body: settings["project.nature"] },
    { kicker: "05", title: "The future stay", body: settings["project.stayConcept"] },
  ];

  return (
    <>
      <PageHeader
        kicker={t("nav.project")}
        title="A house built into the ground, in a valley worth keeping"
        intro={settings["project.intro"]}
        aside={
          current ? (
            <div className="flex flex-wrap items-center gap-4">
              <PhaseBadge status={current.status} />
              <span className="label text-fog/70">
                Current phase — {current.name}
              </span>
            </div>
          ) : null
        }
      />

      <div className="shell py-20 md:py-28">
        <div className="grid gap-16 md:gap-24">
          {sections.map((section, i) => (
            <Reveal key={section.title} className="grid gap-8 md:grid-cols-12" delay={i * 40}>
              <div className="md:col-span-4">
                <SectionHeading kicker={`${section.kicker} —`} title={section.title} />
              </div>
              <div className="md:col-span-7 md:col-start-6">
                <Prose body={section.body} />
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="card-stone grain relative mt-24 overflow-hidden p-6 md:p-12">
          <p className="label text-ember">Concept diagram</p>
          <h2 className="mt-4 max-w-2xl font-display text-3xl leading-snug md:text-4xl">
            The layers that make an earth-sheltered house work
          </h2>
          <div className="mt-10">
            <CrossSectionDiagram />
          </div>
          <p className="mt-8 max-w-2xl text-sm leading-relaxed text-fog">
            Original illustration, drawn for this site. It shows the principle of the construction,
            not an engineered drawing of a specific building, and no part of it should be read as a
            finished technical specification.
          </p>
        </Reveal>

        <div className="mt-24 grid gap-12 md:grid-cols-2">
          <Reveal>
            <SectionHeading kicker="Today —" title="Where the project stands" />
            <Prose body={settings["project.currentStatus"]} className="mt-6" />
          </Reveal>
          <Reveal delay={60}>
            <SectionHeading kicker="Next —" title="What comes next" />
            <Prose body={settings["project.nextSteps"]} className="mt-6" />
          </Reveal>
        </div>

        <Reveal className="mt-16 flex flex-wrap gap-3">
          <CtaLink href={path("/progress")}>{t("cta.followJourney")}</CtaLink>
          <CtaLink href={path("/transparency")} variant="ghost">
            {t("nav.transparency")}
          </CtaLink>
        </Reveal>
      </div>
    </>
  );
}
