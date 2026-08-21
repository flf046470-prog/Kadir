import type { Metadata } from "next";
import { Reveal } from "@/components/reveal";
import { CtaLink, PageHeader, Prose, SectionHeading } from "@/components/ui";
import { ContourField } from "@/components/visuals";
import { getStorySections } from "@/lib/content";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "Our story — how Patagonia Underground started";
  const description =
    "The idea behind Patagonia Underground, why Trevelin, what the finished place is meant to feel like, and why the whole project is being published in public.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/story"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/story"), settings) },
  };
}

export default async function StoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t, path } = await getPageContext(params);
  const sections = getStorySections();

  return (
    <>
      <PageHeader
        kicker={t("nav.story")}
        title="Our story"
        intro="Five short chapters: where the idea came from, why this valley, what it should become, and why every step of it is being published as it happens."
      />

      <div className="shell relative overflow-hidden py-20 md:py-28">
        <ContourField parallax={0.12} className="pointer-events-none absolute -end-1/3 top-1/3 w-[120%] max-w-none text-fog/[0.05] md:w-[60%]" />
        <div className="relative grid gap-20 md:gap-28">
          {sections.map((section, i) => (
            <Reveal key={section.id} className="grid gap-8 md:grid-cols-12" delay={i * 40}>
              <div className="md:col-span-4">
                <SectionHeading kicker={section.kicker} title={section.heading} />
              </div>
              <div className="md:col-span-7 md:col-start-6">
                <Prose body={section.body} />
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-24 flex flex-wrap gap-3 border-t border-fog/10 pt-12">
          <CtaLink href={path("/join")}>{t("cta.imIn")}</CtaLink>
          <CtaLink href={path("/#community")} variant="ghost">
            {t("cta.tellUs")}
          </CtaLink>
        </Reveal>
      </div>
    </>
  );
}
