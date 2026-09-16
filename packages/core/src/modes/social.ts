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
  /** Which portal each player is currently standing in, so entry fires once and not per tick. */
  private insidePortal = new Map<string, string>();

  constructor(def: GameModeDef) {
    this.def = def;
  }

  start(ctx: ModeContext): void {
    this.roster = ctx.players;
    this.ticks = 0;
    this.insidePortal.clear();
  }

  playerJoined(ctx: ModeContext, player: PlayerState): void {
    player.role = 'idle';
    player.health = 100;
    player.stamina = 100;
    player.alive = true;
    // Into the middle of the ring of doors, so the first thing a new player sees is their choices.
    ctx.respawn(player, 'lobby');
  }

  playerLeft(_ctx: ModeContext, playerId: string): void {
    // No score, no bout and no round state to unwind — only which door they were standing in.
    this.insidePortal.delete(playerId);
  }

  step(ctx: ModeContext): void {
    this.ticks++;
    for (const player of ctx.players.values()) {
      if (!player.active) continue;
      // Fell off the world. In a match this costs you the round; here it costs you nothing.
      if (player.position.y < ctx.level.killPlaneY) {
        ctx.respawn(player, 'lobby');
        this.insidePortal.delete(player.id);
        ctx.events.emit('respawn', player.id, player.position, ctx.tick, 0, { data: 'training' });
      }
      // Status effects from a gadget someone is trying out wear off; nothing is held.
      player.health = Math.min(100, player.health + 8 * ctx.dt);
      this.checkPortals(ctx, player);
    }
  }

  /**
   * Walking into a door announces which mode you want.
   *
   * Fired on the way *in* only, and the mode you are standing in is remembered until you leave,
   * because the alternative is an announcement sixty times a second for as long as you loiter in
   * the arch — and people do loiter in the arch, waiting for a friend.
   *
   * The mode itself only says "this player stepped through here". What that means — start a solo
   * round, vote in a lobby, queue for matchmaking — belongs to whoever is running the room, which
   * is the same split every other mode event follows.
   */
  private checkPortals(ctx: ModeContext, player: PlayerState): void {
    let entered: string | null = null;
    for (const portal of ctx.level.portals) {
      // Horizontal only: a portal you are standing on top of on a ledge is not one you walked
      // through, and the lobby floor is flat anyway.
      const dx = player.position.x - portal.position.x;
      const dz = player.position.z - portal.position.z;
      if (Math.hypot(dx, dz) <= portal.radius) {
        entered = portal.modeId;
        break;
      }
    }

    const previous = this.insidePortal.get(player.id) ?? null;
    if (entered === previous) return;

    if (entered === null) this.insidePortal.delete(player.id);
    else this.insidePortal.set(player.id, entered);

    if (entered !== null) {
      ctx.events.emit('portal', player.id, player.position, ctx.tick, 0, { data: entered });
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
