import { describe, expect, it } from 'vitest';

import { DEFAULT_MOVEMENT } from '../player/config.js';
import { Simulation, TICK_DT } from '../sim/simulation.js';
import { buildJungleWorld } from '../world/jungle.js';
import type { PlayerState } from '../player/state.js';
import {
  CUSTOM_BASES,
  DEFAULT_MODE_CONFIG,
  MODE_LIMITS,
  buildCustomDef,
  createCustomMode,
  describeModeConfig,
  sanitiseModeConfig,
  sanitiseModeName,
} from './custom.js';
import './index.js';

/**
 * The safety argument for letting players author modes, as tests.
 *
 * A custom mode is data, and this file is where "data" is shown to mean it: every number is
 * clamped, an unknown base is refused, and nothing a config can say reaches `MovementConfig`.
 * If any of that stopped being true, letting a stranger's config run on the authoritative server
 * would stop being safe.
 */
describe('sanitising a config', () => {
  it('passes a sensible config through unchanged', () => {
    const config = sanitiseModeConfig({
      name: 'Long Hunt',
      base: 'hunt',
      roundSeconds: 420,
      countdownSeconds: 10,
      minPlayers: 4,
      maxPlayers: 12,
      chaserRatio: 0.25,
      startingCash: 900,
      gadgetsEnabled: true,
    });

    expect(config).toEqual({
      name: 'Long Hunt',
      base: 'hunt',
      roundSeconds: 420,
      countdownSeconds: 10,
      minPlayers: 4,
      maxPlayers: 12,
      chaserRatio: 0.25,
      startingCash: 900,
      gadgetsEnabled: true,
    });
  });

  it('clamps every number into its range rather than refusing the config', () => {
    const config = sanitiseModeConfig({
      roundSeconds: 999_999,
      countdownSeconds: -50,
      minPlayers: 900,
      maxPlayers: 900,
      chaserRatio: 12,
      startingCash: 1e9,
    });

    expect(config.roundSeconds).toBe(MODE_LIMITS.roundSeconds.max);
    expect(config.countdownSeconds).toBe(MODE_LIMITS.countdownSeconds.min);
    expect(config.minPlayers).toBe(MODE_LIMITS.minPlayers.max);
    expect(config.maxPlayers).toBe(MODE_LIMITS.maxPlayers.max);
    expect(config.chaserRatio).toBe(MODE_LIMITS.chaserRatio.max);
    expect(config.startingCash).toBe(MODE_LIMITS.startingCash.max);
  });

  it('survives junk without throwing', () => {
    expect(sanitiseModeConfig(null)).toEqual(DEFAULT_MODE_CONFIG);
    expect(sanitiseModeConfig('nonsense')).toEqual(DEFAULT_MODE_CONFIG);
    expect(sanitiseModeConfig(42)).toEqual(DEFAULT_MODE_CONFIG);
    expect(sanitiseModeConfig({ roundSeconds: 'forever', chaserRatio: Number.NaN }).roundSeconds).toBe(
      DEFAULT_MODE_CONFIG.roundSeconds,
    );
  });

  it('refuses a base that is not on the allow-list', () => {
    expect(sanitiseModeConfig({ base: 'training' }).base).toBe(DEFAULT_MODE_CONFIG.base);
    expect(sanitiseModeConfig({ base: 'parkour' }).base).toBe(DEFAULT_MODE_CONFIG.base);
    expect(sanitiseModeConfig({ base: '../../etc/passwd' }).base).toBe(DEFAULT_MODE_CONFIG.base);
  });

  it('accepts every base it advertises', () => {
    for (const base of CUSTOM_BASES) {
      expect(sanitiseModeConfig({ base }).base, base).toBe(base);
    }
  });

  /**
   * A room whose minimum exceeds its maximum can never start, and would sit in the list forever
   * looking like a bug in matchmaking. Raising the cap keeps the author's stated intent.
   */
  it('never produces a room that cannot fill', () => {
    const config = sanitiseModeConfig({ minPlayers: 10, maxPlayers: 4 });
    expect(config.maxPlayers).toBeGreaterThanOrEqual(config.minPlayers);
  });

  it('keeps gadgets on unless explicitly switched off', () => {
    expect(sanitiseModeConfig({}).gadgetsEnabled).toBe(true);
    expect(sanitiseModeConfig({ gadgetsEnabled: 'no' }).gadgetsEnabled).toBe(true);
    expect(sanitiseModeConfig({ gadgetsEnabled: false }).gadgetsEnabled).toBe(false);
  });

  it('zeroes the round float when gadgets are off, since there is nothing to spend it on', () => {
    const def = buildCustomDef(sanitiseModeConfig({ base: 'hunt', gadgetsEnabled: false, startingCash: 5000 }));
    expect(def.startingCash).toBe(0);
  });
});

describe('sanitising a mode name', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitiseModeName('  Big   Hunt  ')).toBe('Big Hunt');
  });

  it('truncates rather than rejecting a long name', () => {
    expect(sanitiseModeName('x'.repeat(200)).length).toBe(MODE_LIMITS.nameLength);
  });

  it('strips bidirectional overrides, which would rewrite the rows around it in a room list', () => {
    expect(sanitiseModeName('Hunt‮evil')).toBe('Huntevil');
  });

  it('falls back to a default rather than an empty row', () => {
    expect(sanitiseModeName('   ')).toBe(DEFAULT_MODE_CONFIG.name);
    expect(sanitiseModeName(null)).toBe(DEFAULT_MODE_CONFIG.name);
    expect(sanitiseModeName(123)).toBe(DEFAULT_MODE_CONFIG.name);
  });
});

describe('building a custom mode', () => {
  it('runs the shipped mode class with the config’s numbers', () => {
    const config = sanitiseModeConfig({ base: 'freeze-tag', name: 'Quick Freeze', roundSeconds: 90 });
    const mode = createCustomMode(config);

    expect(mode.constructor.name).toBe('FreezeTagMode');
    expect(mode.def.roundSeconds).toBe(90);
    expect(mode.def.name).toBe('Quick Freeze');
    expect(mode.def.id).toBe('custom:freeze-tag');
  });

  it('keeps the base mode’s own flags — a variant cannot turn combat on', () => {
    // `combat` and `tagging` come from the base def and are not in ModeConfig at all, so a
    // config cannot enable punching in a mode that was designed without it.
    const chase = createCustomMode(sanitiseModeConfig({ base: 'kangaroo-chase' }));
    expect(chase.def.combat).toBe(false);
    expect(chase.def.tagging).toBe(true);
  });

  it('leaves two rooms with different rules independent', () => {
    const fast = createCustomMode(sanitiseModeConfig({ base: 'freeze-tag', roundSeconds: 60 }));
    const slow = createCustomMode(sanitiseModeConfig({ base: 'freeze-tag', roundSeconds: 600 }));
    expect(fast.def.roundSeconds).toBe(60);
    expect(slow.def.roundSeconds).toBe(600);
  });

  it('describes itself for the room list', () => {
    const text = describeModeConfig(sanitiseModeConfig({ base: 'hunt', roundSeconds: 300, chaserRatio: 0.25 }));
    expect(text).toContain('The Hunt');
    expect(text).toContain('5 min');
    expect(text).toContain('25%');
  });

  it('says so when gadgets are off', () => {
    expect(describeModeConfig(sanitiseModeConfig({ gadgetsEnabled: false }))).toContain('no gadgets');
  });
});

describe('a custom round actually runs', () => {
  function play(config: unknown, players = 8) {
    const sim = new Simulation({
      level: buildJungleWorld(),
      modeId: 'kangaroo-chase',
      seed: 5,
      modeConfig: sanitiseModeConfig(config),
    });
    for (let i = 0; i < players; i++) sim.addPlayer({ id: `p${i}`, name: `P${i}` });
    sim.stepMany(Math.ceil((sim.mode.def.countdownSeconds + 0.5) / TICK_DT));
    return sim;
  }

  function byRole(sim: Simulation, role: PlayerState['role']): PlayerState[] {
    return [...sim.players.values()].filter((p) => p.role === role);
  }

  it('honours the chaser ratio', () => {
    // Half of eight is four; the default one-in-five would have been two.
    expect(byRole(play({ base: 'kangaroo-chase', chaserRatio: 0.5 }, 8), 'chaser')).toHaveLength(4);
    expect(byRole(play({ base: 'kangaroo-chase', chaserRatio: 0.05 }, 8), 'chaser')).toHaveLength(1);
  });

  it('never leaves a round with nobody to chase, or nobody chasing', () => {
    const sim = play({ base: 'kangaroo-chase', chaserRatio: 0.5 }, 2);
    expect(byRole(sim, 'chaser')).toHaveLength(1);
    expect(byRole(sim, 'runner')).toHaveLength(1);
  });

  it('honours a short round', () => {
    const sim = play({ base: 'kangaroo-chase', roundSeconds: 60, countdownSeconds: 3 });
    sim.stepMany(Math.ceil(61 / TICK_DT));
    expect(sim.finished()).toBe(true);
  });

  it('empties every loadout when gadgets are switched off', () => {
    const sim = play({ base: 'hunt', gadgetsEnabled: false }, 6);
    for (const player of sim.players.values()) {
      if (player.role === 'hunter') continue;
      expect(player.gadgets.slots, player.id).toEqual([null, null, null]);
      expect(player.gadgets.cash, player.id).toBe(0);
    }
  });

  it('closes the shop when gadgets are switched off', () => {
    const sim = play({ base: 'hunt', gadgetsEnabled: false }, 6);
    const survivor = byRole(sim, 'survivor')[0] as PlayerState;
    survivor.gadgets.cash = 99_999;

    expect(sim.shopStock()).toEqual([]);
    expect(sim.purchase(survivor.id, 'steel_vest')).toBe(false);
    expect(survivor.gadgets.armour).toBe(0);
  });

  /**
   * The rule the whole feature rests on. A config describes a *round*; it never describes a
   * body. If this ever fails, a room host could hand themselves a higher jump.
   */
  it('cannot touch how anyone moves', () => {
    const sim = play({ base: 'kangaroo-chase', roundSeconds: 900, chaserRatio: 0.5, startingCash: 5000 });
    for (const player of sim.players.values()) {
      for (const [field, value] of Object.entries(DEFAULT_MOVEMENT)) {
        expect(player.config[field as keyof typeof DEFAULT_MOVEMENT], `${player.id}.${field}`).toBe(value);
      }
    }
  });
});
