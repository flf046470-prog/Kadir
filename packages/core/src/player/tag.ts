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
      const distance = bodyDistance(tagger, target);
      if (distance > rules.radius) continue;
      if (!best || distance < best.distance) best = { tagger, target, distance };
    }
    if (best) out.push(best);
  }
  return out;
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
