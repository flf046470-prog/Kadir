import Link from "next/link";
import { DomeMark } from "./visuals";
import { NAV_LINKS } from "@/lib/nav";
import type { SocialLink } from "@/lib/content";
import { MobileNav } from "./mobile-nav";
import { LanguageSwitcher } from "./language-switcher";
import { createTranslator, localePath, type Locale, type Messages } from "@/lib/i18n";

export function StatusPill({ label, note }: { label: string; note?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-fog/20 bg-loam/70 px-3 py-1.5 backdrop-blur-sm"
      title={note}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ember" />
      </span>
      <span className="label text-mist">{label}</span>
    </span>
  );
}

export function SiteHeader({
  projectName,
  locale,
  messages,
}: {
  projectName: string;
  locale: Locale;
  messages: Messages;
}) {
  const t = createTranslator(messages);
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-fog/10 bg-basalt/80 backdrop-blur-md">
      <div className="shell flex h-16 items-center justify-between gap-4 md:h-20">
        <Link
          href={localePath("/", locale)}
          className="flex items-center gap-3 text-snow"
          aria-label={`${projectName} — ${t("nav.home")}`}
        >
          <DomeMark className="h-8 w-8 shrink-0 text-ember" />
          <span className="flex flex-col leading-none">
            <span className="font-display text-[0.95rem] tracking-wide md:text-base">
              {projectName}
            </span>
            <span className="label mt-1 hidden text-[0.6rem] text-fog/70 sm:block">
              Trevelin · Patagonia
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-5 xl:flex">
          {NAV_LINKS.slice(0, 7).map((link) => (
            <Link
              key={link.href}
              href={localePath(link.href, locale)}
              className="nav-link text-sm text-fog transition-colors hover:text-snow"
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher
            locale={locale}
            label={t("nav.language")}
            searchLabel={t("nav.searchLanguage")}
          />
          <Link
            href={localePath("/join", locale)}
            data-magnetic
            className="cta-press hidden rounded-full bg-snow px-4 py-2 text-xs font-medium tracking-wide text-basalt hover:bg-ember sm:inline-block"
          >
            {t("cta.join")}
          </Link>
          <MobileNav
            locale={locale}
            labels={{
              menu: t("nav.menu"),
              close: t("nav.close"),
              join: t("cta.join"),
              items: NAV_LINKS.map((link) => ({ href: link.href, label: t(link.key) })),
            }}
          />
        </div>
      </div>
    </header>
  );
}

const SOCIAL_ICONS: Record<string, string> = {
  Instagram:
    "M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.22 1 .48 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4Zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3Zm6.9-11.1a1.5 1.5 0 1 1-1.6-1.6 1.5 1.5 0 0 1 1.6 1.6Z",
  TikTok:
    "M16.6 5.8a4.9 4.9 0 0 1-1.2-3.2h-3.2v12.7a2.8 2.8 0 1 1-2-2.7V9.3a6 6 0 1 0 5.2 5.9V9.1a8 8 0 0 0 4.6 1.5V7.4a4.8 4.8 0 0 1-3.4-1.6Z",
  YouTube:
    "M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15.1V8.9l5.2 3.1Z",
  Facebook:
    "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z",
  X: "M17.5 3h3.1l-6.8 7.8L21.8 21h-6.2l-4.9-6.4L5 21H1.9l7.3-8.3L2.2 3h6.3l4.4 5.8Zm-1.1 16h1.7L7.7 4.8H5.9Z",
};

export function SocialRow({
  links,
  className = "",
  size = "md",
}: {
  links: SocialLink[];
  className?: string;
  size?: "sm" | "md";
}) {
  if (links.length === 0) return null;
  const box = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  return (
    <ul className={`flex flex-wrap items-center gap-2 ${className}`}>
      {links.map((link) => (
        <li key={link.key}>
          <a
            href={link.url}
            target="_blank"
            rel="me noopener noreferrer"
            className={`${box} flex items-center justify-center rounded-full border border-fog/20 text-fog transition-colors hover:border-ember hover:text-ember`}
            aria-label={link.label}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-[18px] w-[18px]"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d={SOCIAL_ICONS[link.label] ?? SOCIAL_ICONS.X} />
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SiteFooter({
  projectName,
  locationLabel,
  socials,
  statusLabel,
  locale,
  messages,
}: {
  projectName: string;
  locationLabel: string;
  socials: SocialLink[];
  statusLabel: string;
  locale: Locale;
  messages: Messages;
}) {
  const t = createTranslator(messages);
  const year = new Date().getFullYear();

  return (
    <footer data-motion="footer" className="relative mt-24 border-t border-fog/10 bg-loam/40">
      <div className="shell grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr] md:py-20">
        <div>
          <div className="flex items-center gap-3 text-snow">
            <DomeMark className="h-9 w-9 text-ember" />
            <span className="font-display text-lg">{projectName}</span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-fog">
            An earth-sheltered house being planned in{" "}
            {locationLabel.split("·")[0]?.trim() || "Trevelin"}. Followed in public, from the first
            sketch onward.
          </p>
          <p className="label mt-6 text-fog/70">{statusLabel}</p>
          {locale !== "en" ? (
            <p className="mt-4 max-w-sm text-xs leading-relaxed text-fog/60">
              {t("misc.contentInEnglish")}
            </p>
          ) : null}
        </div>

        <nav aria-label="Footer">
          <p className="label mb-4 text-snow">{t("nav.project")}</p>
          <ul className="space-y-2.5 text-sm">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={localePath(link.href, locale)}
                  className="text-fog transition-colors hover:text-snow"
                >
                  {t(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className="label mb-4 text-snow">{t("cta.followJourney")}</p>
          <SocialRow links={socials} size="sm" />
          {socials.length === 0 ? (
            <p className="text-sm text-fog/70">
              Social channels will be listed here once they are live.
            </p>
          ) : null}
          <Link
            href={localePath("/join", locale)}
            className="mt-6 inline-block rounded-full border border-fog/25 px-4 py-2 text-xs tracking-wide text-snow transition-colors hover:border-ember hover:text-ember"
          >
            {t("cta.keepPosted")}
          </Link>
        </div>
      </div>

      <div className="shell flex flex-col gap-3 border-t border-fog/10 py-6 text-xs text-fog/60 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {projectName}. {locationLabel}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href={localePath("/privacy", locale)} className="hover:text-snow">
            {t("misc.privacy")}
          </Link>
          <Link href={localePath("/terms", locale)} className="hover:text-snow">
            {t("misc.terms")}
          </Link>
          <Link href={localePath("/transparency", locale)} className="hover:text-snow">
            {t("nav.transparency")}
          </Link>
        </p>
      </div>
    </footer>
  );
}
