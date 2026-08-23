import { NoTranslator, type Translator } from "./driver";
import { DeepLTranslator } from "./deepl";

/**
 * Chooses the translation provider from the environment.
 *
 * Off by default, and that default is load-bearing rather than lazy. Message
 * translation means sending what two people wrote to each other to a third
 * party; a clone of this repository must not start doing that because someone
 * forgot to turn it off. Naming a provider is the deliberate act.
 *
 * As with storage, an incomplete configuration throws at startup instead of
 * quietly falling back, so a deploy that thinks it has translation cannot be
 * silently running without it.
 */

let instance: Translator | null = null;

function build(): Translator {
  const provider = process.env.TRANSLATE_PROVIDER;
  if (!provider || provider === "none") return new NoTranslator();

  if (provider === "deepl") {
    const apiKey = process.env.DEEPL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DEEPL_API_KEY is required when TRANSLATE_PROVIDER=deepl. Set it, or unset TRANSLATE_PROVIDER to turn translation off."
      );
    }
    return new DeepLTranslator({ apiKey, host: process.env.DEEPL_API_HOST });
  }

  throw new Error(`Unknown TRANSLATE_PROVIDER "${provider}". Supported: none, deepl.`);
}

export function translator(): Translator {
  instance ??= build();
  return instance;
}

/** Whether translation is available at all, for hiding the control entirely. */
export function translationEnabled(): boolean {
  return translator().name !== "none";
}

/** Test hook, for swapping in a different provider. */
export function setTranslator(next: Translator | null): void {
  instance = next;
}

export { NoTranslator, DeepLTranslator };
export type { Translator };
