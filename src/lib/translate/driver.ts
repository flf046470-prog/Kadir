/**
 * Translation providers.
 *
 * The interface is deliberately narrow — one call, a batch of strings in, the
 * same number of strings out — because that is the shape every provider agrees
 * on and the shape a cache can key. Anything richer (glossaries, formality,
 * document upload) belongs to a specific provider and would leak that
 * provider's model into the rest of the app.
 *
 * Batching is in the interface rather than left to callers on purpose. A
 * conversation translates a screenful at a time, and providers bill and rate
 * limit per request; a driver that could only take one string would turn one
 * screen into forty calls.
 */
export type Translator = {
  /** Provider name, stored alongside cached output so a switch is traceable. */
  readonly name: string;

  /**
   * Translates `texts` into `targetLanguage`, preserving order and length.
   *
   * `sourceLanguage` is a hint, not an instruction: providers detect better
   * than we do, and the language recorded on a message is best-effort.
   */
  translate(
    texts: string[],
    targetLanguage: string,
    sourceLanguage?: string
  ): Promise<string[]>;
};

/**
 * The default: translation is off.
 *
 * Not a stub that echoes the input — a caller must be able to tell "no
 * translation is configured" from "this text happens to translate to itself",
 * and returning the original would make the UI show a translation that never
 * happened.
 */
export class NoTranslator implements Translator {
  readonly name = "none";

  async translate(): Promise<string[]> {
    throw new Error("No translation provider is configured");
  }
}
