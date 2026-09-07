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
export class Bot {
  private rand: Rand;
  private intent: InputIntent = createIntent();
  private wanderYaw = 0;
  private repathTimer = 0;
  private jumpTimer = 0;
  private grabTimer = 0;
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

    const chasing = self.role === 'chaser' || self.role === 'infected';
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

  private pickTarget(self: PlayerState, others: Iterable<PlayerState>, chasing: boolean): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDistance = chasing ? Infinity : 0;
    const awareness = 18 + this.options.skill * 32;

    for (const other of others) {
      if (other.id === self.id || !other.alive || !other.active) continue;
      const otherIsThreat = other.role === 'chaser' || other.role === 'infected';
      if (chasing === otherIsThreat) continue; // chase runners; flee chasers
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
