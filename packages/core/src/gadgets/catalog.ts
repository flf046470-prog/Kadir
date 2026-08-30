import type { GadgetDef, GadgetSlot } from './types.js';

/**
 * The gadget catalog.
 *
 * Two rules are load-bearing and checked by `validateGadgets()` at server boot:
 *
 *  1. Every gadget has an `unlockCoins` price. Coins come from playing, so there is always a
 *     free path to every item in the game. Money is a shortcut past the grind and nothing else.
 *  2. `unlockCents` is either `-1` or one of the approved price points. Everything sellable here
 *     is deliberately at the lowest one — $0.99 — because a gadget is a small thing and pricing
 *     it like a small thing is the whole reason it can exist without becoming pay-to-win.
 *
 * The starter loadout (`STARTER_GADGETS`) is owned by every account from creation, so a player
 * who never spends anything still walks into Hunt with a freeze gun, smoke and a vest.
 */

const catalog = new Map<string, GadgetDef>();

export function registerGadgets(defs: GadgetDef[]): void {
  for (const def of defs) catalog.set(def.id, def);
}

export function getGadget(id: string): GadgetDef | undefined {
  return catalog.get(id);
}

export function listGadgets(): GadgetDef[] {
  return [...catalog.values()];
}

export function gadgetsForSlot(slot: GadgetSlot): GadgetDef[] {
  return listGadgets().filter((g) => g.slot === slot);
}

/** Owned by every profile at creation. */
export const STARTER_GADGETS = ['freeze_gun', 'smoke_bomb', 'steel_vest'] as const;

export const LAUNCH_GADGETS: GadgetDef[] = [
  {
    id: 'freeze_gun',
    name: 'Freeze Gun',
    description: 'A short-range shot that locks whoever it hits in place for three seconds.',
    kind: 'weapon',
    slot: 'primary',
    uses: 4,
    cooldown: 6,
    roles: [],
    action: { act: 'projectile', speed: 26, gravity: 4, radius: 0.45, lifetime: 1.6 },
    payload: { on: 'freeze', seconds: 3 },
    roundCost: 400,
    unlockCoins: 0,
    unlockCents: -1,
    visual: 'canister',
  },
  {
    id: 'smoke_bomb',
    name: 'Smoke Bomb',
    description: 'A thrown cloud that hides everyone inside it — including you.',
    kind: 'throwable',
    slot: 'secondary',
    uses: 3,
    cooldown: 8,
    roles: [],
    action: { act: 'throwable', speed: 12, gravity: 18, radius: 0.3, fuse: 1.2 },
    payload: { on: 'smoke', seconds: 10, radius: 6 },
    roundCost: 300,
    unlockCoins: 0,
    unlockCents: -1,
    visual: 'grenade',
  },
  {
    id: 'steel_vest',
    name: 'Steel Vest',
    description: 'Absorbs 60 damage before it breaks. Does not regenerate.',
    kind: 'armour',
    slot: 'armour',
    uses: 1,
    cooldown: 0,
    roles: [],
    action: { act: 'self' },
    payload: { on: 'armour', points: 60 },
    roundCost: 500,
    unlockCoins: 0,
    unlockCents: -1,
    visual: 'plate',
  },
  {
    id: 'steel_helmet',
    name: 'Steel Helmet',
    description: 'Absorbs 35 damage and survives one headshot. Lighter than the vest, cheaper too.',
    kind: 'armour',
    slot: 'armour',
    uses: 1,
    cooldown: 0,
    roles: [],
    action: { act: 'self' },
    payload: { on: 'armour', points: 35 },
    roundCost: 300,
    unlockCoins: 2500,
    unlockCents: 99,
    visual: 'helmet',
  },
  {
    id: 'bear_trap',
    name: 'Snare Trap',
    description: 'Placed on the ground. Arms after a second, then halves the speed of whoever steps in it.',
    kind: 'trap',
    slot: 'secondary',
    uses: 3,
    cooldown: 5,
    roles: [],
    action: { act: 'place', radius: 1.3, armTime: 1, lifetime: 90 },
    payload: { on: 'snare', seconds: 4, slow: 0.5 },
    roundCost: 350,
    unlockCoins: 2500,
    unlockCents: 99,
    visual: 'beacon',
  },
  {
    id: 'tripwire_alarm',
    name: 'Tripwire Alarm',
    description: 'Placed. Reveals anyone who walks past it to you and your team for eight seconds.',
    kind: 'trap',
    slot: 'secondary',
    uses: 2,
    cooldown: 5,
    roles: [],
    action: { act: 'place', radius: 3, armTime: 1, lifetime: 90 },
    payload: { on: 'reveal', seconds: 8, radius: 3 },
    roundCost: 200,
    unlockCoins: 2000,
    unlockCents: 99,
    visual: 'beacon',
  },
  {
    id: 'field_kit',
    name: 'Field Kit',
    description: 'Heals you for 45 over the moment you use it. Standing still is the cost.',
    kind: 'utility',
    slot: 'secondary',
    uses: 2,
    cooldown: 12,
    roles: [],
    action: { act: 'self' },
    payload: { on: 'heal', amount: 45 },
    roundCost: 300,
    unlockCoins: 2000,
    unlockCents: 99,
    visual: 'kit',
  },
  {
    id: 'hunter_rifle',
    name: "Hunter's Rifle",
    description: 'The hunter’s weapon. Hits for 55, reloads slowly, and only a hunter may carry it.',
    kind: 'weapon',
    slot: 'primary',
    uses: -1,
    cooldown: 2.2,
    roles: ['hunter'],
    action: { act: 'projectile', speed: 60, gravity: 2, radius: 0.35, lifetime: 1.4 },
    payload: { on: 'damage', amount: 55 },
    roundCost: 0,
    unlockCoins: 0,
    unlockCents: -1,
    visual: 'rifle',
  },
  {
    id: 'hunter_net',
    name: "Hunter's Net",
    description: 'The hunter’s snare. Roots a survivor for two seconds instead of hurting them.',
    kind: 'weapon',
    slot: 'secondary',
    uses: 5,
    cooldown: 9,
    roles: ['hunter'],
    action: { act: 'projectile', speed: 20, gravity: 10, radius: 0.7, lifetime: 1.6 },
    payload: { on: 'freeze', seconds: 2 },
    roundCost: 0,
    unlockCoins: 0,
    unlockCents: -1,
    visual: 'canister',
  },
];

registerGadgets(LAUNCH_GADGETS);

export interface GadgetProblem {
  gadgetId: string;
  problem: string;
}

/** Approved real-money price points, mirroring the storefront. */
const APPROVED_CENTS = new Set([99, 149, 199, 299, 499]);

/**
 * Run at server boot. A catalog that breaks the fairness rules must never reach players, and
 * "we'll remember" is not a mechanism — this is.
 */
export function validateGadgets(defs: GadgetDef[] = listGadgets()): GadgetProblem[] {
  const problems: GadgetProblem[] = [];
  for (const def of defs) {
    if (def.unlockCoins < 0) {
      problems.push({ gadgetId: def.id, problem: 'has no coin price, so money would be the only way to get it' });
    }
    if (def.unlockCents !== -1 && !APPROVED_CENTS.has(def.unlockCents)) {
      problems.push({ gadgetId: def.id, problem: `price ${def.unlockCents} is not an approved price point` });
    }
    if (def.uses === 0 || def.uses < -1) {
      problems.push({ gadgetId: def.id, problem: `uses must be -1 (unlimited) or positive, got ${def.uses}` });
    }
    if (def.cooldown < 0) {
      problems.push({ gadgetId: def.id, problem: 'negative cooldown' });
    }
    if (def.slot === 'armour' && def.payload.on !== 'armour') {
      problems.push({ gadgetId: def.id, problem: 'armour slot must carry an armour payload' });
    }
    if (def.payload.on === 'armour' && def.action.act !== 'self') {
      problems.push({ gadgetId: def.id, problem: 'armour is passive and cannot be fired' });
    }
    // Role-locked gadgets are round equipment, not merchandise: selling the hunter's rifle
    // would sell the hunter's job.
    if (def.roles.length > 0 && def.unlockCents !== -1) {
      problems.push({ gadgetId: def.id, problem: 'role-locked gadgets must not be sold for money' });
    }
  }
  return problems;
}
