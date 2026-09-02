export type QualityTier = 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  /** 'auto' lets the device probe and the frame-time governor choose. */
  quality: QualityTier | 'auto';
  shadows: boolean;
  postProcessing: boolean;
  /** Render scale multiplier (0.5–1.5). */
  renderScale: number;
  /** How many other players get full-detail avatars. */
  maxDetailedPlayers: number;
  targetFps: number;
  /** Foliage/prop draw distance in metres. */
  drawDistance: number;
}

export interface AudioSettings {
  master: number;
  sfx: number;
  music: number;
  voice: number;
  spatialVoice: boolean;
}

export type Handedness = 'right' | 'left';

/**
 * How a VR player moves.
 *
 * `arms` is the default and the design the game is built around: hands only, no stick and no
 * hop button. Two things follow from that. Comfort — nausea in VR comes from the view moving
 * when the body did not ask it to, and a thumbstick or a button-triggered launch is exactly
 * that; when every metre of travel is something your arms did, the mismatch disappears. And
 * skill — if pushing off the world is the only way to move, that one interaction is what
 * players get good at, which is where the depth in this genre lives.
 *
 * `assisted` restores the stick and the hop for players who need to sit, have limited reach, or
 * simply want them. It is an accessibility option, not the intended way to play, and it is
 * slower on purpose so hands stay the fast option.
 */
export type VrLocomotion = 'arms' | 'assisted';

export interface ComfortSettings {
  snapTurn: boolean;
  snapAngleDegrees: number;
  smoothTurnSpeed: number;
  vignette: number;
  /** Player height in metres; 0 = use the runtime's floor calibration. */
  heightCalibration: number;
  seated: boolean;
  handedness: Handedness;
  sensitivity: number;
  vrLocomotion: VrLocomotion;
}

export interface ControlSettings {
  invertY: boolean;
  lookSensitivity: number;
  /** Mobile: on-screen joystick radius in CSS pixels. */
  joystickSize: number;
  /** Mobile/PC: hold vs toggle for grab. */
  holdToGrab: boolean;
  gamepadEnabled: boolean;
  hapticStrength: number;
}

export interface Settings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  comfort: ComfortSettings;
  controls: ControlSettings;
  /** Cross-play can be turned off (e.g. to avoid VR opponents on mobile). */
  crossPlay: boolean;
  voiceEnabled: boolean;
  /** Reduced-motion / high-contrast style accessibility switches. */
  reduceMotion: boolean;
  colorblindSafe: boolean;
  locale: string;
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: {
    quality: 'auto',
    shadows: true,
    postProcessing: true,
    renderScale: 1,
    maxDetailedPlayers: 12,
    targetFps: 60,
    drawDistance: 140,
  },
  audio: { master: 0.9, sfx: 1, music: 0.5, voice: 1, spatialVoice: true },
  comfort: {
    snapTurn: true,
    snapAngleDegrees: 30,
    smoothTurnSpeed: 120,
    vignette: 0.35,
    heightCalibration: 0,
    seated: false,
    handedness: 'right',
    sensitivity: 1,
    vrLocomotion: 'arms',
  },
  controls: {
    invertY: false,
    lookSensitivity: 1,
    joystickSize: 110,
    holdToGrab: true,
    gamepadEnabled: true,
    hapticStrength: 0.7,
  },
  crossPlay: true,
  voiceEnabled: true,
  reduceMotion: false,
  colorblindSafe: false,
  locale: 'en',
};

/** Deep-merge stored settings over the defaults, clamping anything out of range. */
export function mergeSettings(stored: unknown): Settings {
  const base: Settings = structuredCloneCompat(DEFAULT_SETTINGS);
  if (!stored || typeof stored !== 'object') return base;
  const raw = stored as Partial<Settings>;

  Object.assign(base.graphics, raw.graphics ?? {});
  Object.assign(base.audio, raw.audio ?? {});
  Object.assign(base.comfort, raw.comfort ?? {});
  Object.assign(base.controls, raw.controls ?? {});
  if (typeof raw.crossPlay === 'boolean') base.crossPlay = raw.crossPlay;
  if (typeof raw.voiceEnabled === 'boolean') base.voiceEnabled = raw.voiceEnabled;
  if (typeof raw.reduceMotion === 'boolean') base.reduceMotion = raw.reduceMotion;
  if (typeof raw.colorblindSafe === 'boolean') base.colorblindSafe = raw.colorblindSafe;
  if (typeof raw.locale === 'string') base.locale = raw.locale;

  base.graphics.renderScale = clamp(base.graphics.renderScale, 0.5, 1.5);
  base.graphics.maxDetailedPlayers = Math.round(clamp(base.graphics.maxDetailedPlayers, 2, 16));
  base.graphics.targetFps = Math.round(clamp(base.graphics.targetFps, 30, 144));
  base.graphics.drawDistance = clamp(base.graphics.drawDistance, 40, 400);
  base.audio.master = clamp01(base.audio.master);
  base.audio.sfx = clamp01(base.audio.sfx);
  base.audio.music = clamp01(base.audio.music);
  base.audio.voice = clamp01(base.audio.voice);
  base.comfort.snapAngleDegrees = clamp(base.comfort.snapAngleDegrees, 15, 90);
  base.comfort.vignette = clamp01(base.comfort.vignette);
  base.comfort.sensitivity = clamp(base.comfort.sensitivity, 0.2, 3);
  base.comfort.heightCalibration = clamp(base.comfort.heightCalibration, 0, 2.4);
  // comfort is merged with Object.assign, so a stored value reaches here unchecked. An
  // unrecognised mode would silently disable hand locomotion, so it falls back to the default.
  if (base.comfort.vrLocomotion !== 'assisted') base.comfort.vrLocomotion = 'arms';
  base.controls.lookSensitivity = clamp(base.controls.lookSensitivity, 0.1, 4);
  base.controls.joystickSize = clamp(base.controls.joystickSize, 60, 220);
  base.controls.hapticStrength = clamp01(base.controls.hapticStrength);
  return base;
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function structuredCloneCompat<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
