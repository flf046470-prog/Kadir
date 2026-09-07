import type { ModeStateView } from '../modes/types.js';
import type { PlayerState } from '../player/state.js';
import type { GadgetEntity } from '../gadgets/types.js';
import { selectedGadget, setHeldGadget } from '../gadgets/state.js';

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
  /** Gadget status effects. Cosmetic on the client — the sim already applied the real thing. */
  Frozen: 1 << 10,
  Snared: 1 << 11,
  Smoked: 1 << 12,
  Revealed: 1 << 13,
  /** Push-to-talk is held. Drives the name-plate speaker icon; `voice` drives the mouth. */
  Talking: 1 << 14,
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
  /** Damage the armour will still absorb; 0 when it is broken or was never equipped. */
  armour: number;
  /** 0..1 mouth openness. Replicated so every viewer sees the same lips on the same tick. */
  voice: number;
  /** Gadget currently selected, so remote avatars hold the right prop. Empty when unarmed. */
  gadgetId: string;
  /** Hands in body-local space; omitted for players whose hands are not tracked. */
  hands: [HandSnapshot, HandSnapshot] | null;
}

/** A projectile in flight, a placed trap, or a smoke cloud. */
export interface EntitySnapshot {
  id: number;
  gadgetId: string;
  ownerId: string;
  kind: 'projectile' | 'placed' | 'cloud';
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface Snapshot {
  tick: number;
  players: PlayerSnapshot[];
  /**
   * Gadget entities, sent whole rather than delta-encoded.
   *
   * There are rarely more than a dozen and they live for seconds, so a delta would spend more
   * bytes tracking what changed than it would save — and a missed trap is a player standing on
   * something they cannot see.
   */
  entities: EntitySnapshot[];
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
  if (player.gadgets.frozen > 0) flags |= SnapFlags.Frozen;
  if (player.gadgets.snared > 0) flags |= SnapFlags.Snared;
  if (player.gadgets.smoked > 0) flags |= SnapFlags.Smoked;
  if (player.gadgets.revealed > 0) flags |= SnapFlags.Revealed;
  if (player.voiceLevel > 0) flags |= SnapFlags.Talking;

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
    armour: player.gadgets.armour,
    voice: player.voiceLevel,
    gadgetId: selectedGadget(player.gadgets) ?? '',
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

export function snapshotEntity(entity: GadgetEntity): EntitySnapshot {
  return {
    id: entity.id,
    gadgetId: entity.gadgetId,
    ownerId: entity.ownerId,
    kind: entity.kind,
    x: entity.position.x,
    y: entity.position.y,
    z: entity.position.z,
    radius: entity.radius,
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
  player.gadgets.armour = snap.armour;
  player.voiceLevel = snap.voice;
  // Status timers are not replicated as numbers: the flag says "still affected", and the client
  // only needs that to draw the effect. The authoritative countdown stays on the server.
  player.gadgets.frozen = (snap.flags & SnapFlags.Frozen) !== 0 ? 0.2 : 0;
  player.gadgets.snared = (snap.flags & SnapFlags.Snared) !== 0 ? 0.2 : 0;
  player.gadgets.smoked = (snap.flags & SnapFlags.Smoked) !== 0 ? 0.2 : 0;
  player.gadgets.revealed = (snap.flags & SnapFlags.Revealed) !== 0 ? 0.2 : 0;
  if (snap.gadgetId) setHeldGadget(player.gadgets, snap.gadgetId);
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
