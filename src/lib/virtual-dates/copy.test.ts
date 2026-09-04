import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import tr from "@/i18n/messages/tr.json";
import { ENVIRONMENTS } from "./environments";
import { REFUSAL_MESSAGE_KEYS } from "./client";

/**
 * The virtual date screens against the things they name.
 *
 * Two lists decide what those screens say and neither of them is copy: the
 * environment catalogue, and the refusal reasons the server can return. Both
 * grow, and a screen that renders `environments.rooftop_bar` verbatim because
 * nobody added the name is the failure this file exists to catch — the same
 * class of bug as `app.bothAwake` printing as a raw key.
 *
 * `REFUSAL_MESSAGE_KEYS` is already tied to the server's own unions by a
 * `Record` in `client.ts`, so the type checker catches a *new* reason and this
 * catches a reason without words.
 */

type Messages = Record<string, unknown>;

const CATALOGUES: Record<string, Messages> = {
  en: en.virtualDates as Messages,
  tr: tr.virtualDates as Messages
};

/** "errors.notFound" → the string, or undefined. */
function at(messages: Messages, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object") return (node as Messages)[key];
    return undefined;
  }, messages);
}

function flatten(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key)
  );
}

/** `{name}` and friends, which decide what a caller has to pass to `t()`. */
function placeholders(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe.each(Object.entries(CATALOGUES))("the %s virtual date copy", (_locale, messages) => {
  it("names every environment in the catalogue", () => {
    for (const environment of ENVIRONMENTS) {
      expect(at(messages, `environments.${environment.id}`)).toBeTypeOf("string");
    }
  });

  /**
   * And nothing else. A name left behind by a removed environment is a place
   * the product still appears to offer, and the picker renders the catalogue —
   * so nobody would notice the copy outliving it.
   */
  it("names no environment that is not in the catalogue", () => {
    const named = Object.keys((messages.environments ?? {}) as Messages);
    const known = ENVIRONMENTS.map((environment) => environment.id);
    expect(named.sort()).toEqual(known.sort());
  });

  it("has words for every refusal the server can send", () => {
    for (const key of REFUSAL_MESSAGE_KEYS) {
      expect(at(messages, key), key).toBeTypeOf("string");
    }
  });
});

/**
 * The two locales against each other.
 *
 * Both are fully translated, so a key in one and not the other renders as a raw
 * key path on somebody's screen — and a *placeholder* in one and not the other
 * is worse: next-intl returns the key when a message wants a value the caller
 * did not pass, so the whole sentence disappears rather than one word.
 */
describe("the translated virtual date copy", () => {
  it("carries the same keys in both languages", () => {
    expect(flatten(CATALOGUES.tr).sort()).toEqual(flatten(CATALOGUES.en).sort());
  });

  it("carries the same placeholders in both languages", () => {
    for (const key of flatten(CATALOGUES.en)) {
      expect(placeholders(at(CATALOGUES.tr, key)), key).toEqual(
        placeholders(at(CATALOGUES.en, key))
      );
    }
  });
});
