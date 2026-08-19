import "server-only";

import { notFound } from "next/navigation";
import {
  createTranslator,
  getMessages,
  isLocale,
  localePath,
  type Locale,
  type Messages,
  type Translator,
} from "./i18n";
import { getSiteConfig, getSiteUrl } from "./site";

export type PageContext = {
  locale: Locale;
  messages: Messages;
  t: Translator;
  settings: Record<string, string>;
  path: (href: string) => string;
};

/** Every page starts here: validates the locale segment and loads its bundle. */
export async function getPageContext(
  params: Promise<{ locale: string }>,
): Promise<PageContext> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const messages = await getMessages(locale);
  return {
    locale,
    messages,
    t: createTranslator(messages),
    settings: getSiteConfig(),
    path: (href: string) => localePath(href, locale),
  };
}

/** Canonical + hreflang for a single page, in the shape Next's Metadata wants. */
export function pageAlternates(path: string, locale: Locale) {
  const settings = getSiteConfig();
  const siteUrl = getSiteUrl(settings);
  return {
    canonical: `${siteUrl}${localePath(path, locale)}`,
  };
}
