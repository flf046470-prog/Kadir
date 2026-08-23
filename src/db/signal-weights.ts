import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { signalWeights } from "./schema";
import { applyFeedback, clampWeights, MAX_MULTIPLIER, MIN_MULTIPLIER } from "@/lib/matching/learning";
import type { SignalWeights } from "@/lib/matching/score";
import type { SignalId } from "@/lib/matching/signals";
import type { PassReasonId } from "@/lib/domain/taxonomies";

/**
 * Smart Match — the learned half of the matching engine.
 *
 * Weights are multipliers on the signals the engine already scores, stored per
 * member. They move only when a member volunteers a reason for passing; the
 * engine itself stays a pure function that is handed the multipliers, so what
 * is learned is always inspectable rather than hidden inside the scorer.
 *
 * Nothing here stores a preference about people. A multiplier says "this
 * member cares more about language than average", never anything about who
 * they were shown or who they rejected.
 */

/** Stored as an integer percentage: 100 is neutral, 160 the ceiling. */
function toMultiplier(stored: number): number {
  return stored / 100;
}

function toStored(multiplier: number): number {
  return Math.round(multiplier * 100);
}

/**
 * A member's learned multipliers, ready to hand to `scoreMatch`.
 *
 * Clamped on the way out as well as on the way in: a row edited directly in
 * the database must not be able to push one signal far enough to dominate
 * every score.
 */
export async function loadLearnedWeights(userId: string): Promise<SignalWeights> {
  const rows = await db
    .select({ signalId: signalWeights.signalId, multiplier: signalWeights.multiplier })
    .from(signalWeights)
    .where(eq(signalWeights.userId, userId));

  const weights: SignalWeights = {};
  for (const row of rows) {
    weights[row.signalId as SignalId] = toMultiplier(row.multiplier);
  }
  return clampWeights(weights);
}

/**
 * Folds one pass reason into the member's weights.
 *
 * Vague reasons ("not my type") map to no signal and are deliberately dropped
 * by `applyFeedback` rather than guessed at, so this can be a no-op — and when
 * it is, nothing is written.
 *
 * Runs inside the caller's transaction when given one, so a pass and the
 * learning it causes commit together or not at all.
 */
export async function recordPassFeedback(
  userId: string,
  reason: PassReasonId,
  tx: Pick<typeof db, "select" | "insert"> = db
): Promise<void> {
  const rows = await tx
    .select({ signalId: signalWeights.signalId, multiplier: signalWeights.multiplier })
    .from(signalWeights)
    .where(eq(signalWeights.userId, userId));

  const current: SignalWeights = {};
  for (const row of rows) current[row.signalId as SignalId] = toMultiplier(row.multiplier);

  const next = clampWeights(applyFeedback(current, [{ reason }]));

  // Only the signals that actually moved are written.
  const changed = Object.entries(next).filter(
    ([id, value]) => (current[id as SignalId] ?? 1) !== (value ?? 1)
  );
  if (changed.length === 0) return;

  await tx
    .insert(signalWeights)
    .values(
      changed.map(([signalId, multiplier]) => ({
        userId,
        signalId,
        multiplier: toStored(multiplier ?? 1)
      }))
    )
    .onConflictDoUpdate({
      target: [signalWeights.userId, signalWeights.signalId],
      set: { multiplier: sql`excluded.multiplier` }
    });
}

export { MAX_MULTIPLIER, MIN_MULTIPLIER };
