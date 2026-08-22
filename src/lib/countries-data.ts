export type CountryPage = {
  slug: string;
  name: string;
  region: string;
  intro: string;
  whyHere: string;
  cultureNote: string;
  cities: string[];
  stat: string;
};

export const countries: Record<string, CountryPage> = {
  turkey: {
    slug: "turkey",
    name: "Turkey",
    region: "Europe & Asia",
    intro:
      "From Istanbul's Bosphorus-side cafés to Izmir's coastline, Turkey sits at the literal crossroads of continents — which makes it one of the most active hubs on FioreMatch for both local and international matches.",
    whyHere:
      "Turkish members tend to set relationship intent clearly and respond well to language-aware filtering, since English, Turkish, German, and Arabic are all common second languages here. Filter by 'languages spoken' to widen your pool honestly.",
    cultureNote:
      "Family and long-term intent carry real weight in Turkish dating culture — being upfront about what you're looking for goes a long way, whether that's casual or serious.",
    cities: ["istanbul"],
    stat: "One of FioreMatch's fastest-growing member bases in the Europe & Asia region."
  },
  germany: {
    slug: "germany",
    name: "Germany",
    region: "Europe",
    intro:
      "Germany's dating scene spans everything from Berlin's fast-paced, international crowd to quieter, tight-knit communities in smaller cities — FioreMatch's filters are built to handle both.",
    whyHere:
      "German members skew toward directness: clear profiles, clear intent, and low tolerance for games. That's a good match for FioreMatch's explainable AI approach — you'll see exactly why a profile was suggested, not just that it was.",
    cultureNote:
      "Punctuality and follow-through matter a lot on first dates here. If you say you'll video call before meeting, follow through — it's taken as a real signal of intent.",
    cities: ["berlin"],
    stat: "A core launch market with strong PLUS and VIP adoption among users seeking serious relationships."
  },
  usa: {
    slug: "usa",
    name: "United States",
    region: "North America",
    intro:
      "The U.S. dating market is enormous and varied — FioreMatch focuses on what's different: real filters for relationship intent, transparent AI matching, and moderation tuned for scam patterns that specifically target U.S. users in cross-border conversations.",
    whyHere:
      "With members spread across every timezone, distance and city filters matter here more than almost anywhere else. Set a realistic radius, then widen it deliberately if you're open to relocating for the right match.",
    cultureNote:
      "Casual and serious dating coexist heavily in U.S. cities — stating your intent explicitly on your profile avoids the single biggest source of mismatched expectations.",
    cities: ["new-york"],
    stat: "Broad city coverage from major metros to smaller markets, with local pricing on PLUS and VIP."
  },
  france: {
    slug: "france",
    name: "France",
    region: "Europe",
    intro:
      "Paris anchors one of FioreMatch's most active European communities, with a dating culture that values conversation and pacing over rushing toward a first date.",
    whyHere:
      "French members often favor getting to know someone through messaging before meeting — FioreMatch's read receipts and typing indicators help that back-and-forth feel natural instead of transactional.",
    cultureNote:
      "Subtlety is valued over over-explaining. A well-written, specific bio — helped along by the AI Profile Assistant if you want it — tends to outperform a generic one here.",
    cities: ["paris"],
    stat: "Strong engagement on FioreMatch's AI-explained match suggestions."
  }
};

export type CityPage = {
  slug: string;
  name: string;
  countrySlug: string;
  intro: string;
  neighborhoodsNote: string;
};

export const cities: Record<string, CityPage> = {
  istanbul: {
    slug: "istanbul",
    name: "Istanbul",
    countrySlug: "turkey",
    intro:
      "Split across two continents, Istanbul has one of the most language-diverse dating pools on FioreMatch — expect profiles spanning Turkish, English, Arabic, and more.",
    neighborhoodsNote:
      "Members here span both the European and Asian sides of the city; distance filters matter more than in most cities given the Bosphorus crossing."
  },
  berlin: {
    slug: "berlin",
    name: "Berlin",
    countrySlug: "germany",
    intro:
      "Berlin is FioreMatch's most international German city — a large share of profiles list English alongside German, and relationship intent tends to be stated plainly.",
    neighborhoodsNote:
      "A famously spread-out city — set your distance filter with your usual commute in mind, not just a radius on a map."
  },
  "new-york": {
    slug: "new-york",
    name: "New York",
    countrySlug: "usa",
    intro:
      "New York runs at FioreMatch's fastest match-to-message pace in North America — clear, specific profiles get noticed quickly here.",
    neighborhoodsNote:
      "Borough matters: a lot of members filter tightly by distance given transit times, so keep your radius realistic to how far you'll actually travel for a first date."
  },
  paris: {
    slug: "paris",
    name: "Paris",
    countrySlug: "france",
    intro:
      "Paris members tend to favor a slower, message-first pace before moving to a video call or first date — patience pays off here.",
    neighborhoodsNote:
      "Arrondissement-level distance filtering helps a lot in a city this walkable and this dense."
  }
};

/**
 * A human-readable name for a place id.
 *
 * Members type their own city and country, so the id is often a place we have
 * no page for. Falling back to the prettified slug keeps the card honest —
 * showing "kirsehir" as "Kirsehir" is right, and inventing a canonical name we
 * do not have would not be.
 */
export function placeLabel(id: string): string {
  const known = cities[id]?.name ?? countries[id]?.name;
  if (known) return known;

  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
