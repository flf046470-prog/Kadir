"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The bottom tab bar, phones only.
 *
 * The signed-in header is a row of six links plus a name and a logout button.
 * That is fine at a desk and unusable at 390px, where it either wraps into
 * three lines or scrolls sideways. Below `sm` this replaces it with the five
 * destinations that are actually a destination; moderation and logout stay in
 * the header, which is still there above it.
 *
 * `env(safe-area-inset-bottom)` is what keeps the row clear of the iPhone home
 * indicator once the layout paints under it — without it the tabs sit *behind*
 * the indicator and the bottom few pixels stop responding to taps.
 */

type Tab = { href: string; label: string; icon: ReactNode };

export function MobileTabs({
  locale,
  labels
}: {
  locale: string;
  labels: {
    dailyFive: string;
    discover: string;
    matches: string;
    referral: string;
    profile: string;
  };
}) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { href: "/app/daily-five", label: labels.dailyFive, icon: <IconFive /> },
    { href: "/app/discover", label: labels.discover, icon: <IconDiscover /> },
    { href: "/app/matches", label: labels.matches, icon: <IconMatches /> },
    { href: "/app/referral", label: labels.referral, icon: <IconInvite /> },
    { href: "/app/profile", label: labels.profile, icon: <IconProfile /> }
  ];

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const href = `/${locale}${tab.href}`;
          // A conversation lives under /app/matches/<id>, and it should light
          // the Matches tab — hence prefix rather than equality.
          const active = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={tab.href} className="flex-1">
              <a
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2 text-[10px] font-medium ${
                  active ? "text-bloom-600" : "text-ink/50"
                }`}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span className="max-w-full truncate px-1">{tab.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* Inline rather than an icon package: five glyphs is not worth a dependency,
   and these inherit `currentColor` so the active state needs no second asset. */

const stroke = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const
};

function IconFive() {
  return (
    <svg {...stroke}>
      <path d="M12 3.5 14.3 9l5.7.4-4.4 3.8 1.4 5.6L12 15.7 7 18.8l1.4-5.6L4 9.4 9.7 9Z" />
    </svg>
  );
}

function IconDiscover() {
  return (
    <svg {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

function IconMatches() {
  return (
    <svg {...stroke}>
      <path d="M20.5 6.5A4.6 4.6 0 0 0 12 5a4.6 4.6 0 0 0-8.5 1.5c0 4.6 6 8.4 8.5 10 2.5-1.6 8.5-5.4 8.5-10Z" />
    </svg>
  );
}

function IconInvite() {
  return (
    <svg {...stroke}>
      <path d="M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M18 6.5v5M20.5 9h-5" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg {...stroke}>
      <path d="M19 20v-1.8A4.2 4.2 0 0 0 14.8 14H9.2A4.2 4.2 0 0 0 5 18.2V20" />
      <circle cx="12" cy="7.5" r="3.8" />
    </svg>
  );
}
