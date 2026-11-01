import { describe, expect, it } from 'vitest';
import { Buttons, LevelBuilder, MemorySaveStore, Rand, buildJungleWorld, createIntent, vec3 } from '@kc/core';
import type { LevelDef, PlayerSnapshot } from '@kc/core';
import { SlotTable, decodeSnapshot, encodeIntent } from '@kc/net';
import type { ServerMessage } from '@kc/net';
import { AccountService } from './accounts.js';
import { Leaderboard } from './leaderboard.js';
import { MemoryLeaderboardStore } from './leaderboard-store.js';
import { Room } from './room.js';
import type { ClientSocket } from './room.js';

class FakeSocket implements ClientSocket {
  json: ServerMessage[] = [];
  binary: Uint8Array[] = [];
  sendJson(message: ServerMessage): void {
    this.json.push(message);
  }
  sendBinary(data: Uint8Array): void {
    this.binary.push(data);
  }
  close(): void {}
}

/** Flat ground and one wall 40 m tall down the middle: nobody sees over it, from anywhere. */
function walledLevel(): LevelDef {
  const b = new LevelBuilder(new Rand(1));
  b.box(vec3(0, -1, 0), vec3(200, 1, 200), 'dirt');
  b.box(vec3(0, 20, 0), vec3(0.5, 20, 100), 'rock');
  return { ...buildJungleWorld(), colliders: b.build(buildJungleWorld()).colliders, props: [], bodies: [] };
}

/** Every snapshot a client was sent, decoded the way `NetClient` decodes them. */
function decodeAll(socket: FakeSocket): PlayerSnapshot[][] {
  const welcome = socket.json.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }>;
  const slots = new SlotTable();
  for (const [id, slot] of welcome.slots) slots.setSlot(id, slot);
  for (const m of socket.json) if (m.t === 'joined') slots.setSlot(m.player.id, m.player.slot);
  const baseline = new Map<string, PlayerSnapshot>();
  return socket.binary.map((frame) => {
    const decoded = decodeSnapshot(frame, slots, baseline);
    for (const p of decoded.players) baseline.set(p.id, p);
    return decoded.players;
  });
}

/**
 * The Hunt withholds an opponent nobody could see (`sim/concealment.ts`), from the snapshot *and*
 * from the events — a hop is a `jump` and a `land` with a position on each, so hiding one channel
 * alone hid nothing. Measured before this, 56–77 % of the survivors a hunter was sent were behind
 * something.
 */
describe('a mode about hiding', () => {
  it('sends a hunter nothing about a survivor behind a wall, and a teammate everything', async () => {
    const accounts = new AccountService(new MemorySaveStore(), 'concealment-secret');
    const room = new Room({
      code: 'KANG-TEST',
      modeId: 'hunt',
      isPrivate: true,
      maxPlayers: 8,
      snapshotIntervalTicks: 3,
      accounts,
      leaderboard: new Leaderboard(new MemoryLeaderboardStore()),
      level: walledLevel(),
      seed: 3,
    });
    const sockets = new Map<string, FakeSocket>();
    for (const id of ['p1', 'p2', 'p3']) {
      const socket = new FakeSocket();
      sockets.set(id, socket);
      room.join(socket, await accounts.loadOrCreate(id, id), 'pc', {}, true);
    }

    let tick = 0;
    const idle = createIntent();
    const run = (ticks: number, pin?: () => void, jumper?: string) => {
      for (let i = 0; i < ticks; i++, tick++) {
        pin?.();
        for (const id of sockets.keys()) {
          const intent = id === jumper && tick % 30 === 0 ? { ...idle, buttons: Buttons.Jump } : idle;
          room.handleIntent(id, encodeIntent({ ...intent, tick }));
        }
        room.tick();
      }
    };
    run(60 * 12);
    expect(room.simulation.mode.state().phase).toBe('playing');

    const ids = [...sockets.keys()];
    const hunters = ids.filter((id) => room.playerState(id)?.role === 'hunter');
    expect(hunters).toHaveLength(1);
    const hunter = hunters[0] as string;
    const [hidden, seen] = ids.filter((id) => id !== hunter) as [string, string];

    // The hunter at x = -20; one survivor beyond the wall 40 m away, one in plain sight 30 m away.
    const place = (id: string, x: number, z: number) => {
      const p = room.playerState(id);
      if (!p) return;
      p.position.x = x;
      p.position.y = 0;
      p.position.z = z;
      p.velocity.x = p.velocity.y = p.velocity.z = 0;
    };
    let hiddenAt = { x: 20, z: 0 };
    const pin = () => {
      place(hunter, -20, 0);
      place(hidden, hiddenAt.x, hiddenAt.z);
      place(seen, -20, 30);
    };
    run(60, pin);
    const hunterSocket = sockets.get(hunter) as FakeSocket;
    const framesBefore = hunterSocket.binary.length;
    const jsonBefore = hunterSocket.json.length;
    const teammate = sockets.get(seen) as FakeSocket;
    const teammateJsonBefore = teammate.json.length;
    run(120, pin, hidden);

    const hunterView = decodeAll(hunterSocket).slice(framesBefore);
    expect(hunterView.length).toBeGreaterThan(30);
    expect(hunterView.some((players) => players.some((p) => p.id === hidden))).toBe(false);
    expect(hunterView.every((players) => players.some((p) => p.id === seen))).toBe(true);

    const eventsAbout = (socket: FakeSocket, from: number, id: string) =>
      socket.json
        .slice(from)
        .flatMap((m) => (m.t === 'events' ? m.events : []))
        .filter((e) => e.playerId === id);
    // The survivor behind the wall hopped four times: the teammate heard every one, the hunter none.
    expect(eventsAbout(teammate, teammateJsonBefore, hidden).some((e) => e.type === 'jump')).toBe(true);
    expect(eventsAbout(hunterSocket, jsonBefore, hidden)).toHaveLength(0);

    // A survivor seen by a teammate, though the hunter cannot see them. They are 50 m apart, past
    // `NEAR_DISTANCE`, so at the far rate: one snapshot in four, never none.
    const teammateView = decodeAll(teammate).slice(-12);
    expect(teammateView.filter((players) => players.some((p) => p.id === hidden)).length).toBeGreaterThanOrEqual(3);

    // Out from behind the wall: sent at once, as a whole record. The baseline must not claim the
    // hunter already had them, or every field that never changed would arrive empty.
    hiddenAt = { x: -20, z: -30 };
    const framesHidden = hunterSocket.binary.length;
    run(12, pin);
    const back = decodeAll(hunterSocket)
      .slice(framesHidden)
      .flat()
      .filter((p) => p.id === hidden)
      .at(-1);
    expect(back).toBeDefined();
    expect(back?.x).toBeCloseTo(-20, 0);
    // `role` never changed while they were hidden, so a baseline that wrongly held it would have
    // left it out — and a fresh record has no role but the blank one.
    expect(back?.role).toBe('survivor');
  });
});

/**
 * A player the client has never been sent must not be in that client's baseline. The old rule
 * recorded a skipped player's current state whenever the client had nothing for them — which
 * happens to every newcomer more than `NEAR_DISTANCE` away, since three snapshots in four skip
 * far players. The next frame then carried only what had *changed*, which for somebody standing
 * still is nothing, and the client drew them at the origin.
 */
describe('the delta baseline', () => {
  it('draws a far newcomer where they stand, not at the origin', async () => {
    const accounts = new AccountService(new MemorySaveStore(), 'baseline-secret');
    const room = new Room({
      code: 'KANG-BASE',
      modeId: 'training',
      isPrivate: true,
      maxPlayers: 8,
      snapshotIntervalTicks: 3,
      accounts,
      leaderboard: new Leaderboard(new MemoryLeaderboardStore()),
      level: walledLevel(),
      seed: 5,
    });
    const viewer = new FakeSocket();
    room.join(viewer, await accounts.loadOrCreate('v', 'v'), 'pc', {}, true);
    const still = (id: string, x: number, z: number) => {
      const p = room.playerState(id);
      if (!p) return;
      p.position.x = x;
      p.position.y = 0;
      p.position.z = z;
      p.velocity.x = p.velocity.y = p.velocity.z = 0;
    };
    const step = () => {
      still('v', -20, 60);
      still('n', -70, 60); // 50 m from the viewer, on the viewer's side of the wall
      room.tick();
    };
    // Join so that the very next snapshot is a far-rate one, which skips the newcomer.
    while (Math.floor((Math.ceil((room.simulation.tick + 1) / 3) * 3) / 3) % 4 !== 1) step();
    room.join(new FakeSocket(), await accounts.loadOrCreate('n', 'n'), 'pc', {}, true);
    for (let i = 0; i < 30; i++) step();

    const seen = decodeAll(viewer)
      .flat()
      .filter((p) => p.id === 'n');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.x).toBeCloseTo(-70, 0);
  });
});
