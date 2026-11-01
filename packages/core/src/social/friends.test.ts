import { describe, expect, it } from 'vitest';
import { createProfile } from '../progression/profile.js';
import { migrateProfile } from '../save/index.js';
import { MAX_FRIENDS, MAX_PENDING_REQUESTS, acceptFriend, areFriends, requestFriend, severFriendship } from './friends.js';

const p = (id: string) => createProfile(id, id);

describe('friend rules', () => {
  it('asking back is saying yes', () => {
    const [a, b] = [p('a'), p('b')];
    expect(requestFriend(a, b)).toBe('sent');
    expect(requestFriend(b, a)).toBe('accepted');
    expect(areFriends(a, b)).toBe(true);
    expect([a.friendRequestsIn, a.friendRequestsOut, b.friendRequestsIn, b.friendRequestsOut].flat()).toEqual([]);
  });

  it('accepting needs a request to accept', () => {
    const [a, b] = [p('a'), p('b')];
    expect(acceptFriend(a, b)).toBe(false);
    expect(areFriends(a, b)).toBe(false);
  });

  it('a block either way makes a player unavailable, without saying which side blocked', () => {
    const [a, b] = [p('a'), p('b')];
    b.blockedPlayerIds.push('a');
    expect(requestFriend(a, b)).toBe('unavailable');
    expect(b.friendRequestsIn).toEqual([]);
  });

  it('bounds an inbox by dropping the oldest, so a flood cannot lock out the newest', () => {
    const target = p('t');
    for (let i = 0; i < MAX_PENDING_REQUESTS + 5; i++) requestFriend(p(`s${i}`), target);
    expect(target.friendRequestsIn).toHaveLength(MAX_PENDING_REQUESTS);
    expect(target.friendRequestsIn.at(-1)).toBe(`s${MAX_PENDING_REQUESTS + 4}`);
    expect(target.friendRequestsIn).not.toContain('s0');
  });

  it('refuses past a full list', () => {
    const a = p('a');
    a.friendIds = Array.from({ length: MAX_FRIENDS }, (_, i) => `f${i}`);
    expect(requestFriend(a, p('b'))).toBe('full');
  });

  it('severing clears the friendship and every request both ways', () => {
    const [a, b] = [p('a'), p('b')];
    requestFriend(a, b);
    requestFriend(b, a);
    severFriendship(b, a);
    expect(areFriends(a, b)).toBe(false);
    requestFriend(a, b);
    severFriendship(b, a);
    expect([a.friendRequestsOut, b.friendRequestsIn].flat()).toEqual([]);
  });

  it('fills the lists on a save written before friends existed, and drops junk in them', () => {
    const old = { ...createProfile('x', 'x') } as Record<string, unknown>;
    delete old.friendIds;
    delete old.friendRequestsIn;
    old.friendRequestsOut = ['ok', 7, { evil: true }, 'ok'];
    const loaded = migrateProfile(old, 'x');
    expect(loaded.friendIds).toEqual([]);
    expect(loaded.friendRequestsIn).toEqual([]);
    expect(loaded.friendRequestsOut).toEqual(['ok']);
  });
});
