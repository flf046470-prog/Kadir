import type { MetadataRoute } from "next";
import { getSiteConfig, getSiteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl(getSiteConfig());
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The admin panel and the JSON endpoints have nothing to index.
        disallow: ["/admin", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
