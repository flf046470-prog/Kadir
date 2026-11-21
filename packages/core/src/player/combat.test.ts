import { describe, expect, it } from 'vitest';
import { vec3 } from '../math/vec3.js';
import { SimEventQueue } from '../sim/events.js';
import { DEFAULT_COMBAT, resolvePunches } from './combat.js';
import { LEFT, RIGHT, createPlayerState } from './state.js';
import type { PlayerState } from './state.js';

/**
 * `resolvePunches` on its own, for the cases a whole fight cannot set up on purpose: a glove placed
 * exactly where the rule has to decide.
 */
function setUp(gloveBelowHead: number): { attacker: PlayerState; victim: PlayerState } {
  const attacker = createPlayerState({ id: 'a', position: vec3(0, 1, 0) });
  const victim = createPlayerState({ id: 'b', position: vec3(0, 1, 1.2) });
  const hand = attacker.hands[RIGHT];
  // Level, 0.55 m in front of the victim's axis, straight at them at 6 m/s: within 35° of both
  // the chest and the face, so it closes on each with all its speed.
  hand.world = vec3(0, victim.head.y - gloveBelowHead, victim.position.z - 0.55);
  hand.velocity = vec3(0, 0, 6);
  // Facing +z, so the body's own frame says the same.
  hand.localVelocity = vec3(0, 0, 6);
  hand.tracked = true;
  hand.striking = true;
  return { attacker, victim };
}

describe('resolvePunches', () => {
  it('breaks a tie between head and body by the height the glove is at', () => {
    // A tie used to go to the head whatever the height. In bot Boxing 19 % of hits are ties, and
    // 3 % of hits were ties below the chin scored as head shots.
    for (const [below, head] of [
      [DEFAULT_COMBAT.headRadius + 0.02, false],
      [DEFAULT_COMBAT.headRadius - 0.1, true],
    ] as const) {
      const { attacker, victim } = setUp(below);
      const hits = resolvePunches(attacker, [victim], DEFAULT_COMBAT, new SimEventQueue(), 0);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.head, `${below} m below the head`).toBe(head);
    }
  });

  it('counts a glove the game placed as a guard only while its owner holds the guard', () => {
    // PC, mobile and bot hands are placed at the chest whether or not anyone is defending. One
    // standing on the line of a punch is not a guard unless the player raised it; a tracked hand is
    // wherever its owner holds it, so it always is.
    const blocked = (tracked: boolean, guarding: boolean): boolean => {
      const { attacker, victim } = setUp(0);
      const glove = victim.hands[LEFT];
      glove.world = vec3(0, victim.head.y, victim.position.z - 0.25);
      glove.tracked = tracked;
      victim.guarding = guarding;
      victim.hands[RIGHT].world = vec3(5, 0, 0);
      const hits = resolvePunches(attacker, [victim], DEFAULT_COMBAT, new SimEventQueue(), 0);
      expect(hits).toHaveLength(1);
      return hits[0]?.blocked ?? false;
    };
    expect(blocked(false, false)).toBe(false);
    expect(blocked(false, true)).toBe(true);
    expect(blocked(true, false)).toBe(true);
  });
});
