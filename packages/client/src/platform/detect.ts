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
