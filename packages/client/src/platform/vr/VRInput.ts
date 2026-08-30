import * as THREE from 'three';
import { Buttons, createHandIntent } from '@kc/core';
import type { InputIntent, Settings } from '@kc/core';
import type { PlatformInput } from '../Platform.js';
import type { Renderer } from '../../render/Renderer.js';
import { handScaleFrom, hapticFor, pinchStrength } from './comfort.js';
import type { HapticEvent } from './comfort.js';

interface HandTracker {
  controller: THREE.Group;
  grip: THREE.Group;
  /** Populated by three.js when the runtime reports articulated hand joints. */
  hand: THREE.XRHandSpace;
  source: XRInputSource | null;
  lastWorld: THREE.Vector3;
  velocity: THREE.Vector3;
  tracked: boolean;
  gripValue: number;
  triggerValue: number;
}

const HAND_LOCAL = new THREE.Vector3();
const WORLD = new THREE.Vector3();

/**
 * WebXR input — the game's most expressive control scheme.
 *
 * WebXR sits on the platform's OpenXR runtime, so this one implementation covers Quest,
 * SteamVR and PICO with no per-headset SDK. Head, body and both hands are tracked separately
 * and handed to the simulation in body-local space; the hand-physics locomotion in
 * `@kc/core` does the rest.
 *
 * Turning is the one place where VR needs its own state: the body yaw is the headset yaw plus a
 * comfort turn offset (snap or smooth), and the render rig is rotated by that same offset so the
 * world turns around the player rather than the player sliding through it.
 */
export class VRInput implements PlatformInput {
  readonly kind = 'vr' as const;

  /**
   * The tutorial must not advertise controls the current mode has switched off — a player told
   * to press A for a hop that never comes concludes the game is broken, not that they are in
   * arms-first mode.
   */
  get controlHints(): { action: string; hint: string }[] {
    const shared = [
      { action: 'Move', hint: 'Grab a surface and pull — or swing your arms' },
      { action: 'Climb', hint: 'Grip with either hand and haul yourself up' },
      { action: 'Push off', hint: 'Shove a wall with an open palm' },
    ];
    const tail = [
      { action: 'Turn', hint: 'Right thumbstick' },
      { action: 'Punch', hint: 'Throw a real punch' },
      { action: 'Emote', hint: 'B button' },
    ];
    return this.armsOnly
      ? [...shared, { action: 'Jump', hint: 'Push off the ground with a hand — there is no jump button' }, ...tail]
      : [...shared, { action: 'Hop', hint: 'A button (hold to charge)' }, ...tail];
  }

  /** Mirrors settings.comfort.vrLocomotion, refreshed each sample so the hints stay honest.
   * Defaults to the setting's default so the tutorial is right before the first frame. */
  private armsOnly = true;
  private renderer: Renderer;
  private hands: [HandTracker, HandTracker];
  private turnOffset = 0;
  private snapArmed = true;
  private headHeight = 1.6;
  private headYaw = 0;
  private headPitch = 0;
  private session: XRSession | null = null;
  private buttons = 0;

  /** Fired when the XR session starts/ends so the app can switch UI hosts. */
  onSessionChange: ((active: boolean) => void) | null = null;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.hands = [this.makeHand(0), this.makeHand(1)];
  }

  private makeHand(index: number): HandTracker {
    const xr = this.renderer.renderer.xr;
    const controller = xr.getController(index);
    const grip = xr.getControllerGrip(index);
    const hand = xr.getHand(index);
    this.renderer.rig.add(controller);
    this.renderer.rig.add(grip);
    this.renderer.rig.add(hand);

    const tracker: HandTracker = {
      controller,
      grip,
      hand,
      source: null,
      lastWorld: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      tracked: false,
      gripValue: 0,
      triggerValue: 0,
    };

    controller.addEventListener('connected', (event) => {
      tracker.source = (event as unknown as { data: XRInputSource }).data;
      tracker.tracked = true;
    });
    controller.addEventListener('disconnected', () => {
      tracker.source = null;
      tracker.tracked = false;
    });
    return tracker;
  }

  start(): void {
    const xr = this.renderer.renderer.xr;
    xr.addEventListener('sessionstart', this.onSessionStart);
    xr.addEventListener('sessionend', this.onSessionEnd);
  }

  stop(): void {
    const xr = this.renderer.renderer.xr;
    xr.removeEventListener('sessionstart', this.onSessionStart);
    xr.removeEventListener('sessionend', this.onSessionEnd);
  }

  get isPresenting(): boolean {
    return this.renderer.renderer.xr.isPresenting;
  }

  /** Enter VR. Must be called from a user gesture (button press) per the WebXR spec. */
  async enterVr(): Promise<boolean> {
    const xr = navigator.xr;
    if (!xr) return false;
    try {
      const session = await xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
      });
      await this.renderer.renderer.xr.setSession(session);
      this.session = session;
      return true;
    } catch (error) {
      console.warn('[vr] session request failed:', (error as Error).message);
      return false;
    }
  }

  async exitVr(): Promise<void> {
    await this.session?.end();
    this.session = null;
  }

  /** Called every XR frame before `sample`, to differentiate hand positions over real time. */
  updateTracking(dt: number, settings: Settings): void {
    const xrCamera = this.renderer.renderer.xr.getCamera();
    xrCamera.getWorldPosition(WORLD);
    const rigY = this.renderer.rig.position.y;
    this.headHeight = Math.max(0.4, WORLD.y - rigY);
    if (settings.comfort.heightCalibration > 0) {
      this.headHeight = settings.comfort.heightCalibration;
    }

    const orientation = new THREE.Euler().setFromQuaternion(xrCamera.quaternion, 'YXZ');
    this.headYaw = orientation.y;
    this.headPitch = THREE.MathUtils.clamp(orientation.x, -1.45, 1.45);

    for (const hand of this.hands) {
      if (!hand.tracked) continue;
      hand.grip.getWorldPosition(WORLD);
      if (dt > 0) {
        hand.velocity.subVectors(WORLD, hand.lastWorld).divideScalar(dt);
      }
      hand.lastWorld.copy(WORLD);

      const gamepad = hand.source?.gamepad;
      if (gamepad) {
        hand.gripValue = gamepad.buttons[1]?.value ?? 0;
        hand.triggerValue = gamepad.buttons[0]?.value ?? 0;
      } else {
        // Hand tracking: an XRInputSource in this mode has no gamepad at all, so reading
        // button values leaves bare hands connected but unable to grab anything. Pinch is
        // the equivalent gesture, and it is what the Quest's own UI trains players to use.
        hand.gripValue = readPinch(hand.hand);
        hand.triggerValue = hand.gripValue;
      }
    }

    this.updateTurn(dt, settings);
    this.updateButtons();
  }

  /**
   * Comfort turning. Snap turn is the default because it is the least nauseating option for
   * most players; smooth turn is available for those who prefer it.
   */
  private updateTurn(dt: number, settings: Settings): void {
    const stick = this.readStick('right');
    const x = stick?.x ?? 0;

    if (settings.comfort.snapTurn) {
      if (Math.abs(x) > 0.7 && this.snapArmed) {
        this.turnOffset -= Math.sign(x) * THREE.MathUtils.degToRad(settings.comfort.snapAngleDegrees);
        this.snapArmed = false;
      } else if (Math.abs(x) < 0.35) {
        this.snapArmed = true;
      }
    } else if (Math.abs(x) > 0.15) {
      this.turnOffset -= x * THREE.MathUtils.degToRad(settings.comfort.smoothTurnSpeed) * dt;
    }

    this.renderer.rig.rotation.y = this.turnOffset;
  }

  private updateButtons(): void {
    let buttons = 0;
    for (const hand of this.hands) {
      const gamepad = hand.source?.gamepad;
      if (!gamepad) continue;
      const handedness = hand.source?.handedness;
      // Standard OpenXR mapping: 4 = A/X, 5 = B/Y.
      if (gamepad.buttons[4]?.pressed) buttons |= handedness === 'right' ? Buttons.Jump : Buttons.Interact;
      if (gamepad.buttons[5]?.pressed) buttons |= Buttons.Emote;
      if (gamepad.buttons[3]?.pressed) buttons |= Buttons.Sprint; // thumbstick click
    }
    // Crouching is physical: ducking your head is the crouch input, no button needed.
    this.buttons = buttons;
  }

  private readStick(handedness: XRHandedness): { x: number; y: number } | null {
    for (const hand of this.hands) {
      if (hand.source?.handedness !== handedness) continue;
      const axes = hand.source.gamepad?.axes;
      if (!axes) return null;
      // WebXR reports [touchpadX, touchpadY, stickX, stickY] on most controllers.
      const x = axes[2] ?? axes[0] ?? 0;
      const y = axes[3] ?? axes[1] ?? 0;
      return { x: Math.abs(x) < 0.12 ? 0 : x, y: Math.abs(y) < 0.12 ? 0 : y };
    }
    return null;
  }

  sample(out: InputIntent, _dt: number, settings: Settings): void {
    const bodyYaw = this.headYaw + this.turnOffset;
    out.lookYaw = bodyYaw;
    out.lookPitch = this.headPitch;
    out.headHeight = this.headHeight;

    // Arms-first is the default. The stick and the hop are not merely discouraged here, they
    // are absent: leaving a cheaper way to travel available means players use it, the hand
    // locomotion never gets practised, and the one interaction the game is built on stays
    // shallow. It is also the comfort story — every metre travelled is one the arms asked for,
    // so there is no vestibular mismatch to make anyone sick.
    const armsOnly = settings.comfort.vrLocomotion === 'arms';
    this.armsOnly = armsOnly;

    if (armsOnly) {
      out.moveX = 0;
      out.moveZ = 0;
    } else {
      // Assisted mode: the stick is an accessibility fallback (seated play, limited reach) and
      // is deliberately slower than hands, so hands stay the fast option even here.
      const stick = this.readStick('left');
      const assist = settings.comfort.seated ? 1 : 0.55;
      out.moveX = (stick?.x ?? 0) * assist;
      out.moveZ = (stick?.y ? -stick.y : 0) * assist;
    }

    // Jump is a button-triggered launch: the view moves without the body having asked, which is
    // the classic nausea source. Arms-first drops it; pushing off the ground with a hand is the
    // way up. Every other button (interact, emote, sprint) is unaffected.
    let buttons = armsOnly ? this.buttons & ~Buttons.Jump : this.buttons;
    if (!out.hands) out.hands = [createHandIntent(), createHandIntent()];

    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i] as HandTracker;
      const intentHand = out.hands[i];
      if (!intentHand) continue;

      intentHand.tracked = hand.tracked;
      intentHand.grip = Math.max(hand.gripValue, hand.triggerValue);
      if (!hand.tracked) continue;

      hand.grip.getWorldPosition(WORLD);
      toBodyLocal(HAND_LOCAL, WORLD, this.renderer.rig.position, bodyYaw);
      intentHand.pos.x = HAND_LOCAL.x;
      intentHand.pos.y = HAND_LOCAL.y;
      intentHand.pos.z = HAND_LOCAL.z;

      // Velocity is sent for client-side prediction only; the server derives its own from
      // consecutive positions, so inflating this field buys a cheater nothing.
      toBodyLocalDirection(HAND_LOCAL, hand.velocity, bodyYaw);
      intentHand.vel.x = HAND_LOCAL.x;
      intentHand.vel.y = HAND_LOCAL.y;
      intentHand.vel.z = HAND_LOCAL.z;

      if (intentHand.grip > settings.comfort.sensitivity * 0.4) {
        buttons |= i === 0 ? Buttons.GrabLeft : Buttons.GrabRight;
      }
    }

    out.buttons = buttons;
  }

  /** Haptic pulse — grabs, landings and punches all feel better with a bump. */
  pulse(handIndex: number, intensity: number, durationMs: number): void {
    const hand = this.hands[handIndex];
    const actuator = hand?.source?.gamepad?.hapticActuators?.[0];
    actuator?.pulse?.(Math.min(1, Math.max(0, intensity)), durationMs);
  }

  /**
   * Play the feedback for a game event.
   *
   * Strength per event lives in `comfort.ts` so it is tuned in one place and unit tested; a
   * pulse that is too long on a frequent event becomes a buzz players switch off entirely.
   * `hand` selects one controller, or both when the event is not hand-specific (being tagged).
   * Hand-tracked sources have no actuator, so this is silently a no-op for them.
   */
  feedback(event: HapticEvent, hand: 'left' | 'right' | 'both' = 'both', scale = 1): void {
    const { intensity, durationMs } = hapticFor(event, scale);
    for (let i = 0; i < this.hands.length; i += 1) {
      if (hand !== 'both') {
        const handedness = this.hands[i]?.source?.handedness;
        if (handedness !== hand) continue;
      }
      this.pulse(i, intensity, durationMs);
    }
  }

  get turn(): number {
    return this.turnOffset;
  }

  recenter(): void {
    this.turnOffset = 0;
    this.renderer.rig.rotation.y = 0;
  }

  private onSessionStart = (): void => {
    this.onSessionChange?.(true);
  };

  private onSessionEnd = (): void => {
    this.session = null;
    this.onSessionChange?.(false);
  };
}

/**
 * Grip strength from articulated hand joints.
 *
 * three.js fills `XRHandSpace.joints` from the runtime's joint poses each frame. When the
 * runtime is not reporting hands — controllers in use, or tracking momentarily lost — the
 * joints are absent and this returns 0, which reads as an open hand and simply releases
 * whatever was held rather than freezing the player mid-climb.
 */
function readPinch(hand: THREE.XRHandSpace): number {
  const joints = hand.joints as Record<string, THREE.XRJointSpace | undefined>;
  const thumb = joints['thumb-tip'];
  const index = joints['index-finger-tip'];
  if (!thumb || !index) return 0;
  const wrist = joints['wrist'];
  const metacarpal = joints['middle-finger-metacarpal'];
  const scale = wrist && metacarpal ? handScaleFrom(wrist.position, metacarpal.position) : 1;
  return pinchStrength(thumb.position, index.position, scale);
}

/**
 * World -> body-local, the exact inverse of the mapping the simulation uses
 * (`world = position + right * local.x + forward * local.z`, with
 * `right = (cos yaw, 0, -sin yaw)` and `forward = (sin yaw, 0, cos yaw)`).
 * Getting this inverse wrong sends hands to mirrored positions, so it is unit tested.
 */
export function toBodyLocal(out: THREE.Vector3, world: THREE.Vector3, origin: THREE.Vector3, yaw: number): void {
  const dx = world.x - origin.x;
  const dz = world.z - origin.z;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  out.set(dx * cos - dz * sin, world.y - origin.y, dx * sin + dz * cos);
}

export function toBodyLocalDirection(out: THREE.Vector3, direction: THREE.Vector3, yaw: number): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  out.set(direction.x * cos - direction.z * sin, direction.y, direction.x * sin + direction.z * cos);
}
