import { v3distance } from '../math/vec3.js';
import type { PlayerState } from '../player/state.js';
import { registerMode } from './registry.js';
import type { GameMode, GameModeDef, MatchResult, ModeContext, ModeStateView } from './types.js';

export const TRAINING_ROOM_DEF: GameModeDef = {
  id: 'training',
  name: 'Training Room',
  description: 'No round, no clock, no winner. Climb, punch the bags, talk, and work out the controls.',
  minPlayers: 1,
  maxPlayers: 24,
  roundSeconds: 0,
  countdownSeconds: 0,
  icon: 'training',
  combat: false,
  tagging: false,
};

/** How close two players must be for proximity voice to reach full volume. */
export const VOICE_NEAR = 6;
/** Beyond this, they cannot hear each other at all. */
export const VOICE_FAR = 22;

/**
 * The Training Room.
 *
 * Not a game mode so much as a place — a lobby you can stand in. There is no round, no timer and
 * no way to win or lose, which is exactly the point: it is where you learn what your arms do,
 * where a group waits for a sixth player, and where people talk. Every other mode in this game
 * puts a clock on you; this one deliberately does not.
 *
 * It is implemented as a `GameMode` rather than a special case in the room, because everything
 * that already works — spawns, snapshots, voice relay, moderation, the whole server loop — works
 * for a mode, and a "room that is not a match" would have needed all of it rebuilt.
 */
export class TrainingRoomMode implements GameMode {
  readonly def: GameModeDef;
  private roster: Map<string, PlayerState> = new Map();
  private ticks = 0;

  constructor(def: GameModeDef) {
    this.def = def;
  }

  start(ctx: ModeContext): void {
    this.roster = ctx.players;
    this.ticks = 0;
  }

  playerJoined(ctx: ModeContext, player: PlayerState): void {
    player.role = 'idle';
    player.health = 100;
    player.stamina = 100;
    player.alive = true;
    ctx.respawn(player, 'start');
  }

  playerLeft(): void {
    // Nothing to clean up: there is no score, no bout and no round state to unwind.
  }

  step(ctx: ModeContext): void {
    this.ticks++;
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      // Fell off the world. In a match this costs you the round; here it costs you nothing.
      if (player.position.y < ctx.level.killPlaneY) {
        ctx.respawn(player, 'start');
        ctx.events.emit('respawn', player.id, player.position, ctx.tick, 0, { data: 'training' });
      }
      // Status effects from a gadget someone is trying out wear off; nothing is held.
      player.health = Math.min(100, player.health + 8 * ctx.dt);
    }
  }

  state(): ModeStateView {
    const roles: Record<string, string> = {};
    for (const [id, player] of this.roster) roles[id] = player.role;
    return {
      modeId: this.def.id,
      phase: 'playing',
      // Reported as zero rather than counting up: a clock in the corner of a room with no round
      // is a clock people feel they are racing.
      timeRemaining: 0,
      scores: {},
      roles,
      headline: this.roster.size > 1 ? `${this.roster.size} here` : 'Training Room',
    };
  }

  /** Never. The room ends when the last person leaves, which the server already handles. */
  finished(): boolean {
    return false;
  }

  endRound(): void {
    // Deliberately inert. A "next round" vote in a social room would eject everyone from the
    // conversation they are having, which is the one thing this space exists to protect.
  }

  results(ctx: ModeContext): MatchResult {
    return {
      modeId: this.def.id,
      levelId: ctx.level.id,
      durationTicks: this.ticks,
      players: [],
      winnerIds: [],
    };
  }
}

/**
 * Proximity voice gain between two players, 0..1.
 *
 * Shared rather than client-only so the mixing rule is the same everywhere and can be tested:
 * full volume close up, silence past `VOICE_FAR`, and a linear ramp between. Linear rather than
 * inverse-square because inverse-square makes a room of twelve people an unintelligible wash at
 * exactly the distance where you want to hear them.
 */
export function proximityGain(a: PlayerState, b: PlayerState, near = VOICE_NEAR, far = VOICE_FAR): number {
  const distance = v3distance(a.head, b.head);
  if (distance <= near) return 1;
  if (distance >= far) return 0;
  return 1 - (distance - near) / (far - near);
}

registerMode(TRAINING_ROOM_DEF, (def) => new TrainingRoomMode(def));
