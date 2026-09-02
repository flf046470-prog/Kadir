import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation.js';
import { buildJungleWorld } from '../world/jungle.js';
import { Bot, botName } from './bot.js';
import '../modes/index.js';

const level = buildJungleWorld();

describe('bots', () => {
  it('drive the real movement code and cover ground', () => {
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 31 });
    const bots = [0, 1, 2, 3].map((i) => {
      sim.addPlayer({ id: `bot${i}`, name: botName(i) });
      return new Bot(`bot${i}`, { skill: 0.6, seed: 100 + i });
    });

    const start = new Map([...sim.players].map(([id, p]) => [id, { ...p.position }]));
    for (let tick = 0; tick < 60 * 12; tick++) {
      for (const bot of bots) {
        const self = sim.players.get(bot.playerId);
        if (!self) continue;
        sim.setIntent(bot.playerId, bot.think(self, sim.players.values(), level, 1 / 60), false);
      }
      sim.step();
    }

    let moved = 0;
    for (const [id, from] of start) {
      const player = sim.players.get(id);
      if (!player) continue;
      const distance = Math.hypot(player.position.x - from.x, player.position.z - from.z);
      if (distance > 5) moved++;
      expect(Number.isFinite(player.position.x)).toBe(true);
      expect(player.position.y).toBeGreaterThan(level.killPlaneY);
    }
    expect(moved).toBeGreaterThanOrEqual(3);
  });

  it('produce tags over a full round, exercising the chase loop end to end', () => {
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 77 });
    const bots = [0, 1, 2, 3, 4, 5].map((i) => {
      sim.addPlayer({ id: `bot${i}`, name: botName(i) });
      return new Bot(`bot${i}`, { skill: 0.9, seed: 500 + i });
    });

    let tags = 0;
    for (let tick = 0; tick < 60 * 90; tick++) {
      for (const bot of bots) {
        const self = sim.players.get(bot.playerId);
        if (!self) continue;
        sim.setIntent(bot.playerId, bot.think(self, sim.players.values(), level, 1 / 60), false);
      }
      sim.step();
      tags += sim.events.drain().filter((e) => e.type === 'tag').length;
    }
    expect(sim.mode.state().phase).toBe('playing');
    expect(tags).toBeGreaterThan(0);
  });
});
