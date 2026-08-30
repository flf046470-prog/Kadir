import { GADGET_SLOTS, type GadgetSlot, type PlayerGadgetState } from './types.js';
import { getGadget } from './catalog.js';

/**
 * Per-player gadget state.
 *
 * Deliberately plain data with no imports from `player/`: `PlayerState` owns one of these, so
 * anything reaching the other way would be a cycle. The runtime does the interesting work.
 */
export function createGadgetState(): PlayerGadgetState {
  return {
    slots: [null, null, null],
    selected: 0,
    charges: {},
    cooldowns: {},
    cash: 0,
    armour: 0,
    frozen: 0,
    snared: 0,
    snareSlow: 0,
    smoked: 0,
    revealed: 0,
  };
}

export function slotIndex(slot: GadgetSlot): number {
  return GADGET_SLOTS.indexOf(slot);
}

/** The gadget in a slot, or null. */
export function gadgetInSlot(state: PlayerGadgetState, slot: GadgetSlot): string | null {
  return state.slots[slotIndex(slot)] ?? null;
}

/** Put a gadget in its own slot. Returns false when the id is unknown. */
export function setSlot(state: PlayerGadgetState, gadgetId: string | null): boolean {
  if (gadgetId === null) return false;
  const def = getGadget(gadgetId);
  if (!def) return false;
  state.slots[slotIndex(def.slot)] = gadgetId;
  return true;
}

export function clearSlot(state: PlayerGadgetState, slot: GadgetSlot): void {
  state.slots[slotIndex(slot)] = null;
}

/** The gadget the use button would fire right now. */
export function selectedGadget(state: PlayerGadgetState): string | null {
  return state.slots[state.selected] ?? null;
}

/**
 * Put a gadget in its slot *and* select it.
 *
 * Used when applying a snapshot: a remote avatar should be drawn holding what it is actually
 * holding, and `setSlot` alone would leave the selection pointing at a different slot.
 */
export function setHeldGadget(state: PlayerGadgetState, gadgetId: string): boolean {
  const def = getGadget(gadgetId);
  if (!def) return false;
  const index = slotIndex(def.slot);
  state.slots[index] = gadgetId;
  state.selected = index;
  return true;
}

/**
 * Move the selection to the next slot that actually holds a usable gadget.
 *
 * Armour is skipped: it is passive, and cycling onto it would give the player a "weapon" that
 * does nothing when they press fire.
 */
export function cycleSelection(state: PlayerGadgetState): void {
  for (let step = 1; step <= GADGET_SLOTS.length; step++) {
    const index = (state.selected + step) % GADGET_SLOTS.length;
    const id = state.slots[index];
    if (!id) continue;
    const def = getGadget(id);
    if (!def || def.slot === 'armour') continue;
    state.selected = index;
    return;
  }
}

/**
 * Start-of-round reset: charges refilled, timers cleared, armour re-applied from the equipped
 * plate. Slots and cash survive because they were chosen before the round, not during it.
 */
export function resetForRound(state: PlayerGadgetState, cash = 0): void {
  state.charges = {};
  state.cooldowns = {};
  state.armour = 0;
  state.frozen = 0;
  state.snared = 0;
  state.snareSlow = 0;
  state.smoked = 0;
  state.revealed = 0;
  state.cash = cash;
  state.selected = 0;

  for (const id of state.slots) {
    if (!id) continue;
    const def = getGadget(id);
    if (!def) continue;
    if (def.uses > 0) state.charges[id] = def.uses;
    if (def.payload.on === 'armour') state.armour = def.payload.points;
  }
  // Land on something firable rather than on an empty or passive slot.
  const first = state.slots[0];
  const firstDef = first ? getGadget(first) : undefined;
  if (!firstDef || firstDef.slot === 'armour') cycleSelection(state);
}

/** True when any status effect is active — the cheap check the HUD and locomotion use. */
export function hasStatus(state: PlayerGadgetState): boolean {
  return state.frozen > 0 || state.snared > 0 || state.smoked > 0 || state.revealed > 0;
}
