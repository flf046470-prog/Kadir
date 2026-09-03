/**
 * What time it is where the other person is.
 *
 * The first thirty seconds of a cross-border conversation are spent working out
 * whether the other person is awake. Every member already carries a city and a
 * country, so the app can answer that instead of making two people negotiate it
 * in a language neither of them shares.
 *
 * The awkward part is that place ids are free text. `slugifyPlace` normalises
 * what a member typed; it does not check it against a gazetteer, so `cityId`
 * can be `kadikoy`, `bahnhofsviertel`, or a misspelling. There is therefore no
 * general derivation from a place id to a timezone, and this file does not
 * pretend otherwise: it resolves what it knows and returns null for everything
 * else.
 *
 * **Null is the important case.** Showing the wrong local time is worse than
 * showing none — the feature exists to remove a question, and a confidently
 * wrong answer replaces it with a worse one ("why did they message me at 4am?"
 * about someone who did not). Callers render nothing when this returns null.
 */

/**
 * Countries whose zone is a safe default for the whole country.
 *
 * A city entry always wins over this, so the bar is "right for the
 * overwhelming majority of members", not "right for every square kilometre".
 * Spain's Canary Islands and France's overseas départements sit on other
 * zones; the mainland is what a default is for, and a city fixes the rest.
 */
export const COUNTRY_ZONES: Record<string, string> = {
  turkey: "Europe/Istanbul",
  germany: "Europe/Berlin",
  france: "Europe/Paris",
  italy: "Europe/Rome",
  spain: "Europe/Madrid",
  portugal: "Europe/Lisbon",
  netherlands: "Europe/Amsterdam",
  belgium: "Europe/Brussels",
  austria: "Europe/Vienna",
  switzerland: "Europe/Zurich",
  poland: "Europe/Warsaw",
  sweden: "Europe/Stockholm",
  norway: "Europe/Oslo",
  denmark: "Europe/Copenhagen",
  finland: "Europe/Helsinki",
  ireland: "Europe/Dublin",
  "united-kingdom": "Europe/London",
  uk: "Europe/London",
  greece: "Europe/Athens",
  czechia: "Europe/Prague",
  romania: "Europe/Bucharest",
  hungary: "Europe/Budapest",
  ukraine: "Europe/Kyiv",
  bulgaria: "Europe/Sofia",
  croatia: "Europe/Zagreb",
  serbia: "Europe/Belgrade",

  japan: "Asia/Tokyo",
  "south-korea": "Asia/Seoul",
  korea: "Asia/Seoul",
  china: "Asia/Shanghai",
  india: "Asia/Kolkata",
  pakistan: "Asia/Karachi",
  bangladesh: "Asia/Dhaka",
  thailand: "Asia/Bangkok",
  vietnam: "Asia/Ho_Chi_Minh",
  philippines: "Asia/Manila",
  malaysia: "Asia/Kuala_Lumpur",
  singapore: "Asia/Singapore",
  "united-arab-emirates": "Asia/Dubai",
  uae: "Asia/Dubai",
  "saudi-arabia": "Asia/Riyadh",
  qatar: "Asia/Qatar",
  israel: "Asia/Jerusalem",
  iran: "Asia/Tehran",
  iraq: "Asia/Baghdad",
  georgia: "Asia/Tbilisi",
  azerbaijan: "Asia/Baku",
  armenia: "Asia/Yerevan",

  egypt: "Africa/Cairo",
  morocco: "Africa/Casablanca",
  tunisia: "Africa/Tunis",
  algeria: "Africa/Algiers",
  nigeria: "Africa/Lagos",
  kenya: "Africa/Nairobi",
  ghana: "Africa/Accra",
  "south-africa": "Africa/Johannesburg",

  argentina: "America/Argentina/Buenos_Aires",
  chile: "America/Santiago",
  colombia: "America/Bogota",
  peru: "America/Lima",
  uruguay: "America/Montevideo",
  cuba: "America/Havana",

  "new-zealand": "Pacific/Auckland"
};

/**
 * Countries deliberately absent from the map above.
 *
 * Each spans zones far enough apart that a country-level default would be
 * hours wrong for a large share of its members — a New Yorker shown Los
 * Angeles time is exactly the confidently-wrong answer this file refuses to
 * give. Members here resolve by city or not at all.
 *
 * Listed rather than merely omitted so the omission reads as a decision, and
 * so a test can assert none of them creeps into `COUNTRY_ZONES` later.
 */
export const MULTI_ZONE_COUNTRIES = [
  "usa",
  "united-states",
  "canada",
  "russia",
  "brazil",
  "australia",
  "mexico",
  "indonesia",
  "kazakhstan",
  "mongolia",
  "greenland"
];

/**
 * Cities, which win over the country default.
 *
 * Two jobs: giving the multi-zone countries above a way to resolve at all, and
 * correcting a country default where a city sits on a different zone.
 */
export const CITY_ZONES: Record<string, string> = {
  istanbul: "Europe/Istanbul",
  ankara: "Europe/Istanbul",
  izmir: "Europe/Istanbul",
  berlin: "Europe/Berlin",
  munich: "Europe/Berlin",
  hamburg: "Europe/Berlin",
  paris: "Europe/Paris",
  lyon: "Europe/Paris",
  marseille: "Europe/Paris",
  madrid: "Europe/Madrid",
  barcelona: "Europe/Madrid",
  valencia: "Europe/Madrid",
  "las-palmas": "Atlantic/Canary",
  rome: "Europe/Rome",
  milan: "Europe/Rome",
  bologna: "Europe/Rome",
  london: "Europe/London",
  dublin: "Europe/Dublin",
  amsterdam: "Europe/Amsterdam",
  lisbon: "Europe/Lisbon",
  athens: "Europe/Athens",
  warsaw: "Europe/Warsaw",
  vienna: "Europe/Vienna",
  zurich: "Europe/Zurich",
  stockholm: "Europe/Stockholm",
  copenhagen: "Europe/Copenhagen",
  helsinki: "Europe/Helsinki",

  tokyo: "Asia/Tokyo",
  osaka: "Asia/Tokyo",
  seoul: "Asia/Seoul",
  beijing: "Asia/Shanghai",
  shanghai: "Asia/Shanghai",
  "hong-kong": "Asia/Hong_Kong",
  taipei: "Asia/Taipei",
  singapore: "Asia/Singapore",
  bangkok: "Asia/Bangkok",
  "kuala-lumpur": "Asia/Kuala_Lumpur",
  manila: "Asia/Manila",
  mumbai: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  bangalore: "Asia/Kolkata",
  dubai: "Asia/Dubai",
  "tel-aviv": "Asia/Jerusalem",

  cairo: "Africa/Cairo",
  casablanca: "Africa/Casablanca",
  lagos: "Africa/Lagos",
  nairobi: "Africa/Nairobi",
  "cape-town": "Africa/Johannesburg",
  johannesburg: "Africa/Johannesburg",

  // The multi-zone countries, which have no default to fall back on.
  "new-york": "America/New_York",
  boston: "America/New_York",
  miami: "America/New_York",
  atlanta: "America/New_York",
  washington: "America/New_York",
  chicago: "America/Chicago",
  austin: "America/Chicago",
  houston: "America/Chicago",
  dallas: "America/Chicago",
  denver: "America/Denver",
  phoenix: "America/Phoenix",
  "los-angeles": "America/Los_Angeles",
  "san-francisco": "America/Los_Angeles",
  "san-diego": "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  portland: "America/Los_Angeles",
  toronto: "America/Toronto",
  ottawa: "America/Toronto",
  montreal: "America/Toronto",
  vancouver: "America/Vancouver",
  calgary: "America/Edmonton",
  "mexico-city": "America/Mexico_City",
  guadalajara: "America/Mexico_City",
  cancun: "America/Cancun",
  "sao-paulo": "America/Sao_Paulo",
  "rio-de-janeiro": "America/Sao_Paulo",
  brasilia: "America/Sao_Paulo",
  moscow: "Europe/Moscow",
  "saint-petersburg": "Europe/Moscow",
  novosibirsk: "Asia/Novosibirsk",
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  brisbane: "Australia/Brisbane",
  perth: "Australia/Perth",
  adelaide: "Australia/Adelaide",
  jakarta: "Asia/Jakarta",
  bali: "Asia/Makassar",
  denpasar: "Asia/Makassar",
  almaty: "Asia/Almaty",
  auckland: "Pacific/Auckland"
};

/**
 * The IANA zone for a member, or null when it cannot be known.
 *
 * City first, because it is the more specific claim and the only thing that
 * resolves a member in a country spanning several zones.
 */
export function zoneFor(
  cityId: string | null | undefined,
  countryId: string | null | undefined
): string | null {
  if (cityId && CITY_ZONES[cityId]) return CITY_ZONES[cityId];
  if (countryId && COUNTRY_ZONES[countryId]) return COUNTRY_ZONES[countryId];
  return null;
}

/**
 * The wall-clock hour in a zone at a given instant.
 *
 * Derived through `Intl` rather than from a stored offset, so daylight saving
 * is handled by the platform's tz database instead of by arithmetic here that
 * would be wrong for two weeks twice a year — and wrong in different weeks in
 * each hemisphere, which is exactly the case this product has.
 */
export function hourIn(zone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "numeric",
      hour12: false
    }).formatToParts(at);

    const hour = parts.find((part) => part.type === "hour")?.value;
    if (hour === undefined) return null;
    // "24" is how some locales render midnight; the rest of this file counts
    // hours 0–23 and a 24 would sort after everything.
    return Number(hour) % 24;
  } catch {
    // An unknown zone. Better to lose the feature than to throw inside a
    // conversation view.
    return null;
  }
}

/** The local time in a zone, formatted for a reader of `locale`. */
export function localTimeIn(zone: string, locale: string, at: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit"
    }).format(at);
  } catch {
    return null;
  }
}

/** Hours counted as awake, local to each side. */
export const AWAKE_FROM = 8;
export const AWAKE_UNTIL = 23;

/**
 * Two people always share at least this many waking hours in a day.
 *
 * Two windows of `AWAKE_UNTIL - AWAKE_FROM` hours placed anywhere on a
 * 24-hour circle must overlap by at least `2w - 24`, which at the constants
 * above is six. So there is no pair of cities on earth with nothing in common
 * — the honest answer to the objection this whole product exists under, and
 * stronger than any sentence a listing could claim.
 *
 * It is a bound on `totalHours`, **not** on `hours`. The shared time can
 * arrive as two separate stretches — Auckland and London share six hours a day
 * as a two-hour morning and a four-hour evening — and the longest single one
 * is what a person can actually use, so `awakeOverlap` reports both.
 *
 * It also means the "no overlap" branch below cannot fire while these
 * constants hold. It is kept because narrowing the window to under twelve
 * hours would make it reachable, and a guard that becomes live on a one-line
 * change is cheaper than a bug that arrives with it.
 */
export const GUARANTEED_OVERLAP_HOURS = Math.max(2 * (AWAKE_UNTIL - AWAKE_FROM) - 24, 0);

const inAwakeHours = (hour: number) => hour >= AWAKE_FROM && hour < AWAKE_UNTIL;

export type Overlap = {
  /** Start and end of the longest usable stretch, in the *viewer's* local time. */
  startHour: number;
  endHour: number;
  /** How long that stretch is — what a person can actually plan around. */
  hours: number;
  /**
   * Every shared hour in the day, which can exceed `hours`.
   *
   * A far-apart pair often shares a short morning and a longer evening. The
   * evening is the one to name; the total is the one that says whether the
   * distance is workable at all.
   */
  totalHours: number;
};

/**
 * The window in which both people are plausibly awake, in the viewer's hours.
 *
 * Computed by walking twenty-four hourly instants and asking each zone what
 * its local hour is, rather than by subtracting offsets: the two sides can be
 * on different daylight-saving schedules, and in opposite hemispheres they
 * move in opposite directions. Asking the tz database twenty-four times is
 * cheap and cannot get that wrong.
 *
 * Returns null only when a zone cannot be read. There is always an overlap —
 * see `GUARANTEED_OVERLAP_HOURS` for why that is arithmetic rather than luck.
 */
export function awakeOverlap(
  viewerZone: string,
  partnerZone: string,
  reference: Date = new Date()
): Overlap | null {
  // Anchored to UTC midnight so the walk covers a whole day regardless of when
  // it runs.
  const base = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate()
  );

  const viewerHours: number[] = [];
  const shared: boolean[] = [];

  for (let step = 0; step < 24; step++) {
    const at = new Date(base + step * 3_600_000);
    const viewer = hourIn(viewerZone, at);
    const partner = hourIn(partnerZone, at);

    if (viewer === null || partner === null) return null;

    viewerHours.push(viewer);
    shared.push(inAwakeHours(viewer) && inAwakeHours(partner));
  }

  if (!shared.some(Boolean)) return null;

  /**
   * The longest run, treating the day as a circle.
   *
   * A window that straddles midnight UTC is one window, not two — and for a
   * pair like Istanbul and Los Angeles that is the only window there is, so
   * scanning the array linearly would report half of it.
   */
  let bestStart = 0;
  let bestLength = 0;
  let runStart = -1;
  let runLength = 0;

  for (let index = 0; index < 48; index++) {
    if (shared[index % 24]) {
      if (runLength === 0) runStart = index;
      runLength += 1;
      if (runLength > bestLength && runLength <= 24) {
        bestLength = runLength;
        bestStart = runStart;
      }
    } else {
      runLength = 0;
    }
  }

  const startHour = viewerHours[bestStart % 24];
  return {
    startHour,
    endHour: (startHour + bestLength) % 24,
    hours: bestLength,
    totalHours: shared.filter(Boolean).length
  };
}
