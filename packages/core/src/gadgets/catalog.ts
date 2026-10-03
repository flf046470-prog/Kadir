import type { GadgetDef, GadgetSlot } from './types.js';

/**
 * The gadget catalog.
 *
 * **Every gadget is free and owned by every account from the moment it is created.** Nothing here
 * costs coins and nothing here costs money — `validateGadgets()` enforces both at server boot, so
 * a gadget that acquired a price would stop the server rather than reach a player.
 *
 * That is a deliberate simplification, and it makes the fairness question disappear rather than
 * managing it: there is no loadout someone else could not have, so there is nothing to balance
 * against a wallet. The only price in the game is `roundCost`, paid with cash earned inside the
 * round it is spent in — see `HuntMode`.
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

/**
 * Every gadget a player may equip, owned by every profile at creation.
 *
 * Derived from the catalog rather than listed by hand, so adding a gadget grants it to everyone
 * automatically and there is no second list to forget. Role-locked gear is excluded: the hunter's
 * rifle is issued by the mode for the length of the role, not owned.
 */
export function freeGadgetIds(): string[] {
  return listGadgets()
    .filter((gadget) => gadget.roles.length === 0)
    .map((gadget) => gadget.id);
}

/**
 * The default loadout a new account starts with equipped.
 *
 * They own everything; this is just what is in the three slots before they change it.
 */
export const DEFAULT_LOADOUT = { primary: 'freeze_gun', secondary: 'smoke_bomb', armour: 'steel_vest' } as const;

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
    unlockCoins: 0,
    unlockCents: -1,
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
    unlockCoins: 0,
    unlockCents: -1,
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
    unlockCoins: 0,
    unlockCents: -1,
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
    unlockCoins: 0,
    unlockCents: -1,
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

/**
 * Run at server boot.
 *
 * The game ships free, and this is the mechanism that keeps it that way — "we'll remember" is not
 * one. A gadget that acquired a coin or cash price fails the server's start-up rather than
 * quietly appearing behind a paywall in a build nobody re-read.
 */
export function validateGadgets(defs: GadgetDef[] = listGadgets()): GadgetProblem[] {
  const problems: GadgetProblem[] = [];
  for (const def of defs) {
    if (def.unlockCoins !== 0) {
      problems.push({ gadgetId: def.id, problem: `costs ${def.unlockCoins} coins; every gadget is free` });
    }
    if (def.unlockCents !== -1) {
      problems.push({ gadgetId: def.id, problem: `is priced at ${def.unlockCents} cents; nothing in this game is sold` });
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
    // Role gear is issued by a mode for the length of a role. Owning it outright would put a
    // rifle in a survivor's hands the moment they equipped it in the lobby.
    if (def.roles.length > 0 && freeGadgetIds().includes(def.id)) {
      problems.push({ gadgetId: def.id, problem: 'role-locked gear must not be in the owned-by-default set' });
    }
  }
  return problems;
}
