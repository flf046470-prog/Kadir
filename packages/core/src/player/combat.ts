import { clamp } from '../math/scalar.js';
import { v3distance, v3normalize, v3set, vec3 } from '../math/vec3.js';
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
  /** The share of a punch that gets through a glove in its way (see `guarded`). */
  guardShare: number;
  /** How far a glove reaches across the line of a punch, from its centre, to stop it. */
  guardRadius: number;
  /** A glove further than this from what it covers is not a guard; it is an arm held out. */
  guardReach: number;
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
  guardShare: 0.2,
  guardRadius: 0.15,
  guardReach: 0.45,
};

export interface PunchHit {
  attacker: PlayerState;
  victim: PlayerState;
  damage: number;
  head: boolean;
  /** It met one of the victim's gloves on the way and only `guardShare` of it got through. */
  blocked: boolean;
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
    if (hand.punchCooldown > 0 || !hand.striking) continue;
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
      // A button punch too, now that it only counts on the way out (`HandState.striking`). It was
      // exempt while it landed on the way back, which is most of where it landed.
      const body = bodyPoint(hand.world, victim);
      const atHead = nearHead ? speed * closingShare(hand, attacker, victim.head) : 0;
      const atBody = nearBody ? speed * closingShare(hand, attacker, body) : 0;
      // Closing on both alike, it lands on the head at head height and on the body below it. A tie
      // used to go to the head, so a PC punch thrown level at the chest was a head shot every time
      // (64 of 64), and in bot Boxing 3 % of all hits were ties below the chin scored as the head.
      const head = atHead > atBody || (atHead > 0 && atHead === atBody && hand.world.y >= victim.head.y - config.headRadius);
      const landing = Math.max(atHead, atBody);
      if (landing < config.punchSpeed) continue;
      // And if a glove is in the way of what it is arriving at, the glove takes it.
      const blocked = guarded(hand, attacker, victim, head ? victim.head : body, config);
      const through = blocked ? config.guardShare : 1;

      const staminaFactor = attacker.stamina > config.staminaCost ? 1 : 0.4;
      const speedFactor = clamp(landing / config.maxSpeed, 0.35, 1);
      const damage = config.baseDamage * speedFactor * (head ? config.headMultiplier : 1) * staminaFactor * through;

      applyKnockback(victim, hand, config, speedFactor * through);
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
        blocked,
        point: { ...hand.world },
        speed,
      };
      hits.push(hit);
      events.emit('punchHit', attacker.id, hand.world, tick, damage, {
        otherId: victim.id,
        data: blocked ? 'guard' : head ? 'head' : 'body',
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

/**
 * Whether one of the victim's gloves is in the way of a punch on its way to `target`: within
 * `guardRadius` of the line to the target from `STRIKE_TRAIL` back along the punch's path, between
 * the two, and held within `guardReach` of what it covers.
 *
 * Gloves stopped nothing before this. A VR player holding a textbook guard took a jab to the face
 * at full damage, so the one defence in boxing was decoration, and the reviews of the game this
 * mode is compared with praise exactly that ("guard matters, punch velocity matters").
 *
 * The line, not the glove's distance from the face, decides it, so a guard covers what is behind it
 * from the side the punch comes from: two gloves in front of the face stop a straight, a hook
 * arriving from the side gets round them, and a body shot goes under them.
 *
 * The path, not last tick's position: a punch registers anywhere in a generous hit zone, often
 * after the glove has passed the guard (measured, every button punch into a guard got through when
 * the line started where the glove was a tick before). Half a metre back along the way it is going
 * is where it came from, for a straight and for the end of a hook alike.
 *
 * Only a hand the player put there. A tracked hand is wherever its owner holds it. A hand the game
 * places (PC, mobile, bots) is placed at the chest whether or not anyone is defending, so it guards
 * only while its owner holds the guard button and `locomotion.ts` has raised it.
 */
function guarded(hand: HandState, attacker: PlayerState, victim: PlayerState, target: Vec3, config: CombatConfig): boolean {
  const vx = hand.velocity.x - attacker.velocity.x;
  const vy = hand.velocity.y - attacker.velocity.y;
  const vz = hand.velocity.z - attacker.velocity.z;
  const v = Math.hypot(vx, vy, vz);
  if (v < 1e-6) return false;
  const back = STRIKE_TRAIL / v;
  const from = v3set(_from, hand.world.x - vx * back, hand.world.y - vy * back, hand.world.z - vz * back);
  const lx = target.x - from.x;
  const ly = target.y - from.y;
  const lz = target.z - from.z;
  const length2 = lx * lx + ly * ly + lz * lz;
  if (length2 < 1e-9) return false;
  for (const glove of victim.hands) {
    if (!glove.tracked && !victim.guarding) continue;
    const g = glove.world;
    if (Math.hypot(g.x - target.x, g.y - target.y, g.z - target.z) > config.guardReach) continue;
    const t = ((g.x - from.x) * lx + (g.y - from.y) * ly + (g.z - from.z) * lz) / length2;
    if (t <= 0 || t >= 1) continue;
    const off = Math.hypot(g.x - (from.x + lx * t), g.y - (from.y + ly * t), g.z - (from.z + lz * t));
    if (off <= config.guardRadius) return true;
  }
  return false;
}

/** How far back along a punch's path `guarded` looks for a glove in the way. */
const STRIKE_TRAIL = 0.5;
const _from = vec3();

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
