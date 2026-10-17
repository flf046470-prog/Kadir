/**
 * Store copy as data: read the text a listing doc says to paste, and the numbers it claims.
 *
 * Every store doc in `docs/` states its text in a fenced block under a heading, with a line such
 * as "423 of a maximum 500 characters." beside it. Both halves of that line rot: the count was
 * written by hand once, and the text kept changing. Measured when this module was written: Meta's
 * long description said "1424 of a maximum 1500" and was **1527** characters (1540 counting its
 * line breaks as two, below) — over the limit the upload form enforces — and in the same block said "up to sixteen people per room" three paragraphs above a
 * spec list that says 32, which is what the server allows. Copy is a claim about the game, and a
 * claim nobody re-checks is exactly as reliable as the last time somebody did.
 *
 * So the doc stays the source a person reads and pastes from, and `copy.test.ts` holds it to the
 * code: lengths against limits, the stated count against the real one, and every number the text
 * claims against the catalogue it describes.
 */

/**
 * The text as it will be pasted. The doc wraps long lines for reading; a wrapped line continues
 * the one before it with a space, a line starting "- " is a list item and starts its own line, and
 * a blank line is a paragraph break.
 */
export function pastedText(block) {
  const paragraphs = block
    .replace(/\r/g, '')
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const lines = [];
      for (const raw of paragraph.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('- ') || lines.length === 0) lines.push(line);
        else lines[lines.length - 1] += ` ${line}`;
      }
      return lines.join('\n');
    });
  return paragraphs.join('\n\n');
}

/**
 * Characters as a store's form may count them: code points, so an em dash is one — and a line break
 * as **two**. A form submits a textarea's line breaks as CRLF, and whether a store's counter sees
 * one character or two is not something any of them document; counting two means a block that
 * passes here passes there either way.
 */
export function copyLength(text) {
  let length = 0;
  for (const ch of text) length += ch === '\n' ? 2 : 1;
  return length;
}

/**
 * Every `## heading` followed by a fenced block. `limit` and `stated` come from a line of the form
 * "N of a maximum M characters" between the heading and the block, when there is one.
 */
export function parseListing(markdown) {
  const sections = [];
  // The prose between a heading and its block may not cross another heading or another block.
  const pattern = /^## ([^\n]+)\n((?:(?!^## |^```)[\s\S])*?)^```[^\n]*\n([\s\S]*?)^```/gm;
  for (const match of markdown.matchAll(pattern)) {
    const [, heading, before, block] = match;
    const count = before.match(/(\d[\d,]*) of a maximum (\d[\d,]*) characters/);
    const text = pastedText(block);
    sections.push({
      heading: heading.trim(),
      text,
      length: copyLength(text),
      stated: count ? Number(count[1].replace(/,/g, '')) : null,
      limit: count ? Number(count[2].replace(/,/g, '')) : null,
    });
  }
  return sections;
}

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** "16", "sixteen", "thirty-two" → a number; anything else → null. */
export function readNumber(word) {
  const w = word.toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  const unit = UNITS.indexOf(w);
  if (unit >= 0) return unit;
  const [tens, ones] = w.split('-');
  const t = TENS.indexOf(tens);
  if (t < 2) return null;
  if (ones === undefined) return t * 10;
  const o = UNITS.indexOf(ones);
  return o > 0 && o < 10 ? t * 10 + o : null;
}

const NUMBER = '(\\d+|[a-z]+(?:-[a-z]+)?)';

/**
 * What a piece of copy can claim, and the phrasings it claims it with. A phrase not on this list is
 * not checked — which is why the list is broad: "modes", "game modes" and "ways to play" are one
 * claim. Each pattern's first group is the number.
 */
export const CLAIMS = {
  modes: [`${NUMBER} (?:game )?modes`],
  animals: [`${NUMBER} (?:playable |different )?animals`],
  worlds: [`${NUMBER} (?:hand-built |handmade )?(?:worlds|maps)`],
  gadgets: [`${NUMBER} gadgets`],
  playersPerRoom: [`up to ${NUMBER} (?:people|players)`],
  feelBandPercent: [`within ${NUMBER} ?(?:%|per ?cent) of`],
};

/** Every claim in `text` that names a number, as `{ claim, value, phrase }`. */
export function claimsIn(text) {
  const found = [];
  for (const [claim, patterns] of Object.entries(CLAIMS)) {
    for (const source of patterns) {
      for (const match of text.matchAll(new RegExp(`\\b${source}`, 'gi'))) {
        const value = readNumber(match[1]);
        if (value !== null) found.push({ claim, value, phrase: match[0] });
      }
    }
  }
  return found;
}
