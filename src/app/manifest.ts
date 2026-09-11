import type { MetadataRoute } from "next";
import { defaultLocale } from "@/i18n/locales";

/**
 * The installed-app manifest.
 *
 * Served from the app root rather than under `[locale]`: a manifest is one
 * document per origin, and the browser fetches it without a language
 * negotiation. `start_url` is therefore *unprefixed* — the locale middleware
 * negotiates it on open, so a member who installed the app in Istanbul gets
 * Turkish and one in Berlin gets German from the same installed icon.
 *
 * `start_url` points at Discover rather than the marketing home. Someone who
 * installed the app is a member; sending them to a landing page that sells
 * them the product they already have is a wasted tap. Signed out, the same
 * URL lands on login.
 *
 * This file is also the Windows app. `mobile/microsoft-store/` packages this
 * manifest into an MSIX with PWABuilder rather than building a third native
 * shell, so several fields below exist for that packaging step and are noted
 * where they are not obvious.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    /**
     * The identity the app keeps forever.
     *
     * Absent, an installed app is identified by `start_url`, so moving Discover
     * would orphan every existing install and land as a second app beside the
     * first. It is declared now, while there is nothing to strand, and must not
     * be edited afterwards — not even to something tidier.
     */
    id: "/",
    name: "FioreMatch",
    short_name: "FioreMatch",
    description: "Meet people who are actually looking for the same thing you are.",
    lang: defaultLocale,
    dir: "ltr",
    start_url: "/app/discover",
    scope: "/",
    display: "standalone",
    /**
     * No orientation lock.
     *
     * It read `portrait`, which was harmless while this manifest only ever
     * described a phone install and wrong the moment it also described a
     * desktop window the member resizes. The native shells do not read this at
     * all — Android takes its orientation from the activity and iOS from
     * Info.plist — so the lock was never doing the job it looked like it was
     * doing on the two platforms it was written for.
     */
    background_color: "#fff5f7",
    theme_color: "#fb6f92",
    categories: ["social", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate entries: a launcher that crops a maskable icon would cut the
      // mark out of the "any" one, and one that doesn't crop would leave the
      // maskable one looking small and padded.
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ],
    /**
     * What the install prompt shows before anyone has seen the app.
     *
     * `form_factor` is the load-bearing part: a store or install dialog on a
     * desktop shows only `wide` entries and one on a phone only `narrow` ones,
     * so a set without both is a set that is empty on half the devices that ask.
     * These are the same captures `mobile/` cuts its store assets from, copied
     * into `public/` by `npm run capture` — the store folders are downstream of
     * the same files, so the listing and the install prompt cannot disagree.
     */
    screenshots: [
      {
        src: "/screenshots/desktop-discover.png",
        sizes: "1366x768",
        type: "image/png",
        form_factor: "wide",
        label: "Discover, with the reason for every match written on the card"
      },
      {
        src: "/screenshots/desktop-translation.png",
        sizes: "1366x768",
        type: "image/png",
        form_factor: "wide",
        label: "Messages translated in the conversation, the original kept underneath"
      },
      {
        src: "/screenshots/phone-discover.png",
        sizes: "1080x1920",
        type: "image/png",
        form_factor: "narrow",
        label: "Discover"
      },
      {
        src: "/screenshots/phone-translation.png",
        sizes: "1080x1920",
        type: "image/png",
        form_factor: "narrow",
        label: "Automatic translation"
      }
    ],
    shortcuts: [
      { name: "Today's 5", url: "/app/daily-five" },
      { name: "Matches", url: "/app/matches" }
    ]
  };
}
