import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Inter, Fraunces } from "next/font/google";
import "../globals.css";
import { locales, rtlLocales, type Locale } from "@/i18n/locales";
import { JsonLd } from "@/components/JsonLd";
import { organizationSchema, websiteSchema, buildAlternates } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { NativeShell } from "@/components/native/NativeShell";
import { allowedAppHosts } from "@/lib/site";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-inter"
});

const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"]
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: `${t("siteName")} — ${t("tagline")}`,
      template: `%s — ${t("siteName")}`
    },
    description: t("description"),
    alternates: buildAlternates(locale as Locale, "/"),
    icons: {
      icon: "/icon.svg",
      // iOS ignores the manifest's icons entirely and looks for this.
      apple: "/icons/apple-touch-icon.png"
    },
    appleWebApp: {
      capable: true,
      title: t("siteName"),
      // "default" keeps the status bar legible over the app's light ground;
      // "black-translucent" would put dark text under a pink header.
      statusBarStyle: "default"
    }
    // No manual `mobile-web-app-capable`: `appleWebApp.capable` already emits
    // it, and setting both puts the tag in the document twice.
  };
}

/**
 * `viewport-fit=cover` lets the page paint under the notch and the home
 * indicator, which is what makes an installed app look installed rather than
 * like a website in a frame. Everything that must stay tappable then pays for
 * it with a `safe-area-inset` — see the bottom navigation.
 *
 * `maximumScale` is deliberately absent: capping zoom is an accessibility
 * failure, and iOS ignores it anyway.
 */
export const viewport: Viewport = {
  themeColor: "#fb6f92",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default async function LocaleLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!locales.includes(locale as Locale)) notFound();

  const messages = await getMessages();
  const dir = rtlLocales.includes(locale as Locale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} className={`${inter.variable} ${fraunces.variable}`}>
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider messages={messages}>
          <JsonLd data={organizationSchema()} />
          <JsonLd data={websiteSchema(locale as Locale)} />
          {/* Header and footer live in the per-section layouts: the marketing
              shell and the signed-in app shell are genuinely different. */}
          {children}
          <ServiceWorkerRegistrar />
          {/* No-op in a browser; wires the shell's behaviours on a phone. */}
          <NativeShell allowedHosts={allowedAppHosts()} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
