import type { Vec3 } from '../math/vec3.js';
import { v3copy, v3dot, v3set, v3zero } from '../math/vec3.js';
import { closestPointSegmentCollider } from './geometry.js';
import type { Collider, SurfaceProps } from './types.js';
import { DEFAULT_SURFACE, SurfaceFlags, hasFlag } from './types.js';
import type { PhysicsWorld } from './world.js';

export interface CapsuleShape {
  radius: number;
  /** Total standing height, feet at `position`. */
  height: number;
}

export interface MoveParams {
  /** Cosine of the steepest walkable slope (≈0.6 → 53°). */
  minGroundNormalY: number;
  /** Contact tolerance; keeps the capsule from jittering between touching and not. */
  skin: number;
  /** Vertical distance probed below the feet for ground contact. */
  groundProbe: number;
  /** Maximum ledge height that is climbed automatically while grounded. */
  stepOffset: number;
  /** Max depenetration passes per substep. */
  maxIterations: number;
}

export const DEFAULT_MOVE_PARAMS: MoveParams = {
  minGroundNormalY: 0.6,
  skin: 0.02,
  groundProbe: 0.12,
  stepOffset: 0.45,
  maxIterations: 4,
};

export interface MoveResult {
  grounded: boolean;
  groundNormal: Vec3;
  groundColliderIndex: number;
  groundSurface: SurfaceProps;
  touchedWall: boolean;
  wallNormal: Vec3;
  wallColliderIndex: number;
  wallSurface: SurfaceProps;
  /** Speed removed by the wall contact this move — drives wall-bounce and impact audio. */
  wallImpactSpeed: number;
  /** Downward speed removed by the ground contact — drives landing audio/animation. */
  landImpactSpeed: number;
  touchedCeiling: boolean;
}

export function makeMoveResult(): MoveResult {
  return {
    grounded: false,
    groundNormal: { x: 0, y: 1, z: 0 },
    groundColliderIndex: -1,
    groundSurface: DEFAULT_SURFACE,
    touchedWall: false,
    wallNormal: { x: 0, y: 0, z: 0 },
    wallColliderIndex: -1,
    wallSurface: DEFAULT_SURFACE,
    wallImpactSpeed: 0,
    landImpactSpeed: 0,
    touchedCeiling: false,
  };
}

const _p0: Vec3 = { x: 0, y: 0, z: 0 };
const _p1: Vec3 = { x: 0, y: 0, z: 0 };
const _onSeg: Vec3 = { x: 0, y: 0, z: 0 };
const _onCol: Vec3 = { x: 0, y: 0, z: 0 };
const _normal: Vec3 = { x: 0, y: 0, z: 0 };
const _probePos: Vec3 = { x: 0, y: 0, z: 0 };
const _savedPos: Vec3 = { x: 0, y: 0, z: 0 };
const _savedVel: Vec3 = { x: 0, y: 0, z: 0 };

function capsuleSegment(position: Vec3, shape: CapsuleShape): void {
  v3set(_p0, position.x, position.y + shape.radius, position.z);
  v3set(_p1, position.x, position.y + Math.max(shape.height - shape.radius, shape.radius), position.z);
}

/**
 * Kinematic capsule move: integrate, then resolve penetration and slide.
 *
 * Discrete-with-substeps rather than continuous sweeps: hop speeds stay under
 * `radius * 0.75` per substep so tunnelling can't happen, and the maths stays simple enough to
 * run identically (bit-for-bit within float tolerance) on server and client.
 *
 * `position` and `velocity` are mutated in place; `out` receives the contact summary.
 */
export function moveCapsule(
  world: PhysicsWorld,
  position: Vec3,
  velocity: Vec3,
  shape: CapsuleShape,
  dt: number,
  params: MoveParams,
  out: MoveResult,
  wasGrounded: boolean,
): MoveResult {
  out.grounded = false;
  out.groundColliderIndex = -1;
  out.touchedWall = false;
  out.wallColliderIndex = -1;
  out.wallImpactSpeed = 0;
  out.landImpactSpeed = 0;
  out.touchedCeiling = false;
  v3set(out.groundNormal, 0, 1, 0);
  v3zero(out.wallNormal);

  const entryVelocityY = velocity.y;
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const maxStepDistance = shape.radius * 0.75;
  const substeps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / maxStepDistance)));
  const subDt = dt / substeps;

  for (let s = 0; s < substeps; s++) {
    v3copy(_savedPos, position);
    v3copy(_savedVel, velocity);

    position.x += velocity.x * subDt;
    position.y += velocity.y * subDt;
    position.z += velocity.z * subDt;

    const blocked = resolve(world, position, velocity, shape, params, out);

    // Auto step-up: if a low obstacle blocked us while grounded, lift and retry once.
    if (blocked && (wasGrounded || out.grounded) && params.stepOffset > 0) {
      v3copy(_probePos, _savedPos);
      _probePos.y += params.stepOffset;
      _probePos.x += _savedVel.x * subDt;
      _probePos.z += _savedVel.z * subDt;
      if (!overlaps(world, _probePos, shape, params)) {
        v3copy(position, _probePos);
        velocity.x = _savedVel.x;
        velocity.z = _savedVel.z;
        if (velocity.y < 0) velocity.y = 0;
        resolve(world, position, velocity, shape, params, out);
      }
    }
  }

  probeGround(world, position, velocity, shape, params, out, wasGrounded);
  // Landing speed is taken from the velocity we entered the tick with: a capsule that comes to
  // rest exactly on the surface registers no penetration, yet the player still just landed.
  if (out.grounded && !wasGrounded && entryVelocityY < 0) {
    out.landImpactSpeed = Math.max(out.landImpactSpeed, -entryVelocityY);
  }
  return out;
}

/** One depenetration pass set. Returns true when a wall-like contact blocked horizontal motion. */
function resolve(
  world: PhysicsWorld,
  position: Vec3,
  velocity: Vec3,
  shape: CapsuleShape,
  params: MoveParams,
  out: MoveResult,
): boolean {
  let blocked = false;
  for (let iter = 0; iter < params.maxIterations; iter++) {
    capsuleSegment(position, shape);
    let deepest = 0;
    let hitIndex = -1;
    let hitSurface: SurfaceProps = DEFAULT_SURFACE;
    let nx = 0;
    let ny = 0;
    let nz = 0;

    world.queryCapsule(_p0, _p1, shape.radius, (index, collider) => {
      if (!shouldCollide(collider, position, velocity, shape)) return;
      const res = closestPointSegmentCollider(_onSeg, _onCol, _normal, _p0, _p1, collider);
      const penetration = shape.radius - res.distance;
      if (penetration <= params.skin * 0.5) return;
      if (penetration > deepest) {
        deepest = penetration;
        hitIndex = index;
        hitSurface = collider.surface;
        nx = _normal.x;
        ny = _normal.y;
        nz = _normal.z;
      }
    });

    if (hitIndex < 0) break;

    const push = deepest + params.skin * 0.5;
    position.x += nx * push;
    position.y += ny * push;
    position.z += nz * push;

    const into = velocity.x * nx + velocity.y * ny + velocity.z * nz;
    if (into < 0) {
      if (ny >= params.minGroundNormalY) {
        out.grounded = true;
        v3set(out.groundNormal, nx, ny, nz);
        out.groundColliderIndex = hitIndex;
        out.groundSurface = hitSurface;
        out.landImpactSpeed = Math.max(out.landImpactSpeed, -into);
      } else if (ny < -0.5) {
        out.touchedCeiling = true;
      } else {
        blocked = true;
        out.touchedWall = true;
        v3set(out.wallNormal, nx, ny, nz);
        out.wallColliderIndex = hitIndex;
        out.wallSurface = hitSurface;
        out.wallImpactSpeed = Math.max(out.wallImpactSpeed, -into);
      }
      // Remove the component going into the surface: this is what makes the capsule slide.
      velocity.x -= nx * into;
      velocity.y -= ny * into;
      velocity.z -= nz * into;
    }
  }
  return blocked;
}

function overlaps(world: PhysicsWorld, position: Vec3, shape: CapsuleShape, params: MoveParams): boolean {
  capsuleSegment(position, shape);
  let hit = false;
  world.queryCapsule(_p0, _p1, shape.radius, (_index, collider) => {
    if (hit) return;
    if (hasFlag(collider.surface, SurfaceFlags.OneWay)) return;
    const res = closestPointSegmentCollider(_onSeg, _onCol, _normal, _p0, _p1, collider);
    if (shape.radius - res.distance > params.skin) hit = true;
  });
  return hit;
}

/**
 * Ground probe. Extending the capsule downward by `groundProbe` keeps `grounded` stable while
 * hopping down slopes and stairs, which is what stops the "floaty kangaroo" feel.
 */
function probeGround(
  world: PhysicsWorld,
  position: Vec3,
  velocity: Vec3,
  shape: CapsuleShape,
  params: MoveParams,
  out: MoveResult,
  wasGrounded: boolean,
): void {
  if (velocity.y > 0.5) return;
  const probe = wasGrounded ? params.groundProbe + params.stepOffset * 0.5 : params.groundProbe;
  v3set(_p0, position.x, position.y + shape.radius - probe, position.z);
  v3set(_p1, position.x, position.y + Math.max(shape.height - shape.radius, shape.radius), position.z);

  let bestNy = out.grounded ? out.groundNormal.y : 0;
  let bestIndex = out.groundColliderIndex;
  let bestSurface = out.groundSurface;
  let bestNormalX = out.groundNormal.x;
  let bestNormalZ = out.groundNormal.z;
  let snapY = Number.NEGATIVE_INFINITY;

  world.queryCapsule(_p0, _p1, shape.radius, (index, collider) => {
    if (!shouldCollide(collider, position, velocity, shape)) return;
    const res = closestPointSegmentCollider(_onSeg, _onCol, _normal, _p0, _p1, collider);
    if (shape.radius - res.distance <= 0) return;
    if (_normal.y < params.minGroundNormalY) return;
    if (_normal.y > bestNy) {
      bestNy = _normal.y;
      bestNormalX = _normal.x;
      bestNormalZ = _normal.z;
      bestIndex = index;
      bestSurface = collider.surface;
    }
    snapY = Math.max(snapY, _onCol.y);
  });

  if (bestIndex >= 0 && bestNy >= params.minGroundNormalY) {
    out.grounded = true;
    v3set(out.groundNormal, bestNormalX, bestNy, bestNormalZ);
    out.groundColliderIndex = bestIndex;
    out.groundSurface = bestSurface;
    if (wasGrounded && velocity.y <= 0 && snapY > Number.NEGATIVE_INFINITY) {
      // Snap in both directions. Correcting only downwards leaves a grounded player sinking a
      // few millimetres per tick (too shallow for the depenetration pass to notice), which both
      // looks wrong and makes every idle player dirty in the network delta.
      const target = snapY;
      if (Math.abs(position.y - target) <= probe + params.skin) {
        position.y = target;
        if (velocity.y < 0) velocity.y = 0;
      }
    }
  }
}

/** One-way platforms only block a capsule that is above them and descending. */
function shouldCollide(collider: Collider, position: Vec3, velocity: Vec3, shape: CapsuleShape): boolean {
  if (!hasFlag(collider.surface, SurfaceFlags.OneWay)) return true;
  if (velocity.y > 0.01) return false;
  const top =
    collider.kind === 'box'
      ? collider.center.y + collider.half.y
      : collider.kind === 'cylinder'
        ? collider.center.y + collider.halfHeight
        : collider.center.y + collider.radius;
  return position.y >= top - shape.radius * 0.25;
}

/** Test whether a capsule at `position` would be free of geometry — used for spawn selection. */
export function capsuleFits(
  world: PhysicsWorld,
  position: Vec3,
  shape: CapsuleShape,
  params: MoveParams = DEFAULT_MOVE_PARAMS,
): boolean {
  return !overlaps(world, position, shape, params);
}

/** Signed slope angle (radians) of a ground normal. */
export function slopeAngle(normal: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, v3dot(normal, { x: 0, y: 1, z: 0 }))));
}
