import type { InputIntent, Settings, QualityTier } from '@kc/core';

export type PlatformKind = 'pc' | 'mobile' | 'vr';

export interface DeviceCapabilities {
  kind: PlatformKind;
  hasTouch: boolean;
  hasPointerLock: boolean;
  hasGamepad: boolean;
  /** WebXR immersive-vr is available *and* permitted. */
  hasXr: boolean;
  /** Rough device tier from hardware hints; the frame governor refines it at runtime. */
  suggestedQuality: QualityTier;
  devicePixelRatio: number;
  cores: number;
  memoryGb: number;
}

export interface PerformanceProfile {
  /** Multiplier applied to devicePixelRatio. */
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  postProcessing: boolean;
  /** Metres. Props beyond this are culled; the level's static geometry always draws. */
  drawDistance: number;
  maxDetailedPlayers: number;
  /** Number of foliage instances rendered. */
  foliageBudget: number;
  targetFps: number;
  antialias: boolean;
}

/**
 * A platform supplies input, a UI host and a performance profile — and nothing else.
 * Gameplay, rendering and networking are identical on all three.
 */
export interface PlatformInput {
  readonly kind: PlatformKind;
  /** Called once per rendered frame; fills `out` with the current intent. */
  sample(out: InputIntent, dt: number, settings: Settings): void;
  /** Attach listeners. */
  start(): void;
  stop(): void;
  /** Platform-specific hint shown by the tutorial. */
  readonly controlHints: { action: string; hint: string }[];
}

export interface UiHost {
  readonly kind: PlatformKind;
  mount(root: HTMLElement): void;
  unmount(): void;
}

export function profileFor(kind: PlatformKind, quality: QualityTier, settings: Settings): PerformanceProfile {
  const base: Record<QualityTier, PerformanceProfile> = {
    low: {
      renderScale: 0.7,
      shadows: false,
      shadowMapSize: 512,
      postProcessing: false,
      drawDistance: 70,
      maxDetailedPlayers: 6,
      foliageBudget: 60,
      targetFps: 30,
      antialias: false,
    },
    medium: {
      renderScale: 0.9,
      shadows: true,
      shadowMapSize: 1024,
      postProcessing: false,
      drawDistance: 120,
      maxDetailedPlayers: 10,
      foliageBudget: 160,
      targetFps: 60,
      antialias: true,
    },
    high: {
      renderScale: 1,
      shadows: true,
      shadowMapSize: 2048,
      postProcessing: true,
      drawDistance: 200,
      maxDetailedPlayers: 16,
      foliageBudget: 320,
      targetFps: 60,
      antialias: true,
    },
  };

  const profile = { ...base[quality] };

  if (kind === 'vr') {
    // VR trades resolution for frame time: dropped frames are nauseating, a soft shadow is not.
    profile.targetFps = 72;
    profile.postProcessing = false;
    profile.shadowMapSize = Math.min(profile.shadowMapSize, 1024);
    profile.renderScale = Math.min(profile.renderScale, 1);
    profile.maxDetailedPlayers = Math.min(profile.maxDetailedPlayers, 12);
  }
  if (kind === 'mobile') {
    profile.renderScale = Math.min(profile.renderScale, 0.9);
    profile.antialias = quality === 'high';
  }

  // User settings win over the tier defaults.
  profile.renderScale *= settings.graphics.renderScale;
  profile.shadows = profile.shadows && settings.graphics.shadows;
  profile.postProcessing = profile.postProcessing && settings.graphics.postProcessing;
  profile.drawDistance = Math.min(profile.drawDistance, settings.graphics.drawDistance);
  profile.maxDetailedPlayers = Math.min(profile.maxDetailedPlayers, settings.graphics.maxDetailedPlayers);
  profile.targetFps = settings.graphics.targetFps;
  return profile;
}
