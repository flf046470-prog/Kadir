export const locales = [
  "en",
  "tr",
  "de",
  "es",
  "fr",
  "it",
  "pt",
  "ar",
  "ja",
  "ko",
  "hi",
  "id"
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const rtlLocales: Locale[] = ["ar"];

export const localeNames: Record<Locale, string> = {
  en: "English",
  tr: "Türkçe",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  pt: "Português",
  ar: "العربية",
  ja: "日本語",
  ko: "한국어",
  hi: "हिन्दी",
  id: "Bahasa Indonesia"
};

// Locales that currently have full, human-quality translations.
// The rest ship with the architecture wired up but content mirrors English
// until localized copy lands — see README "Translation status".
export const fullyTranslatedLocales: Locale[] = ["en", "tr"];
