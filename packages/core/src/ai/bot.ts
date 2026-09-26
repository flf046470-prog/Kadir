import { canUse } from '../gadgets/loadout.js';
import { selectedGadget } from '../gadgets/state.js';
import { Rand } from '../math/rand.js';
import { v3distance } from '../math/vec3.js';
import { Buttons, createIntent } from '../input/intent.js';
import type { InputIntent } from '../input/intent.js';
import type { PlayerState } from '../player/state.js';
import type { LevelDef } from '../world/level.js';
import type { Vec3 } from '../math/vec3.js';

export interface BotOptions {
  /** 0..1 — reaction speed, aim accuracy and willingness to take risky routes. */
  skill: number;
  seed: number;
}

/**
 * Simple intent-producing bot.
 *
 * It drives the *same* `InputIntent` a human platform produces, so bots exercise the real
 * movement code — they can hop, charge jumps, climb and be tagged exactly like players. Used
 * for solo practice, for filling a thin lobby, and as a headless load generator in tests.
 */
/**
 * Roles that hunt, and roles that are hunted.
 *
 * Stated as sets because the game has nine roles and only these five take part in a chase.
 * `fighter`, `racer`, `spectator` and `idle` are in neither: nobody should be pursuing them and
 * they have nobody to run from.
 */
const THREAT_ROLES: ReadonlySet<PlayerState['role']> = new Set(['chaser', 'infected', 'hunter']);
const PREY_ROLES: ReadonlySet<PlayerState['role']> = new Set(['runner', 'survivor']);

/** Beyond this a bot holds its fire rather than shooting at a dot on the horizon. */
/**
 * How long a bot has to make real ground before it decides it is stuck, and how much counts.
 *
 * Measured over a window rather than per tick, which is what the old check did: a bot pressed into
 * a wall does not stand still, it hops and jitters, and at 0.02 m per tick that jitter read as
 * travel. Driving the jungle course, all six racers reached checkpoint 0, walked to a canyon wall
 * at x = -68, and spent the remaining **260 seconds of a 300-second race** oscillating in place
 * 90 m from the next checkpoint, with the stuck timer never once firing.
 *
 * 1.2 s and 1.4 m: slower than a sprint, faster than a sidle, and long enough that a legitimate
 * climb — which is slow and nearly vertical — is not mistaken for being wedged.
 */
const PROGRESS_WINDOW = 1.2;
const PROGRESS_MIN = 1.4;
/** Roughly a right angle: enough to clear an obstacle, not so much that the bot doubles back. */
const DETOUR_ANGLE = 1.35;
const DETOUR_SECONDS = 1.4;
const FIRE_RANGE = 34;
/** Past this far apart a fighter closes the distance instead of swinging at air. */
const PUNCH_RANGE = 1.15;
/** Roughly where an opponent's head sits relative to the puncher, for the 1.6x head multiplier. */
const HEAD_AIM_PITCH = 0.5;

export class Bot {
  private rand: Rand;
  private intent: InputIntent = createIntent();
  private wanderYaw = 0;
  private repathTimer = 0;
  private jumpTimer = 0;
  private grabTimer = 0;
  private punchTimer = 0;
  private fireTimer = 0;
  private aimError = 0;
  /** Where the bot was when the current progress window opened, and how long ago that was. */
  private progressX = 0;
  private progressZ = 0;
  private progressTimer = 0;
  /** Seconds left of the current detour, the heading it holds, and how long the next one lasts. */
  private detourTimer = 0;
  private detourSeconds = DETOUR_SECONDS;
  private detourYaw = 0;
  /**
   * Which way a bot turns when it meets something.
   *
   * One side, for every bot. Drawing it per bot from the seed was tried, on the reasoning that a
   * field should try both sides of a rock — measured, it moved the jungle the wrong way (eight
   * racers back at checkpoint 1, against none) while helping the outback by about as much, which
   * on three seeds is noise wearing a hypothesis. A constant is one less moving part and had the
   * clearest result in the data, so it is what ships until a wider sweep says otherwise.
   */
  private detourSign = 1;
  /** True while the bot is making no ground. Steering reads it; no button does. */
  private blocked = false;
  /** The way out of a pit the bot is taking, and whether it has reached the foot yet. */
  private exitLeg: { foot: Vec3; top: Vec3; climbing: boolean; best: number } | null = null;
  private readonly carrot: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    readonly playerId: string,
    private readonly options: BotOptions,
  ) {
    this.rand = new Rand(options.seed);
    this.wanderYaw = this.rand.range(-Math.PI, Math.PI);
  }

  /**
   * Produce this tick's intent. `others` is everyone the bot can see.
   *
   * `objective` is a place the mode wants this player to go — the next checkpoint in a race, the
   * ring in King of the Hill. Everything a bot knew how to want used to be another player, so in
   * those modes they simply wandered; see `GameMode.objectiveFor`.
   */
  think(
    self: PlayerState,
    others: Iterable<PlayerState>,
    level: LevelDef,
    dt: number,
    objective: { x: number; y: number; z: number } | null = null,
  ): InputIntent {
    const intent = this.intent;
    intent.buttons = 0;
    intent.hands = null;
    intent.headHeight = 1.6;

    this.repathTimer -= dt;
    this.jumpTimer -= dt;
    this.grabTimer -= dt;

    // Inside the ring nothing else applies: a fighter has one opponent, cannot leave, and the
    // only thing that resolves the bout is damage.
    if (self.role === 'fighter') return this.fight(self, others, dt);

    const chasing = THREAT_ROLES.has(self.role);
    const target = this.pickTarget(self, others, chasing);

    let desiredYaw = this.wanderYaw;
    if (target) {
      const dx = target.position.x - self.position.x;
      const dz = target.position.z - self.position.z;
      const toTarget = Math.atan2(dx, dz);
      // Chasers home in; runners flee, with a little noise so they are not perfectly predictable.
      desiredYaw = chasing ? toTarget : toTarget + Math.PI + this.rand.range(-0.5, 0.5) * (1 - this.options.skill);
    } else if (objective) {
      // Nobody to chase and somewhere to be. The wobble is skill-scaled so a weak bot still takes
      // a sloppy line rather than running the course on rails, which is what makes a race worth
      // entering.
      objective = this.routeOut(self, level, objective);
      const dx = objective.x - self.position.x;
      const dz = objective.z - self.position.z;
      desiredYaw = Math.atan2(dx, dz) + this.rand.range(-0.25, 0.25) * (1 - this.options.skill);
    } else if (this.repathTimer <= 0) {
      this.repathTimer = this.rand.range(1.5, 4);
      this.wanderYaw += this.rand.range(-1.4, 1.4);
      desiredYaw = this.wanderYaw;
    }

    /**
     * Only a bot heading for a *place* goes round obstacles, and the scope is deliberate.
     *
     * The measured failure is entirely here: a racer or a hill-climber walks at a fixed point,
     * meets a cliff, and leans on it for the rest of the round — on the jungle course, 260 seconds
     * of a 300-second race spent against one wall, ninety metres short. A chaser has no such
     * problem, because the thing it steers at moves, so it is never pointed at the same rock for
     * long.
     *
     * Applying it to chases as well was tried and measured, and it changed a balance this has no
     * business changing: prey stopped cornering themselves, the closest a survivor came to a bot
     * hunter over a 150-second round went from 0.0 m to 3.1 m, and The Hunt went from four
     * survivors eliminated to none. That is arguably *better* prey AI, and it exposes something
     * real — a bot hunter's kills come from its prey getting wedged, not from its rifle. But it is
     * a separate problem from bots not finishing races, and fixing one should not quietly re-tune
     * the other.
     */
    desiredYaw = objective && !target ? this.avoidObstacle(self, desiredYaw, dt) : desiredYaw;

    // Stay inside the play area — unless the mode sent the bot somewhere. A checkpoint is authored
    // route, and a leash that overrides it turns a racer round at the mouth of the glacier's
    // crevasse, 40.5 m out, with its next checkpoint 58 m out: measured, it hopped back and forth
    // across that line for the last ninety seconds of the race.
    const distanceFromCentre = Math.hypot(self.position.x, self.position.z);
    if ((target || !objective) && distanceFromCentre > level.playRadius * 0.75) {
      desiredYaw = Math.atan2(-self.position.x, -self.position.z);
    }

    intent.lookYaw = approachAngle(self.yaw, desiredYaw, dt * (2.5 + this.options.skill * 4));
    intent.lookPitch = 0;
    intent.moveX = 0;
    intent.moveZ = 1;

    // Shoot, if this role was handed something to shoot with.
    //
    // The Hunt gives one player a rifle and everyone else four minutes to live, and a bot hunter
    // never pressed the button: `think` produced jump, sprint and grab and nothing else. Measured
    // over three 180-second rounds before this, survivors downed by a bot hunter: zero, every
    // round, with the hunter standing 0.0 m away. The mode could not be lost.
    if (chasing && target) this.aimAndFire(self, target, intent, dt);

    // Hop rhythmically; charge a bigger hop when chasing something far away.
    const distance = target ? v3distance(self.position, target.position) : 99;
    if (self.grounded && this.jumpTimer <= 0) {
      intent.buttons |= Buttons.Jump;
      if (distance > 12 && chasing) intent.buttons |= Buttons.Sprint;
      if (this.rand.bool(0.25 + this.options.skill * 0.3)) this.jumpTimer = this.rand.range(0.15, 0.5);
      else this.jumpTimer = this.rand.range(0.5, 1.4);
    }
    if (self.stamina > 40 && (chasing || objective !== null || distance < 18)) intent.buttons |= Buttons.Sprint;

    /**
     * Climb when the objective is above you.
     *
     * The stuck check below only fires when a bot stops moving, and a bot standing under a ledge
     * does not stop — it hops on the spot and drifts, which reads as progress. Measured on the
     * jungle course, all six racers ended a full 300-second race parked at checkpoint 1 with the
     * next one twelve metres over their heads, one of them 2.4 m away horizontally: they had
     * arrived, and had no idea the route went up. Climbing is this game's core verb, so a bot that
     * cannot do it deliberately cannot play half the map.
     */
    if (objective) {
      const rise = objective.y - self.position.y;
      const flat = Math.hypot(objective.x - self.position.x, objective.z - self.position.z);
      if (rise > 1.5 && flat < 10) {
        intent.buttons |= Buttons.GrabLeft | Buttons.GrabRight | Buttons.Jump;
      }
    }

    /*
     * Being blocked presses no buttons at all, and arriving at that took three attempts.
     *
     * Grab held: the bot anchored to the canyon face and froze at (-68, 14, 28) for 280 seconds.
     * Grab pulsed: it stopped anchoring and started yo-yoing, sliding between y = 7 and y = 14 on
     * the same wall for the rest of the race. Jump alone: this game has wall bounce, so spamming it
     * into a wall *ratchets the bot up it* — the same wall, the same 18 m, arriving at the top at
     * t = 180 s and staying there.
     *
     * Each was the same mistake: reading "I cannot go forward" as "the route is up". It is not. The
     * objective was ninety-one metres sideways and level with the bot's feet. Going up is already
     * handled above by the one signal that actually means up — the objective being above you and
     * within ten metres. Being blocked means go *round*, which is entirely a steering problem, and
     * the rhythmic hop already in `think` clears anything low enough to be worth clearing.
     */

    intent.tick = 0;
    return intent;
  }

  /**
   * Down in a pit with the objective up and out of it: head for the way out first.
   *
   * Straight at the objective is straight into the pit's wall. Measured on the glacier: a racer
   * down in the crevasse with the next checkpoint on the rink pinned itself against the crevasse's
   * east face for ninety seconds — the only way it had ever left before was by falling off the far
   * end, which `LevelBuilder.enclose` now walls. A pit declares its exit (`ZoneDef.exits`); the bot
   * walks to its foot, then up to its top, then carries on.
   */
  private routeOut(self: PlayerState, level: LevelDef, objective: Vec3): Vec3 {
    const p = self.position;
    // In a pit is a height, not a zone name: below the top of a way out of a zone you are inside,
    // with the objective up at that height rather than down here with you. Zones nest (the
    // outback's cave is inside its gorge) and a zone's sphere can reach the ground around it, so
    // "which zone is the objective in" gave the wrong answer on both maps.
    if (!this.exitLeg) {
      let best = Infinity;
      for (const zone of level.zones) {
        if (!zone.exits || v3distance(zone.center, p) > zone.radius) continue;
        for (const exit of zone.exits) {
          if (p.y > exit.top.y - 2.5 || objective.y < exit.top.y - 2.5) continue;
          const d = Math.hypot(exit.foot.x - p.x, exit.foot.z - p.z);
          if (d < best) {
            best = d;
            this.exitLeg = { foot: exit.foot, top: exit.top, climbing: false, best: -Infinity };
          }
        }
      }
      if (!this.exitLeg) return objective;
    } else if (p.y > this.exitLeg.top.y - 1 || objective.y < this.exitLeg.top.y - 2.5) {
      // Out, or the objective has moved down into the pit: straight at it again.
      this.exitLeg = null;
      return objective;
    }
    const leg = this.exitLeg as { foot: Vec3; top: Vec3; climbing: boolean; best: number };
    if (!leg.climbing && Math.hypot(leg.foot.x - p.x, leg.foot.z - p.z) < 2.5) {
      leg.climbing = true;
      leg.best = p.y;
    }
    if (leg.climbing) {
      leg.best = Math.max(leg.best, p.y);
      // Fell off the side of the way up: from the floor the top is only a wall. Back to the foot.
      if (p.y < leg.best - 2) leg.climbing = false;
    }
    if (!leg.climbing) return leg.foot;
    // Steer at a point a few metres ahead on the line up, not at the top: a bot aimed at the top
    // from wherever momentum put it walks off the side of the ramp. Measured on the glacier, it
    // crossed the ramp side to side and fell off three times out of three.
    const ax = leg.top.x - leg.foot.x;
    const az = leg.top.z - leg.foot.z;
    const length = Math.hypot(ax, az) || 1;
    const along = ((p.x - leg.foot.x) * ax + (p.z - leg.foot.z) * az) / length;
    const t = Math.min(1, Math.max(0, (along + 4) / length));
    this.carrot.x = leg.foot.x + ax * t;
    this.carrot.y = leg.foot.y + (leg.top.y - leg.foot.y) * t;
    this.carrot.z = leg.foot.z + az * t;
    return this.carrot;
  }

  /**
   * Notice when the way ahead is blocked, and go round it.
   *
   * The bot steers straight at whatever it wants and has no idea the world is solid, so anything
   * between it and its goal is a wall it leans on until the round ends. There was an escape hatch
   * for this, and it was dead code in precisely the case that needed it: it nudged `wanderYaw`,
   * which the heading only reads when there is *no* target and *no* objective — so a racer with a
   * checkpoint to reach, or a chaser with someone to catch, could never be shaken loose by it.
   *
   * The fix is deliberately not a navmesh. A* over this world would be a large system with its own
   * failure modes, and the measurement says the bots do not need to plan — they need to stop
   * pressing into a rock. Turning ninety degrees and committing to it for a second and a half is
   * what a person does, and it composes with the steering already here instead of replacing it.
   *
   * Two rules make it converge rather than dither. A detour that ends with the bot stuck again
   * within `PROGRESS_WINDOW` is a detour that went the wrong way, so the next one turns the other
   * way and lasts longer — which walks the bot along an obstacle instead of bouncing off it. And
   * the sign persists otherwise, so a bot that found a way round keeps using it.
   */
  private avoidObstacle(self: PlayerState, desiredYaw: number, dt: number): number {
    this.progressTimer += dt;

    if (this.progressTimer >= PROGRESS_WINDOW) {
      const net = Math.hypot(self.position.x - this.progressX, self.position.z - this.progressZ);
      const wasBlocked = this.blocked;
      this.blocked = net < PROGRESS_MIN;
      if (this.blocked) {
        // Stuck again straight after a detour: that way was wrong. The comment above always said
        // so, and nothing did it — the sign never changed, so a bot whose one side was a wall
        // turned into that wall forever. Measured on the glacier: a racer beside the crevasse ramp
        // spent ninety seconds turning into the ramp's side, one metre from a clear run to its foot.
        if (wasBlocked) {
          this.detourSign = -this.detourSign;
          this.detourSeconds = Math.min(this.detourSeconds * 1.5, DETOUR_SECONDS * 3);
        }
        this.detourYaw = desiredYaw + this.detourSign * DETOUR_ANGLE;
        this.detourTimer = this.detourSeconds;
      } else {
        this.detourSeconds = DETOUR_SECONDS;
      }
      this.progressX = self.position.x;
      this.progressZ = self.position.z;
      this.progressTimer = 0;
    }

    if (this.detourTimer > 0) {
      this.detourTimer -= dt;
      return this.detourYaw;
    }
    return desiredYaw;
  }

  /**
   * Point the selected gadget at a target and pull the trigger when the shot is worth taking.
   *
   * Pitch is aimed as well as yaw, which only became meaningful once `aimFrom` stopped mirroring
   * it: a shot fired while looking up used to travel *down*. Bots aim at the chest rather than the
   * head, so a player who breaks line of sight or closes the distance is rewarded.
   */
  private aimAndFire(self: PlayerState, target: PlayerState, intent: InputIntent, dt: number): void {
    const held = selectedGadget(self.gadgets);
    if (!held || !canUse(self.gadgets, held, self.role)) return;

    const dx = target.position.x - self.position.x;
    const dz = target.position.z - self.position.z;
    const flat = Math.hypot(dx, dz);
    if (flat > FIRE_RANGE) return;

    // Chest height, from the shooter's own eye line.
    const dy = target.position.y + target.height * 0.55 - self.head.y;
    const wanted = Math.atan2(dy, Math.max(0.2, flat));
    // Aim drifts by skill, so a weak bot sprays and a strong one does not. Sampled per shot rather
    // than per tick, or the noise would average out to a perfect shot.
    intent.lookPitch = Math.max(-1.4, Math.min(1.4, wanted + this.aimError));

    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    // Facing matters: the projectile goes where the body is pointed, and the bot turns at a bounded
    // rate, so firing mid-turn would be firing at nothing.
    const offYaw = Math.abs(shortestAngle(Math.atan2(dx, dz) - self.yaw));
    if (offYaw > 0.35) return;

    intent.buttons |= Buttons.UseGadget;
    // Released next tick by the button reset at the top of `think`, which is what makes this a
    // press: the simulation fires gadgets on the rising edge, so a held button is one shot.
    this.fireTimer = this.rand.range(0.3, 1.6) * (1.5 - this.options.skill);
    this.aimError = this.rand.range(-1, 1) * 0.22 * (1 - this.options.skill);
  }

  /**
   * Box.
   *
   * Conversion Duel's whole premise is that a catch starts a fight, and until this existed the
   * bots did not throw a single punch: `think` only ever set jump, sprint and grab. Every bot bout
   * therefore ran its full twenty seconds with both fighters on 100 health and was decided by the
   * tiebreak — which by design goes to the human — so a kangaroo bot could not win a bout it had
   * started. Measured over six 300-second rounds, the kangaroos were wiped out in four of them.
   *
   * The opponent is the nearest other fighter. Bouts are separate events scattered across the map
   * and the two fighters are placed 1.6 m apart at the bell, so "nearest" is the opponent by a
   * wide margin; matching on the mode's bout list instead would mean handing the AI a view of
   * mode internals that no player has.
   */
  private fight(self: PlayerState, others: Iterable<PlayerState>, dt: number): InputIntent {
    const intent = this.intent;
    let opponent: PlayerState | null = null;
    let best = Infinity;
    for (const other of others) {
      if (other.id === self.id || other.role !== 'fighter' || !other.active) continue;
      const distance = v3distance(self.position, other.position);
      if (distance < best) {
        best = distance;
        opponent = other;
      }
    }

    if (!opponent) {
      // A fighter with nobody to fight is a bout the mode is about to clean up. Stand still rather
      // than wandering out of the ring on the way.
      intent.moveZ = 0;
      intent.tick = 0;
      return intent;
    }

    const dx = opponent.position.x - self.position.x;
    const dz = opponent.position.z - self.position.z;
    intent.lookYaw = approachAngle(self.yaw, Math.atan2(dx, dz), dt * (6 + this.options.skill * 8));
    // Closing is worth more than circling: step in when out of reach, hold the stance when in it.
    intent.moveZ = best > PUNCH_RANGE ? 1 : 0;
    intent.moveX = 0;

    // Skill decides how often a bot is actually swinging rather than resetting its guard, so a
    // 0.45-skill bot is a soft touch and a 0.9 one is genuinely dangerous. Stamina matters too:
    // punching at empty stamina lands at 40% damage, so they pace themselves.
    this.punchTimer -= dt;
    const winded = self.stamina < 25;
    if (best <= PUNCH_RANGE && this.punchTimer <= 0 && !winded) {
      intent.buttons |= this.rand.bool(0.5) ? Buttons.PunchLeft : Buttons.PunchRight;
      // A skilled bot doubles up; a poor one leaves gaps the player can punish.
      this.punchTimer = this.rand.range(0.05, 0.75) * (1.4 - this.options.skill);
    }
    // Head shots are worth 1.6x, and aiming for them is the skill the bot is being graded on.
    intent.lookPitch = this.rand.bool(this.options.skill) ? HEAD_AIM_PITCH : 0;
    intent.tick = 0;
    return intent;
  }

  private pickTarget(self: PlayerState, others: Iterable<PlayerState>, chasing: boolean): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDistance = chasing ? Infinity : 0;
    const awareness = 18 + this.options.skill * 32;

    for (const other of others) {
      if (other.id === self.id || !other.alive || !other.active) continue;
      // Roles are matched against what they *are* rather than against what they are not.
      //
      // This used to be `if (chasing === otherIsThreat) continue`, with "threat" meaning chaser or
      // infected and everything else falling on the other side. Two things went wrong with that.
      //
      // Any pair where neither side was one of those two roles tested equal and was discarded, so
      // The Hunt — whose roles are named `hunter` and `survivor` — had no bot that ever saw
      // another: the hunter wandered past its quarry and the survivors strolled past the hunter.
      //
      // And "not a threat" swept in roles that are not prey either. In Conversion Duel a caught
      // player spends twenty seconds on role `fighter`, untouchable inside the ring; a kangaroo
      // bot read that as prey, so a bout acted as a decoy that soaked up every nearby chaser while
      // the actual humans went unbothered.
      if (chasing) {
        if (!PREY_ROLES.has(other.role)) continue;
      } else if (!THREAT_ROLES.has(other.role)) {
        continue;
      }
      // Immunity is deliberately *not* a filter. Dropping a target the moment it becomes briefly
      // untouchable was tried and measured: runners pick up short immunities constantly during a
      // round, the chaser abandoned each one mid-pursuit, and the nearest chaser-to-runner distance
      // went from a few metres to seventy — a whole round with no tags at all. Immunity is short, so
      // the right move is to keep closing and arrive as it ends.
      const distance = v3distance(self.position, other.position);
      if (distance > awareness) continue;
      if (chasing ? distance < bestDistance : distance > bestDistance) {
        best = other;
        bestDistance = distance;
      }
    }
    // Runners only react to a chaser that is actually close.
    if (!chasing && best && bestDistance > awareness * 0.6) return null;
    return best;
  }
}

/** The signed angle between two headings, in (-PI, PI]. */
function shortestAngle(delta: number): number {
  const TAU = Math.PI * 2;
  let d = delta % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Turn towards a heading at a bounded rate, taking the short way round. */
function approachAngle(current: number, target: number, rate: number): number {
  const TAU = Math.PI * 2;
  let delta = (target - current) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  const step = Math.max(-1, Math.min(1, rate)) * delta;
  let next = (current + step + Math.PI) % TAU;
  if (next < 0) next += TAU;
  return next - Math.PI;
}

const NAMES = ['Skippy', 'Bounce', 'Joey', 'Hopper', 'Digger', 'Nibbles', 'Zoom', 'Pouch', 'Thump', 'Roobarb', 'Boomer', 'Sprocket'];

export function botName(index: number): string {
  return `${NAMES[index % NAMES.length]}${index >= NAMES.length ? index : ''}`;
}
