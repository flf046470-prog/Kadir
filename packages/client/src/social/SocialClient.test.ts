import { describe, expect, it } from 'vitest';
import type { PartyView, SocialView } from '@kc/net';
import { NO_FOLLOW, followTarget, parseSocialRow, socialNews, vrSocialRows } from './SocialClient.js';

const party = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'p1',
  leaderId: 'lead',
  members: [
    { id: 'lead', name: 'Lead', animalId: 'kangaroo', presence: 'match', leader: true },
    { id: 'me', name: 'Me', animalId: 'kangaroo', presence: 'menu', leader: false },
  ],
  max: 8,
  roomCode: null,
  roomSeq: 0,
  invited: [],
  ...over,
});

const view = (p: PartyView | null, over: Partial<SocialView> = {}): SocialView => ({
  friends: [],
  incoming: [],
  outgoing: [],
  party: p,
  invites: [],
  ...over,
});

describe('following the party leader', () => {
  it('joining a party whose leader is already in a room takes you there', () => {
    const decision = followTarget(view(party({ roomCode: 'KANG-2345', roomSeq: 1 })), 'me', null, NO_FOLLOW);
    expect(decision.roomCode).toBe('KANG-2345');
  });

  it('follows each move once, and never drags back a member who left on purpose', () => {
    let state = followTarget(view(party({ roomCode: 'KANG-2345', roomSeq: 1 })), 'me', null, NO_FOLLOW).state;
    // Now in the leader's room; the next poll changes nothing.
    expect(followTarget(view(party({ roomCode: 'KANG-2345', roomSeq: 1 })), 'me', 'KANG-2345', state).roomCode).toBeNull();
    // The member leaves the round for the menu. The leader has not moved, so nothing pulls them back.
    const stay = followTarget(view(party({ roomCode: 'KANG-2345', roomSeq: 1 })), 'me', null, state);
    expect(stay.roomCode).toBeNull();
    state = stay.state;
    // The leader moves on: that is new, so the member follows.
    expect(followTarget(view(party({ roomCode: 'KANG-6789', roomSeq: 2 })), 'me', null, state).roomCode).toBe('KANG-6789');
  });

  it('the leader follows nobody', () => {
    expect(followTarget(view(party({ roomCode: 'KANG-2345', roomSeq: 3 })), 'lead', null, NO_FOLLOW).roomCode).toBeNull();
  });

  it('does not reconnect a member who is already in the room', () => {
    expect(followTarget(view(party({ roomCode: 'KANG-2345', roomSeq: 5 })), 'me', 'KANG-2345', NO_FOLLOW).roomCode).toBeNull();
  });

  it('a leader in the menu is nowhere to follow', () => {
    expect(followTarget(view(party({ roomCode: null, roomSeq: 4 })), 'me', 'KANG-1111', { partyId: 'p1', lastSeq: 3 }).roomCode).toBeNull();
  });
});

describe('social news', () => {
  it('announces a request or an invite once, when it first appears', () => {
    const before = view(null);
    const after = view(null, {
      incoming: [{ id: 'a', name: 'Ann', animalId: 'fox' }],
      invites: [{ partyId: 'p9', fromId: 'b', fromName: 'Bo', size: 2 }],
    });
    expect(socialNews(before, after)).toEqual(['Ann wants to be friends', 'Bo invited you to their party']);
    expect(socialNews(after, after)).toEqual([]);
    // Nothing on the very first view: those requests were waiting before this session started.
    expect(socialNews(null, after)).toEqual([]);
  });

  it('says when a request you sent was accepted', () => {
    const before = view(null, { outgoing: [{ id: 'a', name: 'Ann', animalId: 'fox' }] });
    const after = view(null, { friends: [{ id: 'a', name: 'Ann', animalId: 'fox', presence: 'menu', inParty: false }] });
    expect(socialNews(before, after)).toEqual(['Ann accepted your friend request']);
  });
});

describe('the headset friends panel', () => {
  it('puts what is waiting on the player first, always ends with Back, and fits the panel', () => {
    const v = view(null, {
      invites: [{ partyId: 'p9', fromId: 'b', fromName: 'Bo', size: 2 }],
      incoming: [{ id: 'c', name: 'Cy', animalId: 'fox' }],
      friends: [
        { id: 'd', name: 'Dee', animalId: 'fox', presence: 'match', inParty: false, room: { code: 'KANG-2345', modeId: 'm', players: 3, max: 16, isPrivate: false } },
        { id: 'e', name: 'Eve', animalId: 'fox', presence: 'menu', inParty: false },
        { id: 'f', name: 'Fay', animalId: 'fox', presence: 'offline', inParty: false },
      ],
    });
    const rows = vrSocialRows(v, 'me', 12);
    expect(rows.map((r) => r.id)).toEqual(['accept-invite:p9', 'accept-friend:c', 'join:KANG-2345', 'invite:e', 'back']);
    expect(vrSocialRows(v, 'me', 3).map((r) => r.id)).toEqual(['accept-invite:p9', 'accept-friend:c', 'back']);
    for (const row of rows) expect(parseSocialRow(row.id)).not.toBeNull();
    expect(parseSocialRow('join:')).toBeNull();
    expect(parseSocialRow('nonsense:1')).toBeNull();
  });

  it('a party member cannot invite, and can always leave', () => {
    const v = view(party(), { friends: [{ id: 'e', name: 'Eve', animalId: 'fox', presence: 'menu', inParty: false }] });
    expect(vrSocialRows(v, 'me', 12).map((r) => r.id)).toEqual(['leave-party', 'back']);
  });
});
