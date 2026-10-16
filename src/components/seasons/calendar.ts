/** Trevelin, Chubut. Its IANA zone shares Argentina's UTC−03 civil time. */
export const TREVELIN_TIME_ZONE = "America/Argentina/Catamarca";
export const SEASON_ORDER = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASON_ORDER)[number];

const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TREVELIN_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export function getTrevelinDate(date: Date) {
  const parts = dateParts.formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

/**
 * Argentina's conventional tourism calendar, with changes on the 21st:
 * https://www.larutanatural.gob.ar/es/acerca-de-argentina
 * These are civil calendar boundaries, not calculated astronomical instants.
 * Always use Trevelin's date, independently of the visitor's clock zone.
 */
export function getTrevelinSeason(date: Date): Season {
  const { month, day } = getTrevelinDate(date);
  const stamp = month * 100 + day;
  if (stamp >= 1221 || stamp < 321) return "summer";
  if (stamp >= 921) return "spring";
  if (stamp >= 621) return "winter";
  return "autumn";
}
