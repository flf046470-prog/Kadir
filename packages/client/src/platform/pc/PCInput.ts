import { activeInput, markInput } from '../activeInput.js';
import { Buttons } from '@kc/core';
import type { InputIntent, Settings } from '@kc/core';
import { HoldOrToggle } from '../latch.js';
import type { PlatformInput } from '../Platform.js';
import { shapeStick } from '../stick.js';
import type { StickValue } from '../stick.js';

/**
 * Keyboard + mouse (+ optional gamepad).
 *
 * Look is accumulated locally and sent as an absolute yaw/pitch, exactly like VR sends the
 * headset's orientation — which is why the server needs only one intent format.
 */
/** Pixels of drag that turn a held mouse button from an attack into a look. */
const DRAG_LOOK_SLOP = 8;

/** Both sticks' dead zone: enough for a worn pad's drift, in every direction alike (`shapeStick`). */
const PAD_DEAD_ZONE = 0.18;
/** Look's response curve: half the live travel for slow turns, the same top speed. */
const LOOK_CURVE = 2;
const MOVE_STICK: StickValue = { x: 0, y: 0 };
const LOOK_STICK: StickValue = { x: 0, y: 0 };

/** Every control row below the two that depend on how the browser is treating the mouse. */
const PC_CONTROL_HINTS = [
  { action: 'Hop (hold to charge)', hint: 'Space' },
  { action: 'Sprint', hint: 'Shift' },
  { action: 'Crouch', hint: 'Ctrl' },
  { action: 'Grab / climb', hint: 'Right mouse' },
  { action: 'Punch', hint: 'Left mouse' },
  { action: 'Guard (hold)', hint: 'E' },
  { action: 'Emote', hint: 'X' },
  { action: 'Use gadget', hint: 'F' },
  { action: 'Next gadget', hint: 'Q' },
  { action: 'Shop / board', hint: 'B' },
  { action: 'Push to talk', hint: 'V' },
  // Read by `main.ts`, not here: the view is how the game is drawn, not something the player does.
  { action: 'Camera: first / third person', hint: 'P' },
];

/**
 * The controller's buttons: the one table `readGamepad` reads and the tutorial lists, so the two
 * cannot drift (the same rule as `VR_BINDINGS`). Standard Gamepad mapping, which is the same on an
 * Xbox pad and a DualSense; each hint names both.
 *
 * Why each is where it is:
 * - The left trigger guards, beside the right trigger's punch, as a boxing game's pad does. It used
 *   to sprint too, a second binding for what the left stick click already does.
 * - Gadget fire is on the west face button, not the right bumper. The bumper already grabs with
 *   the right hand, and sharing it meant every ledge you caught also pulled the trigger: measured
 *   at one `gadgetUse` and a freeze-gun charge — a quarter of the round's ammunition — per grab,
 *   in a game whose whole traversal is grabbing.
 * - D-pad up cycles, D-pad down opens the shop, and the right stick click is push-to-talk — the
 *   same shape as the VR controller mapping.
 * - Start/Options (9) pauses and B/Circle backs out of menus; both are read by `ui/padNav.ts`, not
 *   here, because a menu is not an intent.
 */
export const PAD_BINDINGS: readonly { index: number; button: number; action: string; hint: string }[] = [
  { index: 0, button: Buttons.Jump, action: 'Hop (hold to charge)', hint: 'A / Cross' },
  { index: 10, button: Buttons.Sprint, action: 'Sprint', hint: 'Left stick click (L3)' },
  { index: 1, button: Buttons.Crouch, action: 'Crouch', hint: 'B / Circle' },
  { index: 4, button: Buttons.GrabLeft, action: 'Grab / climb, left hand', hint: 'LB / L1' },
  { index: 5, button: Buttons.GrabRight, action: 'Grab / climb, right hand', hint: 'RB / R1' },
  { index: 7, button: Buttons.PunchRight, action: 'Punch', hint: 'RT / R2' },
  { index: 6, button: Buttons.Guard, action: 'Guard (hold)', hint: 'LT / L2' },
  { index: 3, button: Buttons.Emote, action: 'Emote', hint: 'Y / Triangle' },
  { index: 2, button: Buttons.UseGadget, action: 'Use gadget', hint: 'X / Square' },
  { index: 12, button: Buttons.CycleGadget, action: 'Next gadget', hint: 'D-pad up' },
  { index: 13, button: Buttons.Shop, action: 'Shop / board', hint: 'D-pad down' },
  { index: 11, button: Buttons.Talk, action: 'Push to talk', hint: 'Right stick click (R3)' },
];

/** The tutorial's list for a controller: sticks, `PAD_BINDINGS`, and the pause button. */
const PAD_CONTROL_HINTS = [
  { action: 'Move', hint: 'Left stick' },
  { action: 'Look', hint: 'Right stick' },
  ...PAD_BINDINGS.map(({ action, hint }) => ({ action, hint })),
  { action: 'Menu / pause', hint: 'Menu / Options' },
  { action: 'In menus', hint: 'D-pad to move, A / Cross to choose, B / Circle to go back' },
];

export class PCInput implements PlatformInput {
  readonly kind = 'pc' as const;

  /**
   * The tutorial's control list.
   *
   * A getter because one row is not fixed: where the browser refuses pointer lock — any embedded
   * frame without `allow-pointer-lock` — look is driven by dragging instead, and telling that
   * player "Look: Mouse" is worse than saying nothing. It is the one screen they open *because*
   * the camera would not turn.
   */
  get controlHints(): { action: string; hint: string }[] {
    // A controller in hand gets the controller's buttons: read when the screen is drawn, so a pad
    // plugged in before the tutorial opens is the list it shows.
    const pads = typeof navigator !== 'undefined' ? (navigator.getGamepads?.() ?? []) : [];
    // Steam Deck review: glyphs follow the input in use, so a pad that is plugged in but not being
    // used does not hide the keys from a keyboard player (`activeInput`).
    if (this.padEnabled && activeInput() !== 'keys' && [...pads].some((p) => p?.connected)) return PAD_CONTROL_HINTS;
    return [
      { action: 'Move', hint: 'W A S D' },
      { action: 'Look', hint: this.pointerLockBlocked ? 'Drag with the mouse' : 'Mouse' },
      ...PC_CONTROL_HINTS,
    ];
  }

  /** Cached from `sample()` for `controlHints`, which is read when a screen is drawn. */
  private padEnabled = true;
  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private yaw = 0;
  private pitch = 0;
  private pointerLocked = false;
  private canvas: HTMLElement;
  private attached = false;
  /** Set once the browser has refused pointer lock, so the drag fallback takes over for good. */
  private pointerLockBlocked = false;
  private grabLatch = new HoldOrToggle();
  private dragging = false;
  private dragDistance = 0;
  /**
   * Cached from `sample()`'s `settings` each tick for `onMouseMove` to read, which only gets the
   * raw `MouseEvent`. Mouse-look — pointer-locked *and* the no-pointer-lock drag fallback, so both
   * of the mouse's own look paths — hardcoded its own multiplier and never read either setting;
   * only the optional gamepad-look path (`readGamepad`) did. On the platform most PC players use a
   * mouse rather than a pad, "Look sensitivity" and "Invert Y" did nothing for most of them.
   */
  private lookSensitivity = 1;
  private invertY = false;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
  }

  start(): void {
    if (this.attached) return;
    this.attached = true;
    globalThis.addEventListener('keydown', this.onKeyDown);
    globalThis.addEventListener('keyup', this.onKeyUp);
    globalThis.addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    globalThis.addEventListener('mouseup', this.onMouseUp);
    globalThis.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  stop(): void {
    if (!this.attached) return;
    this.attached = false;
    globalThis.removeEventListener('keydown', this.onKeyDown);
    globalThis.removeEventListener('keyup', this.onKeyUp);
    globalThis.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    globalThis.removeEventListener('mouseup', this.onMouseUp);
    globalThis.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.keys.clear();
    this.mouseButtons.clear();
    this.dragging = false;
  }

  /**
   * Ask for pointer lock, and remember if the browser says no.
   *
   * It says no whenever the game is embedded in a frame that was not granted `allow-pointer-lock`
   * — an artifact viewer, an itch.io page, any kiosk embed. The call throws a `SecurityError`
   * synchronously *and* rejects, and an unhandled one of those is a red line in the player's
   * console for something that is not their problem. Swallow it and fall back to drag-look, which
   * is why `pointerLockBlocked` is sticky: once refused, asking again on every click only
   * produces more errors.
   */
  requestPointerLock(): void {
    if (this.pointerLocked || this.pointerLockBlocked) return;
    try {
      const result = this.canvas.requestPointerLock?.() as Promise<void> | undefined;
      result?.catch(() => {
        this.pointerLockBlocked = true;
      });
    } catch {
      this.pointerLockBlocked = true;
    }
  }

  /** True when look is coming from dragging rather than from a locked pointer. */
  get isDragLooking(): boolean {
    return this.pointerLockBlocked;
  }

  releasePointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock?.();
  }

  get hasPointerLock(): boolean {
    return this.pointerLocked;
  }

  sample(out: InputIntent, dt: number, settings: Settings): void {
    this.lookSensitivity = settings.controls.lookSensitivity;
    this.invertY = settings.controls.invertY;

    let moveX = 0;
    let moveZ = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveZ += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveZ -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;

    let buttons = 0;
    if (this.keys.has('Space')) buttons |= Buttons.Jump;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) buttons |= Buttons.Sprint;
    if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) buttons |= Buttons.Crouch;
    if (this.keys.has('KeyX')) buttons |= Buttons.Emote;
    if (this.keys.has('KeyF')) buttons |= Buttons.UseGadget;
    if (this.keys.has('KeyQ')) buttons |= Buttons.CycleGadget;
    if (this.keys.has('KeyB')) buttons |= Buttons.Shop;
    if (this.keys.has('KeyV')) buttons |= Buttons.Talk;
    if (this.keys.has('KeyE')) buttons |= Buttons.Guard;
    if (this.grabLatch.update(this.mouseButtons.has(2), settings.controls.holdToGrab)) {
      buttons |= Buttons.GrabRight | Buttons.GrabLeft;
    }
    if (this.mouseButtons.has(0)) buttons |= Buttons.PunchRight;

    this.padEnabled = settings.controls.gamepadEnabled;
    if (settings.controls.gamepadEnabled) {
      const pad = this.readGamepad(dt, settings);
      if (pad) {
        moveX += pad.moveX;
        moveZ += pad.moveZ;
        buttons |= pad.buttons;
      }
    }

    out.moveX = clamp(moveX, -1, 1);
    out.moveZ = clamp(moveZ, -1, 1);
    out.lookYaw = this.yaw;
    out.lookPitch = this.pitch;
    out.buttons = buttons;
    out.hands = null;
    out.headHeight = 1.6;
  }

  private readGamepad(dt: number, settings: Settings): { moveX: number; moveZ: number; buttons: number } | null {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p?.connected);
    if (!pad) return null;

    const move = shapeStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, PAD_DEAD_ZONE, 1, MOVE_STICK);
    const look = shapeStick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, PAD_DEAD_ZONE, LOOK_CURVE, LOOK_STICK);

    this.yaw -= look.x * settings.controls.lookSensitivity * 2.5 * dt;
    this.pitch = clamp(
      this.pitch - look.y * settings.controls.lookSensitivity * 2 * dt * (settings.controls.invertY ? -1 : 1),
      -1.45,
      1.45,
    );

    let buttons = 0;
    for (const binding of PAD_BINDINGS) {
      if (pad.buttons[binding.index]?.pressed === true) buttons |= binding.button;
    }
    if (buttons !== 0 || move.x !== 0 || move.y !== 0 || look.x !== 0 || look.y !== 0) markInput('pad');

    return { moveX: move.x, moveZ: -move.y, buttons };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    // Never swallow keys while the player is typing into a UI field.
    if (isTextInput(event.target)) return;
    this.keys.add(event.code);
    markInput('keys');
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.mouseButtons.clear();
    this.dragging = false;
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (isTextInput(event.target)) return;
    this.mouseButtons.add(event.button);
    markInput('keys');
    this.dragging = true;
    this.dragDistance = 0;
    this.requestPointerLock();
  };

  private onMouseUp = (event: MouseEvent): void => {
    this.mouseButtons.delete(event.button);
    this.dragging = false;
  };

  private onMouseMove = (event: MouseEvent): void => {
    const sensitivity = 0.0022 * this.lookSensitivity;
    const dy = event.movementY * sensitivity * (this.invertY ? -1 : 1);
    if (this.pointerLocked) {
      this.yaw -= event.movementX * sensitivity;
      this.pitch = clamp(this.pitch - dy, -1.45, 1.45);
      return;
    }
    // Without pointer lock the mouse cannot be recentred, so a bare mouse-move would let you
    // turn only until the cursor hit the edge of the window. Dragging can be repeated, so look
    // is driven by held-button movement instead.
    if (!this.dragging) return;
    this.yaw -= event.movementX * sensitivity;
    this.pitch = clamp(this.pitch - dy, -1.45, 1.45);

    // A drag is a look, not an attack. Past a few pixels the held button stops counting as a
    // punch or a grab, so turning around does not swing at whoever is in front of you — while a
    // click that barely moves still lands, which is how punching works in this mode.
    this.dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
    if (this.dragDistance > DRAG_LOOK_SLOP) this.mouseButtons.clear();
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) {
      this.mouseButtons.clear();
      this.dragging = false;
    }
  };

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  /** See `PlatformInput.setLook`. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isTextInput(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable === true;
}
