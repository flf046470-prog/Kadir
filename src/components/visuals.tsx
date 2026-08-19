/**
 * Original artwork for the site. Everything here is drawn — it is deliberately
 * illustrative rather than photographic, so that no visitor can mistake it for
 * a photograph of the site or of a finished building.
 */

export function DomeMark({ className = "", title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      {title ? <title>{title}</title> : null}
      {/* horizon / ground line */}
      <path d="M2 27h44" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {/* the buried volume */}
      <path
        d="M9 27v9.5a2 2 0 0 0 2 2h26a2 2 0 0 0 2-2V27"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.55"
      />
      {/* the dome above ground */}
      <path
        d="M13.5 27a10.5 10.5 0 0 1 21 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M24 16.5V27M17.6 19.2 24 27M30.4 19.2 24 27" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
      {/* soil hatching */}
      <path
        d="M4 31h3M4 35h3M41 31h3M41 35h3"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}

/**
 * Layered Andean ridgeline looking west from the Percy valley, with the dome
 * sitting in the meadow. Used as the hero backdrop.
 */
export function RidgeScene({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 860"
      className={className}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="pu-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b1013" />
          <stop offset="45%" stopColor="#16202a" />
          <stop offset="78%" stopColor="#2b3a42" />
          <stop offset="100%" stopColor="#4a5750" />
        </linearGradient>
        <linearGradient id="pu-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5d6f76" />
          <stop offset="100%" stopColor="#3c4a4d" />
        </linearGradient>
        <linearGradient id="pu-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#33403c" />
          <stop offset="100%" stopColor="#212b28" />
        </linearGradient>
        <linearGradient id="pu-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a211d" />
          <stop offset="100%" stopColor="#0e1311" />
        </linearGradient>
        <radialGradient id="pu-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#e8b878" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#e8b878" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="1440" height="860" fill="url(#pu-sky)" />

      {/* far cordillera — the border range, snow catching the last light */}
      <path
        d="M0 470 L82 424 L131 447 L198 386 L246 414 L318 349 L372 392 L436 331 L498 379 L548 344 L612 401 L676 366 L742 412 L806 372 L871 418 L936 381 L1002 425 L1068 392 L1131 437 L1198 404 L1262 448 L1328 418 L1390 452 L1440 432 L1440 860 L0 860 Z"
        fill="url(#pu-far)"
        opacity="0.55"
      />
      <path
        d="M318 349 L344 371 L360 362 L372 392 L436 331 L462 356 L478 348 L498 379 L548 344 L578 373 L596 364 L612 401"
        fill="#dfe7e6"
        opacity="0.4"
      />

      {/* middle ridge — forested slopes */}
      <path
        d="M0 566 L96 534 L172 561 L262 512 L344 548 L432 505 L520 541 L604 509 L698 552 L784 519 L878 559 L966 524 L1058 561 L1148 528 L1240 566 L1330 537 L1440 570 L1440 860 L0 860 Z"
        fill="url(#pu-mid)"
      />

      {/* near meadow — the shoulder the house is cut into */}
      <path
        d="M0 690 C 180 660, 320 700, 470 686 C 604 674, 700 646, 812 652 C 948 660, 1060 700, 1190 688 C 1300 678, 1380 692, 1440 686 L1440 860 L0 860 Z"
        fill="url(#pu-near)"
      />

      {/* the dome in the grass */}
      <g transform="translate(806 652)">
        <ellipse cx="0" cy="0" rx="128" ry="44" fill="#e8b878" opacity="0.06" />
        <path d="M-52 2 A 52 30 0 0 1 52 2 Z" fill="#1d2a30" />
        <path
          d="M-52 2 A 52 30 0 0 1 52 2"
          fill="none"
          stroke="#9fc0cd"
          strokeWidth="1.6"
          opacity="0.75"
        />
        <path
          d="M-30 -20 L-30 2 M0 -28 L0 2 M30 -20 L30 2 M-52 2 A 52 30 0 0 1 52 2"
          fill="none"
          stroke="#9fc0cd"
          strokeWidth="0.9"
          opacity="0.4"
        />
        <ellipse cx="0" cy="-6" rx="30" ry="14" fill="url(#pu-glow)" />
      </g>

      {/* grass texture on the near slope */}
      <g stroke="#3d4b40" strokeWidth="1" opacity="0.5" strokeLinecap="round">
        <path d="M120 730v-14M168 742v-11M244 722v-16M356 736v-12M470 726v-15M560 744v-10M980 730v-13M1088 742v-12M1210 724v-15M1310 738v-11" />
      </g>
    </svg>
  );
}

/** Topographic contour texture, used behind quiet sections. */
export function ContourField({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 420" className={className} aria-hidden="true" fill="none">
      <g stroke="currentColor" strokeWidth="1">
        <path d="M-20 380 C 180 356, 300 300, 470 300 C 640 300, 760 352, 960 336 C 1080 326, 1160 344, 1220 336" />
        <path d="M-20 344 C 190 318, 312 262, 476 262 C 640 262, 754 314, 950 298 C 1074 288, 1156 306, 1220 298" />
        <path d="M-20 308 C 200 280, 324 224, 482 224 C 640 224, 748 276, 940 260 C 1068 250, 1152 268, 1220 260" />
        <path d="M40 272 C 220 246, 336 190, 488 190 C 640 190, 742 240, 926 224 C 1046 214, 1132 232, 1200 224" />
        <path d="M132 236 C 262 214, 356 158, 496 158 C 636 158, 730 206, 900 190 C 1004 180, 1084 198, 1150 190" />
        <path d="M236 200 C 328 182, 388 128, 504 128 C 620 128, 706 174, 856 158 C 944 148, 1010 166, 1064 158" />
        <path d="M352 164 C 408 150, 440 100, 520 100 C 600 100, 664 142, 780 128 C 848 120, 900 136, 944 128" />
        <path d="M464 128 C 496 118, 508 76, 552 76 C 596 76, 640 112, 704 100" />
      </g>
    </svg>
  );
}

const SECTION_LAYERS = [
  { label: "Soil cover", note: "meadow returned over the roof" },
  { label: "Waterproofing", note: "continuous membrane" },
  { label: "Insulation", note: "extruded board" },
  { label: "Reinforced retaining wall", note: "holds the slope" },
  { label: "Drainage layer + pipe", note: "keeps water moving away" },
  { label: "Raft foundation", note: "spreads the load" },
];

/**
 * Concept cross-section of an earth-sheltered structure. This is a diagram of
 * the principle, not an engineered drawing of a specific building.
 */
export function CrossSectionDiagram({ className = "" }: { className?: string }) {
  return (
    <figure className={className}>
      <svg
        viewBox="0 0 720 420"
        className="w-full"
        role="img"
        aria-label="Concept cross-section: an earth-sheltered structure with soil cover over the roof, waterproofing and insulation layers, reinforced retaining walls, a drainage layer with perimeter pipe, and a raft foundation."
      >
        <defs>
          <linearGradient id="pu-soil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4a4436" />
            <stop offset="100%" stopColor="#2a2721" />
          </linearGradient>
          <pattern id="pu-gravel" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="3" r="1.2" fill="#6d7a72" opacity="0.6" />
            <circle cx="7" cy="7" r="1.4" fill="#6d7a72" opacity="0.45" />
          </pattern>
        </defs>

        {/* ground mass */}
        <path d="M0 120 C 120 96, 250 84, 360 84 C 470 84, 600 96, 720 120 L720 420 L0 420 Z" fill="url(#pu-soil)" />
        {/* grass line */}
        <path
          d="M0 120 C 120 96, 250 84, 360 84 C 470 84, 600 96, 720 120"
          fill="none"
          stroke="#6d8060"
          strokeWidth="3"
        />

        {/* buried shell */}
        <path
          d="M148 300 L148 196 C 148 140, 218 116, 360 116 C 502 116, 572 140, 572 196 L572 300 Z"
          fill="#171d1a"
          stroke="#8d968e"
          strokeWidth="2"
        />
        {/* membrane + insulation lines following the shell */}
        <path
          d="M138 300 L138 194 C 138 132, 214 106, 360 106 C 506 106, 582 132, 582 194 L582 300"
          fill="none"
          stroke="#7fa3b5"
          strokeWidth="1.6"
          strokeDasharray="6 4"
        />
        <path
          d="M130 300 L130 192 C 130 126, 210 98, 360 98 C 510 98, 590 126, 590 192 L590 300"
          fill="none"
          stroke="#c0603a"
          strokeWidth="1.6"
        />

        {/* interior slab + rooms */}
        <path d="M148 300 H572" stroke="#8d968e" strokeWidth="2" />
        <path d="M300 300 V196 M420 300 V196" stroke="#8d968e" strokeWidth="1" opacity="0.5" />

        {/* the dome */}
        <path d="M318 116 A 42 30 0 0 1 402 116 Z" fill="#1d2a30" stroke="#9fc0cd" strokeWidth="1.6" />
        <path d="M360 86 V116 M330 96 L360 116 M390 96 L360 116" stroke="#9fc0cd" strokeWidth="0.8" opacity="0.6" />

        {/* drainage + raft */}
        <rect x="118" y="300" width="484" height="16" fill="url(#pu-gravel)" />
        <rect x="118" y="316" width="484" height="14" fill="#4a5750" />
        <circle cx="132" cy="308" r="7" fill="#0e1311" stroke="#7fa3b5" strokeWidth="1.6" />
        <circle cx="588" cy="308" r="7" fill="#0e1311" stroke="#7fa3b5" strokeWidth="1.6" />

        {/* level marks */}
        <g stroke="#a6b0a8" strokeWidth="0.8" opacity="0.7">
          <path d="M620 116 H660 M620 300 H660" />
          <path d="M640 116 V300" />
        </g>
        <text x="666" y="120" fill="#a6b0a8" fontSize="11">
          roof
        </text>
        <text x="666" y="304" fill="#a6b0a8" fontSize="11">
          floor
        </text>
      </svg>

      <figcaption className="mt-6 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {SECTION_LAYERS.map((layer, i) => (
          <span key={layer.label} className="flex gap-3 text-sm text-fog">
            <span className="label pt-[3px] text-lenga">{String(i + 1).padStart(2, "0")}</span>
            <span>
              <span className="text-mist">{layer.label}</span>{" "}
              <span className="text-fog/70">— {layer.note}</span>
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * Schematic orientation map — deliberately not a real basemap, and labelled as
 * not-to-scale, because the plot location is not published yet.
 */
export function OrientationMap({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 480"
      className={className}
      role="img"
      aria-label="Schematic orientation map, not to scale: Trevelin sits east of the Andes and the Chilean border, south of Esquel, with Los Alerces National Park to the north-west and Route 259 running west toward the Futaleufú crossing."
    >
      <rect width="640" height="480" fill="#12181a" />

      {/* mountain hatching to the west */}
      <g stroke="#4a5750" strokeWidth="1" opacity="0.8">
        <path d="M40 60 l24 34 l24-34 M88 100 l24 34 l24-34 M40 140 l24 34 l24-34 M88 180 l24 34 l24-34 M40 220 l24 34 l24-34 M88 260 l24 34 l24-34 M40 300 l24 34 l24-34 M88 340 l24 34 l24-34 M40 380 l24 34 l24-34" />
      </g>

      {/* border */}
      <path d="M150 20 C 168 120, 132 220, 158 320 C 176 392, 150 440, 162 468" stroke="#c0603a" strokeWidth="1.4" strokeDasharray="8 6" fill="none" />
      <text x="60" y="34" fill="#c0603a" fontSize="11" letterSpacing="2">
        CHILE
      </text>

      {/* national park */}
      <path
        d="M196 40 C 260 28, 320 44, 330 92 C 338 132, 300 156, 250 152 C 206 148, 182 110, 196 40 Z"
        fill="#1d2a22"
        stroke="#6d8060"
        strokeWidth="1.2"
      />
      <text x="212" y="96" fill="#8fa383" fontSize="11">
        Los Alerces
      </text>
      <text x="212" y="112" fill="#8fa383" fontSize="11">
        National Park
      </text>

      {/* lake + river */}
      <path d="M300 168 C 340 176, 360 204, 344 236 C 330 264, 300 268, 288 244" fill="#22323a" stroke="#7fa3b5" strokeWidth="1" />
      <path d="M300 268 C 306 306, 288 340, 268 372 C 250 400, 244 432, 250 468" stroke="#7fa3b5" strokeWidth="1.4" fill="none" />
      <text x="352" y="212" fill="#7fa3b5" fontSize="11">
        Futaleufú
      </text>

      {/* roads */}
      <path d="M470 84 C 452 160, 436 220, 424 300 C 416 356, 412 420, 414 468" stroke="#6b736c" strokeWidth="2" fill="none" />
      <path d="M424 300 C 360 292, 296 300, 234 316 C 200 324, 176 334, 158 344" stroke="#6b736c" strokeWidth="1.6" fill="none" />
      <text x="250" y="356" fill="#8d968e" fontSize="10" letterSpacing="1">
        RN 259 → FUTALEUFÚ CROSSING
      </text>

      {/* Esquel */}
      <circle cx="470" cy="84" r="5" fill="#a6b0a8" />
      <text x="484" y="80" fill="#cfd5cd" fontSize="13">
        Esquel
      </text>
      <text x="484" y="96" fill="#8d968e" fontSize="10">
        nearest airport (EQS)
      </text>

      {/* Trevelin */}
      <circle cx="424" cy="300" r="9" fill="#c0603a" />
      <circle cx="424" cy="300" r="17" fill="none" stroke="#c0603a" strokeWidth="1" opacity="0.5" />
      <text x="446" y="298" fill="#f4f2ec" fontSize="16" fontFamily="var(--font-display)">
        Trevelin
      </text>
      <text x="446" y="316" fill="#a6b0a8" fontSize="10" letterSpacing="1.5">
        CHUBUT · ARGENTINA
      </text>

      {/* compass */}
      <g transform="translate(586 424)">
        <path d="M0 -26 L7 6 L0 0 L-7 6 Z" fill="#cfd5cd" />
        <text x="-4" y="22" fill="#8d968e" fontSize="10">
          N
        </text>
      </g>

      <text x="24" y="462" fill="#6b736c" fontSize="10" letterSpacing="1.5">
        SCHEMATIC — NOT TO SCALE
      </text>
    </svg>
  );
}
