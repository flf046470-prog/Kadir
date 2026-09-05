import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/locales";
import {
  assessRisk,
  canTransition,
  detectSignals,
  LEXICON_LANGUAGES,
  LOCALES_WITHOUT_LEXICON
} from "./scam-shield";

describe("detectSignals", () => {
  it("flags a direct money request", () => {
    const signals = detectSignals({ text: "Can you send money for my flight? I need $500." });
    expect(signals.map((signal) => signal.id)).toContain("money_request");
  });

  it("flags crypto and investment steering", () => {
    const signals = detectSignals({
      text: "I made great profit on Binance, join my trading signals group for guaranteed returns"
    });
    expect(signals.map((signal) => signal.id)).toContain("crypto_or_investment");
  });

  it("flags shortened links", () => {
    const signals = detectSignals({ text: "check my photos here bit.ly/abc123" });
    expect(signals.map((signal) => signal.id)).toContain("suspicious_link");
  });

  it("escalates an early push to another platform", () => {
    const late = assessRisk({
      text: "add me on whatsapp now",
      minutesSinceConversationStart: 600
    });
    const early = assessRisk({
      text: "add me on whatsapp now",
      minutesSinceConversationStart: 2
    });

    const lateSignal = late.signals.find((signal) => signal.id === "off_platform_rush");
    const earlySignal = early.signals.find((signal) => signal.id === "off_platform_rush");
    expect(earlySignal!.confidence).toBeGreaterThan(lateSignal!.confidence);
  });

  it("flags the same message blasted at many people", () => {
    const signals = detectSignals({
      text: "Hello beautiful, how are you today?",
      identicalMessageRecipients: 30
    });
    expect(signals.map((signal) => signal.id)).toContain("mass_identical_message");
  });

  it("leaves ordinary conversation alone", () => {
    const ordinary = [
      "Hey! How was your weekend?",
      "I loved Rome when I visited last year, the food was unreal.",
      "Do you want to grab a coffee on Saturday?",
      "My sister just got a new job, I'm really happy for her."
    ];

    for (const text of ordinary) {
      expect(assessRisk({ text }).band).toBe("none");
    }
  });

  it("does not flag someone merely discussing their job in finance", () => {
    const result = assessRisk({ text: "I work at a bank, mostly boring spreadsheet work honestly." });
    expect(result.queueForReview).toBe(false);
  });
});

describe("assessRisk", () => {
  it("returns a risk band and never a verdict about the person", () => {
    const result = assessRisk({
      text: "Please send money urgently via Western Union, it's an emergency"
    });

    expect(["elevated", "high"]).toContain(result.band);
    expect(result.warnRecipient).toBe(true);
    // The shape carries no "isScammer"/"ban" field by design.
    expect(Object.keys(result).sort()).toEqual(
      ["band", "promptReport", "queueForReview", "signals", "warnRecipient"].sort()
    );
  });

  it("routes only high risk to human review", () => {
    const low = assessRisk({ text: "what's your email address?" });
    expect(low.queueForReview).toBe(false);

    const high = assessRisk({
      text: "Urgent! Send money via gift cards, I am stuck at customs and need the visa fee, bitcoin works too"
    });
    expect(high.band).toBe("high");
    expect(high.queueForReview).toBe(true);
  });

  it("does not let a pile of weak signals alone reach high risk", () => {
    const result = assessRisk({ text: "what's your phone number?" });
    expect(result.band).not.toBe("high");
  });
});

describe("moderation flow", () => {
  it("only allows enforcement after human review", () => {
    expect(canTransition("warning", "action")).toBe(false);
    expect(canTransition("reported", "action")).toBe(false);
    expect(canTransition("human_review", "action")).toBe(true);
  });

  it("allows dismissal at every pre-action stage", () => {
    expect(canTransition("warning", "dismissed")).toBe(true);
    expect(canTransition("reported", "dismissed")).toBe(true);
    expect(canTransition("human_review", "dismissed")).toBe(true);
  });

  it("treats action and dismissal as terminal", () => {
    expect(canTransition("action", "warning")).toBe(false);
    expect(canTransition("dismissed", "human_review")).toBe(false);
  });
});

/**
 * The languages, which is the whole point of the detector.
 *
 * This module shipped English-only. Every pattern was an English regex, so the
 * identical scam message scored `elevated` in English and `none` in Turkish —
 * in an app whose primary market is Turkish and whose entire premise is that
 * the two people do not share a language. A safety feature that works in one
 * of twelve languages is not a safety feature, it is a claim.
 */

/** The same message, in every language that has a lexicon. */
const MONEY_REQUEST: Record<string, string> = {
  en: "I urgently need money, can you wire me some?",
  tr: "Acil param lazım, bana havale yapabilir misin?",
  de: "Ich brauche dringend Geld, kannst du mir etwas überweisen?",
  es: "Necesito dinero urgente, ¿puedes hacer una transferencia?",
  fr: "J'ai besoin d'argent urgemment, peux-tu faire un virement ?",
  it: "Mi servono soldi urgenti, puoi fare un bonifico?"
};

/** The fee-with-a-reason variant, which is the commoner opening. */
const FEE_PRETEXT: Record<string, string> = {
  en: "I am stuck at customs and have to pay the customs fee today",
  tr: "Gümrükte takıldım, bugün gümrük ücreti ödemem gerekiyor",
  de: "Ich hänge beim Zoll fest und muss heute die Zollgebühr zahlen",
  es: "Estoy retenido en la aduana y tengo que pagar las tasas de aduana",
  fr: "Je suis bloqué à la douane et je dois payer les frais de douane",
  it: "Sono bloccato alla dogana e devo pagare le spese doganali"
};

const ORDINARY: Record<string, string> = {
  en: "The weather was lovely today, I walked by the sea for an hour.",
  tr: "Bugün hava çok güzeldi, bir saat sahilde yürüdüm.",
  de: "Das Wetter war heute schön, ich bin eine Stunde am Meer spazieren gegangen.",
  es: "Hoy hizo muy buen tiempo, caminé una hora por la playa.",
  fr: "Il faisait très beau aujourd'hui, j'ai marché une heure au bord de la mer.",
  it: "Oggi il tempo era bellissimo, ho camminato un'ora in riva al mare."
};

describe("the same scam in every language", () => {
  it.each(Object.keys(MONEY_REQUEST))("flags a money request in %s", (language) => {
    const result = assessRisk({ text: MONEY_REQUEST[language], language });
    expect(result.signals.map((signal) => signal.id)).toContain("money_request");
    expect(result.warnRecipient).toBe(true);
  });

  /**
   * A fee is a money request wearing a reason, and it has to be scored as one.
   * Reading it as pressure alone leaves the band at `low`, which shows the
   * recipient nothing.
   */
  it.each(Object.keys(FEE_PRETEXT))("flags a customs-fee pretext in %s", (language) => {
    const result = assessRisk({ text: FEE_PRETEXT[language], language });
    expect(result.signals.map((signal) => signal.id)).toContain("money_request");
    expect(result.warnRecipient).toBe(true);
  });

  it.each(Object.keys(ORDINARY))("leaves ordinary %s conversation alone", (language) => {
    expect(assessRisk({ text: ORDINARY[language], language }).band).toBe("none");
  });
});

describe("signals that do not need a language", () => {
  /**
   * The strongest evidence is not words. A wallet address is the same
   * characters in Japanese as in English, which is why these run whatever the
   * message is written in — including the six locales with no lexicon at all.
   */
  it.each(["ja", "ko", "ar", "hi", undefined])("finds a wallet address with language %s", (language) => {
    const result = assessRisk({
      text: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      language
    });
    expect(result.signals.map((signal) => signal.id)).toContain("crypto_or_investment");
  });

  it("finds an IBAN", () => {
    const signals = detectSignals({ text: "DE89370400440532013000", language: "ja" });
    expect(signals.map((signal) => signal.id)).toContain("money_request");
  });

  /**
   * The bug this replaced: the old pattern wanted an English word after the
   * platform name, so a Turkish sentence around "WhatsApp" scored nothing.
   */
  it("finds a platform name inside a sentence in another language", () => {
    const signals = detectSignals({ text: "WhatsApp'tan yazalım mı?", language: "tr" });
    expect(signals.map((signal) => signal.id)).toContain("off_platform_rush");
  });
});

describe("word boundaries that survive non-ASCII letters", () => {
  /**
   * JavaScript's `\b` is ASCII-only, so it lands *inside* `gümrük` rather than
   * at its edges. Patterns written with it silently fail on exactly the
   * languages this app exists to serve.
   */
  it("matches a term with non-ASCII letters", () => {
    const signals = detectSignals({ text: "gümrük ücreti ödemem lazım", language: "tr" });
    expect(signals.map((signal) => signal.id)).toContain("money_request");
  });

  it("does not match a term buried inside a longer word", () => {
    // "acil" is a Turkish urgency term; "acilen" is a real word that should
    // still match, but "kacilar" — where it is only a substring — must not.
    const inner = detectSignals({ text: "Kacilar hakkında ne düşünüyorsun?", language: "tr" });
    expect(inner.map((signal) => signal.id)).not.toContain("urgency_pressure");
  });
});

describe("word order", () => {
  /**
   * The first draft required the noun before the verb, so `j'ai besoin
   * d'argent` — the commonest sentence in this whole category — matched
   * nothing. Both orders now count.
   */
  it.each([
    ["I need money", "en"],
    ["money, I need it", "en"],
    ["J'ai besoin d'argent", "fr"],
    ["de l'argent, j'ai besoin", "fr"]
  ])("matches %s", (text, language) => {
    expect(detectSignals({ text, language }).map((s) => s.id)).toContain("money_request");
  });
});

describe("which lexicon runs", () => {
  /**
   * A declared language runs its own wording only, so one language's terms
   * cannot fire on another's message and produce a warning nobody can explain.
   */
  it("does not fire another language's wording on a declared message", () => {
    // "burro" is butter in Italian; the Spanish lexicon must not be consulted
    // for a message declared Italian.
    const italian = detectSignals({ text: "Ho comprato del burro e del pane", language: "it" });
    expect(italian).toHaveLength(0);
  });

  /**
   * An undeclared message is checked against everything, at full strength.
   *
   * An earlier draft discounted these on the theory that a match found without
   * knowing the language was weaker evidence. It is not — "havale" is the same
   * word either way — and the discount's real effect was to weaken the
   * detector for every client that omits the field, which is a safety feature
   * failing for a reason unrelated to the message. It also silently dropped an
   * existing high-risk case to elevated, which is how it was noticed.
   */
  it.each(Object.keys(MONEY_REQUEST))("scores an undeclared %s message the same", (language) => {
    expect(detectSignals({ text: MONEY_REQUEST[language] })).toEqual(
      detectSignals({ text: MONEY_REQUEST[language], language })
    );
  });

  it("ignores a region suffix on the language tag", () => {
    const plain = detectSignals({ text: MONEY_REQUEST.en, language: "en" });
    const regional = detectSignals({ text: MONEY_REQUEST.en, language: "en-GB" });
    expect(regional).toEqual(plain);
  });
});

describe("the locale list", () => {
  /**
   * Every locale the app ships is either covered by a lexicon or declared as
   * knowingly uncovered. A thirteenth language fails this until someone puts
   * it in one of the two lists, which is the point: the gap should be a
   * decision, not something discovered by a member who was defrauded.
   */
  it("accounts for every locale the app ships", () => {
    const covered = new Set([...LEXICON_LANGUAGES, ...LOCALES_WITHOUT_LEXICON]);
    for (const locale of locales) expect(covered).toContain(locale);
  });

  it("does not claim a lexicon it does not have", () => {
    for (const locale of LOCALES_WITHOUT_LEXICON) {
      expect(LEXICON_LANGUAGES).not.toContain(locale);
    }
  });
});
