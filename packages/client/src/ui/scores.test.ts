import { describe, expect, it } from 'vitest';
import { scoreRows } from './scores.js';

const names: Record<string, string> = { bot0: 'Bounce', bot1: 'Digger', 'guest-8f3a91c2d7': 'Ayla' };
const nameOf = (id: string) => names[id];

describe('the scoreboard', () => {
  it('names players as their name tags do, and the local player as You', () => {
    const rows = scoreRows({ me: 4, bot0: 9, bot1: 2, 'guest-8f3a91c2d7': 6 }, 'me', nameOf, 6);
    expect(rows).toEqual([
      { label: 'Bounce', score: 9 },
      { label: 'Ayla', score: 6 },
      { label: 'You', score: 4 },
      { label: 'Digger', score: 2 },
    ]);
  });

  it('falls back to a shortened id for a player the roster has not reached', () => {
    const rows = scoreRows({ 'guest-unknown-123': 1 }, 'me', nameOf, 6);
    expect(rows).toEqual([{ label: 'guest-u…', score: 1 }]);
  });

  it('keeps only the top rows a short screen has room for', () => {
    const rows = scoreRows({ a: 1, b: 2, c: 3, d: 4, e: 5 }, 'me', () => undefined, 4);
    expect(rows.map((r) => r.label)).toEqual(['e', 'd', 'c', 'b']);
  });
});
