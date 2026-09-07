import type { Vec3 } from '../math/vec3.js';

/**
 * Surface behaviour flags (bitmask). Level data sets these per collider; movement, climbing and
 * VR hand physics all read them, which is why they live in physics rather than in gameplay.
 */
export const SurfaceFlags = {
  None: 0,
  /** Hands and the climb system may anchor here. */
  Climbable: 1 << 0,
  /** Low friction — ice, wet rock. */
  Slippery: 1 << 1,
  /** Restitution boost — mushrooms, vines, trampolines. */
  Bouncy: 1 << 2,
  /** Explicitly rejects grabs even if otherwise climbable (smooth walls). */
  NoGrip: 1 << 3,
  /** Slows movement and damps hops. */
  Water: 1 << 4,
  /** One-way platform: only blocks from above. */
  OneWay: 1 << 5,
} as const;

export type SurfaceFlagMask = number;

export type SurfaceMaterial =
  | 'dirt'
  | 'rock'
  | 'wood'
  | 'foliage'
  | 'water'
  | 'metal'
  | 'sand'
  | 'stone';

export interface SurfaceProps {
  /** 0 = ice, 1 = grippy rubber. Scales ground deceleration. */
  friction: number;
  /** 0 = dead stop, 1 = perfect bounce. Used by wall bounce and landing. */
  bounciness: number;
  flags: SurfaceFlagMask;
  material: SurfaceMaterial;
}

export const DEFAULT_SURFACE: SurfaceProps = {
  friction: 1,
  bounciness: 0,
  flags: SurfaceFlags.Climbable,
  material: 'dirt',
};

export interface ColliderBase {
  /** Stable index inside the level, used by network events and audio lookups. */
  id: number;
  surface: SurfaceProps;
  /** Optional zone tag ("jungle", "cave", "canyon") for ambience and analytics. */
  zone?: string;
}

export interface BoxCollider extends ColliderBase {
  kind: 'box';
  center: Vec3;
  /** Half extents in local space. */
  half: Vec3;
  /** Rotation around Y only — enough for level geometry and keeps the solver cheap. */
  yaw: number;
}

export interface SphereCollider extends ColliderBase {
  kind: 'sphere';
  center: Vec3;
  radius: number;
}

/** Vertical cylinder — tree trunks, pillars, mushroom stems. */
export interface CylinderCollider extends ColliderBase {
  kind: 'cylinder';
  center: Vec3;
  radius: number;
  halfHeight: number;
}

export type Collider = BoxCollider | SphereCollider | CylinderCollider;

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface SurfaceQueryResult {
  hit: boolean;
  /** Index into PhysicsWorld.colliders, -1 when nothing was found. */
  colliderIndex: number;
  point: Vec3;
  /** Points away from the surface, toward the query point. */
  normal: Vec3;
  /** Signed: negative when the query point is inside the collider. */
  distance: number;
  surface: SurfaceProps;
}

export function makeSurfaceQueryResult(): SurfaceQueryResult {
  return {
    hit: false,
    colliderIndex: -1,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    distance: Infinity,
    surface: DEFAULT_SURFACE,
  };
}

export interface RaycastResult {
  hit: boolean;
  colliderIndex: number;
  point: Vec3;
  normal: Vec3;
  distance: number;
  surface: SurfaceProps;
}

export function makeRaycastResult(): RaycastResult {
  return {
    hit: false,
    colliderIndex: -1,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    distance: Infinity,
    surface: DEFAULT_SURFACE,
  };
}

export function hasFlag(surface: SurfaceProps, flag: number): boolean {
  return (surface.flags & flag) !== 0;
}

export function isGrabbable(surface: SurfaceProps): boolean {
  return hasFlag(surface, SurfaceFlags.Climbable) && !hasFlag(surface, SurfaceFlags.NoGrip);
}
