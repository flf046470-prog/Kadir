import type { ModeStateView } from '../modes/types.js';
import type { PlayerState } from '../player/state.js';

/** Bit flags packed into a snapshot — cheap to send, cheap to compare for delta encoding. */
export const SnapFlags = {
  Grounded: 1 << 0,
  Climbing: 1 << 1,
  Crouching: 1 << 2,
  Sprinting: 1 << 3,
  Alive: 1 << 4,
  AnchoredLeft: 1 << 5,
  AnchoredRight: 1 << 6,
  HandsTracked: 1 << 7,
  Staggered: 1 << 8,
  Invulnerable: 1 << 9,
} as const;

export interface HandSnapshot {
  x: number;
  y: number;
  z: number;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  animalId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  headY: number;
  flags: number;
  role: string;
  health: number;
  stamina: number;
  score: number;
  emoteId: number;
  /** Hands in body-local space; omitted for players whose hands are not tracked. */
  hands: [HandSnapshot, HandSnapshot] | null;
}

export interface Snapshot {
  tick: number;
  players: PlayerSnapshot[];
  mode: ModeStateView;
}

export function snapshotPlayer(player: PlayerState): PlayerSnapshot {
  let flags = 0;
  if (player.grounded) flags |= SnapFlags.Grounded;
  if (player.climbing) flags |= SnapFlags.Climbing;
  if (player.crouching) flags |= SnapFlags.Crouching;
  if (player.sprinting) flags |= SnapFlags.Sprinting;
  if (player.alive) flags |= SnapFlags.Alive;
  if (player.hands[0].anchored) flags |= SnapFlags.AnchoredLeft;
  if (player.hands[1].anchored) flags |= SnapFlags.AnchoredRight;
  if (player.staggerTimer > 0) flags |= SnapFlags.Staggered;
  if (player.invulnTimer > 0) flags |= SnapFlags.Invulnerable;

  const tracked = player.hands[0].tracked || player.hands[1].tracked;
  if (tracked) flags |= SnapFlags.HandsTracked;

  return {
    id: player.id,
    name: player.name,
    animalId: player.animalId,
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    vx: player.velocity.x,
    vy: player.velocity.y,
    vz: player.velocity.z,
    yaw: player.yaw,
    pitch: player.pitch,
    headY: player.head.y - player.position.y,
    flags,
    role: player.role,
    health: player.health,
    stamina: player.stamina,
    score: player.score,
    emoteId: player.emoteId,
    hands: tracked
      ? [
          {
            x: player.hands[0].world.x - player.position.x,
            y: player.hands[0].world.y - player.position.y,
            z: player.hands[0].world.z - player.position.z,
          },
          {
            x: player.hands[1].world.x - player.position.x,
            y: player.hands[1].world.y - player.position.y,
            z: player.hands[1].world.z - player.position.z,
          },
        ]
      : null,
  };
}

/** Apply a snapshot to a local (remote-player) state object — used by the client. */
export function applySnapshot(player: PlayerState, snap: PlayerSnapshot): void {
  player.position.x = snap.x;
  player.position.y = snap.y;
  player.position.z = snap.z;
  player.velocity.x = snap.vx;
  player.velocity.y = snap.vy;
  player.velocity.z = snap.vz;
  player.yaw = snap.yaw;
  player.pitch = snap.pitch;
  player.grounded = (snap.flags & SnapFlags.Grounded) !== 0;
  player.climbing = (snap.flags & SnapFlags.Climbing) !== 0;
  player.crouching = (snap.flags & SnapFlags.Crouching) !== 0;
  player.sprinting = (snap.flags & SnapFlags.Sprinting) !== 0;
  player.alive = (snap.flags & SnapFlags.Alive) !== 0;
  player.staggerTimer = (snap.flags & SnapFlags.Staggered) !== 0 ? 0.2 : 0;
  player.invulnTimer = (snap.flags & SnapFlags.Invulnerable) !== 0 ? 0.2 : 0;
  player.health = snap.health;
  player.stamina = snap.stamina;
  player.score = snap.score;
  player.role = snap.role as PlayerState['role'];
  player.emoteId = snap.emoteId;
  player.animalId = snap.animalId;
  player.name = snap.name;
  player.head.x = snap.x;
  player.head.y = snap.y + snap.headY;
  player.head.z = snap.z;

  const hands = snap.hands;
  for (let i = 0; i < 2; i++) {
    const hand = player.hands[i];
    if (!hand) continue;
    hand.tracked = hands !== null;
    hand.anchored = (snap.flags & (i === 0 ? SnapFlags.AnchoredLeft : SnapFlags.AnchoredRight)) !== 0;
    if (hands) {
      const h = hands[i] as HandSnapshot;
      hand.world.x = snap.x + h.x;
      hand.world.y = snap.y + h.y;
      hand.world.z = snap.z + h.z;
    }
  }
}
