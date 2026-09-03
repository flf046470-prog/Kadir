/**
 * Scam Shield — detects patterns commonly used in romance scams and surfaces a
 * warning to the member who received them.
 *
 * Design rules, in priority order:
 *  1. A member is NEVER auto-labelled a scammer. Detection produces a risk
 *     band and a warning, never a verdict and never an automatic ban.
 *  2. The warning goes to the potential *victim*, phrased as "be careful",
 *     with the concrete thing we noticed — so they can judge for themselves.
 *  3. High risk routes to human moderation review, it does not act alone.
 *  4. Signals are lexical and behavioural only. We never profile by
 *     nationality, language, name, or photo.
 *
 * Detection deliberately errs toward under-flagging: a false accusation
 * against a real member is more damaging than a missed borderline case, which
 * the report flow still catches.
 */

export type ScamSignalId =
  | "money_request"
  | "crypto_or_investment"
  | "suspicious_link"
  | "off_platform_rush"
  | "mass_identical_message"
  | "urgency_pressure"
  | "contact_detail_request";

export type ScamSignal = {
  id: ScamSignalId;
  /** 0–1 confidence that this pattern is present, not that the user is a scammer. */
  confidence: number;
  /** The matched fragment, for moderator context. Never shown to the accused. */
  excerpt?: string;
};

type Pattern = {
  id: ScamSignalId;
  confidence: number;
  regex: RegExp;
};

/**
 * Word boundaries that understand letters this app actually carries.
 *
 * JavaScript's `\b` is defined against ASCII `\w`, so it fires *inside*
 * `gümrük` and `hôpital` and fails at their edges. Every pattern below is
 * built with these instead, because a detector whose boundaries only work in
 * English is the bug this file was rewritten to fix.
 */
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";

function pattern(id: ScamSignalId, confidence: number, source: string): Pattern {
  return { id, confidence, regex: new RegExp(source, "iu") };
}

/** `word` surrounded by unicode-aware boundaries. */
const w = (body: string) => `${START}(?:${body})${END}`;

/**
 * Two things close together, in either order.
 *
 * Word order is not a constant across these languages and cannot be assumed:
 * the first draft of the French pattern wanted the noun before the verb, so
 * `j'ai besoin d'argent` — the single most common sentence in this entire
 * category — matched nothing. Writing the pair once and letting it match both
 * ways is cheaper than remembering the order for six languages.
 */
const near = (a: string, b: string, gap = 40) =>
  `(?:${w(a)}[^.!?]{0,${gap}}${w(b)}|${w(b)}[^.!?]{0,${gap}}${w(a)})`;

/**
 * Signals that do not depend on what language the message is written in.
 *
 * This is the half of the detector that genuinely is one detector for every
 * language, and it is the stronger half: a wallet address, an IBAN, a
 * shortener, "Western Union" and "WhatsApp" are the same characters in Turkish,
 * German and Japanese. Proper nouns and account formats do not translate, and
 * they are also the signals hardest for a sender to paraphrase around.
 */
const UNIVERSAL: Pattern[] = [
  // Wallet addresses. Nobody pastes one of these into a first date's chat for
  // an innocent reason.
  pattern("crypto_or_investment", 0.85, `${START}(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}${END}`),
  pattern("crypto_or_investment", 0.85, `${START}0x[a-f0-9]{40}${END}`),
  pattern(
    "crypto_or_investment",
    0.7,
    w("bitcoin|btc|ethereum|usdt|binance|coinbase|kraken|metamask|tether")
  ),

  // An IBAN in a conversation is a request for money whatever sentence it sits in.
  pattern("money_request", 0.8, `${START}[a-z]{2}\\d{2}[a-z0-9]{11,28}${END}`),
  pattern(
    "money_request",
    0.75,
    w("western union|moneygram|wise transfer|payoneer|skrill|paysafe")
  ),
  // Card brands scammers ask to be paid in. The brand is the signal; the
  // sentence around it is written in whatever language they speak.
  pattern("money_request", 0.7, w("itunes|steam|amazon|google play")),

  pattern(
    "suspicious_link",
    0.5,
    w("bit\\.ly|tinyurl\\.com|t\\.co|goo\\.gl|is\\.gd|cutt\\.ly|\\d{1,3}(?:\\.\\d{1,3}){3}")
  ),

  /**
   * The platform names, on their own.
   *
   * The previous pattern required an English word after the name — "whatsapp
   * me", "telegram now" — so `WhatsApp'tan yazalım mı` scored nothing at all.
   * The name alone is weak evidence and is scored as such; what makes it
   * matter is the rush escalation below, which is itself language-independent
   * because it is a clock rather than a phrase.
   */
  pattern(
    "off_platform_rush",
    0.3,
    w("whats ?app|telegram|viber|kakao ?talk|wechat|snap ?chat|line id")
  )
];

/**
 * Signals that are words, and therefore have to be written per language.
 *
 * The universal list above catches the hard evidence; this catches the ask.
 * "I need money urgently" has no proper noun and no account number in it, and
 * it is what most of these conversations actually look like before the wallet
 * address arrives.
 *
 * Adding a language is adding an entry here — no code changes — which is
 * deliberate, because the list is incomplete and is meant to grow.
 */
const LEXICONS: Record<string, Pattern[]> = {
  en: [
    pattern(
      "money_request",
      0.8,
      near("send|wire|transfer|lend|borrow|need", "money|cash|funds|euros?|dollars?|pounds?|lira")
    ),
    pattern("money_request", 0.7, w("gift ?cards?")),
    // A fee someone else has to pay is a money request wearing a reason.
    pattern("money_request", 0.7, w("customs fee|visa fee|hospital bill|shipping fee")),
    pattern(
      "crypto_or_investment",
      0.75,
      w("trading (?:platform|signals?)|investment opportunity|guaranteed returns?")
    ),
    pattern(
      "contact_detail_request",
      0.35,
      `${w("send|give|what'?s")}[^.!?]{0,25}(?:your )?${w("phone number|email address|bank|account number")}`
    ),
    pattern(
      "urgency_pressure",
      0.4,
      w(
        "urgent(?:ly)?|emergency|right now|as soon as possible|hospital|stuck at (?:the )?(?:airport|customs)|visa fee|customs fee"
      )
    )
  ],

  tr: [
    pattern(
      "money_request",
      0.8,
      near("para|nakit", "gönder\\w*|yolla\\w*|lazım|gerek\\w*|ihtiyac\\w*|borç\\w*")
    ),
    pattern("money_request", 0.75, w("havale|eft|western union|hediye kart\\w*")),
    pattern(
      "money_request",
      0.7,
      w("gümrük (?:ücret|vergi|bedel)\\w*|vize (?:ücret|para)\\w*|hastane (?:masraf|fatura)\\w*")
    ),
    pattern(
      "crypto_or_investment",
      0.75,
      w("garantili (?:getiri|kazanç)\\w*|yatırım fırsat\\w*|kesin kazanç")
    ),
    pattern(
      "contact_detail_request",
      0.35,
      w("telefon numaran\\w*|numaranı ver|iban\\w*|hesap numaran\\w*")
    ),
    pattern(
      "urgency_pressure",
      0.4,
      w("acil\\w*|hastane\\w*|ameliyat\\w*|gümrük (?:ücret|vergi)\\w*|vize (?:ücret|para)\\w*")
    )
  ],

  de: [
    pattern(
      "money_request",
      0.8,
      near("geld|bargeld", "brauche|schick\\w*|überweis\\w*|leih\\w*|senden")
    ),
    pattern("money_request", 0.75, w("überweisung|western union|geschenkkarte\\w*")),
    pattern("money_request", 0.7, w("zollgebühr\\w*|visagebühr\\w*|krankenhausrechnung")),
    pattern(
      "crypto_or_investment",
      0.75,
      w("garantierte rendite\\w*|anlagemöglichkeit\\w*|investitionsmöglichkeit\\w*")
    ),
    pattern("contact_detail_request", 0.35, w("telefonnummer|kontonummer|bankverbindung")),
    pattern(
      "urgency_pressure",
      0.4,
      w("dringend\\w*|notfall\\w*|krankenhaus\\w*|zollgebühr\\w*|visagebühr\\w*")
    )
  ],

  es: [
    pattern(
      "money_request",
      0.8,
      near("dinero|efectivo", "necesito|env[íi]a\\w*|transferencia|prest\\w*|mand\\w*")
    ),
    pattern("money_request", 0.75, w("transferencia bancaria|western union|tarjeta regalo")),
    pattern("money_request", 0.7, w("tasas? de aduana|tasa de visado|factura del hospital")),
    pattern(
      "crypto_or_investment",
      0.75,
      w("ganancias garantizadas|oportunidad de inversi[óo]n|rendimiento garantizado")
    ),
    pattern("contact_detail_request", 0.35, w("n[úu]mero de tel[ée]fono|n[úu]mero de cuenta")),
    pattern(
      "urgency_pressure",
      0.4,
      w("urgente|emergencia|hospital|tasas? de aduana|aduana|tasa de visado")
    )
  ],

  fr: [
    pattern(
      "money_request",
      0.8,
      near("argent|esp[èe]ces", "besoin|envoi\\w*|envoie|virement|pr[êe]t\\w*")
    ),
    pattern("money_request", 0.75, w("virement bancaire|western union|carte cadeau")),
    pattern("money_request", 0.7, w("frais de douane|frais de visa|facture d'h[ôo]pital")),
    pattern(
      "crypto_or_investment",
      0.75,
      w("rendement garanti|opportunit[ée] d'investissement|gains garantis")
    ),
    pattern("contact_detail_request", 0.35, w("num[ée]ro de t[ée]l[ée]phone|num[ée]ro de compte")),
    pattern(
      "urgency_pressure",
      0.4,
      w("urgen\\w*|h[ôo]pital|frais de douane|frais de visa|bloqu[ée] [àa] l'a[ée]roport")
    )
  ],

  it: [
    pattern(
      "money_request",
      0.8,
      near("soldi|denaro|contanti", "serv\\w*|mand\\w*|invi\\w*|bonifico|prest\\w*")
    ),
    pattern("money_request", 0.75, w("bonifico bancario|western union|carta regalo")),
    pattern("money_request", 0.7, w("spese doganali|spese per il visto|conto dell'ospedale")),
    pattern(
      "crypto_or_investment",
      0.75,
      w("rendimenti garantiti|opportunit[àa] di investimento|guadagni garantiti")
    ),
    pattern("contact_detail_request", 0.35, w("numero di telefono|numero di conto")),
    pattern(
      "urgency_pressure",
      0.4,
      w("urgent\\w*|emergenza|ospedale|spese doganali|spese per il visto")
    )
  ]
};

/**
 * Locales the app ships with and this file knowingly has no lexicon for.
 *
 * They are not forgotten, they are declared. A message in one of these is
 * still checked against every universal signal — a wallet address is caught in
 * Japanese exactly as well as in English — but the softer "I need money
 * urgently" phrasing is not, and pretending otherwise in a store listing would
 * be the kind of safety claim this whole module exists not to make.
 *
 * `scam-shield.test.ts` asserts this list plus `LEXICONS` covers every locale,
 * so adding a thirteenth language fails a test until someone decides which of
 * the two it belongs in.
 */
export const LOCALES_WITHOUT_LEXICON = ["pt", "ar", "ja", "ko", "hi", "id"];

/** The languages a lexicon exists for. Exported so the gap above is testable. */
export const LEXICON_LANGUAGES = Object.keys(LEXICONS);

export type MessageContext = {
  text: string;
  /**
   * The language the message was written in, when the client declared one.
   *
   * It buys precision, not coverage. A declared language runs that language's
   * lexicon and no other, so one language's wording cannot fire on another's
   * message. Undeclared runs all of them — at full confidence, deliberately.
   *
   * An earlier draft discounted undeclared matches on the theory that they
   * were weaker evidence. They are not: "send money" is the same evidence
   * whether or not the client filled in a field. What the discount actually
   * did was quietly weaken the detector for every message from a client that
   * omits the tag, which is a safety feature failing for a reason that has
   * nothing to do with the message. The real cost of running every lexicon is
   * a cross-language collision, and the fix for that is a narrower pattern,
   * not a blanket multiplier.
   */
  language?: string | null;
  /**
   * How many *distinct* recipients got a near-identical message from this
   * sender recently. Computed upstream from hashes, not message contents.
   */
  identicalMessageRecipients?: number;
  /** Minutes since the conversation started, for rush detection. */
  minutesSinceConversationStart?: number;
};

/**
 * The lexicons to run for a message.
 *
 * A declared language runs its own and nothing else, so Spanish wording cannot
 * fire on an Italian message. An undeclared one runs all of them — see
 * `MessageContext.language` for why that is not discounted.
 */
function lexicalPatterns(language: string | null | undefined): Pattern[] {
  const tag = language?.toLowerCase().split("-")[0];
  if (tag && LEXICONS[tag]) return LEXICONS[tag];
  return Object.values(LEXICONS).flat();
}

const MASS_MESSAGE_THRESHOLD = 5;
const RUSH_WINDOW_MINUTES = 15;

export function detectSignals(context: MessageContext): ScamSignal[] {
  const found = new Map<ScamSignalId, ScamSignal>();

  for (const pattern of [...UNIVERSAL, ...lexicalPatterns(context.language)]) {
    const match = pattern.regex.exec(context.text);
    if (!match) continue;

    const existing = found.get(pattern.id);
    if (existing && existing.confidence >= pattern.confidence) continue;

    found.set(pattern.id, {
      id: pattern.id,
      confidence: pattern.confidence,
      excerpt: match[0].slice(0, 120)
    });
  }

  const recipients = context.identicalMessageRecipients ?? 0;
  if (recipients >= MASS_MESSAGE_THRESHOLD) {
    found.set("mass_identical_message", {
      id: "mass_identical_message",
      // Scales with spread, capped so it alone can't reach the review threshold.
      confidence: Math.min(0.7, 0.4 + 0.05 * (recipients - MASS_MESSAGE_THRESHOLD))
    });
  }

  // Pushing to another platform in the first minutes is a stronger signal than
  // doing so after a real conversation has developed.
  const rushed =
    context.minutesSinceConversationStart !== undefined &&
    context.minutesSinceConversationStart <= RUSH_WINDOW_MINUTES;
  const offPlatform = found.get("off_platform_rush");
  if (rushed && offPlatform) {
    found.set("off_platform_rush", {
      ...offPlatform,
      confidence: Math.min(0.75, offPlatform.confidence + 0.3)
    });
  }

  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}

export type RiskBand = "none" | "low" | "elevated" | "high";

/**
 * What the platform does at each band. Note that no band bans an account:
 * enforcement is always downstream of a human decision.
 */
export type RiskOutcome = {
  band: RiskBand;
  /** Show a caution notice to the member who received the message. */
  warnRecipient: boolean;
  /** Make the report action prominent rather than buried in a menu. */
  promptReport: boolean;
  /** Queue for human moderator review. */
  queueForReview: boolean;
  signals: ScamSignal[];
};

const ELEVATED_THRESHOLD = 0.75;
const HIGH_THRESHOLD = 1.3;

export function assessRisk(context: MessageContext): RiskOutcome {
  const signals = detectSignals(context);

  // Combined confidence, with diminishing returns so a pile of weak lexical
  // hits can't add up to a high-risk verdict on its own.
  let combined = 0;
  signals.forEach((signal, index) => {
    combined += signal.confidence * (index === 0 ? 1 : 0.6);
  });

  const band: RiskBand =
    signals.length === 0
      ? "none"
      : combined >= HIGH_THRESHOLD
        ? "high"
        : combined >= ELEVATED_THRESHOLD
          ? "elevated"
          : "low";

  return {
    band,
    warnRecipient: band === "elevated" || band === "high",
    promptReport: band === "elevated" || band === "high",
    queueForReview: band === "high",
    signals
  };
}

/**
 * The moderation flow a risk assessment enters. Each step is a distinct state
 * so the admin panel can show exactly where a case sits, and so no step is
 * skippable — in particular, `action` is only reachable from `human_review`.
 */
export type ModerationStage = "warning" | "reported" | "human_review" | "action" | "dismissed";

export const moderationFlow: Record<ModerationStage, ModerationStage[]> = {
  warning: ["reported", "dismissed"],
  reported: ["human_review", "dismissed"],
  human_review: ["action", "dismissed"],
  action: [],
  dismissed: []
};

export function canTransition(from: ModerationStage, to: ModerationStage): boolean {
  return moderationFlow[from].includes(to);
}
