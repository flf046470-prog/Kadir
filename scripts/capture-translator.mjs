import { createServer } from "node:http";

/**
 * A DeepL-shaped endpoint for the capture run, and nothing else.
 *
 * The translation screenshot is the one the whole listing leads on, so it has
 * to show the feature actually working. It cannot, on a machine with no DeepL
 * key: `translationEnabled()` is false, the route answers `available: false`,
 * and the capture is a German conversation with no translation in it — a
 * screenshot captioned "automatic translation" that demonstrates its absence.
 *
 * Pointing `DEEPL_API_HOST` here runs the real path instead. The real driver
 * makes the real request, `translateConversation` writes the real cache rows
 * and the real allowance ledger, and the UI renders them through the same
 * component a member sees. The only substitution is who answers the HTTP call.
 *
 * Which puts the burden on these strings. They are the Turkish a competent
 * translator would produce for the seeded German, and they are checked in
 * where they can be read and corrected. A screenshot is a claim about what the
 * product does; a stub that invented plausible-looking text would make that
 * claim false while looking exactly the same.
 *
 * Started automatically by `npm run capture`.
 */

const PORT = Number(process.env.CAPTURE_TRANSLATOR_PORT ?? 3131);

/**
 * Keyed by source text, then by target language.
 *
 * Exact strings rather than a fuzzy match: an edited seed line should stop
 * this server dead, not quietly fall through to something approximate.
 */
const TRANSLATIONS = {
  "Hallo! Dein Profil hat mich zum Lächeln gebracht.": {
    TR: "Merhaba! Profilin beni gülümsetti.",
    EN: "Hello! Your profile made me smile."
  },
  "Wie ist das Wetter gerade in Istanbul?": {
    TR: "İstanbul'da hava şu an nasıl?",
    EN: "What's the weather like in Istanbul right now?"
  },
  "Das klingt schön. Ich war noch nie dort, würde aber gern mal hin.": {
    TR: "Kulağa güzel geliyor. Hiç gitmedim ama çok isterim.",
    EN: "That sounds lovely. I've never been, but I'd like to go."
  }
};

function translate(text, target) {
  const entry = TRANSLATIONS[text];
  if (!entry) return null;
  // `EN-GB` and `EN-US` both resolve to the English column; DeepL requires the
  // region on English targets, and the driver adds it.
  return entry[target] ?? entry[target.split("-")[0]] ?? null;
}

const server = createServer((request, response) => {
  if (request.method !== "POST" || !request.url.startsWith("/v2/translate")) {
    response.writeHead(404).end();
    return;
  }

  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const params = new URLSearchParams(body);
    const texts = params.getAll("text");
    const target = (params.get("target_lang") ?? "EN").toUpperCase();

    const translated = texts.map((text) => translate(text, target));
    const missing = texts.filter((_, index) => translated[index] === null);

    if (missing.length > 0) {
      /**
       * Refuse rather than echo.
       *
       * Returning the source text unchanged is what a lazy stub does, and it
       * produces the worst possible outcome here: a screenshot that looks like
       * translation ran and chose to leave the German alone. A 422 surfaces in
       * the capture log as a failed screen, which is the point.
       */
      console.error(`  no translation on file for: ${missing.join(" | ")}`);
      response
        .writeHead(422, { "content-type": "application/json" })
        .end(JSON.stringify({ message: `Untranslated: ${missing.join(" | ")}` }));
      return;
    }

    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ translations: translated.map((text) => ({ text })) }));
  });
});

export function start() {
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(`http://127.0.0.1:${PORT}`));
  });
}

export function stop() {
  return new Promise((resolve) => server.close(resolve));
}

// Also runnable on its own, for shooting by hand.
if (import.meta.url === `file://${process.argv[1]}`) {
  start().then((url) => console.log(`capture translator on ${url}`));
}
