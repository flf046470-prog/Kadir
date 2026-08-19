import { ImageResponse } from "next/og";
import { getSiteConfig } from "@/lib/site";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Patagonia Underground — Trevelin, Chubut, Argentina";

/** Drawn with the site's own palette so a shared link looks like the site. */
export default function OpengraphImage() {
  const settings = getSiteConfig();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(160deg, #16202a 0%, #0e1311 55%, #1a211d 100%)",
          color: "#f4f2ec",
          fontFamily: "sans-serif",
        }}
      >
        {/* ridge line */}
        <div style={{ display: "flex", position: "absolute", inset: 0 }}>
          <svg width="1200" height="630" viewBox="0 0 1200 630">
            <path
              d="M0 430 L90 372 L150 400 L240 330 L310 372 L400 300 L470 350 L560 296 L640 348 L740 306 L830 356 L920 318 L1010 366 L1100 330 L1200 372 L1200 630 L0 630 Z"
              fill="#2b3630"
              opacity="0.85"
            />
            <path
              d="M0 520 C 200 490, 340 528, 500 512 C 640 498, 740 470, 860 478 C 990 486, 1090 522, 1200 510 L1200 630 L0 630 Z"
              fill="#141a17"
            />
            <path d="M812 478 A 54 32 0 0 1 920 478 Z" fill="#1d2a30" />
            <path d="M812 478 A 54 32 0 0 1 920 478" fill="none" stroke="#9fc0cd" strokeWidth="3" />
          </svg>
        </div>

        <div style={{ display: "flex", position: "relative", fontSize: 22, letterSpacing: 6 }}>
          TREVELIN · CHUBUT · PATAGONIA · ARGENTINA
        </div>

        <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ display: "flex", fontSize: 92, lineHeight: 1.05, letterSpacing: -2 }}>
            {settings["brand.projectName"]}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 24,
              fontSize: 32,
              color: "#a6b0a8",
              maxWidth: 900,
              lineHeight: 1.3,
            }}
          >
            {settings["brand.heroLine"]}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 36,
              fontSize: 20,
              letterSpacing: 4,
              color: "#d98b52",
            }}
          >
            {settings["brand.statusLabel"].toUpperCase()}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
