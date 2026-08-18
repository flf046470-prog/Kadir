import type { MetadataRoute } from "next";
import { locales } from "@/i18n/locales";
import { countries, cities } from "@/lib/countries-data";
import { guides } from "@/lib/guides-data";
import { siteUrl } from "@/lib/site";

const staticPaths = [
  "",
  "/dating",
  "/international-dating",
  "/features",
  "/pricing",
  "/safety",
  "/about",
  "/contact",
  "/guides",
  "/legal/privacy",
  "/legal/terms",
  "/legal/community-guidelines",
  "/legal/cookies",
  "/login",
  "/register"
];

const dynamicPaths = [
  ...Object.keys(countries).map((slug) => `/dating/${slug}`),
  ...Object.keys(cities).map((slug) => `/dating/${slug}`),
  ...Object.keys(guides).map((slug) => `/guides/${slug}`)
];

export default function sitemap(): MetadataRoute.Sitemap {
  const allPaths = [...staticPaths, ...dynamicPaths];

  return allPaths.flatMap((path) =>
    locales.map((locale) => ({
      url: `${siteUrl}/${locale}${path}`,
      lastModified: new Date(),
      alternates: {
        languages: Object.fromEntries(locales.map((l) => [l, `${siteUrl}/${l}${path}`]))
      }
    }))
  );
}
