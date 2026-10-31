import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetClient } from './NetClient.js';
import type { NetHandlers } from './NetClient.js';

/** Just enough of a browser WebSocket to drive NetClient's open/close bookkeeping. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readonly OPEN = 1;
  readyState = 0;
  binaryType = '';
  sent: unknown[] = [];
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, event: unknown = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  open(): void {
    this.readyState = 1;
    this.fire('open');
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
}

const handlers = (): NetHandlers =>
  new Proxy({} as NetHandlers, { get: () => () => undefined });

const options = { url: 'ws://x/ws', name: 'A', animalId: 'kangaroo', cosmetics: {}, platform: 'pc' as const, crossPlay: true };

describe('NetClient', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('leaving one room and joining the next keeps exactly the new connection', () => {
    const net = new NetClient(handlers());
    net.connect(options);
    const first = FakeSocket.all[0] as FakeSocket;
    first.open();

    // A party member follows the leader: out of this room and straight into the next one.
    net.disconnect();
    net.connect({ ...options, roomCode: 'KANG-2345' });
    const second = FakeSocket.all[1] as FakeSocket;
    second.open();
    // The old socket's close event lands after the new socket already exists.
    first.fire('close', { code: 1000 });

    net.sendJson({ t: 'ready', ready: true });
    expect(second.sent.map((m) => JSON.parse(String(m)).t)).toContain('ready');
    // And no reconnect opened a third socket beside the second.
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(net.currentStatus).toBe('connected');
  });

  it('still reconnects when the live connection drops', () => {
    const net = new NetClient(handlers());
    net.connect(options);
    const first = FakeSocket.all[0] as FakeSocket;
    first.open();
    first.fire('close', { code: 1006 });
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(2);
  });
});
