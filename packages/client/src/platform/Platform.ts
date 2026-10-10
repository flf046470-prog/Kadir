import type { InputIntent, Settings, QualityTier } from '@kc/core';
import type { HapticEvent } from './vr/comfort.js';
import { TARGET_FPS } from '../render/governor.js';

export type PlatformKind = 'pc' | 'mobile' | 'vr';

/**
 * The frame rate a headset has to hold, whatever quality tier it is on.
 *
 * 72 is the Quest 2/3 default refresh rate and the floor the game is built to. A flat screen has
 * no equivalent: a phone dropping to 40 fps looks worse, a headset dropping to 40 fps makes the
 * player ill, so this is a constraint rather than a preference and nothing may lower it.
 */
export const VR_DISPLAY_HZ = 72;

/**
 * Foliage instances per prop kind in a headset. The low tier's figure, reached by measurement.
 *
 * Counted in a real browser on `jungle-world` with six players, patching the WebGL context to add
 * up draw calls and triangles per frame. Per scene pass: low 44 calls / 410k triangles, medium 90
 * / 1131k, medium with shadows off 46 / 633k. A headset draws that scene pass **twice**, once per
 * eye, so the medium tier a Quest is handed costs about 1.76M triangles a frame against Meta's
 * published Quest 2 budget of 750k–1M. Thinning foliage to this figure is what takes the geometry
 * back to the low tier's while keeping medium's resolution and its ten detailed avatars, which are
 * the two things a player in a headset actually looks at.
 */
export const VR_FOLIAGE_BUDGET = 60;

/**
 * How much a tier spends on surface textures, stated rather than inferred.
 *
 * `surfaceQualityFor` used to read this off `profile.shadows` and `profile.shadowMapSize`, on the
 * reasoning that a device too weak for shadows is too weak for a normal map. That reasoning breaks
 * the moment shadows are turned off for a reason other than weakness: dropping the shadow pass in
 * VR — a stereo cost, not a device one — silently turned off every procedural texture in the game
 * and handed a headset flat untextured colour. The two are separate decisions and are separate
 * fields now.
 */
export type TextureDetail = 'none' | 'basic' | 'full';

/**
 * The frame rate the display itself demands, regardless of tier. 0 where there is no such demand.
 *
 * Lives here rather than in `governor.ts` because it is a fact about the platform, and the
 * governor is deliberately arithmetic that knows nothing about devices.
 */
export function fpsFloor(kind: PlatformKind): number {
  return kind === 'vr' ? VR_DISPLAY_HZ : 0;
}

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
  /**
   * Metres. Sets `camera.far` (`max(200, drawDistance * 2.2)`) and **nothing else**.
   *
   * It is named for culling it does not do: measured on `jungle-world`, dropping the medium tier
   * from 120 to 70 changed the frame by zero draw calls and zero triangles, because nothing in
   * `LevelRenderer` reads it — props are thinned by count (`foliageBudget`), never by distance,
   * and the far plane is already past every map's geometry at the lowest tier. It is a tier
   * constant now, with no setting behind it; `Settings.sceneryDetail` scales the count instead,
   * which is the thing that moves. Do not reach for this as a performance lever.
   */
  drawDistance: number;
  maxDetailedPlayers: number;
  /** Number of foliage instances rendered, **per prop kind**. */
  foliageBudget: number;
  /** Which surface textures `surfaceQualityFor` builds. Independent of `shadows` — see above. */
  textureDetail: TextureDetail;
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
  /**
   * Platform-specific hints shown by the tutorial.
   *
   * Implemented as a getter by the platforms whose controls depend on runtime state — VR on
   * whether the player is in arms-first mode, PC on whether pointer lock was granted — so this
   * is read when the screen is drawn rather than once at startup.
   */
  readonly controlHints: { action: string; hint: string }[];
  /**
   * Play haptic feedback for a gameplay event.
   *
   * Optional so the game loop stays platform-agnostic: it reports what happened and the
   * platform decides whether it can express it. Only VR implements this today — a phone's
   * vibrator is too coarse for events this frequent, and a desktop has nothing to buzz.
   */
  feedback?(event: HapticEvent, hand?: 'left' | 'right' | 'both', scale?: number): void;
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
      textureDetail: 'none',
      targetFps: TARGET_FPS.low,
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
      textureDetail: 'basic',
      targetFps: TARGET_FPS.medium,
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
      textureDetail: 'full',
      targetFps: TARGET_FPS.high,
      antialias: true,
    },
  };

  const profile = { ...base[quality] };

  if (kind === 'vr') {
    // VR trades resolution for frame time: dropped frames are nauseating, a soft shadow is not.
    profile.postProcessing = false;
    profile.shadowMapSize = Math.min(profile.shadowMapSize, 1024);
    profile.renderScale = Math.min(profile.renderScale, 1);
    profile.maxDetailedPlayers = Math.min(profile.maxDetailedPlayers, 12);
    if (quality !== 'high') {
      /**
       * The shadow map is a second pass over the same geometry — measured at 44 of the medium
       * tier's 90 draw calls and 498k of its 1131k triangles — and it buys a contact cue that
       * stereo vision already gives you in a headset. Off, with foliage thinned, a Quest gets the
       * low tier's geometry at the medium tier's resolution.
       *
       * Left on at `high` deliberately. Nothing *suggests* high for a headset, and the governor
       * only climbs into it after measuring 103fps of headroom at medium — a PC driving a tethered
       * headset, in other words, which has the frame time to spend on a shadow and no reason to be
       * held to a standalone chipset's budget.
       */
      profile.shadows = false;
      profile.foliageBudget = Math.min(profile.foliageBudget, VR_FOLIAGE_BUDGET);
    }
  }
  if (kind === 'mobile') {
    profile.renderScale = Math.min(profile.renderScale, 0.9);
    profile.antialias = quality === 'high';
  }

  // User settings win over the tier defaults.
  profile.renderScale *= settings.graphics.renderScale;
  profile.shadows = profile.shadows && settings.graphics.shadows;
  profile.postProcessing = profile.postProcessing && settings.graphics.postProcessing;
  /**
   * Scenery thins, and only thins.
   *
   * Applied against whatever the platform branches above left, so the VR ceiling cannot be
   * climbed back over by a settings value — a headset's foliage budget is a frame-time promise,
   * not a preference. `Math.min` rather than a raw multiply for the same reason.
   *
   * This is the slider that used to say "Draw distance" and move nothing: `drawDistance` sets
   * `camera.far` and no more, and props are thinned by count. Measured, this one does something
   * — the medium tier loses about a third of its triangles at the bottom of the range.
   */
  const scenery = profile.foliageBudget;
  profile.foliageBudget = Math.max(1, Math.min(scenery, Math.round(scenery * settings.graphics.sceneryDetail)));
  profile.maxDetailedPlayers = Math.min(profile.maxDetailedPlayers, settings.graphics.maxDetailedPlayers);
  // Every other setting is allowed to win outright. This one is floored by the platform, because
  // in VR "target 60" does not mean "run at 60" — it means "judge a 72 Hz display against a 60 Hz
  // budget", which is a request to accept judder rather than a request for less work.
  profile.targetFps = Math.max(settings.graphics.targetFps, fpsFloor(kind));
  return profile;
}
