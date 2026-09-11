/**
 * Serialising structured data for a `<script type="application/ld+json">` tag.
 *
 * `JSON.stringify` alone is not safe here, and the reason is easy to miss:
 * a script element's contents are raw text, and the *only* thing that ends it
 * is the byte sequence `</script`. JSON has no reason to escape that — `<` is
 * an ordinary character in a JSON string — so a value containing
 *
 *     </script><script>…</script>
 *
 * closes the tag and everything after it is script the browser will run. The
 * page does not have to be doing anything unusual for this to work; it is
 * enough for one string in the object to have come from a person.
 *
 * Escaping `<` as `<` removes the sequence without changing the data:
 * `<` is a valid JSON escape for `<`, so every consumer — Google's
 * structured-data parser included — reads exactly the same document.
 *
 * Today every caller passes hand-written marketing copy, so nothing here is
 * currently reachable by a member. This exists because that is a fact about
 * the callers rather than about this function, and the natural next thing to
 * put in JSON-LD is a `Person`, a `Review`, or an `aggregateRating` — all of
 * which carry text somebody typed.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
