import { Buttons } from '@kc/core';
import type { InputIntent, Settings } from '@kc/core';
import type { PlatformInput } from '../Platform.js';

/**
 * Keyboard + mouse (+ optional gamepad).
 *
 * Look is accumulated locally and sent as an absolute yaw/pitch, exactly like VR sends the
 * headset's orientation — which is why the server needs only one intent format.
 */
export class PCInput implements PlatformInput {
  readonly kind = 'pc' as const;

  readonly controlHints = [
    { action: 'Move', hint: 'W A S D' },
    { action: 'Look', hint: 'Mouse' },
    { action: 'Hop (hold to charge)', hint: 'Space' },
    { action: 'Sprint', hint: 'Shift' },
    { action: 'Crouch', hint: 'Ctrl' },
    { action: 'Grab / climb', hint: 'Right mouse' },
    { action: 'Punch', hint: 'Left mouse' },
    { action: 'Interact', hint: 'E' },
    { action: 'Emote', hint: 'X' },
    { action: 'Use gadget', hint: 'F' },
    { action: 'Next gadget', hint: 'Q' },
    { action: 'Shop / board', hint: 'B' },
    { action: 'Push to talk', hint: 'V' },
  ];

  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private yaw = 0;
  private pitch = 0;
  private pointerLocked = false;
  private canvas: HTMLElement;
  private attached = false;

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
  }

  requestPointerLock(): void {
    if (!this.pointerLocked) void this.canvas.requestPointerLock?.();
  }

  releasePointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock?.();
  }

  get hasPointerLock(): boolean {
    return this.pointerLocked;
  }

  sample(out: InputIntent, dt: number, settings: Settings): void {
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
    if (this.keys.has('KeyE')) buttons |= Buttons.Interact;
    if (this.keys.has('KeyX')) buttons |= Buttons.Emote;
    if (this.keys.has('KeyF')) buttons |= Buttons.UseGadget;
    if (this.keys.has('KeyQ')) buttons |= Buttons.CycleGadget;
    if (this.keys.has('KeyB')) buttons |= Buttons.Shop;
    if (this.keys.has('KeyV')) buttons |= Buttons.Talk;
    if (this.mouseButtons.has(2)) buttons |= Buttons.GrabRight | Buttons.GrabLeft;
    if (this.mouseButtons.has(0)) buttons |= Buttons.PunchRight;

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

    const dead = 0.18;
    const axis = (i: number): number => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < dead ? 0 : v;
    };

    this.yaw -= axis(2) * settings.controls.lookSensitivity * 2.5 * dt;
    this.pitch = clamp(
      this.pitch - axis(3) * settings.controls.lookSensitivity * 2 * dt * (settings.controls.invertY ? -1 : 1),
      -1.45,
      1.45,
    );

    let buttons = 0;
    const pressed = (i: number): boolean => pad.buttons[i]?.pressed === true;
    if (pressed(0)) buttons |= Buttons.Jump;
    if (pressed(10) || pressed(6)) buttons |= Buttons.Sprint;
    if (pressed(1)) buttons |= Buttons.Crouch;
    if (pressed(4)) buttons |= Buttons.GrabLeft;
    if (pressed(5)) buttons |= Buttons.GrabRight;
    if (pressed(2)) buttons |= Buttons.Interact;
    if (pressed(3)) buttons |= Buttons.Emote;
    if (pressed(7)) buttons |= Buttons.PunchRight;
    // Gamepad: right bumper fires the gadget, D-pad up cycles, D-pad down opens the shop, and
    // the right stick click is push-to-talk — the same shape as the VR controller mapping.
    if (pressed(5)) buttons |= Buttons.UseGadget;
    if (pressed(12)) buttons |= Buttons.CycleGadget;
    if (pressed(13)) buttons |= Buttons.Shop;
    if (pressed(11)) buttons |= Buttons.Talk;

    return { moveX: axis(0), moveZ: -axis(1), buttons };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    // Never swallow keys while the player is typing into a UI field.
    if (isTextInput(event.target)) return;
    this.keys.add(event.code);
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.mouseButtons.clear();
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (isTextInput(event.target)) return;
    this.mouseButtons.add(event.button);
    this.requestPointerLock();
  };

  private onMouseUp = (event: MouseEvent): void => {
    this.mouseButtons.delete(event.button);
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) return;
    const sensitivity = 0.0022;
    this.yaw -= event.movementX * sensitivity;
    this.pitch = clamp(this.pitch - event.movementY * sensitivity, -1.45, 1.45);
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) this.mouseButtons.clear();
  };

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  /** Applied by the settings screen so sensitivity changes take effect immediately. */
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
