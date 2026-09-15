import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation.js';
import { buildJungleWorld } from '../world/jungle.js';
import { Buttons } from '../input/intent.js';
import { Bot, botName } from './bot.js';
import type { PlayerState } from '../player/state.js';
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

/**
 * Who a bot decides to go after.
 *
 * Written after a real Conversion Duel match where two kangaroo bots failed to catch a human who
 * stood perfectly still for forty-eight seconds. `pickTarget` splits the world into "threat" and
 * "not a threat", and it decides that from two roles only:
 *
 *     const chasing = self.role === 'chaser' || self.role === 'infected';
 *     const otherIsThreat = other.role === 'chaser' || other.role === 'infected';
 *
 * Every other role in the game falls on the "not a threat" side, which is wrong in three separate
 * ways rather than one. These tests state what the intent obviously was, so the failures are
 * visible as failures instead of as a mode that plays badly for no stated reason.
 *
 * Asserted on the *heading the bot asks for* rather than on where it ends up, because a bot that
 * wants the right thing and is blocked by a tree is not the bug being hunted here.
 */
/**
 * Who a bot decides to go after.
 *
 * Written after a real Conversion Duel match where two kangaroo bots failed to catch a human who
 * stood perfectly still for forty-eight seconds. `pickTarget` splits the world into "threat" and
 * "not a threat" from two roles only:
 *
 *     const chasing = self.role === 'chaser' || self.role === 'infected';
 *     const otherIsThreat = other.role === 'chaser' || other.role === 'infected';
 *     if (chasing === otherIsThreat) continue;
 *
 * Every other role lands on the "not a threat" side, and the equality test then throws away the
 * pairs where *neither* side is one of those two. The Hunt names its roles `hunter` and `survivor`,
 * so both are discarded and neither ever sees the other.
 *
 * Measured by moving the target and watching whether the heading follows it. An earlier version
 * checked one placement and reported a pass for a case that turned out to be a bot wandering in
 * roughly the right direction with no target at all — the wander heading and the "chase" heading
 * were the same number to two decimal places, which is what gave it away.
 */
describe('bot target selection', () => {
  type Reaction = 'toward' | 'away' | 'ignores';

  /**
   * Settle the bot's heading with the target at a fixed offset, holding both still.
   *
   * `lookYaw` turns at a bounded rate — about a tenth of the remaining angle per frame — so a
   * single call mostly reports where the bot was already facing.
   */
  function settled(selfRole: string, otherRole: string, targetZ: number, invuln: number): number {
    const sim = new Simulation({ level, modeId: 'kangaroo-chase', seed: 7 });
    const self = sim.addPlayer({ id: 'self', name: 'Self' }) as PlayerState;
    const other = sim.addPlayer({ id: 'other', name: 'Other' }) as PlayerState;
    self.role = selfRole as PlayerState['role'];
    other.role = otherRole as PlayerState['role'];
    other.invulnTimer = invuln;

    const bot = new Bot('self', { skill: 1, seed: 5 });
    let yaw = 0;
    for (let tick = 0; tick < 90; tick++) {
      self.yaw = yaw;
      self.position.x = 0;
      self.position.z = 0;
      other.position.x = 0;
      other.position.y = self.position.y;
      other.position.z = targetZ;
      yaw = bot.think(self, sim.players.values(), level, 1 / 60).lookYaw;
    }
    return Math.atan2(Math.sin(yaw), Math.cos(yaw));
  }

  /**
   * Does the bot track the target at all, and which way?
   *
   * Run twice with the target in front and behind. A bot that reacts to it turns with it; a bot
   * that has no target at all settles on the same wander heading both times, which is exactly the
   * false pass this replaces.
   */
  function reaction(selfRole: string, otherRole: string, invuln = 0): Reaction {
    const front = settled(selfRole, otherRole, 10, invuln);
    const behind = settled(selfRole, otherRole, -10, invuln);
    const near = (yaw: number, to: number): boolean =>
      Math.abs(Math.atan2(Math.sin(yaw - to), Math.cos(yaw - to))) < 0.7;

    if (near(front, 0) && near(behind, Math.PI)) return 'toward';
    if (near(front, Math.PI) && near(behind, 0)) return 'away';
    return 'ignores';
  }

  it('sends a chaser at a runner', () => {
    // The one pairing the two-role test happens to cover, here so the rest read as bugs rather
    // than as this test measuring the wrong thing.
    expect(reaction('chaser', 'runner')).toBe('toward');
  });

  it('makes a runner flee a chaser', () => {
    expect(reaction('runner', 'chaser')).toBe('away');
  });

  it('sends a hunter at a survivor', () => {
    // The Hunt's roles are named `hunter` and `survivor`, and neither is in the two-role test, so
    // the pair is discarded and the hunter wanders past the people it is meant to be hunting.
    expect(reaction('hunter', 'survivor')).toBe('toward');
  });

  it('makes a survivor flee a hunter', () => {
    expect(reaction('survivor', 'hunter')).toBe('away');
  });

  it('ignores a player already locked in a bout', () => {
    // Conversion Duel puts both fighters on role `fighter` for twenty seconds and they cannot be
    // caught during it. Chasing one means every kangaroo nearby spends the bout pursuing someone
    // it is incapable of catching while the actual humans go unbothered.
    expect(reaction('chaser', 'fighter')).toBe('ignores');
  });

  it('keeps closing on a runner who is briefly untouchable', () => {
    /**
     * The opposite of what this test first asserted, and the existing end-to-end test is what
     * corrected it.
     *
     * Skipping immune prey sounded right — why chase someone you cannot tag? — and measured
     * terribly: runners pick up short immunities constantly, so a chaser abandoned each target
     * mid-pursuit and the nearest chaser-to-runner distance went from a few metres to seventy.
     * A full round produced no tags at all.
     *
     * Immunity lasts a second or two. Closing the distance so you arrive as it ends is the whole
     * point of a chase.
     */
    expect(reaction('chaser', 'runner', 3)).toBe('toward');
  });
});

/**
 * Bots and the verb their role is built on.
 *
 * Every one of these is a mode that could not be lost to the AI, because the bot never pressed the
 * button the mode is about. They are grouped together because they are one mistake: `think` only
 * ever produced movement — jump, sprint, grab — and the game has three roles whose whole job is
 * something else.
 */
describe('bots use their role’s weapon', () => {
  /** Run a mode with all-bot players; returns the simulation and the tags seen along the way. */
  function runBots(
    modeId: string,
    playerCount: number,
    seconds: number,
    skill = 0.8,
  ): { sim: Simulation; tags: number; fireButtonPresses: number } {
    const sim = new Simulation({ level, modeId, seed: 77 });
    const bots: Bot[] = [];
    for (let i = 0; i < playerCount; i++) {
      sim.addPlayer({ id: `bot${i}`, name: botName(i) });
      bots.push(new Bot(`bot${i}`, { skill, seed: 500 + i }));
    }
    // Counted from the event stream as the round runs, the way the chase test above does: the
    // score sheet is built at the final bell and reads zero while the round is still going.
    let tags = 0;
    let fireButtonPresses = 0;
    for (let tick = 0; tick < 60 * seconds; tick++) {
      for (const bot of bots) {
        const self = sim.players.get(bot.playerId);
        if (!self) continue;
        const intent = bot.think(self, sim.players.values(), level, 1 / 60);
        if (intent.buttons & Buttons.UseGadget) fireButtonPresses++;
        sim.setIntent(bot.playerId, intent, false);
      }
      sim.step();
      tags += sim.events.drain().filter((e) => e.type === 'tag').length;
    }
    return { sim, tags, fireButtonPresses };
  }

  it('boxes in a Conversion Duel bout instead of waiting out the clock', () => {
    /**
     * Conversion Duel's premise is that a catch starts a fistfight, and the bots did not throw a
     * punch: every bot bout ran its full twenty seconds with both fighters untouched on 100 health
     * and was settled by the tiebreak. Measured over six 300-second rounds before this, bouts
     * decided by knockout: zero of forty-seven.
     *
     * Driven as a real bout rather than a whole round, so the assertion is about the fighting and
     * not about whether this seed happened to produce a catch. Asserted on damage, because
     * pressing the punch button is exactly what used to do nothing at all.
     */
    const sim = new Simulation({ level, modeId: 'duel', seed: 11 });
    for (let i = 0; i < 6; i++) sim.addPlayer({ id: `bot${i}`, name: botName(i) });
    sim.stepMany(60 * 8);

    const kangaroo = [...sim.players.values()].find((p) => p.role === 'chaser');
    const human = [...sim.players.values()].find((p) => p.role === 'runner');
    expect(kangaroo && human).toBeTruthy();
    if (!kangaroo || !human) return;

    // Walk them together so the catch fires and the bout starts.
    human.position.x = kangaroo.position.x + 0.4;
    human.position.y = kangaroo.position.y;
    human.position.z = kangaroo.position.z;
    kangaroo.invulnTimer = human.invulnTimer = 0;
    kangaroo.tagCooldown = human.tagCooldown = 0;
    sim.stepMany(2);
    expect(kangaroo.role).toBe('fighter');
    expect(human.role).toBe('fighter');

    const fighters = [kangaroo, human].map((p) => new Bot(p.id, { skill: 0.9, seed: 11 + p.id.length }));
    let punchHits = 0;
    for (let tick = 0; tick < 60 * 12; tick++) {
      for (const bot of fighters) {
        const self = sim.players.get(bot.playerId);
        if (!self) continue;
        sim.setIntent(bot.playerId, bot.think(self, sim.players.values(), level, 1 / 60), false);
      }
      sim.step();
      punchHits += sim.events.drain().filter((e) => e.type === 'punchHit').length;
    }

    expect(punchHits).toBeGreaterThan(0);
    // Somebody is visibly worse off than they started — a bout that ends level is a bout nobody
    // fought, and that is what the tiebreak used to have to adjudicate.
    const lowest = Math.min(kangaroo.health, human.health);
    expect(lowest).toBeLessThan(100);
  });

  it('paces itself instead of punching on an empty tank', () => {
    /**
     * A punch thrown below the stamina cost lands at 40% damage (`resolvePunches` scales it), so a
     * bot that swings regardless spends a bout doing almost nothing and loses to one that waits
     * two seconds for its wind back.
     */
    const sim = new Simulation({ level, modeId: 'duel', seed: 11 });
    for (let i = 0; i < 6; i++) sim.addPlayer({ id: `bot${i}`, name: botName(i) });
    sim.stepMany(60 * 8);
    const [a, b] = [...sim.players.values()];
    if (!a || !b) return;
    a.role = 'fighter';
    b.role = 'fighter';
    b.position.x = a.position.x + 0.8;
    b.position.y = a.position.y;
    b.position.z = a.position.z;

    const punchMask = Buttons.PunchLeft | Buttons.PunchRight;
    const swings = (stamina: number): number => {
      const bot = new Bot(a.id, { skill: 0.9, seed: 21 });
      a.stamina = stamina;
      let n = 0;
      for (let i = 0; i < 120; i++) {
        a.stamina = stamina; // held there; the mode regenerates it every tick
        if (bot.think(a, sim.players.values(), level, 1 / 60).buttons & punchMask) n++;
      }
      return n;
    };
    expect(swings(100)).toBeGreaterThan(0);
    expect(swings(5)).toBe(0);
  });

  it('closes the distance rather than swinging at air', () => {
    // A fighter placed out of reach must walk in. Without this the bots stand at the edge of the
    // ring throwing punches that land on nothing, which looks identical to not punching at all.
    const sim = new Simulation({ level, modeId: 'duel', seed: 11 });
    for (let i = 0; i < 6; i++) sim.addPlayer({ id: `bot${i}`, name: botName(i) });
    sim.stepMany(60 * 8);
    const [a, b] = [...sim.players.values()];
    if (!a || !b) return;
    a.role = 'fighter';
    b.role = 'fighter';
    b.position.x = a.position.x + 6;
    b.position.y = a.position.y;
    b.position.z = a.position.z;

    const bot = new Bot(a.id, { skill: 0.8, seed: 4 });
    const far = bot.think(a, sim.players.values(), level, 1 / 60);
    expect(far.moveZ).toBeGreaterThan(0);

    b.position.x = a.position.x + 0.8;
    const near = bot.think(a, sim.players.values(), level, 1 / 60);
    expect(near.moveZ).toBe(0);
  });

  it('fires the hunter’s rifle, so The Hunt can actually be lost', () => {
    /**
     * The Hunt arms one player with a rifle and gives everyone else four minutes to live. A bot
     * hunter never used it: measured over three 180-second rounds before this, survivors downed by
     * a bot hunter was zero every round, with the hunter standing 0.0 m from its prey. The round
     * always ran to time and the survivors always won.
     */
    const { sim, fireButtonPresses } = runBots('hunt', 6, 150);
    expect(fireButtonPresses).toBeGreaterThan(0);
    const downed = [...sim.players.values()].filter((p) => p.role === 'survivor' && !p.alive).length;
    const spectating = [...sim.players.values()].filter((p) => p.role === 'spectator').length;
    expect(downed + spectating).toBeGreaterThan(0);
  });

  it('does not fire a gadget it is not holding', () => {
    // Kangaroo Chase issues nobody a weapon, so a bot pressing the fire button there would be a
    // bot pressing a button that cannot mean anything — and the tag loop must still work.
    const { sim, tags, fireButtonPresses } = runBots('kangaroo-chase', 6, 90, 0.9);
    for (const player of sim.players.values()) {
      expect(player.gadgets.slots.filter(Boolean)).toHaveLength(0);
    }
    expect(fireButtonPresses).toBe(0);
    // And the chase itself still works, so the gadget check did not cost the bots their day job.
    expect(tags).toBeGreaterThan(0);
  });

  /**
   * Firing discipline, tested on the intent rather than on a whole round.
   *
   * A bot that fires at anything it can see empties a rifle across the map on the first frame, and
   * a hunter you cannot break away from is not a mode. Each of these places the prey deliberately:
   * inside the bot's awareness radius, which is what makes it a target at all, but failing one
   * other condition.
   */
  describe('a bot with a rifle', () => {
    function armedHunter(): { sim: Simulation; hunter: PlayerState; prey: PlayerState; bot: Bot } | null {
      const sim = new Simulation({ level, modeId: 'hunt', seed: 5 });
      sim.addPlayer({ id: 'a', name: 'A' });
      sim.addPlayer({ id: 'b', name: 'B' });
      sim.stepMany(60 * 10);
      const hunter = [...sim.players.values()].find((p) => p.role === 'hunter');
      const prey = [...sim.players.values()].find((p) => p.role === 'survivor');
      if (!hunter || !prey) return null;
      return { sim, hunter, prey, bot: new Bot(hunter.id, { skill: 1, seed: 9 }) };
    }

    /** Presses of the fire button over `ticks`, with the hunter already pointed at its prey. */
    function pressesWhileAimed(setup: NonNullable<ReturnType<typeof armedHunter>>, ticks = 240): number {
      const { sim, hunter, prey, bot } = setup;
      hunter.yaw = Math.atan2(prey.position.x - hunter.position.x, prey.position.z - hunter.position.z);
      let fired = 0;
      for (let i = 0; i < ticks; i++) {
        const intent = bot.think(hunter, sim.players.values(), level, 1 / 60);
        if (intent.buttons & Buttons.UseGadget) fired++;
      }
      return fired;
    }

    /** Put the prey `metres` away along +X, close enough to be seen. */
    function place(setup: NonNullable<ReturnType<typeof armedHunter>>, metres: number): void {
      setup.prey.position.x = setup.hunter.position.x + metres;
      setup.prey.position.y = setup.hunter.position.y;
      setup.prey.position.z = setup.hunter.position.z;
    }

    it('shoots a target in range', () => {
      const setup = armedHunter();
      expect(setup).toBeTruthy();
      if (!setup) return;
      place(setup, 12);
      expect(pressesWhileAimed(setup)).toBeGreaterThan(0);
    });

    it('holds its fire on a target it can see but not reach', () => {
      /**
       * 42 m: inside the awareness radius (18 + skill * 32 = 50 at skill 1) and outside the
       * 34 m firing range. The first version of this test used 400 m, which is past awareness
       * entirely — the bot never even picked a target, so the test passed without the range check
       * existing and survived a mutation that deleted it.
       */
      const setup = armedHunter();
      expect(setup).toBeTruthy();
      if (!setup) return;
      place(setup, 42);
      expect(pressesWhileAimed(setup)).toBe(0);
    });

    it('holds its fire while facing the wrong way', () => {
      // The projectile leaves along the body's heading, and the bot turns at a bounded rate, so
      // firing mid-turn is firing at nothing.
      const setup = armedHunter();
      expect(setup).toBeTruthy();
      if (!setup) return;
      place(setup, 12);
      const { sim, hunter, prey, bot } = setup;
      // Derived from where the prey actually is, then turned right around. Writing the heading as
      // a literal got it backwards on the first attempt and pointed the hunter straight at its prey.
      const away = Math.atan2(prey.position.x - hunter.position.x, prey.position.z - hunter.position.z) + Math.PI;
      let fired = 0;
      for (let i = 0; i < 4; i++) {
        hunter.yaw = away; // held there: the bot only gets to ask for a turn, not to take one
        const intent = bot.think(hunter, sim.players.values(), level, 1 / 60);
        if (intent.buttons & Buttons.UseGadget) fired++;
      }
      expect(fired).toBe(0);
    });

    it('holds its fire on an empty or cooling gadget', () => {
      const setup = armedHunter();
      expect(setup).toBeTruthy();
      if (!setup) return;
      place(setup, 12);
      setup.hunter.gadgets.cooldowns[setup.hunter.gadgets.slots[0] as string] = 99;
      expect(pressesWhileAimed(setup)).toBe(0);
    });

    it('aims up at a target above it and down at one below', () => {
      /**
       * Pitch is aimed as well as yaw, which only started meaning anything once `aimFrom` stopped
       * mirroring it. A bot that leaves pitch at zero shoots flat past anything on a ledge.
       */
      const setup = armedHunter();
      expect(setup).toBeTruthy();
      if (!setup) return;
      const { sim, hunter, prey, bot } = setup;
      const pitchWithPreyAt = (dy: number): number => {
        place(setup, 8);
        prey.position.y = hunter.position.y + dy;
        hunter.yaw = Math.atan2(prey.position.x - hunter.position.x, prey.position.z - hunter.position.z);
        return bot.think(hunter, sim.players.values(), level, 1 / 60).lookPitch;
      };
      expect(pitchWithPreyAt(6)).toBeGreaterThan(0.2);
      expect(pitchWithPreyAt(-6)).toBeLessThan(-0.2);
    });
  });
});
