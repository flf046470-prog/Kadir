import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Fraunces, Inter } from "next/font/google";
import "@/styles/globals.css";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { ScrollMotion } from "@/components/motion/scroll-motion";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { PointerMotion } from "@/components/motion/pointer-motion";
import { RouteTransition } from "@/components/motion/route-transition";
import { getSocialLinks } from "@/lib/content";
import { getSiteConfig, getSiteUrl } from "@/lib/site";
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  createTranslator,
  getMessages,
  isLocale,
  localeDir,
  localePath,
} from "@/lib/i18n";

// Content lives in SQLite and is edited from the admin panel, so pages are
// rendered per request rather than baked at build time.
export const dynamic = "force-dynamic";

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const viewport: Viewport = {
  themeColor: "#0e1311",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export function generateStaticParams() {
  return LOCALE_CODES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const settings = getSiteConfig();
  const siteUrl = getSiteUrl(settings);
  const title = settings["seo.defaultTitle"];
  const description = settings["seo.defaultDescription"];

  return {
    metadataBase: new URL(siteUrl),
    title: { default: title, template: `%s — ${settings["brand.projectName"]}` },
    description,
    applicationName: settings["brand.projectName"],
    keywords: [
      "Patagonia Underground",
      "Trevelin",
      "Trevelin Argentina",
      "Patagonia",
      "Chubut",
      "underground house",
      "earth-sheltered house",
      "Patagonia nature stay",
    ],
    alternates: {
      canonical: `${siteUrl}${localePath("/", locale)}`,
      languages: {
        ...Object.fromEntries(
          LOCALE_CODES.map((code) => [code, `${siteUrl}${localePath("/", code)}`]),
        ),
        "x-default": `${siteUrl}${localePath("/", DEFAULT_LOCALE)}`,
      },
    },
    openGraph: {
      type: "website",
      siteName: settings["brand.projectName"],
      title,
      description,
      url: `${siteUrl}${localePath("/", locale)}`,
      locale,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
    icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], apple: [{ url: "/icon.svg" }] },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw;

  const messages = await getMessages(locale);
  const t = createTranslator(messages);
  const settings = getSiteConfig();
  const socials = getSocialLinks(settings);

  return (
    <html lang={locale} dir={localeDir(locale)} className={`${fraunces.variable} ${inter.variable}`}>
      <head>
        {/* Without scripts nothing can reveal the page, so show it as it is. */}
        <noscript>
          <style>{`.reveal{opacity:1!important;transform:none!important}[data-story-stage]{display:none!important}[data-story-inline]{display:block!important}`}</style>
        </noscript>
        {/* Holds the hero for its opening beat — and releases it on its own if
            the animation never loads, so the page can never be left blank. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var r=document.documentElement;" +
              "if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;" +
              "r.dataset.intro='pending';setTimeout(function(){" +
              "if(r.dataset.intro==='pending')delete r.dataset.intro},2200)}catch(e){}})()",
          }}
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-full focus:bg-snow focus:px-5 focus:py-3 focus:text-sm focus:text-basalt"
        >
          {t("nav.skip")}
        </a>
        <SiteHeader projectName={settings["brand.projectName"]} locale={locale} messages={messages} />
        <main id="main">
          <RouteTransition>{children}</RouteTransition>
        </main>
        <SiteFooter
          projectName={settings["brand.projectName"]}
          locationLabel={settings["brand.locationLabel"]}
          socials={socials}
          statusLabel={settings["brand.statusLabel"]}
          locale={locale}
          messages={messages}
        />
        <SmoothScroll />
        <ScrollMotion />
        <PointerMotion />
      </body>
    </html>
  );
}
