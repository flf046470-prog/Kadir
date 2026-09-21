import type { Vec3 } from '../math/vec3.js';
import type { SurfaceMaterial } from '../physics/types.js';

/**
 * Gameplay events emitted by the simulation. Audio, VFX, haptics, analytics and the network
 * layer all consume this one queue — the sim itself never touches a renderer or a socket.
 */
export type SimEventType =
  | 'jump'
  | 'land'
  | 'wallBounce'
  | 'grab'
  | 'release'
  | 'climbLaunch'
  | 'tag'
  | 'punch'
  | 'punchHit'
  | 'emote'
  | 'checkpoint'
  | 'lapComplete'
  | 'stagger'
  | 'respawn'
  /** A player stepped into a mode portal in the lobby. `data` is the mode id. */
  | 'portal'
  | 'roleChange'
  | 'roundState'
  | 'gadgetUse'
  | 'gadgetHit'
  | 'gadgetExpire'
  | 'status';
// `chat` and `voice` were members here and were never emitted by anything, in either direction:
// no `.emit()` call site in this package named them, and no consumer existed in any of the three
// switches that turn an event into something a player perceives. Both already have a working home
// that is not this queue — chat travels as its own `ClientChat`/`ServerChat` message so it can be
// rate-limited and moderated, and mic loudness rides `InputIntent.voice` into `PlayerState`,
// because a moving mouth is gameplay-visible state every client must agree on at the same tick
// rather than a one-off notification. Their `case 'chat'`/`case 'voice'` labels in `NetClient` and
// `gateway.ts` are switches over the *message* discriminator `t`, which happens to use the same
// two words — which is exactly why a grep for them reported consumers that were not consumers.
// Removed rather than left declared: unlike `Buttons`' bit 5, an event type is a JSON string and
// not a position, so nothing decodes differently for the gap.

export interface SimEvent {
  type: SimEventType;
  /** Player the event is about. */
  playerId: string;
  /** Secondary player (tagger's target, punch victim). */
  otherId?: string;
  position: Vec3;
  /** Event strength: impact speed, punch speed, charge amount — used for audio/haptic scaling. */
  magnitude: number;
  material?: SurfaceMaterial;
  /** Free-form small payload (checkpoint index, emote id, round phase). */
  data?: string | number;
  /** Sim tick the event happened on. */
  tick: number;
}

/**
 * Fixed-capacity event sink. Events are consumed every tick; a bounded queue means a stuck
 * consumer degrades gracefully instead of leaking memory on a long-running server.
 */
export class SimEventQueue {
  private items: SimEvent[] = [];
  private dropped = 0;

  constructor(private readonly capacity = 512) {}

  push(event: SimEvent): void {
    if (this.items.length >= this.capacity) {
      this.dropped++;
      return;
    }
    this.items.push(event);
  }

  emit(
    type: SimEventType,
    playerId: string,
    position: Vec3,
    tick: number,
    magnitude = 0,
    extra?: Partial<SimEvent>,
  ): void {
    this.push({
      type,
      playerId,
      position: { x: position.x, y: position.y, z: position.z },
      magnitude,
      tick,
      ...extra,
    });
  }

  drain(): SimEvent[] {
    if (this.items.length === 0) return EMPTY;
    const out = this.items;
    this.items = [];
    return out;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  get length(): number {
    return this.items.length;
  }
}

const EMPTY: SimEvent[] = [];
