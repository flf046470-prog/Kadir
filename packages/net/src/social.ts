/**
 * Friends and parties, as the server describes them to one player.
 *
 * Served by `GET /api/social` and returned by every social action, so a client that just pressed a
 * button redraws from the server's answer rather than from its own guess of what the button did.
 */

/** Where somebody is. `menu` means their client asked the server something in the last few seconds. */
export type Presence = 'offline' | 'menu' | 'match';

export interface SocialRoomView {
  /**
   * The room code, only when this player could join by it anyway: a public room, or the room their
   * own party leader is in. A friend's *private* room is shown as private without its code — the
   * host made it for the people they invited, and being somebody's friend is not an invitation.
   */
  code?: string;
  modeId: string;
  players: number;
  max: number;
  isPrivate: boolean;
}

export interface FriendView {
  id: string;
  name: string;
  animalId: string;
  presence: Presence;
  room?: SocialRoomView;
  /** In the same party as the viewer. */
  inParty: boolean;
}

export interface FriendRequestView {
  id: string;
  name: string;
  animalId: string;
}

export interface PartyMemberView {
  id: string;
  name: string;
  animalId: string;
  presence: Presence;
  leader: boolean;
}

export interface PartyView {
  id: string;
  leaderId: string;
  members: PartyMemberView[];
  max: number;
  /** The room the leader is in, or null while they are in the menu. Members follow it. */
  roomCode: string | null;
  /**
   * Counts the leader's moves into a new room. A member follows when this passes the last value
   * they acted on, so leaving a match on purpose is not undone by the next poll — the leader has
   * not moved, so there is nothing new to follow.
   */
  roomSeq: number;
  /** Friends invited and not yet answered, so the leader can see who is still pending. */
  invited: FriendRequestView[];
}

export interface PartyInviteView {
  partyId: string;
  fromId: string;
  fromName: string;
  size: number;
}

export interface SocialView {
  friends: FriendView[];
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
  party: PartyView | null;
  invites: PartyInviteView[];
}

/** Largest party: the smallest mode that is still a real match takes eight. */
export const MAX_PARTY_SIZE = 8;

/** What a social action did, in words the client can show. `view` is the state afterwards. */
export interface SocialActionResult {
  ok: boolean;
  message: string;
  view: SocialView;
}
