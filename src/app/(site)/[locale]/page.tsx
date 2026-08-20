import type { Metadata } from "next";
import Link from "next/link";
import { CommunityForm } from "@/components/community-form";
import { CommunityVote } from "@/components/community-vote";
import { ExploreScene } from "@/components/explore/explore-section";
import { HeroBackdrop, ScrollCue } from "@/components/hero";
import { Reveal } from "@/components/reveal";
import {
  CommunityStatsRow,
  EarlyGuestSection,
  FinalCta,
  LandSection,
  SupportSection,
} from "@/components/sections";
import { ShareRow } from "@/components/share";
import { SocialRow, StatusPill } from "@/components/site-chrome";
import { CtaLink, EmptyState, PhaseRail, PostCard, Prose, SectionHeading } from "@/components/ui";
import { ContourField, CrossSectionDiagram, OrientationMap } from "@/components/visuals";
import { getCommunityStats, getPublishedIdeas } from "@/lib/community";
import { getPhases, getPosts, getSocialLinks, getStorySection } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";
import { joinFormLabels, landmarksFor } from "./shared";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  return {
    title: settings["seo.defaultTitle"],
    description: settings["seo.defaultDescription"],
    alternates: { canonical: absoluteUrl(path("/"), settings) },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, messages, t, settings, path } = await getPageContext(params);

  const phases = getPhases();
  const socials = getSocialLinks(settings);
  const updates = getPosts("update", { limit: 3 });
  const theIdea = getStorySection("the-idea");
  const whyHere = getStorySection("why-patagonia");
  const stats = getCommunityStats();
  const ideas = getPublishedIdeas(3);
  const shareUrl = absoluteUrl(path("/"), settings);

  return (
    <>
      {/* ── 01 · Hero ─────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[92svh] items-end overflow-hidden pt-28 pb-14 md:min-h-screen md:pb-20">
        <HeroBackdrop />
        <div className="shell relative w-full">
          <StatusPill label={settings["brand.statusLabel"]} note={settings["brand.statusNote"]} />

          <h1 className="mt-8 max-w-5xl font-display text-[3rem] leading-[0.95] tracking-tight md:text-[6.5rem]">
            {settings["brand.projectName"]}
          </h1>

          <p
            dir="auto"
            className="mt-6 max-w-2xl font-display text-xl leading-snug text-mist md:text-3xl"
          >
            {settings["brand.heroLine"]}
          </p>

          <p dir="auto" className="mt-6 max-w-xl text-[0.95rem] leading-relaxed text-fog">
            {settings["brand.heroIntro"]}
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <CtaLink href="#explore">{t("cta.explore")}</CtaLink>
            <CtaLink href="#community" variant="ghost">
              {t("cta.join")}
            </CtaLink>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-fog/10 pt-6">
            <p className="label text-fog">{settings["brand.locationLabel"]}</p>
            <div className="hidden md:block">
              <ScrollCue label={t("cta.followJourney")} />
            </div>
          </div>
        </div>
      </section>

      {/* ── 02 · The project ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24 md:py-32">
        <ContourField className="pointer-events-none absolute -end-1/4 -bottom-24 w-[150%] max-w-none text-fog/[0.06] md:w-[80%]" />
        <div className="shell relative grid gap-14 md:grid-cols-12">
          <Reveal className="md:col-span-5">
            <SectionHeading kicker="01 — The project" title={theIdea?.heading ?? "The idea"} />
          </Reveal>
          <Reveal className="md:col-span-6 md:col-start-7" delay={80}>
            <Prose body={settings["project.intro"]} />
            <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-fog/10 pt-8">
              {[
                { term: "Province", value: "Chubut, Argentina" },
                { term: "Department", value: "Futaleufú" },
                { term: "Founded by", value: "Welsh settlers of Y Wladfa" },
                { term: "Name means", value: "Town of the mill" },
              ].map((item) => (
                <div key={item.term}>
                  <dt className="label text-fog/60">{item.term}</dt>
                  <dd className="mt-2 font-display text-lg text-snow">{item.value}</dd>
                </div>
              ))}
            </dl>
            <Link
              href={path("/project")}
              className="label mt-8 inline-block text-ember transition-colors hover:text-snow"
            >
              {t("cta.discover")} →
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ── 03 · Why Trevelin ─────────────────────────────────────────── */}
      {whyHere ? (
        <section className="border-y border-fog/10 bg-loam/40 py-24 md:py-32">
          <div className="shell grid gap-14 md:grid-cols-12">
            <Reveal className="md:col-span-6">
              <SectionHeading kicker="03 — Why here" title={whyHere.heading} />
              <Prose body={whyHere.body} className="mt-8" />
            </Reveal>
            <Reveal className="md:col-span-5 md:col-start-8" delay={80}>
              <div className="card-stone grain relative p-6 md:p-8">
                <p className="label text-ember">The principle</p>
                <p className="mt-4 font-display text-2xl leading-snug text-snow">
                  Earth is the cheapest insulation there is — and here, the obvious one.
                </p>
                <p className="mt-5 text-sm leading-relaxed text-fog">
                  Soil holds temperature. A buried envelope swings far less between a Patagonian
                  August night and a February afternoon, which means less heating, less cooling, and
                  less equipment to maintain in a place where a replacement part is a long drive
                  away.
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      ) : null}

      {/* ── 04 · The land around us ───────────────────────────────────── */}
      <LandSection t={t} />

      {/* ── 05 · Explore Trevelin (map / 3D) ──────────────────────────── */}
      <section id="explore" className="scroll-mt-24 py-24 md:py-32">
        <div className="shell">
          <Reveal className="max-w-2xl">
            <SectionHeading kicker="05 — Explore" title={t("explore.title")} />
            <p className="prose-valley mt-6 text-fog">{t("explore.body")}</p>
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

          <Reveal className="mt-12 flex flex-wrap items-center gap-4 border-t border-fog/10 pt-8">
            <p className="font-display text-2xl text-snow">{t("explore.question")}</p>
            <CtaLink href="#community" variant="ghost">
              {t("cta.tellUs")}
            </CtaLink>
          </Reveal>
        </div>
      </section>

      {/* ── 06 · Architecture ─────────────────────────────────────────── */}
      <section className="border-y border-fog/10 bg-loam/40 py-24 md:py-32">
        <div className="shell">
          <Reveal className="card-stone grain relative overflow-hidden p-6 md:p-12">
            <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-center">
              <CrossSectionDiagram />
              <div>
                <p className="label text-ember">06 — Architecture</p>
                <h2 className="mt-4 font-display text-3xl leading-snug md:text-4xl">
                  How an earth-sheltered house actually works
                </h2>
                <p className="mt-5 text-sm leading-relaxed text-fog">
                  This is a drawing of the principle, not an engineered drawing of a finished
                  building. The hard parts of this kind of construction are not the shape — they are
                  the waterproofing, the drainage, and the weight of the soil sitting on the roof.
                  Those are exactly the questions the planning phase is working through now.
                </p>
                <Link
                  href={path("/project")}
                  className="label mt-7 inline-block text-ember transition-colors hover:text-snow"
                >
                  {t("cta.discover")} →
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 07 · The experience ───────────────────────────────────────── */}
      <section className="py-24 md:py-32">
        <div className="shell grid gap-14 md:grid-cols-12">
          <Reveal className="md:col-span-5">
            <SectionHeading kicker="07 — The experience" title={settings["stay.heading"]} />
          </Reveal>
          <Reveal className="md:col-span-6 md:col-start-7" delay={80}>
            <Prose body={settings["stay.body"]} />
            <Prose body={settings["project.stayConcept"]} className="mt-6" />
          </Reveal>
        </div>
      </section>

      {/* ── 08 · Progress ─────────────────────────────────────────────── */}
      <section className="border-y border-fog/10 bg-loam/40 py-24 md:py-32">
        <div className="shell">
          <Reveal className="max-w-3xl">
            <SectionHeading
              kicker="08 — Progress"
              title="Seven phases, and we are near the start of them"
            />
            <p className="prose-valley mt-6 text-fog">
              Every phase below carries its real status. Nothing gets marked complete before it is
              complete, and no percentage appears until there is something real to measure.
            </p>
          </Reveal>

          <Reveal className="mt-12 overflow-x-auto pb-2" delay={60}>
            <PhaseRail phases={phases} />
          </Reveal>

          <Reveal className="mt-12" delay={100}>
            <CtaLink href={path("/progress")} variant="ghost">
              {t("cta.followJourney")}
            </CtaLink>
          </Reveal>
        </div>
      </section>

      {/* ── 09 · Should we really build this house? ───────────────────── */}
      <section id="community" className="scroll-mt-24 py-24 md:py-32">
        <div className="shell">
          <Reveal className="max-w-2xl">
            <SectionHeading kicker="09 — Community" title={t("community.title")} />
            <p className="prose-valley mt-6 text-fog">{t("community.subtitle")}</p>
          </Reveal>

          <Reveal className="mt-12" delay={60}>
            <CommunityVote
              locale={locale}
              labels={{
                absolutely: t("community.absolutely"),
                absolutelyNote: t("community.absolutelyNote"),
                love: t("community.love"),
                loveNote: t("community.loveNote"),
                change: t("community.change"),
                changeNote: t("community.changeNote"),
                idea: t("community.idea"),
                ideaNote: t("community.ideaNote"),
                thanks: t("community.thanks"),
                ideaThanks: t("community.ideaThanks"),
                results: t("community.results"),
                noResults: t("community.noResults"),
                responses: t("community.responses"),
                name: t("form.name"),
                country: t("form.country"),
                email: t("form.email"),
                ideaField: t("form.idea"),
                optional: t("form.optional"),
                sendIdea: t("cta.sendIdea"),
                sending: t("form.sending"),
                privacy: t("form.privacy"),
                error: t("form.error"),
              }}
            />
          </Reveal>

          <CommunityStatsRow stats={stats} t={t} />
        </div>
      </section>

      {/* ── 10 · Ideas from the community ─────────────────────────────── */}
      {ideas.length > 0 ? (
        <section className="border-y border-fog/10 bg-loam/40 py-24 md:py-32">
          <div className="shell">
            <Reveal className="max-w-2xl">
              <SectionHeading kicker="10 — In their words" title="Ideas from the community" />
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {ideas.map((idea, i) => (
                <Reveal key={idea.id} delay={i * 60}>
                  <blockquote className="card-stone h-full p-6">
                    <p className="text-[0.95rem] leading-relaxed text-mist">“{idea.body}”</p>
                    <footer className="label mt-5 text-fog/60">
                      {[idea.name || "Anonymous", idea.country].filter(Boolean).join(" · ")}
                    </footer>
                  </blockquote>
                </Reveal>
              ))}
            </div>
            <p className="mt-8 text-xs text-fog/60">
              Ideas appear here only when the person who sent them gave a name and the project owner
              published the message.
            </p>
          </div>
        </section>
      ) : null}

      {/* ── 11 · Support ──────────────────────────────────────────────── */}
      <SupportSection t={t} path={path} />

      {/* ── 12 · Follow the journey ───────────────────────────────────── */}
      <section
        id="follow"
        className="relative overflow-hidden border-y border-fog/10 bg-loam/50 py-24 md:py-32"
      >
        <ContourField className="pointer-events-none absolute -bottom-32 start-0 w-[140%] max-w-none text-fog/[0.06] md:w-[70%]" />
        <div className="shell relative grid gap-14 md:grid-cols-12">
          <Reveal className="md:col-span-5">
            <p className="label text-ember">12 — {t("cta.followJourney")}</p>
            <h2 className="mt-5 font-display text-4xl leading-[1.05] md:text-6xl">
              {settings["community.headline"]}
            </h2>
            <p className="prose-valley mt-7 max-w-md text-fog">{settings["community.subtext"]}</p>

            {socials.length > 0 ? (
              <div className="mt-10">
                <p className="label mb-4 text-snow">Also on</p>
                <SocialRow links={socials} />
                <p className="mt-4 max-w-sm text-sm text-fog/70">{settings["social.note"]}</p>
              </div>
            ) : null}
          </Reveal>

          <Reveal className="md:col-span-6 md:col-start-7" delay={80}>
            <CommunityForm
              labels={joinFormLabels(t, settings)}
              locale={locale}
              source="home"
              idPrefix="home"
            />
          </Reveal>
        </div>
      </section>

      {/* ── 13 · Be one of the first guests ───────────────────────────── */}
      <EarlyGuestSection t={t} locale={locale} labels={joinFormLabels(t, settings)} />

      {/* ── 14 · Updates ──────────────────────────────────────────────── */}
      <section className="py-24 md:py-32">
        <div className="shell">
          <Reveal className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading kicker="14 — What's happened" title={t("nav.updates")} />
            <Link
              href={path("/updates")}
              className="label text-ember transition-colors hover:text-snow"
            >
              {t("cta.allUpdates")} →
            </Link>
          </Reveal>

          <div className="mt-12">
            {updates.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-3">
                {updates.map((post, i) => (
                  <Reveal key={post.id} delay={i * 70}>
                    <PostCard post={post} basePath={path("/updates")} />
                  </Reveal>
                ))}
              </div>
            ) : (
              <Reveal>
                <EmptyState
                  title="No updates published yet"
                  body="The first project update will appear here when there is something real to report. Nothing is invented to fill this space."
                  action={
                    <CtaLink href={path("/join")} variant="ghost">
                      {t("cta.keepPosted")}
                    </CtaLink>
                  }
                />
              </Reveal>
            )}
          </div>
        </div>
      </section>

      {/* ── 15 · Share ────────────────────────────────────────────────── */}
      <section className="border-t border-fog/10 py-16">
        <div className="shell flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="label text-fog/60">
              {settings["brand.locationLabel"]} · {formatDate(new Date().toISOString().slice(0, 10))}
            </p>
            <p className="mt-2 font-display text-2xl">{t("share.title")}</p>
          </div>
          <ShareRow
            url={shareUrl}
            text={`${settings["brand.projectName"]} — ${settings["brand.heroLine"]}`}
            labels={{
              title: t("share.title"),
              copy: t("share.copy"),
              copied: t("share.copied"),
              email: t("share.email"),
            }}
          />
        </div>
      </section>

      {/* ── 16 · Final call ───────────────────────────────────────────── */}
      <FinalCta t={t} path={path} />

      <span className="sr-only">{messages["misc.noFakeData"]}</span>
    </>
  );
}
