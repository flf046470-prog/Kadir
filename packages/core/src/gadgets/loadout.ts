import type { PlayerRole } from '../player/state.js';
import { getGadget } from './catalog.js';
import { GADGET_SLOTS } from './types.js';
import type { GadgetSlot, PlayerGadgetState } from './types.js';

/** What a client asks for. Every field is optional; an omitted slot is left empty. */
export type LoadoutRequest = Partial<Record<GadgetSlot, string | null>>;

export type LoadoutError = 'unknown-gadget' | 'not-owned' | 'wrong-slot' | 'role-locked';

export interface LoadoutProblem {
  slot: GadgetSlot;
  gadgetId: string;
  error: LoadoutError;
}

export interface LoadoutOutcome {
  /** The loadout that was actually applied — never what the client asked for verbatim. */
  applied: Record<GadgetSlot, string | null>;
  /** Requests that were refused, so the client can show why rather than silently disagreeing. */
  problems: LoadoutProblem[];
}

/**
 * Validate a loadout request against what the player actually owns.
 *
 * This runs on the server and it is the only path by which a gadget reaches a round. A client
 * that asks for the hunter's rifle, or for a gadget it never bought, gets an empty slot and a
 * stated reason — not a disconnect, because the usual cause is a stale client after a catalog
 * update, not an attack.
 *
 * Role is deliberately not a parameter: role-locked gadgets are refused here for *everyone*,
 * including the hunter, because a role is decided when the round starts and a loadout is chosen
 * before it. `grantRoleGadgets` is the only way one is issued.
 */
export function resolveLoadout(request: LoadoutRequest, owned: readonly string[]): LoadoutOutcome {
  const applied: Record<GadgetSlot, string | null> = { primary: null, secondary: null, armour: null };
  const problems: LoadoutProblem[] = [];
  const ownedSet = new Set(owned);

  for (const slot of GADGET_SLOTS) {
    const wanted = request[slot];
    if (!wanted) continue;

    const def = getGadget(wanted);
    if (!def) {
      problems.push({ slot, gadgetId: wanted, error: 'unknown-gadget' });
      continue;
    }
    if (def.slot !== slot) {
      problems.push({ slot, gadgetId: wanted, error: 'wrong-slot' });
      continue;
    }
    // Role-locked gadgets are issued by the mode, never chosen: `grantRoleGadgets` puts the
    // hunter's rifle in the hunter's hands, and asking for it here is always wrong.
    if (def.roles.length > 0) {
      problems.push({ slot, gadgetId: wanted, error: 'role-locked' });
      continue;
    }
    if (!ownedSet.has(wanted)) {
      problems.push({ slot, gadgetId: wanted, error: 'not-owned' });
      continue;
    }
    applied[slot] = wanted;
  }

  return { applied, problems };
}

/**
 * Write a resolved loadout into a player's gadget state.
 *
 * An omitted slot is emptied, not left alone: this replaces the loadout wholesale, so a player
 * who unequips their armour between rounds actually loses it.
 */
export function applyLoadout(state: PlayerGadgetState, applied: Partial<Record<GadgetSlot, string | null>>): void {
  GADGET_SLOTS.forEach((slot, index) => {
    state.slots[index] = applied[slot] ?? null;
  });
}

/**
 * Hand a role its issued equipment, replacing whatever the player chose.
 *
 * The hunter does not shop for a rifle: the mode gives them one, and taking it away at the end
 * of the role is just as important, which is why this clears role gadgets it did not issue.
 */
export function grantRoleGadgets(state: PlayerGadgetState, role: PlayerRole, gadgetIds: readonly string[]): void {
  // Clear any role gadget already held — a player who stops being the hunter drops the rifle.
  for (let index = 0; index < GADGET_SLOTS.length; index++) {
    const held = state.slots[index];
    if (!held) continue;
    const def = getGadget(held);
    if (def && def.roles.length > 0) state.slots[index] = null;
  }

  for (const id of gadgetIds) {
    const def = getGadget(id);
    if (!def) continue;
    if (def.roles.length > 0 && !def.roles.includes(role)) continue;
    state.slots[GADGET_SLOTS.indexOf(def.slot)] = id;
  }
}

/** May this player use this gadget right now? Checked on every use, not just on equip. */
export function canUse(state: PlayerGadgetState, gadgetId: string, role: PlayerRole): boolean {
  const def = getGadget(gadgetId);
  if (!def) return false;
  if (def.roles.length > 0 && !def.roles.includes(role)) return false;
  if (def.action.act === 'self' && def.payload.on === 'armour') return false;
  if ((state.cooldowns[gadgetId] ?? 0) > 0) return false;
  if (def.uses > 0 && (state.charges[gadgetId] ?? 0) <= 0) return false;
  return true;
}
