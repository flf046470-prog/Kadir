import { GADGET_SLOTS, getGadget } from '@kc/core';
import type { ModeStateView, PlayerState } from '@kc/core';
import { formatTime } from './dom.js';
import { roleBadge, roleBadgeClass } from './roles.js';
import { scoreRows } from './scores.js';
import type { ScoreRow } from './scores.js';

/** One gadget slot as the player reads it: name, then what stops them using it. */
export interface HudSlot {
  index: number;
  name: string;
  /** Remaining cooldown, or the uses left, or nothing. Both at once is noise. */
  detail: string;
  selected: boolean;
  cooling: boolean;
  /** The key or button bound to this slot. */
  hint: string;
}

export interface HudTallyItem {
  role: string;
  text: string;
}

export interface HudBout {
  label: string;
  clock: string;
}

/**
 * Everything the in-match HUD knows, as plain data.
 *
 * Computed once from the simulation and drawn by whichever surface the platform has: the DOM
 * overlay on PC and mobile, and (Phase 1.4/Phase 4) a wrist panel in VR. Nothing here touches the
 * document, so a headset consumer reads exactly what the flat screen shows.
 */
export interface HudModel {
  headline: string;
  timer: string;
  roleLabel: string;
  roleClass: string;
  tally: HudTallyItem[] | null;
  bout: HudBout | null;
  scores: ScoreRow[];
  /** 0..1, or null when there is no local player. */
  charge: number | null;
  cash: number;
  armour: number;
  slots: HudSlot[];
  status: string;
  /** False in modes with no gadgets at all: the strip is hidden, not drawn empty. */
  gadgetsVisible: boolean;
}

export interface HudModelInput {
  state: ModeStateView;
  local: PlayerState | undefined;
  localId: string;
  nameOf?(id: string): string | undefined;
  /** Scoreboard rows that fit: short screens only have room for a few. */
  scoreLimit: number;
}

export function buildHudModel({ state, local, localId, nameOf, scoreLimit }: HudModelInput): HudModel {
  const role = local?.role ?? 'idle';
  const g = local?.gadgets;
  const status = g ? statusLabel(g) : '';
  const slots = g ? slotsOf(g) : [];
  const carrying = g ? g.slots.some((id) => id !== null) : false;
  return {
    headline: state.headline,
    timer: state.phase === 'playing' ? formatTime(state.timeRemaining) : state.phase.toUpperCase(),
    roleLabel: roleBadge(role, state.modeId).label,
    roleClass: roleBadgeClass(role),
    tally: tallyOf(state),
    bout: boutOf(state, localId),
    scores: scoreRows(state.scores, localId, (id) => nameOf?.(id), scoreLimit),
    charge: local ? local.charge : null,
    cash: g?.cash ?? 0,
    armour: g?.armour ?? 0,
    slots,
    status,
    gadgetsVisible: !!g && (carrying || g.cash > 0 || g.armour > 0 || !!status),
  };
}

function tallyOf(state: ModeStateView): HudTallyItem[] | null {
  const tally = state.tally;
  if (!tally) return null;
  // Roo Ball's tally is goals per team, not heads per role.
  const sides =
    'red' in tally
      ? ([['red', 'RED'], ['blue', 'BLUE']] as const)
      : ([
          ['chaser', roleBadge('chaser', state.modeId).label],
          ['runner', roleBadge('runner', state.modeId).label],
          ['fighter', 'IN THE RING'],
        ] as const);
  const items: HudTallyItem[] = [];
  for (const [role, label] of sides) {
    const count = tally[role] ?? 0;
    if (count === 0 && role === 'fighter') continue;
    items.push({ role, text: `${label} ${count}` });
  }
  return items;
}

/** Only the local player's bout: everyone's are broadcast, but only your own is yours to watch. */
function boutOf(state: ModeStateView, localId: string): HudBout | null {
  const mine = state.bouts?.find((b) => b.a === localId || b.b === localId);
  if (!mine) return null;
  const opponent = mine.a === localId ? mine.bName : mine.aName;
  return { label: `FIGHT · ${opponent}`, clock: mine.remaining.toFixed(1) };
}

function slotsOf(g: PlayerState['gadgets']): HudSlot[] {
  const out: HudSlot[] = [];
  for (let i = 0; i < g.slots.length; i++) {
    const id = g.slots[i];
    if (!id) continue;
    const def = getGadget(id);
    const cooldown = g.cooldowns[id] ?? 0;
    const charges = g.charges[id];
    out.push({
      index: i,
      name: def?.name ?? id,
      detail: cooldown > 0.05 ? `${cooldown.toFixed(1)}s` : charges === undefined ? '' : `×${charges}`,
      selected: i === g.selected,
      cooling: cooldown > 0.05,
      hint: `${GADGET_SLOTS[i] ?? ''}`,
    });
  }
  return out;
}

/** The one status effect worth shouting about, longest-lasting first. */
export function statusLabel(g: PlayerState['gadgets']): string {
  if (g.frozen > 0) return `FROZEN ${g.frozen.toFixed(1)}s`;
  if (g.snared > 0) return `SNARED ${g.snared.toFixed(1)}s`;
  if (g.smoked > 0) return 'BLINDED';
  if (g.revealed > 0) return 'REVEALED';
  return '';
}
