import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Logo";
import { countries } from "@/lib/countries-data";

export function Footer() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-black/5 bg-dusk-900 text-dusk-100">
      <div className="container-fm grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2 lg:col-span-2">
          <Logo className="text-white" />
          <p className="mt-3 max-w-xs text-sm text-dusk-200">{t("madeFor")}</p>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-dusk-300">{t("product")}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/dating" className="hover:text-white">{nav("dating")}</Link></li>
            <li><Link href="/international-dating" className="hover:text-white">{nav("international")}</Link></li>
            <li><Link href="/features" className="hover:text-white">{nav("features")}</Link></li>
            <li><Link href="/pricing" className="hover:text-white">{nav("pricing")}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-dusk-300">{t("company")}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/about" className="hover:text-white">{nav("about")}</Link></li>
            <li><Link href="/safety" className="hover:text-white">{nav("safety")}</Link></li>
            <li><Link href="/contact" className="hover:text-white">{nav("contact")}</Link></li>
            <li><Link href="/guides" className="hover:text-white">{t("resources")}</Link></li>
          </ul>
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-dusk-300">{t("legal")}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/legal/privacy" className="hover:text-white">{t("privacy")}</Link></li>
            <li><Link href="/legal/terms" className="hover:text-white">{t("terms")}</Link></li>
            <li><Link href="/legal/community-guidelines" className="hover:text-white">{t("guidelines")}</Link></li>
            <li><Link href="/legal/cookies" className="hover:text-white">{t("cookies")}</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-dusk-300">{nav("dating")}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {Object.values(countries).map((c) => (
              <li key={c.slug}>
                <Link href={`/dating/${c.slug}`} className="hover:text-white">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-fm flex flex-col gap-2 py-6 text-xs text-dusk-300 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} FioreMatch. {t("rights")}</p>
          <p>fiorematch.com</p>
        </div>
      </div>
    </footer>
  );
}
