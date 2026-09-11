/**
 * The FioreMatch mark, as one source.
 *
 * Every icon in the product draws this: the web PWA set, the favicon, the
 * Android launcher, the Microsoft Store tiles, the Play feature graphic, and
 * the header lockup in `src/components/Logo.tsx`. Keeping a second copy of the
 * path is how the app icon and the favicon quietly stop being the same flower.
 *
 * ---
 *
 * **What the mark is, and why it is not a heart.**
 *
 * It was a heart. A heart is the one image every dating product in the world
 * has already used, which makes it the one image that cannot be ours: at
 * thumbnail size in a store listing, beside four competitors, a gradient heart
 * is indistinguishable from any of them.
 *
 * This is a five-petal bloom, and all three of its properties carry something:
 *
 *  - **A flower**, because *fiore* is Italian for flower. The name should be
 *    visible in the mark without reading the wordmark next to it.
 *
 *  - **Five petals**, because the promise is Today's 5 — five people a day,
 *    chosen, rather than a deck that never ends. The count is the product, so
 *    `PETALS` is a real constant here and the path is built by a loop over it
 *    rather than pasted in as a magic string.
 *
 *  - **Each petal is a vesica** — the lens where two circles of equal radius
 *    overlap. That is what a match is: two people, and the part they have in
 *    common. Every petal is drawn as two arcs of the same radius bulging in
 *    opposite directions, so the shape is literally that intersection rather
 *    than a decorative approximation of one.
 *
 * The petals stop just short of the centre, which leaves a five-pointed star
 * of negative space where they meet. That is also what keeps the mark legible
 * at 16px: a solid rosette turns into a blob at favicon size, and this does
 * not.
 */

export const GROUND = "#fff5f7";

/** Today's 5. The count is the product, not a styling choice. */
export const PETALS = 5;

/** The mark is authored on a 32×32 grid; everything else scales from it. */
export const GRID = 32;

/**
 * Petal geometry, in grid units.
 *
 * `INNER` is what opens the star at the centre — at 0 the petals meet in a
 * point and the middle fills in. `WIDTH` is the sagitta of each arc: how far
 * it bulges from the straight line between the petal's base and its tip, which
 * is the parameter that decides whether the bloom reads as full or spindly.
 */
const CENTRE = GRID / 2;
const OUTER = 12.2;
const INNER = 1;
const WIDTH = 3;

/** Two decimals is a tenth of a pixel at 320px; past that it is noise in every file that embeds this. */
const round = (n) => Number(n.toFixed(2));

/**
 * The mark as one path, built from the petal count.
 *
 * Each petal is two arcs of the same radius between the same pair of points,
 * with the same sweep flag — which, because the direction of travel reverses
 * on the way back, bulges them to opposite sides and closes the lens.
 *
 * The radius is derived from the chord and the sagitta: for a circular arc,
 * `r = (s² + (c/2)²) / 2s`. Computing it rather than eyeballing it is what
 * makes the five petals actually identical, and keeps them identical if the
 * proportions above are ever retuned.
 */
export function markPath() {
  const chord = OUTER - INNER;
  const radius = round((WIDTH * WIDTH + (chord / 2) ** 2) / (2 * WIDTH));

  let path = "";

  for (let i = 0; i < PETALS; i++) {
    // The first petal points straight up, so the mark has an axis and does not
    // look subtly rotated when it sits beside upright type.
    const angle = ((-90 + (i * 360) / PETALS) * Math.PI) / 180;
    const at = (distance) => [
      round(CENTRE + distance * Math.cos(angle)),
      round(CENTRE + distance * Math.sin(angle))
    ];

    const [bx, by] = at(INNER);
    const [tx, ty] = at(OUTER);

    path += `M${bx} ${by}A${radius} ${radius} 0 0 1 ${tx} ${ty}A${radius} ${radius} 0 0 1 ${bx} ${by}Z`;
  }

  return path;
}

/**
 * The gradient, as data rather than as markup.
 *
 * `Logo.tsx` renders JSX and the generators render SVG text; both need the
 * same two stops on the same axis, and neither should be parsing the other's
 * markup to get them.
 *
 * The axis runs corner to corner across the bloom so the petals are not all
 * one colour — the top-left petal is bloom pink, the bottom-right is dusk
 * violet, and the three between them make the turn. A flat fill loses that,
 * and a radial one puts its lightest point in the middle, which is exactly
 * where this mark has a hole.
 *
 * **Why the violet end is dusk-350 and not dusk-400.** The mark has to hold on
 * two grounds it cannot know about in advance: the marketing header is
 * transparent over the dark hero and solid light once scrolled, so one
 * gradient serves both. Measured against the hero, `#8360f5` reached only
 * 3.4:1 while the pink end reached 5.4:1 — the bloom lost its bottom two
 * petals into the background and read lopsided. Lifting the violet to
 * `#9a7bfa` puts it at 4.5:1 there and costs nothing on light, where the worst
 * element is the pink end either way. The two ends are now within a stop of
 * each other on both grounds, which is what makes it read as one flower rather
 * than three petals and a smudge.
 */
export const GRADIENT = {
  x1: 5,
  y1: 4,
  x2: 27,
  y2: 27,
  from: "#fb6f92",
  to: "#9a7bfa"
};

const gradientSvg = (id) =>
  `<linearGradient id="${id}" x1="${GRADIENT.x1}" y1="${GRADIENT.y1}" x2="${GRADIENT.x2}" y2="${GRADIENT.y2}" gradientUnits="userSpaceOnUse">` +
  `<stop stop-color="${GRADIENT.from}" /><stop offset="1" stop-color="${GRADIENT.to}" /></linearGradient>`;

/**
 * An SVG of the mark centred on a canvas.
 *
 * The gradient is declared outside the transformed group but resolves inside
 * it: `userSpaceOnUse` is evaluated in the coordinate system of the element
 * that *references* the gradient, so its coordinates stay in the 32-unit grid
 * above at every output size.
 *
 * @param {object} options
 * @param {number} options.width
 * @param {number} [options.height]  Defaults to `width`.
 * @param {number} options.scale     Fraction of the shorter side the mark fills.
 * @param {"none"|"square"|"circle"} [options.ground]
 */
export function markSvg({ width, height = width, scale, ground = "none" }) {
  const size = Math.min(width, height) * scale;
  const x = (width - size) / 2;
  const y = (height - size) / 2;

  const backdrop =
    ground === "square"
      ? `<rect width="${width}" height="${height}" fill="${GROUND}" />`
      : ground === "circle"
        ? `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2}" fill="${GROUND}" />`
        : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${gradientSvg("g")}</defs>${backdrop}
  <g transform="translate(${x} ${y}) scale(${size / GRID})"><path d="${markPath()}" fill="url(#g)" /></g>
</svg>`;
}
