import { describe, expect, it } from "vitest";
import { assessRisk, canTransition, detectSignals } from "./scam-shield";

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
