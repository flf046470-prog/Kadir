import en from "@/locales/en.json";

export type Messages = typeof en;
export type MessageKey = keyof Messages;

export const LOCALES = [
  { code: "en", label: "English", native: "English", dir: "ltr" },
  { code: "es", label: "Spanish", native: "Español", dir: "ltr" },
  { code: "tr", label: "Turkish", native: "Türkçe", dir: "ltr" },
  { code: "pt", label: "Portuguese", native: "Português", dir: "ltr" },
  { code: "fr", label: "French", native: "Français", dir: "ltr" },
  { code: "de", label: "German", native: "Deutsch", dir: "ltr" },
  { code: "it", label: "Italian", native: "Italiano", dir: "ltr" },
  { code: "nl", label: "Dutch", native: "Nederlands", dir: "ltr" },
  { code: "pl", label: "Polish", native: "Polski", dir: "ltr" },
  { code: "ru", label: "Russian", native: "Русский", dir: "ltr" },
  { code: "uk", label: "Ukrainian", native: "Українська", dir: "ltr" },
  { code: "zh", label: "Chinese", native: "中文", dir: "ltr" },
  { code: "ja", label: "Japanese", native: "日本語", dir: "ltr" },
  { code: "ko", label: "Korean", native: "한국어", dir: "ltr" },
  { code: "ar", label: "Arabic", native: "العربية", dir: "rtl" },
  { code: "hi", label: "Hindi", native: "हिन्दी", dir: "ltr" },
  { code: "he", label: "Hebrew", native: "עברית", dir: "rtl" },
  { code: "sv", label: "Swedish", native: "Svenska", dir: "ltr" },
  { code: "no", label: "Norwegian", native: "Norsk", dir: "ltr" },
  { code: "da", label: "Danish", native: "Dansk", dir: "ltr" },
  { code: "fi", label: "Finnish", native: "Suomi", dir: "ltr" },
  { code: "cs", label: "Czech", native: "Čeština", dir: "ltr" },
  { code: "el", label: "Greek", native: "Ελληνικά", dir: "ltr" },
  { code: "ro", label: "Romanian", native: "Română", dir: "ltr" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const LOCALE_CODES = LOCALES.map((l) => l.code) as readonly Locale[];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALE_CODES as readonly string[]).includes(value);
}

export function localeDir(locale: Locale): "ltr" | "rtl" {
  return LOCALES.find((l) => l.code === locale)?.dir ?? "ltr";
}

export function localeMeta(locale: Locale) {
  return LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
}

/** Prefixes a path with the active locale: ("/project", "es") → "/es/project". */
export function localePath(path: string, locale: Locale): string {
  const clean = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${clean}` || "/";
}

/**
 * Missing keys fall back to English rather than showing a raw key, so a
 * partially translated locale still renders a complete page.
 */
export async function getMessages(locale: Locale): Promise<Messages> {
  if (locale === DEFAULT_LOCALE) return en;
  try {
    const mod = await import(`@/locales/${locale}.json`);
    return { ...en, ...(mod.default as Partial<Messages>) };
  } catch {
    return en;
  }
}

export type Translator = (key: MessageKey) => string;

export function createTranslator(messages: Messages): Translator {
  return (key) => messages[key] ?? en[key] ?? String(key);
}

/** Picks the best supported locale from an Accept-Language header. */
export function negotiateLocale(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const candidates = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const candidate of candidates) {
    const base = candidate.tag.split("-")[0];
    // Norwegian variants (nb/nn) map onto the "no" bundle.
    const mapped = base === "nb" || base === "nn" ? "no" : base;
    if (isLocale(mapped)) return mapped;
  }
  return DEFAULT_LOCALE;
}
