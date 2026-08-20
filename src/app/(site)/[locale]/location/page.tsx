import type { Metadata } from "next";
import { ExploreScene } from "@/components/explore/explore-section";
import { Reveal } from "@/components/reveal";
import { CtaLink, PageHeader, Prose, SectionHeading } from "@/components/ui";
import { OrientationMap } from "@/components/visuals";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";
import { landmarksFor } from "../shared";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "Trevelin, Chubut — where this is";
  const description =
    "Trevelin sits in the Futaleufú Department of Chubut, in the Andean west of Argentine Patagonia, near Los Alerces National Park and the Futaleufú border crossing.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/location"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/location"), settings) },
  };
}

export default async function LocationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t, settings, path } = await getPageContext(params);

  return (
    <>
      <PageHeader
        kicker={t("nav.location")}
        title="Trevelin · Chubut · Patagonia"
        intro={settings["location.intro"]}
      />

      <div className="shell py-20 md:py-28">
        <Reveal>
          <SectionHeading kicker="Orientation" title={t("explore.title")} />
          <p className="prose-valley mt-6 max-w-2xl text-fog">{t("explore.body")}</p>
        </Reveal>

        <Reveal className="mt-12" delay={60}>
          <ExploreScene
            landmarks={landmarksFor(t)}
            labels={{
              title: t("explore.title"),
              body: t("explore.body"),
              load: t("explore.load"),
              without: t("explore.without"),
              unsupported: t("explore.unsupported"),
              map: t("explore.map"),
              view3d: t("explore.3d"),
              hint: t("explore.hint"),
              conceptual: "Conceptual — not survey data",
            }}
            mapView={<OrientationMap className="h-full max-h-[26rem] w-full" />}
          />
        </Reveal>

        <div className="mt-24 grid gap-12 border-t border-fog/10 pt-16 md:grid-cols-2">
          <Reveal>
            <SectionHeading kicker="The plot" title="Where exactly?" />
            <Prose body={settings["location.plotNote"]} className="mt-6" />
            <dl className="mt-8 border-t border-fog/10 pt-6">
              <dt className="label text-fog/60">Reference coordinates</dt>
              <dd className="mt-2 font-display text-xl text-snow">
                {settings["location.coordinates"]}
              </dd>
            </dl>
          </Reveal>

          <Reveal delay={60}>
            <SectionHeading kicker="Getting there" title="Travel notes" />
            <Prose body={settings["location.travelNotes"]} className="mt-6" />
          </Reveal>
        </div>

        <Reveal className="mt-20 border-t border-fog/10 pt-16">
          <SectionHeading kicker="Nearby" title="What is around Trevelin" />
          <ul className="mt-10 grid gap-px overflow-hidden border border-fog/10 bg-fog/10 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Los Alerces National Park",
                body: "North-west of the town. A UNESCO World Heritage site since 2017, protecting alerce (Fitzroya cupressoides) forest.",
              },
              {
                title: "Esquel",
                body: "The nearest larger town, roughly 25 km north, with the closest airport and long-distance bus connections.",
              },
              {
                title: "Futaleufú border crossing",
                body: "Route 259 runs west from Trevelin toward the Chilean border. Opening hours change — check before travelling.",
              },
              {
                title: "Molino Nant Fach",
                body: "A mill museum outside town that keeps the Welsh settlement's story, and the story behind the name Trevelin.",
              },
              {
                title: "Welsh tea houses",
                body: "Trevelin's casas de té are part of the Y Wladfa inheritance, and still very much a local institution.",
              },
              {
                title: "Tulip fields",
                body: "A working tulip farm outside the town flowers in the southern spring — usually October, weather permitting.",
              },
            ].map((item, i) => (
              <li key={item.title} className="bg-basalt p-6 md:p-8">
                <p className="label text-fog/50">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-2 font-display text-2xl">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-fog">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-fog/60">
            Distances, opening hours and seasons change. Check anything you plan to travel on at the
            time of travel rather than trusting a website.
          </p>
        </Reveal>

        <Reveal className="mt-16">
          <CtaLink href={path("/join")}>{t("cta.keepPosted")}</CtaLink>
        </Reveal>
      </div>
    </>
  );
}
