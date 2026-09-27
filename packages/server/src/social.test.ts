import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { MemorySaveStore } from '@kc/core';
import type { PlayerProfile } from '@kc/core';
import { MAX_PARTY_SIZE } from '@kc/net';
import type { ServerMessage } from '@kc/net';
import { AccountService } from './accounts.js';
import { createHttpHandler } from './http.js';
import { Leaderboard } from './leaderboard.js';
import { MemoryLeaderboardStore } from './leaderboard-store.js';
import { DevReceiptVerifier, PurchaseService } from './purchases.js';
import type { ClientSocket } from './room.js';
import { RoomManager } from './rooms.js';
import { INVITE_TTL_MS, PARTY_IDLE_MS, PRESENCE_WINDOW_MS, SocialService } from './social.js';
import type { SocialWorld } from './social.js';
import type { ServerConfig } from './config.js';

const CONFIG = {
  port: 0,
  host: '127.0.0.1',
  tickRate: 60,
  snapshotRate: 20,
  maxRooms: 20,
  maxPlayersPerRoom: 8,
  dataDir: 'data-test',
  sessionSecret: 'social-secret',
  clientTimeoutSeconds: 30,
  messageRateLimit: 90,
  allowedOrigins: [],
  publicDir: 'dist/client',
  assetLinksFile: '',
  stores: { metaAppId: '', metaAppSecret: '', steamAppId: '', steamWebApiKey: '', playPackageName: '' },
  allowDevPurchases: true,
  databaseUrl: '',
  ice: { servers: [], turnUrls: [], turnSecret: '', turnTtlSeconds: 43200 },
  moderators: new Set<string>(),
} as ServerConfig;

const socket = (): ClientSocket & { json: ServerMessage[] } => {
  const json: ServerMessage[] = [];
  return { json, sendJson: (m) => json.push(m), sendBinary() {}, close() {} };
};

/** A social service over a fake world where the test decides who is in which room. */
function harness() {
  let now = 1_000_000;
  const store = new MemorySaveStore();
  const accounts = new AccountService(store, 'x');
  const rooms = new Map<string, { code: string; isPrivate: boolean }>();
  const live = new Map<string, PlayerProfile>();
  const world: SocialWorld = {
    liveProfile: (id) => live.get(id) ?? null,
    roomOf: (id) => {
      const room = rooms.get(id);
      return room ? { ...room, modeId: 'kangaroo-chase', players: 3, max: 16 } : null;
    },
  };
  const social = new SocialService(accounts, () => now);
  social.attach(world);
  const player = async (name: string) => (await accounts.createGuest(name)).playerId;
  const befriend = async (a: string, b: string) => {
    await social.requestFriend(a, b);
    return social.acceptFriend(b, a);
  };
  return {
    store,
    accounts,
    social,
    rooms,
    live,
    player,
    befriend,
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}

describe('friends', () => {
  it('a request waits on both sides, and accepting makes it mutual and durable', async () => {
    const h = harness();
    const [a, b] = [await h.player('Ann'), await h.player('Bo')];
    const sent = await h.social.requestFriend(a, b);
    expect(sent.ok).toBe(true);
    expect(sent.view.outgoing.map((r) => r.name)).toEqual(['Bo']);
    expect((await h.social.view(b)).incoming.map((r) => r.name)).toEqual(['Ann']);

    const accepted = await h.social.acceptFriend(b, a);
    expect(accepted.ok).toBe(true);
    // Written to the store on both sides, not only held in memory.
    expect((await h.store.load(a))?.friendIds).toEqual([b]);
    expect((await h.store.load(b))?.friendIds).toEqual([a]);
    expect((await h.store.load(a))?.friendRequestsOut).toEqual([]);
    expect((await h.store.load(b))?.friendRequestsIn).toEqual([]);
  });

  it('refuses ids nobody owns, and does not create an account for them', async () => {
    const h = harness();
    const a = await h.player('Ann');
    const result = await h.social.requestFriend(a, 'g_nobody');
    expect(result.ok).toBe(false);
    expect(await h.store.load('g_nobody')).toBeNull();
  });

  it('edits the live profile a room holds, not a stale stored copy', async () => {
    const h = harness();
    const [a, b] = [await h.player('Ann'), await h.player('Bo')];
    // Bo is in a match: the room holds this object and will save it when Bo leaves.
    const bLive = (await h.store.load(b)) as PlayerProfile;
    h.live.set(b, bLive);
    h.rooms.set(b, { code: 'KANG-2345', isPrivate: false });
    await h.befriend(a, b);
    expect(bLive.friendIds).toEqual([a]);
    // The room's save on leave writes the friendship, rather than erasing it.
    await h.accounts.save(bLive);
    expect((await h.store.load(b))?.friendIds).toEqual([a]);
  });

  it('shows a friend in a public room with its code, and in a private one without', async () => {
    const h = harness();
    const [a, b, c] = [await h.player('Ann'), await h.player('Bo'), await h.player('Cy')];
    await h.befriend(a, b);
    await h.befriend(a, c);
    h.rooms.set(b, { code: 'KANG-2345', isPrivate: false });
    h.rooms.set(c, { code: 'KANG-6789', isPrivate: true });
    const friends = (await h.social.view(a)).friends;
    const bo = friends.find((f) => f.id === b);
    const cy = friends.find((f) => f.id === c);
    expect(bo?.presence).toBe('match');
    expect(bo?.room?.code).toBe('KANG-2345');
    expect(cy?.presence).toBe('match');
    expect(cy?.room?.isPrivate).toBe(true);
    expect(cy?.room?.code).toBeUndefined();
  });

  it('reads presence from rooms and recent polls, and goes offline when the polls stop', async () => {
    const h = harness();
    const [a, b] = [await h.player('Ann'), await h.player('Bo')];
    await h.befriend(a, b);
    expect((await h.social.view(a)).friends[0]?.presence).toBe('offline');
    h.social.touch(b);
    expect((await h.social.view(a)).friends[0]?.presence).toBe('menu');
    h.advance(PRESENCE_WINDOW_MS + 1);
    expect((await h.social.view(a)).friends[0]?.presence).toBe('offline');
  });

  it('a block ends the friendship on both profiles', async () => {
    const h = harness();
    const [a, b] = [await h.player('Ann'), await h.player('Bo')];
    await h.befriend(a, b);
    const bProfile = (await h.store.load(b)) as PlayerProfile;
    bProfile.blockedPlayerIds.push(a);
    await h.accounts.save(bProfile);
    await h.social.blocked(b, a);
    expect((await h.store.load(a))?.friendIds).toEqual([]);
    expect((await h.store.load(b))?.friendIds).toEqual([]);
    // And the blocked side cannot simply ask again.
    expect((await h.social.requestFriend(a, b)).ok).toBe(false);
  });

  it('keeps concurrent edits of one profile from overwriting each other', async () => {
    const h = harness();
    const target = await h.player('Popular');
    const askers = await Promise.all(Array.from({ length: 12 }, (_, i) => h.player(`P${i}`)));
    await Promise.all(askers.map((id) => h.social.requestFriend(id, target)));
    // Twelve read-modify-writes of the same stored profile, all at once: without the per-player
    // chain each one loads the same copy and the last save wins, leaving one request of twelve.
    expect((await h.store.load(target))?.friendRequestsIn.length).toBe(12);
  });
});

describe('parties', () => {
  it('invites only friends', async () => {
    const h = harness();
    const [a, b] = [await h.player('Ann'), await h.player('Bo')];
    expect((await h.social.invite(a, b)).ok).toBe(false);
    await h.befriend(a, b);
    const invited = await h.social.invite(a, b);
    expect(invited.ok).toBe(true);
    expect(invited.view.party?.invited.map((i) => i.name)).toEqual(['Bo']);
    const invites = (await h.social.view(b)).invites;
    expect(invites).toHaveLength(1);
    expect(invites[0]?.fromName).toBe('Ann');
  });

  it('follows the leader: accepting lands the member where the leader already is, and each move counts', async () => {
    const h = harness();
    const [a, b] = [await h.player('Ann'), await h.player('Bo')];
    await h.befriend(a, b);
    h.rooms.set(a, { code: 'KANG-2345', isPrivate: true });
    h.social.enteredRoom(a, 'KANG-2345');
    await h.social.invite(a, b);
    const partyId = (await h.social.view(b)).invites[0]?.partyId as string;
    const joined = await h.social.acceptInvite(b, partyId);
    expect(joined.ok).toBe(true);
    // A member sees the leader's room code even when it is private: that is what a party is for.
    expect(joined.view.party?.roomCode).toBe('KANG-2345');
    const firstSeq = joined.view.party?.roomSeq ?? 0;
    expect(firstSeq).toBeGreaterThan(0);

    h.social.leftRoom(a, 'KANG-2345');
    expect((await h.social.view(b)).party?.roomCode).toBeNull();
    h.social.enteredRoom(a, 'KANG-6789');
    const moved = (await h.social.view(b)).party;
    expect(moved?.roomCode).toBe('KANG-6789');
    expect(moved?.roomSeq).toBe(firstSeq + 1);
    // A member's own moves are not the party's.
    h.social.enteredRoom(b, 'KANG-9999');
    expect((await h.social.view(b)).party?.roomSeq).toBe(firstSeq + 1);
  });

  it('asks matchmaking for the whole party when the leader plays, and for one seat otherwise', async () => {
    const h = harness();
    const [a, b, c] = [await h.player('Ann'), await h.player('Bo'), await h.player('Cy')];
    await h.befriend(a, b);
    await h.befriend(a, c);
    for (const id of [b, c]) {
      await h.social.invite(a, id);
      await h.social.acceptInvite(id, (await h.social.view(id)).invites[0]?.partyId as string);
    }
    expect(h.social.seatsFor(a)).toBe(3);
    expect(h.social.seatsFor(b)).toBe(1);
  });

  it('hands leadership on when the leader leaves, and disbands a party of one', async () => {
    const h = harness();
    const [a, b, c] = [await h.player('Ann'), await h.player('Bo'), await h.player('Cy')];
    await h.befriend(a, b);
    await h.befriend(a, c);
    for (const id of [b, c]) {
      await h.social.invite(a, id);
      await h.social.acceptInvite(id, (await h.social.view(id)).invites[0]?.partyId as string);
    }
    await h.social.leaveParty(a);
    const party = (await h.social.view(b)).party;
    expect(party?.leaderId).toBe(b);
    expect(party?.members.map((m) => m.id)).toEqual([b, c]);
    await h.social.leaveParty(c);
    expect((await h.social.view(b)).party).toBeNull();
  });

  it('lets invites lapse, and drops a member whose app has been closed for a while', async () => {
    const h = harness();
    const [a, b, c] = [await h.player('Ann'), await h.player('Bo'), await h.player('Cy')];
    await h.befriend(a, b);
    await h.befriend(a, c);
    await h.social.invite(a, b);
    h.advance(INVITE_TTL_MS + 1);
    const partyId = 'p1';
    expect((await h.social.acceptInvite(b, partyId)).ok).toBe(false);

    await h.social.invite(a, c);
    await h.social.acceptInvite(c, (await h.social.view(c)).invites[0]?.partyId as string);
    // Ann keeps polling; Cy closes the app.
    for (let t = 0; t <= PARTY_IDLE_MS + PRESENCE_WINDOW_MS; t += 5_000) {
      h.social.touch(a);
      h.advance(5_000);
      h.social.sweep();
    }
    expect((await h.social.view(a)).party).toBeNull();
  });

  it('caps a party', async () => {
    const h = harness();
    const leader = await h.player('Lead');
    for (let i = 0; i < MAX_PARTY_SIZE; i++) {
      const id = await h.player(`M${i}`);
      await h.befriend(leader, id);
      await h.social.invite(leader, id);
      const partyId = (await h.social.view(id)).invites[0]?.partyId;
      if (partyId) await h.social.acceptInvite(id, partyId);
    }
    const view = await h.social.view(leader);
    expect(view.party?.members).toHaveLength(MAX_PARTY_SIZE);
  });

  it('a block splits a shared party', async () => {
    const h = harness();
    const [a, b] = [await h.player('Ann'), await h.player('Bo')];
    await h.befriend(a, b);
    await h.social.invite(a, b);
    await h.social.acceptInvite(b, (await h.social.view(b)).invites[0]?.partyId as string);
    await h.social.blocked(b, a);
    expect((await h.social.view(b)).party).toBeNull();
    expect((await h.social.view(a)).party).toBeNull();
  });
});

describe('parties in real rooms', () => {
  it('a leader who quick-plays is put where the whole party fits, and the room tells the party', async () => {
    const accounts = new AccountService(new MemorySaveStore(), 'x');
    const rooms = new RoomManager({ ...CONFIG, maxPlayersPerRoom: 4 } as ServerConfig, accounts, new Leaderboard(new MemoryLeaderboardStore()));
    const social = rooms.social;
    const names = ['Ann', 'Bo', 'Cy'];
    const [a, b, c] = await Promise.all(names.map(async (n) => (await accounts.createGuest(n)).playerId)) as [string, string, string];
    for (const id of [b, c]) {
      await social.requestFriend(a, id);
      await social.acceptFriend(id, a);
      await social.invite(a, id);
      await social.acceptInvite(id, (await social.view(id)).invites[0]?.partyId as string);
    }

    // A public room with two free seats of four: one stranger less than the party needs.
    const filler = await Promise.all(['X', 'Y'].map(async (n) => accounts.loadOrCreate((await accounts.createGuest(n)).playerId)));
    const busy = rooms.matchmake({ modeId: 'kangaroo-chase' }).room!;
    for (const profile of filler) busy.join(socket(), profile, 'pc', {}, true);

    const leaderMatch = rooms.matchmake({ modeId: 'kangaroo-chase', playerId: a, seats: social.seatsFor(a) });
    expect(leaderMatch.room).toBeDefined();
    expect(leaderMatch.room).not.toBe(busy);
    leaderMatch.room!.join(socket(), await accounts.loadOrCreate(a), 'pc', {}, true);

    // The room itself reported the move; the members' next poll carries it.
    const party = (await social.view(b)).party;
    expect(party?.roomCode).toBe(leaderMatch.room!.code);
    const follow = rooms.matchmake({ roomCode: party!.roomCode!, playerId: b });
    expect(follow.room).toBe(leaderMatch.room);

    // And friends see where the leader is.
    const ann = (await social.view(c)).friends.find((f) => f.id === a);
    expect(ann?.presence).toBe('match');
    expect(ann?.room?.code).toBe(leaderMatch.room!.code);

    leaderMatch.room!.leave(a);
    expect((await social.view(b)).party?.roomCode).toBeNull();
    expect((await social.view(c)).friends.find((f) => f.id === a)?.presence).not.toBe('match');
  });
});

describe('HTTP', () => {
  async function server() {
    const accounts = new AccountService(new MemorySaveStore(), 'x');
    const leaderboard = new Leaderboard(new MemoryLeaderboardStore());
    const rooms = new RoomManager(CONFIG, accounts, leaderboard);
    const handler = createHttpHandler({ config: CONFIG, accounts, rooms, leaderboard, purchases: new PurchaseService(new DevReceiptVerifier(true)) });
    const http = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const call = async (token: string, path: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    return { accounts, rooms, call, close: () => http.close() };
  }

  it('keeps an edit made mid-match when the player leaves the round', async () => {
    const s = await server();
    const guest = await s.accounts.createGuest('Ann');
    const room = s.rooms.matchmake({ playerId: guest.playerId }).room!;
    room.join(socket(), await s.accounts.loadOrCreate(guest.playerId), 'pc', {}, true);
    expect((await s.call(guest.token, '/api/equip', { animalId: 'wolf' })).status).toBe(200);
    room.leave(guest.playerId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Before the fix: the equip was saved, then the room saved its own stale copy over it.
    expect((await s.accounts.find(guest.playerId))?.equipped.animalId).toBe('wolf');
    s.close();
  });

  it('runs the friend and party flow end to end, authenticated', async () => {
    const s = await server();
    const ann = await s.accounts.createGuest('Ann');
    const bo = await s.accounts.createGuest('Bo');
    expect((await s.call('bad-token', '/api/social')).status).toBe(401);

    expect((await s.call(ann.token, '/api/friends/request', { playerId: bo.playerId })).status).toBe(200);
    const accepted = await s.call(bo.token, '/api/friends/accept', { playerId: ann.playerId });
    expect(accepted.status).toBe(200);
    expect((accepted.body.view as { friends: { name: string }[] }).friends.map((f) => f.name)).toEqual(['Ann']);

    expect((await s.call(ann.token, '/api/party/invite', { playerId: bo.playerId })).status).toBe(200);
    const invites = ((await s.call(bo.token, '/api/social')).body.invites as { partyId: string }[]);
    const joined = await s.call(bo.token, '/api/party/accept', { partyId: invites[0]?.partyId });
    expect(joined.status).toBe(200);
    expect((joined.body.view as { party: { members: unknown[] } }).party.members).toHaveLength(2);

    // Malformed ids are refused before any lookup; unknown routes are 404, not a silent 400.
    expect((await s.call(ann.token, '/api/friends/request', { playerId: { toString: 'x' } })).status).toBe(400);
    expect((await s.call(ann.token, '/api/party/nonsense', {})).status).toBe(404);
    s.close();
  });
});
