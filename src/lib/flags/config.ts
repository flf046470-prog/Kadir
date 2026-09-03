import { ROLLOUT_STEPS, defaultFlags, type FeatureName, type FlagConfig } from "./flags";

/**
 * Where the rollout percentages actually come from.
 *
 * `defaultFlags` is the compiled-in baseline; this reads an override out of the
 * environment so widening a rollout, or killing a feature during an incident,
 * is a config change rather than a deploy. That distinction is the whole point
 * of a flag: a percentage that can only be changed by shipping code is not a
 * rollout, it is a constant with extra steps.
 *
 * Shape, as JSON in `FEATURE_FLAGS`:
 *
 *   {"ai_translation": {"rollout": 25}, "match_games": {"killed": true}}
 *
 * Anything malformed throws at startup rather than being ignored. A dropped
 * override is the worst outcome available here: the deploy believes a feature
 * is at 25% and it is at whatever the default says, and nothing anywhere
 * reports the difference.
 */

const ENV_VAR = "FEATURE_FLAGS";

let cached: Partial<Record<FeatureName, FlagConfig>> | null = null;

function isFeature(name: string): name is FeatureName {
  return Object.hasOwn(defaultFlags, name);
}

/**
 * Validates one entry, naming the key in every failure.
 *
 * The error messages carry the flag name because this throws at startup, where
 * the only debugging surface is the log line — "invalid rollout" with no name
 * is a search through the whole JSON.
 */
function parseEntry(name: string, raw: unknown): FlagConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${ENV_VAR}["${name}"] must be an object`);
  }

  const entry = raw as Record<string, unknown>;
  const config: FlagConfig = { rollout: defaultFlags[name as FeatureName].rollout };

  if (entry.rollout !== undefined) {
    /**
     * Only the published steps are accepted.
     *
     * An arbitrary integer would work fine with `bucketOf`, but the steps exist
     * so that a widening is always a superset of the cohort before it. Allowing
     * 37 invites someone to *narrow* a rollout to 20 after a 25, which drops
     * members who already had the feature — and taking a feature back from
     * someone is the one thing a staged rollout must never do by accident.
     */
    if (!ROLLOUT_STEPS.includes(entry.rollout as (typeof ROLLOUT_STEPS)[number])) {
      throw new Error(
        `${ENV_VAR}["${name}"].rollout must be one of ${ROLLOUT_STEPS.join(", ")} — got ${JSON.stringify(entry.rollout)}`
      );
    }
    config.rollout = entry.rollout as FlagConfig["rollout"];
  }

  if (entry.killed !== undefined) {
    if (typeof entry.killed !== "boolean") {
      throw new Error(`${ENV_VAR}["${name}"].killed must be a boolean`);
    }
    config.killed = entry.killed;
  }

  if (entry.alwaysOn !== undefined) {
    if (!Array.isArray(entry.alwaysOn) || entry.alwaysOn.some((id) => typeof id !== "string")) {
      throw new Error(`${ENV_VAR}["${name}"].alwaysOn must be an array of member ids`);
    }
    config.alwaysOn = entry.alwaysOn as string[];
  }

  return config;
}

/** Parses the override, or returns an empty one when nothing is set. */
export function parseFlagOverrides(raw: string | undefined): Partial<Record<FeatureName, FlagConfig>> {
  if (!raw || raw.trim() === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${ENV_VAR} is not valid JSON`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${ENV_VAR} must be a JSON object of flag name → config`);
  }

  const overrides: Partial<Record<FeatureName, FlagConfig>> = {};

  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    /**
     * An unknown name is a typo, and a typo is silence.
     *
     * `{"ai_translations": {"rollout": 0}}` — plural — would otherwise parse
     * cleanly, override nothing, and leave the feature running at whatever the
     * default is while the operator believes they turned it off. During an
     * incident that is the difference between a kill switch and a delay.
     */
    if (!isFeature(name)) {
      throw new Error(
        `${ENV_VAR} names "${name}", which is not a feature. Known features: ${Object.keys(defaultFlags).join(", ")}`
      );
    }
    overrides[name] = parseEntry(name, value);
  }

  return overrides;
}

/**
 * The live flag configuration, parsed once.
 *
 * Cached because it is read on nearly every request and the environment does
 * not change under a running process. `resetFlagConfig` exists for tests.
 */
export function flagConfig(): Partial<Record<FeatureName, FlagConfig>> {
  cached ??= parseFlagOverrides(process.env[ENV_VAR]);
  return cached;
}

/** Test hook. Clears the parsed cache so a new environment is read. */
export function resetFlagConfig(): void {
  cached = null;
}
