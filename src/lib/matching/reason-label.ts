import { placeLabel } from "../countries-data";

/**
 * Turning a scored reason into something a member can read.
 *
 * Reasons travel as ids and evidence values — `relationship_goal` with
 * `long_term`, `language` with `en` — because the engine must not care what
 * language anyone reads in. Naming them is therefore a display concern, and it
 * lives here so Discover and Today's 5 cannot drift: the same reason showing
 * as "Uzun süreli ilişki" on one screen and `long_term` on the other reads as
 * a broken product, which is precisely what it is.
 */

export type Translator = (key: string) => string;

/**
 * Language tags are stored as codes and read as names, in the viewer's own
 * language. `Intl.DisplayNames` knows every tag we accept, and an unknown one
 * falls back to the code rather than to nothing.
 */
export function languageName(tag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(tag) ?? tag.toUpperCase();
  } catch {
    return tag.toUpperCase();
  }
}

/**
 * Evidence values are ids, so they are translated the same way the rest of the
 * vocabulary is. Free-text evidence (interests a member typed) has no
 * translation and is shown as written.
 */
export function reasonValueLabel(
  reasonId: string,
  value: string,
  taxonomy: Translator,
  locale: string
): string {
  if (reasonId === "relationship_goal") return taxonomy(`relationshipGoals.${value}`);
  if (reasonId === "match_intent") return taxonomy(`matchIntents.${value}`);
  if (reasonId === "location") return placeLabel(value);
  if (reasonId === "language" || reasonId === "language_exchange") {
    return languageName(value, locale);
  }
  return value;
}

/** One complete line: the reason's name, then its evidence. */
export function reasonLine(
  reason: { id: string; values: string[] },
  taxonomy: Translator,
  locale: string
): string {
  const name = taxonomy(`reasons.${reason.id}`);
  if (reason.values.length === 0) return name;
  const evidence = reason.values
    .map((value) => reasonValueLabel(reason.id, value, taxonomy, locale))
    .join(", ");
  return `${name}: ${evidence}`;
}
