import { createMode, getModeDef, hasMode } from './registry.js';
import type { GameMode, GameModeDef } from './types.js';

/**
 * Player-authored modes.
 *
 * A custom mode is **data, not code**. That is the whole design, and it is not a limitation —
 * it is the only version of this feature that can be shipped safely. A mode described by a
 * script would mean running a player's script on the authoritative server; a mode described by
 * a config means the server runs the same audited code it always did, with different numbers in
 * it. Every number is clamped to a range chosen here, so the worst a malicious config can do is
 * make a boring match.
 *
 * What a config can change is deliberately the set of things that change how a round *feels* —
 * how long it lasts, how many chasers there are, whether gadgets are in play — and deliberately
 * not anything in `MovementConfig`. Movement is what makes this game fair across every room in
 * it; a custom mode that could hand its host a higher jump would be the same pay-to-win hole the
 * store was built to avoid, arriving through a different door.
 */

export interface ModeConfig {
  /** Author-supplied name, shown in the room list. Sanitised, never rendered raw. */
  name: string;
  /** Which shipped mode this is a variant of. Anything else is refused. */
  base: string;
  roundSeconds: number;
  countdownSeconds: number;
  minPlayers: number;
  maxPlayers: number;
  /** Fraction of the lobby that starts as chasers/hunters. */
  chaserRatio: number;
  /** Round cash survivors start with, in modes that run a shop. */
  startingCash: number;
  /** When false, loadouts are cleared and the shop is closed — a pure movement match. */
  gadgetsEnabled: boolean;
}

/**
 * The modes a custom config may be built on.
 *
 * An allow-list rather than "any registered mode": the Training Room is not a round and would
 * make no sense parametrised, and a future mode should have to opt in rather than be exposed by
 * having been added.
 */
export const CUSTOM_BASES = ['kangaroo-chase', 'freeze-tag', 'hunt', 'duel', 'hill', 'infection', 'boxing'] as const;

/** Bounds for every field. A config is clamped into these; it is never rejected for being silly. */
export const MODE_LIMITS = {
  roundSeconds: { min: 60, max: 900 },
  countdownSeconds: { min: 3, max: 30 },
  minPlayers: { min: 2, max: 16 },
  maxPlayers: { min: 2, max: 24 },
  chaserRatio: { min: 0.05, max: 0.5 },
  startingCash: { min: 0, max: 5000 },
  nameLength: 24,
} as const;

export const DEFAULT_MODE_CONFIG: ModeConfig = {
  name: 'Custom Match',
  base: 'kangaroo-chase',
  roundSeconds: 240,
  countdownSeconds: 5,
  minPlayers: 2,
  maxPlayers: 16,
  chaserRatio: 0.2,
  startingCash: 600,
  gadgetsEnabled: true,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Turn whatever a client sent into a config that is safe to run.
 *
 * This is the trust boundary. It never throws and never rejects: an out-of-range number is
 * clamped, an unknown base falls back to the default, and junk becomes the default outright.
 * A room that refuses to start because someone typed a large number is a worse outcome than a
 * room that quietly runs a five-minute round instead of a five-hour one.
 */
export function sanitiseModeConfig(raw: unknown): ModeConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MODE_CONFIG };
  const input = raw as Partial<Record<keyof ModeConfig, unknown>>;

  const base =
    typeof input.base === 'string' && (CUSTOM_BASES as readonly string[]).includes(input.base) && hasMode(input.base)
      ? input.base
      : DEFAULT_MODE_CONFIG.base;

  const minPlayers = clamp(input.minPlayers, MODE_LIMITS.minPlayers.min, MODE_LIMITS.minPlayers.max, DEFAULT_MODE_CONFIG.minPlayers);
  const maxPlayers = clamp(input.maxPlayers, MODE_LIMITS.maxPlayers.min, MODE_LIMITS.maxPlayers.max, DEFAULT_MODE_CONFIG.maxPlayers);

  return {
    name: sanitiseModeName(input.name),
    base,
    roundSeconds: Math.round(
      clamp(input.roundSeconds, MODE_LIMITS.roundSeconds.min, MODE_LIMITS.roundSeconds.max, DEFAULT_MODE_CONFIG.roundSeconds),
    ),
    countdownSeconds: Math.round(
      clamp(
        input.countdownSeconds,
        MODE_LIMITS.countdownSeconds.min,
        MODE_LIMITS.countdownSeconds.max,
        DEFAULT_MODE_CONFIG.countdownSeconds,
      ),
    ),
    minPlayers: Math.round(minPlayers),
    // A room whose minimum exceeds its maximum can never start. Raising the cap is the fix that
    // keeps the author's intent — they asked for at least this many players.
    maxPlayers: Math.round(Math.max(minPlayers, maxPlayers)),
    chaserRatio: clamp(input.chaserRatio, MODE_LIMITS.chaserRatio.min, MODE_LIMITS.chaserRatio.max, DEFAULT_MODE_CONFIG.chaserRatio),
    startingCash: Math.round(
      clamp(input.startingCash, MODE_LIMITS.startingCash.min, MODE_LIMITS.startingCash.max, DEFAULT_MODE_CONFIG.startingCash),
    ),
    gadgetsEnabled: input.gadgetsEnabled !== false,
  };
}

/**
 * Clean a mode name.
 *
 * Same reasoning as chat: control characters and bidirectional overrides are stripped rather
 * than escaped, because a mode name appears in a room list next to other people's names and an
 * RTL override there rewrites the rows around it.
 */
export function sanitiseModeName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_MODE_CONFIG.name;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- removing control characters is the point
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u206F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MODE_LIMITS.nameLength);
  return cleaned.length > 0 ? cleaned : DEFAULT_MODE_CONFIG.name;
}

/**
 * Build the `GameModeDef` a custom mode runs under.
 *
 * The trick that makes this cheap: `RoundMode` already reads round length, countdown, player
 * counts and starting cash from its def, and nothing else in the engine cares where a def came
 * from. So a custom mode is the *shipped* mode class with a different def — the same code paths,
 * the same tests, the same server authority.
 */
export function buildCustomDef(config: ModeConfig): GameModeDef {
  const base = getModeDef(config.base);
  if (!base) throw new Error(`Unknown base mode: ${config.base}`);
  return {
    ...base,
    id: `custom:${config.base}`,
    name: config.name,
    description: `${base.name}, tuned by a player.`,
    roundSeconds: config.roundSeconds,
    countdownSeconds: config.countdownSeconds,
    minPlayers: config.minPlayers,
    maxPlayers: config.maxPlayers,
    chaserRatio: config.chaserRatio,
    startingCash: config.gadgetsEnabled ? config.startingCash : 0,
    gadgetsEnabled: config.gadgetsEnabled,
  };
}

/**
 * Instantiate a custom mode.
 *
 * Built per room rather than registered globally: a private room's house rules should not appear
 * in matchmaking, and two rooms running different variants of Freeze Tag at the same time must
 * not overwrite each other in a shared registry.
 */
export function createCustomMode(config: ModeConfig): GameMode {
  const mode = createMode(config.base);
  const def = buildCustomDef(config);
  // The def is the mode's only source of these numbers, so replacing it is the whole override.
  // `readonly` on the interface stops accidental writes elsewhere; this is the deliberate one.
  (mode as { def: GameModeDef }).def = def;
  return mode;
}

/** A short, human-readable summary for the room list. */
export function describeModeConfig(config: ModeConfig): string {
  const base = getModeDef(config.base)?.name ?? config.base;
  const minutes = Math.round(config.roundSeconds / 60);
  const parts = [base, `${minutes} min`, `${Math.round(config.chaserRatio * 100)}% chasers`];
  if (!config.gadgetsEnabled) parts.push('no gadgets');
  return parts.join(' · ');
}
