/**
 * The FioreMatch mark, as one source.
 *
 * Both icon generators — the web PWA set and the Android launcher set — draw
 * this. Keeping two copies of a path this long is how the app icon and the
 * favicon quietly stop being the same heart.
 */

export const GROUND = "#fff5f7";

const PATH =
  "M14 24.5s-9.5-5.86-9.5-13.02C4.5 7.4 7.55 4.5 11.1 4.5c1.99 0 3.7 1 4.9 2.62A6.02 6.02 0 0 1 20.9 4.5c3.55 0 6.6 2.9 6.6 6.98C27.5 18.64 18 24.5 14 24.5Z";

/** The mark is authored on a 28×28 grid; everything else scales from it. */
const GRID = 28;

const GRADIENT = `<linearGradient id="g" x1="4.5" y1="4.5" x2="27.5" y2="24.5" gradientUnits="userSpaceOnUse">
  <stop stop-color="#fb6f92" /><stop offset="1" stop-color="#8360f5" /></linearGradient>`;

/**
 * An SVG of the mark centred on a canvas.
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
  <defs>${GRADIENT}</defs>${backdrop}
  <g transform="translate(${x} ${y}) scale(${size / GRID})"><path d="${PATH}" fill="url(#g)" /></g>
</svg>`;
}
