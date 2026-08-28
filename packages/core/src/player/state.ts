import type { Vec3 } from '../math/vec3.js';
import { vec3 } from '../math/vec3.js';
import type { SurfaceMaterial } from '../physics/types.js';
import type { MovementConfig } from './config.js';
import { DEFAULT_MOVEMENT } from './config.js';

export type PlayerRole = 'runner' | 'chaser' | 'infected' | 'racer' | 'fighter' | 'spectator' | 'idle';

export type HandSide = 0 | 1;
export const LEFT: HandSide = 0;
export const RIGHT: HandSide = 1;

export interface HandState {
  /** Hand pose in world space (VR: tracked; PC/Mobile: procedurally placed for the avatar). */
  world: Vec3;
  prevWorld: Vec3;
  velocity: Vec3;
  tracked: boolean;
  gripHeld: boolean;
  /** Anchored to a surface (grabbing). */
  anchored: boolean;
  anchor: Vec3;
  anchorCollider: number;
  anchorMaterial: SurfaceMaterial;
  /** Seconds until this hand may register another punch. */
  punchCooldown: number;
}

export function createHandState(): HandState {
  return {
    world: vec3(),
    prevWorld: vec3(),
    velocity: vec3(),
    tracked: false,
    gripHeld: false,
    anchored: false,
    anchor: vec3(),
    anchorCollider: -1,
    anchorMaterial: 'dirt',
    punchCooldown: 0,
  };
}

export interface PlayerState {
  id: string;
  name: string;
  animalId: string;
  /** Resolved movement config (base + animal feel profile). */
  config: MovementConfig;

  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  /** Current capsule height (shrinks while crouching). */
  height: number;
  /** World-space head position — VR avatar, camera, and boxing head hits all read this. */
  head: Vec3;

  grounded: boolean;
  wasGrounded: boolean;
  groundNormal: Vec3;
  groundMaterial: SurfaceMaterial;
  touchingWall: boolean;
  wallNormal: Vec3;

  crouching: boolean;
  sprinting: boolean;
  /** 0..1 hop charge. */
  charge: number;
  chargeHeld: boolean;

  coyoteTimer: number;
  jumpBufferTimer: number;
  staggerTimer: number;
  /** Seconds of tag immunity (after being tagged or respawning). */
  invulnTimer: number;
  tagCooldown: number;

  climbing: boolean;
  climbAnchor: Vec3;
  climbNormal: Vec3;
  climbCollider: number;

  hands: [HandState, HandState];

  role: PlayerRole;
  alive: boolean;
  health: number;
  stamina: number;
  score: number;
  /** Ticks survived / chased — the mode decides what it means. */
  roleTicks: number;
  lastTaggedBy: string | null;

  emoteId: number;
  emoteTimer: number;

  // Parkour
  checkpointIndex: number;
  lapStartTick: number;
  bestLapTicks: number;

  /** Set by the platform layer: VR players report a real head height. */
  headHeight: number;
  /** Last tick an intent was applied — used to detect stalled/disconnected clients. */
  lastIntentTick: number;
  /** True while the player is being simulated by the server (false for spectators/loading). */
  active: boolean;
  spawnPointIndex: number;
}

export interface CreatePlayerOptions {
  id: string;
  name?: string;
  animalId?: string;
  config?: MovementConfig;
  position?: Vec3;
  role?: PlayerRole;
}

export function createPlayerState(options: CreatePlayerOptions): PlayerState {
  const config = options.config ?? DEFAULT_MOVEMENT;
  const position = options.position ? { ...options.position } : vec3();
  return {
    id: options.id,
    name: options.name ?? 'Roo',
    animalId: options.animalId ?? 'kangaroo',
    config,

    position,
    velocity: vec3(),
    yaw: 0,
    pitch: 0,
    height: config.standHeight,
    head: vec3(position.x, position.y + config.standHeight * config.headHeightRatio, position.z),

    grounded: false,
    wasGrounded: false,
    groundNormal: vec3(0, 1, 0),
    groundMaterial: 'dirt',
    touchingWall: false,
    wallNormal: vec3(),

    crouching: false,
    sprinting: false,
    charge: 0,
    chargeHeld: false,

    coyoteTimer: 0,
    jumpBufferTimer: 0,
    staggerTimer: 0,
    invulnTimer: 0,
    tagCooldown: 0,

    climbing: false,
    climbAnchor: vec3(),
    climbNormal: vec3(0, 0, 1),
    climbCollider: -1,

    hands: [createHandState(), createHandState()],

    role: options.role ?? 'idle',
    alive: true,
    health: 100,
    stamina: 100,
    score: 0,
    roleTicks: 0,
    lastTaggedBy: null,

    emoteId: 0,
    emoteTimer: 0,

    checkpointIndex: -1,
    lapStartTick: -1,
    bestLapTicks: -1,

    headHeight: 1.6,
    lastIntentTick: -1,
    active: true,
    spawnPointIndex: 0,
  };
}

/** Reset per-round state without losing identity, cosmetics or session score. */
export function respawnPlayer(player: PlayerState, position: Vec3, tick: number): void {
  player.position.x = position.x;
  player.position.y = position.y;
  player.position.z = position.z;
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  player.grounded = false;
  player.wasGrounded = false;
  player.climbing = false;
  player.climbCollider = -1;
  player.staggerTimer = 0;
  player.charge = 0;
  player.chargeHeld = false;
  player.alive = true;
  player.health = 100;
  player.stamina = 100;
  player.invulnTimer = 1.5;
  player.tagCooldown = 0;
  player.lastIntentTick = tick;
  for (const hand of player.hands) {
    hand.anchored = false;
    hand.anchorCollider = -1;
    hand.punchCooldown = 0;
  }
}

export function isGrabbing(player: PlayerState): boolean {
  return player.climbing || player.hands[0].anchored || player.hands[1].anchored;
}

/** Horizontal speed — used by HUD, animation blending and anti-cheat. */
export function horizontalSpeed(player: PlayerState): number {
  return Math.hypot(player.velocity.x, player.velocity.z);
}
