import type { Translator } from "./driver";

/**
 * DeepL, over its documented HTTP API.
 *
 * Written against the published `/v2/translate` contract rather than the SDK,
 * for the same reason the S3 driver signs its own requests: one HTTP call does
 * not justify a dependency, and the failure modes stay visible.
 *
 * The free and paid tiers live on different hosts, which is the single most
 * common cause of a key that "does not work" — a free key on the paid host
 * returns 403. The host is therefore derived from the key's own `:fx` suffix
 * rather than left to configuration, unless it is set explicitly.
 */

const FREE_HOST = "https://api-free.deepl.com";
const PAID_HOST = "https://api.deepl.com";

export function hostForKey(key: string): string {
  return key.endsWith(":fx") ? FREE_HOST : PAID_HOST;
}

/**
 * DeepL wants a target like `TR`, or a regional variant like `EN-GB`. Our
 * locales are BCP-47 (`tr`, `pt-BR`), and the plain `EN` and `PT` targets are
 * deprecated, so English and Portuguese get a default region rather than a
 * warning and an arbitrary choice by the provider.
 */
export function deeplTarget(locale: string): string {
  const [language, region] = locale.split("-");
  const base = language.toUpperCase();

  if (region) return `${base}-${region.toUpperCase()}`;
  if (base === "EN") return "EN-GB";
  if (base === "PT") return "PT-PT";
  return base;
}

/** Source is a hint and takes no region: `pt-BR` as a source is just `PT`. */
export function deeplSource(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  return locale.split("-")[0].toUpperCase();
}

export type DeepLOptions = {
  apiKey: string;
  /** Overrides the host derived from the key. Mainly for a proxy or a test. */
  host?: string;
  fetchImpl?: typeof fetch;
};

export class DeepLTranslator implements Translator {
  readonly name = "deepl";

  private readonly apiKey: string;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepLOptions) {
    this.apiKey = options.apiKey;
    this.host = options.host ?? hostForKey(options.apiKey);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async translate(
    texts: string[],
    targetLanguage: string,
    sourceLanguage?: string
  ): Promise<string[]> {
    if (texts.length === 0) return [];

    const source = deeplSource(sourceLanguage);
    const target = deeplTarget(targetLanguage);

    // A source equal to the target is not an error, it is a no-op, and paying
    // a provider to return the text unchanged is a waste of a request.
    if (source && source === target.split("-")[0]) return [...texts];

    const body = new URLSearchParams();
    for (const text of texts) body.append("text", text);
    body.set("target_lang", target);
    if (source) body.set("source_lang", source);

    const response = await this.fetchImpl(`${this.host}/v2/translate`, {
      method: "POST",
      headers: {
        // DeepL's own scheme, not Bearer. Sending Bearer returns 403.
        authorization: `DeepL-Auth-Key ${this.apiKey}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      // 456 is DeepL's "quota exceeded", which is worth naming: it is the one
      // failure that is not a bug and will not fix itself on a retry.
      const detail = response.status === 456 ? "quota exceeded" : await response.text();
      throw new Error(`DeepL responded ${response.status}: ${detail}`);
    }

    const payload = (await response.json()) as { translations?: { text?: string }[] };
    const translations = payload.translations ?? [];

    if (translations.length !== texts.length) {
      // Silently padding would hand the caller a translation belonging to a
      // different message, which is worse than showing none.
      throw new Error(
        `DeepL returned ${translations.length} translations for ${texts.length} texts`
      );
    }

    return translations.map((translation, index) => translation.text ?? texts[index]);
  }
}
