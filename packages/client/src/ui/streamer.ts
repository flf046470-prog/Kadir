/**
 * Streamer mode: what the screen shows while somebody is broadcasting it.
 *
 * A stream is an audience the other players never agreed to, and a room code on screen is an open
 * door: viewers join a private room and fill it. So while it is on:
 *
 *  - **Other players are aliases** — "Player 3" is the same person for the whole session, so a
 *    viewer can still follow a chase, but no one's chosen name (or something rude typed as one)
 *    reaches the stream. The streamer's own name stays: it is their stream.
 *  - **Room codes are masked** (`KANG-••••`), wherever they are printed.
 *  - **Other players' chat text is hidden**; the line still appears, so the streamer knows somebody
 *    said something. The streamer's own messages are shown.
 *
 * It is presentation only. Nothing here reaches the simulation or the server, and it changes no
 * one else's game — which is also why it can be switched mid-match.
 *
 * Text the server builds with names already inside it ("X knocked out Y", the HUD's headline) is
 * masked by whole-word replacement from the roster. A name that is one of the game's own words is
 * left alone: the default name is "Roo", and masking it would turn "Roo Ball" into "Player 1 Ball"
 * while hiding nothing personal.
 */

/** Words the game itself prints. A player named one of these is not identified by it. */
const GAME_WORDS = new Set(
  ['roo', 'kangaroo', 'human', 'someone', 'player', 'ball', 'red', 'blue', 'hunter', 'survivor', 'runner', 'chaser', 'you'],
);

export const HIDDEN_CODE = '••••';
export const HIDDEN_CHAT = 'message hidden (streamer mode)';

/** The 4-character code after the `KANG-` prefix, wherever it appears in a string. */
const ROOM_CODE = /\b([A-Z]{2,6})-[A-Z0-9]{4}\b/g;

export class StreamerMask {
  enabled = false;
  private localId: string;
  private readonly aliases = new Map<string, string>();
  /** Real name to alias, for text that arrives with names already in it. */
  private readonly byName = new Map<string, string>();

  constructor(localId = '') {
    this.localId = localId;
  }

  setLocalId(id: string): void {
    this.localId = id;
  }

  /** A player's name as the screen should show it. Learns the name for `text`, on or off. */
  name(id: string, real: string): string {
    if (id === this.localId) return real;
    let alias = this.aliases.get(id);
    if (!alias) {
      alias = `Player ${this.aliases.size + 1}`;
      this.aliases.set(id, alias);
    }
    if (real && !GAME_WORDS.has(real.trim().toLowerCase())) this.byName.set(real, alias);
    return this.enabled ? alias : real;
  }

  /** A room code as the screen should show it. */
  code(code: string): string {
    if (!this.enabled) return code;
    return code.replace(ROOM_CODE, `$1-${HIDDEN_CODE}`);
  }

  /** A chat line's text. The streamer's own lines and system notices are shown. */
  chat(text: string, own: boolean, system = false): string {
    return this.enabled && !own && !system ? HIDDEN_CHAT : text;
  }

  /** Text built elsewhere with names and codes inside it. */
  text(text: string): string {
    if (!this.enabled || !text) return text;
    let out = text.replace(ROOM_CODE, `$1-${HIDDEN_CODE}`);
    // Longest first, so "Bounce Jr" is not half-replaced by "Bounce".
    const names = [...this.byName.keys()].sort((a, b) => b.length - a.length);
    for (const real of names) {
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(real)}(?=$|[^\\p{L}\\p{N}_])`, 'gu');
      out = out.replace(pattern, `$1${this.byName.get(real) as string}`);
    }
    return out;
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
