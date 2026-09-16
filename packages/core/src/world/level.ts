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

/**
 * A doorway into a game mode, standing in the world.
 *
 * Picking a mode from a menu is the one moment this game stops being a place you are standing in.
 * A portal keeps it: you walk to the mode you want, and your friends can see which one you are
 * heading for and follow you in. It is also the only mode-select that works identically in a
 * headset, on a phone and on a desktop, because walking is the one input all three already have.
 *
 * Part of `LevelDef`, so it is built from the seed like everything else and every client agrees on
 * where the doors are without downloading anything.
 */
export interface PortalDef {
  /** The mode this door opens. Must be a registered mode id. */
  modeId: string;
  position: Vec3;
  /** How close you have to be for it to take you. */
  radius: number;
  /** Facing, so the arch is drawn side-on to whoever is approaching from the lobby centre. */
  yaw: number;
}

/**
 * The modes that get a door in the lobby, in the order they are rung around it.
 *
 * Named here rather than read from the mode registry because a level is plain data and must not
 * depend on the gameplay modules — the whole point of `LevelDef` is that the server, every client
 * and a future map editor can all build the same world from a seed with nothing else loaded.
 * `Training Room` is missing on purpose: it *is* the lobby, so a door back into it would be a
 * door to where you are standing.
 */
export const LOBBY_MODE_IDS = [
  'kangaroo-chase',
  'infection',
  'duel',
  'hunt',
  'freeze-tag',
  'hill',
  'boxing',
  'parkour',
] as const;

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
  /** Doorways into the game modes, standing in the lobby. */
  portals: PortalDef[];
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
