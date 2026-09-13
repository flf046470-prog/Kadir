import { isEnabled, defaultFlags, type FeatureName } from "./flags";
import { flagConfig } from "./config";

/**
 * Reading a flag on the server.
 *
 * The one place request code should touch flags. `isEnabled` is pure and takes
 * its configuration as an argument, which makes it testable and makes it easy
 * to call with the *wrong* configuration; this binds it to the environment so
 * there is a single answer per member per deploy.
 *
 * Bucketing needs a stable member id, so these take one rather than reaching
 * for the session themselves. A signed-out visitor has no stable id — anything
 * derived from an IP or a fresh cookie would move them between cohorts on every
 * visit, which is the one property a staged rollout cannot have — so gated
 * features are simply off for them, and callers pass `null` to say so.
 */

export function featureEnabled(feature: FeatureName, memberId: string | null): boolean {
  if (!memberId) return false;
  return isEnabled(feature, { memberId, flags: flagConfig() });
}

/** Every flag on for this member. For a debug view and the entitlements payload. */
export function enabledFeaturesFor(memberId: string | null): FeatureName[] {
  if (!memberId) return [];
  const flags = flagConfig();
  return (Object.keys(defaultFlags) as FeatureName[]).filter((feature) =>
    isEnabled(feature, { memberId, flags })
  );
}

/**
 * The flags something actually reads.
 *
 * Twenty-two flags were declared and none were read — `isEnabled` had no
 * callers anywhere in the codebase, so every rollout percentage was a number
 * that described nothing. Rather than wire all twenty-two at once and pretend
 * a rollout exists for features that do not, this names the ones that are
 * genuinely connected, and `flags.test.ts` asserts the list stays true.
 *
 * A flag is added here when a call site is added, not before. The rest stay
 * declared and unread, which is a smaller lie once it is written down.
 */
export const WIRED_FLAGS: FeatureName[] = ["ai_translation", "virtual_dates"];

/**
 * The wired flags that are deliberately off.
 *
 * "Wired" and "on" were the same thing while translation was the only gate, and
 * collapsing them was harmless until something was built that should not ship
 * yet. Virtual date invitations are that: the flow works end to end, the routes
 * and the screens enforce it, and the date itself has nowhere to happen until
 * there is a client to hold it in.
 *
 * Naming them separately keeps both halves checkable — a flag here must be
 * wired and must be at zero, and a wired flag *not* here must be above zero — so
 * neither a forgotten gate nor a shipping feature switched off by accident can
 * hide in the gap between the two lists.
 */
export const DARK_FLAGS: FeatureName[] = ["virtual_dates"];
