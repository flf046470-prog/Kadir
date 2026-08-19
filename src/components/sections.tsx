import Link from "next/link";
import type { Translator } from "@/lib/i18n";
import type { CommunityStats } from "@/lib/community";
import { getAirbnbUrl, getPaymentConfig } from "@/lib/config";
import { CommunityForm } from "./community-form";
import { CtaLink, SectionHeading } from "./ui";
import { ContourField } from "./visuals";
import { Reveal } from "./reveal";

/* ── the land around us ───────────────────────────────────────────────── */

const LAND_ITEMS = [
  {
    key: "land.mountain",
    index: "01",
    body: "West of the town the cordillera rises toward the Chilean border — the wall that gives this valley its weather.",
    art: "ridge",
  },
  {
    key: "land.forest",
    index: "02",
    body: "Andean-Patagonian forest, and north-west of Trevelin the alerce stands of Los Alerces National Park, a UNESCO World Heritage site.",
    art: "trees",
  },
  {
    key: "land.water",
    index: "03",
    body: "Rivers and lakes shape the whole department — the Futaleufú system runs west from here toward the border.",
    art: "water",
  },
  {
    key: "land.sky",
    index: "04",
    body: "Open sky in every direction, and the long light of a southern latitude at either end of the day.",
    art: "sky",
  },
  {
    key: "land.trails",
    index: "05",
    body: "Gravel roads and tracks run out of town into the hills. Specific routes are not listed here until they have been walked and checked.",
    art: "trail",
  },
  {
    key: "land.town",
    index: "06",
    body: "A small Welsh-founded town with a mill museum, tea houses, and tulip fields that open in spring.",
    art: "town",
  },
] as const;

function LandArt({ kind }: { kind: string }) {
  const common = "h-full w-full text-fog/25";
  if (kind === "ridge")
    return (
      <svg viewBox="0 0 200 100" className={common} fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M0 88 L34 46 L52 62 L82 26 L104 54 L132 34 L158 66 L200 42" strokeWidth="1.5" />
        <path d="M82 26 L92 38 L98 33 L104 54" fill="currentColor" opacity="0.5" stroke="none" />
      </svg>
    );
  if (kind === "trees")
    return (
      <svg viewBox="0 0 200 100" className={common} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M0 88h200" />
        {[24, 58, 92, 126, 160].map((x, i) => (
          <g key={x}>
            <path d={`M${x} 88V${58 - i * 3}`} />
            <path d={`M${x - 12} ${72 - i * 2} L${x} ${48 - i * 3} L${x + 12} ${72 - i * 2}`} />
          </g>
        ))}
      </svg>
    );
  if (kind === "water")
    return (
      <svg viewBox="0 0 200 100" className={common} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M0 40c30 0 30 12 60 12s30-12 60-12 30 12 60 12" />
        <path d="M0 60c30 0 30 12 60 12s30-12 60-12 30 12 60 12" opacity="0.6" />
        <path d="M0 80c30 0 30 12 60 12s30-12 60-12 30 12 60 12" opacity="0.35" />
      </svg>
    );
  if (kind === "sky")
    return (
      <svg viewBox="0 0 200 100" className={common} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="150" cy="34" r="14" />
        <path d="M0 78h200M0 62h120M0 46h70" opacity="0.5" />
      </svg>
    );
  if (kind === "trail")
    return (
      <svg viewBox="0 0 200 100" className={common} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M20 96C60 70 40 52 90 40s70-8 96-24" strokeDasharray="7 7" />
        <path d="M0 96h200" opacity="0.4" />
      </svg>
    );
  return (
    <svg viewBox="0 0 200 100" className={common} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M0 88h200" />
      <path d="M40 88V56l18-14 18 14v32M96 88V62l16-12 16 12v26" />
      <path d="M140 88V44l8-8 8 8v44" />
    </svg>
  );
}

export function LandSection({ t }: { t: Translator }) {
  return (
    <section className="border-y border-fog/10 bg-loam/40 py-24 md:py-32">
      <div className="shell">
        <Reveal className="max-w-2xl">
          <SectionHeading kicker="04 — The land" title={t("land.title")} />
        </Reveal>
        <div className="mt-14 grid gap-px overflow-hidden border border-fog/10 bg-fog/10 sm:grid-cols-2 lg:grid-cols-3">
          {LAND_ITEMS.map((item, i) => (
            <Reveal key={item.key} className="bg-basalt" delay={i * 50}>
              <article className="flex h-full flex-col p-6 md:p-8">
                <div className="h-20">
                  <LandArt kind={item.art} />
                </div>
                <p className="label mt-6 text-fog/50">{item.index}</p>
                <h3 className="mt-2 font-display text-2xl">{t(item.key)}</h3>
                <p className="mt-3 text-sm leading-relaxed text-fog">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── community statistics ─────────────────────────────────────────────── */

/** Renders nothing at all until at least one real figure exists. */
export function CommunityStatsRow({ stats, t }: { stats: CommunityStats; t: Translator }) {
  const items = [
    { label: t("community.saidYes"), value: stats.saidYes },
    { label: t("community.ideasReceived"), value: stats.ideas },
    { label: t("community.countries"), value: stats.countries },
    { label: t("community.waiting"), value: stats.earlyAccess },
  ].filter((item) => item.value > 0);

  if (items.length === 0) return null;

  return (
    <div className="mt-14 border-t border-fog/10 pt-10">
      <p className="label text-fog/60">{t("community.statsTitle")}</p>
      <dl className="mt-6 grid grid-cols-2 gap-8 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label}>
            <dd className="font-display text-4xl text-snow md:text-5xl">{item.value}</dd>
            <dt className="label mt-2 text-fog/70">{item.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── support ──────────────────────────────────────────────────────────── */

export function SupportSection({
  t,
  path,
  compact = false,
}: {
  t: Translator;
  path: (href: string) => string;
  compact?: boolean;
}) {
  const payments = getPaymentConfig();

  const options = [
    { title: t("support.follow"), note: t("support.followNote"), href: path("/updates"), cta: t("cta.followJourney") },
    { title: t("support.emailList"), note: t("support.emailListNote"), href: path("/join"), cta: t("cta.keepPosted") },
    { title: t("support.shareIdea"), note: t("support.shareIdeaNote"), href: path("/#community"), cta: t("cta.haveIdea") },
    { title: t("support.earlyGuest"), note: t("support.earlyGuestNote"), href: path("/join#early"), cta: t("cta.joinEarly") },
  ];

  return (
    <section id="support" className={compact ? "" : "py-24 md:py-32"}>
      <div className={compact ? "" : "shell"}>
        <Reveal className="max-w-2xl">
          <SectionHeading kicker="11 — Support" title={t("support.title")} />
          <p className="prose-valley mt-6 text-fog">{t("support.body")}</p>
        </Reveal>

        <div className="mt-12 grid gap-px overflow-hidden border border-fog/10 bg-fog/10 sm:grid-cols-2">
          {options.map((option, i) => (
            <Reveal key={option.title} className="bg-basalt" delay={i * 50}>
              <Link href={option.href} className="group flex h-full flex-col justify-between p-6 md:p-8">
                <div>
                  <h3 className="font-display text-2xl transition-colors group-hover:text-ember">
                    {option.title}
                  </h3>
                  <p className="mt-3 text-sm text-fog">{option.note}</p>
                </div>
                <span className="label mt-8 text-snow transition-colors group-hover:text-ember">
                  {option.cta} →
                </span>
              </Link>
            </Reveal>
          ))}
        </div>

        {/* Financial support: the honest state of it, not a mock checkout. */}
        <Reveal className="card-stone mt-6 p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-lg">
              <h3 className="font-display text-2xl">{t("support.build")}</h3>
              <p className="mt-3 text-sm text-fog">{t("support.notConnected")}</p>
            </div>
            <span className="rounded-full border border-fog/25 px-5 py-3 text-xs tracking-[0.14em] text-fog/70 uppercase">
              {t("support.comingSoon")}
            </span>
          </div>

          {payments.enabled ? (
            <p className="mt-6 text-sm text-fog">
              A payment provider is configured. Amounts:{" "}
              {payments.presetAmounts.join(", ")} {payments.defaultCurrency}.
            </p>
          ) : null}

          <p className="mt-6 border-t border-fog/10 pt-6 text-xs leading-relaxed text-fog/70">
            {t("support.disclaimer")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ── early guests / Airbnb ────────────────────────────────────────────── */

export function EarlyGuestSection({
  t,
  locale,
  labels,
}: {
  t: Translator;
  locale: string;
  labels: Parameters<typeof CommunityForm>[0]["labels"];
}) {
  const airbnbUrl = getAirbnbUrl();

  return (
    <section
      id="early"
      className="relative overflow-hidden border-y border-fog/10 bg-loam/50 py-24 md:py-32"
    >
      <ContourField className="pointer-events-none absolute -bottom-24 start-0 w-[140%] max-w-none text-fog/[0.06] md:w-[70%]" />
      <div className="shell relative grid gap-14 md:grid-cols-12">
        <Reveal className="md:col-span-5">
          <SectionHeading kicker="13 — Early guests" title={t("airbnb.title")} />
          <p className="prose-valley mt-6 text-fog">{t("airbnb.body")}</p>

          <div className="mt-8">
            {airbnbUrl ? (
              <a
                href={airbnbUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-snow px-7 py-4 text-xs font-medium tracking-[0.14em] text-basalt uppercase transition-colors hover:bg-ember"
              >
                {t("airbnb.book")}
              </a>
            ) : (
              <p className="rounded-sm border border-fog/15 bg-basalt/40 p-5 text-sm text-fog">
                {t("airbnb.notOpen")}
              </p>
            )}
          </div>
        </Reveal>

        <Reveal className="md:col-span-6 md:col-start-7" delay={80}>
          <CommunityForm
            labels={labels}
            locale={locale}
            source="early-access"
            idPrefix="early"
            hiddenInterests={["early_guest", "reservations", "opening"]}
          />
        </Reveal>
      </div>
    </section>
  );
}

/* ── final call ───────────────────────────────────────────────────────── */

export function FinalCta({ t, path }: { t: Translator; path: (href: string) => string }) {
  return (
    <section className="py-24 md:py-36">
      <div className="shell">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-4xl leading-[1.05] md:text-6xl">{t("final.title")}</h2>
          <p className="prose-valley mt-6 text-fog">{t("final.body")}</p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <CtaLink href={path("/join")}>{t("cta.imIn")}</CtaLink>
            <CtaLink href={path("/#community")} variant="ghost">
              {t("cta.haveIdea")}
            </CtaLink>
            <CtaLink href={path("/join#early")} variant="ghost">
              {t("cta.notifyMe")}
            </CtaLink>
          </div>
          <p className="label mt-10 text-fog/50">
            No booking · No payment · No deposit · Nothing to buy
          </p>
        </Reveal>
      </div>
    </section>
  );
}
