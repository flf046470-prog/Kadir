import type { Vec3 } from '../math/vec3.js';
import type { PlayerRole } from '../player/state.js';

/**
 * Gadgets — the equipment layer.
 *
 * A gadget is a *tool*, never a stat. Nothing here touches `MovementConfig`: no gadget makes you
 * faster, jump higher, or punch harder, because those numbers are how the game stays fair and
 * they are owned by the animal/feel system alone. What a gadget does instead is create a
 * temporary, visible, counterable situation — you are frozen for three seconds, that doorway is
 * full of smoke, there is a trap on the ledge — which everyone in the round can see and play
 * around.
 *
 * The consequence for monetisation is the important one: because the gadget list is a list of
 * *situations* and every gadget is reachable with coins earned by playing, buying one with money
 * skips a grind and never buys an edge. `catalog.ts` enforces that; a test proves it.
 */

export type GadgetKind = 'weapon' | 'throwable' | 'trap' | 'armour' | 'utility';

/**
 * Three slots, and only one gadget in each. The cap is the balance lever: a survivor who could
 * carry every gadget at once would have an answer to everything, and the mode stops being about
 * choosing.
 */
export type GadgetSlot = 'primary' | 'secondary' | 'armour';

export const GADGET_SLOTS: readonly GadgetSlot[] = ['primary', 'secondary', 'armour'];

/** What using the gadget spawns, resolved by `runtime.ts`. */
export type GadgetAction =
  /** Fires a projectile from the muzzle along the aim direction. */
  | { act: 'projectile'; speed: number; gravity: number; radius: number; lifetime: number }
  /** Thrown underhand — an arc rather than a shot. Detonates on a timer, not on contact. */
  | { act: 'throwable'; speed: number; gravity: number; radius: number; fuse: number }
  /** Placed on the ground in front of the player and armed after a delay. */
  | { act: 'place'; radius: number; armTime: number; lifetime: number }
  /** Takes effect on the user the moment it is used. */
  | { act: 'self' };

/** What happens to whoever the gadget catches. */
export type GadgetPayload =
  /** Locks the target in place. The single most powerful effect in the game, so it is short. */
  | { on: 'freeze'; seconds: number }
  /** A cloud that hides everyone inside it, including the thrower. */
  | { on: 'smoke'; seconds: number; radius: number }
  /** Slows the target without removing control — the trap answer to a sprinting hunter. */
  | { on: 'snare'; seconds: number; slow: number }
  /** Damage. Only modes with `combat` enabled route this anywhere. */
  | { on: 'damage'; amount: number }
  /** Absorbs incoming damage until the pool is gone. Passive, no activation. */
  | { on: 'armour'; points: number }
  /** Restores health to the user. */
  | { on: 'heal'; amount: number }
  /** Marks nearby enemies for the owner for a while. No damage, pure information. */
  | { on: 'reveal'; seconds: number; radius: number };

export interface GadgetDef {
  id: string;
  name: string;
  description: string;
  kind: GadgetKind;
  slot: GadgetSlot;
  /** Uses per round. Armour is `1` because it is consumed by being shot at, not by a button. */
  uses: number;
  /** Seconds between uses. */
  cooldown: number;
  /**
   * Roles allowed to carry it. Empty means anyone; the hunter's rifle is the reason this exists.
   * Checked server-side on equip *and* on use, because a role can change mid-round.
   */
  roles: PlayerRole[];
  action: GadgetAction;
  payload: GadgetPayload;
  /** Cost in round cash inside modes that run an in-round shop. */
  roundCost: number;
  /**
   * Coins to unlock it permanently, and cents if you would rather not grind. Every gadget has
   * both — see the module comment. `-1` cents means "not sold for money at all".
   */
  unlockCoins: number;
  unlockCents: number;
  /** Renderer hint; the client picks a mesh and a sound from this. */
  visual: 'rifle' | 'canister' | 'grenade' | 'plate' | 'helmet' | 'beacon' | 'kit';
}

/** A gadget in flight, on the ground, or hanging in the air as a cloud. */
export type EntityKind = 'projectile' | 'placed' | 'cloud';

export interface GadgetEntity {
  /** Monotonic per-simulation, so clients and events can refer to one deterministically. */
  id: number;
  gadgetId: string;
  ownerId: string;
  kind: EntityKind;
  position: Vec3;
  velocity: Vec3;
  /** Trigger radius for placed traps and clouds; collision radius for projectiles. */
  radius: number;
  /** Seconds left before it disappears. */
  ttl: number;
  /** Seconds until a placed trap can fire, so you cannot drop one on someone's head. */
  arming: number;
  /** True once it has done its job; the runtime reaps these at the end of the tick. */
  spent: boolean;
}

/** Per-player equipment state. Lives on `PlayerState`, so it is snapshot- and reset-friendly. */
export interface PlayerGadgetState {
  /** Equipped gadget id per slot, indexed by `GADGET_SLOTS`. */
  slots: (string | null)[];
  /** Index into `slots` of the gadget the use button fires. */
  selected: number;
  /** Uses left this round, keyed by gadget id. */
  charges: Record<string, number>;
  /** Seconds until each gadget is usable again. */
  cooldowns: Record<string, number>;
  /** Currency earned inside the round, spent at the in-round shop. Never real money. */
  cash: number;
  /** Damage the armour will still absorb. */
  armour: number;
  /** Seconds of each status effect remaining. */
  frozen: number;
  snared: number;
  snareSlow: number;
  smoked: number;
  revealed: number;
}
