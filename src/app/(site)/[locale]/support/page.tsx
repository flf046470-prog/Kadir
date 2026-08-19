import type { Metadata } from "next";
import { Reveal } from "@/components/reveal";
import { SupportSection } from "@/components/sections";
import { PageHeader, SectionHeading } from "@/components/ui";
import { getListedSupporters } from "@/lib/community";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "Support the project";
  const description =
    "Ways to help Patagonia Underground take its next step — following, joining the list, sending an idea. Financial support is not open, and no payment system is connected.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/support"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/support"), settings) },
  };
}

export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t, path } = await getPageContext(params);
  const supporters = getListedSupporters();

  return (
    <>
      <PageHeader kicker={t("nav.support")} title={t("support.title")} intro={t("support.body")} />

      <div className="shell py-20 md:py-28">
        <SupportSection t={t} path={path} compact />

        <Reveal className="mt-20 border-t border-fog/10 pt-16">
          <SectionHeading kicker="Credit" title={t("support.supporters")} />
          {supporters.length > 0 ? (
            <ul className="mt-8 flex flex-wrap gap-3">
              {supporters.map((supporter) => (
                <li
                  key={supporter.id}
                  className="rounded-full border border-fog/20 px-4 py-2 text-sm text-mist"
                >
                  {supporter.display_name}
                  {supporter.country ? (
                    <span className="text-fog/50"> · {supporter.country}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="prose-valley mt-6 max-w-2xl text-fog">{t("support.noSupporters")}</p>
          )}
          <p className="mt-6 max-w-2xl text-xs leading-relaxed text-fog/60">
            A name appears here only if the person who gave it ticked “{t("support.listMe")}”. Email
            addresses are never shown, and nobody is listed automatically.
          </p>
        </Reveal>
      </div>
    </>
  );
}
