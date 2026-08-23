import { and, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { messageTranslations, messages } from "./schema";
import { resolveMatchFor } from "./messaging";
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
};

const EMPTY: TranslateResult = { translations: {}, degraded: false };

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
  targetLanguage: string
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

  const missing = recent.filter((row) => !(row.id in translations));
  if (missing.length === 0) return { translations, degraded: false };

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

  return { translations, degraded };
}
