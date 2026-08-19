import type { Metadata } from "next";
import { CommunityForm } from "@/components/community-form";
import { Reveal } from "@/components/reveal";
import { EarlyGuestSection } from "@/components/sections";
import { ShareRow } from "@/components/share";
import { SocialRow } from "@/components/site-chrome";
import { PageHeader, SectionHeading } from "@/components/ui";
import { getSocialLinks } from "@/lib/content";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";
import { joinFormLabels } from "../shared";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "Follow Patagonia Underground";
  const description =
    "Join the update list and follow an earth-sheltered house being built in Trevelin, Patagonia — from planning to the day it opens. No payment, nothing to buy.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/join"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/join"), settings) },
  };
}

export default async function JoinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, t, settings, path } = await getPageContext(params);
  const socials = getSocialLinks(settings);
  const labels = joinFormLabels(t, settings);

  return (
    <>
      <PageHeader
        kicker={t("cta.followJourney")}
        title={settings["community.headline"]}
        intro={settings["community.subtext"]}
      />

      <div className="shell py-20 md:py-28">
        <div className="grid gap-14 md:grid-cols-12">
          <Reveal className="md:col-span-6">
            <CommunityForm labels={labels} locale={locale} source="join" idPrefix="join" />
          </Reveal>

          <Reveal className="md:col-span-5 md:col-start-8" delay={80}>
            <SectionHeading kicker="What you get" title="Nothing you didn't ask for" />
            <ul className="mt-8 divide-y divide-fog/10 border-y border-fog/10">
              {[
                "Updates only when something real happens on the project.",
                "No selling, no sharing with anyone else, no third-party marketing.",
                "One click unsubscribes you, permanently.",
                "You can pick exactly which kinds of news you want above.",
              ].map((item) => (
                <li key={item} className="py-4 text-sm leading-relaxed text-mist">
                  {item}
                </li>
              ))}
            </ul>

            {socials.length > 0 ? (
              <div className="mt-10">
                <p className="label mb-4 text-snow">{t("cta.followJourney")}</p>
                <SocialRow links={socials} />
              </div>
            ) : null}

            <div className="mt-10 border-t border-fog/10 pt-8">
              <ShareRow
                url={absoluteUrl(path("/"), settings)}
                text={`${settings["brand.projectName"]} — ${settings["brand.heroLine"]}`}
                labels={{
                  title: t("share.title"),
                  copy: t("share.copy"),
                  copied: t("share.copied"),
                  email: t("share.email"),
                }}
              />
            </div>
          </Reveal>
        </div>
      </div>

      <EarlyGuestSection t={t} locale={locale} labels={labels} />
    </>
  );
}
