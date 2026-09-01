import type { Metadata } from "next";
import { locales, type Locale } from "@/i18n/locales";
import { siteUrl } from "./site";
import { MONTHLY_PRICE_CENTS } from "./billing/tiers";

/**
 * Builds canonical + hreflang alternates for a given path across all launch
 * locales, plus x-default pointing at the English version.
 */
export function buildAlternates(locale: Locale, path: string) {
  const clean = path === "/" ? "" : path;
  const languages: Record<string, string> = {};
  for (const l of locales) {
    languages[l] = `${siteUrl}/${l}${clean}`;
  }
  languages["x-default"] = `${siteUrl}/en${clean}`;

  return {
    canonical: `${siteUrl}/${locale}${clean}`,
    languages
  };
}

export function buildMetadata({
  locale,
  path,
  title,
  description
}: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
}): Metadata {
  return {
    title,
    description,
    alternates: buildAlternates(locale, path),
    openGraph: {
      title,
      description,
      url: buildAlternates(locale, path).canonical,
      siteName: "FioreMatch",
      locale,
      type: "website"
    },
    twitter: {
      card: "summary_large_image",
      title,
      description
    }
  };
}

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "FioreMatch",
    url: siteUrl,
    logo: `${siteUrl}/icon.svg`,
    sameAs: [
      "https://www.instagram.com/fiorematch",
      "https://www.tiktok.com/@fiorematch",
      "https://www.youtube.com/@fiorematch",
      "https://www.facebook.com/fiorematch",
      "https://x.com/fiorematch"
    ],
    description:
      "FioreMatch is a global, AI-powered dating platform helping people meet, match, and connect safely across borders and languages."
  };
}

export function websiteSchema(locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "FioreMatch",
    url: `${siteUrl}/${locale}`,
    inLanguage: locale,
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteUrl}/${locale}/dating?query={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };
}

export function softwareApplicationSchema(locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FioreMatch",
    applicationCategory: "SocialNetworkingApplication",
    operatingSystem: "Web, iOS, Android",
    url: `${siteUrl}/${locale}`,
    // Derived from the entitlements module rather than restated here. Search
    // engines quote structured data as the price, so a second copy of these
    // numbers is a copy that eventually disagrees with the pricing page.
    offers: (["plus", "vip"] as const).map((tier) => ({
      "@type": "Offer",
      name: tier.toUpperCase(),
      price: (MONTHLY_PRICE_CENTS[tier] / 100).toFixed(2),
      priceCurrency: "USD",
      /**
       * The billing period, stated rather than implied.
       *
       * A bare `price` on a subscription is read as the whole cost, so a search
       * result would quote $4.99 for the product rather than for a month of it
       * — which is the kind of number someone arrives already believing.
       */
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: (MONTHLY_PRICE_CENTS[tier] / 100).toFixed(2),
        priceCurrency: "USD",
        referenceQuantity: {
          "@type": "QuantitativeValue",
          value: 1,
          unitCode: "MON"
        }
      },
      priceValidUntil: "2027-12-31"
    })),
    aggregateRating: undefined
  };
}

export function faqSchema(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer
      }
    }))
  };
}
