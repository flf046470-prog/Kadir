import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import { locales, fullyTranslatedLocales, type Locale } from "./locales";
import en from "./messages/en.json";

/**
 * Locales without their own catalog fall back to English rather than shipping a
 * duplicated copy that silently drifts. Adding a translation means adding
 * `messages/<locale>.json` and listing the locale in `fullyTranslatedLocales`.
 */
async function loadMessages(locale: Locale) {
  if (!fullyTranslatedLocales.includes(locale)) return en;
  return (await import(`./messages/${locale}.json`)).default;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = locales.includes(requested as Locale) ? (requested as Locale) : undefined;

  if (!locale) notFound();

  return {
    locale,
    messages: await loadMessages(locale)
  };
});
