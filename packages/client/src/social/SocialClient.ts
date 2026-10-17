import type { SocialView } from '@kc/net';
import type { Api, SocialActionPath } from '../net/Api.js';

/** What this client has already done about its party's moves. */
export interface FollowState {
  partyId: string | null;
  lastSeq: number;
}

export const NO_FOLLOW: FollowState = { partyId: null, lastSeq: 0 };

/**
 * Whether to follow the party leader into a room, and the state to remember afterwards.
 *
 * A member follows when the leader has *moved* since the last time this client looked — the
 * server counts moves in `roomSeq` — not whenever the member is somewhere else. That distinction is
 * the whole rule: a member who leaves a round on purpose while the leader stays put must not be
 * dragged straight back by the next poll, and a member who just joined the party should land where
 * the leader already is.
 *
 * Pure, so the rule is tested without a timer, a socket or a DOM.
 */
export function followTarget(
  view: SocialView | null,
  localId: string,
  currentRoom: string | null,
  state: FollowState,
): { roomCode: string | null; state: FollowState } {
  const party = view?.party;
  if (!party) return { roomCode: null, state: NO_FOLLOW };
  const next: FollowState = { partyId: party.id, lastSeq: party.roomSeq };
  if (party.leaderId === localId) return { roomCode: null, state: next };
  const joinedJustNow = state.partyId !== party.id;
  const leaderMoved = party.roomSeq > state.lastSeq;
  if (!(joinedJustNow || leaderMoved) || !party.roomCode || party.roomCode === currentRoom) {
    return { roomCode: null, state: next };
  }
  return { roomCode: party.roomCode, state: next };
}

/**
 * The lines worth interrupting a player for: somebody new asking to be friends, a new party invite.
 * Compared by id against the previous view so a request is announced once, not every poll.
 */
export function socialNews(previous: SocialView | null, next: SocialView): string[] {
  if (!previous) return [];
  const news: string[] = [];
  const hadRequest = new Set(previous.incoming.map((r) => r.id));
  for (const request of next.incoming) if (!hadRequest.has(request.id)) news.push(`${request.name} wants to be friends`);
  const hadInvite = new Set(previous.invites.map((i) => i.partyId));
  for (const invite of next.invites) if (!hadInvite.has(invite.partyId)) news.push(`${invite.fromName} invited you to their party`);
  const wasFriend = new Set(previous.friends.map((f) => f.id));
  for (const friend of next.friends) {
    if (!wasFriend.has(friend.id) && previous.outgoing.some((r) => r.id === friend.id)) news.push(`${friend.name} accepted your friend request`);
  }
  return news;
}

export interface SocialCallbacks {
  onChange(view: SocialView): void;
  /** The party leader moved into a room this player is not in. */
  onFollow(roomCode: string, leaderName: string): void;
  onNews(text: string): void;
}

/** How often the client asks. Also what keeps this player's own presence at `menu`. */
export const SOCIAL_POLL_MS = 5_000;

/**
 * Friends and party state, kept fresh by polling `/api/social`.
 *
 * Polling rather than a push channel because a player in the menu has no socket: the game socket
 * exists only inside a room, and a second always-open socket per player would double the server's
 * connection count to carry a few hundred bytes every few seconds. The poll is also what tells the
 * server this player is here (`menu` presence), so the two needs are one request.
 */
export class SocialClient {
  private current: SocialView | null = null;
  private follow: FollowState = NO_FOLLOW;
  private timer: ReturnType<typeof setInterval> | null = null;
  private localId = '';
  private room: () => string | null = () => null;
  private inflight = false;

  constructor(
    private readonly api: Api,
    private readonly callbacks: SocialCallbacks,
  ) {}

  get view(): SocialView | null {
    return this.current;
  }

  start(localId: string, currentRoom: () => string | null): void {
    this.localId = localId;
    this.room = currentRoom;
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => {
      // A hidden tab is a player who is not looking; letting their presence lapse is accurate.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void this.refresh();
    }, SOCIAL_POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      this.apply(await this.api.social());
    } catch {
      // Unreachable server: keep the last view. The next poll tries again.
    } finally {
      this.inflight = false;
    }
  }

  /** Perform an action and adopt the server's answer. Returns the message to show. */
  async act(path: SocialActionPath, body: { playerId?: string; partyId?: string } = {}): Promise<string> {
    try {
      const result = await this.api.socialAction(path, body);
      this.apply(result.view);
      return result.message;
    } catch (error) {
      return `Could not reach the server (${(error as Error).message}).`;
    }
  }

  private apply(view: SocialView): void {
    for (const line of socialNews(this.current, view)) this.callbacks.onNews(line);
    this.current = view;
    const decision = followTarget(view, this.localId, this.room(), this.follow);
    this.follow = decision.state;
    this.callbacks.onChange(view);
    if (decision.roomCode) {
      const leader = view.party?.members.find((m) => m.leader);
      this.callbacks.onFollow(decision.roomCode, leader?.name ?? 'your party leader');
    }
  }
}

/** One row of the headset's friends panel; `id` encodes the action it performs. */
export interface SocialRow {
  id: string;
  label: string;
  value?: string;
}

export type SocialRowAction =
  | { kind: 'accept-invite'; partyId: string }
  | { kind: 'accept-friend'; playerId: string }
  | { kind: 'join'; roomCode: string }
  | { kind: 'invite'; playerId: string }
  | { kind: 'leave-party' }
  | { kind: 'back' };

/**
 * The friends panel for a headset, where there is no DOM to draw the full screen in.
 *
 * Only what can be *done* from inside a headset, most urgent first — an invite waiting on an
 * answer, a request, a friend's room to join, somebody to invite — and capped, because the panel is
 * a fixed quad whose rows must stay big enough to hit with a controller ray. Adding and removing
 * friends stays on the flat screens: it needs a list you can read, not a row you can point at.
 */
export function vrSocialRows(view: SocialView | null, localId: string, maxRows: number): SocialRow[] {
  const rows: SocialRow[] = [];
  if (view) {
    for (const invite of view.invites) rows.push({ id: `accept-invite:${invite.partyId}`, label: `Join ${invite.fromName}'s party`, value: `${invite.size}` });
    for (const request of view.incoming) rows.push({ id: `accept-friend:${request.id}`, label: `Accept ${request.name}`, value: 'friend' });
    const leading = !view.party || view.party.leaderId === localId;
    for (const friend of view.friends) {
      if (friend.inParty || friend.presence === 'offline') continue;
      if (friend.room?.code) rows.push({ id: `join:${friend.room.code}`, label: `Join ${friend.name}`, value: `${friend.room.players}/${friend.room.max}` });
      else if (leading) rows.push({ id: `invite:${friend.id}`, label: `Invite ${friend.name}`, value: friend.presence === 'match' ? 'in a match' : 'online' });
    }
  }
  const tail: SocialRow[] = [...(view?.party ? [{ id: 'leave-party', label: 'Leave party', value: `${view.party.members.length}/${view.party.max}` }] : []), { id: 'back', label: 'Back' }];
  return [...rows.slice(0, Math.max(0, maxRows - tail.length)), ...tail];
}

export function parseSocialRow(id: string): SocialRowAction | null {
  const split = id.indexOf(':');
  const kind = split < 0 ? id : id.slice(0, split);
  const arg = split < 0 ? '' : id.slice(split + 1);
  switch (kind) {
    case 'accept-invite':
      return arg ? { kind, partyId: arg } : null;
    case 'accept-friend':
      return arg ? { kind, playerId: arg } : null;
    case 'join':
      return arg ? { kind, roomCode: arg } : null;
    case 'invite':
      return arg ? { kind, playerId: arg } : null;
    case 'leave-party':
    case 'back':
      return { kind };
    default:
      return null;
  }
}
