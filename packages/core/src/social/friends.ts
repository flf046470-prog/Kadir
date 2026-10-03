import type { PlayerProfile } from '../progression/profile.js';

/**
 * Friendship, as a rule over two profiles.
 *
 * A friendship is **mutual and stored on both sides**: `friendIds` on each profile, written together.
 * A pending request is stored on both sides too — `friendRequestsOut` on the sender, `friendRequestsIn`
 * on the recipient — so either player can see it and either can withdraw it without a lookup across
 * every account.
 *
 * These functions mutate the profiles they are given and say what happened; persisting both is the
 * caller's job. The server hands them the *live* profile of anyone who is in a room, never a copy
 * from the store: a room saves its own object when the player leaves, and a copy's change would be
 * overwritten by it (measured on this codebase — an equip made mid-match was reverted that way).
 *
 * Pure data rules, no clock and no I/O, so they sit in the core next to the profile they edit.
 */

/** Enough for a real circle of friends; bounded because the list travels in every social poll. */
export const MAX_FRIENDS = 100;
/**
 * Pending requests kept per side. Bounded because anyone who has shared a room with you knows your
 * id, and an unbounded inbox is a way to grow somebody else's profile without their consent. The
 * oldest request is dropped to make room, rather than refusing the newest: a flood must not lock
 * out the one request that matters.
 */
export const MAX_PENDING_REQUESTS = 30;

export type FriendRequestOutcome =
  /** Recorded on both sides and waiting for the other player. */
  | 'sent'
  /** They had already asked you, so asking back is saying yes. */
  | 'accepted'
  | 'already-friends'
  | 'already-sent'
  | 'self'
  /** Either side has blocked the other. The sender is not told which. */
  | 'unavailable'
  /** One of the two friend lists is full. */
  | 'full';

export function areFriends(a: PlayerProfile, b: PlayerProfile): boolean {
  return a.friendIds.includes(b.playerId) && b.friendIds.includes(a.playerId);
}

function blockedEitherWay(a: PlayerProfile, b: PlayerProfile): boolean {
  return a.blockedPlayerIds.includes(b.playerId) || b.blockedPlayerIds.includes(a.playerId);
}

function without(list: string[], id: string): string[] {
  return list.filter((entry) => entry !== id);
}

/** Append, dropping the oldest entries past `cap`. */
function pushCapped(list: string[], id: string, cap: number): string[] {
  const next = [...without(list, id), id];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function makeFriends(a: PlayerProfile, b: PlayerProfile): void {
  a.friendIds = pushCapped(a.friendIds, b.playerId, MAX_FRIENDS);
  b.friendIds = pushCapped(b.friendIds, a.playerId, MAX_FRIENDS);
  clearRequests(a, b);
}

function clearRequests(a: PlayerProfile, b: PlayerProfile): void {
  a.friendRequestsIn = without(a.friendRequestsIn, b.playerId);
  a.friendRequestsOut = without(a.friendRequestsOut, b.playerId);
  b.friendRequestsIn = without(b.friendRequestsIn, a.playerId);
  b.friendRequestsOut = without(b.friendRequestsOut, a.playerId);
}

export function requestFriend(from: PlayerProfile, to: PlayerProfile): FriendRequestOutcome {
  if (from.playerId === to.playerId) return 'self';
  if (blockedEitherWay(from, to)) return 'unavailable';
  if (areFriends(from, to)) return 'already-friends';
  if (from.friendIds.length >= MAX_FRIENDS || to.friendIds.length >= MAX_FRIENDS) return 'full';
  // Two players who each pressed "Add friend" both meant yes; making the second one wait for a
  // third tap would be a request nobody needs to answer.
  if (from.friendRequestsIn.includes(to.playerId)) {
    makeFriends(from, to);
    return 'accepted';
  }
  if (from.friendRequestsOut.includes(to.playerId) && to.friendRequestsIn.includes(from.playerId)) return 'already-sent';
  from.friendRequestsOut = pushCapped(from.friendRequestsOut, to.playerId, MAX_PENDING_REQUESTS);
  to.friendRequestsIn = pushCapped(to.friendRequestsIn, from.playerId, MAX_PENDING_REQUESTS);
  return 'sent';
}

/** `me` says yes to a request `other` sent. False when there was no such request to answer. */
export function acceptFriend(me: PlayerProfile, other: PlayerProfile): boolean {
  if (!me.friendRequestsIn.includes(other.playerId)) return false;
  if (blockedEitherWay(me, other)) {
    clearRequests(me, other);
    return false;
  }
  if (me.friendIds.length >= MAX_FRIENDS || other.friendIds.length >= MAX_FRIENDS) return false;
  makeFriends(me, other);
  return true;
}

/**
 * Undo whatever stands between two players: a friendship, a request either way, or both.
 *
 * One operation rather than three (unfriend, decline, cancel) because each is the same edit — the
 * relationship goes back to nothing — and three entry points is three chances for one of them to
 * forget the other profile.
 */
export function severFriendship(a: PlayerProfile, b: PlayerProfile): void {
  a.friendIds = without(a.friendIds, b.playerId);
  b.friendIds = without(b.friendIds, a.playerId);
  clearRequests(a, b);
}
