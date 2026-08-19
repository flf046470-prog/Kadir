import "server-only";

import { getSettings } from "./content";
import { seedIfEmpty } from "./seed";

export { NAV_LINKS } from "./nav";

/** One call that guarantees seeded content and returns the settings map. */
export function getSiteConfig() {
  seedIfEmpty();
  return getSettings();
}

export function getSiteUrl(settings?: Record<string, string>): string {
  const fromSettings = settings?.["seo.siteUrl"]?.trim();
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const raw = fromSettings || fromEnv || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export function absoluteUrl(path: string, settings?: Record<string, string>): string {
  return `${getSiteUrl(settings)}${path.startsWith("/") ? path : `/${path}`}`;
}
