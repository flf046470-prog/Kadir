/** Wire protocol version. Server rejects clients that do not match. */
export const PROTOCOL_VERSION = 1;

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
export const ROLES = ['idle', 'runner', 'chaser', 'infected', 'racer', 'fighter', 'spectator'] as const;
export type RoleName = (typeof ROLES)[number];

export function roleIndex(role: string): number {
  const index = (ROLES as readonly string[]).indexOf(role);
  return index < 0 ? 0 : index;
}

export function roleName(index: number): RoleName {
  return ROLES[index] ?? 'idle';
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
} as const;

export const ALL_FIELDS =
  Field.Position | Field.Velocity | Field.Look | Field.Flags | Field.Vitals | Field.Score | Field.Hands | Field.Emote | Field.Role;

/** Interest management: beyond this distance a player is sent at a reduced rate, hands dropped. */
export const NEAR_DISTANCE = 45;
export const FAR_SNAPSHOT_DIVISOR = 4;
