import { describe, expect, it } from 'vitest';
// The package entry: levels and modes register themselves when it loads.
import { Bot, CAGE_FIGHT_DEF, CageFightMode, FIGHT_SECONDS, PhysicsWorld, SurfaceFlags, Simulation, arenaFor, buildLevel, createIntent, fightCard, outsideCage } from '../index.js';
import type { PlayerState } from '../index.js';
import { LOBBY_MODE_IDS } from '../world/level.js';
import { LevelBuilder } from '../world/builder.js';
import { Rand } from '../math/rand.js';
import { vec3 } from '../math/vec3.js';
import { capsuleFits } from '../physics/character.js';

const MAPS = ['jungle-world', 'glacier-world', 'outback-station'] as const;

function match(level: string, players: number, seed = 1): { sim: Simulation; mode: CageFightMode; bots: Bot[] } {
  const sim = new Simulation({ level: buildLevel(level), modeId: 'cage-fight', seed });
  const bots: Bot[] = [];
  for (let i = 0; i < players; i++) {
    sim.addPlayer({ id: `b${i}`, name: `B${i}` });
    bots.push(new Bot(`b${i}`, { skill: 0.7, seed: seed * 10 + i }));
  }
  return { sim, mode: sim.mode as CageFightMode, bots };
}

function play(sim: Simulation, bots: Bot[], ticks: number, onTick?: () => void): void {
  for (let t = 0; t < ticks; t++) {
    for (const bot of bots) {
      const self = sim.players.get(bot.playerId);
      if (!self) continue;
      sim.setIntent(bot.playerId, bot.think(self, sim.players.values(), sim.level, 1 / 60, sim.mode.objectiveFor?.(self) ?? null), false);
    }
    sim.step();
    onTick?.();
  }
}

/** Idle players (no bots) until the first fight's bell has rung. */
function toTheBell(sim: Simulation, mode: CageFightMode): void {
  for (let t = 0; t < 60 * 15 && mode.currentFight.stage !== 'fight'; t++) sim.step();
  expect(mode.currentFight.stage).toBe('fight');
}

describe('the fight card', () => {
  it('runs 1v1 up to the smaller team, and no further than 4v4', () => {
    expect(fightCard(1, 1)).toEqual([1]);
    expect(fightCard(2, 3)).toEqual([1, 2]);
    expect(fightCard(4, 4)).toEqual([1, 2, 3, 4]);
    expect(fightCard(6, 6)).toEqual([1, 2, 3, 4]);
    expect(fightCard(3, 0)).toEqual([]);
    expect(CAGE_FIGHT_DEF.maxPlayers).toBe(2 * 4);
  });

  it('has a door in every lobby', () => {
    expect(LOBBY_MODE_IDS).toContain('cage-fight');
    for (const id of MAPS) expect(buildLevel(id).portals.some((p) => p.modeId === 'cage-fight'), id).toBe(true);
  });
});

describe('every map has a cage', () => {
  for (const id of MAPS) {
    it(`${id}: a fence nobody walks or hops through, on a floor that sits on the ground`, () => {
      const level = buildLevel(id);
      const arena = arenaFor(level);
      expect(level.arenas).toHaveLength(1);
      expect(arena.fenceHeight).toBeGreaterThan(3);
      const world = new PhysicsWorld(level.colliders);

      // The fence: eight panels, no grip on any of them.
      const panels = level.colliders.filter((c) => c.kind === 'box' && c.drawAs === 'cage');
      expect(panels).toHaveLength(8);
      for (const panel of panels) expect(panel.surface.flags & SurfaceFlags.NoGrip).not.toBe(0);

      // Run at the fence from the middle, in eight directions, hopping: nobody comes out.
      for (let i = 0; i < 8; i++) {
        const sim = new Simulation({ level, modeId: 'boxing', seed: 3 });
        const p = sim.addPlayer({ id: 'p' });
        p.position.x = arena.center.x;
        p.position.y = arena.center.y + 0.05;
        p.position.z = arena.center.z;
        const intent = createIntent();
        intent.lookYaw = (i / 8) * Math.PI * 2 + 0.2;
        intent.moveZ = 1;
        for (let t = 0; t < 60 * 4; t++) {
          intent.buttons = t % 20 < 2 ? 1 : 0;
          sim.setIntent('p', intent);
          sim.step();
        }
        expect(outsideCage(arena, p.position), `ran out at ${i}`).toBe(false);
      }

      // Room round it to stand and watch: nothing solid at head height between the fence and 3 m out.
      for (let a = 0; a < 32; a++) {
        const angle = (a / 32) * Math.PI * 2;
        for (const r of [arena.radius + 1.5, arena.radius + 2.4, arena.radius + 3]) {
          const point = { x: arena.center.x + Math.sin(angle) * r, y: arena.center.y + 1.2, z: arena.center.z + Math.cos(angle) * r };
          expect(world.isPointInsideSolid(point), `blocked cageside at ${point.x.toFixed(1)}, ${point.z.toFixed(1)}`).toBe(false);
        }
      }

      // No door stands on the cage or its floor.
      const reach = (arena.radius + 1.2) * Math.SQRT2;
      for (const portal of level.portals) {
        expect(Math.hypot(portal.position.x - arena.center.x, portal.position.z - arena.center.z)).toBeGreaterThan(reach + portal.radius);
      }
    });
  }
});

describe('a cage on a map', () => {
  it('leaves nothing standing on the fight floor', () => {
    // A cage clears loose boulders and props from its footprint, and nothing else; a trunk, a crate
    // or a fallen log there would stand through the floor in the middle of the fight.
    for (const id of MAPS) {
      const level = buildLevel(id);
      const arena = arenaFor(level);
      const world = new PhysicsWorld(level.colliders);
      let blocked = 0;
      for (let dx = -arena.radius; dx <= arena.radius; dx += 0.5) {
        for (let dz = -arena.radius; dz <= arena.radius; dz += 0.5) {
          const at = vec3(arena.center.x + dx, arena.center.y + 0.05, arena.center.z + dz);
          if (Math.hypot(dx, dz) > arena.radius - 0.6) continue;
          if (!capsuleFits(world, at, { radius: 0.35, height: 1.6 })) blocked++;
        }
      }
      expect(blocked, id).toBe(0);
    }
  });

  it('takes a boulder it clears away with the rock drawn on it', () => {
    // A sphere is cleared if it reaches the footprint, a prop only if it stands in it, so a big
    // boulder just outside lost its collider and kept its drawn rock: a rock you walk through.
    const b = new LevelBuilder(new Rand(1));
    b.box(vec3(0, -0.5, 0), vec3(40, 0.5, 40), 'dirt');
    const edge = 6 + 1.2;
    b.sphere(vec3(edge + 1.5, 1.1, 0), 2, 'rock');
    b.prop('rock', vec3(edge + 1.5, 0, 0), 0, 2, 1);
    b.prop('bush', vec3(edge + 3, 0, 0));
    b.cage(0, 0, 0, 'jungle');
    expect(b.colliders.filter((c) => c.kind === 'sphere')).toHaveLength(0);
    expect(b.props.map((p) => p.kind)).toEqual(['bush']);
  });
});

describe('Cage Fight', () => {
  it('splits the room into two corners and calls a 1v1 first', () => {
    const { sim, mode } = match('jungle-world', 6);
    toTheBell(sim, mode);
    const corners = [...sim.players.keys()].map((id) => mode.cornerOf(id));
    expect(corners.filter((c) => c === 'red')).toHaveLength(3);
    expect(corners.filter((c) => c === 'blue')).toHaveLength(3);
    const fight = mode.currentFight;
    expect(fight.size).toBe(1);
    expect(fight.fighters).toHaveLength(2);
    expect(new Set(fight.fighters.map((id) => mode.cornerOf(id))).size).toBe(2);
    // Fighters are in the cage wearing their corner; everybody else is outside it, watching.
    for (const p of sim.players.values()) {
      if (fight.fighters.includes(p.id)) {
        expect(p.role).toBe(mode.cornerOf(p.id));
        expect(outsideCage(mode.currentArena, p.position)).toBe(false);
      } else {
        expect(p.role).toBe('spectator');
        expect(outsideCage(mode.currentArena, p.position)).toBe(true);
      }
    }
  });

  it('only lets the two corners of the fight in progress hit each other', () => {
    const { sim, mode } = match('jungle-world', 6);
    for (let t = 0; t < 60 * 15 && mode.currentFight.stage === 'intro' && mode.currentFight.number === 0; t++) sim.step();
    const during = (check: () => void): void => check();
    // In the walk-out nobody can hit anybody.
    for (let t = 0; t < 60 * 15 && !(mode.currentFight.number > 0 && mode.currentFight.stage === 'intro'); t++) sim.step();
    const [a, b] = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState);
    expect(mode.canDamage(a as PlayerState, b as PlayerState)).toBe(false);
    toTheBell(sim, mode);
    during(() => {
      const fighters = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState);
      const [x, y] = fighters as [PlayerState, PlayerState];
      expect(mode.canDamage(x, y)).toBe(true);
      const cageside = [...sim.players.values()].filter((p) => !fighters.includes(p));
      const mate = cageside.find((p) => mode.cornerOf(p.id) === mode.cornerOf(x.id)) as PlayerState;
      const rival = cageside.find((p) => mode.cornerOf(p.id) !== mode.cornerOf(x.id)) as PlayerState;
      // Cageside cannot hit in or be hit, whichever corner.
      expect(mode.canDamage(x, rival)).toBe(false);
      expect(mode.canDamage(rival, x)).toBe(false);
      expect(mode.canDamage(mate, y)).toBe(false);
    });
  });

  it('never lets a fighter hit a team-mate', () => {
    const { sim, mode } = match('jungle-world', 8);
    // Run to a 2v2 or bigger.
    for (let t = 0; t < 60 * 120 && !(mode.currentFight.size >= 2 && mode.currentFight.stage === 'fight'); t++) sim.step();
    const fighters = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState);
    const red = fighters.filter((p) => mode.cornerOf(p.id) === 'red');
    expect(red.length).toBeGreaterThanOrEqual(2);
    expect(mode.canDamage(red[0] as PlayerState, red[1] as PlayerState)).toBe(false);
  });

  it('turns fighters to the other corner and the bench to the cage, and tells each client so', () => {
    // A flat-screen client sends its view's yaw every tick, so a facing the mode sets is undone a
    // tick later unless the client hears of it. Seen in a practice screenshot: a player put
    // cageside stood with the cage behind them.
    const { sim, mode } = match('outback-station', 5);
    const last = new Map<string, number>();
    const count = new Map<string, number>();
    for (let t = 0; t < 60 * 15 && mode.currentFight.stage !== 'fight'; t++) {
      sim.step();
      for (const event of sim.events.drain()) {
        if (event.type !== 'placed') continue;
        last.set(event.playerId, event.data as number);
        count.set(event.playerId, (count.get(event.playerId) ?? 0) + 1);
      }
    }
    expect(mode.currentFight.stage).toBe('fight');
    const { center } = mode.currentArena;
    for (const p of sim.players.values()) {
      const yaw = last.get(p.id);
      expect(yaw, p.id).toBeTypeOf('number');
      // The players here send no intent of their own, so the simulation's default (yaw 0) turns
      // them back a tick later, exactly as a client that did not listen would: the event is what
      // counts.
      const facing = yaw as number;
      // Fighters face the other corner, which is across the middle; the bench faces the middle.
      const toCentre = Math.atan2(center.x - p.position.x, center.z - p.position.z);
      const off = Math.abs(Math.atan2(Math.sin(toCentre - facing), Math.cos(toCentre - facing)));
      expect(off, `${p.id} (${p.role}) faces ${off.toFixed(2)} rad off the cage's middle`).toBeLessThan(p.role === 'spectator' ? 0.05 : 0.6);
    }
    // Once a placement: the spawn, then the corner or the bench.
    for (const p of sim.players.values()) expect(count.get(p.id), p.id).toBeLessThanOrEqual(2);
  });

  it('keeps the score on one line', () => {
    const { sim, mode } = match('jungle-world', 2);
    toTheBell(sim, mode);
    expect(mode.state().headline).toContain('RED\u00a00\u00a0–\u00a00\u00a0BLUE');
  });

  it('ends a fight on a knockout, scores it to the corner left standing, and calls the next', () => {
    const { sim, mode } = match('jungle-world', 4);
    toTheBell(sim, mode);
    const [a, b] = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState) as [PlayerState, PlayerState];
    const winner = mode.cornerOf(a.id);
    b.health = 0;
    b.alive = false;
    b.lastTaggedBy = a.id;
    sim.step();
    expect(mode.currentFight.stage).toBe('decided');
    expect(mode.score[winner as 'red' | 'blue']).toBe(1);
    // The loser is out of the cage and alive again, watching.
    expect(b.alive).toBe(true);
    expect(b.role).toBe('spectator');
    expect(outsideCage(mode.currentArena, b.position)).toBe(true);
    // Next on the card: a 2v2, with the two who sat out the 1v1 in it.
    for (let t = 0; t < 60 * 5 && mode.currentFight.stage !== 'intro'; t++) sim.step();
    expect(mode.currentFight.size).toBe(2);
    expect(mode.currentFight.number).toBe(2);
  });

  it('puts a fighter who leaves the cage out of the fight', () => {
    const { sim, mode } = match('jungle-world', 2);
    toTheBell(sim, mode);
    const [a] = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState) as [PlayerState];
    const arena = mode.currentArena;
    a.position.x = arena.center.x + arena.radius + 2;
    sim.step();
    expect(mode.currentFight.standing).not.toContain(a.id);
    expect(mode.currentFight.stage).toBe('decided');
  });

  it('credits a ring-out only to the other corner of this fight, and tells the fighter quietly', () => {
    // `lastTaggedBy` outlives a fight. A fighter last hit by somebody now on the bench, who then
    // steps out of the cage untouched, scored that bench player a knockout; and the victim's own
    // client got it as a knockout punch they had thrown, with the hardest haptic in the game.
    const { sim, mode } = match('jungle-world', 4);
    toTheBell(sim, mode);
    const [a] = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState) as [PlayerState];
    const bench = [...sim.players.values()].find((p) => !mode.currentFight.fighters.includes(p.id) && mode.cornerOf(p.id) !== mode.cornerOf(a.id)) as PlayerState;
    sim.events.drain();
    a.lastTaggedBy = bench.id;
    a.position.x = mode.currentArena.center.x + mode.currentArena.radius + 2;
    sim.step();
    expect(mode.currentFight.standing).not.toContain(a.id);
    expect(mode.state().scores[bench.id] ?? 0).toBe(0);
    const events = sim.events.drain();
    expect(events.filter((e) => e.type === 'punchHit')).toEqual([]);
    expect(events.some((e) => e.type === 'roleChange' && e.playerId === a.id && e.data === 'spectator')).toBe(true);
  });

  it('starts every fight with nobody holding a punch from the last one', () => {
    const { sim, mode } = match('jungle-world', 4);
    toTheBell(sim, mode);
    const [a, b] = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState) as [PlayerState, PlayerState];
    a.lastTaggedBy = b.id;
    b.health = 0;
    b.alive = false;
    b.lastTaggedBy = a.id;
    for (let t = 0; t < 60 * 10 && !(mode.currentFight.number === 2 && mode.currentFight.stage === 'intro'); t++) sim.step();
    expect(mode.currentFight.fighters).toContain(a.id);
    expect(a.lastTaggedBy).toBeNull();
  });

  it('decides a fight nobody finishes on who is left standing', () => {
    const { sim, mode } = match('jungle-world', 6);
    for (let t = 0; t < 60 * 120 && !(mode.currentFight.size === 2 && mode.currentFight.stage === 'fight'); t++) sim.step();
    const fighters = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState);
    const blue = fighters.filter((p) => mode.cornerOf(p.id) === 'blue');
    const before = mode.score.red;
    // Two red against one blue at the bell, the two reds with less health between them than the
    // one blue has: standing counts before health, so red takes it.
    const out = blue[0] as PlayerState;
    out.alive = false;
    out.health = 0;
    for (const p of fighters) if (mode.cornerOf(p.id) === 'red') p.health = 30;
    for (let t = 0; t < 60 * (FIGHT_SECONDS + 1) && mode.currentFight.stage === 'fight'; t++) sim.step();
    expect(mode.score.red).toBe(before + 1);
  });

  it('decides a fight level on fighters by the health they have left', () => {
    const { sim, mode } = match('jungle-world', 4);
    toTheBell(sim, mode);
    const [a, b] = mode.currentFight.fighters.map((id) => sim.players.get(id) as PlayerState) as [PlayerState, PlayerState];
    a.health = 40;
    b.health = 70;
    for (let t = 0; t < 60 * (FIGHT_SECONDS + 1) && mode.currentFight.stage === 'fight'; t++) sim.step();
    const winner = mode.cornerOf(b.id) as 'red' | 'blue';
    expect(mode.score[winner]).toBe(1);
    expect(mode.score[winner === 'red' ? 'blue' : 'red']).toBe(0);
  });

  it('rotates the bench: an odd room fights in turns, not the same few every time', () => {
    const { sim, mode } = match('jungle-world', 5);
    const seen = new Map<string, number>();
    let last = 0;
    for (let t = 0; t < 60 * 280; t++) {
      if (mode.currentFight.stage === 'fight' && mode.currentFight.number !== last) {
        last = mode.currentFight.number;
        for (const id of mode.currentFight.fighters) seen.set(id, (seen.get(id) ?? 0) + 1);
        // Finish it at once: knock out the whole blue corner.
        for (const id of mode.currentFight.fighters) {
          const p = sim.players.get(id) as PlayerState;
          if (mode.cornerOf(id) === 'blue') {
            p.alive = false;
            p.health = 0;
          }
        }
      }
      sim.step();
      if (mode.finished()) break;
    }
    expect(last).toBeGreaterThan(8);
    const counts = [...sim.players.keys()].map((id) => seen.get(id) ?? 0);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    // Fights of one and two alternate, so the three-strong corner sits one out in turn.
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(Math.ceil(last / 2));
  });

  it('plays with bots: every format, decided by knockouts, nobody hit by their own corner', () => {
    /**
     * Measured with eight bots over two 300 s rounds a map before this was written: 30–35 fights
     * in all, every size, 26–33 of them settled by a knockout, median fight 8–9 s, and in 286,000
     * fighter-ticks not one spent outside the fence or hit by a team-mate.
     */
    const { sim, mode, bots } = match('jungle-world', 8, 1);
    const sizes = new Set<number>();
    let friendly = 0;
    let decided = 0;
    let outside = 0;
    play(sim, bots, 60 * 180, () => {
      const fight = mode.currentFight;
      if (fight.stage === 'fight') {
        sizes.add(fight.size);
        for (const id of fight.standing) if (outsideCage(mode.currentArena, (sim.players.get(id) as PlayerState).position)) outside++;
      }
      for (const e of sim.events.drain()) {
        if (e.type === 'punchHit' && e.data !== 'knockout' && e.otherId && mode.cornerOf(e.playerId) === mode.cornerOf(e.otherId)) friendly++;
        if (e.type === 'roundState' && (e.data === 'fight:red' || e.data === 'fight:blue')) decided++;
      }
    });
    expect([...sizes].sort()).toEqual([1, 2, 3, 4]);
    expect(decided).toBeGreaterThan(4);
    expect(friendly).toBe(0);
    expect(outside).toBe(0);
  });
});
