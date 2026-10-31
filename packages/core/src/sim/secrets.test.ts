import { describe, expect, it } from 'vitest';
import { applyMatchStats, evaluateAchievements, recordSecret } from '../progression/achievements.js';
import { SECRETS_PER_MAP } from '../content/achievements.js';
import { createProfile } from '../progression/profile.js';
import { migrateProfile } from '../save/index.js';
import { buildLevel } from '../index.js';
import { createIntent } from '../input/intent.js';
import { SECRET_REACH, Simulation, TICK_DT } from './simulation.js';

const LEVELS = ['jungle-world', 'glacier-world', 'outback-station'];

describe('golden boomerangs', () => {
  it(`every map hides ${SECRETS_PER_MAP}, apart from each other and up a climb`, () => {
    for (const id of LEVELS) {
      const level = buildLevel(id);
      const secrets = level.secrets ?? [];
      expect(secrets, id).toHaveLength(SECRETS_PER_MAP);
      expect(new Set(secrets.map((s) => s.id)).size, id).toBe(SECRETS_PER_MAP);
      for (const s of secrets) expect(s.position.y, `${id} ${s.id}`).toBeGreaterThan(3);
      for (let i = 0; i < secrets.length; i++)
        for (let j = i + 1; j < secrets.length; j++) {
          const a = secrets[i]!.position;
          const b = secrets[j]!.position;
          expect(Math.hypot(a.x - b.x, a.z - b.z), id).toBeGreaterThan(15);
        }
    }
  });

  it('is found by being there, once, and reported in the round result', () => {
    const level = buildLevel('jungle-world');
    const secret = level.secrets![0]!;
    const sim = new Simulation({ level, modeId: 'kangaroo-chase' });
    sim.addPlayer({ id: 'p' });
    sim.setIntent('p', createIntent());
    const player = sim.players.get('p')!;
    const found: string[] = [];
    for (let i = 0; i < 30; i++) {
      player.position.x = secret.position.x;
      player.position.y = secret.position.y;
      player.position.z = secret.position.z;
      player.velocity.x = player.velocity.y = player.velocity.z = 0;
      sim.step();
      for (const e of sim.events.drain()) if (e.type === 'secret') found.push(String(e.data));
    }
    expect(found).toEqual([secret.id]);
    expect(sim.results().players.find((p) => p.playerId === 'p')?.secrets).toEqual([secret.id]);
  });

  it('is not found from further than SECRET_REACH', () => {
    const level = buildLevel('jungle-world');
    const secret = level.secrets![0]!;
    const sim = new Simulation({ level, modeId: 'kangaroo-chase' });
    sim.addPlayer({ id: 'p' });
    sim.setIntent('p', createIntent());
    const player = sim.players.get('p')!;
    let found = 0;
    for (let i = 0; i < 10; i++) {
      player.position.x = secret.position.x + SECRET_REACH + 0.5;
      player.position.y = secret.position.y;
      player.position.z = secret.position.z;
      sim.step();
      found += sim.events.drain().filter((e) => e.type === 'secret').length;
    }
    expect(found).toBe(0);
    expect(TICK_DT).toBeGreaterThan(0);
  });

  it('keeps finds per map, once each, and unlocks the hidden achievements', () => {
    const profile = createProfile('p', 'Roo');
    expect(recordSecret(profile, 'jungle-world', 'boomerang-1')).toBe(true);
    expect(recordSecret(profile, 'jungle-world', 'boomerang-1')).toBe(false);
    expect(recordSecret(profile, 'outback-station', 'boomerang-1')).toBe(true);
    expect(profile.stats.secretsFound).toBe(2);
    expect(evaluateAchievements(profile).map((u) => u.def.id)).toContain('golden_boomerang');
    applyMatchStats(
      profile,
      { modeId: 'kangaroo-chase', levelId: 'jungle-world', durationTicks: 60, winnerIds: [], players: [{ playerId: 'p', name: 'Roo', animalId: 'kangaroo', placement: 1, score: 0, tags: 0, escapes: 0, survivalTicks: 0, bestLapTicks: -1, won: false, secrets: ['boomerang-1', 'boomerang-2'] }] },
      'p',
    );
    expect(profile.secretsFound.sort()).toEqual(['jungle-world:boomerang-1', 'jungle-world:boomerang-2', 'outback-station:boomerang-1']);
  });

  it('takes the stat from the list on load, so an edited stat unlocks nothing', () => {
    const saved = { ...createProfile('p', 'Roo'), stats: { ...createProfile('p', 'Roo').stats, secretsFound: 9 }, secretsFound: ['jungle-world:boomerang-1', 'jungle-world:boomerang-1'] };
    const profile = migrateProfile(JSON.parse(JSON.stringify(saved)), 'p');
    expect(profile.secretsFound).toEqual(['jungle-world:boomerang-1']);
    expect(profile.stats.secretsFound).toBe(1);
    const old = migrateProfile({ version: 3, coins: 10 }, 'p');
    expect(old.secretsFound).toEqual([]);
  });
});
