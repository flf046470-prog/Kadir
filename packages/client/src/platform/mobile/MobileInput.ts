import { Buttons } from '@kc/core';
import type { InputIntent, Settings } from '@kc/core';
import type { PlatformInput } from '../Platform.js';

interface TouchStick {
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export interface MobileButtonState {
  jump: boolean;
  grab: boolean;
  interact: boolean;
  emote: boolean;
  punch: boolean;
}

/**
 * Touch input.
 *
 * A floating joystick on the left half (it spawns wherever the thumb lands, which is far more
 * comfortable than a fixed pad), swipe-to-look on the right half, and a button cluster owned by
 * `MobileUI`. Hop charging works by holding the jump button, so the kangaroo's signature move is
 * available on a phone without any extra concept.
 */
export class MobileInput implements PlatformInput {
  readonly kind = 'mobile' as const;

  readonly controlHints = [
    { action: 'Move', hint: 'Left stick' },
    { action: 'Look', hint: 'Swipe right side' },
    { action: 'Hop (hold to charge)', hint: 'Jump button' },
    { action: 'Grab / climb', hint: 'Grab button' },
    { action: 'Interact', hint: 'Interact button' },
    { action: 'Emote', hint: 'Emote button' },
  ];

  readonly buttons: MobileButtonState = { jump: false, grab: false, interact: false, emote: false, punch: false };

  private stick: TouchStick | null = null;
  private lookPointer: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;
  private yaw = 0;
  private pitch = 0;
  private surface: HTMLElement;
  private attached = false;
  private stickRadius = 55;

  /** Notified when the joystick moves so the UI can draw it. */
  onStickChange: ((stick: { active: boolean; originX: number; originY: number; x: number; y: number }) => void) | null = null;

  constructor(surface: HTMLElement) {
    this.surface = surface;
  }

  start(): void {
    if (this.attached) return;
    this.attached = true;
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    this.surface.addEventListener('pointermove', this.onPointerMove);
    this.surface.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointercancel', this.onPointerUp);
  }

  stop(): void {
    if (!this.attached) return;
    this.attached = false;
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointercancel', this.onPointerUp);
    this.stick = null;
    this.lookPointer = null;
  }

  sample(out: InputIntent, _dt: number, settings: Settings): void {
    this.stickRadius = settings.controls.joystickSize * 0.5;

    out.moveX = this.stick ? clamp(this.stick.x / this.stickRadius, -1, 1) : 0;
    out.moveZ = this.stick ? clamp(-this.stick.y / this.stickRadius, -1, 1) : 0;
    out.lookYaw = this.yaw;
    out.lookPitch = this.pitch;
    out.headHeight = 1.6;
    out.hands = null;

    let buttons = 0;
    if (this.buttons.jump) buttons |= Buttons.Jump;
    if (this.buttons.grab) buttons |= Buttons.GrabLeft | Buttons.GrabRight;
    if (this.buttons.interact) buttons |= Buttons.Interact;
    if (this.buttons.emote) buttons |= Buttons.Emote;
    if (this.buttons.punch) buttons |= Buttons.PunchRight;
    // Sprint is automatic on touch: holding the stick at full deflection sprints, so the player
    // never has to find a second button while running for their life.
    if (Math.hypot(out.moveX, out.moveZ) > 0.92) buttons |= Buttons.Sprint;
    out.buttons = buttons;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (isUiTarget(event.target)) return;
    const half = globalThis.innerWidth * 0.5;
    if (event.clientX < half && !this.stick) {
      this.stick = { pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, x: 0, y: 0 };
      this.emitStick();
    } else if (this.lookPointer === null) {
      this.lookPointer = event.pointerId;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.stick && event.pointerId === this.stick.pointerId) {
      const dx = event.clientX - this.stick.originX;
      const dy = event.clientY - this.stick.originY;
      const length = Math.hypot(dx, dy);
      const scale = length > this.stickRadius ? this.stickRadius / length : 1;
      this.stick.x = dx * scale;
      this.stick.y = dy * scale;
      this.emitStick();
      return;
    }
    if (event.pointerId === this.lookPointer) {
      const sensitivity = 0.0055 * 1;
      this.yaw -= (event.clientX - this.lastLookX) * sensitivity;
      this.pitch = clamp(this.pitch - (event.clientY - this.lastLookY) * sensitivity, -1.35, 1.35);
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.stick && event.pointerId === this.stick.pointerId) {
      this.stick = null;
      this.emitStick();
    }
    if (event.pointerId === this.lookPointer) this.lookPointer = null;
  };

  private emitStick(): void {
    if (!this.onStickChange) return;
    this.onStickChange(
      this.stick
        ? { active: true, originX: this.stick.originX, originY: this.stick.originY, x: this.stick.x, y: this.stick.y }
        : { active: false, originX: 0, originY: 0, x: 0, y: 0 },
    );
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Taps that land on a HUD control must not also steer the camera or the joystick. */
function isUiTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.('[data-ui]'));
}
