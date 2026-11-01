import { describe, expect, it } from 'vitest';
import type { MatchResult } from '@kc/core';
import { MAX_BUTTONS } from './VRPanels.js';
import { vrResultsContent } from './vrResults.js';

function result(players: number, winner = 'p0'): MatchResult {
  return {
    modeId: 'kangaroo-chase',
    levelId: 'jungle-world',
    durationTicks: 600,
    winnerIds: [winner],
    players: Array.from({ length: players }, (_, i) => ({
      playerId: `p${i}`,
      name: `Name${i}`,
      placement: i + 1,
      score: 10 - i,
      tags: 0,
    })) as MatchResult['players'],
  };
}

describe('the results panel a headset sees', () => {
  it('says who won, where you placed, what you earned, and offers both ways on', () => {
    const c = vrResultsContent(result(4), { p2: { coins: 30, xp: 12, achievements: [] } }, 'p2');
    expect(c.title).toBe('Round over');
    expect(c.subtitle).toBe('You placed 3rd of 4 · +30 coins · +12 XP');
    expect(c.buttons.map((b) => b.label)).toEqual(['1. Name0', '2. Name1', '3. You', '4. Name3', 'Play again', 'Menu']);
    expect(c.buttons.filter((b) => !b.disabled).map((b) => b.id)).toEqual(['again', 'menu']);
    expect(vrResultsContent(result(4), {}, 'p0').title).toBe('You win!');
  });

  it('keeps Play again and Menu however long the scoreboard is', () => {
    // The panel drops rows past what it can draw; a full room's scoreboard would have pushed the
    // only two ways on off the end.
    const c = vrResultsContent(result(32), { p0: { coins: 1, xp: 1, achievements: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] } }, 'p0');
    expect(c.buttons.length).toBeLessThanOrEqual(MAX_BUTTONS);
    expect(c.buttons.slice(-2).map((b) => b.id)).toEqual(['again', 'menu']);
  });

  it('names other players as streamer mode would', () => {
    const c = vrResultsContent(result(2), {}, 'p1', (id) => `Player ${id}`);
    expect(c.buttons[0]!.label).toBe('1. Player p0');
  });

  it('writes 11th, 12th and 13th, not 11st', () => {
    const labels = [11, 12, 13, 21, 22].map((n) => vrResultsContent(result(25), {}, `p${n - 1}`).subtitle);
    expect(labels.map((l) => l.split(' ')[2])).toEqual(['11th', '12th', '13th', '21st', '22nd']);
  });
});
