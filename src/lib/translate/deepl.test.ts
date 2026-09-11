import { describe, expect, it, vi } from "vitest";
import { DeepLTranslator, deeplSource, deeplTarget, hostForKey } from "./deepl";
import { NoTranslator } from "./driver";

/** A fetch that records what it was called with and returns a canned reply. */
function stubFetch(reply: { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
      text: async () => reply.text ?? ""
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("host selection", () => {
  it("sends a free key to the free host", () => {
    expect(hostForKey("abc-123:fx")).toBe("https://api-free.deepl.com");
  });

  it("sends a paid key to the paid host", () => {
    expect(hostForKey("abc-123")).toBe("https://api.deepl.com");
  });
});

describe("language codes", () => {
  it("upper-cases a plain locale", () => {
    expect(deeplTarget("tr")).toBe("TR");
    expect(deeplTarget("de")).toBe("DE");
  });

  it("keeps a regional variant", () => {
    expect(deeplTarget("pt-BR")).toBe("PT-BR");
    expect(deeplTarget("en-us")).toBe("EN-US");
  });

  it("picks a region for the targets where a bare code is deprecated", () => {
    expect(deeplTarget("en")).toBe("EN-GB");
    expect(deeplTarget("pt")).toBe("PT-PT");
  });

  it("strips the region from a source, which takes none", () => {
    expect(deeplSource("pt-BR")).toBe("PT");
    expect(deeplSource(undefined)).toBeUndefined();
  });
});

describe("requests", () => {
  it("sends every text in one call, with DeepL's own auth scheme", async () => {
    const fetchStub = stubFetch({
      body: { translations: [{ text: "Merhaba" }, { text: "Nasılsın" }] }
    });
    const translator = new DeepLTranslator({ apiKey: "key:fx", fetchImpl: fetchStub.impl });

    const result = await translator.translate(["Hello", "How are you"], "tr", "en");

    expect(result).toEqual(["Merhaba", "Nasılsın"]);
    expect(fetchStub.calls).toHaveLength(1);

    const { url, init } = fetchStub.calls[0]!;
    expect(url).toBe("https://api-free.deepl.com/v2/translate");
    expect((init.headers as Record<string, string>).authorization).toBe("DeepL-Auth-Key key:fx");

    const body = init.body as URLSearchParams;
    expect(body.getAll("text")).toEqual(["Hello", "How are you"]);
    expect(body.get("target_lang")).toBe("TR");
    expect(body.get("source_lang")).toBe("EN");
  });

  it("omits the source when it is unknown, so DeepL detects it", async () => {
    const fetchStub = stubFetch({ body: { translations: [{ text: "Merhaba" }] } });
    const translator = new DeepLTranslator({ apiKey: "key", fetchImpl: fetchStub.impl });

    await translator.translate(["Hello"], "tr");

    expect((fetchStub.calls[0]!.init.body as URLSearchParams).has("source_lang")).toBe(false);
  });

  it("does not call out at all when the source already matches the target", async () => {
    const fetchStub = stubFetch({ body: { translations: [] } });
    const translator = new DeepLTranslator({ apiKey: "key", fetchImpl: fetchStub.impl });

    expect(await translator.translate(["Merhaba"], "tr", "tr")).toEqual(["Merhaba"]);
    expect(fetchStub.calls).toHaveLength(0);
  });

  it("treats a regional target as the same language as its bare source", async () => {
    const fetchStub = stubFetch({ body: { translations: [] } });
    const translator = new DeepLTranslator({ apiKey: "key", fetchImpl: fetchStub.impl });

    // Source EN, target EN-GB: nothing to do, and nothing to pay for.
    expect(await translator.translate(["Hello"], "en", "en-US")).toEqual(["Hello"]);
    expect(fetchStub.calls).toHaveLength(0);
  });

  it("sends nothing for an empty batch", async () => {
    const fetchStub = stubFetch({ body: { translations: [] } });
    const translator = new DeepLTranslator({ apiKey: "key", fetchImpl: fetchStub.impl });

    expect(await translator.translate([], "tr")).toEqual([]);
    expect(fetchStub.calls).toHaveLength(0);
  });
});

describe("failures", () => {
  it("names a quota failure, which no retry will fix", async () => {
    const fetchStub = stubFetch({ status: 456 });
    const translator = new DeepLTranslator({ apiKey: "key", fetchImpl: fetchStub.impl });

    await expect(translator.translate(["Hello"], "tr")).rejects.toThrow("quota exceeded");
  });

  it("surfaces the provider's own message on any other error", async () => {
    const fetchStub = stubFetch({ status: 403, text: "Wrong endpoint for this key" });
    const translator = new DeepLTranslator({ apiKey: "key", fetchImpl: fetchStub.impl });

    await expect(translator.translate(["Hello"], "tr")).rejects.toThrow(
      "Wrong endpoint for this key"
    );
  });

  it("refuses a short reply rather than pairing text with the wrong message", async () => {
    const fetchStub = stubFetch({ body: { translations: [{ text: "Merhaba" }] } });
    const translator = new DeepLTranslator({ apiKey: "key", fetchImpl: fetchStub.impl });

    await expect(translator.translate(["Hello", "Goodbye"], "tr")).rejects.toThrow(
      "1 translations for 2 texts"
    );
  });
});

describe("the default provider", () => {
  it("refuses rather than echoing the input back as a translation", async () => {
    await expect(new NoTranslator().translate()).rejects.toThrow("No translation provider");
  });
});
