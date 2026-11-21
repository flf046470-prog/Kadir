import { v3distance } from '../math/vec3.js';
import type { PlayerState } from './state.js';

export interface TagRules {
  /** Distance between body centres that counts as a tag. */
  radius: number;
  /** Seconds before the same player can tag again. */
  cooldown: number;
  /** Seconds of immunity granted to the tagged player. */
  victimImmunity: number;
  /** Seconds of immunity granted to the new chaser (so they cannot instantly tag back). */
  taggerImmunity: number;
}

export const DEFAULT_TAG_RULES: TagRules = {
  radius: 1.25,
  cooldown: 0.75,
  victimImmunity: 2.0,
  taggerImmunity: 1.5,
};

/**
 * How close a hand has to come to a body's surface to tag it.
 *
 * A tag used to be body centres only, so a headset player's arms did nothing in a game of tag whose
 * whole movement is arms: reaching for someone on the ledge above, or the swipe as they hop past.
 * Now a hand counts too. A tracked hand counts while it is not a pose jump (a controller back from
 * lost tracking, or a teleported hand from a modified client, is not a touch); a placed hand counts
 * during a throw's extension (`striking`), so the PC and mobile answer is the punch button. The hand
 * is the server's own position, clamped into the reach envelope by `sanitizeIntent`, so the furthest
 * a modified client can tag is the furthest an honest arm can.
 */
export const HAND_TAG_REACH = 0.12;

export interface TagCandidate {
  tagger: PlayerState;
  target: PlayerState;
  distance: number;
}

/**
 * Tag detection is **server-only**: it reads server-side positions, never client claims.
 * Body centres are used (not feet) so a player hopping over another can still be tagged, which
 * keeps chases readable in a game where everyone is airborne half the time.
 */
export function findTags(
  players: Iterable<PlayerState>,
  isTagger: (player: PlayerState) => boolean,
  isTarget: (player: PlayerState) => boolean,
  rules: TagRules = DEFAULT_TAG_RULES,
): TagCandidate[] {
  const taggers: PlayerState[] = [];
  const targets: PlayerState[] = [];
  for (const player of players) {
    if (!player.active || !player.alive) continue;
    if (isTagger(player) && player.tagCooldown <= 0) taggers.push(player);
    if (isTarget(player) && player.invulnTimer <= 0) targets.push(player);
  }

  const out: TagCandidate[] = [];
  for (const tagger of taggers) {
    let best: TagCandidate | null = null;
    for (const target of targets) {
      if (target.id === tagger.id) continue;
      const body = bodyDistance(tagger, target);
      const hand = handGap(tagger, target);
      if (body > rules.radius && hand > HAND_TAG_REACH) continue;
      const distance = Math.min(body, hand + (rules.radius - HAND_TAG_REACH));
      if (!best || distance < best.distance) best = { tagger, target, distance };
    }
    if (best) out.push(best);
  }
  return out;
}

/** Gap from the tagger's nearest touching hand to the target's capsule surface; Infinity with none. */
export function handGap(tagger: PlayerState, target: PlayerState): number {
  const r = target.config.radius;
  const bottom = target.position.y + r;
  const top = target.position.y + Math.max(r, target.height - r);
  let best = Infinity;
  for (const hand of tagger.hands) {
    const touching = hand.tracked ? !hand.jumped : hand.striking;
    if (!touching) continue;
    const y = Math.min(top, Math.max(bottom, hand.world.y));
    const gap = v3distance(hand.world, { x: target.position.x, y, z: target.position.z }) - r;
    if (gap < best) best = gap;
  }
  return best;
}

function bodyDistance(a: PlayerState, b: PlayerState): number {
  const ax = a.position.x;
  const ay = a.position.y + a.height * 0.5;
  const az = a.position.z;
  const bx = b.position.x;
  const by = b.position.y + b.height * 0.5;
  const bz = b.position.z;
  return v3distance({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz });
}

export function applyTagCooldowns(tagger: PlayerState, target: PlayerState, rules: TagRules): void {
  tagger.tagCooldown = rules.cooldown;
  tagger.invulnTimer = Math.max(tagger.invulnTimer, rules.taggerImmunity);
  target.invulnTimer = Math.max(target.invulnTimer, rules.victimImmunity);
  target.lastTaggedBy = tagger.id;
}
