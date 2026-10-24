import { describe, expect, it } from 'vitest';
import { createPlayerState } from '@kc/core';
import type { ModeStateView } from '@kc/core';
import { buildHudModel } from './hudModel.js';

function view(over: Partial<ModeStateView> = {}): ModeStateView {
  return { modeId: 'tag', phase: 'playing', timeRemaining: 65, scores: {}, roles: {}, headline: 'Go!', ...over };
}
const base = { localId: 'me', scoreLimit: 6 };

describe('buildHudModel', () => {
  it('reports the clock while playing and the phase otherwise', () => {
    const local = createPlayerState({ id: 'me', role: 'runner' });
    expect(buildHudModel({ ...base, state: view(), local }).timer).toBe('1:05');
    expect(buildHudModel({ ...base, state: view({ phase: 'waiting' }), local }).timer).toBe('WAITING');
  });

  it('is an idle warm-up with no gadget strip before there is a local player', () => {
    const m = buildHudModel({ ...base, state: view(), local: undefined });
    expect(m.roleLabel).toBe('WARM-UP');
    expect(m.charge).toBeNull();
    expect(m.gadgetsVisible).toBe(false);
    expect(m.slots).toEqual([]);
  });

  it('hides the gadget strip until there is something to show, then shows cash and status', () => {
    const local = createPlayerState({ id: 'me', role: 'runner' });
    expect(buildHudModel({ ...base, state: view(), local }).gadgetsVisible).toBe(false);
    local.gadgets.cash = 40;
    expect(buildHudModel({ ...base, state: view(), local }).gadgetsVisible).toBe(true);
    local.gadgets.cash = 0;
    local.gadgets.frozen = 1.25;
    const m = buildHudModel({ ...base, state: view(), local });
    expect(m.gadgetsVisible).toBe(true);
    expect(m.status).toBe('FROZEN 1.3s');
  });

  it('puts the longest-lasting status first', () => {
    const local = createPlayerState({ id: 'me' });
    local.gadgets.snared = 2;
    local.gadgets.revealed = 3;
    expect(buildHudModel({ ...base, state: view(), local }).status).toBe('SNARED 2.0s');
  });

  it('ranks the scoreboard with the local player as You, trimmed to the limit', () => {
    const scores = { me: 3, a: 9, b: 1 };
    const m = buildHudModel({ ...base, scoreLimit: 2, state: view({ scores }), local: undefined, nameOf: (id) => id.toUpperCase() });
    expect(m.scores).toEqual([
      { label: 'A', score: 9 },
      { label: 'You', score: 3 },
    ]);
  });

  it('counts roles in the tally and drops an empty ring', () => {
    const m = buildHudModel({ ...base, state: view({ tally: { chaser: 1, runner: 4, fighter: 0 } }), local: undefined });
    expect(m.tally?.map((t) => t.text)).toEqual(['CHASER 1', 'RUNNER 4']);
    const teams = buildHudModel({ ...base, state: view({ tally: { red: 2, blue: 0 } }), local: undefined });
    expect(teams.tally?.map((t) => t.text)).toEqual(['RED 2', 'BLUE 0']);
    expect(buildHudModel({ ...base, state: view(), local: undefined }).tally).toBeNull();
  });

  it('shows only the local players bout, naming the opponent', () => {
    const bouts = [
      { a: 'x', b: 'y', aName: 'X', bName: 'Y', remaining: 5 },
      { a: 'me', b: 'z', aName: 'Me', bName: 'Zed', remaining: 12.34 },
    ] as ModeStateView['bouts'];
    expect(buildHudModel({ ...base, state: view({ bouts }), local: undefined }).bout).toEqual({ label: 'FIGHT · Zed', clock: '12.3' });
    const flipped = [{ a: 'z', b: 'me', aName: 'Zed', bName: 'Me', remaining: 1 }] as ModeStateView['bouts'];
    expect(buildHudModel({ ...base, state: view({ bouts: flipped }), local: undefined }).bout?.label).toBe('FIGHT · Zed');
    expect(buildHudModel({ ...base, state: view({ bouts: [] }), local: undefined }).bout).toBeNull();
  });
});
