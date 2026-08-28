import type { MetadataRoute } from "next";

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
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FioreMatch",
    short_name: "FioreMatch",
    description: "Meet people who are actually looking for the same thing you are.",
    start_url: "/app/discover",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
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
    shortcuts: [
      { name: "Today's 5", url: "/app/daily-five" },
      { name: "Matches", url: "/app/matches" }
    ]
  };
}
