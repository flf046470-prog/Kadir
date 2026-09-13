import { createServer } from "node:http";

/**
 * A local stand-in for the translation provider, for capturing screenshots.
 *
 * `npm run capture` shoots `03-otomatik-ceviri` — the translated conversation,
 * which is the one screenshot that shows the thing the whole listing is about.
 * It waits on the *translated* text rather than on the thread, so a run with no
 * provider fails loudly instead of shipping a picture of the feature switched
 * off under a filename saying it is on. That is the right behaviour and it
 * left the capture impossible to run without a paid DeepL key, which made one
 * of five store screenshots un-reproducible.
 *
 * So: this speaks DeepL's documented `/v2/translate` contract and nothing else.
 * The real driver's auth header, form encoding and response parsing are all
 * exercised against it — what is faked is the translation, not the protocol.
 *
 *   node scripts/translate-stub.mjs &
 *   TRANSLATE_PROVIDER=deepl DEEPL_API_KEY=stub \
 *     DEEPL_API_HOST=http://127.0.0.1:3210 npm run start
 *
 * **Not for anything but screenshots.** It is not wired into the app, has no
 * authentication worth the name, and returns hand-written strings. A deployment
 * that pointed `DEEPL_API_HOST` at this would be showing members fake
 * translations.
 */

const PORT = Number(process.env.TRANSLATE_STUB_PORT ?? 3210);

/**
 * Real Turkish for the demo conversation in `seed-demo.ts`.
 *
 * These have to match that script: the capture waits for the Turkish of the
 * first line, so if the demo dialogue changes and this does not, the capture
 * times out rather than producing something wrong — which is the failure that
 * is cheap to diagnose. Anything not listed is echoed with its target language
 * in front, so it stays visibly a test double.
 */
const PHRASES = {
  "Hallo! Dein Profil hat mich zum Lächeln gebracht.":
    "Merhaba! Profilin beni gülümsetti.",
  "Wie ist das Wetter gerade in Istanbul?": "İstanbul'da hava şu an nasıl?",
  "Das klingt schön. Ich war noch nie dort, würde aber gern mal hin.":
    "Kulağa çok güzel geliyor. Hiç gitmedim ama çok isterim."
};

createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    if (request.url !== "/v2/translate" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }

    // The driver must be sending DeepL's scheme, not a bearer token. Refusing
    // here is what makes this a test of the driver rather than of itself.
    if (!(request.headers.authorization ?? "").startsWith("DeepL-Auth-Key ")) {
      response.writeHead(403).end("expected a DeepL-Auth-Key authorization header");
      return;
    }

    const params = new URLSearchParams(body);
    const texts = params.getAll("text");
    const target = params.get("target_lang");
    console.log(`translate → ${target}: ${texts.length} text(s)`);

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        translations: texts.map((text) => ({
          detected_source_language: params.get("source_lang") ?? "DE",
          text: PHRASES[text] ?? `«${target}» ${text}`
        }))
      })
    );
  });
}).listen(PORT, () => console.log(`translation stub on ${PORT}`));
