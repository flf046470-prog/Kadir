"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useWebGLSupport } from "../capabilities";
import type { Landmark } from "./terrain-scene";

/** Three.js is ~150 kB gzipped, so it is only fetched when someone asks for it. */
const TerrainScene = dynamic(() => import("./terrain-scene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <span className="label text-fog/50">…</span>
    </div>
  ),
});

export type ExploreLabels = {
  title: string;
  body: string;
  load: string;
  without: string;
  unsupported: string;
  map: string;
  view3d: string;
  hint: string;
  conceptual: string;
};

export function ExploreScene({
  landmarks,
  labels,
  mapView,
}: {
  landmarks: Landmark[];
  labels: ExploreLabels;
  /** The schematic map, rendered on the server and passed in as markup. */
  mapView: React.ReactNode;
}) {
  // The light schematic map is the default everywhere; the 3D view — and the
  // Three.js bundle behind it — is only loaded when someone asks for it.
  const [mode, setMode] = useState<"map" | "3d">("map");
  const [selected, setSelected] = useState<string | null>(null);
  const canShow3d = useWebGLSupport();

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={labels.title}
          className="inline-flex rounded-full border border-fog/20 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "map"}
            onClick={() => setMode("map")}
            className={`rounded-full px-5 py-2 text-xs tracking-[0.14em] uppercase transition-colors ${
              mode === "map" ? "bg-snow text-basalt" : "text-fog hover:text-snow"
            }`}
          >
            {labels.map}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "3d"}
            onClick={() => canShow3d && setMode("3d")}
            disabled={!canShow3d}
            className={`rounded-full px-5 py-2 text-xs tracking-[0.14em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              mode === "3d" ? "bg-snow text-basalt" : "text-fog hover:text-snow"
            }`}
          >
            {labels.view3d}
          </button>
        </div>

        {mode === "3d" ? (
          <button
            type="button"
            onClick={() => setMode("map")}
            className="rounded-full border border-fog/20 px-4 py-2 text-xs tracking-wide text-fog transition-colors hover:border-ember hover:text-ember"
          >
            {labels.without}
          </button>
        ) : null}
      </div>

      <div className="card-stone grain relative mt-6 aspect-[4/3] overflow-hidden sm:aspect-[16/9]">
        {mode === "map" ? (
          <div className="flex h-full w-full items-center justify-center p-4">{mapView}</div>
        ) : (
          <TerrainScene
            landmarks={landmarks}
            hintLabel={labels.hint}
            selectedId={selected}
            onSelect={setSelected}
          />
        )}

        <span className="pointer-events-none absolute end-3 top-3 rounded-full border border-fog/20 bg-basalt/80 px-3 py-1 text-[0.6rem] tracking-[0.18em] text-fog/70 uppercase">
          {labels.conceptual}
        </span>
      </div>

      {!canShow3d ? <p className="mt-4 text-sm text-fog">{labels.unsupported}</p> : null}

      {/*
        The same places, as text. This is the accessible equivalent of the 3D
        view — it is always in the DOM, not only when WebGL fails.
      */}
      <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {landmarks.map((landmark) => (
          <li key={landmark.id}>
            <p className="label text-ember">{landmark.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-fog">{landmark.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
