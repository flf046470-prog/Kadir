import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./json-ld";

describe("serialising JSON-LD", () => {
  /**
   * The whole reason this function exists. A script element ends at the first
   * `</script`, and `JSON.stringify` has no reason to escape `<` — so without
   * this, one string that came from a person turns a public page into stored
   * XSS.
   */
  it("cannot be closed out of its own script tag", () => {
    const output = serializeJsonLd({
      name: "</script><script>alert(1)</script>"
    });

    expect(output).not.toContain("</script");
    expect(output).not.toContain("<");
  });

  /**
   * Escaped, not stripped: `<` is a valid JSON escape for `<`, so the
   * document a consumer parses is identical to the one passed in. A fix that
   * mangled the data would quietly corrupt structured data instead.
   */
  it("still parses back to exactly what it was given", () => {
    const data = { "@type": "Person", name: "a < b", bio: "5 < 6 & 7 > 2" };

    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });

  it("leaves ordinary content alone", () => {
    expect(serializeJsonLd({ "@type": "Organization", name: "FioreMatch" })).toBe(
      '{"@type":"Organization","name":"FioreMatch"}'
    );
  });

  it("escapes inside keys and nested values too", () => {
    const output = serializeJsonLd({
      offers: [{ "</script>x": "</script>y" }]
    });

    expect(output).not.toContain("<");
    expect(JSON.parse(output)).toEqual({ offers: [{ "</script>x": "</script>y" }] });
  });
});
