import type { Vec3 } from '../math/index.js';
import { v3set, vec3 } from '../math/index.js';
import type { PhysicsWorld } from '../physics/world.js';
import type { Aabb } from '../physics/types.js';
import { closestPointOnCollider } from '../physics/geometry.js';
import type { PlayerState } from '../player/state.js';
import type { SimEventQueue as EventQueue } from '../sim/events.js';
import type { EntitySnapshot } from '../sim/snapshot.js';
import type { BodyKind, LevelDef } from '../world/level.js';
export type { BodyKind, BodySpawn } from '../world/level.js';
import { aimFrom } from '../gadgets/runtime.js';

/**
 * Loose physical objects: things in the world you can kick, pick up and throw.
 *
 * Every object in the game used to be scenery or a gadget. A ball lying on the ground was a prop
 * with no collider, so a kangaroo hopped straight through it. Escape Simulator 2's whole appeal is
 * that the room is made of things that answer your hands — "every part of the environment designed
 * for interactivity" — and a game whose VR locomotion is climbing with your arms had nothing for
 * those arms to hold.
 *
 * The simulation owns them, like everything else a player can affect: the server steps them and
 * every client draws the result, so a ball knocked into a chaser's path is in the same place for
 * both of them. They ride the entity channel (`kind: 'body'`), whole every snapshot and
 * interpolated with the players.
 *
 * Deliberately modest physics — spheres only, no spin on the wire (a client rolls the mesh from
 * how far it moved), sleeping when still — because 32 players and a dozen balls must stay a small
 * fraction of a 60 Hz tick.
 */

export interface BodyDef {
  radius: number;
  /** Kilograms. Only ever compared with a kangaroo, which always wins. */
  mass: number;
  /** Bounce off a surface of bounciness 0, before the surface's own is added. */
  restitution: number;
  /** Air drag, per second. A beach ball is mostly drag. */
  drag: number;
  /** Rolling resistance on a surface of friction 1, per second. */
  rolling: number;
}

/** Real sizes: a size-5 football is 22 cm across, a beach ball about 60 cm. */
export const BODY_DEFS: Readonly<Record<BodyKind, BodyDef>> = {
  football: { radius: 0.11, mass: 0.43, restitution: 0.62, drag: 0.08, rolling: 0.9 },
  beachball: { radius: 0.3, mass: 0.1, restitution: 0.72, drag: 0.9, rolling: 0.5 },
};

export const BODY_KINDS: readonly BodyKind[] = ['football', 'beachball'];

/** Lower than a player's 24: a ball's arc is what the eye checks a game's gravity against. */
export const BODY_GRAVITY = 12;
/** Entity ids for bodies start here, clear of gadget ids. */
export const BODY_ID_BASE = 60000;
/** Past this speed a hand-thrown ball is a cheat or a teleport, not a throw. */
export const MAX_THROW_SPEED = 18;

export interface Body {
  id: number;
  kind: BodyKind;
  position: Vec3;
  velocity: Vec3;
  home: Vec3;
  /** Who is holding it and with which hand (0 left, 1 right). */
  holder: string | null;
  hand: number;
  lastTouchedBy: string | null;
  sleeping: boolean;
  stillTicks: number;
  /** While held: the hold point's recent velocity, smoothed — what a throw leaves the hand with. */
  carry: Vec3;
}

const HOLD_REACH_UNTRACKED = 1.1;
const HOLD_REACH_TRACKED = 0.18;
const PC_THROW_SPEED = 9;
const SLEEP_SPEED = 0.06;
const CARRY_BLEND = 0.45;
const SLEEP_TICKS = 45;
const MIN_EVENT_SPEED = 2.2;
const LOST_DISTANCE = 160;

const _closest = vec3();
const _normal = vec3();
const _aim = vec3();
const _muzzle = vec3();
const _box: Aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

export class BodySystem {
  readonly bodies: Body[];
  /** Last tick's grip per player per hand, so a grab is a press rather than a hold. */
  private readonly grips = new Map<string, [boolean, boolean]>();

  constructor(
    level: LevelDef,
    private readonly world: PhysicsWorld,
  ) {
    this.bodies = (level.bodies ?? []).map((spawn, i) => ({
      id: BODY_ID_BASE + i,
      kind: spawn.kind,
      position: { ...spawn.position },
      velocity: vec3(),
      home: { ...spawn.position },
      holder: null,
      hand: 0,
      lastTouchedBy: null,
      // Awake at first, so a ball authored a little above the floor settles onto it and then
      // sleeps, rather than hanging where it was typed.
      sleeping: false,
      stillTicks: 0,
      carry: vec3(),
    }));
  }

  step(players: Iterable<PlayerState>, dt: number, tick: number, events: EventQueue, killPlaneY: number): void {
    if (this.bodies.length === 0) return;
    const list = [...players].filter((p) => p.active && p.alive);
    this.updateHolds(list, tick, events);
    for (const body of this.bodies) {
      if (body.holder) {
        this.followHolder(body, list, dt);
        continue;
      }
      this.touchPlayers(body, list, tick, events);
      if (body.sleeping) continue;
      this.integrate(body, dt, tick, events);
      if (body.position.y < killPlaneY || distanceSq(body.position, body.home) > LOST_DISTANCE * LOST_DISTANCE) {
        this.reset(body);
      }
    }
    this.collideBodies();
  }

  /** The snapshot entities for every body, awake or not — a sleeping ball is still a ball. */
  entities(): EntitySnapshot[] {
    return this.bodies.map((body) => ({
      id: body.id,
      gadgetId: body.kind,
      ownerId: body.holder ?? '',
      kind: 'body',
      x: body.position.x,
      y: body.position.y,
      z: body.position.z,
      radius: BODY_DEFS[body.kind].radius,
    }));
  }

  /** Let go of everything a player holds — they left, died or were frozen. */
  release(playerId: string): void {
    for (const body of this.bodies) {
      if (body.holder !== playerId) continue;
      body.holder = null;
      body.sleeping = false;
    }
    this.grips.delete(playerId);
  }

  private updateHolds(players: PlayerState[], tick: number, events: EventQueue): void {
    for (const player of players) {
      const previous = this.grips.get(player.id) ?? [false, false];
      for (let h = 0; h < 2; h++) {
        const hand = player.hands[h];
        if (!hand) continue;
        const was = previous[h] as boolean;
        const now = hand.gripHeld;
        const held = this.bodies.find((b) => b.holder === player.id && b.hand === h);
        if (now && !was && !held && !hand.anchored) this.tryGrab(player, h, tick, events);
        if (!now && was && held) this.throwBody(held, player, tick, events);
      }
      this.grips.set(player.id, [player.hands[0]?.gripHeld ?? false, player.hands[1]?.gripHeld ?? false]);
    }
    // A holder who vanished (left, fell, froze into the kill plane) drops what they held.
    const present = new Set(players.map((p) => p.id));
    for (const body of this.bodies) {
      if (body.holder && !present.has(body.holder)) {
        body.holder = null;
        body.sleeping = false;
      }
    }
  }

  private tryGrab(player: PlayerState, h: number, tick: number, events: EventQueue): void {
    const hand = player.hands[h];
    if (!hand) return;
    const reach = hand.tracked ? HOLD_REACH_TRACKED : HOLD_REACH_UNTRACKED;
    let best: Body | null = null;
    let bestDistance = Infinity;
    for (const body of this.bodies) {
      if (body.holder) continue;
      const d = Math.sqrt(distanceSq(body.position, hand.world)) - BODY_DEFS[body.kind].radius;
      if (d <= reach && d < bestDistance) {
        best = body;
        bestDistance = d;
      }
    }
    if (!best) return;
    best.holder = player.id;
    best.hand = h;
    v3set(best.carry, 0, 0, 0);
    best.sleeping = false;
    best.lastTouchedBy = player.id;
    events.emit('bodyHit', player.id, best.position, tick, 1, { data: 'catch' });
  }

  private throwBody(body: Body, player: PlayerState, tick: number, events: EventQueue): void {
    const hand = player.hands[body.hand];
    body.holder = null;
    body.sleeping = false;
    body.stillTicks = 0;
    if (hand?.tracked) {
      // The hand's speed over the last few ticks, not on the tick it opened: opening the fingers
      // is when a real hand is already slowing, and measured on a 5.4 m/s swing the release-tick
      // speed was 0 — every VR throw dropped the ball at the thrower's feet. Derived from the
      // server's own hold positions, never from a client number, the same rule a punch obeys.
      v3set(body.velocity, body.carry.x, body.carry.y, body.carry.z);
    } else {
      aimFrom(player, _muzzle, _aim);
      v3set(
        body.velocity,
        player.velocity.x * 0.8 + _aim.x * PC_THROW_SPEED,
        player.velocity.y * 0.5 + _aim.y * PC_THROW_SPEED + 2.5,
        player.velocity.z * 0.8 + _aim.z * PC_THROW_SPEED,
      );
    }
    clampLength(body.velocity, MAX_THROW_SPEED);
    body.lastTouchedBy = player.id;
    events.emit('bodyHit', player.id, body.position, tick, length(body.velocity), { data: 'throw' });
  }

  private followHolder(body: Body, players: PlayerState[], dt: number): void {
    const holder = players.find((p) => p.id === body.holder);
    if (!holder) return;
    const hand = holder.hands[body.hand];
    const radius = BODY_DEFS[body.kind].radius;
    let tx: number;
    let ty: number;
    let tz: number;
    if (hand?.tracked) {
      tx = hand.world.x;
      ty = hand.world.y;
      tz = hand.world.z;
    } else {
      // Held out in front of the chest, where both of a kangaroo's short arms can reach it.
      const reach = 0.45 + radius;
      tx = holder.position.x + Math.sin(holder.yaw) * reach;
      ty = holder.position.y + holder.height * 0.62;
      tz = holder.position.z + Math.cos(holder.yaw) * reach;
    }
    // A held ball never goes inside a wall: if the hold point is solid it waits where it was.
    v3set(_closest, tx, ty, tz);
    if (this.world.isPointInsideSolid(_closest)) return;
    v3set(body.velocity, (tx - body.position.x) / dt, (ty - body.position.y) / dt, (tz - body.position.z) / dt);
    // Exponential average over roughly the last four ticks.
    body.carry.x += (body.velocity.x - body.carry.x) * CARRY_BLEND;
    body.carry.y += (body.velocity.y - body.carry.y) * CARRY_BLEND;
    body.carry.z += (body.velocity.z - body.carry.z) * CARRY_BLEND;
    v3set(body.position, tx, ty, tz);
  }

  /**
   * A kangaroo moving into a ball kicks it. The kangaroo's mass wins outright, so the ball takes
   * the closing speed along the contact normal, plus a lift that turns a run-through into a kick
   * rather than a shove along the ground.
   */
  private touchPlayers(body: Body, players: PlayerState[], tick: number, events: EventQueue): void {
    const def = BODY_DEFS[body.kind];
    for (const player of players) {
      const r = player.config.radius;
      const top = player.position.y + player.height - r;
      const bottom = player.position.y + r;
      const cy = Math.max(bottom, Math.min(top, body.position.y));
      const dx = body.position.x - player.position.x;
      const dy = body.position.y - cy;
      const dz = body.position.z - player.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const minDist = r + def.radius;
      if (dist >= minDist || dist < 1e-6) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const nz = dz / dist;
      // Out of the capsule first, so a ball can never be stood inside.
      body.position.x += nx * (minDist - dist);
      body.position.y += ny * (minDist - dist);
      body.position.z += nz * (minDist - dist);
      const closing =
        (player.velocity.x - body.velocity.x) * nx + (player.velocity.y - body.velocity.y) * ny + (player.velocity.z - body.velocity.z) * nz;
      body.sleeping = false;
      body.stillTicks = 0;
      if (closing <= 0) continue;
      const gain = 1 + def.restitution;
      body.velocity.x += nx * closing * gain;
      body.velocity.y += ny * closing * gain + closing * 0.35;
      body.velocity.z += nz * closing * gain;
      clampLength(body.velocity, MAX_THROW_SPEED);
      body.lastTouchedBy = player.id;
      if (closing > MIN_EVENT_SPEED) events.emit('bodyHit', player.id, body.position, tick, closing, { data: 'kick' });
    }
  }

  private integrate(body: Body, dt: number, tick: number, events: EventQueue): void {
    const def = BODY_DEFS[body.kind];
    const keep = Math.exp(-def.drag * dt);
    body.velocity.x *= keep;
    body.velocity.z *= keep;
    body.velocity.y = body.velocity.y * keep - BODY_GRAVITY * dt;
    // Two substeps: a thrown football covers 30 cm a tick, nearly three of its own radii.
    const steps = 2;
    let supported = false;
    for (let s = 0; s < steps; s++) {
      body.position.x += (body.velocity.x * dt) / steps;
      body.position.y += (body.velocity.y * dt) / steps;
      body.position.z += (body.velocity.z * dt) / steps;
      if (this.resolveWorld(body, dt / steps, tick, events)) supported = true;
    }
    const speed = length(body.velocity);
    if (supported && speed < SLEEP_SPEED) {
      if (++body.stillTicks > SLEEP_TICKS) {
        body.sleeping = true;
        v3set(body.velocity, 0, 0, 0);
      }
    } else {
      body.stillTicks = 0;
    }
  }

  /** Push the ball out of every collider it overlaps; true if something is under it. */
  private resolveWorld(body: Body, dt: number, tick: number, events: EventQueue): boolean {
    const def = BODY_DEFS[body.kind];
    const r = def.radius;
    _box.minX = body.position.x - r;
    _box.minY = body.position.y - r;
    _box.minZ = body.position.z - r;
    _box.maxX = body.position.x + r;
    _box.maxY = body.position.y + r;
    _box.maxZ = body.position.z + r;
    let supported = false;
    this.world.queryAabb(_box, (_index, collider) => {
      // The return value is "the point is *inside*", not "there is a contact" — read the other way
      // round, every ordinary resting contact was skipped and a football sank through the floor
      // until its centre was inside the slab, then escaped out of the slab's *underside*.
      const inside = closestPointOnCollider(_closest, _normal, body.position, collider);
      const dx = body.position.x - _closest.x;
      const dy = body.position.y - _closest.y;
      const dz = body.position.z - _closest.z;
      const dist = Math.hypot(dx, dy, dz);
      if (!inside && dist >= r) return;
      // Inside the solid (centre past the surface): trust the collider's own escape normal.
      let nx = _normal.x;
      let ny = _normal.y;
      let nz = _normal.z;
      if (!inside && dist > 1e-6) {
        nx = dx / dist;
        ny = dy / dist;
        nz = dz / dist;
      }
      body.position.x = _closest.x + nx * r;
      body.position.y = _closest.y + ny * r;
      body.position.z = _closest.z + nz * r;
      const vn = body.velocity.x * nx + body.velocity.y * ny + body.velocity.z * nz;
      if (vn < 0) {
        const bounce = def.restitution * (0.6 + collider.surface.bounciness);
        const impact = -vn;
        body.velocity.x -= nx * vn * (1 + bounce);
        body.velocity.y -= ny * vn * (1 + bounce);
        body.velocity.z -= nz * vn * (1 + bounce);
        // A bounce too small to see is a ball settling; it rests instead of buzzing.
        if (impact < 0.8) {
          const rest = body.velocity.x * nx + body.velocity.y * ny + body.velocity.z * nz;
          body.velocity.x -= nx * rest;
          body.velocity.y -= ny * rest;
          body.velocity.z -= nz * rest;
        }
        if (impact > MIN_EVENT_SPEED) {
          events.emit('bodyHit', body.lastTouchedBy ?? 'system', body.position, tick, impact, {
            data: 'bounce',
            material: collider.surface.material,
          });
        }
      }
      if (ny > 0.5) {
        supported = true;
        // Rolling resistance: the tangential speed a surface takes off per second.
        const roll = Math.exp(-def.rolling * Math.max(0.2, collider.surface.friction) * dt);
        body.velocity.x *= roll;
        body.velocity.z *= roll;
      }
    });
    return supported;
  }

  private collideBodies(): void {
    const list = this.bodies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i] as Body;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as Body;
        if (a.holder && b.holder) continue;
        const ra = BODY_DEFS[a.kind].radius;
        const rb = BODY_DEFS[b.kind].radius;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist >= ra + rb || dist < 1e-6) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const ma = a.holder ? Infinity : BODY_DEFS[a.kind].mass;
        const mb = b.holder ? Infinity : BODY_DEFS[b.kind].mass;
        const overlap = ra + rb - dist;
        const wa = ma === Infinity ? 0 : mb === Infinity ? 1 : mb / (ma + mb);
        const wb = 1 - wa;
        a.position.x -= nx * overlap * wa;
        a.position.y -= ny * overlap * wa;
        a.position.z -= nz * overlap * wa;
        b.position.x += nx * overlap * wb;
        b.position.y += ny * overlap * wb;
        b.position.z += nz * overlap * wb;
        const vn = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny + (b.velocity.z - a.velocity.z) * nz;
        if (vn >= 0) continue;
        const e = Math.min(BODY_DEFS[a.kind].restitution, BODY_DEFS[b.kind].restitution);
        const inv = (ma === Infinity ? 0 : 1 / ma) + (mb === Infinity ? 0 : 1 / mb);
        if (inv === 0) continue;
        const impulse = (-(1 + e) * vn) / inv;
        if (ma !== Infinity) {
          a.velocity.x -= (nx * impulse) / ma;
          a.velocity.y -= (ny * impulse) / ma;
          a.velocity.z -= (nz * impulse) / ma;
          a.sleeping = false;
        }
        if (mb !== Infinity) {
          b.velocity.x += (nx * impulse) / mb;
          b.velocity.y += (ny * impulse) / mb;
          b.velocity.z += (nz * impulse) / mb;
          b.sleeping = false;
        }
      }
    }
  }

  private reset(body: Body): void {
    v3set(body.position, body.home.x, body.home.y, body.home.z);
    v3set(body.velocity, 0, 0, 0);
    body.sleeping = true;
    body.lastTouchedBy = null;
  }
}

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function clampLength(v: Vec3, max: number): void {
  const l = length(v);
  if (l <= max) return;
  const k = max / l;
  v.x *= k;
  v.y *= k;
  v.z *= k;
}
