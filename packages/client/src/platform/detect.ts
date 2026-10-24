import type { QualityTier } from '@kc/core';
import type { DeviceCapabilities, PlatformKind } from './Platform.js';

interface NavigatorWithHints extends Navigator {
  /** Chrome-only hint; absent on Safari and Firefox, hence optional. */
  deviceMemory?: number;
}

/**
 * Device probe.
 *
 * Runs once at boot and decides which platform layer to load and which quality tier to start
 * at. It is intentionally conservative: starting low and being promoted by the frame governor
 * is a much better first impression than starting high and stuttering.
 */
export async function detectDevice(): Promise<DeviceCapabilities> {
  const nav = navigator as NavigatorWithHints;
  const hasTouch = 'ontouchstart' in globalThis || nav.maxTouchPoints > 0;
  const hasPointerLock = 'pointerLockElement' in document;
  const hasGamepad = 'getGamepads' in nav;
  const cores = nav.hardwareConcurrency ?? 4;
  const memoryGb = nav.deviceMemory ?? (hasTouch ? 4 : 8);

  let hasXr = false;
  try {
    hasXr = (await nav.xr?.isSessionSupported('immersive-vr')) === true;
  } catch {
    hasXr = false;
  }

  const kind: PlatformKind = hasXr ? 'vr' : hasTouch && !hasPointerLockPreferred() ? 'mobile' : 'pc';

  return {
    kind,
    hasTouch,
    hasPointerLock,
    hasGamepad,
    hasXr,
    suggestedQuality: suggestQuality(kind, cores, memoryGb),
    devicePixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
    cores,
    memoryGb,
  };
}

function hasPointerLockPreferred(): boolean {
  // Touch laptops report touch support but should still play as PC.
  return matchMedia('(pointer: fine)').matches && !matchMedia('(hover: none)').matches;
}

function suggestQuality(kind: PlatformKind, cores: number, memoryGb: number): QualityTier {
  if (kind === 'vr') return cores >= 8 ? 'medium' : 'low';
  if (kind === 'mobile') {
    if (cores >= 8 && memoryGb >= 6) return 'medium';
    return 'low';
  }
  if (cores >= 8 && memoryGb >= 8) return 'high';
  return cores >= 4 ? 'medium' : 'low';
}

/** Manual override for QA and for players who know their device. */
export function overridePlatform(kind: PlatformKind, base: DeviceCapabilities): DeviceCapabilities {
  return { ...base, kind };
}

/**
 * `?platform=pc|mobile|vr`, or null. The way out of a VR start that failed.
 *
 * The platform is chosen once, at boot, from whether the browser says it can present
 * `immersive-vr` — and a PC with an OpenXR runtime installed (SteamVR, the Oculus app, Windows
 * Mixed Reality) says it can whether or not a headset is plugged in and awake. So the game booted
 * as VR, "Enter VR" failed with nothing on screen but a console warning, and the page had no
 * keyboard or mouse input at all: the player could not play. A failed start now offers "Play on
 * desktop", which reloads with `?platform=pc`. Reloading without it is the way back.
 */
export function platformFromQuery(search: string): PlatformKind | null {
  const value = new URLSearchParams(search).get('platform');
  return value === 'pc' || value === 'mobile' || value === 'vr' ? value : null;
}

/** The page with `?platform=` set, or removed when `kind` is null. */
export function withPlatform(href: string, kind: PlatformKind | null): string {
  const url = new URL(href);
  if (kind) url.searchParams.set('platform', kind);
  else url.searchParams.delete('platform');
  return url.toString();
}
