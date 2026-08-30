import type { FeelProfile } from '../player/config.js';
import { clampFeelProfile } from '../player/config.js';

export type Rarity = 'free' | 'common' | 'rare' | 'epic';
export type UnlockKind = 'free' | 'purchase' | 'achievement' | 'season' | 'event';

/** Purely visual description — the renderer builds a stylised low-poly body from these. */
export interface AnimalVisual {
  /** Hex colours; the art direction is flat-shaded with two accents per animal. */
  body: number;
  accent: number;
  belly: number;
  /** Overall scale multiplier. Hitboxes are NOT affected — fairness. */
  scale: number;
  ears: 'tall' | 'round' | 'pointed' | 'none' | 'fin';
  tail: 'thick' | 'bushy' | 'thin' | 'stub' | 'fin';
  snout: 'short' | 'long' | 'flat' | 'beak';
  /** Optional trailing particle effect id. */
  trail?: string;
}

export interface AnimalAudio {
  jump: string;
  land: string;
  voice: string;
  emote: string;
}

/**
 * Optional authored model. Purely visual: hitboxes, reach and movement come from
 * `MovementConfig`, never from the mesh — so an art pack can never change balance.
 */
export interface AnimalModelRef {
  url: string;
  scale?: number;
  offsetY?: number;
  sockets?: Record<string, string>;
  /** Attribution line required by the asset's licence, shown in the credits screen. */
  credit?: string;
}

export interface AnimalDef {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  unlock: UnlockKind;
  /**
   * Kept at 0 for every animal: the whole roster is free.
   *
   * The field survives because the renderer, the credits screen and the save format all read
   * `AnimalDef`, and removing a field from a shipped save shape is a migration nobody needs. It
   * is validated to stay 0 — see `validateCatalog`.
   */
  priceCents: number;
  visual: AnimalVisual;
  audio: AnimalAudio;
  /**
   * Bounded feel modifiers (±3 %). Present so animals *feel* different, clamped so they can
   * never be an advantage worth paying for. Enforced by `clampFeelProfile` at load.
   */
  feel: FeelProfile;
  emotes: string[];
  /** When present the client renders this model; otherwise it builds the animal procedurally. */
  model?: AnimalModelRef;
  /** Set when the animal is tied to a season or event. */
  seasonId?: string;
  eventId?: string;
}

const registry = new Map<string, AnimalDef>();

/** Load animal definitions. Data may come from this file, a CDN JSON, or a future editor. */
export function registerAnimals(defs: AnimalDef[]): void {
  for (const def of defs) {
    registry.set(def.id, { ...def, feel: clampFeelProfile(def.feel) });
  }
}

export function getAnimal(id: string): AnimalDef | undefined {
  return registry.get(id);
}

export function requireAnimal(id: string): AnimalDef {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown animal: ${id}`);
  return def;
}

export function listAnimals(): AnimalDef[] {
  return [...registry.values()];
}

export function freeAnimals(): AnimalDef[] {
  return listAnimals().filter((a) => a.unlock === 'free');
}

/** Launch roster. Adding an animal is a data change — no gameplay code is touched. */
export const LAUNCH_ANIMALS: AnimalDef[] = [
  {
    id: 'kangaroo',
    name: 'Kangaroo',
    description: 'The original. Big hops, strong tail balance, endlessly springy.',
    rarity: 'free',
    unlock: 'free',
    priceCents: 0,
    visual: { body: 0xc98a52, accent: 0x8d5a30, belly: 0xf0d3ac, scale: 1, ears: 'tall', tail: 'thick', snout: 'long' },
    audio: { jump: 'roo_jump', land: 'roo_land', voice: 'roo_voice', emote: 'roo_emote' },
    feel: { tailBalance: 0.03 },
    model: { url: '/models/kangaroo.glb', scale: 1, offsetY: 0, credit: 'Quaternius (CC0)' },
    emotes: ['wave', 'dance', 'taunt', 'sit'],
  },
  {
    id: 'human',
    name: 'Human',
    /**
     * The other half of the roster.
     *
     * Hunt and Conversion Duel are both kangaroos-versus-humans, so a human has to be a real
     * playable body rather than a re-skinned animal — and free, because a mode that only works
     * if you bought something is a mode that does not work.
     */
    description: 'Two legs, no tail, a great deal to lose. Free, and the other half of every hunt.',
    rarity: 'free',
    unlock: 'free',
    priceCents: 0,
    visual: { body: 0x4a6fa5, accent: 0x2c4363, belly: 0xe8c9a6, scale: 1, ears: 'none', tail: 'stub', snout: 'flat' },
    audio: { jump: 'human_jump', land: 'human_land', voice: 'human_voice', emote: 'human_emote' },
    feel: {},
    emotes: ['wave', 'dance', 'point', 'surrender'],
  },
  {
    id: 'wolf',
    name: 'Wolf',
    description: 'Lean and low. Looks fast, sounds fierce — plays exactly as fair as everyone else.',
    rarity: 'common',
    unlock: 'free',
    priceCents: 0,
    visual: { body: 0x6b7280, accent: 0x374151, belly: 0xd9dde3, scale: 1.02, ears: 'pointed', tail: 'bushy', snout: 'long' },
    audio: { jump: 'wolf_jump', land: 'wolf_land', voice: 'wolf_voice', emote: 'wolf_emote' },
    feel: { acceleration: 0.02, maxSpeed: 0.01 },
    model: { url: '/models/wolf.glb', scale: 1, offsetY: 0, credit: 'Quaternius (CC0)' },
    emotes: ['howl', 'wave', 'dance', 'taunt'],
  },
  {
    id: 'fox',
    name: 'Fox',
    description: 'Small, bright and quick-footed. A crowd favourite in the tree village.',
    rarity: 'common',
    unlock: 'free',
    priceCents: 0,
    visual: { body: 0xe07b39, accent: 0xb14e1c, belly: 0xf7e8d5, scale: 0.95, ears: 'pointed', tail: 'bushy', snout: 'long' },
    audio: { jump: 'fox_jump', land: 'fox_land', voice: 'fox_voice', emote: 'fox_emote' },
    feel: { maxSpeed: 0.02, jumpForce: -0.01 },
    model: { url: '/models/fox.glb', scale: 1, offsetY: 0, credit: 'PixelMannen / tomkranis / @AsoboStudio & @scurest (CC0 + CC-BY 4.0)' },
    emotes: ['yip', 'wave', 'dance', 'spin'],
  },
  {
    id: 'tiger',
    name: 'Tiger',
    description: 'Striped, heavy-footed and loud. The one everybody spots across the canyon.',
    rarity: 'rare',
    unlock: 'free',
    priceCents: 0,
    visual: { body: 0xf59e0b, accent: 0x1f2937, belly: 0xfff7ed, scale: 1.06, ears: 'round', tail: 'thick', snout: 'short' },
    audio: { jump: 'tiger_jump', land: 'tiger_land', voice: 'tiger_voice', emote: 'tiger_emote' },
    feel: { acceleration: 0.03, friction: 0.02 },
    model: { url: '/models/tiger.glb', scale: 1, offsetY: 0, credit: 'Quaternius (CC0)' },
    emotes: ['roar', 'wave', 'dance', 'taunt', 'flex'],
  },
  {
    id: 'frog',
    name: 'Frog',
    description: 'Wide stance, wet landings, comedy timing built in.',
    rarity: 'common',
    unlock: 'free',
    priceCents: 0,
    visual: { body: 0x4ade80, accent: 0x15803d, belly: 0xecfccb, scale: 0.9, ears: 'none', tail: 'stub', snout: 'flat' },
    audio: { jump: 'frog_jump', land: 'frog_land', voice: 'frog_voice', emote: 'frog_emote' },
    feel: { jumpForce: 0.03, maxSpeed: -0.02 },
    model: { url: '/models/frog.glb', scale: 1, offsetY: 0, credit: 'Quaternius (CC0)' },
    emotes: ['croak', 'wave', 'dance', 'puff'],
  },
  {
    id: 'penguin',
    name: 'Penguin',
    description: 'Slides on landing, waddles on the flat, absolutely commits to every hop.',
    rarity: 'rare',
    unlock: 'free',
    priceCents: 0,
    visual: { body: 0x1f2937, accent: 0xfbbf24, belly: 0xf9fafb, scale: 0.94, ears: 'none', tail: 'stub', snout: 'beak' },
    audio: { jump: 'penguin_jump', land: 'penguin_land', voice: 'penguin_voice', emote: 'penguin_emote' },
    feel: { friction: -0.03, tailBalance: -0.01 },
    model: { url: '/models/penguin.glb', scale: 1, offsetY: 0, credit: 'Quaternius (CC0)' },
    emotes: ['slide', 'wave', 'dance', 'flap'],
  },
];

/**
 * Roadmap animals. They are already valid data — shipping one is a matter of flipping it into
 * the store catalog, which is the whole point of the data-driven design.
 */
export const FUTURE_ANIMALS: AnimalDef[] = [
  animal('lion', 'Lion', 'rare', 0xd9a441, 0x8b5a2b, 0xfdf0d5, 'round', 'thick', 'short'),
  animal('bear', 'Bear', 'rare', 0x7c5231, 0x4a2f1b, 0xd9c3a5, 'round', 'stub', 'short'),
  animal('panda', 'Panda', 'epic', 0xf5f5f5, 0x111827, 0xffffff, 'round', 'stub', 'short'),
  animal('raccoon', 'Raccoon', 'common', 0x9ca3af, 0x1f2937, 0xe5e7eb, 'pointed', 'bushy', 'long'),
  animal('deer', 'Deer', 'common', 0xb98a5a, 0x6b4423, 0xf3e2cf, 'tall', 'stub', 'long'),
  animal('koala', 'Koala', 'rare', 0x9aa5b1, 0x5b6672, 0xe8edf2, 'round', 'stub', 'flat'),
  animal('shark', 'Shark', 'epic', 0x64748b, 0x1e293b, 0xf1f5f9, 'fin', 'fin', 'flat'),
  animal('raptor', 'Raptor', 'epic', 0x84cc16, 0x3f6212, 0xecfccb, 'pointed', 'thin', 'long'),
  animal('dragon', 'Dragon', 'epic', 0x7c3aed, 0x4c1d95, 0xede9fe, 'pointed', 'thin', 'long'),
];

/** Roadmap roster. Free like everything else; `rarity` describes the look, not a price tier. */
function animal(
  id: string,
  name: string,
  rarity: Rarity,
  body: number,
  accent: number,
  belly: number,
  ears: AnimalVisual['ears'],
  tail: AnimalVisual['tail'],
  snout: AnimalVisual['snout'],
): AnimalDef {
  return {
    id,
    name,
    description: `${name} — cosmetic only, same movement as every other animal.`,
    rarity,
    unlock: 'free',
    priceCents: 0,
    visual: { body, accent, belly, scale: 1, ears, tail, snout },
    audio: { jump: `${id}_jump`, land: `${id}_land`, voice: `${id}_voice`, emote: `${id}_emote` },
    feel: {},
    emotes: ['wave', 'dance', 'taunt'],
  };
}

registerAnimals(LAUNCH_ANIMALS);
