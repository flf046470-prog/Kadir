"use client";

import { useSyncExternalStore } from "react";

/**
 * Browser capability checks, read through useSyncExternalStore so the value is
 * settled during hydration instead of being written into state from an effect.
 */
const subscribe = () => () => {};

let webglResult: boolean | null = null;

function detectWebGL(): boolean {
  if (webglResult !== null) return webglResult;
  try {
    const canvas = document.createElement("canvas");
    webglResult = Boolean(
      window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    webglResult = false;
  }
  return webglResult;
}

/** Optimistic on the server: the 3D toggle is only disabled once we know. */
export function useWebGLSupport(): boolean {
  return useSyncExternalStore(subscribe, detectWebGL, () => true);
}

let shareResult: boolean | null = null;

function detectNativeShare(): boolean {
  if (shareResult === null) {
    shareResult = typeof navigator !== "undefined" && typeof navigator.share === "function";
  }
  return shareResult;
}

/** Pessimistic on the server: the per-network links always work as a fallback. */
export function useNativeShare(): boolean {
  return useSyncExternalStore(subscribe, detectNativeShare, () => false);
}
