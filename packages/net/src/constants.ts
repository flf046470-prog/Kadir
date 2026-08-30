/** Wire protocol version. Server rejects clients that do not match. */
export const PROTOCOL_VERSION = 2;

/** Binary message ids (first byte of every binary frame). */
export const MsgType = {
  Intent: 1,
  Snapshot: 2,
  Ping: 3,
  Pong: 4,
} as const;

/** Control-plane messages travel as JSON — they are rare and readability wins there. */
export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_INTERVAL_TICKS = TICK_RATE / SNAPSHOT_RATE;

/**
 * Quantisation. The world is ~±200 m, so 1 cm positional precision fits in an int16 and halves
 * the size of the hottest field in the game.
 */
export const POS_SCALE = 100; // 1 cm
export const VEL_SCALE = 64; // ~1.5 cm/s
export const ANGLE_SCALE = 10_430; // 2π mapped across int16
export const HAND_SCALE = 1000; // 1 mm, body-local
export const HEAD_SCALE = 100; // 1 cm

/** Roles are sent as one byte. Order is part of the protocol — append only. */
export const ROLES = [
  'idle',
  'runner',
  'chaser',
  'infected',
  'racer',
  'fighter',
  'spectator',
  'hunter',
  'survivor',
] as const;
export type RoleName = (typeof ROLES)[number];

export function roleIndex(role: string): number {
  const index = (ROLES as readonly string[]).indexOf(role);
  return index < 0 ? 0 : index;
}

export function roleName(index: number): RoleName {
  return ROLES[index] ?? 'idle';
}

/**
 * Gadget ids as one byte. Order is part of the protocol — **append only**, exactly like `ROLES`.
 * Index 0 is "nothing held", which is why the list starts with an empty string.
 */
export const GADGETS = [
  '',
  'freeze_gun',
  'smoke_bomb',
  'steel_vest',
  'steel_helmet',
  'bear_trap',
  'tripwire_alarm',
  'field_kit',
  'hunter_rifle',
  'hunter_net',
] as const;

export function gadgetIndex(id: string): number {
  const index = (GADGETS as readonly string[]).indexOf(id);
  return index < 0 ? 0 : index;
}

export function gadgetName(index: number): string {
  return GADGETS[index] ?? '';
}

/** Entity kinds as one byte, same append-only rule. */
export const ENTITY_KINDS = ['projectile', 'placed', 'cloud'] as const;
export type EntityKindName = (typeof ENTITY_KINDS)[number];

export function entityKindIndex(kind: string): number {
  const index = (ENTITY_KINDS as readonly string[]).indexOf(kind);
  return index < 0 ? 0 : index;
}

export function entityKindName(index: number): EntityKindName {
  return ENTITY_KINDS[index] ?? 'projectile';
}

/** Per-entity dirty mask used by the snapshot delta encoder. */
export const Field = {
  Position: 1 << 0,
  Velocity: 1 << 1,
  Look: 1 << 2,
  Flags: 1 << 3,
  Vitals: 1 << 4,
  Score: 1 << 5,
  Hands: 1 << 6,
  Emote: 1 << 7,
  Role: 1 << 8,
  /** Armour, mic level and held gadget — the fields the equipment layer added. */
  Gear: 1 << 9,
} as const;

export const ALL_FIELDS =
  Field.Position |
  Field.Velocity |
  Field.Look |
  Field.Flags |
  Field.Vitals |
  Field.Score |
  Field.Hands |
  Field.Emote |
  Field.Role |
  Field.Gear;

/** Interest management: beyond this distance a player is sent at a reduced rate, hands dropped. */
export const NEAR_DISTANCE = 45;
export const FAR_SNAPSHOT_DIVISOR = 4;
