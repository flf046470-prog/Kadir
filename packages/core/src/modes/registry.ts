import type { GameMode, GameModeDef, GameModeFactory } from './types.js';

interface Registration {
  def: GameModeDef;
  factory: GameModeFactory;
}

const registry = new Map<string, Registration>();

/**
 * Mode registry. Adding a game mode means implementing `GameMode` and calling this — rooms,
 * networking, HUD and results are all mode-agnostic.
 */
export function registerMode(def: GameModeDef, factory: GameModeFactory): void {
  registry.set(def.id, { def, factory });
}

export function createMode(id: string): GameMode {
  const entry = registry.get(id);
  if (!entry) throw new Error(`Unknown game mode: ${id}`);
  return entry.factory(entry.def);
}

export function hasMode(id: string): boolean {
  return registry.has(id);
}

export function listModes(): GameModeDef[] {
  return [...registry.values()].map((r) => r.def);
}

export function getModeDef(id: string): GameModeDef | undefined {
  return registry.get(id)?.def;
}

/** Test helper — keeps mode registration idempotent across hot reloads. */
export function clearModes(): void {
  registry.clear();
}
