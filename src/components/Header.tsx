import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Logo } from "./Logo";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function Header() {
  const t = useTranslations("nav");

  const links = [
    { href: "/dating", label: t("dating") },
    { href: "/international-dating", label: t("international") },
    { href: "/features", label: t("features") },
    { href: "/pricing", label: t("pricing") },
    { href: "/safety", label: t("safety") }
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-black/5 bg-white/85 backdrop-blur">
      <div className="container-fm flex h-16 items-center justify-between gap-4">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink/70 transition hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link href="/login" className="hidden text-sm font-semibold text-ink/70 hover:text-ink sm:inline">
            {t("login")}
          </Link>
          <Link href="/register" className="btn-primary !px-5 !py-2 text-sm">
            {t("join")}
          </Link>
        </div>
      </div>
    </header>
  );
}
