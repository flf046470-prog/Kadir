import { describe, expect, it } from 'vitest';
// The package entry: levels and modes register themselves when it loads.
import { BODY_DEFS, Bot, Buttons, GOAL_RADIUS, PITCH_HALF_WIDTH, RooBallMode, Simulation, buildLevel, createIntent } from '../index.js';
import type { Body, HillMode } from '../index.js';

const MAPS = ['jungle-world', 'glacier-world', 'outback-station'] as const;

function match(level: string, players = 6, seed = 1): { sim: Simulation; mode: RooBallMode; bots: Bot[] } {
  const sim = new Simulation({ level: buildLevel(level), modeId: 'roo-ball', seed });
  const bots: Bot[] = [];
  for (let i = 0; i < players; i++) {
    sim.addPlayer({ id: `b${i}`, name: `B${i}` });
    bots.push(new Bot(`b${i}`, { skill: 0.7, seed: seed * 10 + i }));
  }
  return { sim, mode: sim.mode as RooBallMode, bots };
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

/** Run until the countdown is over and the round is live. */
function kickOff(sim: Simulation, bots: Bot[]): void {
  for (let t = 0; t < 60 * 10 && sim.mode.state().phase !== 'playing'; t++) play(sim, bots, 1);
  expect(sim.mode.state().phase).toBe('playing');
}

function matchBall(sim: Simulation): Body {
  const ball = sim.bodies.bodies.find((b) => b.kind === 'rooball');
  expect(ball, 'no match ball').toBeDefined();
  return ball as Body;
}

describe('Roo Ball finds a pitch on every map', () => {
  for (const id of MAPS) {
    it(`${id}: two goals a sprint apart on level, open ground`, () => {
      const { sim, mode, bots } = match(id);
      kickOff(sim, bots);
      const pitch = mode.currentPitch;
      expect(pitch).not.toBeNull();
      const [a, b] = pitch!.goals;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      expect(length).toBeGreaterThanOrEqual(22);
      expect(length).toBeLessThanOrEqual(50);
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1.5);
      // The centre spot is between them, on the ground, not in the air or underground.
      expect(Math.hypot(pitch!.centre.x - (a.x + b.x) / 2, pitch!.centre.z - (a.z + b.z) / 2)).toBeLessThan(0.01);
      expect(Math.abs(pitch!.centre.y - (a.y + b.y) / 2)).toBeLessThan(1.5);
    });
  }
});

describe('a Roo Ball match', () => {
  it('splits the room into two even teams, and a late joiner goes to the smaller one', () => {
    const { sim, bots } = match('outback-station', 5);
    kickOff(sim, bots);
    const roles = [...sim.players.values()].map((p) => p.role);
    const red = roles.filter((r) => r === 'red').length;
    const blue = roles.filter((r) => r === 'blue').length;
    expect(red + blue).toBe(5);
    expect(Math.abs(red - blue)).toBe(1);
    sim.addPlayer({ id: 'late', name: 'Late' });
    expect(sim.players.get('late')?.role).toBe(red < blue ? 'red' : 'blue');
  });

  it('scores a ball in a goal for the other team, says so, and restarts from the centre spot', () => {
    const { sim, mode, bots } = match('glacier-world', 2);
    kickOff(sim, bots);
    const ball = matchBall(sim);
    const pitch = mode.currentPitch!;
    // Red defends goals[0]: a ball in it is a goal for blue.
    const mouth = pitch.goals[0];
    sim.bodies.place(ball, { x: mouth.x, y: mouth.y + BODY_DEFS.rooball.radius, z: mouth.z });
    sim.step();
    const goals = sim.events.drain().filter((e) => e.type === 'goal');
    expect(goals).toHaveLength(1);
    expect(goals[0]?.data).toBe('blue');
    expect(mode.score).toEqual({ red: 0, blue: 1 });
    expect(sim.mode.state().tally).toEqual({ red: 0, blue: 1 });
    // Back on the spot and held there through the restart, not left sitting in the net.
    for (let i = 0; i < 30; i++) sim.step();
    expect(Math.hypot(ball.position.x - pitch.centre.x, ball.position.z - pitch.centre.z)).toBeLessThan(0.05);
    // Every player's score is their team's goals.
    for (const p of sim.players.values()) expect(sim.mode.state().scores[p.id]).toBe(p.role === 'blue' ? 1 : 0);
  });

  it('puts a ball that leaves the pitch back on the centre line, level with where it went out', () => {
    const { sim, mode, bots } = match('jungle-world', 2);
    kickOff(sim, bots);
    const ball = matchBall(sim);
    const pitch = mode.currentPitch!;
    const [a, b] = pitch.goals;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / length;
    const uz = (b.z - a.z) / length;
    // A quarter of the way along, far over the touchline.
    const along = -length / 4;
    const out = { x: pitch.centre.x + ux * along + uz * (PITCH_HALF_WIDTH + 6), y: pitch.centre.y + 1, z: pitch.centre.z + uz * along - ux * (PITCH_HALF_WIDTH + 6) };
    sim.bodies.place(ball, out);
    sim.step();
    const back = ball.position;
    const backAlong = (back.x - pitch.centre.x) * ux + (back.z - pitch.centre.z) * uz;
    const backAcross = (back.x - pitch.centre.x) * uz - (back.z - pitch.centre.z) * ux;
    expect(Math.abs(backAcross)).toBeLessThan(0.05);
    expect(Math.abs(backAlong - along)).toBeLessThan(0.05);
    expect(sim.events.drain().some((e) => e.type === 'goal')).toBe(false);
  });

  it('cannot be picked up, however the grab button is pressed', () => {
    const { sim, bots } = match('glacier-world', 2);
    kickOff(sim, bots);
    const ball = matchBall(sim);
    const player = sim.players.get('b0')!;
    player.position = { x: ball.position.x, y: ball.position.y - BODY_DEFS.rooball.radius, z: ball.position.z - 1.2 };
    const intent = createIntent();
    for (let i = 0; i < 20; i++) {
      intent.buttons = i % 4 < 2 ? Buttons.GrabRight | Buttons.GrabLeft : 0;
      intent.tick = sim.tick + 1;
      sim.setIntent('b0', intent, false);
      sim.step();
      expect(ball.holder).toBeNull();
    }
  });

  it('is played: bots find the ball, kick it and score, on every map', () => {
    /**
     * The measurement this mode was tuned against. With a real-sized football, six bots touched it
     * 1–4 times in a round and it slept on the centre spot; with the big ball but no touchlines or
     * arrival it slept 50–94 % of the round. Summed over the three maps rather than asserted per
     * map, so one unlucky kickoff is not a failure — a change that breaks play everywhere is.
     */
    let kicks = 0;
    let goals = 0;
    for (const id of MAPS) {
      for (const seed of [1, 2]) {
        const { sim, bots } = match(id, 6, seed);
        play(sim, bots, 60 * 120, () => {
          for (const e of sim.events.drain()) {
            if (e.type === 'bodyHit' && e.data === 'kick') kicks++;
            if (e.type === 'goal') goals++;
          }
        });
      }
    }
    // Measured at 367 kicks and 22 goals. The broken versions managed about 20 kicks and 0–3 goals
    // over the same six matches, so the bounds sit well clear of both.
    expect(kicks).toBeGreaterThan(180);
    expect(goals).toBeGreaterThanOrEqual(8);
    // Six two-minute matches are 43,200 ticks with bots: measured 2.4 s alone, 4.1 s inside a full
    // `npm run verify` and 5.7 s in one beside a browser capture, against vitest's 5 s default. A
    // limit that close fails on how busy the machine is, not on anything the match did.
  }, 30_000);

  it('draws its goals and pitch on the broadcast view, and nothing before the round', () => {
    const { sim, bots } = match('outback-station', 2);
    expect(sim.mode.state().markers ?? []).toHaveLength(0);
    kickOff(sim, bots);
    const markers = sim.mode.state().markers ?? [];
    expect(markers.filter((m) => m.kind === 'goal').map((m) => m.team).sort()).toEqual(['blue', 'red']);
    expect(markers.filter((m) => m.kind === 'goal').every((m) => m.radius === GOAL_RADIUS)).toBe(true);
    const pitch = markers.find((m) => m.kind === 'pitch');
    expect(pitch?.halfWidth).toBe(PITCH_HALF_WIDTH);
    expect(pitch?.halfLength).toBeGreaterThan(10);
  });

  it('leaves the ball on its spot when the round ends', () => {
    const { sim, mode, bots } = match('glacier-world', 2);
    kickOff(sim, bots);
    const ball = matchBall(sim);
    const home = { ...ball.home };
    play(sim, bots, 120);
    mode.endRound(sim['modeCtx' as keyof Simulation] as never, 'test');
    expect(ball.position).toEqual(home);
  });
});

describe('King of the Hill shows its ring', () => {
  it('publishes the hill as a marker, where the mode says it is', () => {
    const sim = new Simulation({ level: buildLevel('jungle-world'), modeId: 'hill', seed: 2 });
    const bots = [0, 1].map((i) => {
      sim.addPlayer({ id: `h${i}`, name: `H${i}` });
      return new Bot(`h${i}`, { skill: 0.6, seed: i });
    });
    kickOff(sim, bots);
    const mode = sim.mode as HillMode;
    const markers = sim.mode.state().markers ?? [];
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ kind: 'hill', x: mode.hillPosition.x, z: mode.hillPosition.z, radius: mode.hillRadius });
  });
});
