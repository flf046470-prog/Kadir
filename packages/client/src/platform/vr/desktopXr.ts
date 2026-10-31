import { VR_BINDINGS } from './VRInput.js';

/**
 * The desktop VR simulator's controls: a keyboard and a mouse in, a headset's pose and two Touch
 * controllers out.
 *
 * Pure, with no WebXR, DOM or IWER in it, so it is tested in node. `desktopXrRuntime.ts` feeds it
 * the browser's events and copies `step()`'s state onto IWER's emulated device every frame, and
 * from there the game sees an ordinary WebXR session: three.js, `VRInput`, the simulation and the
 * VR menus run exactly as they do in a headset. Nothing in the game knows the simulator exists.
 *
 * Coordinates are WebXR's `local-floor`: y up, -z forward, metres, the floor at 0.
 */

export type SimHand = 'left' | 'right';
export const SIM_HANDS: readonly SimHand[] = ['left', 'right'];

/** A key (or mouse button) held as a controller button: `button` is the XR gamepad index. */
export interface SimButtonKey {
  /** `KeyboardEvent.code`, or `Mouse0`/`Mouse2` for the mouse buttons. */
  code: string;
  label: string;
  hand: SimHand;
  button: number;
}

/** The Touch layout's gamepad indices (WebXR's xr-standard mapping). */
export const TRIGGER = 0;
export const SQUEEZE = 1;
export const STICK_PRESS = 3;
export const FACE_LOWER = 4;
export const FACE_UPPER = 5;
const BUTTON_COUNT = 7;

/**
 * Every controller button a desktop can press. The right hand is the mouse's, so the two buttons a
 * player holds hardest — trigger and grip — are the mouse buttons; the left hand's are under the
 * fingers already on WASD. What each one *does* is not written here: `simControls` reads it from
 * `VR_BINDINGS`, the table `VRInput` samples, so the help can never describe a different game.
 */
export const SIM_BUTTON_KEYS: readonly SimButtonKey[] = [
  { code: 'Mouse0', label: 'Left mouse', hand: 'right', button: TRIGGER },
  { code: 'Mouse2', label: 'Right mouse', hand: 'right', button: SQUEEZE },
  { code: 'Space', label: 'Space', hand: 'right', button: FACE_LOWER },
  { code: 'KeyR', label: 'R', hand: 'right', button: FACE_UPPER },
  { code: 'ShiftLeft', label: 'Shift', hand: 'right', button: STICK_PRESS },
  { code: 'KeyQ', label: 'Q', hand: 'left', button: TRIGGER },
  { code: 'KeyE', label: 'E', hand: 'left', button: SQUEEZE },
  { code: 'KeyF', label: 'F', hand: 'left', button: FACE_LOWER },
  { code: 'KeyG', label: 'G', hand: 'left', button: FACE_UPPER },
  { code: 'KeyV', label: 'V', hand: 'left', button: STICK_PRESS },
];

/** Keys that move rather than press: the two thumbsticks, and the simulator's own controls. */
const MOVE_STICK = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
const TURN_STICK = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const MOVE_HAND: Record<string, SimHand> = { Digit1: 'left', Digit2: 'right' };
const JAB: Record<string, SimHand> = { KeyJ: 'left', KeyK: 'right' };
const DUCK = 'KeyC';
const RESET = 'KeyX';
/** Swaps the controllers for bare, joint-tracked hands, which the grip keys close (a pinch). */
const HAND_TRACKING = 'KeyY';

/** Every key the simulator answers to, so the runtime can keep them from the page. */
export const SIM_KEY_CODES: ReadonlySet<string> = new Set([
  ...SIM_BUTTON_KEYS.filter((k) => !k.code.startsWith('Mouse')).map((k) => k.code),
  ...Object.values(MOVE_STICK),
  ...Object.values(TURN_STICK),
  ...Object.keys(MOVE_HAND),
  ...Object.keys(JAB),
  DUCK,
  RESET,
  HAND_TRACKING,
]);

/** Standing eye height, the IWER default and a Quest's guardian default alike. */
export const STAND_HEIGHT = 1.6;
/**
 * Holding C lowers the head this far. Crouch in VR is ducking your head (`locomotion.ts` crouches
 * a tracked player whose head drops below 1.15 m), so this is the only way to test it.
 */
export const DUCK_DROP = 0.6;
/** Radians of look per pixel of mouse travel. */
export const LOOK_PER_PIXEL = 0.0025;
/** Metres a held hand moves per pixel of mouse travel, and per unit of wheel delta. */
export const HAND_PER_PIXEL = 0.002;
export const HAND_PER_WHEEL = 0.001;
/** How far a hand may be put from the head, per axis: an arm, not a telescope. */
export const HAND_LIMIT = 0.9;
/** A jab: out this far in `JAB_OUT` seconds, back in `JAB_BACK` (0.4 m in 50 ms is 8 m/s). */
export const JAB_REACH = 0.4;
export const JAB_OUT = 0.05;
export const JAB_BACK = 0.15;

/** Where each hand rests, in the head's frame: in front of the chest, a shoulder's width apart. */
export const HAND_REST: Readonly<Record<SimHand, readonly [number, number, number]>> = {
  left: [-0.18, -0.3, -0.35],
  right: [0.18, -0.3, -0.35],
};

export interface SimPose {
  position: [number, number, number];
  /** x, y, z, w. */
  quaternion: [number, number, number, number];
}

export interface SimController extends SimPose {
  /** Button values by xr-standard gamepad index. */
  buttons: number[];
  /** Thumbstick x and y, WebXR's convention: +y is pulled back. */
  stick: [number, number];
}

export interface SimState {
  head: SimPose;
  controllers: Record<SimHand, SimController>;
  /** Bare hands instead of controllers: the poses above are the hands', the grip their pinch. */
  handTracking: boolean;
}

export class DesktopXr {
  /** Head yaw and pitch, radians: positive yaw turns left, positive pitch looks up. */
  yaw = 0;
  pitch = 0;
  handTracking = false;
  private readonly held = new Set<string>();
  private readonly offsets: Record<SimHand, [number, number, number]> = {
    left: [...HAND_REST.left],
    right: [...HAND_REST.right],
  };
  /** Seconds into a jab, or -1 for none. */
  private readonly jab: Record<SimHand, number> = { left: -1, right: -1 };
  /** What the last `step` returned. */
  last: SimState | null = null;

  /** True when the code is one of the simulator's, so the caller can keep it from the page. */
  keyDown(code: string): boolean {
    if (!SIM_KEY_CODES.has(code)) return false;
    if (code in JAB && !this.held.has(code)) this.jab[JAB[code] as SimHand] = 0;
    if (code === RESET) this.reset();
    if (code === HAND_TRACKING && !this.held.has(code)) this.handTracking = !this.handTracking;
    this.held.add(code);
    return true;
  }

  keyUp(code: string): boolean {
    this.held.delete(code);
    return SIM_KEY_CODES.has(code);
  }

  /** A mouse button, by `MouseEvent.button`. Only the left and right ones are controller buttons. */
  mouseButton(button: number, down: boolean): boolean {
    const code = `Mouse${button}`;
    if (!SIM_BUTTON_KEYS.some((k) => k.code === code)) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    return true;
  }

  /** The hand the mouse is moving instead of the head, while 1 or 2 is held. */
  get movingHand(): SimHand | null {
    if (this.held.has('Digit1')) return 'left';
    if (this.held.has('Digit2')) return 'right';
    return null;
  }

  /** Mouse travel in pixels: the head's look, or a held hand's place in front of it. */
  mouseMove(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const hand = this.movingHand;
    if (hand) {
      const offset = this.offsets[hand];
      offset[0] = clamp(offset[0] + dx * HAND_PER_PIXEL, -HAND_LIMIT, HAND_LIMIT);
      offset[1] = clamp(offset[1] - dy * HAND_PER_PIXEL, -HAND_LIMIT * 1.8, HAND_LIMIT);
      return;
    }
    this.yaw -= dx * LOOK_PER_PIXEL;
    this.pitch = clamp(this.pitch - dy * LOOK_PER_PIXEL, -1.45, 1.45);
  }

  /** The wheel pushes a held hand out (scrolling up) or draws it in. */
  wheel(deltaY: number): boolean {
    const hand = this.movingHand;
    if (!hand || !Number.isFinite(deltaY)) return false;
    const offset = this.offsets[hand];
    offset[2] = clamp(offset[2] + deltaY * HAND_PER_WHEEL, -HAND_LIMIT, HAND_LIMIT * 0.5);
    return true;
  }

  /** The window lost focus: let go of everything, as a headset does when it is taken off. */
  releaseAll(): void {
    this.held.clear();
  }

  reset(): void {
    this.offsets.left = [...HAND_REST.left];
    this.offsets.right = [...HAND_REST.right];
    this.jab.left = this.jab.right = -1;
    this.pitch = 0;
  }

  step(dt: number): SimState {
    const headY = STAND_HEIGHT - (this.held.has(DUCK) ? DUCK_DROP : 0);
    const head: SimPose = { position: [0, headY, 0], quaternion: lookQuaternion(this.yaw, this.pitch) };
    const controllers = {} as Record<SimHand, SimController>;
    for (const hand of SIM_HANDS) {
      if (this.jab[hand] >= 0) {
        this.jab[hand] += Math.max(0, dt);
        if (this.jab[hand] > JAB_OUT + JAB_BACK) this.jab[hand] = -1;
      }
      const [ox, oy, oz] = this.offsets[hand];
      const local: [number, number, number] = [ox, oy, oz - JAB_REACH * jabExtension(this.jab[hand])];
      const turned = rotateByLook(local, this.yaw, this.pitch);
      controllers[hand] = {
        position: [turned[0], headY + turned[1], turned[2]],
        // The controllers point where the head looks, so the menu ray goes where the mouse aims.
        quaternion: head.quaternion,
        buttons: this.buttonsOf(hand),
        stick: this.stickOf(hand),
      };
    }
    this.last = { head, controllers, handTracking: this.handTracking };
    return this.last;
  }

  private buttonsOf(hand: SimHand): number[] {
    const values = Array.from({ length: BUTTON_COUNT }, () => 0);
    for (const key of SIM_BUTTON_KEYS) {
      if (key.hand === hand && this.held.has(key.code)) values[key.button] = 1;
    }
    return values;
  }

  private stickOf(hand: SimHand): [number, number] {
    const keys = hand === 'left' ? MOVE_STICK : TURN_STICK;
    const axis = (minus: string, plus: string) => (this.held.has(plus) ? 1 : 0) - (this.held.has(minus) ? 1 : 0);
    const x = axis(keys.left, keys.right);
    const y = axis(keys.up, keys.down);
    // A diagonal is the rim of the stick, not past it.
    const length = Math.hypot(x, y);
    return length > 1 ? [x / length, y / length] : [x, y];
  }
}

/** 0 at rest, 1 at full reach: out fast, back slower, like the button punch it stands in for. */
export function jabExtension(elapsed: number): number {
  if (elapsed < 0) return 0;
  if (elapsed < JAB_OUT) return elapsed / JAB_OUT;
  return Math.max(0, 1 - (elapsed - JAB_OUT) / JAB_BACK);
}

/** Yaw about +y, then pitch about +x: the head's orientation as a quaternion (x, y, z, w). */
export function lookQuaternion(yaw: number, pitch: number): [number, number, number, number] {
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const sp = Math.sin(pitch / 2);
  const cp = Math.cos(pitch / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/** A vector in the head's frame, turned into the room's by the same yaw and pitch. */
export function rotateByLook(v: readonly [number, number, number], yaw: number, pitch: number): [number, number, number] {
  const [x, y0, z0] = v;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y = y0 * cp - z0 * sp;
  const z = y0 * sp + z0 * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return [x * cy + z * sy, y, -x * sy + z * cy];
}

export interface SimControlLine {
  keys: string;
  does: string;
}

/**
 * The help the simulator shows, with each controller button described by the game action
 * `VR_BINDINGS` gives it. The grip has no row there because it is not a button press but a hold
 * (`locomotion.ts` closes the hand on it), so it is named here.
 */
export function simControls(): SimControlLine[] {
  const lines: SimControlLine[] = [
    { keys: 'Mouse', does: 'Look (click the view first to capture the mouse; Esc releases it)' },
    { keys: 'W A S D', does: 'Left thumbstick: move, in Assisted or Seated VR movement' },
    { keys: '← →', does: 'Right thumbstick: turn' },
  ];
  for (const key of SIM_BUTTON_KEYS) {
    const side = key.hand === 'left' ? 'Left' : 'Right';
    const name = BUTTON_NAMES[key.hand][key.button] ?? `button ${key.button}`;
    const binding = VR_BINDINGS.find((b) => b.button === key.button && (b.hand === key.hand || b.hand === 'both'));
    const does = binding
      ? binding.action
      : key.button === SQUEEZE
        ? 'Grip: hold on to what the hand is touching'
        : 'nothing in this game';
    lines.push({ keys: key.label, does: `${side} ${name}: ${does}` });
  }
  lines.push(
    { keys: 'Hold 1 / 2 + mouse', does: 'Move the left / right hand instead of the head; wheel moves it in and out' },
    { keys: 'J / K', does: 'Jab with the left / right hand (a real 8 m/s hand movement)' },
    { keys: 'Hold C', does: 'Duck your head (crouch in VR)' },
    { keys: 'X', does: 'Put both hands back and look level' },
    { keys: 'Y', does: 'Switch between controllers and bare hands (hand tracking; the grip keys pinch)' },
    { keys: 'H', does: 'Show or hide this help' },
  );
  return lines;
}

const BUTTON_NAMES: Record<SimHand, Record<number, string>> = {
  left: { [TRIGGER]: 'trigger', [SQUEEZE]: 'grip', [STICK_PRESS]: 'thumbstick press', [FACE_LOWER]: 'X', [FACE_UPPER]: 'Y' },
  right: { [TRIGGER]: 'trigger', [SQUEEZE]: 'grip', [STICK_PRESS]: 'thumbstick press', [FACE_LOWER]: 'A', [FACE_UPPER]: 'B' },
};

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
