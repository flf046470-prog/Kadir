"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LOCALES, isLocale, type Locale } from "@/lib/i18n";

/**
 * 24 languages is too many for a plain select, so the trigger stays small
 * (the current code) and opens a searchable list.
 */
export function LanguageSwitcher({
  locale,
  label,
  searchLabel,
}: {
  locale: Locale;
  label: string;
  searchLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return LOCALES;
    return LOCALES.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        item.native.toLowerCase().includes(needle) ||
        item.code.includes(needle),
    );
  }, [query]);

  /** Swaps only the locale segment, so the visitor stays on the same page. */
  function switchTo(next: Locale) {
    const segments = (pathname || "/").split("/");
    if (isLocale(segments[1])) segments[1] = next;
    else segments.splice(1, 0, next);
    setOpen(false);
    setQuery("");
    router.push(segments.join("/") || `/${next}`);
    router.refresh();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="flex h-10 items-center gap-1.5 rounded-full border border-fog/20 px-3 text-xs tracking-[0.14em] text-fog uppercase transition-colors hover:border-ember hover:text-ember"
      >
        {locale}
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="absolute end-0 z-50 mt-2 w-64 overflow-hidden rounded-sm border border-fog/15 bg-loam shadow-2xl shadow-black/50">
          <div className="border-b border-fog/10 p-2">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchLabel}
              aria-label={searchLabel}
              className="w-full rounded-sm bg-basalt/70 px-3 py-2 text-sm text-snow placeholder:text-fog/50 focus:outline-none"
            />
          </div>
          <ul role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
            {matches.map((item) => (
              <li key={item.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.code === locale}
                  onClick={() => switchTo(item.code)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-sm transition-colors hover:bg-stone ${
                    item.code === locale ? "text-ember" : "text-mist"
                  }`}
                >
                  <span>{item.native}</span>
                  <span className="label text-fog/50">{item.code}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="px-4 py-3 text-sm text-fog/60">—</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
