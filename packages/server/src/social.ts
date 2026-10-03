import { acceptFriend, areFriends, requestFriend, severFriendship } from '@kc/core';
import type { PlayerProfile } from '@kc/core';
import { MAX_PARTY_SIZE } from '@kc/net';
import type {
  FriendRequestView,
  FriendView,
  PartyInviteView,
  PartyView,
  Presence,
  SocialActionResult,
  SocialRoomView,
  SocialView,
} from '@kc/net';
import type { AccountService } from './accounts.js';

/** A client in the menu polls every five seconds; this long without a word and it is gone. */
export const PRESENCE_WINDOW_MS = 20_000;
/** An unanswered party invite lapses, so a stale one cannot pull somebody in hours later. */
export const INVITE_TTL_MS = 5 * 60_000;
/** A party member unseen this long is taken out, so a closed app does not hold a seat forever. */
export const PARTY_IDLE_MS = 5 * 60_000;
const NAME_CACHE_LIMIT = 20_000;

/** What the social service needs to know about the rooms, without importing them. */
export interface SocialWorld {
  /** The profile object a connected player's room holds — see `liveProfile` in `moderation.ts`. */
  liveProfile(playerId: string): PlayerProfile | null;
  /** The room a connected player is in, or null. */
  roomOf(playerId: string): { code: string; modeId: string; players: number; max: number; isPrivate: boolean } | null;
}

interface Party {
  id: string;
  leaderId: string;
  members: string[];
  invited: Map<string, { fromId: string; expiresAt: number }>;
  roomCode: string | null;
  roomSeq: number;
  lastPresent: Map<string, number>;
}

/**
 * Friends and parties, server-wide.
 *
 * Friendships are persisted on both profiles (`social/friends.ts` in the core owns the rule).
 * Parties are not: a party is who you are playing with tonight, and a restart that disbands one
 * costs a re-invite, where persisting them would cost a store schema and a cleanup job for every
 * party whose players simply closed the app.
 *
 * A party **follows its leader**. The server never moves anybody — it only records which room the
 * leader entered (`enteredRoom`, called by the room itself) and counts the moves in `roomSeq`; each
 * member's client sees the count go up and joins that room by code. That keeps one path into a room
 * (hello → matchmake → join) with every check it already makes: capacity, kicks, bans.
 *
 * Presence is `match` while a room holds the player and `menu` while their client has polled
 * recently. Nothing else is claimed: a player with the app closed is `offline`, and nobody is told
 * more about a friend than which public room they are in.
 */
export class SocialService {
  private world: SocialWorld | null = null;
  private readonly seen = new Map<string, number>();
  private readonly names = new Map<string, { name: string; animalId: string }>();
  private readonly parties = new Map<string, Party>();
  private readonly partyOf = new Map<string, string>();
  private readonly invitesTo = new Map<string, Set<string>>();
  /** Per-player operation chain: two social edits of one profile never interleave. */
  private readonly locks = new Map<string, Promise<unknown>>();
  private nextPartyId = 1;

  constructor(
    private readonly accounts: AccountService,
    private readonly clock: () => number = Date.now,
  ) {}

  attach(world: SocialWorld): void {
    this.world = world;
  }

  /** Any authenticated request is a sign of life from the menu. */
  touch(playerId: string): void {
    this.seen.set(playerId, this.clock());
  }

  /** Keep the name and animal a profile carries, so a friends list costs no store reads. */
  remember(profile: PlayerProfile): void {
    this.names.delete(profile.playerId);
    this.names.set(profile.playerId, { name: profile.name, animalId: profile.equipped.animalId });
    if (this.names.size > NAME_CACHE_LIMIT) {
      const oldest = this.names.keys().next().value;
      if (oldest !== undefined) this.names.delete(oldest);
    }
  }

  presence(playerId: string, now = this.clock()): Presence {
    if (this.world?.roomOf(playerId)) return 'match';
    const seen = this.seen.get(playerId);
    return seen !== undefined && now - seen <= PRESENCE_WINDOW_MS ? 'menu' : 'offline';
  }

  // ---------------------------------------------------------------------------------------------
  // Friends

  async requestFriend(fromId: string, toId: string): Promise<SocialActionResult> {
    return this.pair(fromId, toId, async (from, to) => {
      if (!to) return this.result(fromId, false, 'No such player.');
      const outcome = requestFriend(from, to);
      await this.saveBoth(from, to, outcome === 'sent' || outcome === 'accepted');
      const messages: Record<typeof outcome, [boolean, string]> = {
        sent: [true, `Friend request sent to ${to.name}.`],
        accepted: [true, `You and ${to.name} are now friends.`],
        'already-friends': [false, `You and ${to.name} are already friends.`],
        'already-sent': [false, `Your request to ${to.name} is still waiting.`],
        self: [false, 'That is you.'],
        unavailable: [false, 'That player cannot be added.'],
        full: [false, 'A friends list is full.'],
      };
      const [ok, message] = messages[outcome];
      return this.result(fromId, ok, message);
    });
  }

  async acceptFriend(meId: string, otherId: string): Promise<SocialActionResult> {
    return this.pair(meId, otherId, async (me, other) => {
      if (!other) return this.result(meId, false, 'No such player.');
      const ok = acceptFriend(me, other);
      await this.saveBoth(me, other, true);
      return this.result(meId, ok, ok ? `You and ${other.name} are now friends.` : 'That request is no longer there.');
    });
  }

  /** Unfriend, decline or withdraw — whatever stands between the two goes. */
  async removeFriend(meId: string, otherId: string): Promise<SocialActionResult> {
    return this.pair(meId, otherId, async (me, other) => {
      if (!other) return this.result(meId, false, 'No such player.');
      severFriendship(me, other);
      this.cancelInvitesBetween(meId, otherId);
      await this.saveBoth(me, other, true);
      return this.result(meId, true, `Removed ${other.name}.`);
    });
  }

  /**
   * One player blocked another. Friendship and requests go both ways, invites between them lapse,
   * and they stop sharing a party: the blocked player is removed by a leader, or the blocker leaves.
   */
  async blocked(meId: string, otherId: string): Promise<void> {
    await this.pair(meId, otherId, async (me, other) => {
      if (!other) return;
      severFriendship(me, other);
      await this.saveBoth(me, other, true);
    });
    this.cancelInvitesBetween(meId, otherId);
    const party = this.partyFor(meId);
    if (party && party.members.includes(otherId)) {
      if (party.leaderId === meId) this.removeMember(party, otherId);
      else this.removeMember(party, meId);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Parties

  async invite(fromId: string, toId: string): Promise<SocialActionResult> {
    if (fromId === toId) return this.result(fromId, false, 'That is you.');
    const [from, to] = await Promise.all([this.profile(fromId), this.profile(toId)]);
    // Friends only. A party pulls its members into rooms, so an invite from a stranger would be a
    // way to drag somebody into a room they never chose.
    if (!from || !to || !areFriends(from, to)) return this.result(fromId, false, 'You can only invite friends.');
    let party = this.partyFor(fromId);
    if (party && party.leaderId !== fromId) return this.result(fromId, false, 'Only the party leader can invite.');
    if (party?.members.includes(toId)) return this.result(fromId, false, `${to.name} is already in your party.`);
    if (party && party.members.length >= MAX_PARTY_SIZE) return this.result(fromId, false, 'Your party is full.');
    if (!party) party = this.createParty(fromId);
    party.invited.set(toId, { fromId, expiresAt: this.clock() + INVITE_TTL_MS });
    this.indexInvite(toId, party.id, true);
    return this.result(fromId, true, `Invited ${to.name} to your party.`);
  }

  acceptInvite(meId: string, partyId: string): Promise<SocialActionResult> {
    const party = this.parties.get(partyId);
    const invite = party?.invited.get(meId);
    if (!party || !invite || invite.expiresAt < this.clock()) {
      if (party) party.invited.delete(meId);
      this.indexInvite(meId, partyId, false);
      return this.result(meId, false, 'That invite has expired.');
    }
    if (party.members.length >= MAX_PARTY_SIZE) return this.result(meId, false, 'That party is full.');
    const current = this.partyFor(meId);
    if (current && current.id !== party.id) this.removeMember(current, meId);
    party.invited.delete(meId);
    this.indexInvite(meId, partyId, false);
    if (!party.members.includes(meId)) party.members.push(meId);
    this.partyOf.set(meId, party.id);
    party.lastPresent.set(meId, this.clock());
    return this.result(meId, true, `You joined ${this.nameOf(party.leaderId).name}'s party.`);
  }

  declineInvite(meId: string, partyId: string): Promise<SocialActionResult> {
    const party = this.parties.get(partyId);
    party?.invited.delete(meId);
    this.indexInvite(meId, partyId, false);
    if (party) this.disbandIfEmpty(party);
    return this.result(meId, true, 'Invite declined.');
  }

  leaveParty(meId: string): Promise<SocialActionResult> {
    const party = this.partyFor(meId);
    if (!party) return this.result(meId, false, 'You are not in a party.');
    this.removeMember(party, meId);
    return this.result(meId, true, 'You left the party.');
  }

  kick(leaderId: string, targetId: string): Promise<SocialActionResult> {
    const party = this.partyFor(leaderId);
    if (!party || party.leaderId !== leaderId) return this.result(leaderId, false, 'Only the party leader can do that.');
    if (targetId === leaderId || !party.members.includes(targetId)) return this.result(leaderId, false, 'They are not in your party.');
    this.removeMember(party, targetId);
    return this.result(leaderId, true, `Removed ${this.nameOf(targetId).name} from the party.`);
  }

  /** How many seats a player's matchmaking must find: the whole party when they lead one. */
  seatsFor(playerId: string): number {
    const party = this.partyFor(playerId);
    return party && party.leaderId === playerId ? party.members.length : 1;
  }

  /** Called by a room when a player joins it. A leader's move is what the party follows. */
  enteredRoom(playerId: string, code: string): void {
    const party = this.partyFor(playerId);
    if (!party || party.leaderId !== playerId || party.roomCode === code) return;
    party.roomCode = code;
    party.roomSeq++;
  }

  /** Called by a room when a player leaves it. A leader in the menu is somewhere nobody can follow. */
  leftRoom(playerId: string, code: string): void {
    const party = this.partyFor(playerId);
    if (party && party.leaderId === playerId && party.roomCode === code) party.roomCode = null;
  }

  /** Periodic housekeeping: lapsed invites, vanished members, and presence nobody will ask about. */
  sweep(now = this.clock()): void {
    // Deleting from a Map while iterating it is defined behaviour: a pruned party is simply not visited again.
    for (const party of this.parties.values()) this.prune(party, now);
    for (const [id, at] of this.seen) if (now - at > PARTY_IDLE_MS) this.seen.delete(id);
  }

  // ---------------------------------------------------------------------------------------------
  // The view

  async view(meId: string): Promise<SocialView> {
    const now = this.clock();
    const me = await this.profile(meId);
    const party = this.partyFor(meId);
    if (party) this.prune(party, now);
    const livingParty = this.partyFor(meId);

    // Names in parallel: on a cold cache each one is a store read, and a hundred of them in series
    // is a first poll measured in seconds on the file store.
    const friendIds = me?.friendIds ?? [];
    const names = await Promise.all(friendIds.map((id) => this.known(id)));
    const friends: FriendView[] = friendIds.map((id, i) => {
      const presence = this.presence(id, now);
      const inParty = livingParty?.members.includes(id) ?? false;
      const room = this.roomView(id, inParty && livingParty?.leaderId === id);
      return { id, ...(names[i] as { name: string; animalId: string }), presence, inParty, ...(room ? { room } : {}) };
    });
    // Online first, then by name: the people you can play with now are the ones you came for.
    const rank: Record<Presence, number> = { match: 0, menu: 1, offline: 2 };
    friends.sort((a, b) => rank[a.presence] - rank[b.presence] || a.name.localeCompare(b.name));

    const invites: PartyInviteView[] = [];
    for (const partyId of this.invitesTo.get(meId) ?? []) {
      const invited = this.parties.get(partyId);
      const invite = invited?.invited.get(meId);
      if (!invited || !invite || invite.expiresAt < now) continue;
      invites.push({ partyId, fromId: invite.fromId, fromName: this.nameOf(invite.fromId).name, size: invited.members.length });
    }

    return {
      friends,
      incoming: await this.requestViews(me?.friendRequestsIn ?? []),
      outgoing: await this.requestViews(me?.friendRequestsOut ?? []),
      party: livingParty ? await this.partyView(livingParty, now) : null,
      invites,
    };
  }

  private async partyView(party: Party, now: number): Promise<PartyView> {
    const names = await Promise.all(party.members.map((id) => this.known(id)));
    const members = party.members.map((id, i) => ({
      id,
      ...(names[i] as { name: string; animalId: string }),
      presence: this.presence(id, now),
      leader: id === party.leaderId,
    }));
    return {
      id: party.id,
      leaderId: party.leaderId,
      members,
      max: MAX_PARTY_SIZE,
      roomCode: party.roomCode,
      roomSeq: party.roomSeq,
      invited: await this.requestViews([...party.invited.entries()].filter(([, i]) => i.expiresAt >= now).map(([id]) => id)),
    };
  }

  private roomView(playerId: string, isMyLeader: boolean): SocialRoomView | null {
    const room = this.world?.roomOf(playerId);
    if (!room) return null;
    return {
      modeId: room.modeId,
      players: room.players,
      max: room.max,
      isPrivate: room.isPrivate,
      ...(!room.isPrivate || isMyLeader ? { code: room.code } : {}),
    };
  }

  private async requestViews(ids: readonly string[]): Promise<FriendRequestView[]> {
    const names = await Promise.all(ids.map((id) => this.known(id)));
    return ids.map((id, i) => ({ id, ...(names[i] as { name: string; animalId: string }) }));
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  private partyFor(playerId: string): Party | null {
    const id = this.partyOf.get(playerId);
    return id ? (this.parties.get(id) ?? null) : null;
  }

  private createParty(leaderId: string): Party {
    const party: Party = {
      id: `p${this.nextPartyId++}`,
      leaderId,
      members: [leaderId],
      invited: new Map(),
      roomCode: this.world?.roomOf(leaderId)?.code ?? null,
      roomSeq: 0,
      lastPresent: new Map([[leaderId, this.clock()]]),
    };
    // A leader already in a room counts as having moved there, so an invitee who accepts follows
    // them straight in rather than waiting for the leader's next room.
    if (party.roomCode) party.roomSeq = 1;
    this.parties.set(party.id, party);
    this.partyOf.set(leaderId, party.id);
    return party;
  }

  private removeMember(party: Party, playerId: string): void {
    party.members = party.members.filter((id) => id !== playerId);
    party.lastPresent.delete(playerId);
    if (this.partyOf.get(playerId) === party.id) this.partyOf.delete(playerId);
    if (party.leaderId === playerId && party.members.length > 0) {
      // Leadership passes to the longest-standing member. The room they are in becomes the room
      // the party is in, without counting as a move: nobody is pulled anywhere by a handover.
      party.leaderId = party.members[0] as string;
      party.roomCode = this.world?.roomOf(party.leaderId)?.code ?? null;
      // Invites were sent by the old leader on the old leader's word; they go with them.
      for (const id of party.invited.keys()) this.indexInvite(id, party.id, false);
      party.invited.clear();
    }
    this.disbandIfEmpty(party);
  }

  /** A party of one with nobody invited is not a party. */
  private disbandIfEmpty(party: Party): void {
    if (party.members.length > 1 || (party.members.length === 1 && party.invited.size > 0)) return;
    for (const id of party.members) if (this.partyOf.get(id) === party.id) this.partyOf.delete(id);
    for (const id of party.invited.keys()) this.indexInvite(id, party.id, false);
    this.parties.delete(party.id);
  }

  private prune(party: Party, now: number): void {
    for (const [id, invite] of party.invited) {
      if (invite.expiresAt < now) {
        party.invited.delete(id);
        this.indexInvite(id, party.id, false);
      }
    }
    // `removeMember` replaces `party.members` rather than editing it, so this loop keeps its own array.
    for (const id of party.members) {
      if (this.presence(id, now) !== 'offline') party.lastPresent.set(id, now);
      else if (now - (party.lastPresent.get(id) ?? 0) > PARTY_IDLE_MS) this.removeMember(party, id);
    }
    if (this.parties.has(party.id)) this.disbandIfEmpty(party);
  }

  private cancelInvitesBetween(a: string, b: string): void {
    for (const [inviter, invitee] of [
      [a, b],
      [b, a],
    ] as const) {
      const party = this.partyFor(inviter);
      if (party?.invited.has(invitee)) {
        party.invited.delete(invitee);
        this.indexInvite(invitee, party.id, false);
        this.disbandIfEmpty(party);
      }
    }
  }

  private indexInvite(playerId: string, partyId: string, add: boolean): void {
    const set = this.invitesTo.get(playerId) ?? new Set<string>();
    if (add) set.add(partyId);
    else set.delete(partyId);
    if (set.size > 0) this.invitesTo.set(playerId, set);
    else this.invitesTo.delete(playerId);
  }

  private nameOf(playerId: string): { name: string; animalId: string } {
    const live = this.world?.liveProfile(playerId);
    if (live) return { name: live.name, animalId: live.equipped.animalId };
    return this.names.get(playerId) ?? { name: 'Player', animalId: 'kangaroo' };
  }

  /** Name and animal, reading the store only for somebody this process has never seen. */
  private async known(playerId: string): Promise<{ name: string; animalId: string }> {
    if (this.world?.liveProfile(playerId) || this.names.has(playerId)) return this.nameOf(playerId);
    const profile = await this.accounts.find(playerId);
    if (profile) this.remember(profile);
    return this.nameOf(playerId);
  }

  /**
   * The object to edit: the room's own when the player is in one, otherwise the stored copy. Never
   * creates an account — a friend request to an id nobody owns must not bring one into existence.
   */
  private async profile(playerId: string): Promise<PlayerProfile | null> {
    const live = this.world?.liveProfile(playerId);
    if (live) return live;
    const stored = await this.accounts.find(playerId);
    if (stored) this.remember(stored);
    return stored;
  }

  /** Run an edit of two profiles with both players' chains held, in a fixed order. */
  private async pair<T>(aId: string, bId: string, run: (a: PlayerProfile, b: PlayerProfile | null) => Promise<T>): Promise<T> {
    const ids = [...new Set([aId, bId])].toSorted();
    return this.locked(ids, async () => {
      const a = await this.profile(aId);
      if (!a) throw new Error('unknown player');
      const b = aId === bId ? a : await this.profile(bId);
      return run(a, b);
    });
  }

  private async locked<T>(ids: string[], run: () => Promise<T>): Promise<T> {
    const previous = ids.map((id) => this.locks.get(id) ?? Promise.resolve());
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const chained = Promise.all(previous).then(() => mine);
    for (const id of ids) this.locks.set(id, chained);
    await Promise.all(previous.map((p) => p.catch(() => undefined)));
    try {
      return await run();
    } finally {
      release();
      for (const id of ids) if (this.locks.get(id) === chained) this.locks.delete(id);
    }
  }

  private async saveBoth(a: PlayerProfile, b: PlayerProfile, changed: boolean): Promise<void> {
    if (!changed) return;
    await this.accounts.save(a);
    if (b !== a) await this.accounts.save(b);
  }

  private async result(playerId: string, ok: boolean, message: string): Promise<SocialActionResult> {
    return { ok, message, view: await this.view(playerId) };
  }
}
