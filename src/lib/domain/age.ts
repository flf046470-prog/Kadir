/**
 * Age is always derived from a birthdate, never stored.
 *
 * A stored age is wrong for one day a year per member, and on a dating product
 * that is a real harm: the age filter, the minimum-age gate, and what one
 * member reads on another's card all have to agree.
 */

/** Whole years old on `asOf`, computed without date-library rounding surprises. */
export function ageOn(birthdate: string, asOf: Date = new Date()): number | null {
  const parts = birthdate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;

  const [year, month, day] = parts;
  const born = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(born.getTime())) return null;
  // Reject a date that rolled over, e.g. 2000-02-31 becoming March 2nd.
  if (born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) return null;
  if (born.getTime() > asOf.getTime()) return null;

  let age = asOf.getUTCFullYear() - year;
  const monthDelta = asOf.getUTCMonth() - (month - 1);
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getUTCDate() < day)) age -= 1;

  return age;
}
