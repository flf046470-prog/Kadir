import { clamp } from '../math/scalar.js';
import { v3distance, v3normalize, vec3 } from '../math/vec3.js';
import type { Vec3 } from '../math/vec3.js';
import type { SimEventQueue } from '../sim/events.js';
import { HUMAN_HAND_SPEED } from './config.js';
import type { HandState, PlayerState } from './state.js';

export interface CombatConfig {
  /** Hand speed (m/s) required to register a punch — filters out hand jitter. */
  punchSpeed: number;
  /** Radius around a hand that can connect. */
  punchRadius: number;
  /** Seconds before the same hand can punch again. */
  punchCooldown: number;
  /** Damage at exactly `punchSpeed`; scales with speed up to `maxSpeed`. */
  baseDamage: number;
  maxSpeed: number;
  /** Head hits do more. */
  headMultiplier: number;
  knockback: number;
  /** Stamina consumed per landed punch; punching at 0 stamina is weak. */
  staminaCost: number;
  /** Radius around the head that counts as a head hit. */
  headRadius: number;
}

export const DEFAULT_COMBAT: CombatConfig = {
  punchSpeed: 3.4,
  punchRadius: 0.42,
  punchCooldown: 0.35,
  baseDamage: 7,
  maxSpeed: HUMAN_HAND_SPEED,
  headMultiplier: 1.6,
  knockback: 5.2,
  staminaCost: 9,
  headRadius: 0.32,
};

export interface PunchHit {
  attacker: PlayerState;
  victim: PlayerState;
  damage: number;
  head: boolean;
  point: Vec3;
  speed: number;
}

/**
 * Physics-based punching.
 *
 * In VR the hand's tracked velocity *is* the punch; on PC/Mobile the platform layer synthesises
 * a hand thrust when the punch button is pressed, so the same code resolves both. Only the
 * server calls this — clients merely predict the flash.
 */
export type DamageFilter = (attacker: PlayerState, victim: PlayerState) => boolean;

export function resolvePunches(
  attacker: PlayerState,
  others: Iterable<PlayerState>,
  config: CombatConfig,
  events: SimEventQueue,
  tick: number,
  canHit?: DamageFilter,
): PunchHit[] {
  const hits: PunchHit[] = [];
  if (!attacker.alive || !attacker.active) return hits;

  for (let i = 0; i < 2; i++) {
    const hand = attacker.hands[i] as HandState;
    if (hand.punchCooldown > 0) continue;
    const speed = punchSpeedOf(hand, attacker, config);
    if (speed < config.punchSpeed) continue;

    for (const victim of others) {
      if (victim.id === attacker.id || !victim.alive || !victim.active) continue;
      // Who may hit whom is the mode's decision, and it has to be checked *before* the immunity
      // timer is set: a punch that should never have landed still handed the victim 0.25 s of
      // immunity, which in Duel silently swallowed catches and in Hunt let survivors beat each
      // other up. Default is a free-for-all, which is what Boxing wants.
      if (canHit && !canHit(attacker, victim)) continue;
      if (victim.invulnTimer > 0) continue;

      const nearHead = v3distance(hand.world, victim.head) <= config.headRadius + config.punchRadius;
      const nearBody = distanceToBody(hand.world, victim) <= config.punchRadius;
      if (!nearHead && !nearBody) continue;
      // What it lands on is what it is arriving at: a glove at chin height moving level is closing on
      // the chest as much as on the head, and a glove rising under the jaw only on the head.
      // Only a tracked hand: a button punch is a throw this code makes itself, aimed where the player
      // looks, and it runs out to full reach whoever is in the way — toe to toe it passes through the
      // target, which measured as a third of its damage gone on PC (18.6 → 6.3 a second at 0.7 m).
      const atHead = nearHead ? speed * (hand.tracked ? closingShare(hand, attacker, victim.head) : 1) : 0;
      const atBody = nearBody ? speed * (hand.tracked ? closingShare(hand, attacker, bodyPoint(hand.world, victim)) : 1) : 0;
      const head = atHead > 0 && atHead >= atBody;
      const landing = Math.max(atHead, atBody);
      if (landing < config.punchSpeed) continue;

      const staminaFactor = attacker.stamina > config.staminaCost ? 1 : 0.4;
      const speedFactor = clamp(landing / config.maxSpeed, 0.35, 1);
      const damage = config.baseDamage * speedFactor * (head ? config.headMultiplier : 1) * staminaFactor;

      applyKnockback(victim, hand, config, speedFactor);
      victim.health = Math.max(0, victim.health - damage);
      victim.invulnTimer = Math.max(victim.invulnTimer, 0.25);
      // Credit for a knockout goes to whoever landed the last punch.
      victim.lastTaggedBy = attacker.id;
      attacker.stamina = Math.max(0, attacker.stamina - config.staminaCost);
      hand.punchCooldown = config.punchCooldown;

      const hit: PunchHit = {
        attacker,
        victim,
        damage,
        head,
        point: { ...hand.world },
        speed,
      };
      hits.push(hit);
      events.emit('punchHit', attacker.id, hand.world, tick, damage, {
        otherId: victim.id,
        data: head ? 'head' : 'body',
      });
      if (victim.health <= 0) {
        victim.alive = false;
      }
      break; // one hand connects with one player per tick
    }
  }
  return hits;
}

/**
 * How fast a hand is punching, in m/s: the smaller of its speed relative to the moving body in
 * the world and its speed in the body's own frame, capped at `maxSpeed`.
 *
 * Each frame alone mistakes something that is not a punch for one, and the two mistakes are
 * opposite, so the smaller of the two is the punch:
 * - **World speed less the body's velocity** (what this used to be) counts *turning*. A hand held
 *   still is swung through an arc by a mouse flick or a VR snap turn — measured, a PC player
 *   flicking ±90° beside an opponent, punch button never pressed, landed 58 hits in 20 s.
 * - **Speed in the body's frame** counts a VR player's *head* turning: tracked hands are sent
 *   relative to the head's yaw, so a fast glance with the hands held still in the room moves them
 *   through the frame while they do not move at all.
 * A real punch is fast in both. Sprinting past someone is in neither, as before.
 *
 * The cap is a human hand, not a tuning knob. Hand positions are only clamped into a reach
 * envelope, so a modified client can teleport a hand across it every tick, and the speed that
 * reads as is limited by nothing: measured, 34.8 damage per second against 12.5 for honest
 * 6 m/s jabs, because `speedFactor` was allowed to reach 1.4. Damage "scales with speed up to
 * `maxSpeed`", as the config always said; now it stops there, so a cheat can be at most a perfect
 * human. No honest punch is affected: the procedural PC thrust is 7.7 m/s.
 */
export function punchSpeedOf(hand: HandState, attacker: PlayerState, config: CombatConfig): number {
  const world = Math.hypot(
    hand.velocity.x - attacker.velocity.x,
    hand.velocity.y - attacker.velocity.y,
    hand.velocity.z - attacker.velocity.z,
  );
  const local = Math.hypot(hand.localVelocity.x, hand.localVelocity.y, hand.localVelocity.z);
  return Math.min(world, local, config.maxSpeed);
}

const _dir = vec3();
const _point = vec3();

/**
 * How much of a hand's speed is closing on `target`: all of it within 35° of straight at it, none of
 * it past 80° — across it, or away.
 *
 * A punch is how fast the glove arrives, not how fast it is moving. Speed in any direction used to
 * count, inside a hit zone 0.74 m from the head's centre, so a VR player who held their hands at
 * their own guard and spun them in small fast circles out-hit one who boxed: measured toe to toe,
 * 32.8 damage a second from a 12 cm, 14 Hz flail that never left the guard, against 14.6 from a
 * committed 8 m/s jab. That is the complaint that sank The Thrill of the Fight 2 to 3.1 stars on
 * the Meta store (2026-10-24: "punching like a 9 year old with arthritis is how you get your
 * punches to do damage"; "a spazzing house cat" beating clean shots), and the reverse of what its
 * 4.7-star predecessor is praised for: "guard matters, punch velocity matters". A hook arrives from
 * the side and an uppercut from below, and each is still closing on what it hits when it lands.
 *
 * Full credit inside a cone rather than the cosine itself: the hit zone is generous, so a punch
 * registers while the glove is still half a metre out, where the line to the centre of the head is
 * steeper than the line the punch will actually land on. A level jab at the chin is at 26° there.
 */
function closingShare(hand: HandState, attacker: PlayerState, target: Vec3): number {
  const vx = hand.velocity.x - attacker.velocity.x;
  const vy = hand.velocity.y - attacker.velocity.y;
  const vz = hand.velocity.z - attacker.velocity.z;
  const dx = target.x - hand.world.x;
  const dy = target.y - hand.world.y;
  const dz = target.z - hand.world.z;
  const v = Math.hypot(vx, vy, vz);
  const d = Math.hypot(dx, dy, dz);
  if (v < 1e-6) return 0;
  // A glove already at the centre of what it hit has no direction left to close in.
  if (d < 1e-3) return 1;
  const cos = (vx * dx + vy * dy + vz * dz) / (v * d);
  return clamp((cos - CLOSING_NONE_COS) / (CLOSING_FULL_COS - CLOSING_NONE_COS), 0, 1);
}

/** Within 35° of straight at the target a punch lands with all its speed, and past 80° with none. */
const CLOSING_FULL_COS = Math.cos((35 * Math.PI) / 180);
const CLOSING_NONE_COS = Math.cos((80 * Math.PI) / 180);

/** The nearest point on the victim's capsule core segment, the one `distanceToBody` measures to. */
function bodyPoint(point: Vec3, victim: PlayerState): Vec3 {
  const y0 = victim.position.y + victim.config.radius;
  const y1 = victim.position.y + Math.max(victim.height - victim.config.radius, victim.config.radius);
  _point.x = victim.position.x;
  _point.y = clamp(point.y, y0, y1);
  _point.z = victim.position.z;
  return _point;
}

function applyKnockback(victim: PlayerState, hand: HandState, config: CombatConfig, speedFactor: number): void {
  v3normalize(_dir, hand.velocity);
  const force = config.knockback * speedFactor;
  victim.velocity.x += _dir.x * force;
  victim.velocity.z += _dir.z * force;
  victim.velocity.y += Math.max(0.35, _dir.y) * force * 0.45;
  victim.staggerTimer = Math.max(victim.staggerTimer, 0.25 * speedFactor);
}

function distanceToBody(point: Vec3, victim: PlayerState): number {
  // Distance to the victim's capsule core segment.
  const y0 = victim.position.y + victim.config.radius;
  const y1 = victim.position.y + Math.max(victim.height - victim.config.radius, victim.config.radius);
  const cy = clamp(point.y, y0, y1);
  const dx = point.x - victim.position.x;
  const dy = point.y - cy;
  const dz = point.z - victim.position.z;
  return Math.hypot(dx, dy, dz) - victim.config.radius;
}

/** Stamina regenerates whenever the player is not punching. Called from the mode step. */
export function regenerateStamina(player: PlayerState, dt: number, rate = 11): void {
  player.stamina = Math.min(100, player.stamina + rate * dt);
}
