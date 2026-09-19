import { clamp, clamp01 } from '../math/scalar.js';
import type { Vec3 } from '../math/vec3.js';
import { v3copy, v3dot, v3length, v3normalize, v3set, vec3 } from '../math/vec3.js';
import type { MoveResult } from '../physics/character.js';
import { DEFAULT_MOVE_PARAMS, makeMoveResult, moveCapsule } from '../physics/character.js';
import type { PhysicsWorld } from '../physics/world.js';
import { SurfaceFlags, hasFlag, isGrabbable, makeSurfaceQueryResult } from '../physics/types.js';
import type { SurfaceQueryResult } from '../physics/types.js';
import type { InputIntent } from '../input/intent.js';
import { Buttons, hasButton } from '../input/intent.js';
import type { SimEventQueue } from '../sim/events.js';
import type { HandState, PlayerState } from './state.js';
import { LEFT, RIGHT } from './state.js';

export interface LocomotionContext {
  world: PhysicsWorld;
  events: SimEventQueue;
  tick: number;
  /** Y below which a player is considered to have fallen out of the level. */
  killPlaneY: number;
}

/** Below this speed a grounded player is treated as stationary. */
const REST_SPEED = 0.05;

const _moveResult: MoveResult = makeMoveResult();
const _surface: SurfaceQueryResult = makeSurfaceQueryResult();
const _tmp = vec3();
const _tmp2 = vec3();
const _correction = vec3();
const _handWorld = vec3();
const _forward = vec3();
const _right = vec3();

/**
 * One fixed-step of player movement.
 *
 * The order matters and is deliberate:
 *   timers → look → hands (VR) → climb → locomotion → collide → post-effects.
 * Hands run before locomotion so that a hand anchor can veto gravity for the tick; climb runs
 * after hands so a VR player's hands win over the assisted climb used on flat platforms.
 */
export function stepPlayer(player: PlayerState, intent: InputIntent, ctx: LocomotionContext, dt: number): void {
  const cfg = player.config;

  advanceTimers(player, dt);

  player.yaw = intent.lookYaw;
  player.pitch = intent.lookPitch;
  player.headHeight = intent.headHeight || player.headHeight;

  directionsFromYaw(player.yaw);

  // Freezing takes away every way of moving under your own power, and there are three of them:
  // the assisted climb (gated here), the VR hand grip (gated in `updateHandPoses`, where both
  // input paths meet), and ground/air locomotion (gated in `applyGroundAndAir`). Missing any one
  // leaves a platform on which being frozen is merely inconvenient.
  const frozen = player.gadgets.frozen > 0;
  const grabLeft = hasButton(intent.buttons, Buttons.GrabLeft);
  const grabRight = hasButton(intent.buttons, Buttons.GrabRight);

  startPunchThrows(player, intent, frozen);
  updateHandPoses(player, intent, dt, grabLeft, grabRight);

  const handsAnchored = updateHandGrips(player, ctx);
  const handDriven = handsAnchored > 0;

  if (handDriven) {
    applyHandCorrection(player, handsAnchored, dt);
  } else {
    applyPalmPush(player, ctx, dt);
  }

  const climbing = updateClimb(player, intent, ctx, dt, !frozen && (grabLeft || grabRight), handDriven);

  const wantsJump = hasButton(intent.buttons, Buttons.Jump);
  if (wantsJump) player.jumpBufferTimer = cfg.jumpBufferTime;

  if (!handDriven && !climbing) {
    applyGroundAndAir(player, intent, ctx, dt, wantsJump);
  } else if (wantsJump && (climbing || handDriven)) {
    launchFromGrab(player, ctx, climbing);
  }

  clampVelocity(player);

  const wasGrounded = player.grounded;
  player.wasGrounded = wasGrounded;
  moveCapsule(
    ctx.world,
    player.position,
    player.velocity,
    { radius: cfg.radius, height: player.height },
    dt,
    DEFAULT_MOVE_PARAMS,
    _moveResult,
    wasGrounded,
  );

  applyCollisionResults(player, ctx, _moveResult, wasGrounded);
  updateDerived(player, ctx);
}

function advanceTimers(player: PlayerState, dt: number): void {
  player.coyoteTimer = Math.max(0, player.coyoteTimer - dt);
  player.jumpBufferTimer = Math.max(0, player.jumpBufferTimer - dt);
  player.staggerTimer = Math.max(0, player.staggerTimer - dt);
  player.invulnTimer = Math.max(0, player.invulnTimer - dt);
  player.tagCooldown = Math.max(0, player.tagCooldown - dt);
  player.emoteTimer = Math.max(0, player.emoteTimer - dt);
  if (player.emoteTimer === 0) player.emoteId = 0;
  for (const hand of player.hands) {
    hand.punchCooldown = Math.max(0, hand.punchCooldown - dt);
    hand.punchThrow = Math.max(0, hand.punchThrow - dt);
  }
}

function directionsFromYaw(yaw: number): void {
  v3set(_forward, Math.sin(yaw), 0, Math.cos(yaw));
  v3set(_right, Math.cos(yaw), 0, -Math.sin(yaw));
}

/** How long a synthesised punch takes to reach full extension, and to come back. */
const PUNCH_EXTEND = 0.09;
const PUNCH_RETRACT = 0.13;
/** How far in front of the chest a thrown punch reaches, in metres. */
const PUNCH_REACH = 0.92;
/** Resting reach of an idle hand; a held grab pulls it out to `GRAB_REACH`. */
const IDLE_REACH = 0.25;
const GRAB_REACH = 0.55;

/**
 * Turn the punch buttons into an arm that actually moves.
 *
 * `combat.ts` resolves a punch purely from hand velocity — it has to, because in VR the tracked
 * hand *is* the punch and there is no button to read. The comment there promised that "on
 * PC/Mobile the platform layer synthesises a hand thrust when the punch button is pressed", and
 * nothing anywhere did: `Buttons.PunchLeft` and `Buttons.PunchRight` were set by the PC and mobile
 * input layers and then read by no one.
 *
 * Measured before this existed: two players toe to toe for five seconds, one of them holding the
 * punch button — the victim finished on 100.0 of 100 health. Holding *grab* instead took them to
 * 84.3, and alternating it to 57.8, because grab is what extends the arm. So melee on two of the
 * three platforms was impossible on the button meant for it and an accident on the climbing
 * button. VR Boxing and the Conversion Duel bouts are built entirely on punching.
 */
function startPunchThrows(player: PlayerState, intent: InputIntent, frozen: boolean): void {
  // A VR player's hands are tracked, and their real motion already carries the punch; adding a
  // synthetic thrust on top would let a headset player punch with a button *and* their arm.
  if (intent.hands !== null || frozen) return;
  const wants = [
    hasButton(intent.buttons, Buttons.PunchLeft),
    hasButton(intent.buttons, Buttons.PunchRight),
  ];
  // Held rather than tapped is deliberate: the throw runs to completion and can only restart once
  // the combat cooldown has also expired, so holding the button throws at the weapon's own cadence
  // instead of once per press. Mashing cannot beat it, which is the point.
  const ready = (hand: HandState): boolean => hand.punchThrow <= 0 && hand.punchCooldown <= 0;
  for (let i = 0; i < 2; i++) {
    if (!wants[i]) continue;
    const own = player.hands[i] as HandState;
    if (ready(own)) {
      own.punchThrow = PUNCH_EXTEND + PUNCH_RETRACT;
      continue;
    }
    /**
     * The named hand is still recovering, so the punch goes to the other fist.
     *
     * PC and mobile have one punch button and it says `PunchRight`, so without this a player on
     * those platforms fights one-handed and spends every cooldown doing nothing, while a headset
     * player throws with both tracked hands and a bot alternates its own at random. Measured toe
     * to toe over eight seconds: one hand lands 13 punches, two land 20. That is a cross-play
     * matchup decided by which device someone owns, in the two modes built entirely on punching.
     *
     * Only once that hand has finished its throw and is merely cooling down, which is what makes
     * this a jab rather than a windmill. Falling back while it is still extending measured as
     * both fists leaving the body one tick apart and staying out for as long as the button was
     * held — the same two-fisted lockstep as pressing both bits, and nothing like a boxer.
     *
     * Skipped when the other bit is set too: that hand's own turn of this loop will claim it.
     */
    if (own.punchThrow > 0) continue;
    const other = player.hands[1 - i] as HandState;
    if (!wants[1 - i] && ready(other)) other.punchThrow = PUNCH_EXTEND + PUNCH_RETRACT;
  }
}

/**
 * How far out a synthesised punch has travelled, 0 at rest and 1 at full extension.
 *
 * Out fast and back slower, so the outward half clears the speed threshold that makes it a punch
 * and the return does not land a second free hit on the way home.
 */
function punchExtension(remaining: number): number {
  if (remaining <= 0) return 0;
  const elapsed = PUNCH_EXTEND + PUNCH_RETRACT - remaining;
  if (elapsed < PUNCH_EXTEND) return elapsed / PUNCH_EXTEND;
  return Math.max(0, 1 - (elapsed - PUNCH_EXTEND) / PUNCH_RETRACT);
}

/**
 * Convert body-local tracked hand poses into world space and derive world velocity.
 * Non-VR players get procedural hands so that avatars, punches and grabs still animate.
 */
function updateHandPoses(
  player: PlayerState,
  intent: InputIntent,
  dt: number,
  grabLeft: boolean,
  grabRight: boolean,
): void {
  const cfg = player.config;
  // Freezing has to reach the hands, and it has to reach them *here*: arms-first VR movement is
  // driven by the analogue grip rather than the grab button, so gating the buttons alone would
  // leave a frozen VR player free to pull themselves along — the one platform the effect matters
  // most on. This is the single place both input paths decide whether a hand is holding on.
  const frozen = player.gadgets.frozen > 0;
  for (let i = 0; i < 2; i++) {
    const hand = player.hands[i] as HandState;
    const source = intent.hands ? intent.hands[i] : null;
    v3copy(hand.prevWorld, hand.world);

    if (source && source.tracked) {
      hand.tracked = true;
      localToWorld(_handWorld, player.position, source.pos);
      v3copy(hand.world, _handWorld);
      hand.gripHeld = source.grip >= cfg.gripThreshold;
    } else {
      hand.tracked = false;
      const side = i === LEFT ? -1 : 1;
      const grabbing = i === LEFT ? grabLeft : grabRight;
      const thrust = punchExtension(hand.punchThrow);
      // A punch overrides the grab pose rather than adding to it, so a player climbing with one
      // hand and punching with it does not end up with a 1.5 m arm.
      const reach = Math.max(grabbing ? GRAB_REACH : IDLE_REACH, IDLE_REACH + thrust * (PUNCH_REACH - IDLE_REACH));
      // Punches land where the player is looking. PC and mobile aim with pitch, and without this
      // every non-VR punch would be a body shot — handing VR the 1.6× head multiplier as a
      // permanent platform advantage in the two modes built on fighting.
      // Positive pitch is up — the camera builds its forward vector as `sin(pitch)` on Y — so an
      // uppercut is a punch thrown while looking up.
      const aim = thrust > 0 ? Math.sin(player.pitch) * reach : 0;
      // Both shoulders swing inwards on a thrust: the fist travels to the centre line rather than
      // out past the opponent's shoulder, which is what a punch thrown at someone looks like.
      const lateral = 0.32 * (1 - thrust * 0.55);
      v3set(
        _tmp,
        _right.x * side * lateral + _forward.x * reach,
        player.height * 0.62 + aim,
        _right.z * side * lateral + _forward.z * reach,
      );
      v3set(hand.world, player.position.x + _tmp.x, player.position.y + _tmp.y, player.position.z + _tmp.z);
      hand.gripHeld = i === LEFT ? grabLeft : grabRight;
    }

    if (frozen) hand.gripHeld = false;

    if (dt > 0) {
      v3set(
        hand.velocity,
        (hand.world.x - hand.prevWorld.x) / dt,
        (hand.world.y - hand.prevWorld.y) / dt,
        (hand.world.z - hand.prevWorld.z) / dt,
      );
    }
  }
}

function localToWorld(out: Vec3, origin: Vec3, local: Vec3): Vec3 {
  return v3set(
    out,
    origin.x + _right.x * local.x + _forward.x * local.z,
    origin.y + local.y,
    origin.z + _right.z * local.x + _forward.z * local.z,
  );
}

/** Acquire / release hand anchors. Returns how many hands are anchored. */
function updateHandGrips(player: PlayerState, ctx: LocomotionContext): number {
  const cfg = player.config;
  let anchored = 0;
  for (let i = 0; i < 2; i++) {
    const hand = player.hands[i] as HandState;
    if (!hand.tracked) {
      // Non-VR hands never anchor here; the assisted climb system handles those platforms.
      hand.anchored = false;
      continue;
    }

    if (!hand.gripHeld && hand.anchored) {
      hand.anchored = false;
      hand.anchorCollider = -1;
      ctx.events.emit('release', player.id, hand.world, ctx.tick, v3length(hand.velocity), {
        data: i === LEFT ? 'left' : 'right',
      });
      continue;
    }

    if (hand.gripHeld && !hand.anchored) {
      ctx.world.closestSurface(_surface, hand.world, cfg.handGrabRadius, true);
      if (_surface.hit && isGrabbable(_surface.surface)) {
        hand.anchored = true;
        v3copy(hand.anchor, _surface.point);
        hand.anchorCollider = _surface.colliderIndex;
        hand.anchorMaterial = _surface.surface.material;
        ctx.events.emit('grab', player.id, hand.anchor, ctx.tick, 1, {
          material: _surface.surface.material,
          data: i === LEFT ? 'left' : 'right',
        });
      }
    }

    if (hand.anchored) {
      // Break the grip if the player's body has been dragged out of arm's reach.
      const dx = hand.anchor.x - player.position.x;
      const dy = hand.anchor.y - (player.position.y + player.height * 0.6);
      const dz = hand.anchor.z - player.position.z;
      if (dx * dx + dy * dy + dz * dz > 2.4 * 2.4) {
        hand.anchored = false;
        hand.anchorCollider = -1;
        ctx.events.emit('release', player.id, hand.world, ctx.tick, 0, { data: 'stretch' });
      } else {
        anchored++;
      }
    }
  }
  return anchored;
}

/**
 * The heart of VR locomotion.
 *
 * An anchored hand is fixed in world space, so any motion of the hand *relative to the body*
 * must be compensated by moving the body the other way. That single rule produces pushing off
 * walls, hauling yourself up a branch, and swinging — and the per-tick body displacement is
 * exactly the momentum the player keeps when they let go.
 */
function applyHandCorrection(player: PlayerState, anchoredCount: number, dt: number): void {
  const cfg = player.config;
  v3set(_correction, 0, 0, 0);

  for (const hand of player.hands) {
    if (!hand.anchored) continue;
    _correction.x += hand.anchor.x - hand.world.x;
    _correction.y += hand.anchor.y - hand.world.y;
    _correction.z += hand.anchor.z - hand.world.z;
  }

  const inv = 1 / anchoredCount;
  _correction.x *= inv;
  _correction.y *= inv;
  _correction.z *= inv;

  const strength = cfg.pushForce * (anchoredCount === 2 ? cfg.handTwoHandMultiplier : 1);
  _correction.x *= strength;
  _correction.y *= strength;
  _correction.z *= strength;

  const len = v3length(_correction);
  if (len > cfg.maxHandCorrection) {
    const s = cfg.maxHandCorrection / len;
    _correction.x *= s;
    _correction.y *= s;
    _correction.z *= s;
  }

  // Express the correction as velocity rather than teleporting the body: the collide-and-slide
  // pass then applies it, so a hand pull can never drag the player through geometry — and the
  // resulting velocity *is* the momentum the player keeps when they let go.
  if (dt > 0) {
    v3set(player.velocity, _correction.x / dt, _correction.y / dt, _correction.z / dt);
  }
  clampVelocity(player);

  // Anchored players still fall slightly if they hang without pulling: a little gravity keeps
  // hanging from feeling weightless, but not enough to rip the grip off.
  player.velocity.y -= cfg.gravity * 0.08 * dt;
  player.grounded = false;
  player.coyoteTimer = cfg.coyoteTime;
}

/** Palm push: shoving a surface with an open hand still moves you (no grip required). */
function applyPalmPush(player: PlayerState, ctx: LocomotionContext, dt: number): void {
  const cfg = player.config;
  for (const hand of player.hands) {
    if (!hand.tracked) continue;
    ctx.world.closestSurface(_surface, hand.world, cfg.handGrabRadius * 0.8, false);
    if (!_surface.hit) continue;
    const into = -v3dot(hand.velocity, _surface.normal);
    if (into < 1.2) continue;
    const scale = cfg.handPushForce * clamp01(into / 6) * (hasFlag(_surface.surface, SurfaceFlags.Slippery) ? 0.4 : 1);
    player.velocity.x += _surface.normal.x * into * scale * dt * 4;
    player.velocity.y += _surface.normal.y * into * scale * dt * 4;
    player.velocity.z += _surface.normal.z * into * scale * dt * 4;
  }
}

/**
 * Assisted climbing for PC/Mobile (and as a fallback in VR when hands are untracked).
 * It ends in the same anchored state VR hands produce, so animation and networking are shared.
 */
function updateClimb(
  player: PlayerState,
  intent: InputIntent,
  ctx: LocomotionContext,
  dt: number,
  grabHeld: boolean,
  handDriven: boolean,
): boolean {
  const cfg = player.config;

  if (handDriven || !grabHeld) {
    if (player.climbing) {
      player.climbing = false;
      player.climbCollider = -1;
      ctx.events.emit('release', player.id, player.position, ctx.tick, 0, { data: 'climb' });
    }
    return false;
  }

  const chestY = player.position.y + player.height * 0.62;
  if (!player.climbing) {
    v3set(
      _tmp,
      player.position.x + _forward.x * cfg.gripReach * 0.55,
      chestY,
      player.position.z + _forward.z * cfg.gripReach * 0.55,
    );
    ctx.world.closestSurface(_surface, _tmp, cfg.gripReach, true);
    if (!_surface.hit) return false;
    player.climbing = true;
    v3copy(player.climbAnchor, _surface.point);
    v3copy(player.climbNormal, _surface.normal);
    player.climbCollider = _surface.colliderIndex;
    ctx.events.emit('grab', player.id, player.climbAnchor, ctx.tick, 1, {
      material: _surface.surface.material,
      data: 'climb',
    });
  }

  // Slide the anchor across the surface with the movement stick, then re-project it so the
  // anchor always stays exactly on geometry (this is what lets you climb around a tree trunk).
  const tangentUpY = 1 - Math.abs(player.climbNormal.y);
  v3set(
    _tmp2,
    -player.climbNormal.z,
    0,
    player.climbNormal.x,
  );
  v3normalize(_tmp2, _tmp2);

  const climbStep = cfg.climbSpeed * dt;
  v3set(
    _tmp,
    player.climbAnchor.x + _tmp2.x * intent.moveX * climbStep,
    player.climbAnchor.y + intent.moveZ * climbStep * Math.max(0.35, tangentUpY),
    player.climbAnchor.z + _tmp2.z * intent.moveX * climbStep,
  );

  ctx.world.closestSurface(_surface, _tmp, cfg.gripReach, true);
  if (_surface.hit) {
    v3copy(player.climbAnchor, _surface.point);
    v3copy(player.climbNormal, _surface.normal);
    player.climbCollider = _surface.colliderIndex;
  } else {
    // Climbed off the top edge: convert into a mantle.
    player.climbing = false;
    player.climbCollider = -1;
    player.velocity.y = Math.max(player.velocity.y, cfg.jumpForce * 0.55);
    player.velocity.x += _forward.x * 2.4;
    player.velocity.z += _forward.z * 2.4;
    ctx.events.emit('climbLaunch', player.id, player.position, ctx.tick, 0.5, { data: 'mantle' });
    return false;
  }

  // Hold the body just below and off the anchor.
  const targetX = player.climbAnchor.x + player.climbNormal.x * (cfg.radius + 0.05);
  const targetY = player.climbAnchor.y - player.height * 0.58;
  const targetZ = player.climbAnchor.z + player.climbNormal.z * (cfg.radius + 0.05);

  const maxPull = cfg.climbSpeed * 2.5;
  v3set(
    player.velocity,
    clamp((targetX - player.position.x) / dt, -maxPull, maxPull),
    clamp((targetY - player.position.y) / dt, -maxPull, maxPull),
    clamp((targetZ - player.position.z) / dt, -maxPull, maxPull),
  );
  player.grounded = false;
  player.coyoteTimer = cfg.coyoteTime;
  return true;
}

/** Jumping off a grip (hand anchor or assisted climb) — the swing-and-launch trick. */
function launchFromGrab(player: PlayerState, ctx: LocomotionContext, climbing: boolean): void {
  const cfg = player.config;
  player.jumpBufferTimer = 0;

  let dirX = _forward.x;
  let dirZ = _forward.z;
  if (climbing) {
    dirX = player.climbNormal.x !== 0 || player.climbNormal.z !== 0 ? player.climbNormal.x : _forward.x;
    dirZ = player.climbNormal.z !== 0 || player.climbNormal.x !== 0 ? player.climbNormal.z : _forward.z;
    player.climbing = false;
    player.climbCollider = -1;
  }
  for (const hand of player.hands) {
    hand.anchored = false;
    hand.anchorCollider = -1;
  }

  // Existing velocity (from swinging) is preserved and added to, not replaced.
  player.velocity.x += dirX * cfg.climbLaunchForce * 0.55;
  player.velocity.z += dirZ * cfg.climbLaunchForce * 0.55;
  player.velocity.y = Math.max(player.velocity.y + cfg.climbLaunchForce * 0.55, cfg.jumpForce * 0.85);
  clampVelocity(player);
  ctx.events.emit('climbLaunch', player.id, player.position, ctx.tick, v3length(player.velocity), {
    data: climbing ? 'climb' : 'hands',
  });
}

/** Grounded acceleration, hop charging, air control, wall jumps. */
function applyGroundAndAir(
  player: PlayerState,
  intent: InputIntent,
  ctx: LocomotionContext,
  dt: number,
  wantsJump: boolean,
): void {
  const cfg = player.config;
  const staggered = player.staggerTimer > 0;
  // Freeze removes control outright; a snare only halves it. Both are gadget effects and both
  // scale the *same* control factor a stagger uses, so they compose instead of fighting: being
  // snared while staggered is worse than either alone, which is what a player would expect.
  const status = player.gadgets;
  const frozen = status.frozen > 0;
  const snareControl = status.snared > 0 ? 1 - status.snareSlow : 1;
  const control = frozen ? 0 : (staggered ? cfg.staggerControl : 1) * snareControl;

  if (frozen) {
    // Not just "no input": a frozen player keeps falling but stops moving horizontally, so
    // freezing someone mid-jump drops them where they were rather than launching them onward.
    player.velocity.x = 0;
    player.velocity.z = 0;
    player.sprinting = false;
    return;
  }

  player.crouching = hasButton(intent.buttons, Buttons.Crouch) || (intent.hands !== null && intent.headHeight < 1.15);
  player.sprinting =
    hasButton(intent.buttons, Buttons.Sprint) && player.stamina > 5 && !player.crouching && player.grounded;

  const targetHeight = player.crouching ? cfg.crouchHeight : cfg.standHeight;
  player.height += (targetHeight - player.height) * Math.min(1, dt * 12);

  if (player.sprinting) player.stamina = Math.max(0, player.stamina - 14 * dt);
  else player.stamina = Math.min(100, player.stamina + 9 * dt);

  // Desired horizontal direction in world space.
  const wishX = _right.x * intent.moveX + _forward.x * intent.moveZ;
  const wishZ = _right.z * intent.moveX + _forward.z * intent.moveZ;
  const wishLen = Math.hypot(wishX, wishZ);
  const nx = wishLen > 1e-4 ? wishX / wishLen : 0;
  const nz = wishLen > 1e-4 ? wishZ / wishLen : 0;
  const throttle = Math.min(1, wishLen);

  const speedCap =
    cfg.maxSpeed * (player.sprinting ? cfg.sprintMultiplier : 1) * (player.crouching ? 0.55 : 1);

  // Hop charging: holding jump on the ground compresses the kangaroo and slows it down.
  if (player.grounded && wantsJump) {
    player.chargeHeld = true;
    player.charge = clamp01(player.charge + dt / cfg.maxChargeTime);
  }

  const accel = (player.grounded ? cfg.acceleration : cfg.acceleration * cfg.airControl) * control;
  const chargeSlow = player.grounded && player.chargeHeld ? 1 - player.charge * 0.65 : 1;

  if (throttle > 0.02) {
    const currentAlong = player.velocity.x * nx + player.velocity.z * nz;
    const cap = speedCap * throttle * chargeSlow;
    if (currentAlong < cap) {
      const add = Math.min(accel * dt * throttle, cap - currentAlong);
      player.velocity.x += nx * add;
      player.velocity.z += nz * add;
    }
  } else if (player.grounded) {
    const friction = cfg.friction * cfg.surfaceFriction * frictionOfGround(player) * dt;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    if (speed > REST_SPEED) {
      const drop = Math.min(speed, friction);
      const s = (speed - drop) / speed;
      player.velocity.x *= s;
      player.velocity.z *= s;
    } else {
      // Snap to rest. A standing player that never quite stops costs network bandwidth every
      // snapshot and makes idle animations twitch.
      player.velocity.x = 0;
      player.velocity.z = 0;
    }
  }

  // Gravity.
  player.velocity.y -= cfg.gravity * dt;

  const canJump = player.grounded || player.coyoteTimer > 0;
  const releasedJump = player.chargeHeld && !wantsJump;

  if (canJump && (releasedJump || (player.jumpBufferTimer > 0 && !wantsJump))) {
    doJump(player, ctx, nx, nz);
  } else if (canJump && wantsJump && player.charge >= 1) {
    doJump(player, ctx, nx, nz); // full charge auto-releases
  } else if (!player.grounded && player.touchingWall && wantsJump && player.jumpBufferTimer > 0) {
    doWallJump(player, ctx);
  }

  if (!wantsJump) {
    player.chargeHeld = false;
    if (player.grounded) player.charge = Math.max(0, player.charge - dt * 3);
  }
}

/**
 * How much grip the ground gives, as a multiplier on the player's own friction.
 *
 * This used to read `groundMaterial === 'water' ? 0.4 : 1`, which meant every solid surface in the
 * game decelerated identically. Surfaces have declared a `friction` since the level builder existed
 * — ice 0.35, glazed ice 0.28, snow 1.05, sand 1.15 — and `MovementConfig.friction` has always been
 * documented as "scaled by the surface's friction". Nothing scaled it. Measured as a coast from
 * full speed, ice and dirt both stopped in 1.7916666666666679 m — identical to the last digit — so
 * Glacier World, a map whose entire premise is that you cannot stop on ice, played exactly like
 * the jungle.
 *
 * The water special case is gone rather than kept beside it: the `water` preset declares 0.3, which
 * is what the hard-coded 0.4 was approximating, so reading the data covers that case too and one
 * rule now explains every surface in the game.
 */
function frictionOfGround(player: PlayerState): number {
  const friction = player.groundFriction;
  // A malformed collider must not divide a player's braking by zero or reverse it into
  // acceleration; an unknown surface behaves like ordinary ground.
  return Number.isFinite(friction) && friction > 0 ? friction : 1;
}

function doJump(player: PlayerState, ctx: LocomotionContext, dirX: number, dirZ: number): void {
  const cfg = player.config;
  const charge = player.charge;
  const vertical = cfg.jumpForce * (1 + charge * cfg.chargeJumpBoost) * (player.crouching ? 1.08 : 1);
  player.velocity.y = vertical;

  // Long jump: charge converts existing momentum into distance rather than height.
  const speed = Math.hypot(player.velocity.x, player.velocity.z);
  const forwardBoost = cfg.longJumpBoost * charge * (2 + speed * 0.35);
  player.velocity.x += dirX * forwardBoost;
  player.velocity.z += dirZ * forwardBoost;

  player.grounded = false;
  player.coyoteTimer = 0;
  player.jumpBufferTimer = 0;
  player.charge = 0;
  player.chargeHeld = false;
  clampVelocity(player);
  ctx.events.emit('jump', player.id, player.position, ctx.tick, charge, { material: player.groundMaterial });
}

function doWallJump(player: PlayerState, ctx: LocomotionContext): void {
  const cfg = player.config;
  player.velocity.x += player.wallNormal.x * cfg.wallJumpHorizontal;
  player.velocity.z += player.wallNormal.z * cfg.wallJumpHorizontal;
  player.velocity.y = Math.max(player.velocity.y, cfg.wallJumpForce);
  player.jumpBufferTimer = 0;
  player.touchingWall = false;
  clampVelocity(player);
  ctx.events.emit('jump', player.id, player.position, ctx.tick, 1, { data: 'wall' });
}

function applyCollisionResults(
  player: PlayerState,
  ctx: LocomotionContext,
  result: MoveResult,
  wasGrounded: boolean,
): void {
  const cfg = player.config;
  player.grounded = result.grounded;
  player.touchingWall = result.touchedWall;
  if (result.grounded) {
    v3copy(player.groundNormal, result.groundNormal);
    player.groundMaterial = result.groundSurface.material;
    player.groundFriction = result.groundSurface.friction;
    player.coyoteTimer = cfg.coyoteTime;
  } else if (wasGrounded) {
    player.coyoteTimer = cfg.coyoteTime;
  }

  if (result.touchedWall) {
    v3copy(player.wallNormal, result.wallNormal);
    // Wall bounce: fast horizontal impacts throw you back off the surface instead of stopping.
    const restitution = Math.max(cfg.wallBounceRestitution, result.wallSurface.bounciness);
    if (result.wallImpactSpeed >= cfg.wallBounceMinSpeed && !player.grounded) {
      const bounce = result.wallImpactSpeed * restitution;
      player.velocity.x += result.wallNormal.x * bounce;
      player.velocity.z += result.wallNormal.z * bounce;
      player.velocity.y = Math.max(player.velocity.y, bounce * 0.35);
      clampVelocity(player);
      ctx.events.emit('wallBounce', player.id, player.position, ctx.tick, result.wallImpactSpeed, {
        material: result.wallSurface.material,
      });
    }
  }

  if (result.grounded && !wasGrounded) {
    const impact = result.landImpactSpeed;
    ctx.events.emit('land', player.id, player.position, ctx.tick, impact, {
      material: result.groundSurface.material,
    });
    if (impact > cfg.staggerLandingSpeed) {
      // Tail balance turns a crash landing into a quick recovery.
      const severity = (impact - cfg.staggerLandingSpeed) / cfg.staggerLandingSpeed;
      player.staggerTimer = cfg.staggerDuration * severity * (1 - cfg.tailBalance * 0.8);
      if (player.staggerTimer > 0.02) {
        ctx.events.emit('stagger', player.id, player.position, ctx.tick, severity);
      }
    }
    if (hasFlag(result.groundSurface, SurfaceFlags.Bouncy)) {
      player.velocity.y = Math.max(cfg.jumpForce * 1.35, impact * 0.9);
      player.grounded = false;
      ctx.events.emit('jump', player.id, player.position, ctx.tick, 1, { data: 'bouncy' });
    }
  }
}

function updateDerived(player: PlayerState, ctx: LocomotionContext): void {
  const cfg = player.config;
  if (player.grounded && player.velocity.y < 0 && player.velocity.y > -REST_SPEED) player.velocity.y = 0;
  const headY = player.hands[0].tracked || player.hands[1].tracked ? player.headHeight : player.height * cfg.headHeightRatio;
  v3set(player.head, player.position.x, player.position.y + headY, player.position.z);
  if (player.position.y < ctx.killPlaneY) {
    player.alive = false;
  }
}

export function clampVelocity(player: PlayerState): void {
  const cfg = player.config;
  const horiz = Math.hypot(player.velocity.x, player.velocity.z);
  if (horiz > cfg.maxHorizontalSpeed) {
    const s = cfg.maxHorizontalSpeed / horiz;
    player.velocity.x *= s;
    player.velocity.z *= s;
  }
  player.velocity.y = clamp(player.velocity.y, -cfg.terminalVelocity, cfg.terminalVelocity);
  if (!Number.isFinite(player.velocity.x)) player.velocity.x = 0;
  if (!Number.isFinite(player.velocity.y)) player.velocity.y = 0;
  if (!Number.isFinite(player.velocity.z)) player.velocity.z = 0;
}

export { LEFT, RIGHT };
