import { canUse } from '../gadgets/loadout.js';
import { selectedGadget } from '../gadgets/state.js';
import { Rand } from '../math/rand.js';
import { v3distance } from '../math/vec3.js';
import { Buttons, createIntent } from '../input/intent.js';
import type { InputIntent } from '../input/intent.js';
import type { PlayerState } from '../player/state.js';
import type { LevelDef } from '../world/level.js';

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
  private stuckTimer = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(
    readonly playerId: string,
    private readonly options: BotOptions,
  ) {
    this.rand = new Rand(options.seed);
    this.wanderYaw = this.rand.range(-Math.PI, Math.PI);
  }

  /** Produce this tick's intent. `others` is everyone the bot can see. */
  think(self: PlayerState, others: Iterable<PlayerState>, level: LevelDef, dt: number): InputIntent {
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
    } else if (this.repathTimer <= 0) {
      this.repathTimer = this.rand.range(1.5, 4);
      this.wanderYaw += this.rand.range(-1.4, 1.4);
      desiredYaw = this.wanderYaw;
    }

    // Stay inside the play area.
    const distanceFromCentre = Math.hypot(self.position.x, self.position.z);
    if (distanceFromCentre > level.playRadius * 0.75) {
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
    if (self.stamina > 40 && (chasing || distance < 18)) intent.buttons |= Buttons.Sprint;

    // If we stop making progress, we are probably against geometry: grab and climb over it.
    const moved = Math.hypot(self.position.x - this.lastX, self.position.z - this.lastZ);
    this.lastX = self.position.x;
    this.lastZ = self.position.z;
    this.stuckTimer = moved < 0.02 ? this.stuckTimer + dt : 0;
    if (this.stuckTimer > 0.4) {
      intent.buttons |= Buttons.GrabLeft | Buttons.GrabRight | Buttons.Jump;
      if (this.stuckTimer > 1.6) {
        this.wanderYaw += this.rand.range(1.5, 2.5);
        this.stuckTimer = 0;
      }
    }

    intent.tick = 0;
    return intent;
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
