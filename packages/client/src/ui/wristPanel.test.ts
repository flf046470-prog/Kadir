import { describe, expect, it } from 'vitest';
import { createPlayerState } from '@kc/core';
import type { ModeStateView } from '@kc/core';
import { buildHudModel } from './hudModel.js';
import type { HudModel } from './hudModel.js';
import { WRIST_EXEMPT, WRIST_FIELDS, chargeBar, wristLines } from './wristPanel.js';

function model(over: Partial<ModeStateView> = {}, local = createPlayerState({ id: 'me', role: 'runner' })): HudModel {
  const state: ModeStateView = { modeId: 'tag', phase: 'playing', timeRemaining: 65, scores: { me: 2, a: 5 }, roles: {}, headline: 'Go!', ...over };
  return buildHudModel({ state, local, localId: 'me', scoreLimit: 6 });
}

describe('wrist panel coverage', () => {
  it('every HudModel field is drawn on the wrist or exempted with a reason', () => {
    const fields = Object.keys(model()) as (keyof HudModel)[];
    const covered = new Set<string>([...WRIST_FIELDS, ...Object.keys(WRIST_EXEMPT)]);
    expect(fields.filter((f) => !covered.has(f))).toEqual([]);
    // And the lists name no field that no longer exists.
    expect([...covered].filter((f) => !fields.includes(f as keyof HudModel))).toEqual([]);
  });
});

describe('wristLines', () => {
  it('leads with role and clock, then the headline', () => {
    const lines = wristLines(model());
    expect(lines[0]).toEqual({ text: 'RUNNER  1:05', tone: 'title' });
    expect(lines[1].text).toBe('Go!');
  });

  it('shows status, bout, charge and the ranked scores', () => {
    const local = createPlayerState({ id: 'me', role: 'runner' });
    local.gadgets.frozen = 2;
    local.charge = 0.5;
    const bouts = [{ a: 'me', b: 'z', aName: 'Me', bName: 'Zed', remaining: 12.34 }] as ModeStateView['bouts'];
    const text = wristLines(model({ bouts }, local)).map((l) => l.text);
    expect(text).toContain('FROZEN 2.0s');
    expect(text).toContain('FIGHT · Zed  12.3');
    expect(text).toContain('Charge [#####.....]');
    expect(text.some((t) => t.endsWith('5'))).toBe(true);
  });

  it('omits the charge line with no local player and the gadget lines until there is something to show', () => {
    const none = buildHudModel({
      state: { modeId: 'tag', phase: 'waiting', timeRemaining: 0, scores: {}, roles: {}, headline: 'Wait' },
      local: undefined,
      localId: 'me',
      scoreLimit: 6,
    });
    expect(wristLines(none).some((l) => l.text.startsWith('Charge'))).toBe(false);
    expect(wristLines(none)[0].text).toBe('WARM-UP  WAITING');
  });

  it('clamps the charge bar', () => {
    expect(chargeBar(-1)).toBe('[..........]');
    expect(chargeBar(2)).toBe('[##########]');
  });
});

describe('the wrist and the connection', () => {
  it('tells a headset player there is no internet, right under the headline', async () => {
    const { buildHudModel, connectionNotice } = await import('./hudModel.js');
    const { wristLines } = await import('./wristPanel.js');
    const state = {
      modeId: 'kangaroo-chase', phase: 'playing', timeRemaining: 60, headline: 'Chase', scores: {},
    } as never;
    const offline = buildHudModel({ state, local: undefined, localId: 'me', scoreLimit: 3, connection: connectionNotice('offline', false) });
    expect(wristLines(offline)[2]?.text).toMatch(/No internet/);
    const online = buildHudModel({ state, local: undefined, localId: 'me', scoreLimit: 3 });
    expect(wristLines(online).some((l) => /internet|server/i.test(l.text))).toBe(false);
  });
});
