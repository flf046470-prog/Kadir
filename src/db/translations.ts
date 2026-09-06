import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { messageTranslations, messages, translationUsage } from "./schema";
import { resolveMatchFor } from "./messaging";
import { translationAllowance } from "./entitlements";
import { advisoryLockKey } from "./advisory-lock";
import { translationEnabled, translator } from "@/lib/translate";

/**
 * Message translation, cached.
 *
 * The pieces that matter are all about *not* calling the provider:
 *
 *  - **Cached by (message, target language).** The conversation polls every
 *    couple of seconds; without this, reading one screen twice would be two
 *    bills for identical text.
 *  - **Only the partner's messages.** Translating a member's own words back at
 *    them is a paid round trip to show them what they just typed.
 *  - **Only what is missing.** A batch asks the provider for the messages that
 *    are not cached yet, never the whole screen.
 *  - **Bounded.** One request translates at most a screenful, so opening an old
 *    conversation cannot turn into a thousand-segment bill.
 *
 * A provider failure is not an error the conversation propagates. Translation
 * is an aid on top of the real messages; if it breaks, the messages are still
 * there, and the caller gets no translation rather than an empty screen.
 */

/** Most a single request will translate. Roughly a long screenful. */
export const MAX_BATCH = 40;

export type TranslationMap = Record<string, string>;

export type TranslateResult = {
  /** Message id → translated body. Missing ids simply were not translated. */
  translations: TranslationMap;
  /** True when the provider was reached for something and failed. */
  degraded: boolean;
  /**
   * True when there was more to translate than the member's allowance allowed.
   *
   * Distinct from `degraded`, because the two mean opposite things to the
   * reader: degraded is "we tried and it broke, try again", and this is "you
   * have used today's free translations". Collapsing them would either nag a
   * paying member about a limit they do not have, or tell a free member to
   * retry something that will not change until tomorrow.
   */
  limitReached: boolean;
};

const EMPTY: TranslateResult = { translations: {}, degraded: false, limitReached: false };

/**
 * Translates the partner's messages in one conversation into `targetLanguage`.
 *
 * Membership is resolved through `resolveMatchFor`, the same gate the messages
 * themselves use, so this cannot be used to read — or pay to translate —
 * someone else's conversation.
 */
export async function translateConversation(
  userId: string,
  matchId: string,
  targetLanguage: string,
  now: Date = new Date()
): Promise<TranslateResult | null> {
  const match = await resolveMatchFor(userId, matchId);
  if (!match) return null;

  if (!translationEnabled()) return EMPTY;

  const rows = await db
    .select({ id: messages.id, body: messages.body, language: messages.language })
    .from(messages)
    .where(and(eq(messages.matchId, matchId), eq(messages.senderId, match.partnerId)))
    .orderBy(messages.createdAt);

  // The newest messages are the ones on screen; an old conversation is read
  // from the bottom, so that is the end worth spending the batch on.
  const recent = rows.slice(-MAX_BATCH);
  if (recent.length === 0) return EMPTY;

  const cached = await db
    .select({ messageId: messageTranslations.messageId, body: messageTranslations.body })
    .from(messageTranslations)
    .where(
      and(
        inArray(
          messageTranslations.messageId,
          recent.map((row) => row.id)
        ),
        eq(messageTranslations.targetLanguage, targetLanguage)
      )
    );

  const translations: TranslationMap = {};
  for (const row of cached) translations[row.messageId] = row.body;

  const allMissing = recent.filter((row) => !(row.id in translations));
  if (allMissing.length === 0) return { translations, degraded: false, limitReached: false };

  /**
   * The allowance is claimed here, in one short transaction, before a single
   * character is bought.
   *
   * It used to be read in the route and spent here, on two connections with a
   * whole translation round trip between them. The route permits thirty calls
   * a minute and the free tier allows fifteen translations a day, so thirty
   * parallel requests each read "fifteen left" and each bought up to fifteen —
   * four hundred and fifty provider-billed translations against a ceiling of
   * fifteen. This is the most expensive line in `cost-model.mjs`, so of every
   * allowance in the product it is the one that must not be a check-then-act.
   *
   * The transaction is deliberately short and holds no network call. Keeping a
   * pool connection open across a provider round trip is the deadlock
   * `db/pool.integration.test.ts` exists to catch; the budget is claimed, the
   * transaction commits, and only then does the provider get asked.
   */
  const claim = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${advisoryLockKey(`translate:${userId}`)})`);

    const allowance = await translationAllowance(userId, now, tx);
    const budget =
      allowance.limit === null ? null : Math.max(allowance.limit - allowance.used, 0);

    /**
     * `budget === 0` is spelled out rather than left to `slice`.
     *
     * `slice(-0)` is `slice(0)`, which returns the *whole* array — so a member
     * who had used every translation of the day was handed an unmetered batch
     * on every call after that. The limit did nothing precisely once it was
     * supposed to start working, on the one line that costs money per
     * character. Negative zero is why: it is the one budget value where
     * "take the last n" has no sensible reading.
     */
    const spend =
      budget === null ? allMissing : budget === 0 ? [] : allMissing.slice(-budget);

    if (spend.length === 0) return { spend, receipts: new Map<string, string>() };

    /**
     * The usage rows are written *before* the provider is called, so the budget
     * is spent the moment it is committed to. A failed group is refunded below
     * — the alternative, writing them afterwards, is what let parallel callers
     * agree they all had room.
     */
    const written = await tx
      .insert(translationUsage)
      .values(
        spend.map((row) => ({
          userId,
          messageId: row.id,
          targetLanguage,
          createdAt: now
        }))
      )
      .returning({ id: translationUsage.id, messageId: translationUsage.messageId });

    return { spend, receipts: new Map(written.map((row) => [row.messageId, row.id])) };
  });

  const missing = claim.spend;
  const limitReached = missing.length < allMissing.length;

  if (missing.length === 0) return { translations, degraded: false, limitReached };

  const provider = translator();

  // One call per source language: the provider takes a single `source_lang`,
  // and telling it the wrong one is worse than telling it nothing.
  const byLanguage = new Map<string | null, typeof missing>();
  for (const row of missing) {
    const group = byLanguage.get(row.language) ?? [];
    group.push(row);
    byLanguage.set(row.language, group);
  }

  let degraded = false;

  for (const [language, group] of byLanguage) {
    let translated: string[];
    try {
      translated = await provider.translate(
        group.map((row) => row.body),
        targetLanguage,
        language ?? undefined
      );
    } catch (error) {
      // The messages themselves are unaffected, so this degrades rather than
      // fails: the reader sees the original text and a quiet notice.
      console.error("Translation provider failed", error);
      degraded = true;

      /**
       * Refund this group's claim.
       *
       * The allowance is spent up front so that parallel callers cannot all
       * believe they have room; the cost of that is that a provider failure
       * has already charged the member. Deleting the receipts restores the
       * property the old ordering had for free — nobody pays an allowance for
       * a translation they did not receive — without giving back the
       * atomicity. Only this group's rows go: the other languages in this
       * request may have succeeded.
       */
      const refunds = group
        .map((row) => claim.receipts.get(row.id))
        .filter((id): id is string => id !== undefined);

      if (refunds.length > 0) {
        await db.delete(translationUsage).where(inArray(translationUsage.id, refunds));
      }

      continue;
    }

    const rowsToCache = group.map((row, index) => ({
      messageId: row.id,
      targetLanguage,
      body: translated[index] ?? row.body,
      provider: provider.name
    }));

    // Two tabs can race the same untranslated message. Whichever lands first
    // wins; the other's identical result is discarded rather than erroring.
    await db.insert(messageTranslations).values(rowsToCache).onConflictDoNothing();

    for (const row of rowsToCache) translations[row.messageId] = row.body;
  }

  return { translations, degraded, limitReached };
}
