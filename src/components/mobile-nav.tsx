"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localePath, type Locale } from "@/lib/i18n";

export type MobileNavLabels = {
  menu: string;
  close: string;
  join: string;
  items: { href: string; label: string }[];
};

export function MobileNav({ locale, labels }: { locale: Locale; labels: MobileNavLabels }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-fog/20 text-snow xl:hidden"
      >
        <span className="sr-only">{open ? labels.close : labels.menu}</span>
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          ) : (
            <path d="M4 8h16M4 16h16" strokeLinecap="round" />
          )}
        </svg>
      </button>

      <div
        id="mobile-nav-panel"
        hidden={!open}
        className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-fog/10 bg-basalt/95 backdrop-blur-lg md:top-20 xl:hidden"
      >
        <nav aria-label="Mobile" className="shell flex flex-col py-6">
          {labels.items.map((link) => {
            const href = localePath(link.href, locale);
            return (
              <Link
                key={link.href}
                href={href}
                onClick={() => setOpen(false)}
                className={`border-b border-fog/10 py-4 font-display text-2xl transition-colors ${
                  pathname === href ? "text-ember" : "text-snow hover:text-ember"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <Link
            href={localePath("/join", locale)}
            onClick={() => setOpen(false)}
            className="mt-8 rounded-full bg-snow px-6 py-4 text-center text-sm font-medium tracking-wide text-basalt"
          >
            {labels.join}
          </Link>
        </nav>
      </div>
    </>
  );
}
