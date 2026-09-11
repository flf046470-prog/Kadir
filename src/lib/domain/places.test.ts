import { describe, expect, it } from "vitest";
import { MAX_PLACE_ID_LENGTH, slugifyPlace } from "./places";

/**
 * Place ids only work as ids if two members who mean the same place produce the
 * same string. These tests are that guarantee.
 */

describe("slugifyPlace", () => {
  it("makes differently typed spellings of one place equal", () => {
    const forms = ["Germany", "germany", "  GERMANY  ", "germany "];
    const slugs = new Set(forms.map(slugifyPlace));
    expect([...slugs]).toEqual(["germany"]);
  });

  it("joins multi-word places with hyphens", () => {
    expect(slugifyPlace("United States")).toBe("united-states");
    expect(slugifyPlace("New   York")).toBe("new-york");
  });

  it("folds accents so İzmir and Izmir are one city", () => {
    expect(slugifyPlace("İzmir")).toBe(slugifyPlace("Izmir"));
    expect(slugifyPlace("Köln")).toBe("koln");
    expect(slugifyPlace("São Paulo")).toBe("sao-paulo");
  });

  it("folds Turkish and German letters that carry no combining mark", () => {
    expect(slugifyPlace("Kırşehir")).toBe("kirsehir");
    expect(slugifyPlace("Diyarbakır")).toBe("diyarbakir");
    expect(slugifyPlace("Straße")).toBe("strasse");
  });

  it("keeps places written in other scripts rather than inventing a spelling", () => {
    expect(slugifyPlace("東京")).toBe("東京");
    expect(slugifyPlace("القاهرة")).toBe("القاهرة");
    expect(slugifyPlace("서울")).toBe("서울");
  });

  it("returns null when nothing usable is left", () => {
    expect(slugifyPlace("")).toBeNull();
    expect(slugifyPlace("   ")).toBeNull();
    expect(slugifyPlace("!!!")).toBeNull();
    expect(slugifyPlace("---")).toBeNull();
  });

  it("caps length without leaving a trailing separator", () => {
    const slug = slugifyPlace(`${"a".repeat(MAX_PLACE_ID_LENGTH)} city`);
    expect(slug).toBe("a".repeat(MAX_PLACE_ID_LENGTH));
    expect(slug!.endsWith("-")).toBe(false);
  });

  it("is idempotent — slugifying a slug changes nothing", () => {
    for (const input of ["İstanbul", "New York", "São Paulo", "東京"]) {
      const once = slugifyPlace(input)!;
      expect(slugifyPlace(once)).toBe(once);
    }
  });
});
