import type { MatchResult } from '@kc/core';
import type { RoundRewards } from '@kc/net';
import { MAX_BUTTONS } from './VRPanels.js';
import type { VrButton } from './VRPanels.js';
import { unlockedLines } from './Shell.js';

/** The rows a results panel has room for besides its two buttons: the top of the scoreboard. */
export const VR_RESULT_ROWS = 6;

export interface VrResultsContent {
  title: string;
  subtitle: string;
  buttons: VrButton[];
}

/**
 * The end of a round as a headset sees it: the same facts as the flat results screen (who won,
 * the scoreboard, what the round paid, what it unlocked) as a panel to point at, with the same two
 * ways on — `again` (the results screen's "Play again") and `menu` ("Menu").
 *
 * The flat screen is DOM, and DOM is not drawn in an immersive session: a headset player whose
 * round ended was left in a finished world with nothing in front of them and no way on but to take
 * the headset off. Pure, so the facts it shows are tested without a canvas.
 */
export function vrResultsContent(
  result: MatchResult,
  rewards: Record<string, RoundRewards>,
  localId: string,
  nameOf: (id: string, name: string) => string = (_id, name) => name,
): VrResultsContent {
  const won = result.winnerIds.includes(localId);
  const me = result.players.find((p) => p.playerId === localId);
  const reward = rewards[localId];
  const parts: string[] = [];
  if (me) parts.push(`You placed ${ordinal(me.placement)} of ${result.players.length}`);
  if (reward) parts.push(`+${reward.coins} coins · +${reward.xp} XP`);

  const rows: VrButton[] = result.players.slice(0, VR_RESULT_ROWS).map((p) => ({
    id: `row:${p.playerId}`,
    label: `${p.placement}. ${p.playerId === localId ? 'You' : nameOf(p.playerId, p.name)}`,
    value: String(p.score),
    disabled: true,
  }));
  // What the round unlocked, by name: on the flat screen these are lines under the table.
  for (const line of unlockedLines(reward)) rows.push({ id: `unlock:${rows.length}`, label: line, disabled: true });

  // The panel drops rows past what it can draw, and the two ways on are the rows that must survive.
  rows.length = Math.min(rows.length, MAX_BUTTONS - 2);
  return {
    title: won ? 'You win!' : 'Round over',
    subtitle: parts.join(' · '),
    buttons: [...rows, { id: 'again', label: 'Play again' }, { id: 'menu', label: 'Menu' }],
  };
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}
