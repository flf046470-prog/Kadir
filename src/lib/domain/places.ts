/**
 * Place ids are slugs.
 *
 * Members type a place in free text, so "Germany", "germany" and " GERMANY "
 * all have to compare equal — otherwise the country filter and the LOCAL and
 * COUNTRY discovery modes silently miss people who typed the same place
 * differently, which looks exactly like "nobody is here" from the member's
 * side. Normalising at every write boundary is what makes the comparison mean
 * anything, so this function is the only definition of a place id we have.
 */

export const MAX_PLACE_ID_LENGTH = 64;

/**
 * Latin characters that decomposition alone does not fold: dotless ı, ß, ø, đ
 * and friends carry no combining mark to strip. Turkish and German names are
 * common in our launch markets, so getting these wrong is not an edge case.
 */
const FOLD: Record<string, string> = {
  ı: "i",
  ğ: "g",
  ş: "s",
  ß: "ss",
  ø: "o",
  æ: "ae",
  œ: "oe",
  å: "a",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l"
};

/**
 * Returns the slug form of a place name, or null when nothing usable is left.
 *
 * Accents are folded rather than dropped — "İzmir" and "Izmir" are the same
 * city, and a member who types either should find the other — but letters
 * outside the Latin alphabet are kept as they are. Transliterating 東京 or
 * القاهرة would mean inventing a spelling for someone's own city; keeping the
 * script means members who write it the same way still match each other.
 */
export function slugifyPlace(raw: string): string | null {
  const folded = raw
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, (character) => FOLD[character] ?? character)
    // NFKD splits "é" into "e" plus a combining accent; the range below removes
    // the accents and leaves the letters. NFC recomposes what is left, so
    // scripts that decompose (Hangul, for one) come back whole.
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC");

  const slug = [
    ...folded
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
    // Sliced by code point, not by code unit: cutting a surrogate pair in half
    // would leave an id that is not even valid text.
  ]
    .slice(0, MAX_PLACE_ID_LENGTH)
    .join("")
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : null;
}
