"use client";

import { useLocale } from "next-intl";
import { locales, localeNames, type Locale } from "@/i18n/locales";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  function handleChange(next: string) {
    router.replace(pathname, { locale: next as Locale });
  }

  return (
    <>
      <Select locale={locale} onChange={handleChange} compact className="sm:hidden" />
      <Select locale={locale} onChange={handleChange} className="hidden sm:inline-flex" />
    </>
  );
}

function Select({
  locale,
  onChange,
  compact = false,
  className = ""
}: {
  locale: Locale;
  onChange: (next: string) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <label className={`relative items-center ${className}`}>
      <span className="sr-only">Language</span>
      <select
        aria-label="Select language"
        value={locale}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none rounded-full border border-black/10 bg-white py-2 pl-3 pr-7 text-sm font-medium text-ink hover:border-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-bloom-400"
      >
        {locales.map((l) => (
          <option key={l} value={l}>
            {compact ? l.toUpperCase() : localeNames[l]}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/50"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.19l3.71-3.96a.75.75 0 111.1 1.02l-4.25 4.53a.75.75 0 01-1.1 0L5.21 8.27a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </label>
  );
}
