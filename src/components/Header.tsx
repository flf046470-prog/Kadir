import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Logo } from "./Logo";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { HeaderShell } from "./HeaderShell";

/**
 * Marketing header.
 *
 * Colours are inherited from `HeaderShell`, which is transparent over the hero
 * and solid once scrolled. Links use `currentColor` with opacity rather than a
 * fixed ink colour, so one set of classes stays legible in both states.
 */
export function Header() {
  const t = useTranslations("nav");

  const links = [
    { href: "/how-matching-works", label: t("matching") },
    { href: "/global-match", label: t("globalMatch") },
    { href: "/features", label: t("features") },
    { href: "/pricing", label: t("pricing") },
    { href: "/safety", label: t("safety") }
  ];

  return (
    <HeaderShell>
      <div className="container-fm flex h-16 items-center justify-between gap-4">
        <Link href="/" className="shrink-0">
          <Logo className="!text-current" />
        </Link>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium opacity-75 transition hover:opacity-100"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link
            href="/login"
            className="hidden text-sm font-semibold opacity-75 transition hover:opacity-100 sm:inline"
          >
            {t("login")}
          </Link>
          <Link href="/register" className="btn-primary !px-5 !py-2 text-sm">
            {t("join")}
          </Link>
        </div>
      </div>
    </HeaderShell>
  );
}
