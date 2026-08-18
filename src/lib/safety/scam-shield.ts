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
 * Patterns are intentionally about *behaviour in the message*, not about who
 * wrote it. Kept in one list so the admin panel can tune them without a deploy.
 */
const PATTERNS: Pattern[] = [
  {
    id: "money_request",
    confidence: 0.8,
    regex:
      /\b(send|wire|transfer|lend|borrow|need)\b[^.!?]{0,40}\b(money|cash|funds|euros?|dollars?|pounds?|lira)\b/i
  },
  {
    id: "money_request",
    confidence: 0.75,
    regex: /\b(western union|moneygram|gift ?cards?|itunes card|steam card)\b/i
  },
  {
    id: "crypto_or_investment",
    confidence: 0.8,
    regex:
      /\b(bitcoin|btc|ethereum|eth|usdt|crypto|binance|trading (?:platform|signals?)|investment opportunity|guaranteed returns?)\b/i
  },
  {
    id: "suspicious_link",
    confidence: 0.5,
    // URL shorteners and bare IPs are the shapes that actually correlate with abuse.
    regex: /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|\d{1,3}(?:\.\d{1,3}){3})\b/i
  },
  {
    id: "off_platform_rush",
    confidence: 0.45,
    regex:
      /\b(whats ?app|telegram|signal app|viber|kakao|line id|wechat|snap ?chat)\b[^.!?]{0,30}\b(me|now|instead|quickly|there)\b/i
  },
  {
    id: "contact_detail_request",
    confidence: 0.35,
    regex: /\b(send|give|what'?s)\b[^.!?]{0,25}\b(your )?(phone number|email address|bank|iban|account number)\b/i
  },
  {
    id: "urgency_pressure",
    confidence: 0.4,
    regex:
      /\b(urgent(?:ly)?|emergency|right now|as soon as possible|hospital|stuck at (?:the )?(?:airport|customs)|visa fee|customs fee)\b/i
  }
];

export type MessageContext = {
  text: string;
  /**
   * How many *distinct* recipients got a near-identical message from this
   * sender recently. Computed upstream from hashes, not message contents.
   */
  identicalMessageRecipients?: number;
  /** Minutes since the conversation started, for rush detection. */
  minutesSinceConversationStart?: number;
};

const MASS_MESSAGE_THRESHOLD = 5;
const RUSH_WINDOW_MINUTES = 15;

export function detectSignals(context: MessageContext): ScamSignal[] {
  const found = new Map<ScamSignalId, ScamSignal>();

  for (const pattern of PATTERNS) {
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
