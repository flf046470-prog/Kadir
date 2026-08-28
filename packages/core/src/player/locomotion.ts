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

  const grabLeft = hasButton(intent.buttons, Buttons.GrabLeft);
  const grabRight = hasButton(intent.buttons, Buttons.GrabRight);

  updateHandPoses(player, intent, dt, grabLeft, grabRight);

  const handsAnchored = updateHandGrips(player, ctx);
  const handDriven = handsAnchored > 0;

  if (handDriven) {
    applyHandCorrection(player, handsAnchored, dt);
  } else {
    applyPalmPush(player, ctx, dt);
  }

  const climbing = updateClimb(player, intent, ctx, dt, grabLeft || grabRight, handDriven);

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
  for (const hand of player.hands) hand.punchCooldown = Math.max(0, hand.punchCooldown - dt);
}

function directionsFromYaw(yaw: number): void {
  v3set(_forward, Math.sin(yaw), 0, Math.cos(yaw));
  v3set(_right, Math.cos(yaw), 0, -Math.sin(yaw));
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
      const reach = i === LEFT ? (grabLeft ? 0.55 : 0.25) : grabRight ? 0.55 : 0.25;
      v3set(
        _tmp,
        _right.x * side * 0.32 + _forward.x * reach,
        player.height * 0.62,
        _right.z * side * 0.32 + _forward.z * reach,
      );
      v3set(hand.world, player.position.x + _tmp.x, player.position.y + _tmp.y, player.position.z + _tmp.z);
      hand.gripHeld = i === LEFT ? grabLeft : grabRight;
    }

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
  const control = staggered ? cfg.staggerControl : 1;

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

function frictionOfGround(player: PlayerState): number {
  return player.groundMaterial === 'water' ? 0.4 : 1;
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
