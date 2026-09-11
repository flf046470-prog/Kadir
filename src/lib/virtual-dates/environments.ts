import { TIERS, type Tier } from "../billing/tiers";

/**
 * Where a virtual date can be held.
 *
 * Ids and the tier each requires, and nothing else. No display names, no
 * descriptions, no images — those arrive with the screens that show them, and
 * putting them here first would be writing a menu for a kitchen that does not
 * exist.
 *
 * The catalogue is here rather than in the entitlements table on purpose.
 * `Entitlements` holds numbers and booleans the app enforces; the set of
 * environments is a list that will grow, and encoding it as `premiumVR: true`
 * would mean every new environment is either free to everyone or needs a new
 * entitlement field. A tier per environment scales; a boolean per tier does
 * not.
 *
 * **This is enforced, not advertised.** `environmentFor` refuses an id above
 * the member's tier at invite time, server-side. Nothing in the product names
 * these to a member yet, and nothing should until they can be walked into.
 */

export type VirtualEnvironment = {
  id: string;
  /** The lowest tier that may choose it. */
  minimumTier: Tier;
};

/**
 * Ordered free first, which is also the order a picker would show them in.
 *
 * The free environment is deliberately a plain one. A free tier with no
 * environment at all would make the whole feature a paid feature, and the
 * lesson from translation is that the thing to sell is the ceiling rather than
 * the feature — someone should be able to have a real virtual date and find out
 * whether it is worth paying for.
 */
export const ENVIRONMENTS: VirtualEnvironment[] = [
  { id: "basic_cafe", minimumTier: "free" },
  { id: "sunset_beach", minimumTier: "plus" },
  { id: "star_observatory", minimumTier: "plus" },
  { id: "luxury_restaurant", minimumTier: "vip" },
  { id: "rooftop", minimumTier: "vip" },
  { id: "tropical_island", minimumTier: "vip" }
];

const RANK: Record<Tier, number> = { free: 0, plus: 1, vip: 2 };

/** The default when an invitation names no environment. */
export const DEFAULT_ENVIRONMENT = "basic_cafe";

export function environmentById(id: string): VirtualEnvironment | null {
  return ENVIRONMENTS.find((environment) => environment.id === id) ?? null;
}

/** Every environment this tier may choose, for a picker. */
export function environmentsFor(tier: Tier): VirtualEnvironment[] {
  return ENVIRONMENTS.filter((environment) => RANK[environment.minimumTier] <= RANK[tier]);
}

export type EnvironmentChoice =
  | { ok: true; id: string }
  | { ok: false; reason: "unknown_environment" | "environment_locked" };

/**
 * Resolves a requested environment against what the tier allows.
 *
 * An unknown id is refused rather than defaulted. Silently substituting the
 * free café for a typo would put two people somewhere neither of them chose,
 * and — worse — would make a locked environment indistinguishable from a
 * working one for anyone probing the API.
 */
export function environmentFor(requested: string | null | undefined, tier: Tier): EnvironmentChoice {
  if (!requested) return { ok: true, id: DEFAULT_ENVIRONMENT };

  const environment = environmentById(requested);
  if (!environment) return { ok: false, reason: "unknown_environment" };

  if (RANK[environment.minimumTier] > RANK[tier]) {
    return { ok: false, reason: "environment_locked" };
  }

  return { ok: true, id: environment.id };
}

/** Every tier named in the catalogue is a real tier. Guards a typo in the data. */
export function catalogueIsValid(): boolean {
  return ENVIRONMENTS.every((environment) => TIERS.includes(environment.minimumTier));
}
