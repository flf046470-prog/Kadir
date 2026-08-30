import { v3distance, v3normalize, v3set, vec3 } from '../math/vec3.js';
import type { Vec3 } from '../math/vec3.js';
import { makeRaycastResult } from '../physics/types.js';
import type { RaycastResult } from '../physics/types.js';
import type { PhysicsWorld } from '../physics/world.js';
import type { PlayerState } from '../player/state.js';
import type { SimEventQueue } from '../sim/events.js';
import { getGadget } from './catalog.js';
import { canUse } from './loadout.js';
import { selectedGadget } from './state.js';
import type { GadgetDef, GadgetEntity, PlayerGadgetState } from './types.js';

/**
 * The authoritative gadget runtime.
 *
 * Everything a gadget does happens here, on the server's tick, from the server's copy of the
 * world: the client presses a button, and what it gets back is a snapshot in which it is frozen.
 * That is the whole anti-cheat story for gadgets — there is no client-side "I hit them" message
 * to forge, because there is no such message.
 *
 * The runtime is deterministic (no `Math.random`, no wall clock), so it runs identically inside
 * the client's prediction copy of the simulation. Prediction deliberately does *not* apply
 * damage or freezes to remote players; it only draws the projectile it just fired, so a
 * mispredicted hit corrects itself on the next snapshot instead of showing a kill that never was.
 */

export interface GadgetContext {
  /** A map, not an iterator: the runtime walks the roster several times per tick. */
  players: ReadonlyMap<string, PlayerState>;
  world: PhysicsWorld;
  events: SimEventQueue;
  tick: number;
  dt: number;
}

/** Height of a player's centre of mass above their feet, for hit tests. */
const TORSO_RATIO = 0.55;
/** Projectiles below this speed have effectively stopped and are reaped. */
const MIN_PROJECTILE_SPEED = 0.5;

const _dir = vec3();
const _muzzle = vec3();
const _from = vec3();
const _ray: RaycastResult = makeRaycastResult();

export class GadgetRuntime {
  readonly entities: GadgetEntity[] = [];
  private nextId = 1;

  /** Wipe every entity. Called when a round restarts, so traps never outlive their match. */
  clear(): void {
    this.entities.length = 0;
    this.nextId = 1;
  }

  /**
   * Fire the player's selected gadget.
   *
   * Returns the gadget that was used, or null if the press was refused (on cooldown, out of
   * charges, wrong role, nothing equipped). Refusals are silent by design: a client that spams
   * the button on cooldown should see nothing happen, not a stream of error messages.
   */
  use(player: PlayerState, ctx: GadgetContext): GadgetDef | null {
    const state = player.gadgets;
    const id = selectedGadget(state);
    if (!id) return null;
    if (!canUse(state, id, player.role)) return null;
    const def = getGadget(id);
    if (!def) return null;
    // A frozen player cannot use anything — that is what freezing is for.
    if (state.frozen > 0) return null;

    aimFrom(player, _muzzle, _dir);

    switch (def.action.act) {
      case 'projectile':
        this.spawn(def, player, _muzzle, scaled(_dir, def.action.speed), def.action.radius, def.action.lifetime, 0, 'projectile');
        break;
      case 'throwable': {
        // Thrown underhand: the same aim, lofted, so it arcs into cover instead of flying flat.
        const velocity = scaled(_dir, def.action.speed);
        velocity.y += def.action.speed * 0.35;
        this.spawn(def, player, _muzzle, velocity, def.action.radius, def.action.fuse, 0, 'projectile');
        break;
      }
      case 'place': {
        const at = placementPoint(player, ctx.world);
        this.spawn(def, player, at, vec3(), def.action.radius, def.action.lifetime, def.action.armTime, 'placed');
        break;
      }
      case 'self':
        applyPayload(def, player, player, ctx);
        break;
    }

    if (def.uses > 0) state.charges[def.id] = (state.charges[def.id] ?? def.uses) - 1;
    state.cooldowns[def.id] = def.cooldown;
    ctx.events.emit('gadgetUse', player.id, player.position, ctx.tick, 0, { data: def.id });
    return def;
  }

  /** One fixed step: player timers, then entities. */
  step(ctx: GadgetContext): void {
    for (const player of ctx.players.values()) {
      tickStatus(player.gadgets, ctx.dt);
    }
    this.stepEntities(ctx);
  }

  private stepEntities(ctx: GadgetContext): void {
    for (const entity of this.entities) {
      if (entity.spent) continue;
      const def = getGadget(entity.gadgetId);
      if (!def) {
        entity.spent = true;
        continue;
      }

      entity.ttl -= ctx.dt;
      if (entity.arming > 0) entity.arming -= ctx.dt;

      switch (entity.kind) {
        case 'projectile':
          this.stepProjectile(entity, def, ctx);
          break;
        case 'placed':
          if (entity.arming <= 0) this.checkTrigger(entity, def, ctx, true);
          break;
        case 'cloud':
          this.applyCloud(entity, def, ctx);
          break;
      }

      if (!entity.spent && entity.ttl <= 0) this.expire(entity, def, ctx);
    }

    // Reap in one pass at the end so indices stay stable while stepping.
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i]?.spent) this.entities.splice(i, 1);
    }
  }

  private stepProjectile(entity: GadgetEntity, def: GadgetDef, ctx: GadgetContext): void {
    const gravity = def.action.act === 'projectile' || def.action.act === 'throwable' ? def.action.gravity : 0;
    entity.velocity.y -= gravity * ctx.dt;

    v3set(_from, entity.position.x, entity.position.y, entity.position.z);
    const stepX = entity.velocity.x * ctx.dt;
    const stepY = entity.velocity.y * ctx.dt;
    const stepZ = entity.velocity.z * ctx.dt;
    const distance = Math.hypot(stepX, stepY, stepZ);

    if (distance < MIN_PROJECTILE_SPEED * ctx.dt) {
      this.expire(entity, def, ctx);
      return;
    }

    v3set(_dir, stepX / distance, stepY / distance, stepZ / distance);

    // Players first: a shot that would clip a wall behind someone should still hit the someone.
    const hit = this.firstPlayerAlong(entity, _from, _dir, distance + entity.radius, ctx);
    if (hit) {
      v3set(entity.position, hit.position.x, hit.position.y + hit.height * TORSO_RATIO, hit.position.z);
      this.detonate(entity, def, ctx, hit);
      return;
    }

    ctx.world.raycast(_ray, _from, _dir, distance);
    if (_ray.hit) {
      // Stop just short of the surface so the cloud or decal sits in front of it, not inside it.
      v3set(
        entity.position,
        _from.x + _dir.x * Math.max(0, _ray.distance - 0.05),
        _from.y + _dir.y * Math.max(0, _ray.distance - 0.05),
        _from.z + _dir.z * Math.max(0, _ray.distance - 0.05),
      );
      this.detonate(entity, def, ctx, null);
      return;
    }

    entity.position.x += stepX;
    entity.position.y += stepY;
    entity.position.z += stepZ;
  }

  /**
   * The first player the segment passes near, excluding the owner.
   *
   * A segment-to-point distance rather than a swept capsule: the projectile radius already
   * carries the generosity, and at 60 Hz a 60 m/s rifle round moves a metre per tick, which this
   * catches and a per-tick point test would not.
   */
  private firstPlayerAlong(
    entity: GadgetEntity,
    from: Vec3,
    dir: Vec3,
    length: number,
    ctx: GadgetContext,
  ): PlayerState | null {
    let best: PlayerState | null = null;
    let bestT = Infinity;

    for (const player of ctx.players.values()) {
      if (player.id === entity.ownerId || !player.active || !player.alive) continue;
      const cx = player.position.x - from.x;
      const cy = player.position.y + player.height * TORSO_RATIO - from.y;
      const cz = player.position.z - from.z;
      const t = Math.max(0, Math.min(length, cx * dir.x + cy * dir.y + cz * dir.z));
      const dx = cx - dir.x * t;
      const dy = cy - dir.y * t;
      const dz = cz - dir.z * t;
      const reach = entity.radius + player.config.radius;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      if (t < bestT) {
        bestT = t;
        best = player;
      }
    }
    return best;
  }

  /** A projectile reached its target: apply the payload, or leave a cloud behind. */
  private detonate(entity: GadgetEntity, def: GadgetDef, ctx: GadgetContext, direct: PlayerState | null): void {
    if (def.payload.on === 'smoke') {
      this.becomeCloud(entity, def.payload.seconds, def.payload.radius);
      ctx.events.emit('gadgetHit', entity.ownerId, entity.position, ctx.tick, 0, { data: def.id });
      return;
    }

    if (direct) {
      const owner = findPlayer(ctx, entity.ownerId);
      applyPayload(def, direct, owner ?? direct, ctx);
      ctx.events.emit('gadgetHit', entity.ownerId, entity.position, ctx.tick, 1, {
        otherId: direct.id,
        data: def.id,
      });
    } else {
      ctx.events.emit('gadgetHit', entity.ownerId, entity.position, ctx.tick, 0, { data: def.id });
    }
    entity.spent = true;
  }

  /** A placed trap checks its radius every tick once armed. */
  private checkTrigger(entity: GadgetEntity, def: GadgetDef, ctx: GadgetContext, consume: boolean): void {
    for (const player of ctx.players.values()) {
      if (player.id === entity.ownerId || !player.active || !player.alive) continue;
      if (v3distance(player.position, entity.position) > entity.radius) continue;
      const owner = findPlayer(ctx, entity.ownerId);
      applyPayload(def, player, owner ?? player, ctx);
      ctx.events.emit('gadgetHit', entity.ownerId, entity.position, ctx.tick, 1, {
        otherId: player.id,
        data: def.id,
      });
      if (consume) entity.spent = true;
      return;
    }
  }

  /** A smoke cloud re-applies its effect every tick to whoever is standing in it. */
  private applyCloud(entity: GadgetEntity, def: GadgetDef, ctx: GadgetContext): void {
    if (def.payload.on !== 'smoke') return;
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      if (v3distance(player.position, entity.position) > entity.radius) continue;
      // Refreshed rather than accumulated: stepping out of the cloud clears you shortly after,
      // and standing in one for a minute does not blind you for a minute afterwards.
      player.gadgets.smoked = Math.max(player.gadgets.smoked, 0.4);
    }
  }

  private becomeCloud(entity: GadgetEntity, seconds: number, radius: number): void {
    entity.kind = 'cloud';
    entity.velocity.x = 0;
    entity.velocity.y = 0;
    entity.velocity.z = 0;
    entity.radius = radius;
    entity.ttl = seconds;
  }

  private expire(entity: GadgetEntity, def: GadgetDef, ctx: GadgetContext): void {
    // A throwable that ran out of fuse in mid-air still goes off — that is what a fuse means.
    if (entity.kind === 'projectile' && def.action.act === 'throwable') {
      this.detonate(entity, def, ctx, null);
      return;
    }
    entity.spent = true;
    ctx.events.emit('gadgetExpire', entity.ownerId, entity.position, ctx.tick, 0, { data: def.id });
  }

  private spawn(
    def: GadgetDef,
    owner: PlayerState,
    position: Vec3,
    velocity: Vec3,
    radius: number,
    ttl: number,
    arming: number,
    kind: GadgetEntity['kind'],
  ): GadgetEntity {
    const entity: GadgetEntity = {
      id: this.nextId++,
      gadgetId: def.id,
      ownerId: owner.id,
      kind,
      position: { x: position.x, y: position.y, z: position.z },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      radius,
      ttl,
      arming,
      spent: false,
    };
    this.entities.push(entity);
    return entity;
  }
}

/**
 * Apply a payload to a target.
 *
 * Exported because modes need it too — the Hunt shop hands out armour, and the duel heals both
 * fighters at the bell — and because a payload applied anywhere but here would be a second
 * definition of what a freeze means.
 */
export function applyPayload(def: GadgetDef, target: PlayerState, source: PlayerState, ctx: GadgetContext): void {
  const state = target.gadgets;
  switch (def.payload.on) {
    case 'freeze':
      state.frozen = Math.max(state.frozen, def.payload.seconds);
      target.velocity.x = 0;
      target.velocity.z = 0;
      ctx.events.emit('status', target.id, target.position, ctx.tick, def.payload.seconds, { data: 'frozen' });
      break;
    case 'snare':
      state.snared = Math.max(state.snared, def.payload.seconds);
      state.snareSlow = def.payload.slow;
      ctx.events.emit('status', target.id, target.position, ctx.tick, def.payload.seconds, { data: 'snared' });
      break;
    case 'reveal':
      state.revealed = Math.max(state.revealed, def.payload.seconds);
      ctx.events.emit('status', target.id, target.position, ctx.tick, def.payload.seconds, { data: 'revealed' });
      break;
    case 'damage': {
      const dealt = absorbDamage(target, def.payload.amount);
      target.health = Math.max(0, target.health - dealt);
      // The victim records who hit them last, which is how modes attribute a kill.
      target.lastTaggedBy = source.id;
      ctx.events.emit('gadgetHit', source.id, target.position, ctx.tick, dealt, {
        otherId: target.id,
        data: def.id,
      });
      break;
    }
    case 'heal':
      target.health = Math.min(100, target.health + def.payload.amount);
      break;
    case 'armour':
      state.armour = Math.max(state.armour, def.payload.points);
      break;
    case 'smoke':
      state.smoked = Math.max(state.smoked, def.payload.seconds);
      break;
  }
}

/**
 * Spend armour against incoming damage and return what gets through.
 *
 * Armour is a pool, not a percentage: a vest is 60 damage of certainty rather than a dice roll,
 * which is both easier to reason about mid-round and impossible to make into a rarity ladder.
 */
export function absorbDamage(target: PlayerState, amount: number): number {
  const state = target.gadgets;
  if (state.armour <= 0) return amount;
  const absorbed = Math.min(state.armour, amount);
  state.armour -= absorbed;
  return amount - absorbed;
}

/** Count down every status effect. Exported so tests can advance a player without a runtime. */
export function tickStatus(state: PlayerGadgetState, dt: number): void {
  state.frozen = Math.max(0, state.frozen - dt);
  state.snared = Math.max(0, state.snared - dt);
  state.smoked = Math.max(0, state.smoked - dt);
  state.revealed = Math.max(0, state.revealed - dt);
  if (state.snared === 0) state.snareSlow = 0;
  for (const id of Object.keys(state.cooldowns)) {
    const next = (state.cooldowns[id] ?? 0) - dt;
    if (next <= 0) delete state.cooldowns[id];
    else state.cooldowns[id] = next;
  }
}

/**
 * Where a gadget is fired from and in which direction.
 *
 * Aim comes from `lookYaw`/`lookPitch`, the same two fields every platform already fills — the
 * headset on VR, the mouse on PC, the drag on mobile. Deriving it from a VR hand pose instead
 * would aim better in VR and not exist at all on the other two, and a gadget that behaves
 * differently per platform is a cross-play fairness problem, not a feature.
 */
export function aimFrom(player: PlayerState, muzzle: Vec3, dir: Vec3): void {
  const cosPitch = Math.cos(player.pitch);
  v3set(dir, Math.sin(player.yaw) * cosPitch, -Math.sin(player.pitch), Math.cos(player.yaw) * cosPitch);
  v3normalize(dir, dir);
  v3set(
    muzzle,
    player.head.x + dir.x * 0.45,
    player.head.y + dir.y * 0.45,
    player.head.z + dir.z * 0.45,
  );
}

/** Ground in front of the player's feet — where a placed trap ends up. */
function placementPoint(player: PlayerState, world: PhysicsWorld): Vec3 {
  const forwardX = Math.sin(player.yaw);
  const forwardZ = Math.cos(player.yaw);
  const at = vec3(player.position.x + forwardX * 1.1, player.position.y + 0.4, player.position.z + forwardZ * 1.1);
  // Drop it onto the floor so a trap placed on a slope sits on the slope, not floating over it.
  v3set(_dir, 0, -1, 0);
  world.raycast(_ray, at, _dir, 2.5);
  if (_ray.hit) at.y = _ray.point.y + 0.08;
  // Placing into a wall would make an unreachable trap; fall back to the player's own feet.
  if (world.isPointInsideSolid(at)) v3set(at, player.position.x, player.position.y + 0.08, player.position.z);
  return at;
}

function scaled(dir: Vec3, speed: number): Vec3 {
  return vec3(dir.x * speed, dir.y * speed, dir.z * speed);
}

function findPlayer(ctx: GadgetContext, id: string): PlayerState | null {
  return ctx.players.get(id) ?? null;
}
