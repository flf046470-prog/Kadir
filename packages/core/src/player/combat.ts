import { clamp } from '../math/scalar.js';
import { v3distance, v3normalize, vec3 } from '../math/vec3.js';
import type { Vec3 } from '../math/vec3.js';
import type { SimEventQueue } from '../sim/events.js';
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
  maxSpeed: 12,
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
export function resolvePunches(
  attacker: PlayerState,
  others: Iterable<PlayerState>,
  config: CombatConfig,
  events: SimEventQueue,
  tick: number,
): PunchHit[] {
  const hits: PunchHit[] = [];
  if (!attacker.alive || !attacker.active) return hits;

  for (let i = 0; i < 2; i++) {
    const hand = attacker.hands[i] as HandState;
    if (hand.punchCooldown > 0) continue;
    // Punch speed is measured *relative to the body*: sprinting past someone must not count as
    // a punch, and a jab thrown while running should still register at its true speed.
    const speed = Math.hypot(
      hand.velocity.x - attacker.velocity.x,
      hand.velocity.y - attacker.velocity.y,
      hand.velocity.z - attacker.velocity.z,
    );
    if (speed < config.punchSpeed) continue;

    for (const victim of others) {
      if (victim.id === attacker.id || !victim.alive || !victim.active) continue;
      if (victim.invulnTimer > 0) continue;

      const head = v3distance(hand.world, victim.head) <= config.headRadius + config.punchRadius;
      const body = distanceToBody(hand.world, victim) <= config.punchRadius;
      if (!head && !body) continue;

      const staminaFactor = attacker.stamina > config.staminaCost ? 1 : 0.4;
      const speedFactor = clamp(speed / config.maxSpeed, 0.35, 1.4);
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

const _dir = vec3();

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
