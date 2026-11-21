import { describe, expect, it } from 'vitest';
import { createPlayerState } from './state.js';
import { DEFAULT_TAG_RULES, HAND_TAG_REACH, findTags, handGap } from './tag.js';
import type { PlayerState } from './state.js';

function pair(gap: number, targetY = 0) {
  const tagger = createPlayerState({ id: 'it', position: { x: 0, y: 0, z: 0 }, role: 'chaser' });
  const target = createPlayerState({ id: 'prey', position: { x: 0, y: targetY, z: gap }, role: 'runner' });
  tagger.active = target.active = true;
  return { tagger, target };
}

const tags = (a: PlayerState, b: PlayerState) =>
  findTags([a, b], (p) => p.role === 'chaser', (p) => p.role === 'runner', DEFAULT_TAG_RULES).length;

/** Put the tagger's right hand `reach` metres in front of their chest. */
function reachOut(p: PlayerState, reach: number, y = 1, how: 'tracked' | 'striking' | 'resting' = 'tracked') {
  const hand = p.hands[1]!;
  hand.world = { x: p.position.x, y: p.position.y + y, z: p.position.z + reach };
  hand.tracked = how === 'tracked';
  hand.striking = how === 'striking';
  hand.jumped = false;
}

describe('tagging with a hand', () => {
  it('tags a body out of body range with a hand on it', () => {
    const { tagger, target } = pair(1.6);
    expect(tags(tagger, target)).toBe(0);
    reachOut(tagger, 1.6 - target.config.radius + HAND_TAG_REACH / 2);
    expect(tags(tagger, target)).toBe(1);
  });

  it('reaches up to someone on a ledge above', () => {
    const { tagger, target } = pair(0.5, 1.9);
    expect(tags(tagger, target)).toBe(0);
    reachOut(tagger, 0.5, 2.1);
    expect(tags(tagger, target)).toBe(1);
  });

  it('a placed hand tags only during a throw, and a pose jump never tags', () => {
    const { tagger, target } = pair(1.6);
    const reach = 1.6 - target.config.radius;
    reachOut(tagger, reach, 1, 'resting');
    expect(tags(tagger, target)).toBe(0);
    reachOut(tagger, reach, 1, 'striking');
    expect(tags(tagger, target)).toBe(1);
    reachOut(tagger, reach, 1, 'tracked');
    tagger.hands[1]!.jumped = true;
    expect(tags(tagger, target)).toBe(0);
  });

  it('measures to the capsule surface, not its centre line', () => {
    const { tagger, target } = pair(1.0);
    reachOut(tagger, 1.0 - target.config.radius, 1);
    expect(handGap(tagger, target)).toBeCloseTo(0, 6);
  });
});
