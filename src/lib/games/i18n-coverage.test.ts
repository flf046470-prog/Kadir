import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gameIds, promptsFor, twoOptionPrompts } from "./prompts";

/**
 * Prompt ids live in code; their text lives in the i18n catalogs. Nothing
 * enforces that pairing at compile time, so a prompt added to a bank without a
 * translation would silently render as a raw id in front of members. This test
 * is that enforcement.
 */

const locales = ["en", "tr"];

function catalog(locale: string) {
  const path = join(process.cwd(), "src", "i18n", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, never>;
}

describe("game prompt translations", () => {
  for (const locale of locales) {
    it(`covers every prompt id in ${locale}`, () => {
      const messages = catalog(locale);
      const prompts = (messages as Record<string, { prompts?: Record<string, unknown> }>).games
        ?.prompts;

      expect(prompts, `games.prompts missing from ${locale}.json`).toBeTruthy();

      const missing: string[] = [];
      for (const game of gameIds) {
        for (const id of promptsFor(game)) {
          if (!prompts![id]) missing.push(id);
        }
      }

      expect(missing).toEqual([]);
    });

    it(`gives two-option prompts both options in ${locale}`, () => {
      const messages = catalog(locale);
      const prompts = (messages as Record<string, { prompts?: Record<string, unknown> }>).games!
        .prompts!;

      const incomplete: string[] = [];
      for (const bank of Object.values(twoOptionPrompts)) {
        for (const id of bank) {
          const entry = prompts[id] as { a?: string; b?: string } | undefined;
          if (!entry?.a || !entry?.b) incomplete.push(id);
        }
      }

      expect(incomplete).toEqual([]);
    });
  }

  it("does not ship translations for prompts no bank references", () => {
    const messages = catalog("en");
    const prompts = (messages as Record<string, { prompts?: Record<string, unknown> }>).games!
      .prompts!;

    const known = new Set(gameIds.flatMap((game) => promptsFor(game)));
    const orphaned = Object.keys(prompts).filter((id) => !known.has(id));

    expect(orphaned).toEqual([]);
  });
});
