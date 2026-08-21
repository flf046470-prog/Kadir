/**
 * Concept drawings for the scroll narrative.
 *
 * These are drawings of an idea, not construction documents, and the captions
 * around them say so. They share the geometry of the 3D scene: a circular plan
 * cut into a levelled shelf, one glazed face opening down the valley, the
 * meadow returned over the roof.
 */

const INK = "#cfd5cd";

/** The plan: what the house is, seen from above. */
export function FloorPlanDrawing({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 640"
      className={className}
      role="img"
      aria-label="Concept floor plan: a circular house cut into a slope, with one glazed face opening toward the valley, a central hearth, and a terrace beyond the glass."
    >
      <g data-motion="plan" fill="none" stroke={INK} strokeLinecap="round">
        {/* contour of the shelf the house sits in */}
        <g strokeOpacity="0.16" strokeWidth="1">
          <path data-part="site" d="M40 300 C 160 250, 480 250, 600 300" />
          <path data-part="site" d="M40 356 C 160 306, 480 306, 600 356" />
          <path data-part="site" d="M40 412 C 160 362, 480 362, 600 412" />
        </g>

        {/* outer wall */}
        <circle data-part="walls" cx="320" cy="320" r="196" strokeOpacity="0.65" strokeWidth="1.6" />
        {/* soil line beyond the wall */}
        <circle data-part="site" cx="320" cy="320" r="226" strokeOpacity="0.2" strokeDasharray="3 9" />

        {/* the glazed face, opening south-east down the valley */}
        <path
          data-part="glass"
          d="M320 320 m 138 -138 A 196 196 0 0 1 138 138"
          strokeOpacity="0"
        />
        <path
          data-part="glass"
          d="M181 458 A 196 196 0 0 0 458 458"
          stroke="#7fa3b5"
          strokeOpacity="0.85"
          strokeWidth="2.4"
        />
        {/* mullions */}
        <g data-part="glass" stroke="#7fa3b5" strokeOpacity="0.4" strokeWidth="1">
          <path d="M320 320 L214 425 M320 320 L266 470 M320 320 L320 516 M320 320 L374 470 M320 320 L426 425" />
        </g>

        {/* terrace beyond the glass */}
        <path
          data-part="terrace"
          d="M150 490 A 240 240 0 0 0 490 490"
          strokeOpacity="0.3"
          strokeDasharray="6 8"
        />

        {/* interior: the ring of rooms against the buried wall */}
        <g data-part="rooms" strokeOpacity="0.45">
          <circle cx="320" cy="320" r="120" strokeOpacity="0.3" />
          <path d="M320 200 L320 124 M200 320 L124 320 M440 320 L516 320" strokeOpacity="0.3" />
          <path d="M236 236 L182 182 M404 236 L458 182" strokeOpacity="0.3" />
        </g>

        {/* hearth at the centre */}
        <circle data-part="hearth" cx="320" cy="320" r="26" strokeOpacity="0.7" />
        <circle cx="320" cy="320" r="9" fill="#d98b52" fillOpacity="0.75" stroke="none" />
      </g>

      <g fontSize="11" fill={INK} fillOpacity="0.5" fontFamily="var(--font-inter), sans-serif">
        <text x="320" y="556" textAnchor="middle" letterSpacing="2">
          GLAZED FACE — DOWN THE VALLEY
        </text>
        <text x="320" y="104" textAnchor="middle" letterSpacing="2">
          EARTH — THE BURIED SIDE
        </text>
        <text x="352" y="316" letterSpacing="2">
          HEARTH
        </text>
      </g>
    </svg>
  );
}

/** The idea in one line: a slope, a cut, and the ground put back on top. */
export function CutDrawing({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 420"
      className={className}
      role="img"
      aria-label="Concept diagram: the slope is cut, a shell is built into the cut, and the meadow is returned over its roof."
    >
      <g fill="none" stroke={INK} strokeLinecap="round">
        {/* original slope */}
        <path
          d="M0 300 C 120 300, 200 250, 300 214 C 400 178, 520 160, 640 150"
          strokeOpacity="0.25"
          strokeDasharray="4 8"
        />
        {/* the cut */}
        <path d="M0 316 C 130 314, 214 286, 268 254 L 268 254 A 118 118 0 0 1 476 216 C 540 196, 590 180, 640 172" strokeOpacity="0.55" />
        {/* the shell */}
        <path d="M268 254 A 118 118 0 0 1 476 216" stroke="#a6b0a8" strokeOpacity="0.75" strokeWidth="1.8" />
        <path d="M268 254 L268 330 M476 216 L476 330" strokeOpacity="0.4" />
        <path d="M268 330 L476 330" strokeOpacity="0.4" />
        {/* soil returned over the roof */}
        <g strokeOpacity="0.35">
          <path d="M280 232 l0 -14 M310 210 l0 -14 M344 198 l0 -14 M380 194 l0 -14 M416 198 l0 -14 M448 210 l0 -14" />
        </g>
        {/* the glazed end */}
        <path d="M476 216 L476 330" stroke="#7fa3b5" strokeOpacity="0.8" strokeWidth="2.2" />
        <circle cx="372" cy="300" r="7" fill="#d98b52" fillOpacity="0.7" stroke="none" />
        {/* ground below */}
        <path d="M0 330 H640" strokeOpacity="0.15" />
      </g>
      <g fontSize="11" fill={INK} fillOpacity="0.45" fontFamily="var(--font-inter), sans-serif" letterSpacing="2">
        <text x="24" y="290">SLOPE AS FOUND</text>
        <text x="500" y="206">GLASS</text>
        <text x="300" y="180">MEADOW RETURNED</text>
      </g>
    </svg>
  );
}

/** Night: what one lit window looks like from the valley floor. */
export function NightDrawing({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 420"
      className={className}
      role="img"
      aria-label="Concept view: the hillside at night, with a single band of warm light where the glazed face meets the valley."
    >
      <defs>
        <linearGradient id="pu-night-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#070b0e" />
          <stop offset="70%" stopColor="#101a20" />
          <stop offset="100%" stopColor="#182228" />
        </linearGradient>
        <radialGradient id="pu-night-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#f0c992" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f0c992" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="640" height="420" fill="url(#pu-night-sky)" />
      <g stroke="#cfd5cd" strokeOpacity="0.08" fill="none">
        <path d="M0 214 L92 176 L158 202 L242 158 L318 190 L402 150 L486 188 L560 156 L640 190" />
      </g>
      <path
        d="M0 300 C 140 292, 230 268, 300 250 A 120 120 0 0 1 500 226 C 560 214, 600 208, 640 204 L640 420 L0 420 Z"
        fill="#0d1210"
      />
      <ellipse cx="404" cy="292" rx="150" ry="70" fill="url(#pu-night-lamp)" />
      <path d="M330 300 A 110 110 0 0 1 470 268" stroke="#f0c992" strokeOpacity="0.85" strokeWidth="3" fill="none" />
      <g stroke="#f0c992" strokeOpacity="0.3" strokeWidth="1">
        <path d="M356 296 l0 -18 M392 286 l0 -20 M428 278 l0 -20" />
      </g>
      <g stroke="#cfd5cd" strokeOpacity="0.1">
        <path d="M0 372 H640" />
      </g>
    </svg>
  );
}
