import type { MetadataRoute } from "next";
import { LOCALE_CODES, DEFAULT_LOCALE, localePath } from "@/lib/i18n";
import { getPosts } from "@/lib/content";
import { getSiteConfig, getSiteUrl } from "@/lib/site";

const STATIC_PATHS = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/project", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/story", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/progress", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/transparency", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/journal", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/updates", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/gallery", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/location", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/support", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/join", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
];

/** Every page is listed once per locale, with hreflang alternates on each entry. */
export default function sitemap(): MetadataRoute.Sitemap {
  const settings = getSiteConfig();
  const base = getSiteUrl(settings);
  const now = new Date();

  const alternatesFor = (path: string) => ({
    languages: Object.fromEntries(
      LOCALE_CODES.map((code) => [code, `${base}${localePath(path, code)}`]),
    ),
  });

  const pages: MetadataRoute.Sitemap = STATIC_PATHS.flatMap((entry) =>
    LOCALE_CODES.map((locale) => ({
      url: `${base}${localePath(entry.path, locale)}`,
      lastModified: now,
      changeFrequency: entry.changeFrequency,
      priority: locale === DEFAULT_LOCALE ? entry.priority : entry.priority * 0.8,
      alternates: alternatesFor(entry.path),
    })),
  );

  const posts = getPosts("all").flatMap((post) => {
    const path = `/${post.kind === "journal" ? "journal" : "updates"}/${post.slug}`;
    return LOCALE_CODES.map((locale) => ({
      url: `${base}${localePath(path, locale)}`,
      lastModified: new Date(post.updated_at || post.created_at || now),
      changeFrequency: "monthly" as const,
      priority: 0.6,
      alternates: alternatesFor(path),
    }));
  });

  return [...pages, ...posts];
}
