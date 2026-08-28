import type { Vec3 } from '../math/vec3.js';
import type { Collider, SurfaceMaterial } from '../physics/types.js';

/**
 * A level is *plain data*. Nothing here references a renderer, so the server loads the same
 * definition the client renders, and a future community map editor only has to emit this shape.
 */
export interface SpawnPoint {
  position: Vec3;
  yaw: number;
  zone: string;
  /** "chaser" spawns are used for the tagging roles; "start" is the parkour line. */
  tag?: 'runner' | 'chaser' | 'start' | 'lobby';
}

export type GripKind = 'branch' | 'ledge' | 'vine' | 'rock' | 'root';

/** Explicit, authored grab points. Surfaces are also grabbable, but grips are highlighted. */
export interface GripDef {
  position: Vec3;
  normal: Vec3;
  kind: GripKind;
}

export interface CheckpointDef {
  index: number;
  position: Vec3;
  radius: number;
  /** Final checkpoint closes the lap. */
  finish?: boolean;
}

export interface ZoneDef {
  name: string;
  center: Vec3;
  radius: number;
  ambience: 'jungle' | 'cave' | 'canyon' | 'waterfall' | 'village' | 'lobby';
  /** 0..1 fog/darkness hint for the client. */
  darkness: number;
}

export type PropKind =
  | 'tree'
  | 'palm'
  | 'bush'
  | 'rock'
  | 'boulder'
  | 'mushroom'
  | 'vine'
  | 'log'
  | 'stalagmite'
  | 'crystal'
  | 'banner'
  | 'torch'
  | 'flower';

/** Visual-only instance. Colliders are separate so art can change without touching gameplay. */
export interface PropInstance {
  kind: PropKind;
  position: Vec3;
  yaw: number;
  scale: number;
  /** Palette index into the level's colour ramp — keeps instancing cheap. */
  tint: number;
}

export interface LevelDef {
  id: string;
  name: string;
  version: number;
  /** Seed used to build it — clients verify they generated the same world as the server. */
  seed: number;
  colliders: Collider[];
  spawns: SpawnPoint[];
  grips: GripDef[];
  checkpoints: CheckpointDef[];
  zones: ZoneDef[];
  props: PropInstance[];
  killPlaneY: number;
  /** Playable radius from origin; used for out-of-bounds warnings and interest management. */
  playRadius: number;
  ambientColor: number;
  skyColor: number;
  fogDensity: number;
}

export interface LevelStats {
  colliders: number;
  props: number;
  grips: number;
  spawns: number;
  checkpoints: number;
  materials: Record<string, number>;
}

export function levelStats(level: LevelDef): LevelStats {
  const materials: Record<string, number> = {};
  for (const collider of level.colliders) {
    const key: SurfaceMaterial = collider.surface.material;
    materials[key] = (materials[key] ?? 0) + 1;
  }
  return {
    colliders: level.colliders.length,
    props: level.props.length,
    grips: level.grips.length,
    spawns: level.spawns.length,
    checkpoints: level.checkpoints.length,
    materials,
  };
}

/** Cheap structural fingerprint — client and server compare it before a match starts. */
export function levelFingerprint(level: LevelDef): string {
  let hash = 2166136261 >>> 0;
  const mix = (n: number): void => {
    hash ^= Math.round(n * 100) | 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  };
  mix(level.seed);
  mix(level.version);
  mix(level.colliders.length);
  mix(level.props.length);
  for (const collider of level.colliders) {
    mix(collider.center.x);
    mix(collider.center.y);
    mix(collider.center.z);
  }
  return `${level.id}:${(hash >>> 0).toString(36)}`;
}

export function findSpawns(level: LevelDef, tag: SpawnPoint['tag']): SpawnPoint[] {
  const matching = level.spawns.filter((s) => s.tag === tag);
  return matching.length > 0 ? matching : level.spawns;
}
