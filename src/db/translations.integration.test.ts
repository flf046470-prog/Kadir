import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { messageTranslations, messages, translationUsage } from "./schema";
import { createTestUser, resetDatabase } from "./test-helpers";
import { recordLike } from "./interactions";
import { sendMessage } from "./messaging";
import { translateConversation, MAX_BATCH } from "./translations";
import { setTranslator } from "@/lib/translate";
import type { Translator } from "@/lib/translate";
import { ENTITLEMENTS } from "@/lib/billing/tiers";

/** Records every call, so the tests can assert on what was *not* sent. */
class StubTranslator implements Translator {
  readonly name = "stub";
  calls: { texts: string[]; target: string; source?: string }[] = [];
  failNext = false;

  async translate(texts: string[], target: string, source?: string): Promise<string[]> {
    this.calls.push({ texts, target, source });
    if (this.failNext) {
      this.failNext = false;
      throw new Error("provider is down");
    }
    return texts.map((text) => `[${target}] ${text}`);
  }
}

let stub: StubTranslator;

beforeEach(async () => {
  await resetDatabase();
  stub = new StubTranslator();
  setTranslator(stub);
});

afterEach(() => {
  setTranslator(null);
});

async function conversation() {
  const a = await createTestUser();
  const b = await createTestUser();
  await recordLike(a, b, "like");
  const result = await recordLike(b, a, "like");
  if (!result.matchId) throw new Error("expected a match");
  return { a, b, matchId: result.matchId };
}

describe("access control", () => {
  it("refuses a conversation that is not the caller's", async () => {
    const { matchId } = await conversation();
    const stranger = await createTestUser();

    expect(await translateConversation(stranger, matchId, "tr")).toBeNull();
    expect(stub.calls).toHaveLength(0);
  });
});

describe("what gets translated", () => {
  it("translates the partner's messages", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Hello there", "en");

    const result = await translateConversation(a, matchId, "tr");

    expect(Object.values(result!.translations)).toEqual(["[tr] Hello there"]);
    expect(result!.degraded).toBe(false);
  });

  it("never translates the member's own words back at them", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(a, matchId, "Something I wrote", "en");
    await sendMessage(b, matchId, "Something they wrote", "en");

    const result = await translateConversation(a, matchId, "tr");

    expect(Object.values(result!.translations)).toEqual(["[tr] Something they wrote"]);
    expect(stub.calls[0]?.texts).toEqual(["Something they wrote"]);
  });

  it("passes the language the message was written in as the source", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Merhaba", "tr");

    await translateConversation(a, matchId, "en");

    expect(stub.calls[0]?.source).toBe("tr");
  });

  it("splits one call per source language rather than mislabelling any of them", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Hello", "en");
    await sendMessage(b, matchId, "Merhaba", "tr");

    await translateConversation(a, matchId, "de");

    expect(stub.calls).toHaveLength(2);
    expect(stub.calls.map((call) => call.source).sort()).toEqual(["en", "tr"]);
  });

  it("calls nothing at all for a conversation with no incoming messages", async () => {
    const { a, matchId } = await conversation();

    const result = await translateConversation(a, matchId, "tr");

    expect(result).toEqual({ translations: {}, degraded: false, limitReached: false });
    expect(stub.calls).toHaveLength(0);
  });
});

describe("the cache", () => {
  it("does not pay twice for the same message and language", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Hello there", "en");

    await translateConversation(a, matchId, "tr");
    await translateConversation(a, matchId, "tr");
    await translateConversation(a, matchId, "tr");

    expect(stub.calls).toHaveLength(1);
  });

  it("asks only for the message that is new", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "First", "en");
    await translateConversation(a, matchId, "tr");

    await sendMessage(b, matchId, "Second", "en");
    const result = await translateConversation(a, matchId, "tr");

    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]?.texts).toEqual(["Second"]);
    // The cached one is still returned alongside the new one.
    expect(Object.values(result!.translations).sort()).toEqual(["[tr] First", "[tr] Second"]);
  });

  it("keeps the same message in two languages side by side", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Hello there", "en");

    await translateConversation(a, matchId, "tr");
    await translateConversation(a, matchId, "de");

    const rows = await db.select().from(messageTranslations);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.targetLanguage).sort()).toEqual(["de", "tr"]);
  });

  it("records which provider produced it", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Hello", "en");
    await translateConversation(a, matchId, "tr");

    const rows = await db.select().from(messageTranslations);
    expect(rows[0]?.provider).toBe("stub");
  });

  it("survives two tabs racing the same untranslated message", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Hello there", "en");

    await Promise.all([
      translateConversation(a, matchId, "tr"),
      translateConversation(a, matchId, "tr")
    ]);

    expect(await db.select().from(messageTranslations)).toHaveLength(1);
  });

  it("is derived data — deleting a message takes its translation with it", async () => {
    const { a, b, matchId } = await conversation();
    const sent = await sendMessage(b, matchId, "Hello", "en");
    if (!sent.ok) throw new Error("expected the message to send");
    await translateConversation(a, matchId, "tr");

    // A hard delete, not the app's soft delete: the point is the cascade.
    await db.delete(messages).where(eq(messages.id, sent.messageId));

    expect(await db.select().from(messageTranslations)).toHaveLength(0);
  });
});

describe("bounds", () => {
  /**
   * `MAX_BATCH` and the daily allowance are two different ceilings, and this
   * is the batch one: how much a *single* request will ask the provider for,
   * so opening a long conversation cannot become a thousand-segment bill.
   *
   * Run with the allowance removed, because otherwise the free tier's fifteen
   * a day is what stops it and the batch bound is never reached — the test
   * would pass while asserting nothing about the thing it names.
   */
  it("translates at most a screenful, newest first", async () => {
    const { a, b, matchId } = await conversation();
    for (let i = 0; i < MAX_BATCH + 5; i++) {
      await sendMessage(b, matchId, `Message ${i}`, "en");
    }

    const configured = ENTITLEMENTS.free.dailyTranslations;
    ENTITLEMENTS.free.dailyTranslations = null;
    let result;
    try {
      result = await translateConversation(a, matchId, "tr");
    } finally {
      ENTITLEMENTS.free.dailyTranslations = configured;
    }

    expect(Object.keys(result!.translations)).toHaveLength(MAX_BATCH);
    expect(stub.calls[0]?.texts).toContain(`Message ${MAX_BATCH + 4}`);
    expect(stub.calls[0]?.texts).not.toContain("Message 0");
  });
});

describe("when the provider fails", () => {
  it("degrades instead of taking the conversation down", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Hello", "en");
    stub.failNext = true;

    const result = await translateConversation(a, matchId, "tr");

    expect(result).toEqual({ translations: {}, degraded: true, limitReached: false });
    expect(await db.select().from(messageTranslations)).toHaveLength(0);
  });

  it("caches nothing on failure, so a retry actually retries", async () => {
    const { a, b, matchId } = await conversation();
    await sendMessage(b, matchId, "Hello", "en");

    stub.failNext = true;
    await translateConversation(a, matchId, "tr");
    const second = await translateConversation(a, matchId, "tr");

    expect(second!.degraded).toBe(false);
    expect(Object.values(second!.translations)).toEqual(["[tr] Hello"]);
  });
});

/**
 * The allowance that makes the product's central claim true for free members.
 *
 * The listing leads on meeting people you share no language with. Before this,
 * translation was a paid flag, so a free member who matched across a language
 * gap could not exchange one sentence — the headline was false for everyone who
 * had not paid. What is sold now is the ceiling, not the feature, and these
 * tests pin the difference.
 */
describe("the translation allowance", () => {
  async function withMessages(count: number) {
    const { a, b, matchId } = await conversation();
    for (let i = 0; i < count; i += 1) await sendMessage(b, matchId, `mesaj ${i}`);
    return { a, b, matchId };
  }

  /**
   * The ceiling is the tier's, and it is now read inside the transaction that
   * spends it rather than handed in by the caller. Raising and lowering the
   * configured number is how these tests reach it — the same way the like and
   * boost allowances are tested, and it exercises the real path rather than an
   * injected budget the production code no longer has.
   */
  async function withDailyLimit<T>(limit: number | null, work: () => Promise<T>): Promise<T> {
    const configured = ENTITLEMENTS.free.dailyTranslations;
    ENTITLEMENTS.free.dailyTranslations = limit;
    try {
      return await work();
    } finally {
      ENTITLEMENTS.free.dailyTranslations = configured;
    }
  }

  it("buys only as many translations as the allowance allows", async () => {
    const { a, matchId } = await withMessages(6);

    const result = await withDailyLimit(2, () => translateConversation(a, matchId, "tr"));

    expect(Object.keys(result!.translations)).toHaveLength(2);
    expect(result!.limitReached).toBe(true);
    expect(stub.calls.flatMap((call) => call.texts)).toHaveLength(2);
  });

  /**
   * Which two, specifically. A member near their limit is reading the bottom of
   * the conversation, so spending the allowance on the top of it would leave
   * every message they can actually see untranslated.
   */
  it("spends the allowance on the newest messages, not the oldest", async () => {
    const { a, matchId } = await withMessages(5);

    await withDailyLimit(2, () => translateConversation(a, matchId, "tr"));

    expect(stub.calls.flatMap((call) => call.texts).sort()).toEqual(["mesaj 3", "mesaj 4"]);
  });

  it("does not report a limit when everything fitted", async () => {
    const { a, matchId } = await withMessages(3);

    const result = await withDailyLimit(10, () => translateConversation(a, matchId, "tr"));

    expect(result!.limitReached).toBe(false);
    expect(Object.keys(result!.translations)).toHaveLength(3);
  });

  /**
   * The defect this replaces: the budget was applied with `slice(-budget)`, and
   * `slice(-0)` is `slice(0)` — the whole array. A member who had spent every
   * translation of the day was handed an unmetered batch on every call after
   * that, so the limit did nothing at exactly the point it was supposed to
   * start working, on the one line that costs money per character.
   */
  it("buys nothing once the allowance is exhausted", async () => {
    const { a, matchId } = await withMessages(6);

    await withDailyLimit(2, async () => {
      await translateConversation(a, matchId, "tr");
      stub.calls = [];

      const result = await translateConversation(a, matchId, "tr");

      // Two are cached from the first call and stay readable; nothing new is
      // bought, and the caller is told the ceiling was hit.
      expect(stub.calls).toHaveLength(0);
      expect(Object.keys(result!.translations)).toHaveLength(2);
      expect(result!.limitReached).toBe(true);
    });

    expect(await db.select().from(translationUsage)).toHaveLength(2);
  });

  /**
   * The route permits thirty calls a minute against a free ceiling of fifteen a
   * day. Read on the pool and spent later, every parallel caller saw the same
   * remaining budget and every one of them bought — on the most expensive line
   * in the cost model.
   */
  it("cannot be exceeded by translating in parallel", async () => {
    const { a, matchId } = await withMessages(8);

    await withDailyLimit(3, async () => {
      await Promise.all(
        Array.from({ length: 6 }, () => translateConversation(a, matchId, "tr"))
      );
    });

    expect(await db.select().from(translationUsage)).toHaveLength(3);
    expect(stub.calls.flatMap((call) => call.texts)).toHaveLength(3);
  });

  /**
   * A budget of zero is not the same as no translation.
   *
   * Everything already cached stays readable — it has been paid for, and a
   * member scrolling back through a conversation they translated yesterday
   * should not watch it revert to a language they cannot read.
   */
  it("still serves cached translations once the allowance is spent", async () => {
    const { a, matchId } = await withMessages(2);

    await withDailyLimit(2, async () => {
      await translateConversation(a, matchId, "tr");
      stub.calls = [];

      const result = await translateConversation(a, matchId, "tr");

      expect(Object.keys(result!.translations)).toHaveLength(2);
      expect(result!.limitReached).toBe(false);
      expect(stub.calls).toHaveLength(0);
    });
  });

  it("charges the allowance for new translations only, never for cache hits", async () => {
    const { a, matchId } = await withMessages(3);

    await translateConversation(a, matchId, "tr");
    const afterFirst = await db.select().from(translationUsage);

    // Reading the same conversation again costs the provider nothing, so it
    // must cost the member nothing.
    await translateConversation(a, matchId, "tr");
    const afterSecond = await db.select().from(translationUsage);

    expect(afterFirst).toHaveLength(3);
    expect(afterSecond).toHaveLength(3);
  });

  /**
   * A failed provider call must not be billed to the member. Otherwise an
   * outage silently eats a free member's day.
   *
   * The allowance is now claimed *before* the provider is asked, so this is a
   * refund rather than a not-yet-charged: the receipts for the failed group are
   * deleted. Claiming up front is what stops parallel callers all believing
   * they have room; refunding is what keeps this property alongside it.
   */
  it("does not spend the allowance when the provider fails", async () => {
    const { a, matchId } = await withMessages(2);
    stub.failNext = true;

    const result = await translateConversation(a, matchId, "tr");

    expect(result!.degraded).toBe(true);
    expect(await db.select().from(translationUsage)).toHaveLength(0);
  });
});
